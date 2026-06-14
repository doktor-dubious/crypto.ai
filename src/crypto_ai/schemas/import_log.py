"""Schemas for import log and file listing."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ImportFileInfo(BaseModel):
    """A file sitting in the customer's upload directory."""

    name: str
    size_bytes: int
    modified_at: datetime
    imported: bool


class ImportFileListResponse(BaseModel):
    """Response for GET /imports/files."""

    directory: str | None
    files: list[ImportFileInfo]
    error: str | None = None


class VerificationIssue(BaseModel):
    """A single line-level issue found during verification."""

    line_number: int
    severity: str  # "Error" | "Filter"
    message_group: str
    message: str


class VerificationGroup(BaseModel):
    """Aggregated count for an error/filter group."""

    name: str
    severity: str
    count: int


class VerificationRequest(BaseModel):
    """Request body for POST /imports/verify."""

    customer_id: str
    template_id: str
    filename: str


class VerificationResponse(BaseModel):
    """Full result of verifying a file against a template."""

    filename: str
    total_lines: int
    error_count: int
    filter_count: int
    issues_truncated: bool
    groups: list[VerificationGroup]
    issues: list[VerificationIssue]


class ImportLogResponse(BaseModel):
    """Schema for import log entries."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    template_id: str | None
    filename: str
    status: str
    rows_imported: int | None
    error_message: str | None
    imported_at: datetime | None
    active: bool
    created_at: datetime
    updated_at: datetime
