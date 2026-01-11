"""Comprehensive tests for S3 client utilities."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from podex_shared.aws.s3 import S3Client, WorkspaceS3Client


class TestS3ClientInit:
    """Tests for S3Client initialization."""

    def test_init_defaults(self) -> None:
        """Test S3Client default initialization."""
        client = S3Client(bucket="test-bucket")
        assert client.bucket == "test-bucket"
        assert client.prefix == ""
        assert client.region == "us-east-1"
        assert client.endpoint_url is None

    def test_init_with_prefix(self) -> None:
        """Test S3Client with prefix."""
        client = S3Client(bucket="test-bucket", prefix="workspaces/")
        assert client.prefix == "workspaces"

    def test_init_with_endpoint_url(self) -> None:
        """Test S3Client with custom endpoint (LocalStack)."""
        client = S3Client(
            bucket="test-bucket",
            endpoint_url="http://localhost:4566",
        )
        assert client.endpoint_url == "http://localhost:4566"


class TestS3ClientGetKey:
    """Tests for _get_key method."""

    def test_get_key_no_prefix(self) -> None:
        """Test key building without prefix."""
        client = S3Client(bucket="test")
        key = client._get_key("folder", "file.txt")
        assert key == "folder/file.txt"

    def test_get_key_with_prefix(self) -> None:
        """Test key building with prefix."""
        client = S3Client(bucket="test", prefix="workspaces")
        key = client._get_key("ws-123", "src/main.py")
        assert key == "workspaces/ws-123/src/main.py"

    def test_get_key_strips_slashes(self) -> None:
        """Test that slashes are stripped from parts."""
        client = S3Client(bucket="test", prefix="/prefix/")
        key = client._get_key("/folder/", "/file.txt/")
        assert key == "prefix/folder/file.txt"

    def test_get_key_empty_parts(self) -> None:
        """Test key building with empty parts."""
        client = S3Client(bucket="test")
        key = client._get_key("folder", "", "file.txt")
        assert key == "folder/file.txt"


class TestS3ClientOperations:
    """Tests for S3Client operations."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_get_object(self, mock_s3_client: MagicMock) -> None:
        """Test getting an object."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"file content")
        mock_s3_client.get_object = AsyncMock(return_value={"Body": mock_body})

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            content = await client.get_object("folder/file.txt")

        assert content == b"file content"
        mock_s3_client.get_object.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_object_not_found(self, mock_s3_client: MagicMock) -> None:
        """Test getting a non-existent object."""
        error_response = {"Error": {"Code": "NoSuchKey"}}
        mock_s3_client.get_object = AsyncMock(
            side_effect=ClientError(error_response, "GetObject")
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            with pytest.raises(FileNotFoundError):
                await client.get_object("missing.txt")

    @pytest.mark.asyncio
    async def test_get_object_text(self, mock_s3_client: MagicMock) -> None:
        """Test getting object as text."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"text content")
        mock_s3_client.get_object = AsyncMock(return_value={"Body": mock_body})

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            text = await client.get_object_text("file.txt")

        assert text == "text content"

    @pytest.mark.asyncio
    async def test_put_object_bytes(self, mock_s3_client: MagicMock) -> None:
        """Test putting bytes object."""
        mock_s3_client.put_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.put_object("test.txt", b"content")

        assert result["key"] == "test.txt"
        assert result["size"] == 7
        mock_s3_client.put_object.assert_called_once()

    @pytest.mark.asyncio
    async def test_put_object_string(self, mock_s3_client: MagicMock) -> None:
        """Test putting string object (auto-encoded)."""
        mock_s3_client.put_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.put_object("test.txt", "string content")

        assert result["size"] == len("string content".encode())

    @pytest.mark.asyncio
    async def test_put_object_with_metadata(self, mock_s3_client: MagicMock) -> None:
        """Test putting object with metadata."""
        mock_s3_client.put_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            await client.put_object(
                "test.txt",
                b"content",
                metadata={"author": "test"},
            )

        call_kwargs = mock_s3_client.put_object.call_args[1]
        assert call_kwargs["Metadata"] == {"author": "test"}

    @pytest.mark.asyncio
    async def test_delete_object(self, mock_s3_client: MagicMock) -> None:
        """Test deleting an object."""
        mock_s3_client.delete_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.delete_object("file.txt")

        assert result is True
        mock_s3_client.delete_object.assert_called_once()

    @pytest.mark.asyncio
    async def test_object_exists_true(self, mock_s3_client: MagicMock) -> None:
        """Test checking if object exists (true)."""
        mock_s3_client.head_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.object_exists("file.txt")

        assert result is True

    @pytest.mark.asyncio
    async def test_object_exists_false(self, mock_s3_client: MagicMock) -> None:
        """Test checking if object exists (false)."""
        error_response = {"Error": {"Code": "404"}}
        mock_s3_client.head_object = AsyncMock(
            side_effect=ClientError(error_response, "HeadObject")
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.object_exists("missing.txt")

        assert result is False

    @pytest.mark.asyncio
    async def test_copy_object(self, mock_s3_client: MagicMock) -> None:
        """Test copying an object."""
        mock_s3_client.copy_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.copy_object("source.txt", "dest.txt")

        assert result["source"] == "source.txt"
        assert result["destination"] == "dest.txt"

    @pytest.mark.asyncio
    async def test_move_object(self, mock_s3_client: MagicMock) -> None:
        """Test moving/renaming an object."""
        mock_s3_client.copy_object = AsyncMock()
        mock_s3_client.delete_object = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.move_object("old.txt", "new.txt")

        assert result["source"] == "old.txt"
        assert result["destination"] == "new.txt"
        mock_s3_client.copy_object.assert_called_once()
        mock_s3_client.delete_object.assert_called_once()


class TestS3ClientListOperations:
    """Tests for S3Client list operations."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_list_objects(self, mock_s3_client: MagicMock) -> None:
        """Test listing objects."""
        mock_s3_client.list_objects_v2 = AsyncMock(
            return_value={
                "Contents": [
                    {"Key": "folder/file1.txt", "Size": 100},
                    {"Key": "folder/file2.txt", "Size": 200},
                ],
                "CommonPrefixes": [{"Prefix": "folder/subfolder/"}],
            }
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            objects, prefixes = await client.list_objects("folder")

        assert len(objects) == 2
        assert len(prefixes) == 1

    @pytest.mark.asyncio
    async def test_list_objects_no_such_bucket(
        self, mock_s3_client: MagicMock
    ) -> None:
        """Test listing objects when bucket doesn't exist."""
        error_response = {"Error": {"Code": "NoSuchBucket"}}
        mock_s3_client.list_objects_v2 = AsyncMock(
            side_effect=ClientError(error_response, "ListObjectsV2")
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            objects, prefixes = await client.list_objects("folder")

        assert objects == []
        assert prefixes == []


class TestS3ClientPresignedUrl:
    """Tests for presigned URL generation."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_get_presigned_url(self, mock_s3_client: MagicMock) -> None:
        """Test generating presigned URL."""
        mock_s3_client.generate_presigned_url = AsyncMock(
            return_value="https://s3.amazonaws.com/bucket/key?signature=..."
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            url = await client.get_presigned_url("file.txt", expires_in=7200)

        assert url.startswith("https://")
        mock_s3_client.generate_presigned_url.assert_called_once()


class TestWorkspaceS3Client:
    """Tests for WorkspaceS3Client."""

    def test_get_workspace_key(self) -> None:
        """Test workspace key generation."""
        client = WorkspaceS3Client(bucket="test-bucket", prefix="workspaces")
        key = client.get_workspace_key("ws-123", "/src/main.py")
        assert key == "ws-123/src/main.py"

    def test_get_workspace_key_strips_prefix(self) -> None:
        """Test that /workspace prefix is stripped."""
        client = WorkspaceS3Client(bucket="test-bucket")
        key = client.get_workspace_key("ws-123", "/workspace/src/main.py")
        assert key == "ws-123/src/main.py"

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_get_file(self, mock_s3_client: MagicMock) -> None:
        """Test getting workspace file."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"file content")
        mock_s3_client.get_object = AsyncMock(return_value={"Body": mock_body})

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            content = await client.get_file("ws-123", "/src/main.py")

        assert content == b"file content"

    @pytest.mark.asyncio
    async def test_put_file(self, mock_s3_client: MagicMock) -> None:
        """Test putting workspace file."""
        mock_s3_client.put_object = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.put_file("ws-123", "/src/main.py", b"content")

        assert result["path"] == "/src/main.py"

    @pytest.mark.asyncio
    async def test_delete_file(self, mock_s3_client: MagicMock) -> None:
        """Test deleting workspace file."""
        mock_s3_client.delete_object = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.delete_file("ws-123", "/src/main.py")

        assert result is True

    @pytest.mark.asyncio
    async def test_file_exists(self, mock_s3_client: MagicMock) -> None:
        """Test checking if workspace file exists."""
        mock_s3_client.head_object = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.file_exists("ws-123", "/src/main.py")

        assert result is True

    @pytest.mark.asyncio
    async def test_get_file_text(self, mock_s3_client: MagicMock) -> None:
        """Test getting workspace file as text."""
        mock_body = MagicMock()
        mock_body.read = AsyncMock(return_value=b"text content")
        mock_s3_client.get_object = AsyncMock(return_value={"Body": mock_body})

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            content = await client.get_file_text("ws-123", "/src/main.py")

        assert content == "text content"

    @pytest.mark.asyncio
    async def test_list_files(self, mock_s3_client: MagicMock) -> None:
        """Test listing workspace files."""
        mock_s3_client.list_objects_v2 = AsyncMock(
            return_value={
                "Contents": [
                    {"Key": "ws-123/file1.txt", "Size": 100},
                    {"Key": "ws-123/file2.py", "Size": 200},
                ],
                "CommonPrefixes": [{"Prefix": "ws-123/subfolder/"}],
            }
        )

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            items = await client.list_files("ws-123", "")

        # Should have 2 files and 1 directory
        assert len(items) == 3
        file_items = [i for i in items if i["type"] == "file"]
        dir_items = [i for i in items if i["type"] == "directory"]
        assert len(file_items) == 2
        assert len(dir_items) == 1


class TestS3ClientEnsureBucket:
    """Tests for ensure_bucket_exists method."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_ensure_bucket_exists_already(self, mock_s3_client: MagicMock) -> None:
        """Test bucket already exists."""
        mock_s3_client.head_bucket = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            await client.ensure_bucket_exists()

        mock_s3_client.head_bucket.assert_called_once()
        mock_s3_client.create_bucket.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensure_bucket_creates_bucket(
        self, mock_s3_client: MagicMock
    ) -> None:
        """Test creating bucket when doesn't exist."""
        error_response = {"Error": {"Code": "404"}}
        mock_s3_client.head_bucket = AsyncMock(
            side_effect=ClientError(error_response, "HeadBucket")
        )
        mock_s3_client.create_bucket = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            await client.ensure_bucket_exists()

        mock_s3_client.create_bucket.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_bucket_creates_with_location(
        self, mock_s3_client: MagicMock
    ) -> None:
        """Test creating bucket with location constraint for non us-east-1."""
        error_response = {"Error": {"Code": "NoSuchBucket"}}
        mock_s3_client.head_bucket = AsyncMock(
            side_effect=ClientError(error_response, "HeadBucket")
        )
        mock_s3_client.create_bucket = AsyncMock()

        client = S3Client(bucket="test-bucket", region="eu-west-1")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            await client.ensure_bucket_exists()

        call_kwargs = mock_s3_client.create_bucket.call_args[1]
        assert "CreateBucketConfiguration" in call_kwargs
        assert call_kwargs["CreateBucketConfiguration"]["LocationConstraint"] == "eu-west-1"


class TestS3ClientListAllObjects:
    """Tests for list_all_objects method."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_list_all_objects(self, mock_s3_client: MagicMock) -> None:
        """Test listing all objects with pagination."""
        # Mock paginator
        mock_paginator = MagicMock()

        async def async_page_generator():
            yield {"Contents": [{"Key": "file1.txt"}]}
            yield {"Contents": [{"Key": "file2.txt"}]}

        mock_paginator.paginate = MagicMock(return_value=async_page_generator())
        mock_s3_client.get_paginator = MagicMock(return_value=mock_paginator)

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            objects = await client.list_all_objects("prefix")

        assert len(objects) == 2


class TestS3ClientDeletePrefix:
    """Tests for delete_prefix method."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_delete_prefix(self, mock_s3_client: MagicMock) -> None:
        """Test deleting all objects with prefix."""
        mock_paginator = MagicMock()

        async def async_page_generator():
            yield {"Contents": [{"Key": "prefix/file1.txt"}, {"Key": "prefix/file2.txt"}]}

        mock_paginator.paginate = MagicMock(return_value=async_page_generator())
        mock_s3_client.get_paginator = MagicMock(return_value=mock_paginator)
        mock_s3_client.delete_objects = AsyncMock()

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            deleted = await client.delete_prefix("prefix")

        assert deleted == 2
        mock_s3_client.delete_objects.assert_called_once()


class TestWorkspaceS3ClientAdvanced:
    """Advanced tests for WorkspaceS3Client."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_delete_directory(self, mock_s3_client: MagicMock) -> None:
        """Test deleting a workspace directory."""
        mock_paginator = MagicMock()

        async def async_page_generator():
            yield {"Contents": [{"Key": "ws-123/folder/file1.txt"}]}

        mock_paginator.paginate = MagicMock(return_value=async_page_generator())
        mock_s3_client.get_paginator = MagicMock(return_value=mock_paginator)
        mock_s3_client.delete_objects = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            deleted = await client.delete_directory("ws-123", "/folder")

        assert deleted == 1

    @pytest.mark.asyncio
    async def test_initialize_workspace(self, mock_s3_client: MagicMock) -> None:
        """Test initializing a new workspace."""
        mock_s3_client.head_bucket = AsyncMock()
        mock_s3_client.put_object = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.initialize_workspace(
                "ws-123",
                template_files={
                    "README.md": "# Welcome",
                    "src/main.py": "print('hello')",
                },
            )

        assert result["workspace_id"] == "ws-123"
        assert result["files_created"] == 2

    @pytest.mark.asyncio
    async def test_initialize_workspace_no_templates(
        self, mock_s3_client: MagicMock
    ) -> None:
        """Test initializing workspace without templates."""
        mock_s3_client.head_bucket = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.initialize_workspace("ws-123")

        assert result["files_created"] == 0

    @pytest.mark.asyncio
    async def test_cleanup_workspace(self, mock_s3_client: MagicMock) -> None:
        """Test cleaning up a workspace."""
        mock_paginator = MagicMock()

        async def async_page_generator():
            yield {
                "Contents": [
                    {"Key": "ws-123/file1.txt"},
                    {"Key": "ws-123/file2.txt"},
                    {"Key": "ws-123/src/main.py"},
                ]
            }

        mock_paginator.paginate = MagicMock(return_value=async_page_generator())
        mock_s3_client.get_paginator = MagicMock(return_value=mock_paginator)
        mock_s3_client.delete_objects = AsyncMock()

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            result = await client.cleanup_workspace("ws-123")

        assert result["workspace_id"] == "ws-123"
        assert result["files_deleted"] == 3

    @pytest.mark.asyncio
    async def test_get_file_tree(self, mock_s3_client: MagicMock) -> None:
        """Test getting recursive file tree."""
        mock_s3_client.list_objects_v2 = AsyncMock(
            return_value={
                "Contents": [{"Key": "ws-123/file.txt", "Size": 100}],
                "CommonPrefixes": [],
            }
        )

        client = WorkspaceS3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            tree = await client.get_file_tree("ws-123", "", max_depth=1)

        assert len(tree) == 1
        assert tree[0]["name"] == "file.txt"
        assert tree[0]["type"] == "file"

    @pytest.mark.asyncio
    async def test_get_file_tree_max_depth_zero(
        self, mock_s3_client: MagicMock
    ) -> None:
        """Test file tree with zero max depth."""
        client = WorkspaceS3Client(bucket="test-bucket")
        tree = await client.get_file_tree("ws-123", "", max_depth=0)

        assert tree == []


class TestS3ClientGetObject404:
    """Tests for get_object with 404 error code."""

    @pytest.fixture
    def mock_s3_client(self) -> MagicMock:
        """Create a mock S3 client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_get_object_404_error(self, mock_s3_client: MagicMock) -> None:
        """Test getting object with 404 error code."""
        error_response = {"Error": {"Code": "404"}}
        mock_s3_client.get_object = AsyncMock(
            side_effect=ClientError(error_response, "GetObject")
        )

        client = S3Client(bucket="test-bucket")
        with patch.object(client, "_get_client", return_value=mock_s3_client):
            with pytest.raises(FileNotFoundError):
                await client.get_object("missing.txt")
