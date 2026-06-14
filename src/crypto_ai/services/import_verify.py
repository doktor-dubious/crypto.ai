"""Verification of an upload file against an import template."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.customer_configuration import CustomerConfiguration
from crypto_ai.database.models.import_template import ImportTemplate, ImportTemplateElement
from crypto_ai.schemas.import_log import (
    VerificationGroup,
    VerificationIssue,
    VerificationResponse,
)

# Issues cap — keeps response size bounded for very large files. Groups carry the
# unbounded totals so the summary remains accurate.
MAX_ISSUES_RETURNED = 10_000

# Labels used for grouping issues in the UI. Keep them short and stable.
GROUP_NOT_ALLOWED = "Records Not Allowed"
GROUP_DISALLOWED = "Records Disallowed"
GROUP_COLUMN_COUNT = "Column Count Mismatch"

SEVERITY_ERROR = "Error"
SEVERITY_FILTER = "Filter"

WEEKDAY_NAMES = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun",
}
BOOLEAN_STRINGS = {"0", "1", "true", "false", "yes", "no"}


class _Range(NamedTuple):
    lo: float
    hi: float


def _parse_value_list(raw: str) -> tuple[set[str], list[_Range]]:
    """Parse a comma-separated constraint list into literal values + numeric ranges."""
    literals: set[str] = set()
    ranges: list[_Range] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token and token.count("-") == 1:
            a, b = token.split("-", 1)
            try:
                lo, hi = float(a), float(b)
                if lo <= hi:
                    ranges.append(_Range(lo, hi))
                    continue
            except ValueError:
                pass
        literals.add(token)
    return literals, ranges


def _value_in_list(value: str, literals: set[str], ranges: list[_Range]) -> bool:
    if value in literals:
        return True
    if ranges:
        try:
            n = float(value)
        except ValueError:
            return False
        return any(r.lo <= n <= r.hi for r in ranges)
    return False


def _is_whole_number(v: str) -> bool:
    if not v:
        return False
    v = v.strip()
    if v.startswith(("-", "+")):
        v = v[1:]
    return v.isdigit()


def _to_int(v: str) -> int | None:
    try:
        return int(v)
    except ValueError:
        return None


def _is_number(v: str) -> bool:
    try:
        float(v)
        return True
    except ValueError:
        return False


def _to_float(v: str) -> float | None:
    try:
        return float(v)
    except ValueError:
        return None


def _validate_date(value: str, fmt: str) -> str | None:
    """Return None when valid; otherwise a human-readable error suffix."""
    fmt = (fmt or "MM/DD/YYYY").upper()
    # Build a map of each fmt token to the slice in the value
    tokens = []  # list of (token, length)
    current = ""
    i = 0
    while i < len(fmt):
        ch = fmt[i]
        if ch in ("Y", "M", "D"):
            j = i
            while j < len(fmt) and fmt[j] == ch:
                j += 1
            tokens.append((ch, j - i))
            i = j
        else:
            tokens.append(("sep", ch))
            i += 1

    # Walk value in parallel
    pos = 0
    parts: dict[str, str] = {}
    for kind, info in tokens:
        if kind == "sep":
            if pos >= len(value) or value[pos] != info:
                return f"expected separator {info!r}"
            pos += 1
        else:
            width = info
            chunk = value[pos : pos + width]
            if len(chunk) != width or not chunk.isdigit():
                return f"expected {width}-digit {kind}"
            parts[kind] = chunk
            pos += width
    if pos != len(value):
        return "trailing characters"

    if "M" in parts:
        m = int(parts["M"])
        if not 1 <= m <= 12:
            return f"month {m} out of range"
    if "D" in parts:
        d = int(parts["D"])
        if not 1 <= d <= 31:
            return f"day {d} out of range"
    if "Y" in parts:
        y = int(parts["Y"])
        if y < 1900 or y > 2999:
            return f"year {y} out of range"
    return None


class ImportVerifyService:
    """Runs template checks against a file in the customer's upload directory."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _upload_dir(self, customer_id: str) -> str | None:
        result = await self.session.execute(
            select(
                CustomerConfiguration.home_directory,
                CustomerConfiguration.upload_directory,
            ).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        row = result.one_or_none()
        if not row:
            return None
        home, upload = row
        if not upload:
            return None
        return (home or "") + upload

    async def _get_template(self, template_id: str) -> ImportTemplate | None:
        result = await self.session.execute(
            select(ImportTemplate).where(
                ImportTemplate.id == template_id,
                ImportTemplate.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def verify(
        self, customer_id: str, template_id: str, filename: str
    ) -> VerificationResponse:
        directory = await self._upload_dir(customer_id)
        if not directory:
            raise ValueError("No upload_directory configured for this customer.")
        template = await self._get_template(template_id)
        if not template:
            raise ValueError("Template not found.")

        safe_name = Path(filename).name
        if not safe_name or safe_name != filename:
            raise ValueError("Invalid filename.")
        path = Path(directory) / safe_name
        if not path.is_file():
            raise ValueError(f"File {safe_name!r} does not exist in {directory!r}.")

        try:
            text = path.read_text(errors="replace")
        except OSError as e:
            raise ValueError(f"Could not read file: {e}") from e

        lines = text.splitlines()
        header = template.header_lines or 0
        footer = template.footer_lines or 0
        if footer:
            data_lines = lines[header : len(lines) - footer]
        else:
            data_lines = lines[header:]

        sep = template.separator or ","
        elements = sorted(template.elements, key=lambda e: e.element_index)

        issues: list[VerificationIssue] = []
        group_counts: dict[str, dict] = {}
        captured = 0

        def record(line_no: int, severity: str, group: str, message: str) -> None:
            nonlocal captured
            g = group_counts.setdefault(group, {"count": 0, "severity": severity})
            g["count"] += 1
            if captured < MAX_ISSUES_RETURNED:
                issues.append(
                    VerificationIssue(
                        line_number=line_no,
                        severity=severity,
                        message_group=group,
                        message=message,
                    )
                )
                captured += 1

        for idx, raw in enumerate(data_lines):
            line_no = idx + header + 1  # 1-based in the original file
            cols = raw.split(sep)

            if len(cols) != len(elements):
                record(
                    line_no,
                    SEVERITY_ERROR,
                    GROUP_COLUMN_COUNT,
                    f"Expected {len(elements)} column(s), got {len(cols)}.",
                )
                continue

            for col_idx, elem in enumerate(elements):
                val = cols[col_idx]
                if elem.strip:
                    val = val.strip(elem.strip)
                else:
                    val = val.strip()

                _check_element(elem, val, line_no, record)

        groups = [
            VerificationGroup(
                name=name,
                severity=info["severity"],
                count=info["count"],
            )
            for name, info in sorted(group_counts.items(), key=lambda kv: kv[0])
        ]
        error_count = sum(info["count"] for info in group_counts.values() if info["severity"] == SEVERITY_ERROR)
        filter_count = sum(info["count"] for info in group_counts.values() if info["severity"] == SEVERITY_FILTER)

        return VerificationResponse(
            filename=safe_name,
            total_lines=len(data_lines),
            error_count=error_count,
            filter_count=filter_count,
            issues_truncated=captured < sum(g.count for g in groups),
            groups=groups,
            issues=issues,
        )


def _check_element(
    elem: ImportTemplateElement,
    val: str,
    line_no: int,
    record,
) -> None:
    """Run all checks for one element's value. `record` is the closure callback."""
    name = elem.name or elem.type

    if elem.type == "unused":
        return

    # Normalise NULL to empty so all downstream checks treat them identically.
    if val.upper() == "NULL":
        val = ""

    # Allow/Disallow lists short-circuit early — they are row-level filters,
    # not per-element errors in the user's spec.
    if elem.allow:
        literals, ranges = _parse_value_list(elem.allow)
        if literals or ranges:
            if not _value_in_list(val, literals, ranges):
                record(
                    line_no,
                    SEVERITY_FILTER,
                    GROUP_NOT_ALLOWED,
                    f"{name!r}: value {val!r} not in allowed list.",
                )
                return
    if elem.disallow:
        literals, ranges = _parse_value_list(elem.disallow)
        if literals or ranges:
            if _value_in_list(val, literals, ranges):
                record(
                    line_no,
                    SEVERITY_FILTER,
                    GROUP_DISALLOWED,
                    f"{name!r}: value {val!r} is disallowed.",
                )
                return

    # Empty check
    if val == "":
        if not elem.allow_empty:
            record(
                line_no,
                SEVERITY_ERROR,
                f"{name} Errors",
                f"{name!r}: value is empty.",
            )
        # Either allowed-empty or already flagged — no further checks.
        return

    # Type / value_type
    if elem.value_type == "number" and not _is_number(val):
        record(
            line_no,
            SEVERITY_ERROR,
            f"{name} Errors",
            f"{name!r}: value {val!r} is not a number.",
        )
        return

    # Element-type-specific rules
    group = f"{name} Errors"
    etype = elem.type

    if etype == "account_id":
        if len(val) > 32:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: exceeds 32 characters.")
        return

    if etype in ("date", "start_date", "end_date"):
        err = _validate_date(val, elem.date_format or "MM/DD/YYYY")
        if err:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {err} in {val!r}.")
        return

    max_v = elem.maximum_value or 0

    if etype in ("quantity", "sold_net", "sold_scan"):
        n = _to_int(val)
        if n is None or not _is_whole_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a whole number.")
            return
        if n <= 0:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {n} must be greater than 0.")
            return
        if max_v and n > max_v:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {n} exceeds maximum {max_v}.")
            return

    elif etype in ("quantity_adjustment", "return"):
        n = _to_int(val)
        if n is None or not _is_whole_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a whole number.")
            return
        if max_v and abs(n) > max_v:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {n} exceeds maximum {max_v}.")
            return

    elif etype in ("shrinkage",):
        n = _to_int(val)
        if n is None or not _is_whole_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a whole number.")
            return
        if max_v and abs(n) > max_v:
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {n} exceeds maximum {max_v}.")
            return

    elif etype in ("cost", "profit", "revenue"):
        if not _is_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a number.")
            return

    elif etype == "weekday":
        if val.lower() in WEEKDAY_NAMES:
            pass
        else:
            n = _to_int(val)
            if n is None or not 1 <= n <= 7:
                record(
                    line_no,
                    SEVERITY_ERROR,
                    group,
                    f"{name!r}: {val!r} must be 1-7 or a weekday name.",
                )
                return

    elif etype in ("fixed_quantity", "minimum_quantity", "maximum_quantity"):
        if not _is_whole_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a whole number.")
            return

    elif etype in ("weekday_fixed", "weekday_minimum"):
        if not _is_whole_number(val):
            record(line_no, SEVERITY_ERROR, group, f"{name!r}: {val!r} is not a whole number.")
            return

    elif etype in ("open", "weekday_open"):
        if val.lower() not in BOOLEAN_STRINGS:
            record(
                line_no,
                SEVERITY_ERROR,
                group,
                f"{name!r}: {val!r} must be 1/0, true/false, or yes/no.",
            )
            return

    # Sign constraints — applied after numeric parsing succeeded.
    if _is_number(val):
        n_f = _to_float(val)
        if n_f is not None:
            if not elem.allow_positive and n_f > 0 and etype not in ("unused",):
                # allow_positive defaults to False; only flag if the element's
                # semantic says values shouldn't be positive. To avoid flooding
                # with false positives for fields where positive values are
                # always legitimate (quantity, cost, etc.), restrict this check
                # to elements where the user has explicitly opted in via the
                # `return` / `quantity_adjustment` config dialogs.
                if etype == "return":
                    record(
                        line_no,
                        SEVERITY_ERROR,
                        group,
                        f"{name!r}: positive values are not allowed.",
                    )
            if not elem.allow_negative and n_f < 0:
                # Same reasoning: restrict to fields where the UI exposes this toggle.
                if etype in ("return", "quantity_adjustment"):
                    record(
                        line_no,
                        SEVERITY_ERROR,
                        group,
                        f"{name!r}: negative values are not allowed.",
                    )


# Ensure Iterable stays imported for typing purposes in case we extend later.
_ = Iterable
