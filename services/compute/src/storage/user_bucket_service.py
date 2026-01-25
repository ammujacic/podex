"""User bucket service for per-user GCS storage management.

Manages per-user GCS buckets for workspace storage with:
- Lazy bucket creation on first workspace
- Bucket structure initialization
- IAM policy management
"""

from __future__ import annotations

import asyncio
from typing import Any

import structlog
from google.cloud import storage  # type: ignore[import-untyped,attr-defined]
from google.cloud.exceptions import Conflict, NotFound  # type: ignore[import-untyped]

logger = structlog.get_logger()


class UserBucketService:
    """Manages per-user GCS buckets for workspace storage.

    Each user gets their own bucket with the structure:
        gs://podex-{env}-user-{user_id_short}/
        ├── dotfiles/           # User dotfiles (→ /home/dev via symlinks)
        └── workspaces/         # Workspace data
            └── {workspace_id}/ # Per-workspace files
    """

    def __init__(
        self,
        project_id: str,
        region: str,
        env: str,
        endpoint_url: str | None = None,
    ) -> None:
        """Initialize UserBucketService.

        Args:
            project_id: GCP project ID
            region: GCS bucket region (e.g., "us-east1")
            env: Environment name (e.g., "dev", "prod")
            endpoint_url: Custom endpoint URL for emulator (e.g., "http://localhost:4443")
        """
        self._project_id = project_id
        self._region = region
        self._env = env
        self._endpoint_url = endpoint_url

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

        logger.info(
            "UserBucketService initialized",
            project_id=project_id,
            region=region,
            env=env,
            emulator=bool(endpoint_url),
        )

    def get_bucket_name(self, user_id: str) -> str:
        """Generate bucket name for a user.

        Format: podex-{env}-user-{user_id_prefix}
        Uses first 8 characters of UUID for readability.

        Args:
            user_id: User UUID string

        Returns:
            Bucket name string
        """
        # GCS bucket names must be lowercase, 3-63 chars, start with letter/number
        user_prefix = user_id[:8].lower()
        return f"podex-{self._env}-user-{user_prefix}"

    async def ensure_bucket_exists(self, user_id: str) -> str:
        """Create user bucket if it doesn't exist (lazy creation).

        Args:
            user_id: User UUID string

        Returns:
            Bucket name

        Raises:
            Exception: If bucket creation fails
        """
        bucket_name = self.get_bucket_name(user_id)

        def _ensure() -> str:
            try:
                # Check if bucket already exists
                bucket = self._client.get_bucket(bucket_name)
                logger.debug("User bucket already exists", bucket=bucket_name)
                return bucket_name
            except NotFound:
                # Create the bucket
                logger.info("Creating user bucket", bucket=bucket_name, user_id=user_id)
                bucket = self._client.bucket(bucket_name)
                bucket.storage_class = "STANDARD"
                bucket.iam_configuration.uniform_bucket_level_access_enabled = True

                # Set labels for tracking
                bucket.labels = {
                    "env": self._env,
                    "app": "podex",
                    "type": "user-storage",
                    "user-id-prefix": user_id[:8].lower(),
                }

                try:
                    self._client.create_bucket(bucket, location=self._region)
                    logger.info("Created user bucket", bucket=bucket_name)
                except Conflict:
                    # Bucket was created by concurrent request
                    logger.debug("Bucket already exists (race condition)", bucket=bucket_name)

                return bucket_name

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _ensure)

    async def initialize_structure(self, user_id: str) -> None:
        """Create initial directory structure in user bucket.

        Creates marker objects for:
        - dotfiles/
        - workspaces/

        Args:
            user_id: User UUID string
        """
        bucket_name = self.get_bucket_name(user_id)

        def _init_structure() -> None:
            bucket = self._client.bucket(bucket_name)

            # Create directory markers (empty objects ending with /)
            # These help with directory listing in GCS FUSE
            markers = ["dotfiles/.keep", "workspaces/.keep"]

            for marker in markers:
                blob = bucket.blob(marker)
                if not blob.exists():
                    blob.upload_from_string("")
                    logger.debug("Created marker", bucket=bucket_name, marker=marker)

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _init_structure)

        logger.info("Initialized bucket structure", bucket=bucket_name, user_id=user_id)

    async def ensure_workspace_directory(self, user_id: str, workspace_id: str) -> None:
        """Ensure workspace directory exists in user bucket.

        Args:
            user_id: User UUID string
            workspace_id: Workspace ID
        """
        bucket_name = self.get_bucket_name(user_id)

        def _ensure_workspace() -> None:
            bucket = self._client.bucket(bucket_name)
            marker = f"workspaces/{workspace_id}/.keep"
            blob = bucket.blob(marker)
            if not blob.exists():
                blob.upload_from_string("")
                logger.debug(
                    "Created workspace marker",
                    bucket=bucket_name,
                    workspace_id=workspace_id,
                )

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _ensure_workspace)

    async def delete_workspace_directory(self, user_id: str, workspace_id: str) -> int:
        """Delete all files in a workspace directory.

        Args:
            user_id: User UUID string
            workspace_id: Workspace ID

        Returns:
            Number of objects deleted
        """
        bucket_name = self.get_bucket_name(user_id)
        prefix = f"workspaces/{workspace_id}/"

        def _delete() -> int:
            bucket = self._client.bucket(bucket_name)
            blobs = list(bucket.list_blobs(prefix=prefix))
            deleted = 0
            for blob in blobs:
                blob.delete()
                deleted += 1
            return deleted

        loop = asyncio.get_event_loop()
        deleted = await loop.run_in_executor(None, _delete)

        logger.info(
            "Deleted workspace directory",
            bucket=bucket_name,
            workspace_id=workspace_id,
            deleted_count=deleted,
        )
        return deleted

    async def get_workspace_size(self, user_id: str, workspace_id: str) -> dict[str, Any]:
        """Get total size of a workspace directory.

        Args:
            user_id: User UUID string
            workspace_id: Workspace ID

        Returns:
            Dict with total_bytes, total_mb, file_count
        """
        bucket_name = self.get_bucket_name(user_id)
        prefix = f"workspaces/{workspace_id}/"

        def _get_size() -> dict[str, Any]:
            bucket = self._client.bucket(bucket_name)
            total_bytes = 0
            file_count = 0

            try:
                for blob in bucket.list_blobs(prefix=prefix):
                    total_bytes += blob.size or 0
                    file_count += 1
            except NotFound:
                pass

            return {
                "total_bytes": total_bytes,
                "total_mb": round(total_bytes / (1024 * 1024), 2),
                "file_count": file_count,
            }

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _get_size)

    async def get_user_storage_size(self, user_id: str) -> dict[str, Any]:
        """Get total storage used by a user across all workspaces.

        Args:
            user_id: User UUID string

        Returns:
            Dict with total_bytes, total_mb, file_count, workspace_count
        """
        bucket_name = self.get_bucket_name(user_id)

        def _get_total_size() -> dict[str, Any]:
            try:
                bucket = self._client.bucket(bucket_name)
                total_bytes = 0
                file_count = 0
                workspaces: set[str] = set()

                for blob in bucket.list_blobs():
                    total_bytes += blob.size or 0
                    file_count += 1

                    # Count unique workspaces
                    if blob.name.startswith("workspaces/"):
                        parts = blob.name.split("/")
                        if len(parts) > 1:
                            workspaces.add(parts[1])

                return {
                    "total_bytes": total_bytes,
                    "total_mb": round(total_bytes / (1024 * 1024), 2),
                    "file_count": file_count,
                    "workspace_count": len(workspaces),
                }
            except NotFound:
                return {
                    "total_bytes": 0,
                    "total_mb": 0,
                    "file_count": 0,
                    "workspace_count": 0,
                }

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _get_total_size)

    async def delete_bucket(self, user_id: str, force: bool = False) -> bool:
        """Delete user bucket.

        Args:
            user_id: User UUID string
            force: If True, delete all objects first. If False, fail if not empty.

        Returns:
            True if deleted, False if bucket didn't exist
        """
        bucket_name = self.get_bucket_name(user_id)

        def _delete() -> bool:
            try:
                bucket = self._client.get_bucket(bucket_name)

                if force:
                    # Delete all objects first
                    blobs = list(bucket.list_blobs())
                    for blob in blobs:
                        blob.delete()

                bucket.delete()
                logger.info("Deleted user bucket", bucket=bucket_name, user_id=user_id)
                return True
            except NotFound:
                logger.debug("Bucket not found for deletion", bucket=bucket_name)
                return False

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _delete)

    async def bucket_exists(self, user_id: str) -> bool:
        """Check if user bucket exists.

        Args:
            user_id: User UUID string

        Returns:
            True if bucket exists
        """
        bucket_name = self.get_bucket_name(user_id)

        def _exists() -> bool:
            try:
                self._client.get_bucket(bucket_name)
                return True
            except NotFound:
                return False

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _exists)
