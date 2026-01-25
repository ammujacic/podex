"""Comprehensive tests for GCP Speech-to-Text client."""

from unittest.mock import MagicMock, patch

import pytest

from podex_shared.gcp.stt import (
    ENCODING_MAP,
    AsyncTranscriptionConfig,
    MockSpeechClient,
    SpeechClient,
    TranscriptionConfig,
    TranscriptionResult,
    get_speech_client,
)


class TestSpeechClientInit:
    """Tests for SpeechClient initialization."""

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_init_without_project(self, mock_client_class: MagicMock) -> None:
        """Test initialization without project_id."""
        client = SpeechClient()

        assert client.project_id is None
        mock_client_class.assert_called_once()

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_init_with_project(self, mock_client_class: MagicMock) -> None:
        """Test initialization with project_id."""
        client = SpeechClient(project_id="test-project")

        assert client.project_id == "test-project"
        mock_client_class.assert_called_once()


class TestEncodingMapping:
    """Tests for _get_encoding() method."""

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_webm(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for webm format."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("webm")
        assert encoding == speech.RecognitionConfig.AudioEncoding.WEBM_OPUS

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_mp3(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for mp3 format."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("mp3")
        assert encoding == speech.RecognitionConfig.AudioEncoding.MP3

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_wav(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for wav format."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("wav")
        assert encoding == speech.RecognitionConfig.AudioEncoding.LINEAR16

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_flac(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for flac format."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("flac")
        assert encoding == speech.RecognitionConfig.AudioEncoding.FLAC

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_case_insensitive(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping is case-insensitive."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("MP3")
        assert encoding == speech.RecognitionConfig.AudioEncoding.MP3

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_encoding_unknown(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping returns UNSPECIFIED for unknown format."""
        client = SpeechClient()
        from google.cloud import speech

        encoding = client._get_encoding("unknown")
        assert encoding == speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED


class TestTranscribeAudio:
    """Tests for transcribe_audio() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_transcribe_audio_default_config(
        self, mock_client_class: MagicMock, mock_speech_client: MagicMock
    ) -> None:
        """Test transcribe_audio with default configuration."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Use the fixture's mock response
        mock_client_instance.recognize = mock_speech_client.recognize

        client = SpeechClient()
        result = await client.transcribe_audio(b"fake-audio-data")

        assert isinstance(result, TranscriptionResult)
        assert result.text == "Hello world"
        assert result.confidence == 0.95
        assert len(result.words) == 2

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_transcribe_audio_custom_config(
        self, mock_client_class: MagicMock, mock_speech_client: MagicMock
    ) -> None:
        """Test transcribe_audio with custom configuration."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.recognize = mock_speech_client.recognize

        client = SpeechClient()
        config = TranscriptionConfig(
            language_code="es-ES",
            sample_rate_hertz=16000,
            model="phone_call",
        )

        result = await client.transcribe_audio(b"fake-audio-data", config)

        assert result.language == "es-ES"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_transcribe_audio_with_alternatives(self, mock_client_class: MagicMock) -> None:
        """Test transcribe_audio processes alternative transcriptions."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock response with alternatives
        alt1 = MagicMock()
        alt1.transcript = "Hello world"
        alt1.confidence = 0.95
        alt1.words = []

        alt2 = MagicMock()
        alt2.transcript = "Hello word"
        alt2.confidence = 0.85

        result = MagicMock()
        result.alternatives = [alt1, alt2]

        response = MagicMock()
        response.results = [result]

        mock_client_instance.recognize.return_value = response

        client = SpeechClient()
        transcription = await client.transcribe_audio(b"fake-audio-data")

        assert transcription.text == "Hello world"
        assert "Hello word" in transcription.alternatives


class TestTranscribeGCSAsync:
    """Tests for transcribe_gcs_async() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_transcribe_gcs_async(self, mock_client_class: MagicMock) -> None:
        """Test async GCS transcription job creation."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock operation
        mock_operation = MagicMock()
        mock_operation.operation.name = "operations/test-operation-123"
        mock_client_instance.long_running_recognize.return_value = mock_operation

        client = SpeechClient()
        config = AsyncTranscriptionConfig(
            gcs_uri="gs://test-bucket/audio.webm",
            language_code="en-US",
            encoding="webm",
        )

        operation_name = await client.transcribe_gcs_async(config)

        assert operation_name == "operations/test-operation-123"
        mock_client_instance.long_running_recognize.assert_called_once()


class TestGetAsyncResult:
    """Tests for get_async_result() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_get_async_result_not_done(self, mock_client_class: MagicMock) -> None:
        """Test get_async_result returns None when operation not done."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock operation not done
        mock_operation = MagicMock()
        mock_operation.done = False

        mock_operations_client = MagicMock()
        mock_operations_client.get_operation.return_value = mock_operation
        mock_client_instance._transport.operations_client = mock_operations_client

        client = SpeechClient()
        result = await client.get_async_result("operations/test-123")

        assert result is None

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    @patch("podex_shared.gcp.stt.speech.LongRunningRecognizeResponse")
    async def test_get_async_result_done(
        self, mock_response_class: MagicMock, mock_client_class: MagicMock
    ) -> None:
        """Test get_async_result returns result when operation done."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock word info
        mock_word = MagicMock()
        mock_word.word = "test"
        mock_word.start_time.total_seconds.return_value = 0.0
        mock_word.end_time.total_seconds.return_value = 0.5

        # Mock alternative
        mock_alternative = MagicMock()
        mock_alternative.transcript = "test transcript"
        mock_alternative.confidence = 0.9
        mock_alternative.words = [mock_word]

        # Mock result
        mock_result = MagicMock()
        mock_result.alternatives = [mock_alternative]

        # Mock response
        mock_response = MagicMock()
        mock_response.results = [mock_result]
        mock_response_class.return_value = mock_response

        # Mock operation done
        mock_operation = MagicMock()
        mock_operation.done = True
        mock_operation.response.Unpack = MagicMock()

        mock_operations_client = MagicMock()
        mock_operations_client.get_operation.return_value = mock_operation
        mock_client_instance._transport.operations_client = mock_operations_client

        client = SpeechClient()
        result = await client.get_async_result("operations/test-123")

        assert result is not None
        assert isinstance(result, TranscriptionResult)


class TestWaitForTranscription:
    """Tests for wait_for_transcription() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_wait_for_transcription_immediate_success(
        self, mock_client_class: MagicMock
    ) -> None:
        """Test wait_for_transcription returns immediately if result ready."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        client = SpeechClient()

        # Mock get_async_result to return result immediately
        expected_result = TranscriptionResult(
            text="test", confidence=0.9, language="en-US", duration_ms=1000
        )

        with patch.object(client, "get_async_result", return_value=expected_result):
            result = await client.wait_for_transcription("operations/test", max_attempts=1)

        assert result == expected_result

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    async def test_wait_for_transcription_timeout(self, mock_client_class: MagicMock) -> None:
        """Test wait_for_transcription returns None on timeout."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        client = SpeechClient()

        # Mock get_async_result to always return None
        with patch.object(client, "get_async_result", return_value=None):
            result = await client.wait_for_transcription(
                "operations/test", max_attempts=2, delay_seconds=0.01
            )

        assert result is None


class TestMockSpeechClient:
    """Tests for MockSpeechClient."""

    def test_mock_client_init(self) -> None:
        """Test MockSpeechClient initialization."""
        client = MockSpeechClient(project_id="test-project")

        assert client.project_id == "test-project"
        assert client._client is None
        assert client._jobs == {}

    @pytest.mark.asyncio
    async def test_mock_transcribe_audio(self) -> None:
        """Test MockSpeechClient transcribe_audio."""
        client = MockSpeechClient()

        result = await client.transcribe_audio(b"fake-audio")

        assert isinstance(result, TranscriptionResult)
        assert result.text == "[Mock transcription - voice features in dev mode]"
        assert result.confidence == 0.95
        assert len(result.words) == 2

    @pytest.mark.asyncio
    async def test_mock_transcribe_audio_custom_config(self) -> None:
        """Test MockSpeechClient respects config language."""
        client = MockSpeechClient()
        config = TranscriptionConfig(language_code="es-ES")

        result = await client.transcribe_audio(b"fake-audio", config)

        assert result.language == "es-ES"

    @pytest.mark.asyncio
    async def test_mock_transcribe_gcs_async(self) -> None:
        """Test MockSpeechClient async GCS transcription."""
        client = MockSpeechClient()
        config = AsyncTranscriptionConfig(gcs_uri="gs://test/audio.webm")

        operation_name = await client.transcribe_gcs_async(config)

        assert "mock-operation" in operation_name
        assert operation_name in client._jobs

    @pytest.mark.asyncio
    async def test_mock_get_async_result(self) -> None:
        """Test MockSpeechClient get_async_result."""
        client = MockSpeechClient()
        config = AsyncTranscriptionConfig(gcs_uri="gs://test/audio.webm", language_code="en-GB")

        operation_name = await client.transcribe_gcs_async(config)
        result = await client.get_async_result(operation_name)

        assert result is not None
        assert result.text == "[Mock transcription from GCS audio file]"
        assert result.language == "en-GB"

    @pytest.mark.asyncio
    async def test_mock_get_async_result_unknown_operation(self) -> None:
        """Test MockSpeechClient returns None for unknown operation."""
        client = MockSpeechClient()

        result = await client.get_async_result("unknown-operation")

        assert result is None

    @pytest.mark.asyncio
    async def test_mock_wait_for_transcription(self) -> None:
        """Test MockSpeechClient wait_for_transcription returns immediately."""
        client = MockSpeechClient()
        config = AsyncTranscriptionConfig(gcs_uri="gs://test/audio.webm")

        operation_name = await client.transcribe_gcs_async(config)
        result = await client.wait_for_transcription(operation_name)

        assert result is not None
        assert result.text == "[Mock transcription from GCS audio file]"


class TestGetSpeechClient:
    """Tests for get_speech_client() factory function."""

    @patch("podex_shared.gcp.stt.speech.SpeechClient")
    def test_get_speech_client_real(self, mock_client_class: MagicMock) -> None:
        """Test get_speech_client returns SpeechClient by default."""
        client = get_speech_client(project_id="test-project", use_mock=False)

        assert isinstance(client, SpeechClient)
        assert not isinstance(client, MockSpeechClient)

    def test_get_speech_client_mock(self) -> None:
        """Test get_speech_client returns MockSpeechClient when use_mock=True."""
        client = get_speech_client(project_id="test-project", use_mock=True)

        assert isinstance(client, MockSpeechClient)
        assert client.project_id == "test-project"


class TestTranscriptionDataClasses:
    """Tests for data classes."""

    def test_transcription_result_defaults(self) -> None:
        """Test TranscriptionResult default values."""
        result = TranscriptionResult(
            text="test", confidence=0.9, language="en-US", duration_ms=1000
        )

        assert result.text == "test"
        assert result.words == []
        assert result.is_final is True
        assert result.alternatives == []

    def test_transcription_config_defaults(self) -> None:
        """Test TranscriptionConfig default values."""
        config = TranscriptionConfig()

        assert config.language_code == "en-US"
        assert config.sample_rate_hertz == 48000
        assert config.audio_channel_count == 1
        assert config.enable_automatic_punctuation is True
        assert config.enable_word_time_offsets is True
        assert config.model == "latest_long"
        assert config.use_enhanced is True

    def test_async_transcription_config_defaults(self) -> None:
        """Test AsyncTranscriptionConfig default values."""
        config = AsyncTranscriptionConfig(gcs_uri="gs://test/audio.webm")

        assert config.gcs_uri == "gs://test/audio.webm"
        assert config.language_code == "en-US"
        assert config.sample_rate_hertz == 48000
        assert config.encoding == "WEBM_OPUS"


class TestEncodingMapConstants:
    """Tests for ENCODING_MAP constant."""

    def test_encoding_map_complete(self) -> None:
        """Test ENCODING_MAP contains expected formats."""
        assert "webm" in ENCODING_MAP
        assert "mp3" in ENCODING_MAP
        assert "wav" in ENCODING_MAP
        assert "flac" in ENCODING_MAP
        assert "ogg" in ENCODING_MAP
        assert "mulaw" in ENCODING_MAP
        assert "alaw" in ENCODING_MAP
