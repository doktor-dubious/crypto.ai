"""Import template Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ImportTemplateElementCreate(BaseModel):
    """Schema for creating an import template element."""

    name: str
    description: str | None = None
    element_index: int = 0
    type: str
    value_type: str = "string"
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
    value_type: str
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


class ImportTemplateElementUpdate(BaseModel):
    """Schema for updating an import template element. Type is immutable."""

    name: str | None = None
    description: str | None = None
    element_index: int | None = None
    value_type: str | None = None
    allow: str | None = None
    disallow: str | None = None
    allow_empty: bool | None = None
    allow_negative: bool | None = None
    allow_positive: bool | None = None
    allow_zero: bool | None = None
    date_format: str | None = None
    decimal_separator: str | None = None
    maximum_value: int | None = None
    empty_is_zero: bool | None = None
    negative_parenthesis: bool | None = None
    sequence_separator: str | None = None
    weekday_start: int | None = None
    strip: str | None = None


class ImportTemplateClone(BaseModel):
    """Schema for cloning an import template."""

    name: str


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
