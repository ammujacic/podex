"""S3 storage service for workspace files.

Supports both AWS S3 and LocalStack for local development.
"""

import mimetypes
from contextlib import AbstractAsyncContextManager
from functools import lru_cache
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, Any

import aioboto3
from botocore.exceptions import ClientError

from src.config import settings
from src.exceptions import FileNotFoundInStorageError

if TYPE_CHECKING:
    # S3Client type from aioboto3 - define locally since types-aiobotocore not installed
    from typing import Protocol

    class S3Client(Protocol):
        """Protocol for S3 client operations."""

        async def put_object(self, **kwargs: object) -> dict[str, Any]: ...
        async def get_object(self, **kwargs: object) -> dict[str, Any]: ...
        async def delete_object(self, **kwargs: object) -> dict[str, Any]: ...
        async def list_objects_v2(self, **kwargs: object) -> dict[str, Any]: ...
        async def head_object(self, **kwargs: object) -> dict[str, Any]: ...
        async def delete_objects(self, **kwargs: object) -> dict[str, Any]: ...


class S3Storage:
    """S3 storage service for workspace files."""

    def __init__(
        self,
        bucket: str,
        prefix: str,
        region: str,
        endpoint_url: str | None = None,
    ) -> None:
        """Initialize S3 storage.

        Args:
            bucket: S3 bucket name
            prefix: Base prefix for all keys
            region: AWS region
            endpoint_url: Custom endpoint URL (for LocalStack)
        """
        self.bucket = bucket
        self.prefix = prefix
        self.region = region
        self.endpoint_url = endpoint_url
        self._session = aioboto3.Session()

    def _get_key(self, workspace_id: str, path: str) -> str:
        """Get the full S3 key for a workspace file path.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace (e.g., /workspace/src/app.tsx)

        Returns:
            Full S3 key
        """
        # Normalize path - remove leading /workspace prefix if present
        clean_path = path.lstrip("/")
        clean_path = clean_path.removeprefix("workspace/")  # Remove "workspace/"

        return f"{self.prefix}/{workspace_id}/{clean_path}"

    async def _get_client(self) -> AbstractAsyncContextManager[Any]:
        """Get S3 client context manager."""
        client: AbstractAsyncContextManager[Any] = self._session.client(
            "s3",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        )
        return client

    async def ensure_bucket_exists(self) -> None:
        """Ensure the S3 bucket exists (useful for LocalStack)."""
        async with await self._get_client() as s3:
            try:
                await s3.head_bucket(Bucket=self.bucket)
            except ClientError as e:
                error_code = e.response.get("Error", {}).get("Code", "")
                if error_code in ("404", "NoSuchBucket"):
                    # Create the bucket
                    await s3.create_bucket(
                        Bucket=self.bucket,
                        CreateBucketConfiguration={"LocationConstraint": self.region}
                        if self.region != "us-east-1"
                        else {},
                    )
                else:
                    raise

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

        async with await self._get_client() as s3:
            try:
                response = await s3.list_objects_v2(
                    Bucket=self.bucket,
                    Prefix=prefix,
                    Delimiter="/",
                )
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") == "NoSuchBucket":
                    return []
                raise

            items = []

            # Add directories (common prefixes)
            for cp in response.get("CommonPrefixes", []):
                dir_path = cp["Prefix"].rstrip("/")
                dir_name = PurePosixPath(dir_path).name
                relative_path = dir_path.split(f"{self.prefix}/{workspace_id}/")[-1]
                items.append(
                    {
                        "name": dir_name,
                        "path": f"/workspace/{relative_path}",
                        "type": "directory",
                    },
                )

            # Add files
            for obj in response.get("Contents", []):
                key = obj["Key"]
                # Skip the directory itself
                if key == prefix:
                    continue
                file_name = PurePosixPath(key).name
                relative_path = key.split(f"{self.prefix}/{workspace_id}/")[-1]
                items.append(
                    {
                        "name": file_name,
                        "path": f"/workspace/{relative_path}",
                        "type": "file",
                        "size": obj.get("Size", 0),
                        "last_modified": obj.get("LastModified"),
                    },
                )

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
            FileNotFoundError: If file doesn't exist
        """
        key = self._get_key(workspace_id, path)

        async with await self._get_client() as s3:
            try:
                response = await s3.get_object(Bucket=self.bucket, Key=key)
                content: bytes = await response["Body"].read()
            except ClientError as e:
                error_code = e.response.get("Error", {}).get("Code", "")
                if error_code in ("NoSuchKey", "404"):
                    raise FileNotFoundInStorageError(path) from e
                raise
            else:
                return content

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

        async with await self._get_client() as s3:
            await s3.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=content,
                ContentType=content_type,
            )

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

        async with await self._get_client() as s3:
            await s3.delete_object(Bucket=self.bucket, Key=key)

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

        deleted_count = 0

        async with await self._get_client() as s3:
            # List all objects with prefix
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                objects = page.get("Contents", [])
                if objects:
                    # Delete in batches of 1000 (S3 limit)
                    delete_keys = [{"Key": obj["Key"]} for obj in objects]
                    await s3.delete_objects(
                        Bucket=self.bucket,
                        Delete={"Objects": delete_keys},
                    )
                    deleted_count += len(delete_keys)

        return deleted_count

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

        async with await self._get_client() as s3:
            await s3.copy_object(
                Bucket=self.bucket,
                CopySource={"Bucket": self.bucket, "Key": source_key},
                Key=dest_key,
            )

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

        async with await self._get_client() as s3:
            try:
                await s3.head_object(Bucket=self.bucket, Key=key)
            except ClientError:
                return False
            return True

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
    """Get cached S3 storage instance."""
    return S3Storage(
        bucket=settings.S3_BUCKET,
        prefix=settings.S3_WORKSPACE_PREFIX,
        region=settings.AWS_REGION,
        endpoint_url=settings.AWS_ENDPOINT,
    )
