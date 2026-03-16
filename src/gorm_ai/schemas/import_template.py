"""Import template Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ImportTemplateElementCreate(BaseModel):
    """Schema for creating an import template element."""

    name: str
    description: str | None = None
    element_index: int = 0
    type: str
    allow: str | None = None
    disallow: str | None = None
    allow_empty: bool = False
    allow_negative: bool = False
    allow_positive: bool = False
    allow_zero: bool = False
    date_format: str = "MM/DD/YY"
    decimal_separator: str = "."
    maximum_value: int = 0
    empty_is_zero: bool = False
    negative_parenthesis: bool = False
    sequence_separator: str = ","
    weekday_start: int | None = None
    strip: str | None = None


class ImportTemplateElementResponse(BaseModel):
    """Schema for import template element response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    template_id: str
    name: str
    description: str | None
    element_index: int
    type: str
    allow: str | None
    disallow: str | None
    allow_empty: bool
    allow_negative: bool
    allow_positive: bool
    allow_zero: bool
    date_format: str
    decimal_separator: str
    maximum_value: int
    empty_is_zero: bool
    negative_parenthesis: bool
    sequence_separator: str
    weekday_start: int | None
    strip: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class ImportTemplateCreate(BaseModel):
    """Schema for creating an import template."""

    customer_id: str
    name: str
    description: str | None = None
    move_file: bool = True
    header_lines: int = 0
    footer_lines: int = 0
    separator: str = ","
    reset_production_group: bool = False
    add_to_production_group: bool = False
    elements: list[ImportTemplateElementCreate] = []


class ImportTemplateUpdate(BaseModel):
    """Schema for updating an import template."""

    name: str | None = None
    description: str | None = None
    move_file: bool | None = None
    header_lines: int | None = None
    footer_lines: int | None = None
    separator: str | None = None
    reset_production_group: bool | None = None
    add_to_production_group: bool | None = None


class ImportTemplateResponse(BaseModel):
    """Schema for import template response."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    name: str
    description: str | None
    move_file: bool
    header_lines: int
    footer_lines: int
    separator: str
    reset_production_group: bool
    add_to_production_group: bool
    elements: list[ImportTemplateElementResponse]
    active: bool
    created_at: datetime
    updated_at: datetime
