"""Import Philadelphia Inquirer route assignments into outlet_info.

Customer: ef063dd2-f7f1-4118-8738-2e5e055c7133 (Philadelphia Inquirer)
Writes one outlet_info row per outlet with key="route", value=<route>.

Idempotent: if a row with key="route" already exists for an outlet, it is
updated (if the value differs) instead of inserting a duplicate.

Run with --commit to actually write. Without it, the script is a dry-run.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter, defaultdict

from sqlalchemy import select

from crypto_ai.database.connection import async_session_factory
from crypto_ai.database.models.outlet import Outlet
from crypto_ai.database.models.outlet_info import OutletInfo

CUSTOMER_ID = "ef063dd2-f7f1-4118-8738-2e5e055c7133"
INFO_KEY = "route"

# (ext_id, route) pairs supplied by the user.
ROUTE_ASSIGNMENTS: list[tuple[str, str]] = [
    ("483949", "101"), ("483952", "101"), ("487737", "101"), ("487744", "101"),
    ("487748", "101"), ("487749", "101"), ("487752", "101"), ("487756", "101"),
    ("487771", "101"), ("569937", "101"), ("616798", "101"), ("626950", "101"),
    ("752250", "101"), ("752334", "101"), ("752350", "101"), ("752355", "101"),
    ("752366", "101"), ("752387", "101"), ("752391", "101"), ("769055", "101"),
    ("775698", "101"), ("784614", "101"), ("804498", "101"), ("819402", "101"),
    ("862168", "101"), ("909360", "101"), ("921604", "101"), ("978686", "101"),
    ("997113", "101"), ("1011615", "101"), ("1015604", "101"), ("1021304", "101"),
    ("481728", "201"), ("481739", "201"), ("481764", "201"), ("481774", "201"),
    ("625699", "201"), ("752412", "201"), ("753943", "201"), ("816740", "201"),
    ("860912", "201"), ("919560", "201"), ("936779", "201"), ("987223", "201"),
    ("483837", "301"), ("483842", "301"), ("483852", "301"), ("483865", "301"),
    ("483867", "301"), ("483869", "301"), ("483956", "301"), ("483959", "301"),
    ("569932", "301"), ("569943", "301"), ("752276", "301"), ("752420", "301"),
    ("804497", "301"), ("816812", "301"),
    ("483970", "401"), ("745595", "401"), ("752225", "401"), ("752389", "401"),
    ("761204", "401"), ("780262", "401"), ("909641", "401"), ("938783", "401"),
    ("976049", "401"), ("1005966", "401"),
    ("483888", "601"), ("483976", "601"), ("483987", "601"), ("483992", "601"),
    ("484007", "601"), ("484037", "601"), ("484050", "601"), ("484060", "601"),
    ("569930", "601"), ("569931", "601"), ("628267", "601"), ("736831", "601"),
    ("752273", "601"), ("752404", "601"), ("782669", "601"), ("852462", "601"),
    ("915305", "601"), ("948482", "601"), ("956488", "601"), ("960888", "601"),
    ("971835", "601"), ("973186", "601"), ("983898", "601"), ("1005967", "601"),
    ("1014743", "601"),
    ("481643", "701"), ("481717", "701"), ("481837", "701"), ("569814", "701"),
    ("644717", "701"), ("645093", "701"), ("687362", "701"), ("707200", "701"),
    ("747907", "701"), ("752239", "701"), ("752244", "701"), ("752248", "701"),
    ("752340", "701"), ("752369", "701"), ("752375", "701"), ("783560", "701"),
    ("798312", "701"), ("807958", "701"), ("816314", "701"), ("832014", "701"),
    ("845477", "701"), ("888455", "701"), ("904677", "701"), ("939060", "701"),
    ("949382", "701"), ("979451", "701"), ("980606", "701"), ("982132", "701"),
    ("986326", "701"), ("987549", "701"),
    ("484067", "801"), ("487762", "801"), ("487764", "801"), ("487772", "801"),
    ("487783", "801"), ("487797", "801"), ("487799", "801"), ("487805", "801"),
    ("487808", "801"), ("487813", "801"), ("569806", "801"), ("618457", "801"),
    ("745570", "801"), ("752277", "801"), ("752303", "801"), ("752347", "801"),
    ("752390", "801"), ("752411", "801"), ("769624", "801"), ("782665", "801"),
    ("796281", "801"), ("850722", "801"), ("860918", "801"), ("909352", "801"),
    ("909482", "801"), ("909521", "801"), ("970765", "801"), ("977519", "801"),
    ("997118", "801"), ("1005965", "801"),
    ("481516", "901"), ("481551", "901"), ("481552", "901"), ("481554", "901"),
    ("481622", "901"), ("481807", "901"), ("569809", "901"), ("644969", "901"),
    ("719586", "901"), ("752256", "901"), ("752269", "901"), ("752301", "901"),
    ("752414", "901"), ("752415", "901"), ("794207", "901"), ("796424", "901"),
    ("816792", "901"), ("854359", "901"), ("878992", "901"), ("940104", "901"),
    ("996709", "901"), ("997121", "901"), ("998410", "901"), ("998413", "901"),
    ("1007001", "901"), ("1008466", "901"),
    ("160531", "950"), ("481499", "950"), ("481556", "950"), ("481568", "950"),
    ("481572", "950"), ("481573", "950"), ("481665", "950"), ("483891", "950"),
    ("483897", "950"), ("483899", "950"), ("483908", "950"), ("483924", "950"),
    ("569942", "950"), ("611234", "950"), ("644191", "950"), ("644716", "950"),
    ("645092", "950"), ("729290", "950"), ("740445", "950"), ("741540", "950"),
    ("761199", "950"), ("762241", "950"), ("769622", "950"), ("784276", "950"),
    ("784718", "950"), ("787478", "950"), ("837229", "950"), ("853081", "950"),
    ("866235", "950"), ("909286", "950"), ("909344", "950"), ("909358", "950"),
    ("926619", "950"), ("939739", "950"), ("987488", "950"), ("987548", "950"),
    ("989645", "950"), ("1015526", "950"),
]


async def main(commit: bool) -> int:
    by_ext_id: dict[str, str] = {}
    duplicates: list[tuple[str, str, str]] = []
    for ext_id, route in ROUTE_ASSIGNMENTS:
        if ext_id in by_ext_id and by_ext_id[ext_id] != route:
            duplicates.append((ext_id, by_ext_id[ext_id], route))
        by_ext_id[ext_id] = route

    if duplicates:
        print("ERROR: same ext_id mapped to multiple routes in input:")
        for ext_id, a, b in duplicates:
            print(f"  ext_id={ext_id}: {a} vs {b}")
        return 2

    ext_ids = list(by_ext_id.keys())
    print(f"Input: {len(ROUTE_ASSIGNMENTS)} (ext_id, route) pairs, "
          f"{len(ext_ids)} unique ext_ids")
    route_counts = Counter(by_ext_id.values())
    print("Route distribution: "
          + ", ".join(f"{r}={c}" for r, c in sorted(route_counts.items())))

    async with async_session_factory() as session:
        result = await session.execute(
            select(Outlet.id, Outlet.ext_id, Outlet.name).where(
                Outlet.customer_id == CUSTOMER_ID,
                Outlet.ext_id.in_(ext_ids),
                Outlet.active.is_(True),
            )
        )
        rows = result.all()

        outlets_by_ext: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for outlet_id, ext_id, name in rows:
            outlets_by_ext[ext_id].append((outlet_id, name))

        # When ext_id is ambiguous, drop outlets flagged auto_generated=1.
        # These are placeholder rows created by past imports; the real outlet
        # carries the operational metadata (address, carrier, etc.).
        ambiguous_ext_ids = [
            e for e, v in outlets_by_ext.items() if len(v) > 1
        ]
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
                    (oid, name)
                    for oid, name in outlets_by_ext[ext_id]
                    if oid not in auto_gen_ids
                ]
                if filtered:
                    dropped = len(outlets_by_ext[ext_id]) - len(filtered)
                    if dropped:
                        print(f"  Disambiguated ext_id={ext_id}: dropped "
                              f"{dropped} auto_generated candidate(s)")
                    outlets_by_ext[ext_id] = filtered

        missing = [e for e in ext_ids if e not in outlets_by_ext]
        ambiguous = {e: v for e, v in outlets_by_ext.items() if len(v) > 1}

        print(f"\nResolved {len(outlets_by_ext)} / {len(ext_ids)} ext_ids "
              f"to outlets ({len(missing)} missing, "
              f"{len(ambiguous)} ambiguous)")
        if missing:
            print(f"  Missing ext_ids ({len(missing)}): "
                  f"{', '.join(missing[:20])}"
                  f"{' ...' if len(missing) > 20 else ''}")
        if ambiguous:
            print("  Ambiguous ext_ids (multiple active outlets share "
                  "this ext_id):")
            for ext_id, candidates in list(ambiguous.items())[:10]:
                names = ", ".join(n for _, n in candidates)
                print(f"    {ext_id}: {names}")

        # Build (outlet_id, route) plan, skipping ambiguous.
        plan: list[tuple[str, str, str]] = []  # (outlet_id, ext_id, route)
        for ext_id, candidates in outlets_by_ext.items():
            if len(candidates) > 1:
                continue
            outlet_id, _ = candidates[0]
            plan.append((outlet_id, ext_id, by_ext_id[ext_id]))

        # Look up existing outlet_info rows.
        plan_outlet_ids = [oid for oid, _, _ in plan]
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

        to_insert: list[tuple[str, str, str]] = []
        to_update: list[tuple[OutletInfo, str, str]] = []  # (row, old, new)
        unchanged = 0
        for outlet_id, ext_id, route in plan:
            existing = existing_by_outlet.get(outlet_id)
            if existing is None:
                to_insert.append((outlet_id, ext_id, route))
            elif existing.value != route:
                to_update.append((existing, existing.value or "", route))
            else:
                unchanged += 1

        print(f"\nPlan:")
        print(f"  insert : {len(to_insert)}")
        print(f"  update : {len(to_update)}")
        print(f"  unchanged: {unchanged}")
        if to_update:
            print("  Sample updates:")
            for row, old, new in to_update[:10]:
                print(f"    outlet_id={row.outlet_id} '{old}' -> '{new}'")

        if not commit:
            print("\nDRY RUN — no changes written. Re-run with --commit.")
            return 0

        for outlet_id, _ext_id, route in to_insert:
            session.add(OutletInfo(
                outlet_id=outlet_id, key=INFO_KEY, value=route,
            ))
        for row, _old, new in to_update:
            row.value = new
        await session.commit()
        print(f"\nCommitted: {len(to_insert)} inserted, "
              f"{len(to_update)} updated.")
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit", action="store_true",
        help="Actually write changes (default is dry-run).",
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(commit=args.commit)))
