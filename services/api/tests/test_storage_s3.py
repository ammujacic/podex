"""Comprehensive tests for S3 storage service."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from src.exceptions import FileNotFoundInStorageError
from src.storage.s3 import S3Storage, get_storage


class TestS3StorageInit:
    """Tests for S3Storage initialization."""

    def test_init_with_all_params(self) -> None:
        """Test initialization with all parameters."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-west-2",
            endpoint_url="http://localhost:4566",
        )
        assert storage.bucket == "test-bucket"
        assert storage.prefix == "workspaces"
        assert storage.region == "us-west-2"
        assert storage.endpoint_url == "http://localhost:4566"

    def test_init_without_endpoint(self) -> None:
        """Test initialization without custom endpoint."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )
        assert storage.endpoint_url is None


class TestGetKey:
    """Tests for _get_key method."""

    def test_get_key_simple_path(self) -> None:
        """Test key generation for simple path."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )
        key = storage._get_key("ws-123", "src/app.tsx")
        assert key == "workspaces/ws-123/src/app.tsx"

    def test_get_key_leading_slash(self) -> None:
        """Test key generation strips leading slash."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )
        key = storage._get_key("ws-123", "/src/app.tsx")
        assert key == "workspaces/ws-123/src/app.tsx"

    def test_get_key_workspace_prefix(self) -> None:
        """Test key generation removes /workspace prefix."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )
        key = storage._get_key("ws-123", "/workspace/src/app.tsx")
        assert key == "workspaces/ws-123/src/app.tsx"

    def test_get_key_nested_path(self) -> None:
        """Test key generation for nested path."""
        storage = S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )
        key = storage._get_key("ws-123", "src/components/Button.tsx")
        assert key == "workspaces/ws-123/src/components/Button.tsx"


class TestListFiles:
    """Tests for list_files method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_list_files_success(self, storage: S3Storage) -> None:
        """Test successful file listing."""
        mock_response = {
            "CommonPrefixes": [{"Prefix": "workspaces/ws-123/src/"}],
            "Contents": [
                {
                    "Key": "workspaces/ws-123/package.json",
                    "Size": 1024,
                    "LastModified": "2024-01-01T00:00:00Z",
                }
            ],
        }

        mock_client = MagicMock()
        mock_client.list_objects_v2 = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.list_files("ws-123", "")

        assert len(result) == 2
        assert any(item["type"] == "directory" for item in result)
        assert any(item["type"] == "file" for item in result)

    @pytest.mark.asyncio
    async def test_list_files_no_such_bucket(self, storage: S3Storage) -> None:
        """Test file listing when bucket doesn't exist."""
        mock_client = MagicMock()
        mock_client.list_objects_v2 = AsyncMock(
            side_effect=ClientError(
                {"Error": {"Code": "NoSuchBucket"}},
                "ListObjectsV2",
            ),
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.list_files("ws-123", "")

        assert result == []


class TestGetFile:
    """Tests for get_file method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_get_file_success(self, storage: S3Storage) -> None:
        """Test successful file retrieval."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"file content")

        mock_client = MagicMock()
        mock_client.get_object = AsyncMock(return_value={"Body": mock_body})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.get_file("ws-123", "src/app.tsx")

        assert result == b"file content"

    @pytest.mark.asyncio
    async def test_get_file_not_found(self, storage: S3Storage) -> None:
        """Test file not found raises exception."""
        mock_client = MagicMock()
        mock_client.get_object = AsyncMock(
            side_effect=ClientError(
                {"Error": {"Code": "NoSuchKey"}},
                "GetObject",
            ),
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            with pytest.raises(FileNotFoundInStorageError):
                await storage.get_file("ws-123", "nonexistent.txt")


class TestGetFileText:
    """Tests for get_file_text method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_get_file_text_success(self, storage: S3Storage) -> None:
        """Test successful text file retrieval."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"const x = 1;")

        mock_client = MagicMock()
        mock_client.get_object = AsyncMock(return_value={"Body": mock_body})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.get_file_text("ws-123", "src/app.tsx")

        assert result == "const x = 1;"


class TestPutFile:
    """Tests for put_file method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_put_file_bytes(self, storage: S3Storage) -> None:
        """Test putting file with bytes content."""
        mock_client = MagicMock()
        mock_client.put_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.put_file("ws-123", "test.txt", b"content")

        assert result["path"] == "test.txt"
        assert result["size"] == 7

    @pytest.mark.asyncio
    async def test_put_file_string(self, storage: S3Storage) -> None:
        """Test putting file with string content."""
        mock_client = MagicMock()
        mock_client.put_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.put_file("ws-123", "test.txt", "content")

        assert result["path"] == "test.txt"
        assert result["size"] == 7

    @pytest.mark.asyncio
    async def test_put_file_with_content_type(self, storage: S3Storage) -> None:
        """Test putting file with explicit content type."""
        mock_client = MagicMock()
        mock_client.put_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.put_file(
                "ws-123",
                "test.json",
                '{"key": "value"}',
                content_type="application/json",
            )

        assert result["content_type"] == "application/json"


class TestDeleteFile:
    """Tests for delete_file method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_delete_file_success(self, storage: S3Storage) -> None:
        """Test successful file deletion."""
        mock_client = MagicMock()
        mock_client.delete_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.delete_file("ws-123", "test.txt")

        assert result is True


class TestFileExists:
    """Tests for file_exists method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_file_exists_true(self, storage: S3Storage) -> None:
        """Test file exists returns True."""
        mock_client = MagicMock()
        mock_client.head_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.file_exists("ws-123", "test.txt")

        assert result is True

    @pytest.mark.asyncio
    async def test_file_exists_false(self, storage: S3Storage) -> None:
        """Test file not exists returns False."""
        mock_client = MagicMock()
        mock_client.head_object = AsyncMock(
            side_effect=ClientError(
                {"Error": {"Code": "404"}},
                "HeadObject",
            ),
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.file_exists("ws-123", "nonexistent.txt")

        assert result is False


class TestCopyFile:
    """Tests for copy_file method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_copy_file_success(self, storage: S3Storage) -> None:
        """Test successful file copy."""
        mock_client = MagicMock()
        mock_client.copy_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.copy_file("ws-123", "src.txt", "dest.txt")

        assert result["source"] == "src.txt"
        assert result["destination"] == "dest.txt"


class TestMoveFile:
    """Tests for move_file method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_move_file_success(self, storage: S3Storage) -> None:
        """Test successful file move (copy + delete)."""
        mock_client = MagicMock()
        mock_client.copy_object = AsyncMock(return_value={})
        mock_client.delete_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.move_file("ws-123", "old.txt", "new.txt")

        assert result["source"] == "old.txt"
        assert result["destination"] == "new.txt"


class TestInitializeWorkspace:
    """Tests for initialize_workspace method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_initialize_workspace_empty(self, storage: S3Storage) -> None:
        """Test workspace initialization without template files."""
        mock_client = MagicMock()
        mock_client.head_bucket = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.initialize_workspace("ws-123")

        assert result["workspace_id"] == "ws-123"
        assert result["files_created"] == 0

    @pytest.mark.asyncio
    async def test_initialize_workspace_with_templates(self, storage: S3Storage) -> None:
        """Test workspace initialization with template files."""
        mock_client = MagicMock()
        mock_client.head_bucket = AsyncMock(return_value={})
        mock_client.put_object = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        template_files = {
            "index.js": "console.log('hello');",
            "package.json": '{"name": "test"}',
        }

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.initialize_workspace("ws-123", template_files)

        assert result["workspace_id"] == "ws-123"
        assert result["files_created"] == 2


class TestCleanupWorkspace:
    """Tests for cleanup_workspace method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_cleanup_workspace(self, storage: S3Storage) -> None:
        """Test workspace cleanup."""
        # Create an async generator for paginator
        async def mock_pages() -> Any:
            yield {"Contents": [{"Key": "key1"}, {"Key": "key2"}]}

        mock_paginator = MagicMock()
        mock_paginator.paginate = MagicMock(return_value=mock_pages())

        mock_client = MagicMock()
        mock_client.get_paginator = MagicMock(return_value=mock_paginator)
        mock_client.delete_objects = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.cleanup_workspace("ws-123")

        assert result["workspace_id"] == "ws-123"
        assert result["files_deleted"] == 2


class TestGetStorage:
    """Tests for get_storage function."""

    def test_get_storage_returns_s3storage(self) -> None:
        """Test get_storage returns S3Storage instance."""
        # Clear cache first
        get_storage.cache_clear()
        storage = get_storage()
        assert isinstance(storage, S3Storage)

    def test_get_storage_is_cached(self) -> None:
        """Test get_storage returns cached instance."""
        get_storage.cache_clear()
        storage1 = get_storage()
        storage2 = get_storage()
        assert storage1 is storage2


class TestEnsureBucketExists:
    """Tests for ensure_bucket_exists method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_ensure_bucket_exists_already_exists(self, storage: S3Storage) -> None:
        """Test when bucket already exists."""
        mock_client = MagicMock()
        mock_client.head_bucket = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            await storage.ensure_bucket_exists()

        mock_client.head_bucket.assert_called_once()
        # create_bucket should not be called
        assert not hasattr(mock_client, "create_bucket") or not mock_client.create_bucket.called

    @pytest.mark.asyncio
    async def test_ensure_bucket_exists_creates_bucket(self, storage: S3Storage) -> None:
        """Test bucket creation when not exists."""
        mock_client = MagicMock()
        mock_client.head_bucket = AsyncMock(
            side_effect=ClientError(
                {"Error": {"Code": "404"}},
                "HeadBucket",
            ),
        )
        mock_client.create_bucket = AsyncMock(return_value={})
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            await storage.ensure_bucket_exists()

        mock_client.create_bucket.assert_called_once()


class TestGetFileTree:
    """Tests for get_file_tree method."""

    @pytest.fixture
    def storage(self) -> S3Storage:
        """Create S3Storage instance."""
        return S3Storage(
            bucket="test-bucket",
            prefix="workspaces",
            region="us-east-1",
        )

    @pytest.mark.asyncio
    async def test_get_file_tree_max_depth_zero(self, storage: S3Storage) -> None:
        """Test file tree returns empty at max_depth=0."""
        result = await storage.get_file_tree("ws-123", "", max_depth=0)
        assert result == []

    @pytest.mark.asyncio
    async def test_get_file_tree_with_files(self, storage: S3Storage) -> None:
        """Test file tree with files."""
        mock_response = {
            "CommonPrefixes": [],
            "Contents": [
                {"Key": "workspaces/ws-123/app.tsx", "Size": 100},
            ],
        }

        mock_client = MagicMock()
        mock_client.list_objects_v2 = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch.object(storage, "_get_client", return_value=mock_client):
            result = await storage.get_file_tree("ws-123", "", max_depth=1)

        assert len(result) == 1
        assert result[0]["type"] == "file"
