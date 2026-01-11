"""Comprehensive tests for AWS Transcribe client."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from podex_shared.aws.transcribe import (
    MockTranscribeClient,
    TranscribeClient,
    TranscriptionJobConfig,
    TranscriptionResult,
    get_transcribe_client,
)


class TestTranscriptionResult:
    """Tests for TranscriptionResult dataclass."""

    def test_transcription_result_required(self) -> None:
        """Test TranscriptionResult with required fields."""
        result = TranscriptionResult(
            text="Hello world",
            confidence=0.95,
            language="en-US",
            duration_ms=1500,
        )
        assert result.text == "Hello world"
        assert result.confidence == 0.95
        assert result.language == "en-US"
        assert result.duration_ms == 1500
        assert result.words == []
        assert result.is_final is True
        assert result.job_name is None

    def test_transcription_result_full(self) -> None:
        """Test TranscriptionResult with all fields."""
        result = TranscriptionResult(
            text="Hello",
            confidence=0.98,
            language="en-US",
            duration_ms=500,
            words=[{"word": "Hello", "start": 0.0, "end": 0.5}],
            is_final=True,
            job_name="job-123",
        )
        assert len(result.words) == 1
        assert result.job_name == "job-123"


class TestTranscriptionJobConfig:
    """Tests for TranscriptionJobConfig dataclass."""

    def test_config_required(self) -> None:
        """Test TranscriptionJobConfig with required fields."""
        config = TranscriptionJobConfig(
            job_name="test-job",
            s3_uri="s3://bucket/audio.webm",
            output_bucket="output-bucket",
            output_key="transcripts/job.json",
        )
        assert config.job_name == "test-job"
        assert config.s3_uri == "s3://bucket/audio.webm"
        assert config.language_code == "en-US"
        assert config.media_format == "webm"

    def test_config_custom(self) -> None:
        """Test TranscriptionJobConfig with custom values."""
        config = TranscriptionJobConfig(
            job_name="test-job",
            s3_uri="s3://bucket/audio.mp3",
            output_bucket="output-bucket",
            output_key="transcripts/job.json",
            language_code="en-GB",
            media_format="mp3",
        )
        assert config.language_code == "en-GB"
        assert config.media_format == "mp3"


class TestTranscribeClientInit:
    """Tests for TranscribeClient initialization."""

    def test_init_defaults(self) -> None:
        """Test TranscribeClient default initialization."""
        client = TranscribeClient()
        assert client.region == "us-east-1"
        assert client.endpoint_url is None

    def test_init_custom(self) -> None:
        """Test TranscribeClient with custom parameters."""
        client = TranscribeClient(
            region="eu-west-1",
            endpoint_url="http://localhost:4566",
        )
        assert client.region == "eu-west-1"
        assert client.endpoint_url == "http://localhost:4566"


class TestTranscribeClientOperations:
    """Tests for TranscribeClient operations."""

    @pytest.fixture
    def mock_transcribe_client(self) -> MagicMock:
        """Create a mock Transcribe client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_start_transcription_job(
        self, mock_transcribe_client: MagicMock
    ) -> None:
        """Test starting a transcription job."""
        mock_transcribe_client.start_transcription_job = AsyncMock(
            return_value={
                "TranscriptionJob": {
                    "TranscriptionJobName": "test-job",
                    "TranscriptionJobStatus": "IN_PROGRESS",
                }
            }
        )

        client = TranscribeClient()
        config = TranscriptionJobConfig(
            job_name="test-job",
            s3_uri="s3://bucket/audio.webm",
            output_bucket="output-bucket",
            output_key="transcripts/job.json",
        )

        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            response = await client.start_transcription_job(config)

        assert response["TranscriptionJob"]["TranscriptionJobName"] == "test-job"
        mock_transcribe_client.start_transcription_job.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_transcription_job(
        self, mock_transcribe_client: MagicMock
    ) -> None:
        """Test getting transcription job status."""
        mock_transcribe_client.get_transcription_job = AsyncMock(
            return_value={
                "TranscriptionJob": {
                    "TranscriptionJobName": "test-job",
                    "TranscriptionJobStatus": "COMPLETED",
                }
            }
        )

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            response = await client.get_transcription_job("test-job")

        assert response["TranscriptionJob"]["TranscriptionJobStatus"] == "COMPLETED"

    @pytest.mark.asyncio
    async def test_delete_transcription_job(
        self, mock_transcribe_client: MagicMock
    ) -> None:
        """Test deleting a transcription job."""
        mock_transcribe_client.delete_transcription_job = AsyncMock()

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            await client.delete_transcription_job("test-job")

        mock_transcribe_client.delete_transcription_job.assert_called_once_with(
            TranscriptionJobName="test-job"
        )

    @pytest.mark.asyncio
    async def test_list_transcription_jobs(
        self, mock_transcribe_client: MagicMock
    ) -> None:
        """Test listing transcription jobs."""
        mock_transcribe_client.list_transcription_jobs = AsyncMock(
            return_value={
                "TranscriptionJobSummaries": [
                    {"TranscriptionJobName": "job-1"},
                    {"TranscriptionJobName": "job-2"},
                ]
            }
        )

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            summaries = await client.list_transcription_jobs()

        assert len(summaries) == 2

    @pytest.mark.asyncio
    async def test_list_transcription_jobs_with_status(
        self, mock_transcribe_client: MagicMock
    ) -> None:
        """Test listing transcription jobs with status filter."""
        mock_transcribe_client.list_transcription_jobs = AsyncMock(
            return_value={"TranscriptionJobSummaries": []}
        )

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            await client.list_transcription_jobs(status="COMPLETED")

        call_kwargs = mock_transcribe_client.list_transcription_jobs.call_args[1]
        assert call_kwargs["Status"] == "COMPLETED"


class TestTranscribeClientWaitForTranscription:
    """Tests for wait_for_transcription method."""

    @pytest.fixture
    def mock_transcribe_client(self) -> MagicMock:
        """Create a mock Transcribe client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_wait_completed(self, mock_transcribe_client: MagicMock) -> None:
        """Test waiting for completed job."""
        mock_transcribe_client.get_transcription_job = AsyncMock(
            return_value={
                "TranscriptionJob": {
                    "TranscriptionJobName": "test-job",
                    "TranscriptionJobStatus": "COMPLETED",
                    "LanguageCode": "en-US",
                    "Transcript": {
                        "TranscriptFileUri": "s3://bucket/transcript.json"
                    },
                }
            }
        )

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            result = await client.wait_for_transcription(
                "test-job", max_attempts=1, delay_seconds=0
            )

        assert result is not None
        assert result.job_name == "test-job"

    @pytest.mark.asyncio
    async def test_wait_failed(self, mock_transcribe_client: MagicMock) -> None:
        """Test waiting for failed job."""
        mock_transcribe_client.get_transcription_job = AsyncMock(
            return_value={
                "TranscriptionJob": {
                    "TranscriptionJobName": "test-job",
                    "TranscriptionJobStatus": "FAILED",
                    "FailureReason": "Audio too short",
                }
            }
        )

        client = TranscribeClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_transcribe_client
            result = await client.wait_for_transcription(
                "test-job", max_attempts=1, delay_seconds=0
            )

        assert result is None


class TestMockTranscribeClient:
    """Tests for MockTranscribeClient."""

    @pytest.mark.asyncio
    async def test_mock_start_job(self) -> None:
        """Test mock starting a transcription job."""
        client = MockTranscribeClient()
        config = TranscriptionJobConfig(
            job_name="test-job",
            s3_uri="s3://bucket/audio.webm",
            output_bucket="output-bucket",
            output_key="transcripts/job.json",
        )

        response = await client.start_transcription_job(config)

        assert response["TranscriptionJob"]["TranscriptionJobName"] == "test-job"
        assert response["TranscriptionJob"]["TranscriptionJobStatus"] == "COMPLETED"

    @pytest.mark.asyncio
    async def test_mock_get_job(self) -> None:
        """Test mock getting job status."""
        client = MockTranscribeClient()
        response = await client.get_transcription_job("any-job")

        assert response["TranscriptionJob"]["TranscriptionJobName"] == "any-job"
        assert response["TranscriptionJob"]["TranscriptionJobStatus"] == "COMPLETED"

    @pytest.mark.asyncio
    async def test_mock_wait_for_transcription(self) -> None:
        """Test mock wait returns immediately."""
        client = MockTranscribeClient()
        result = await client.wait_for_transcription("test-job")

        assert result is not None
        assert "[Mock transcription" in result.text
        assert result.confidence == 0.95
        assert result.is_final is True


class TestGetTranscribeClient:
    """Tests for get_transcribe_client factory function."""

    def test_get_real_client(self) -> None:
        """Test getting real Transcribe client."""
        client = get_transcribe_client(region="us-west-2")
        assert isinstance(client, TranscribeClient)
        assert not isinstance(client, MockTranscribeClient)
        assert client.region == "us-west-2"

    def test_get_mock_client_explicit(self) -> None:
        """Test getting mock client explicitly."""
        client = get_transcribe_client(use_mock=True)
        assert isinstance(client, MockTranscribeClient)

    def test_get_mock_client_with_endpoint(self) -> None:
        """Test that endpoint URL triggers mock client."""
        client = get_transcribe_client(endpoint_url="http://localhost:4566")
        assert isinstance(client, MockTranscribeClient)
