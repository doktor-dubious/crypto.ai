"""PredefinedPad service."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crypto_ai.database.models.predefined_pad import PredefinedPad, PredefinedPadDate
from crypto_ai.schemas.predefined_pad import PredefinedPadCreate, PredefinedPadUpdate


class PredefinedPadService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: PredefinedPadCreate) -> PredefinedPad:
        pad = PredefinedPad(
            name=data.name,
            description=data.description,
            country=data.country,
            allow_negative=data.allow_negative,
        )
        self.session.add(pad)
        await self.session.flush()
        for d in data.dates:
            self.session.add(PredefinedPadDate(predefined_pad_id=pad.id, date=d))
        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def get(self, pad_id: str) -> PredefinedPad | None:
        result = await self.session.execute(
            select(PredefinedPad).where(
                PredefinedPad.id == pad_id,
                PredefinedPad.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        country: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[PredefinedPad]:
        query = select(PredefinedPad).where(PredefinedPad.active.is_(True))
        if country:
            query = query.where(PredefinedPad.country == country)
        query = query.order_by(PredefinedPad.name).limit(limit).offset(offset)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def update(self, pad_id: str, data: PredefinedPadUpdate) -> PredefinedPad | None:
        pad = await self.get(pad_id)
        if not pad:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(pad, field, value)
        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def delete(self, pad_id: str, hard_delete: bool = False) -> bool:
        pad = await self.get(pad_id)
        if not pad:
            return False
        if hard_delete:
            await self.session.delete(pad)
        else:
            pad.active = False
            await self.session.flush()
        return True

    async def add_dates(self, pad_id: str, dates: list[date]) -> PredefinedPad | None:
        pad = await self.get(pad_id)
        if not pad:
            return None
        existing = {pd.date for pd in pad.dates if pd.active}
        for d in dates:
            if d not in existing:
                self.session.add(PredefinedPadDate(predefined_pad_id=pad_id, date=d))
        await self.session.flush()
        await self.session.refresh(pad)
        return pad

    async def remove_date(self, pad_id: str, date_id: str) -> bool:
        result = await self.session.execute(
            select(PredefinedPadDate).where(
                PredefinedPadDate.id == date_id,
                PredefinedPadDate.predefined_pad_id == pad_id,
                PredefinedPadDate.active.is_(True),
            )
        )
        pad_date = result.scalar_one_or_none()
        if not pad_date:
            return False
        pad_date.active = False
        await self.session.flush()
        return True
