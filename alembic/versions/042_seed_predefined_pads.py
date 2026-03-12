"""Seed predefined_pad with international and country-specific holidays.

Revision ID: 042
Revises: 041
Create Date: 2026-03-10

"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None

predefined_pad_table = sa.table(
    "predefined_pad",
    sa.column("id", sa.Text),
    sa.column("name", sa.Text),
    sa.column("description", sa.Text),
    sa.column("country", sa.Text),
    sa.column("allow_negative", sa.Boolean),
    sa.column("active", sa.Boolean),
    sa.column("created_at", sa.DateTime),
    sa.column("updated_at", sa.DateTime),
)

PADS = [
    # International (country = None)
    {"name": "Christmas 24",               "description": "Christmas Eve (December 24)",              "country": None},
    {"name": "Christmas 25",               "description": "Christmas Day (December 25)",               "country": None},
    {"name": "NY 31.12",                   "description": "New Year's Eve (December 31)",              "country": None},
    {"name": "NY 01.01",                   "description": "New Year's Day (January 1)",                "country": None},
    {"name": "NY 01.02",                   "description": "Day after New Year (January 2)",            "country": None},
    {"name": "Christmas Day",              "description": "Christmas Day (observed)",                  "country": None},
    {"name": "Good Friday",                "description": "Easter Friday (Good Friday)",               "country": None},
    {"name": "Holy Saturday",              "description": "Easter Saturday (Holy Saturday)",           "country": None},
    {"name": "Easter Sunday",              "description": "Easter Sunday",                             "country": None},
    {"name": "Easter Monday",              "description": "Easter Monday",                             "country": None},
    # USA
    {"name": "Thanksgiving (US)",          "description": "US Thanksgiving (4th Thursday of November)","country": "US"},
    {"name": "Labor Day (US)",             "description": "US Labor Day (1st Monday of September)",    "country": "US"},
    {"name": "Independence Day",           "description": "US Independence Day (July 4)",              "country": "US"},
    {"name": "Presidents Day",             "description": "US Presidents Day (3rd Monday of February)","country": "US"},
    {"name": "Cesar Chavez Day",           "description": "Cesar Chavez Day (March 31)",               "country": "US"},
    {"name": "Memorial Day",               "description": "US Memorial Day (last Monday of May)",      "country": "US"},
    {"name": "Columbus Day",               "description": "US Columbus Day (2nd Monday of October)",   "country": "US"},
    {"name": "Martin Luther King Jr. Day", "description": "MLK Day (3rd Monday of January)",           "country": "US"},
    # Canada
    {"name": "Family Day (CA)",            "description": "Canadian Family Day (3rd Monday of February)", "country": "CA"},
    {"name": "Victoria Day",               "description": "Victoria Day (Monday before May 25)",          "country": "CA"},
    {"name": "Canada Day",                 "description": "Canada Day (July 1)",                          "country": "CA"},
    {"name": "Civic Holiday",              "description": "Civic Holiday (1st Monday of August)",         "country": "CA"},
    {"name": "Thanksgiving (CA)",          "description": "Canadian Thanksgiving (2nd Monday of October)","country": "CA"},
    {"name": "Boxing Day (CA)",            "description": "Canadian Boxing Day (December 26)",            "country": "CA"},
]


def upgrade() -> None:
    op.execute(
        predefined_pad_table.insert().values(
            [
                {
                    "id": sa.text("gen_random_uuid()"),
                    "name": p["name"],
                    "description": p["description"],
                    "country": p["country"],
                    "allow_negative": True,
                    "active": True,
                    "created_at": sa.text("now()"),
                    "updated_at": sa.text("now()"),
                }
                for p in PADS
            ]
        )
    )


def downgrade() -> None:
    op.execute(
        predefined_pad_table.delete().where(
            predefined_pad_table.c.name.in_([p["name"] for p in PADS])
        )
    )
