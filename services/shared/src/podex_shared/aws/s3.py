"""Shared S3 client utilities."""

import mimetypes
from pathlib import PurePosixPath
from typing import Any

import aioboto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger()


class S3Client:
    """Async S3 client for file storage operations.

    Provides a consistent interface for S3 operations across services.
    Supports both AWS S3 and LocalStack for local development.
    """

    def __init__(
        self,
        bucket: str,
        prefix: str = "",
        region: str = "us-east-1",
        endpoint_url: str | None = None,
    ) -> None:
        """Initialize S3 client.

        Args:
            bucket: S3 bucket name
            prefix: Base prefix for all keys (e.g., "workspaces")
            region: AWS region
            endpoint_url: Custom endpoint URL (for LocalStack)
        """
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.region = region
        self.endpoint_url = endpoint_url
        self._session = aioboto3.Session()

    def _get_key(self, *parts: str) -> str:
        """Build an S3 key from parts.

        Args:
            *parts: Key components to join

        Returns:
            Full S3 key with prefix
        """
        # Clean up parts
        clean_parts = []
        for part in parts:
            clean = part.strip("/")
            if clean:
                clean_parts.append(clean)

        key = "/".join(clean_parts)
        if self.prefix:
            return f"{self.prefix}/{key}"
        return key

    async def _get_client(self) -> Any:
        """Get S3 client context manager."""
        return self._session.client(
            "s3",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        )

    async def ensure_bucket_exists(self) -> None:
        """Ensure the S3 bucket exists (useful for LocalStack)."""
        async with await self._get_client() as s3:
            try:
                await s3.head_bucket(Bucket=self.bucket)
            except ClientError as e:
                error_code = e.response.get("Error", {}).get("Code", "")
                if error_code in ("404", "NoSuchBucket"):
                    # Create the bucket
                    create_config = (
                        {"CreateBucketConfiguration": {"LocationConstraint": self.region}}
                        if self.region != "us-east-1"
                        else {}
                    )
                    await s3.create_bucket(Bucket=self.bucket, **create_config)
                    logger.info("Created S3 bucket", bucket=self.bucket)
                else:
                    raise

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

        async with await self._get_client() as s3:
            try:
                response = await s3.list_objects_v2(
                    Bucket=self.bucket,
                    Prefix=full_prefix,
                    Delimiter=delimiter,
                )
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") == "NoSuchBucket":
                    return [], []
                raise

            objects = response.get("Contents", [])
            prefixes = [cp["Prefix"] for cp in response.get("CommonPrefixes", [])]

            return objects, prefixes

    async def list_all_objects(self, prefix: str = "") -> list[dict[str, Any]]:
        """List all objects with a given prefix (paginated).

        Args:
            prefix: Key prefix to filter by

        Returns:
            List of all objects
        """
        full_prefix = self._get_key(prefix)
        all_objects = []

        async with await self._get_client() as s3:
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self.bucket, Prefix=full_prefix):
                all_objects.extend(page.get("Contents", []))

        return all_objects

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

        async with await self._get_client() as s3:
            try:
                response = await s3.get_object(Bucket=self.bucket, Key=full_key)
                body: bytes = await response["Body"].read()
                return body
            except ClientError as e:
                error_code = e.response.get("Error", {}).get("Code", "")
                if error_code in ("NoSuchKey", "404"):
                    raise FileNotFoundError(f"Object not found: {key}") from e
                raise

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

        async with await self._get_client() as s3:
            put_kwargs: dict[str, Any] = {
                "Bucket": self.bucket,
                "Key": full_key,
                "Body": content,
                "ContentType": content_type,
            }
            if metadata:
                put_kwargs["Metadata"] = metadata

            await s3.put_object(**put_kwargs)

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

        async with await self._get_client() as s3:
            await s3.delete_object(Bucket=self.bucket, Key=full_key)

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

        deleted_count = 0

        async with await self._get_client() as s3:
            paginator = s3.get_paginator("list_objects_v2")
            async for page in paginator.paginate(Bucket=self.bucket, Prefix=full_prefix):
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

        async with await self._get_client() as s3:
            await s3.copy_object(
                Bucket=self.bucket,
                CopySource={"Bucket": self.bucket, "Key": full_source},
                Key=full_dest,
            )

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

        async with await self._get_client() as s3:
            try:
                await s3.head_object(Bucket=self.bucket, Key=full_key)
                return True
            except ClientError:
                return False

    async def get_presigned_url(
        self,
        key: str,
        operation: str = "get_object",
        expires_in: int = 3600,
    ) -> str:
        """Generate a presigned URL for an object.

        Args:
            key: Object key (will be prefixed)
            operation: Operation type (get_object, put_object)
            expires_in: URL expiration time in seconds

        Returns:
            Presigned URL
        """
        full_key = self._get_key(key)

        async with await self._get_client() as s3:
            url: str = await s3.generate_presigned_url(
                ClientMethod=operation,
                Params={"Bucket": self.bucket, "Key": full_key},
                ExpiresIn=expires_in,
            )

        return url


class WorkspaceS3Client(S3Client):
    """S3 client specialized for workspace file operations.

    Provides workspace-aware file paths and tree operations.
    """

    def get_workspace_key(self, workspace_id: str, path: str) -> str:
        """Get the S3 key for a workspace file path.

        Args:
            workspace_id: Workspace identifier
            path: File path within workspace

        Returns:
            S3 key (relative to prefix)
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
        self._get_key(ws_key)
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
