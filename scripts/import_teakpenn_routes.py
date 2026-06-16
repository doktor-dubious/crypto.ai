"""Import Teak Penn route assignments into outlet_info across 3 customers.

Targets:
  - 10ff7211-d806-4fb0-8f13-35103d401d4d (Teak Penn INC)
  - 9e58cda9-0467-4332-a119-0753ac18c995 (Teak Penn DNDF)
  - 35642f6a-9e82-4399-9052-8724b7e9d66c (Teak Penn INCS - Weekend)

Each (ext_id, route) is applied to every customer that has an active outlet
with that ext_id. Same as the Philly import: idempotent (updates existing
key="route" rows in place), drops `auto_generated=1` phantoms when an ext_id
is ambiguous within a customer.

Run with --commit to actually write. Default is dry-run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter, defaultdict

from sqlalchemy import select

from crypto_ai.database.connection import async_session_factory
from crypto_ai.database.models.customer import Customer
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_info import OutletInfo

CUSTOMERS: list[tuple[str, str]] = [
    ("10ff7211-d806-4fb0-8f13-35103d401d4d", "Teak Penn (INC)"),
    ("9e58cda9-0467-4332-a119-0753ac18c995", "Teak Penn (DNDF)"),
    ("35642f6a-9e82-4399-9052-8724b7e9d66c", "Teak Penn (INCS - Weekend)"),
]
INFO_KEY = "route"

# TSV-style data preserved verbatim from the source request.
ROUTE_TSV = """
616 300
1800 300
118 302
1095 302
1263 302
1287 302
1407 302
2159 302
2170 302
2173 302
2178 302
2179 302
2182 302
2903 302
3729 302
4050 302
4051 302
4054 302
4055 302
4368 302
5171 302
5177 302
5406 302
5407 302
5408 302
5409 302
5410 302
5411 302
5487 302
5757 302
5758 302
5760 302
5803 302
5813 302
5814 302
5820 302
5890 302
5897 302
5900 302
5906 302
5907 302
5924 302
5929 302
5996 302
6242 302
6931 302
7381 302
7404 302
7406 302
7408 302
7409 302
7410 302
7411 302
7412 302
7413 302
7414 302
7415 302
7420 302
7430 302
7446 302
7737 302
8434 302
8551 302
8556 302
8619 302
89 308
146 308
171 308
2158 308
2168 308
2177 308
2183 308
2199 308
3136 308
4052 308
4323 308
5188 308
5401 308
5747 308
5761 308
5765 308
5893 308
5896 308
5904 308
5913 308
5918 308
6002 308
6043 308
6721 308
6963 308
6999 308
7009 308
7011 308
7221 308
7645 308
7687 308
7727 308
2081 310
2147 310
2167 310
2192 310
2195 310
2200 310
4419 310
5723 310
5730 310
5762 310
5764 310
5917 310
5922 310
6014 310
6839 310
7018 310
7021 310
7033 310
7036 310
7039 310
7041 310
7042 310
7183 310
7287 310
7351 310
7532 310
7554 310
7555 310
7557 310
7570 310
7662 310
7704 310
7819 310
2184 312
2198 312
2214 312
2979 312
4369 312
5298 312
5752 312
5816 312
5925 312
5928 312
5937 312
6519 312
6573 312
6936 312
6938 312
6941 312
6942 312
6967 312
6968 312
6971 312
6976 312
6982 312
6984 312
6987 312
6991 312
7016 312
7047 312
7389 312
7507 312
7529 312
7538 312
7546 312
7605 312
7612 312
7669 312
7670 312
7686 312
7706 312
7768 312
72 314
899 314
1274 314
1317 314
1337 314
1374 314
1405 314
2180 314
2185 314
2193 314
2201 314
3183 314
4361 314
4374 314
4396 314
4407 314
4410 314
5166 314
5172 314
5571 314
5717 314
5734 314
5749 314
5784 314
5795 314
5939 314
5940 314
5942 314
5949 314
5997 314
6132 314
6714 314
6720 314
6917 314
7346 314
7564 314
7607 314
77 316
78 316
79 316
90 316
115 316
137 316
1567 316
2163 316
2165 316
2188 316
2194 316
3545 316
4317 316
4359 316
4395 316
4420 316
5155 316
5159 316
5309 316
5412 316
5729 316
5737 316
5748 316
5755 316
5788 316
5800 316
5818 316
5888 316
5912 316
5920 316
5923 316
5933 316
6011 316
6012 316
6887 316
7332 316
7534 316
7535 316
7560 316
7565 316
7624 316
7625 316
7650 316
7661 316
7665 316
7708 316
7808 316
7816 316
8273 316
8288 316
4376 324
4574 324
5173 324
5742 324
5746 324
5782 324
5812 324
5909 324
5930 324
7537 324
7550 324
7556 324
7567 324
7571 324
7608 324
7613 324
8 328
135 328
633 328
2016 328
3471 328
3761 328
4387 328
4388 328
4391 328
4418 328
5733 328
5745 328
5750 328
5772 328
5776 328
5945 328
5951 328
7285 328
7453 328
7723 328
7887 328
7913 328
8071 328
8203 328
8211 328
8408 328
83 330
84 330
87 330
151 330
153 330
157 330
532 330
726 330
2197 330
2664 330
4372 330
4758 330
5738 330
5756 330
5759 330
5889 330
5950 330
6757 330
7103 330
7105 330
7113 330
7114 330
7115 330
7116 330
7117 330
7130 330
7135 330
7136 330
7193 330
7397 330
7456 330
7499 330
7601 330
7617 330
82 332
86 332
110 332
142 332
252 332
2160 332
2203 332
4401 332
4404 332
5727 332
5741 332
5767 332
5778 332
5789 332
5806 332
5807 332
5811 332
5934 332
5935 332
6256 332
7054 332
7056 332
7057 332
7061 332
7062 332
7072 332
7083 332
7084 332
7085 332
7087 332
7088 332
7094 332
7095 332
7096 332
7098 332
7099 332
7100 332
7101 332
7223 332
7502 332
7559 332
7654 332
7664 332
154 334
2181 334
2191 334
4324 334
4360 334
4362 334
4365 334
4405 334
5158 334
5169 334
5194 334
5731 334
5751 334
5753 334
5773 334
5774 334
5797 334
5799 334
5804 334
5810 334
5891 334
5895 334
5902 334
5905 334
5910 334
5914 334
5916 334
5919 334
5926 334
5927 334
5941 334
5946 334
7360 334
7366 334
7562 334
8020 334
8032 334
8173 334
8221 334
8569 334
8570 334
8571 334
8572 334
8607 334
2161 336
2186 336
4367 336
5744 336
5781 336
5903 336
6365 336
6759 336
6761 336
6762 336
6763 336
6764 336
7334 336
7345 336
7566 336
7646 336
7683 336
7689 336
7778 336
7854 336
7877 336
8300 336
2500 344
3482 344
6192 344
2499 346
3571 346
6217 346
7457 346
68 348
125 348
129 348
130 348
1049 348
1259 348
1269 348
1275 348
1292 348
1298 348
1322 348
1334 348
2162 348
2174 348
2176 348
2325 348
3211 348
3417 348
3542 348
4370 348
4392 348
4409 348
5390 348
5726 348
5763 348
5771 348
7283 348
7692 348
7699 348
7700 348
7774 348
7845 348
8615 348
4366 356
4402 356
4408 356
4545 356
5295 356
5736 356
7558 356
8262 356
73 362
74 362
1046 362
1282 362
1284 362
1306 362
2169 362
2202 362
2642 362
4320 362
4390 362
4550 362
5507 362
5552 362
5556 362
5716 362
5725 362
5901 362
5908 362
5921 362
8301 362
177 366
1265 366
2065 366
2190 366
4406 366
5163 366
5720 366
5721 366
5732 366
5739 366
5787 366
5802 366
5805 366
5817 366
5932 366
70 368
133 368
1277 368
1346 368
1513 368
2265 368
4321 368
4322 368
4377 368
4383 368
4544 368
4552 368
5555 368
5770 368
5796 368
5801 368
5819 368
5892 368
5911 368
5915 368
5938 368
6230 368
7660 368
7685 368
7731 368
3634 370
4403 370
5769 370
5779 370
5808 370
5821 370
7785 370
7792 370
7793 370
7794 370
7797 370
7800 370
7804 370
8618 370
7779 375
7780 375
7782 375
7783 375
7784 375
7787 375
7788 375
7791 375
7795 375
7796 375
7799 375
7806 375
8260 375
7137 377
7155 377
85 997
127 311N
6894 311N
7960 311N
7961 311N
7962 311N
7974 311N
7987 311N
7991 311N
8005 311N
8006 311N
8007 311N
8008 311N
8011 311N
8013 311N
8017 311N
8019 311N
8022 311N
8023 311N
8075 311N
8113 311N
8118 311N
8120 311N
8134 311N
8159 311N
8160 311N
8161 311N
8163 311N
8169 311N
8188 311N
8189 311N
8201 311N
8202 311N
8216 311N
8217 311N
8263 311N
8268 311N
8275 311N
8317 311N
5193 313N
7953 313N
7957 313N
7964 313N
7966 313N
7967 313N
7968 313N
7969 313N
7970 313N
7971 313N
7976 313N
7986 313N
8009 313N
8010 313N
8012 313N
8018 313N
8024 313N
8025 313N
8027 313N
8065 313N
8076 313N
8083 313N
8108 313N
8109 313N
8130 313N
8156 313N
8164 313N
8165 313N
8166 313N
8167 313N
8171 313N
8177 313N
8184 313N
8186 313N
8194 313N
8195 313N
8198 313N
8199 313N
8200 313N
8208 313N
8229 313N
8230 313N
8261 313N
7950 315N
7954 315N
7955 315N
7958 315N
7959 315N
7963 315N
7973 315N
7977 315N
7984 315N
7985 315N
7989 315N
8014 315N
8015 315N
8016 315N
8021 315N
8026 315N
8029 315N
8030 315N
8059 315N
8060 315N
8064 315N
8084 315N
8158 315N
8168 315N
8170 315N
8172 315N
8181 315N
8190 315N
8204 315N
8219 315N
8220 315N
8560 315N
"""


def parse_assignments() -> dict[str, str]:
    """Returns {ext_id: route} from the embedded TSV."""
    out: dict[str, str] = {}
    dupes: list[tuple[str, str, str]] = []
    for line in ROUTE_TSV.strip().splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        ext_id, route = parts[0], parts[1]
        if ext_id in out and out[ext_id] != route:
            dupes.append((ext_id, out[ext_id], route))
        out[ext_id] = route
    if dupes:
        raise ValueError(
            "Duplicate ext_ids with different routes in input: "
            + str(dupes[:5])
        )
    return out


async def plan_for_customer(
    session,
    customer_id: str,
    customer_name: str,
    by_ext_id: dict[str, str],
) -> dict:
    """Resolve ext_ids → outlets for one customer; build insert/update plan."""
    # Confirm customer exists.
    result = await session.execute(
        select(Customer.name).where(
            Customer.id == customer_id, Customer.active.is_(True),
        )
    )
    found = result.scalar_one_or_none()
    if not found:
        return {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "error": "customer not found",
            "to_insert": [], "to_update": [],
            "missing": list(by_ext_id.keys()),
            "ambiguous": {},
            "unchanged": 0,
        }

    ext_ids = list(by_ext_id.keys())
    result = await session.execute(
        select(Outlet.id, Outlet.ext_id, Outlet.name).where(
            Outlet.customer_id == customer_id,
            Outlet.ext_id.in_(ext_ids),
            Outlet.active.is_(True),
        )
    )
    rows = result.all()
    outlets_by_ext: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for outlet_id, ext_id, name in rows:
        outlets_by_ext[ext_id].append((outlet_id, name))

    # Drop auto_generated phantoms from ambiguous ext_ids.
    ambiguous_ext_ids = [e for e, v in outlets_by_ext.items() if len(v) > 1]
    auto_gen_ids: set[str] = set()
    if ambiguous_ext_ids:
        all_candidate_ids = [
            oid for e in ambiguous_ext_ids for oid, _ in outlets_by_ext[e]
        ]
        ag_result = await session.execute(
            select(OutletInfo.outlet_id).where(
                OutletInfo.outlet_id.in_(all_candidate_ids),
                OutletInfo.key == "auto_generated",
                OutletInfo.value == "1",
                OutletInfo.active.is_(True),
            )
        )
        auto_gen_ids = {row[0] for row in ag_result.all()}
        for ext_id in ambiguous_ext_ids:
            filtered = [
                (oid, n) for oid, n in outlets_by_ext[ext_id]
                if oid not in auto_gen_ids
            ]
            if filtered:
                outlets_by_ext[ext_id] = filtered

    missing = [e for e in ext_ids if e not in outlets_by_ext]
    ambiguous = {
        e: outlets_by_ext[e] for e in outlets_by_ext
        if len(outlets_by_ext[e]) > 1
    }

    plan: list[tuple[str, str, str]] = []  # (outlet_id, ext_id, route)
    for ext_id, candidates in outlets_by_ext.items():
        if len(candidates) > 1:
            continue
        outlet_id, _ = candidates[0]
        plan.append((outlet_id, ext_id, by_ext_id[ext_id]))

    plan_outlet_ids = [oid for oid, _, _ in plan]
    if plan_outlet_ids:
        existing_result = await session.execute(
            select(OutletInfo).where(
                OutletInfo.outlet_id.in_(plan_outlet_ids),
                OutletInfo.key == INFO_KEY,
                OutletInfo.active.is_(True),
            )
        )
        existing_by_outlet: dict[str, OutletInfo] = {
            r.outlet_id: r for r in existing_result.scalars().all()
        }
    else:
        existing_by_outlet = {}

    to_insert: list[tuple[str, str, str]] = []
    to_update: list[tuple[OutletInfo, str, str]] = []
    unchanged = 0
    for outlet_id, ext_id, route in plan:
        existing = existing_by_outlet.get(outlet_id)
        if existing is None:
            to_insert.append((outlet_id, ext_id, route))
        elif existing.value != route:
            to_update.append((existing, existing.value or "", route))
        else:
            unchanged += 1

    return {
        "customer_id": customer_id,
        "customer_name": f"{found} ({customer_name})",
        "to_insert": to_insert,
        "to_update": to_update,
        "missing": missing,
        "ambiguous": ambiguous,
        "unchanged": unchanged,
    }


async def main(commit: bool) -> int:
    by_ext_id = parse_assignments()
    route_counts = Counter(by_ext_id.values())
    print(f"Input: {sum(route_counts.values())} (ext_id, route) pairs, "
          f"{len(by_ext_id)} unique ext_ids, "
          f"{len(route_counts)} distinct routes")
    print(
        "Route distribution: "
        + ", ".join(
            f"{r}={c}" for r, c in sorted(route_counts.items())
        )
    )

    async with async_session_factory() as session:
        plans = []
        for cid, label in CUSTOMERS:
            print(f"\n=== {label} ({cid}) ===")
            plan = await plan_for_customer(session, cid, label, by_ext_id)
            plans.append(plan)
            if "error" in plan:
                print(f"  ERROR: {plan['error']}")
                continue
            print(f"  customer: {plan['customer_name']}")
            print(f"  matched outlets: {len(plan['to_insert']) + len(plan['to_update']) + plan['unchanged']}")
            print(f"  insert : {len(plan['to_insert'])}")
            print(f"  update : {len(plan['to_update'])}")
            print(f"  unchanged: {plan['unchanged']}")
            print(f"  missing ext_ids: {len(plan['missing'])}")
            if plan["ambiguous"]:
                print(f"  ambiguous (multi-outlet) ext_ids: {len(plan['ambiguous'])}")
                for ext_id, cands in list(plan["ambiguous"].items())[:5]:
                    names = ", ".join(n for _, n in cands)
                    print(f"    {ext_id}: {names}")
            if plan["to_update"]:
                print("  sample updates:")
                for row, old, new in plan["to_update"][:5]:
                    print(f"    outlet_id={row.outlet_id} '{old}' -> '{new}'")

        # ext_ids not matched by ANY customer (in the strong sense)
        any_matched_ext_ids: set[str] = set()
        for plan in plans:
            for _, ext_id, _ in plan.get("to_insert", []):
                any_matched_ext_ids.add(ext_id)
            for _, _, _ in []:
                pass  # to_update entries don't carry ext_id directly
            # Recover ext_id for updates via outlet_info row's ext_id? we don't have it
            # but we can mark anything not in `missing` for this customer as matched.
            for ext_id in by_ext_id:
                if ext_id not in plan.get("missing", []):
                    any_matched_ext_ids.add(ext_id)
        unmatched_everywhere = [
            e for e in by_ext_id if e not in any_matched_ext_ids
        ]
        if unmatched_everywhere:
            print(
                f"\nNot matched in ANY of the 3 customers "
                f"({len(unmatched_everywhere)} ext_ids):"
            )
            print(
                "  " + ", ".join(unmatched_everywhere[:30])
                + (" ..." if len(unmatched_everywhere) > 30 else "")
            )

        if not commit:
            print("\nDRY RUN — no changes written. Re-run with --commit.")
            return 0

        total_inserts = 0
        total_updates = 0
        for plan in plans:
            if "error" in plan:
                continue
            for outlet_id, _ext_id, route in plan["to_insert"]:
                session.add(OutletInfo(
                    outlet_id=outlet_id, key=INFO_KEY, value=route,
                ))
                total_inserts += 1
            for row, _old, new in plan["to_update"]:
                row.value = new
                total_updates += 1
        await session.commit()
        print(f"\nCommitted: {total_inserts} inserted, {total_updates} updated across "
              f"{len([p for p in plans if 'error' not in p])} customers.")
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit", action="store_true",
        help="Actually write changes (default is dry-run).",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit)))
