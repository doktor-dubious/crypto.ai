"""Import file listing + upload routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from gorm_ai.api.deps import DbSession
from gorm_ai.schemas.import_log import (
    ImportFileInfo,
    ImportFileListResponse,
    VerificationRequest,
    VerificationResponse,
)
from gorm_ai.services.import_file import ImportFileService
from gorm_ai.services.import_verify import ImportVerifyService

router = APIRouter()


def get_import_file_service(session: DbSession) -> ImportFileService:
    return ImportFileService(session)


def get_import_verify_service(session: DbSession) -> ImportVerifyService:
    return ImportVerifyService(session)


ImportFileServiceDep = Annotated[ImportFileService, Depends(get_import_file_service)]
ImportVerifyServiceDep = Annotated[ImportVerifyService, Depends(get_import_verify_service)]


@router.get("/files", response_model=ImportFileListResponse)
async def list_import_files(
    customer_id: str,
    service: ImportFileServiceDep,
) -> ImportFileListResponse:
    """List files sitting in the customer's upload directory."""
    return await service.list_files(customer_id)


@router.post("/upload", response_model=ImportFileInfo, status_code=201)
async def upload_import_file(
    service: ImportFileServiceDep,
    customer_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> ImportFileInfo:
    """Upload a local file into the customer's upload directory."""
    content = await file.read()
    try:
        return await service.save_upload(customer_id, file.filename or "uploaded", content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/verify", response_model=VerificationResponse)
async def verify_import_file(
    data: VerificationRequest,
    service: ImportVerifyServiceDep,
) -> VerificationResponse:
    """Run template checks on a file and return summary + per-line issues."""
    try:
        return await service.verify(data.customer_id, data.template_id, data.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
