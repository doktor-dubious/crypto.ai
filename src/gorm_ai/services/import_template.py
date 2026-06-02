"""Import template service for business logic."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.import_template import ImportTemplate, ImportTemplateElement
from gorm_ai.schemas.import_template import (
    ImportTemplateCreate,
    ImportTemplateElementCreate,
    ImportTemplateElementUpdate,
    ImportTemplateUpdate,
)


class ImportTemplateService:
    """Service for import template operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, data: ImportTemplateCreate) -> ImportTemplate:
        """Create a new import template with elements."""
        template = ImportTemplate(
            customer_id=data.customer_id,
            name=data.name,
            description=data.description,
            move_file=data.move_file,
            header_lines=data.header_lines,
            footer_lines=data.footer_lines,
            separator=data.separator,
            reset_production_group=data.reset_production_group,
            add_to_production_group=data.add_to_production_group,
        )
        self.session.add(template)
        await self.session.flush()

        for elem_data in data.elements:
            element = ImportTemplateElement(
                template_id=template.id,
                name=elem_data.name,
                description=elem_data.description,
                element_index=elem_data.element_index,
                type=elem_data.type,
                value_type=elem_data.value_type,
                allow=elem_data.allow,
                disallow=elem_data.disallow,
                allow_empty=elem_data.allow_empty,
                allow_negative=elem_data.allow_negative,
                allow_positive=elem_data.allow_positive,
                allow_zero=elem_data.allow_zero,
                date_format=elem_data.date_format,
                decimal_separator=elem_data.decimal_separator,
                maximum_value=elem_data.maximum_value,
                empty_is_zero=elem_data.empty_is_zero,
                negative_parenthesis=elem_data.negative_parenthesis,
                sequence_separator=elem_data.sequence_separator,
                weekday_start=elem_data.weekday_start,
                strip=elem_data.strip,
            )
            self.session.add(element)

        await self.session.flush()
        await self.session.refresh(template)
        return template

    async def list_by_customer(self, customer_id: str) -> list[ImportTemplate]:
        """List all import templates for a customer."""
        result = await self.session.execute(
            select(ImportTemplate)
            .where(
                ImportTemplate.customer_id == customer_id,
                ImportTemplate.active.is_(True),
            )
            .order_by(ImportTemplate.name)
        )
        return list(result.scalars().all())

    async def get(self, template_id: str) -> ImportTemplate | None:
        """Get an import template by ID."""
        result = await self.session.execute(
            select(ImportTemplate).where(
                ImportTemplate.id == template_id,
                ImportTemplate.active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def update(self, template_id: str, data: ImportTemplateUpdate) -> ImportTemplate | None:
        """Update an import template."""
        template = await self.get(template_id)
        if not template:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(template, field, value)

        await self.session.flush()
        await self.session.refresh(template)
        return template

    async def delete(self, template_id: str) -> bool:
        """Soft delete an import template."""
        template = await self.get(template_id)
        if not template:
            return False

        template.active = False
        await self.session.flush()
        return True

    async def add_element(
        self, template_id: str, data: ImportTemplateElementCreate
    ) -> ImportTemplateElement | None:
        """Add an element to a template."""
        template = await self.get(template_id)
        if not template:
            return None

        element = ImportTemplateElement(
            template_id=template_id,
            name=data.name,
            description=data.description,
            element_index=data.element_index,
            type=data.type,
            value_type=data.value_type,
            allow=data.allow,
            disallow=data.disallow,
            allow_empty=data.allow_empty,
            allow_negative=data.allow_negative,
            allow_positive=data.allow_positive,
            allow_zero=data.allow_zero,
            date_format=data.date_format,
            decimal_separator=data.decimal_separator,
            maximum_value=data.maximum_value,
            empty_is_zero=data.empty_is_zero,
            negative_parenthesis=data.negative_parenthesis,
            sequence_separator=data.sequence_separator,
            weekday_start=data.weekday_start,
            strip=data.strip,
        )
        self.session.add(element)
        await self.session.flush()
        await self.session.refresh(element)
        return element

    async def update_element(
        self, element_id: str, data: ImportTemplateElementUpdate
    ) -> ImportTemplateElement | None:
        """Update an element's configuration."""
        result = await self.session.execute(
            select(ImportTemplateElement).where(
                ImportTemplateElement.id == element_id,
                ImportTemplateElement.active.is_(True),
            )
        )
        element = result.scalar_one_or_none()
        if not element:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(element, field, value)

        await self.session.flush()
        await self.session.refresh(element)
        return element

    async def clone(self, template_id: str, new_name: str) -> ImportTemplate | None:
        """Duplicate a template along with all of its elements."""
        source = await self.get(template_id)
        if not source:
            return None

        clone = ImportTemplate(
            customer_id=source.customer_id,
            name=new_name,
            description=source.description,
            move_file=source.move_file,
            header_lines=source.header_lines,
            footer_lines=source.footer_lines,
            separator=source.separator,
            reset_production_group=source.reset_production_group,
            add_to_production_group=source.add_to_production_group,
        )
        self.session.add(clone)
        await self.session.flush()

        for elem in source.elements:
            self.session.add(
                ImportTemplateElement(
                    template_id=clone.id,
                    name=elem.name,
                    description=elem.description,
                    element_index=elem.element_index,
                    type=elem.type,
                    value_type=elem.value_type,
                    allow=elem.allow,
                    disallow=elem.disallow,
                    allow_empty=elem.allow_empty,
                    allow_negative=elem.allow_negative,
                    allow_positive=elem.allow_positive,
                    allow_zero=elem.allow_zero,
                    date_format=elem.date_format,
                    decimal_separator=elem.decimal_separator,
                    maximum_value=elem.maximum_value,
                    empty_is_zero=elem.empty_is_zero,
                    negative_parenthesis=elem.negative_parenthesis,
                    sequence_separator=elem.sequence_separator,
                    weekday_start=elem.weekday_start,
                    strip=elem.strip,
                )
            )

        await self.session.flush()
        await self.session.refresh(clone)
        return clone

    async def remove_element(self, element_id: str) -> bool:
        """Hard delete an element (soft delete would leak via relationship)."""
        result = await self.session.execute(
            select(ImportTemplateElement).where(
                ImportTemplateElement.id == element_id,
                ImportTemplateElement.active.is_(True),
            )
        )
        element = result.scalar_one_or_none()
        if not element:
            return False

        await self.session.delete(element)
        await self.session.flush()
        return True

    async def reorder_elements(self, template_id: str, element_ids: list[str]) -> bool:
        """Reorder elements by updating their element_index."""
        template = await self.get(template_id)
        if not template:
            return False

        for index, element_id in enumerate(element_ids):
            result = await self.session.execute(
                select(ImportTemplateElement).where(
                    ImportTemplateElement.id == element_id,
                    ImportTemplateElement.template_id == template_id,
                    ImportTemplateElement.active.is_(True),
                )
            )
            element = result.scalar_one_or_none()
            if element:
                element.element_index = index

        await self.session.flush()
        return True
