"""Insert dates for all predefined PADs from 2000 to 2040.

Revision ID: 043
Revises: 042
Create Date: 2026-03-10

"""

from calendar import monthcalendar
from datetime import date, timedelta
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

YEARS = range(2000, 2041)


# ── Date calculation helpers ──────────────────────────────────────────────────

def easter(year: int) -> date:
    """Anonymous Gregorian Easter algorithm."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the nth occurrence of weekday (0=Mon … 6=Sun) in a month."""
    count = 0
    for week in monthcalendar(year, month):
        if week[weekday] != 0:
            count += 1
            if count == n:
                return date(year, month, week[weekday])
    raise ValueError(f"No {n}th weekday={weekday} in {year}-{month:02d}")


def last_weekday(year: int, month: int, weekday: int) -> date:
    """Return the last occurrence of weekday (0=Mon … 6=Sun) in a month."""
    for week in reversed(monthcalendar(year, month)):
        if week[weekday] != 0:
            return date(year, month, week[weekday])
    raise ValueError(f"No weekday={weekday} in {year}-{month:02d}")


def victoria_day(year: int) -> date:
    """Last Monday on or before May 25."""
    may25 = date(year, 5, 25)
    return may25 - timedelta(days=may25.weekday())  # weekday(): 0=Mon


# ── Date generators per PAD name ──────────────────────────────────────────────
# Each entry maps a PAD name to a function year -> list[date]

PAD_DATE_GENERATORS: dict[str, object] = {
    # ── International ────────────────────────────────────────────────────────
    "Christmas 24":               lambda y: [date(y, 12, 24)],
    "Christmas 25":               lambda y: [date(y, 12, 25)],
    "NY 31.12":                   lambda y: [date(y, 12, 31)],
    "NY 01.01":                   lambda y: [date(y,  1,  1)],
    "NY 01.02":                   lambda y: [date(y,  1,  2)],
    "Christmas Day":              lambda y: [date(y, 12, 25)],
    "Good Friday":                lambda y: [easter(y) - timedelta(days=2)],
    "Holy Saturday":              lambda y: [easter(y) - timedelta(days=1)],
    "Easter Sunday":              lambda y: [easter(y)],
    "Easter Monday":              lambda y: [easter(y) + timedelta(days=1)],
    # ── USA ──────────────────────────────────────────────────────────────────
    "Thanksgiving (US)":          lambda y: [nth_weekday(y, 11, 3, 4)],   # 4th Thu of Nov
    "Labor Day (US)":             lambda y: [nth_weekday(y,  9, 0, 1)],   # 1st Mon of Sep
    "Independence Day":           lambda y: [date(y,  7,  4)],
    "Presidents Day":             lambda y: [nth_weekday(y,  2, 0, 3)],   # 3rd Mon of Feb
    "Cesar Chavez Day":           lambda y: [date(y,  3, 31)],
    "Memorial Day":               lambda y: [last_weekday(y, 5, 0)],      # last Mon of May
    "Columbus Day":               lambda y: [nth_weekday(y, 10, 0, 2)],   # 2nd Mon of Oct
    "Martin Luther King Jr. Day": lambda y: [nth_weekday(y,  1, 0, 3)],   # 3rd Mon of Jan
    # ── Canada ───────────────────────────────────────────────────────────────
    "Family Day (CA)":            lambda y: [nth_weekday(y,  2, 0, 3)],   # 3rd Mon of Feb
    "Victoria Day":               lambda y: [victoria_day(y)],
    "Canada Day":                 lambda y: [date(y,  7,  1)],
    "Civic Holiday":              lambda y: [nth_weekday(y,  8, 0, 1)],   # 1st Mon of Aug
    "Thanksgiving (CA)":          lambda y: [nth_weekday(y, 10, 0, 2)],   # 2nd Mon of Oct
    "Boxing Day (CA)":            lambda y: [date(y, 12, 26)],
}


def upgrade() -> None:
    conn = op.get_bind()

    # Fetch pad name → id mapping
    rows = conn.execute(
        sa.text("SELECT id, name FROM predefined_pad WHERE active = true")
    ).fetchall()
    pad_ids: dict[str, str] = {row.name: row.id for row in rows}

    # Build all date rows
    insert_rows: list[dict] = []
    for pad_name, gen in PAD_DATE_GENERATORS.items():
        pad_id = pad_ids.get(pad_name)
        if not pad_id:
            print(f"  WARNING: predefined_pad '{pad_name}' not found — skipping")
            continue
        for year in YEARS:
            for d in gen(year):  # type: ignore[operator]
                insert_rows.append({"predefined_pad_id": pad_id, "date": d})

    print(f"  Inserting {len(insert_rows)} predefined_pad_date rows…")
    conn.execute(
        sa.text(
            "INSERT INTO predefined_pad_date "
            "(id, predefined_pad_id, date, active, created_at, updated_at) "
            "VALUES (gen_random_uuid(), :predefined_pad_id, :date, true, now(), now())"
        ),
        insert_rows,
    )
    print(f"  Done.")


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM predefined_pad_date WHERE predefined_pad_id IN "
            "(SELECT id FROM predefined_pad)"
        )
    )
