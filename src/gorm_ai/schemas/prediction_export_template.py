"""Prediction export template Pydantic schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PredictionExportTemplateElementBase(BaseModel):
    fixed_length: int | None = None
    prepend_filler_char: str | None = None
    append_filler_char: str | None = None
    date_format: str = "MM/DD/YYYY"
    text: str | None = None


class PredictionExportTemplateElementCreate(PredictionExportTemplateElementBase):
    pass


class PredictionExportTemplateElementUpdate(BaseModel):
    fixed_length: int | None = None
    prepend_filler_char: str | None = None
    append_filler_char: str | None = None
    date_format: str | None = None
    text: str | None = None


class PredictionExportTemplateElementResponse(PredictionExportTemplateElementBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    template_id: str
    active: bool
    created_at: datetime
    updated_at: datetime


class PredictionExportTemplateBase(BaseModel):
    name: str
    description: str | None = None
    output_name: str | None = None
    header_lines: int = 0
    footer_lines: int = 0
    footer_text: str | None = None
    separator: str = ","
    field_length: str = "variable"
    character_set: str = "utf-8"
    send_to_download: bool = True
    send_to_ftp: bool = False
    send_to_email: bool = False


class PredictionExportTemplateCreate(PredictionExportTemplateBase):
    customer_id: str


class PredictionExportTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    output_name: str | None = None
    header_lines: int | None = None
    footer_lines: int | None = None
    footer_text: str | None = None
    separator: str | None = None
    field_length: str | None = None
    character_set: str | None = None
    send_to_download: bool | None = None
    send_to_ftp: bool | None = None
    send_to_email: bool | None = None


class PredictionExportTemplateResponse(PredictionExportTemplateBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    active: bool
    created_at: datetime
    updated_at: datetime
    elements: list[PredictionExportTemplateElementResponse] = []
