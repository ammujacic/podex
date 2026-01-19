"""GCS storage service for workspace files.

Supports both GCP Cloud Storage and local emulator for development.
Note: File kept as s3.py for backwards compatibility with existing imports.

All GCS operations are wrapped with asyncio.to_thread to avoid blocking the event loop.
"""

import asyncio
import contextlib
import mimetypes
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Any

from google.cloud import storage  # type: ignore[attr-defined,import-untyped]
from google.cloud.exceptions import NotFound  # type: ignore[import-untyped]

from src.config import settings
from src.exceptions import FileNotFoundInStorageError


class S3Storage:
    """GCS storage service for workspace files.

    Note: Class kept as S3Storage for backwards compatibility with existing code.
    """

    def __init__(
        self,
        bucket: str,
        prefix: str,
        project_id: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        """Initialize GCS storage.

        Args:
            bucket: GCS bucket name
            prefix: Base prefix for all keys
            project_id: GCP project ID
            endpoint_url: Custom endpoint URL (for local emulator)
        """
        self.bucket_name = bucket
        self.prefix = prefix
        self.project_id = project_id

        # Create client with optional emulator endpoint
        if endpoint_url:
            self._client = storage.Client(
                project=project_id or "local-project",
                client_options={"api_endpoint": endpoint_url},
            )
        else:
            self._client = storage.Client(project=project_id)

        self._bucket: storage.Bucket | None = None

    def _get_bucket(self) -> storage.Bucket:
        """Get the GCS bucket."""
        if self._bucket is None:
            self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def _get_key(self, workspace_id: str, path: str) -> str:
        """Get the full GCS key for a workspace file path.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace (e.g., /workspace/src/app.tsx)

        Returns:
            Full GCS key

        Raises:
            ValueError: If path attempts to traverse outside workspace boundary.
        """
        # Normalize path - remove leading /workspace prefix if present
        clean_path = path.lstrip("/")
        clean_path = clean_path.removeprefix("workspace/")  # Remove "workspace/"

        # Security: Resolve the path and check for traversal attacks
        # Use PurePosixPath to normalize without filesystem access
        normalized = PurePosixPath(clean_path)

        # Check for path traversal attempts
        # After normalization, the path should not start with .. or contain ..
        resolved_parts: list[str] = []
        for part in normalized.parts:
            if part == "..":
                if resolved_parts:
                    resolved_parts.pop()
                # If trying to go above root, this is a traversal attack
                else:
                    raise ValueError(f"Path traversal detected: {path}")
            elif part != ".":
                resolved_parts.append(part)

        # Reconstruct the safe path
        safe_path = "/".join(resolved_parts)

        # Additional check: ensure no .. remains after normalization
        if ".." in safe_path:
            raise ValueError(f"Path traversal detected: {path}")

        return f"{self.prefix}/{workspace_id}/{safe_path}"

    async def ensure_bucket_exists(self) -> None:
        """Ensure the GCS bucket exists (useful for local emulator)."""
        bucket = self._get_bucket()

        def _ensure() -> None:
            if not bucket.exists():
                bucket.create(location=settings.GCP_REGION)

        await asyncio.to_thread(_ensure)

    async def list_files(
        self,
        workspace_id: str,
        path: str = "",
    ) -> list[dict[str, Any]]:
        """List files and directories at a path.

        Args:
            workspace_id: Workspace identifier
            path: Directory path within workspace

        Returns:
            List of file/directory info dicts
        """
        prefix = self._get_key(workspace_id, path)
        if not prefix.endswith("/"):
            prefix += "/"

        bucket = self._get_bucket()
        gcs_prefix = self.prefix
        ws_id = workspace_id

        def _list() -> list[dict[str, Any]]:
            items: list[dict[str, Any]] = []
            # Use delimiter to get "directories"
            blobs = self._client.list_blobs(
                bucket,
                prefix=prefix,
                delimiter="/",
            )

            # Collect files
            for blob in blobs:
                # Skip the directory marker itself
                if blob.name == prefix:
                    continue
                file_name = PurePosixPath(blob.name).name
                relative_path = blob.name.split(f"{gcs_prefix}/{ws_id}/")[-1]
                items.append(
                    {
                        "name": file_name,
                        "path": f"/workspace/{relative_path}",
                        "type": "file",
                        "size": blob.size or 0,
                        "last_modified": blob.updated,
                    },
                )

            # Collect directories (prefixes)
            for prefix_item in blobs.prefixes:
                dir_path = prefix_item.rstrip("/")
                dir_name = PurePosixPath(dir_path).name
                relative_path = dir_path.split(f"{gcs_prefix}/{ws_id}/")[-1]
                items.append(
                    {
                        "name": dir_name,
                        "path": f"/workspace/{relative_path}",
                        "type": "directory",
                    },
                )

            return items

        return await asyncio.to_thread(_list)

    async def get_file_tree(
        self,
        workspace_id: str,
        path: str = "",
        max_depth: int = 5,
    ) -> list[dict[str, Any]]:
        """Get recursive file tree.

        Args:
            workspace_id: Workspace identifier
            path: Starting directory path
            max_depth: Maximum recursion depth

        Returns:
            Nested list of file/directory info dicts
        """
        if max_depth <= 0:
            return []

        items = await self.list_files(workspace_id, path)
        result = []

        for item in items:
            node = {
                "name": item["name"],
                "path": item["path"],
                "type": item["type"],
            }

            if item["type"] == "directory":
                # Recursively get children
                children = await self.get_file_tree(
                    workspace_id,
                    item["path"],
                    max_depth - 1,
                )
                node["children"] = children

            result.append(node)

        return result

    async def get_file(self, workspace_id: str, path: str) -> bytes:
        """Get file content.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            File content as bytes

        Raises:
            FileNotFoundInStorageError: If file doesn't exist
        """
        key = self._get_key(workspace_id, path)
        bucket = self._get_bucket()
        blob = bucket.blob(key)
        file_path = path

        def _download() -> bytes:
            try:
                content: bytes = blob.download_as_bytes()
            except NotFound as e:
                raise FileNotFoundInStorageError(file_path) from e
            else:
                return content

        return await asyncio.to_thread(_download)

    async def get_file_text(self, workspace_id: str, path: str) -> str:
        """Get file content as text.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            File content as string
        """
        content = await self.get_file(workspace_id, path)
        return content.decode("utf-8")

    async def put_file(
        self,
        workspace_id: str,
        path: str,
        content: bytes | str,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        """Upload or update a file.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace
            content: File content
            content_type: MIME type (auto-detected if not provided)

        Returns:
            Upload result info
        """
        key = self._get_key(workspace_id, path)

        if isinstance(content, str):
            content = content.encode("utf-8")

        if content_type is None:
            content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

        bucket = self._get_bucket()
        blob = bucket.blob(key)
        file_content = content
        file_content_type = content_type

        def _upload() -> None:
            blob.upload_from_string(file_content, content_type=file_content_type)

        await asyncio.to_thread(_upload)

        return {
            "path": path,
            "key": key,
            "size": len(content),
            "content_type": content_type,
        }

    async def delete_file(self, workspace_id: str, path: str) -> bool:
        """Delete a file.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            True if deleted
        """
        key = self._get_key(workspace_id, path)
        bucket = self._get_bucket()
        blob = bucket.blob(key)

        def _delete() -> None:
            with contextlib.suppress(NotFound):
                blob.delete()

        await asyncio.to_thread(_delete)
        return True

    async def delete_directory(self, workspace_id: str, path: str) -> int:
        """Delete a directory and all its contents.

        Args:
            workspace_id: Workspace identifier
            path: Directory path within workspace

        Returns:
            Number of files deleted
        """
        prefix = self._get_key(workspace_id, path)
        if not prefix.endswith("/"):
            prefix += "/"

        bucket = self._get_bucket()
        client = self._client

        def _delete_all() -> int:
            blobs = list(client.list_blobs(bucket, prefix=prefix))
            deleted_count = 0
            for blob in blobs:
                blob.delete()
                deleted_count += 1
            return deleted_count

        return await asyncio.to_thread(_delete_all)

    async def copy_file(
        self,
        workspace_id: str,
        source_path: str,
        dest_path: str,
    ) -> dict[str, str]:
        """Copy a file within the workspace.

        Args:
            workspace_id: Workspace identifier
            source_path: Source file path
            dest_path: Destination file path

        Returns:
            Copy result info
        """
        source_key = self._get_key(workspace_id, source_path)
        dest_key = self._get_key(workspace_id, dest_path)

        bucket = self._get_bucket()
        source_blob = bucket.blob(source_key)

        def _copy() -> None:
            bucket.copy_blob(source_blob, bucket, dest_key)

        await asyncio.to_thread(_copy)

        return {
            "source": source_path,
            "destination": dest_path,
        }

    async def move_file(
        self,
        workspace_id: str,
        source_path: str,
        dest_path: str,
    ) -> dict[str, str]:
        """Move/rename a file within the workspace.

        Args:
            workspace_id: Workspace identifier
            source_path: Source file path
            dest_path: Destination file path

        Returns:
            Move result info
        """
        # Copy then delete
        result = await self.copy_file(workspace_id, source_path, dest_path)
        await self.delete_file(workspace_id, source_path)
        return result

    async def file_exists(self, workspace_id: str, path: str) -> bool:
        """Check if a file exists.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            True if file exists
        """
        key = self._get_key(workspace_id, path)
        bucket = self._get_bucket()
        blob = bucket.blob(key)

        def _exists() -> bool:
            return bool(blob.exists())

        return await asyncio.to_thread(_exists)

    async def initialize_workspace(
        self,
        workspace_id: str,
        template_files: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Initialize a new workspace with optional template files.

        Args:
            workspace_id: Workspace identifier
            template_files: Dict of path -> content for initial files

        Returns:
            Initialization result
        """
        await self.ensure_bucket_exists()

        files_created = 0
        if template_files:
            for path, content in template_files.items():
                await self.put_file(workspace_id, path, content)
                files_created += 1

        return {
            "workspace_id": workspace_id,
            "files_created": files_created,
        }

    async def cleanup_workspace(self, workspace_id: str) -> dict[str, Any]:
        """Clean up all files for a workspace.

        Args:
            workspace_id: Workspace identifier

        Returns:
            Cleanup result
        """
        deleted = await self.delete_directory(workspace_id, "")
        return {
            "workspace_id": workspace_id,
            "files_deleted": deleted,
        }


@lru_cache
def get_storage() -> S3Storage:
    """Get cached GCS storage instance."""
    return S3Storage(
        bucket=settings.GCS_BUCKET,
        prefix=settings.GCS_WORKSPACE_PREFIX,
        project_id=settings.GCP_PROJECT_ID,
        endpoint_url=settings.GCS_ENDPOINT_URL,
    )
