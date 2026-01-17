"""Google Cloud Storage client for file storage operations.

Replaces AWS S3 with GCS for Podex services.
Supports both GCP Cloud Storage and local emulator for development.
"""

import asyncio
import contextlib
import mimetypes
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from functools import partial
from pathlib import PurePosixPath
from typing import Any, cast

import structlog
from google.cloud import storage
from google.cloud.exceptions import NotFound

logger = structlog.get_logger()

# Thread pool for running sync GCS operations
_executor = ThreadPoolExecutor(max_workers=10)


async def _run_in_executor(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a sync function in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, partial(func, *args, **kwargs))


class GCSClient:
    """Async Google Cloud Storage client for file storage operations.

    Provides a consistent interface for GCS operations across services.
    Supports both GCP Cloud Storage and the storage emulator for local development.
    """

    def __init__(
        self,
        bucket: str,
        prefix: str = "",
        project_id: str | None = None,
        endpoint_url: str | None = None,
    ) -> None:
        """Initialize GCS client.

        Args:
            bucket: GCS bucket name
            prefix: Base prefix for all keys (e.g., "workspaces")
            project_id: GCP project ID (uses default if not specified)
            endpoint_url: Custom endpoint URL (for emulator, e.g., "http://localhost:4443")
        """
        self.bucket_name = bucket
        self.prefix = prefix.strip("/")
        self.project_id = project_id
        self.endpoint_url = endpoint_url

        # Initialize client
        if endpoint_url:
            # Local emulator mode
            self._client = storage.Client(
                project=project_id or "dev-project",
                client_options={"api_endpoint": endpoint_url},
            )
        else:
            # Production GCP mode
            self._client = storage.Client(project=project_id)

        self._bucket: storage.Bucket | None = None

    @property
    def bucket(self) -> storage.Bucket:
        """Get bucket object (lazy initialization)."""
        if self._bucket is None:
            self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def _get_key(self, *parts: str) -> str:
        """Build a GCS key from parts.

        Args:
            *parts: Key components to join

        Returns:
            Full GCS key with prefix
        """
        clean_parts = []
        for part in parts:
            clean = part.strip("/")
            if clean:
                clean_parts.append(clean)

        key = "/".join(clean_parts)
        if self.prefix:
            return f"{self.prefix}/{key}"
        return key

    async def ensure_bucket_exists(self) -> None:
        """Ensure the GCS bucket exists (useful for emulator)."""

        def _ensure() -> None:
            try:
                self._client.get_bucket(self.bucket_name)
            except NotFound:
                self._client.create_bucket(self.bucket_name, location="us-central1")
                logger.info("Created GCS bucket", bucket=self.bucket_name)

        await _run_in_executor(_ensure)

    async def list_objects(
        self,
        prefix: str = "",
        delimiter: str = "/",
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """List objects with a given prefix.

        Args:
            prefix: Key prefix to filter by
            delimiter: Delimiter for grouping (use "/" for directory-like listing)

        Returns:
            Tuple of (objects, common_prefixes)
        """
        full_prefix = self._get_key(prefix)
        if prefix and not full_prefix.endswith("/"):
            full_prefix += "/"

        def _list() -> tuple[list[dict[str, Any]], list[str]]:
            blobs = self._client.list_blobs(
                self.bucket_name,
                prefix=full_prefix,
                delimiter=delimiter,
            )

            objects = []
            for blob in blobs:
                objects.append(
                    {
                        "Key": blob.name,
                        "Size": blob.size or 0,
                        "LastModified": blob.updated,
                    }
                )

            prefixes = list(blobs.prefixes) if hasattr(blobs, "prefixes") else []
            return objects, prefixes

        return cast("tuple[list[dict[str, Any]], list[str]]", await _run_in_executor(_list))

    async def list_all_objects(self, prefix: str = "") -> list[dict[str, Any]]:
        """List all objects with a given prefix (no delimiter).

        Args:
            prefix: Key prefix to filter by

        Returns:
            List of all objects
        """
        full_prefix = self._get_key(prefix)

        def _list_all() -> list[dict[str, Any]]:
            blobs = self._client.list_blobs(self.bucket_name, prefix=full_prefix)
            return [
                {
                    "Key": blob.name,
                    "Size": blob.size or 0,
                    "LastModified": blob.updated,
                }
                for blob in blobs
            ]

        return cast("list[dict[str, Any]]", await _run_in_executor(_list_all))

    async def get_object(self, key: str) -> bytes:
        """Get object content.

        Args:
            key: Object key (will be prefixed)

        Returns:
            Object content as bytes

        Raises:
            FileNotFoundError: If object doesn't exist
        """
        full_key = self._get_key(key)

        def _get() -> bytes:
            blob = self.bucket.blob(full_key)
            try:
                return cast("bytes", blob.download_as_bytes())
            except NotFound as e:
                raise FileNotFoundError(f"Object not found: {key}") from e

        return cast("bytes", await _run_in_executor(_get))

    async def get_object_text(self, key: str, encoding: str = "utf-8") -> str:
        """Get object content as text.

        Args:
            key: Object key
            encoding: Text encoding

        Returns:
            Object content as string
        """
        content = await self.get_object(key)
        return content.decode(encoding)

    async def put_object(
        self,
        key: str,
        content: bytes | str,
        content_type: str | None = None,
        metadata: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Upload or update an object.

        Args:
            key: Object key (will be prefixed)
            content: Object content
            content_type: MIME type (auto-detected if not provided)
            metadata: Optional metadata dict

        Returns:
            Upload result info
        """
        full_key = self._get_key(key)

        if isinstance(content, str):
            content = content.encode("utf-8")

        if content_type is None:
            content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"

        def _put() -> None:
            blob = self.bucket.blob(full_key)
            if metadata:
                blob.metadata = metadata
            blob.upload_from_string(content, content_type=content_type)

        await _run_in_executor(_put)

        return {
            "key": full_key,
            "size": len(content),
            "content_type": content_type,
        }

    async def delete_object(self, key: str) -> bool:
        """Delete an object.

        Args:
            key: Object key (will be prefixed)

        Returns:
            True if deleted
        """
        full_key = self._get_key(key)

        def _delete() -> None:
            blob = self.bucket.blob(full_key)
            with contextlib.suppress(NotFound):
                blob.delete()

        await _run_in_executor(_delete)
        return True

    async def delete_prefix(self, prefix: str) -> int:
        """Delete all objects with a given prefix.

        Args:
            prefix: Key prefix (will be prefixed with base prefix)

        Returns:
            Number of objects deleted
        """
        full_prefix = self._get_key(prefix)
        if not full_prefix.endswith("/"):
            full_prefix += "/"

        def _delete_all() -> int:
            blobs = list(self._client.list_blobs(self.bucket_name, prefix=full_prefix))
            if blobs:
                # Delete in batches
                for blob in blobs:
                    blob.delete()
            return len(blobs)

        return cast("int", await _run_in_executor(_delete_all))

    async def copy_object(
        self,
        source_key: str,
        dest_key: str,
    ) -> dict[str, Any]:
        """Copy an object.

        Args:
            source_key: Source object key
            dest_key: Destination object key

        Returns:
            Copy result info
        """
        full_source = self._get_key(source_key)
        full_dest = self._get_key(dest_key)

        def _copy() -> None:
            source_blob = self.bucket.blob(full_source)
            self.bucket.copy_blob(source_blob, self.bucket, full_dest)

        await _run_in_executor(_copy)

        return {
            "source": full_source,
            "destination": full_dest,
        }

    async def move_object(
        self,
        source_key: str,
        dest_key: str,
    ) -> dict[str, Any]:
        """Move/rename an object.

        Args:
            source_key: Source object key
            dest_key: Destination object key

        Returns:
            Move result info
        """
        result = await self.copy_object(source_key, dest_key)
        await self.delete_object(source_key)
        return result

    async def object_exists(self, key: str) -> bool:
        """Check if an object exists.

        Args:
            key: Object key (will be prefixed)

        Returns:
            True if object exists
        """
        full_key = self._get_key(key)

        def _exists() -> bool:
            blob = self.bucket.blob(full_key)
            return cast("bool", blob.exists())

        return cast("bool", await _run_in_executor(_exists))

    async def get_signed_url(
        self,
        key: str,
        operation: str = "GET",
        expires_in: int = 3600,
    ) -> str:
        """Generate a signed URL for an object.

        Args:
            key: Object key (will be prefixed)
            operation: HTTP method (GET, PUT)
            expires_in: URL expiration time in seconds

        Returns:
            Signed URL
        """
        full_key = self._get_key(key)

        def _sign() -> str:
            blob = self.bucket.blob(full_key)
            return cast(
                "str",
                blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(seconds=expires_in),
                    method=operation,
                ),
            )

        return cast("str", await _run_in_executor(_sign))


class WorkspaceGCSClient(GCSClient):
    """GCS client specialized for workspace file operations.

    Provides workspace-aware file paths and tree operations.
    """

    def get_workspace_key(self, workspace_id: str, path: str) -> str:
        """Get the GCS key for a workspace file path.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            GCS key (relative to prefix)
        """
        # Normalize path - remove leading /workspace prefix if present
        clean_path = path.lstrip("/")
        clean_path = clean_path.removeprefix("workspace/")

        return f"{workspace_id}/{clean_path}"

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
        ws_key = self.get_workspace_key(workspace_id, path)
        objects, prefixes = await self.list_objects(ws_key)

        items = []

        # Add directories (common prefixes)
        for prefix_path in prefixes:
            dir_path = prefix_path.rstrip("/")
            dir_name = PurePosixPath(dir_path).name
            relative = dir_path.split(f"{workspace_id}/", 1)[-1]
            items.append(
                {
                    "name": dir_name,
                    "path": f"/workspace/{relative}",
                    "type": "directory",
                }
            )

        # Add files
        for obj in objects:
            key = obj["Key"]
            # Skip the directory itself
            if key.endswith("/"):
                continue
            file_name = PurePosixPath(key).name
            relative_path = key.split(f"{workspace_id}/", 1)[-1]
            file_item: dict[str, Any] = {
                "name": file_name,
                "path": f"/workspace/{relative_path}",
                "type": "file",
                "size": obj.get("Size", 0),
                "last_modified": obj.get("LastModified"),
            }
            items.append(file_item)

        return items

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
                children = await self.get_file_tree(
                    workspace_id,
                    item["path"],
                    max_depth - 1,
                )
                node["children"] = children

            result.append(node)

        return result

    async def get_file(self, workspace_id: str, path: str) -> bytes:
        """Get file content."""
        ws_key = self.get_workspace_key(workspace_id, path)
        return await self.get_object(ws_key)

    async def get_file_text(self, workspace_id: str, path: str) -> str:
        """Get file content as text."""
        ws_key = self.get_workspace_key(workspace_id, path)
        return await self.get_object_text(ws_key)

    async def put_file(
        self,
        workspace_id: str,
        path: str,
        content: bytes | str,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        """Upload or update a file."""
        ws_key = self.get_workspace_key(workspace_id, path)
        result = await self.put_object(ws_key, content, content_type)
        result["path"] = path
        return result

    async def delete_file(self, workspace_id: str, path: str) -> bool:
        """Delete a file."""
        ws_key = self.get_workspace_key(workspace_id, path)
        return await self.delete_object(ws_key)

    async def delete_directory(self, workspace_id: str, path: str) -> int:
        """Delete a directory and all its contents."""
        ws_key = self.get_workspace_key(workspace_id, path)
        return await self.delete_prefix(ws_key)

    async def file_exists(self, workspace_id: str, path: str) -> bool:
        """Check if a file exists."""
        ws_key = self.get_workspace_key(workspace_id, path)
        return await self.object_exists(ws_key)

    async def initialize_workspace(
        self,
        workspace_id: str,
        template_files: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Initialize a new workspace with optional template files."""
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
        """Clean up all files for a workspace."""
        deleted = await self.delete_prefix(workspace_id)
        return {
            "workspace_id": workspace_id,
            "files_deleted": deleted,
        }
