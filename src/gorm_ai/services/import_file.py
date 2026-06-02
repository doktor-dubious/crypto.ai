"""Service for listing and uploading files in a customer's import directory."""

from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from gorm_ai.database.models.customer_configuration import CustomerConfiguration
from gorm_ai.database.models.import_log import ImportLog
from gorm_ai.schemas.import_log import ImportFileInfo, ImportFileListResponse


class ImportFileService:
    """Handles filesystem interaction with a customer's upload directory."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def _upload_dir(self, customer_id: str) -> str | None:
        """Return home_directory joined with upload_directory (both from config)."""
        result = await self.session.execute(
            select(
                CustomerConfiguration.home_directory,
                CustomerConfiguration.upload_directory,
            ).where(
                CustomerConfiguration.customer_id == customer_id,
                CustomerConfiguration.active.is_(True),
            )
        )
        row = result.one_or_none()
        if not row:
            return None
        home, upload = row
        if not upload:
            return None
        if not home:
            return upload
        # Literal concatenation: home_directory + upload_directory.
        return home + upload

    async def _imported_names(self, customer_id: str) -> set[str]:
        """Return the set of filenames already logged as a successful import."""
        result = await self.session.execute(
            select(ImportLog.filename).where(
                ImportLog.customer_id == customer_id,
                ImportLog.status == "success",
                ImportLog.active.is_(True),
            )
        )
        return {row[0] for row in result.all()}

    async def list_files(self, customer_id: str) -> ImportFileListResponse:
        directory = await self._upload_dir(customer_id)
        if not directory:
            return ImportFileListResponse(
                directory=None,
                files=[],
                error="No upload_directory configured for this customer.",
            )

        path = Path(directory)
        if not path.exists():
            return ImportFileListResponse(
                directory=directory,
                files=[],
                error=f"Directory {directory!r} does not exist on the server.",
            )
        if not path.is_dir():
            return ImportFileListResponse(
                directory=directory,
                files=[],
                error=f"{directory!r} is not a directory.",
            )

        imported = await self._imported_names(customer_id)
        files: list[ImportFileInfo] = []
        for entry in sorted(path.iterdir(), key=lambda p: p.name):
            if not entry.is_file():
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            files.append(
                ImportFileInfo(
                    name=entry.name,
                    size_bytes=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                    imported=entry.name in imported,
                )
            )
        return ImportFileListResponse(directory=directory, files=files)

    async def save_upload(self, customer_id: str, filename: str, content: bytes) -> ImportFileInfo:
        directory = await self._upload_dir(customer_id)
        if not directory:
            raise ValueError("No upload_directory configured for this customer.")

        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True)

        # Sanitise the filename to prevent path traversal.
        safe_name = Path(filename).name
        if not safe_name:
            raise ValueError("Invalid filename.")

        target = path / safe_name
        target.write_bytes(content)
        stat = target.stat()
        imported = await self._imported_names(customer_id)
        return ImportFileInfo(
            name=safe_name,
            size_bytes=stat.st_size,
            modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            imported=safe_name in imported,
        )
