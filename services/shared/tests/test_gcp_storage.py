"""Comprehensive tests for GCS storage client."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.cloud.exceptions import NotFound

from podex_shared.gcp.storage import GCSClient, WorkspaceGCSClient


class TestGCSClientInit:
    """Tests for GCSClient initialization."""

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_init_without_emulator(self, mock_client_class: MagicMock) -> None:
        """Test initialization in production mode (no endpoint_url)."""
        client = GCSClient(bucket="test-bucket", prefix="workspaces", project_id="test-project")

        assert client.bucket_name == "test-bucket"
        assert client.prefix == "workspaces"
        assert client.project_id == "test-project"
        assert client.endpoint_url is None
        assert client._bucket is None

        # Should use production client
        mock_client_class.assert_called_once_with(project="test-project")

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_init_with_emulator(self, mock_client_class: MagicMock) -> None:
        """Test initialization with emulator endpoint."""
        client = GCSClient(
            bucket="test-bucket",
            prefix="workspaces",
            project_id="dev-project",
            endpoint_url="http://localhost:4443",
        )

        assert client.endpoint_url == "http://localhost:4443"

        # Should use emulator client
        mock_client_class.assert_called_once_with(
            project="dev-project", client_options={"api_endpoint": "http://localhost:4443"}
        )

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_init_emulator_without_project(self, mock_client_class: MagicMock) -> None:
        """Test emulator mode defaults to 'dev-project' if no project_id."""
        GCSClient(bucket="test-bucket", endpoint_url="http://localhost:4443")

        # Should default to "dev-project"
        mock_client_class.assert_called_once_with(
            project="dev-project", client_options={"api_endpoint": "http://localhost:4443"}
        )

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_init_strips_prefix_slashes(self, mock_client_class: MagicMock) -> None:
        """Test that prefix slashes are stripped."""
        client = GCSClient(bucket="test-bucket", prefix="/workspaces/")

        assert client.prefix == "workspaces"


class TestGCSClientKeyGeneration:
    """Tests for _get_key() method."""

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_key_with_prefix(self, mock_client_class: MagicMock) -> None:
        """Test key generation with prefix."""
        client = GCSClient(bucket="test-bucket", prefix="workspaces")

        key = client._get_key("file.txt")
        assert key == "workspaces/file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_key_without_prefix(self, mock_client_class: MagicMock) -> None:
        """Test key generation without prefix."""
        client = GCSClient(bucket="test-bucket", prefix="")

        key = client._get_key("file.txt")
        assert key == "file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_key_multiple_parts(self, mock_client_class: MagicMock) -> None:
        """Test key generation with multiple parts."""
        client = GCSClient(bucket="test-bucket", prefix="workspaces")

        key = client._get_key("user123", "project", "file.txt")
        assert key == "workspaces/user123/project/file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_key_strips_part_slashes(self, mock_client_class: MagicMock) -> None:
        """Test that slashes in parts are stripped."""
        client = GCSClient(bucket="test-bucket", prefix="workspaces")

        key = client._get_key("/user123/", "/project/", "/file.txt/")
        assert key == "workspaces/user123/project/file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_key_skips_empty_parts(self, mock_client_class: MagicMock) -> None:
        """Test that empty parts are skipped."""
        client = GCSClient(bucket="test-bucket", prefix="workspaces")

        key = client._get_key("user123", "", "file.txt")
        assert key == "workspaces/user123/file.txt"


class TestGCSClientBucketProperty:
    """Tests for bucket property."""

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_bucket_lazy_initialization(self, mock_client_class: MagicMock) -> None:
        """Test that bucket is lazily initialized."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket")

        # Bucket should not be initialized yet
        assert client._bucket is None

        # Access bucket property
        bucket = client.bucket

        # Should initialize and cache
        assert bucket == mock_bucket
        mock_client.bucket.assert_called_once_with("test-bucket")

        # Second access should return cached bucket
        bucket2 = client.bucket
        assert bucket2 == bucket
        assert mock_client.bucket.call_count == 1  # Still only called once


class TestGCSClientEnsureBucketExists:
    """Tests for ensure_bucket_exists()."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_ensure_bucket_exists_already_exists(self, mock_client_class: MagicMock) -> None:
        """Test ensure_bucket_exists when bucket already exists."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_client.get_bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket")
        await client.ensure_bucket_exists()

        mock_client.get_bucket.assert_called_once_with("test-bucket")
        mock_client.create_bucket.assert_not_called()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_ensure_bucket_exists_creates_bucket(self, mock_client_class: MagicMock) -> None:
        """Test ensure_bucket_exists creates bucket if not found."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_client.get_bucket.side_effect = NotFound("Bucket not found")
        mock_bucket = MagicMock()
        mock_client.create_bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket")
        await client.ensure_bucket_exists()

        mock_client.get_bucket.assert_called_once_with("test-bucket")
        mock_client.create_bucket.assert_called_once_with("test-bucket", location="us-east1")


class TestGCSClientListOperations:
    """Tests for list operations."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_list_objects_with_results(self, mock_client_class: MagicMock) -> None:
        """Test list_objects with files and directories."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        # Mock blob iterator
        mock_blob1 = MagicMock()
        mock_blob1.name = "workspaces/file1.txt"
        mock_blob1.size = 100
        mock_blob1.updated = datetime(2025, 1, 1)

        mock_blob2 = MagicMock()
        mock_blob2.name = "workspaces/file2.txt"
        mock_blob2.size = 200
        mock_blob2.updated = datetime(2025, 1, 2)

        mock_blobs = MagicMock()
        mock_blobs.__iter__ = MagicMock(return_value=iter([mock_blob1, mock_blob2]))
        mock_blobs.prefixes = ["workspaces/subdir/"]

        mock_client.list_blobs.return_value = mock_blobs

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        objects, prefixes = await client.list_objects("")

        assert len(objects) == 2
        assert objects[0]["Key"] == "workspaces/file1.txt"
        assert objects[0]["Size"] == 100
        assert objects[1]["Key"] == "workspaces/file2.txt"
        assert prefixes == ["workspaces/subdir/"]

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_list_objects_adds_trailing_slash(self, mock_client_class: MagicMock) -> None:
        """Test list_objects adds trailing slash to prefix."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_blobs = MagicMock()
        mock_blobs.__iter__ = MagicMock(return_value=iter([]))
        mock_client.list_blobs.return_value = mock_blobs

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        await client.list_objects("subdir")

        # Should add trailing slash
        mock_client.list_blobs.assert_called_once_with(
            "test-bucket", prefix="workspaces/subdir/", delimiter="/"
        )

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_list_all_objects(self, mock_client_class: MagicMock) -> None:
        """Test list_all_objects without delimiter."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        mock_blob1 = MagicMock()
        mock_blob1.name = "workspaces/file1.txt"
        mock_blob1.size = 100
        mock_blob1.updated = datetime(2025, 1, 1)

        mock_blobs = [mock_blob1]
        mock_client.list_blobs.return_value = mock_blobs

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        # Pass empty string - _get_key will just use prefix
        objects = await client.list_all_objects("")

        assert len(objects) == 1
        assert objects[0]["Key"] == "workspaces/file1.txt"
        # Empty prefix passed to list_all_objects results in just the base prefix with trailing slash
        mock_client.list_blobs.assert_called_once_with("test-bucket", prefix="workspaces/")


class TestGCSClientObjectOperations:
    """Tests for object CRUD operations."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_object_success(self, mock_client_class: MagicMock) -> None:
        """Test get_object with existing object."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.return_value = b"test content"
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        content = await client.get_object("file.txt")

        assert content == b"test content"
        mock_bucket.blob.assert_called_once_with("workspaces/file.txt")

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_object_not_found(self, mock_client_class: MagicMock) -> None:
        """Test get_object raises FileNotFoundError when object doesn't exist."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.side_effect = NotFound("Not found")
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")

        with pytest.raises(FileNotFoundError, match="Object not found: file.txt"):
            await client.get_object("file.txt")

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_object_text(self, mock_client_class: MagicMock) -> None:
        """Test get_object_text decodes bytes to string."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.return_value = b"test content"
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        content = await client.get_object_text("file.txt")

        assert content == "test content"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_put_object_bytes(self, mock_client_class: MagicMock) -> None:
        """Test put_object with bytes content."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.put_object("file.txt", b"test content")

        assert result["key"] == "workspaces/file.txt"
        assert result["size"] == 12
        mock_blob.upload_from_string.assert_called_once()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_put_object_string(self, mock_client_class: MagicMock) -> None:
        """Test put_object with string content."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.put_object("file.txt", "test content")

        assert result["key"] == "workspaces/file.txt"
        assert result["size"] == 12

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_put_object_with_metadata(self, mock_client_class: MagicMock) -> None:
        """Test put_object with metadata."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        metadata = {"user": "test-user"}
        await client.put_object("file.txt", b"test", metadata=metadata)

        assert mock_blob.metadata == metadata

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_delete_object(self, mock_client_class: MagicMock) -> None:
        """Test delete_object."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.delete_object("file.txt")

        assert result is True
        mock_blob.delete.assert_called_once()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_delete_object_not_found_suppressed(self, mock_client_class: MagicMock) -> None:
        """Test delete_object suppresses NotFound errors."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.delete.side_effect = NotFound("Not found")
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.delete_object("file.txt")

        assert result is True  # Should succeed even if not found

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_delete_prefix(self, mock_client_class: MagicMock) -> None:
        """Test delete_prefix deletes all matching objects."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        mock_blob1 = MagicMock()
        mock_blob2 = MagicMock()
        mock_client.list_blobs.return_value = [mock_blob1, mock_blob2]

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        count = await client.delete_prefix("subdir")

        assert count == 2
        mock_blob1.delete.assert_called_once()
        mock_blob2.delete.assert_called_once()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_copy_object(self, mock_client_class: MagicMock) -> None:
        """Test copy_object."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.copy_object("source.txt", "dest.txt")

        assert result["source"] == "workspaces/source.txt"
        assert result["destination"] == "workspaces/dest.txt"
        mock_bucket.copy_blob.assert_called_once()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_move_object(self, mock_client_class: MagicMock) -> None:
        """Test move_object copies then deletes."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.move_object("source.txt", "dest.txt")

        assert result["source"] == "workspaces/source.txt"
        assert result["destination"] == "workspaces/dest.txt"
        # Should copy and delete
        mock_bucket.copy_blob.assert_called_once()
        mock_blob.delete.assert_called()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_object_exists_true(self, mock_client_class: MagicMock) -> None:
        """Test object_exists returns True when object exists."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.exists.return_value = True
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        exists = await client.object_exists("file.txt")

        assert exists is True

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_object_exists_false(self, mock_client_class: MagicMock) -> None:
        """Test object_exists returns False when object doesn't exist."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.exists.return_value = False
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        exists = await client.object_exists("file.txt")

        assert exists is False


class TestGCSClientSignedURL:
    """Tests for signed URL generation."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_signed_url_get(self, mock_client_class: MagicMock) -> None:
        """Test get_signed_url for GET operation."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.generate_signed_url.return_value = "https://storage.googleapis.com/signed"
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        url = await client.get_signed_url("file.txt", operation="GET", expires_in=3600)

        assert url == "https://storage.googleapis.com/signed"
        mock_blob.generate_signed_url.assert_called_once()

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_signed_url_put(self, mock_client_class: MagicMock) -> None:
        """Test get_signed_url for PUT operation."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.generate_signed_url.return_value = "https://storage.googleapis.com/signed"
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = GCSClient(bucket="test-bucket", prefix="workspaces")
        url = await client.get_signed_url("file.txt", operation="PUT", expires_in=1800)

        assert url == "https://storage.googleapis.com/signed"


class TestWorkspaceGCSClient:
    """Tests for WorkspaceGCSClient."""

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_workspace_key(self, mock_client_class: MagicMock) -> None:
        """Test get_workspace_key builds correct path."""
        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")

        key = client.get_workspace_key("ws-123", "file.txt")
        assert key == "ws-123/file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_workspace_key_strips_leading_slash(self, mock_client_class: MagicMock) -> None:
        """Test get_workspace_key strips leading slash."""
        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")

        key = client.get_workspace_key("ws-123", "/file.txt")
        assert key == "ws-123/file.txt"

    @patch("podex_shared.gcp.storage.storage.Client")
    def test_get_workspace_key_removes_workspace_prefix(self, mock_client_class: MagicMock) -> None:
        """Test get_workspace_key removes /workspace prefix."""
        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")

        key = client.get_workspace_key("ws-123", "workspace/file.txt")
        assert key == "ws-123/file.txt"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_list_files(self, mock_client_class: MagicMock) -> None:
        """Test list_files returns files and directories."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        # Mock list response
        mock_blob = MagicMock()
        mock_blob.name = "workspaces/ws-123/file.txt"
        mock_blob.size = 100
        mock_blob.updated = datetime(2025, 1, 1)

        mock_blobs = MagicMock()
        mock_blobs.__iter__ = MagicMock(return_value=iter([mock_blob]))
        mock_blobs.prefixes = ["workspaces/ws-123/subdir/"]
        mock_client.list_blobs.return_value = mock_blobs

        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")
        items = await client.list_files("ws-123", "")

        assert len(items) == 2
        # Check directory item
        dir_item = next((i for i in items if i["type"] == "directory"), None)
        assert dir_item is not None
        assert dir_item["name"] == "subdir"
        assert dir_item["path"] == "/workspace/subdir"

        # Check file item
        file_item = next((i for i in items if i["type"] == "file"), None)
        assert file_item is not None
        assert file_item["name"] == "file.txt"
        assert file_item["path"] == "/workspace/file.txt"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_file_tree_recursive(self, mock_client_class: MagicMock) -> None:
        """Test get_file_tree builds recursive tree."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        # Mock root level
        root_blob = MagicMock()
        root_blob.name = "workspaces/ws-123/file.txt"
        root_blob.size = 100
        root_blob.updated = datetime(2025, 1, 1)

        root_blobs = MagicMock()
        root_blobs.__iter__ = MagicMock(return_value=iter([root_blob]))
        root_blobs.prefixes = ["workspaces/ws-123/subdir/"]

        # Mock subdir level
        sub_blob = MagicMock()
        sub_blob.name = "workspaces/ws-123/subdir/nested.txt"
        sub_blob.size = 50
        sub_blob.updated = datetime(2025, 1, 2)

        sub_blobs = MagicMock()
        sub_blobs.__iter__ = MagicMock(return_value=iter([sub_blob]))
        sub_blobs.prefixes = []

        mock_client.list_blobs.side_effect = [root_blobs, sub_blobs]

        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")
        tree = await client.get_file_tree("ws-123", "", max_depth=2)

        assert len(tree) == 2
        dir_node = next((n for n in tree if n["type"] == "directory"), None)
        assert dir_node is not None
        assert "children" in dir_node
        assert len(dir_node["children"]) == 1

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_get_file_tree_max_depth(self, mock_client_class: MagicMock) -> None:
        """Test get_file_tree respects max_depth."""
        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")
        tree = await client.get_file_tree("ws-123", "", max_depth=0)

        assert tree == []

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_workspace_file_operations(self, mock_client_class: MagicMock) -> None:
        """Test workspace-specific file operations."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_blob.download_as_bytes.return_value = b"content"
        mock_blob.exists.return_value = True
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket

        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")

        # Test get_file
        content = await client.get_file("ws-123", "file.txt")
        assert content == b"content"

        # Test get_file_text
        text = await client.get_file_text("ws-123", "file.txt")
        assert text == "content"

        # Test put_file
        result = await client.put_file("ws-123", "new.txt", b"new content")
        assert result["path"] == "new.txt"

        # Test delete_file
        deleted = await client.delete_file("ws-123", "file.txt")
        assert deleted is True

        # Test file_exists
        exists = await client.file_exists("ws-123", "file.txt")
        assert exists is True

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_initialize_workspace(self, mock_client_class: MagicMock) -> None:
        """Test initialize_workspace creates template files."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client
        mock_bucket = MagicMock()
        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob
        mock_client.bucket.return_value = mock_bucket
        mock_client.get_bucket.return_value = mock_bucket

        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")

        template_files = {
            "README.md": "# Welcome",
            "main.py": "print('Hello')",
        }

        result = await client.initialize_workspace("ws-123", template_files)

        assert result["workspace_id"] == "ws-123"
        assert result["files_created"] == 2

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.storage.storage.Client")
    async def test_cleanup_workspace(self, mock_client_class: MagicMock) -> None:
        """Test cleanup_workspace deletes all workspace files."""
        mock_client = MagicMock()
        mock_client_class.return_value = mock_client

        mock_blob1 = MagicMock()
        mock_blob2 = MagicMock()
        mock_client.list_blobs.return_value = [mock_blob1, mock_blob2]

        client = WorkspaceGCSClient(bucket="test-bucket", prefix="workspaces")
        result = await client.cleanup_workspace("ws-123")

        assert result["workspace_id"] == "ws-123"
        assert result["files_deleted"] == 2
