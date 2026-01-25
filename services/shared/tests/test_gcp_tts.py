"""Comprehensive tests for GCP Text-to-Speech client."""

from typing import AsyncIterator
from unittest.mock import MagicMock, patch

import pytest

from podex_shared.gcp.tts import (
    RECOMMENDED_VOICES,
    MockTTSClient,
    StreamingSynthesisOptions,
    SynthesisOptions,
    SynthesisResult,
    TTSClient,
    VoiceInfo,
    get_tts_client,
)


class TestTTSClientInit:
    """Tests for TTSClient initialization."""

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_init_without_project(self, mock_client_class: MagicMock) -> None:
        """Test initialization without project_id."""
        client = TTSClient()

        assert client.project_id is None
        mock_client_class.assert_called_once()

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_init_with_project(self, mock_client_class: MagicMock) -> None:
        """Test initialization with project_id."""
        client = TTSClient(project_id="test-project")

        assert client.project_id == "test-project"
        mock_client_class.assert_called_once()


class TestAudioEncodingMapping:
    """Tests for _get_audio_encoding() method."""

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_audio_encoding_mp3(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for mp3 format."""
        client = TTSClient()
        from google.cloud import texttospeech

        encoding = client._get_audio_encoding("mp3")
        assert encoding == texttospeech.AudioEncoding.MP3

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_audio_encoding_wav(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for wav format."""
        client = TTSClient()
        from google.cloud import texttospeech

        encoding = client._get_audio_encoding("wav")
        assert encoding == texttospeech.AudioEncoding.LINEAR16

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_audio_encoding_ogg(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping for ogg format."""
        client = TTSClient()
        from google.cloud import texttospeech

        encoding = client._get_audio_encoding("ogg")
        assert encoding == texttospeech.AudioEncoding.OGG_OPUS

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_audio_encoding_unknown_defaults_to_mp3(self, mock_client_class: MagicMock) -> None:
        """Test encoding mapping defaults to MP3 for unknown format."""
        client = TTSClient()
        from google.cloud import texttospeech

        encoding = client._get_audio_encoding("unknown")
        assert encoding == texttospeech.AudioEncoding.MP3


class TestContentTypeMapping:
    """Tests for _get_content_type() method."""

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_content_type_mp3(self, mock_client_class: MagicMock) -> None:
        """Test content type for mp3 format."""
        client = TTSClient()
        content_type = client._get_content_type("mp3")
        assert content_type == "audio/mpeg"

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_content_type_wav(self, mock_client_class: MagicMock) -> None:
        """Test content type for wav format."""
        client = TTSClient()
        content_type = client._get_content_type("wav")
        assert content_type == "audio/wav"

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_content_type_ogg(self, mock_client_class: MagicMock) -> None:
        """Test content type for ogg format."""
        client = TTSClient()
        content_type = client._get_content_type("ogg")
        assert content_type == "audio/ogg"

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_content_type_unknown_defaults_to_mpeg(self, mock_client_class: MagicMock) -> None:
        """Test content type defaults to audio/mpeg for unknown format."""
        client = TTSClient()
        content_type = client._get_content_type("unknown")
        assert content_type == "audio/mpeg"


class TestSynthesizeSpeech:
    """Tests for synthesize_speech() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_synthesize_speech_default_options(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test synthesize_speech with default options."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.synthesize_speech = mock_tts_client.synthesize_speech

        client = TTSClient()
        result = await client.synthesize_speech("Hello world")

        assert isinstance(result, SynthesisResult)
        assert result.audio_data == b"fake-audio-data"
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 11

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_synthesize_speech_custom_options(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test synthesize_speech with custom options."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.synthesize_speech = mock_tts_client.synthesize_speech

        client = TTSClient()
        options = SynthesisOptions(
            voice_name="en-GB-Neural2-A",
            output_format="wav",
            language_code="en-GB",
            speaking_rate=1.2,
            pitch=-2.0,
        )

        result = await client.synthesize_speech("Test", options)

        assert result.content_type == "audio/wav"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_synthesize_speech_empty_text(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test synthesize_speech with empty text."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.synthesize_speech = mock_tts_client.synthesize_speech

        client = TTSClient()
        result = await client.synthesize_speech("")

        assert result.request_characters == 0


class TestSynthesizeSpeechStreaming:
    """Tests for synthesize_speech_streaming() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_synthesize_speech_streaming_default_options(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test streaming synthesis with default options."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.synthesize_speech = mock_tts_client.synthesize_speech

        client = TTSClient()
        chunks: list[bytes] = []

        async for chunk in client.synthesize_speech_streaming("Hello world"):
            chunks.append(chunk)

        assert len(chunks) > 0
        assert b"".join(chunks) == b"fake-audio-data"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_synthesize_speech_streaming_custom_chunk_size(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test streaming synthesis with custom chunk size."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock large audio data
        large_audio = b"x" * 10000
        mock_response = MagicMock()
        mock_response.audio_content = large_audio
        mock_client_instance.synthesize_speech.return_value = mock_response

        client = TTSClient()
        options = StreamingSynthesisOptions(chunk_size=100)

        chunks: list[bytes] = []
        async for chunk in client.synthesize_speech_streaming("Test", options):
            chunks.append(chunk)
            assert len(chunk) <= 100

        assert b"".join(chunks) == large_audio


class TestListVoices:
    """Tests for list_voices() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_list_voices_all(
        self, mock_client_class: MagicMock, mock_tts_client: MagicMock
    ) -> None:
        """Test list_voices without language filter."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance
        mock_client_instance.list_voices = mock_tts_client.list_voices

        client = TTSClient()
        voices = await client.list_voices()

        assert len(voices) > 0
        assert all(isinstance(v, VoiceInfo) for v in voices)

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_list_voices_filtered(self, mock_client_class: MagicMock) -> None:
        """Test list_voices with language filter."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock voice
        mock_voice = MagicMock()
        mock_voice.name = "en-US-Neural2-J"
        mock_voice.language_codes = ["en-US"]
        mock_voice.ssml_gender = 1  # MALE

        mock_response = MagicMock()
        mock_response.voices = [mock_voice]
        mock_client_instance.list_voices.return_value = mock_response

        client = TTSClient()
        voices = await client.list_voices(language_code="en-US")

        assert len(voices) == 1
        assert voices[0].language_code == "en-US"

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_list_voices_voice_type_detection(self, mock_client_class: MagicMock) -> None:
        """Test list_voices detects voice types correctly."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Mock Neural2 voice
        mock_voice = MagicMock()
        mock_voice.name = "en-US-Neural2-J"
        mock_voice.language_codes = ["en-US"]
        mock_voice.ssml_gender = 1

        mock_response = MagicMock()
        mock_response.voices = [mock_voice]
        mock_client_instance.list_voices.return_value = mock_response

        client = TTSClient()
        voices = await client.list_voices()

        assert voices[0].natural is True
        assert "Neural2" in voices[0].supported_types

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_list_voices_gender_mapping(self, mock_client_class: MagicMock) -> None:
        """Test list_voices maps gender correctly."""
        mock_client_instance = MagicMock()
        mock_client_class.return_value = mock_client_instance

        # Test FEMALE gender
        mock_voice = MagicMock()
        mock_voice.name = "en-US-Neural2-F"
        mock_voice.language_codes = ["en-US"]
        mock_voice.ssml_gender = 2  # FEMALE

        mock_response = MagicMock()
        mock_response.voices = [mock_voice]
        mock_client_instance.list_voices.return_value = mock_response

        client = TTSClient()
        voices = await client.list_voices()

        assert voices[0].gender == "Female"


class TestGetRecommendedVoices:
    """Tests for get_recommended_voices() method."""

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_get_recommended_voices_en_us(self, mock_client_class: MagicMock) -> None:
        """Test get_recommended_voices for en-US."""
        client = TTSClient()
        voices = await client.get_recommended_voices("en-US")

        assert len(voices) > 0
        assert all(isinstance(v, dict) for v in voices)
        assert all("id" in v and "gender" in v for v in voices)

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_get_recommended_voices_en_gb(self, mock_client_class: MagicMock) -> None:
        """Test get_recommended_voices for en-GB."""
        client = TTSClient()
        voices = await client.get_recommended_voices("en-GB")

        assert len(voices) > 0

    @pytest.mark.asyncio
    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    async def test_get_recommended_voices_unknown_defaults_to_en_us(
        self, mock_client_class: MagicMock
    ) -> None:
        """Test get_recommended_voices defaults to en-US for unknown language."""
        client = TTSClient()
        voices = await client.get_recommended_voices("unknown-LANG")

        # Should return en-US recommendations
        assert voices == RECOMMENDED_VOICES["en-US"]


class TestMockTTSClient:
    """Tests for MockTTSClient."""

    def test_mock_client_init(self) -> None:
        """Test MockTTSClient initialization."""
        client = MockTTSClient(project_id="test-project")

        assert client.project_id == "test-project"
        assert client._client is None

    @pytest.mark.asyncio
    async def test_mock_synthesize_speech(self) -> None:
        """Test MockTTSClient synthesize_speech."""
        client = MockTTSClient()

        result = await client.synthesize_speech("Test text")

        assert isinstance(result, SynthesisResult)
        assert result.audio_data == MockTTSClient.MOCK_MP3_DATA
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 9

    @pytest.mark.asyncio
    async def test_mock_synthesize_speech_custom_options(self) -> None:
        """Test MockTTSClient respects options."""
        client = MockTTSClient()
        options = SynthesisOptions(voice_name="en-GB-Neural2-A")

        result = await client.synthesize_speech("Test", options)

        assert result.audio_data == MockTTSClient.MOCK_MP3_DATA

    @pytest.mark.asyncio
    async def test_mock_synthesize_speech_streaming(self) -> None:
        """Test MockTTSClient streaming synthesis."""
        client = MockTTSClient()

        chunks: list[bytes] = []
        async for chunk in client.synthesize_speech_streaming("Test"):
            chunks.append(chunk)

        assert len(chunks) == 1
        assert chunks[0] == MockTTSClient.MOCK_MP3_DATA

    @pytest.mark.asyncio
    async def test_mock_list_voices_all(self) -> None:
        """Test MockTTSClient list_voices without filter."""
        client = MockTTSClient()

        voices = await client.list_voices()

        assert len(voices) == 3
        assert all(isinstance(v, VoiceInfo) for v in voices)

    @pytest.mark.asyncio
    async def test_mock_list_voices_filtered(self) -> None:
        """Test MockTTSClient list_voices with language filter."""
        client = MockTTSClient()

        voices = await client.list_voices(language_code="en")

        assert len(voices) == 3  # All mock voices are en-US

    @pytest.mark.asyncio
    async def test_mock_list_voices_filtered_no_match(self) -> None:
        """Test MockTTSClient list_voices filters out non-matching languages."""
        client = MockTTSClient()

        voices = await client.list_voices(language_code="es")

        assert len(voices) == 0


class TestGetTTSClient:
    """Tests for get_tts_client() factory function."""

    @patch("podex_shared.gcp.tts.texttospeech.TextToSpeechClient")
    def test_get_tts_client_real(self, mock_client_class: MagicMock) -> None:
        """Test get_tts_client returns TTSClient by default."""
        client = get_tts_client(project_id="test-project", use_mock=False)

        assert isinstance(client, TTSClient)
        assert not isinstance(client, MockTTSClient)

    def test_get_tts_client_mock(self) -> None:
        """Test get_tts_client returns MockTTSClient when use_mock=True."""
        client = get_tts_client(project_id="test-project", use_mock=True)

        assert isinstance(client, MockTTSClient)
        assert client.project_id == "test-project"


class TestSynthesisDataClasses:
    """Tests for data classes."""

    def test_synthesis_result(self) -> None:
        """Test SynthesisResult creation."""
        result = SynthesisResult(
            audio_data=b"audio", content_type="audio/mpeg", request_characters=100
        )

        assert result.audio_data == b"audio"
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 100

    def test_synthesis_options_defaults(self) -> None:
        """Test SynthesisOptions default values."""
        options = SynthesisOptions()

        assert options.voice_name == "en-US-Neural2-J"
        assert options.output_format == "mp3"
        assert options.language_code == "en-US"
        assert options.speaking_rate == 1.0
        assert options.pitch == 0.0

    def test_streaming_synthesis_options_defaults(self) -> None:
        """Test StreamingSynthesisOptions default values."""
        options = StreamingSynthesisOptions()

        assert options.voice_name == "en-US-Neural2-J"
        assert options.output_format == "mp3"
        assert options.language_code == "en-US"
        assert options.chunk_size == 4096

    def test_voice_info(self) -> None:
        """Test VoiceInfo creation."""
        voice = VoiceInfo(
            id="en-US-Neural2-J",
            name="en-US-Neural2-J",
            language_code="en-US",
            language_name="US English",
            gender="Male",
            natural=True,
            supported_types=["Neural2"],
        )

        assert voice.id == "en-US-Neural2-J"
        assert voice.natural is True
        assert voice.gender == "Male"


class TestRecommendedVoicesConstant:
    """Tests for RECOMMENDED_VOICES constant."""

    def test_recommended_voices_has_en_us(self) -> None:
        """Test RECOMMENDED_VOICES contains en-US."""
        assert "en-US" in RECOMMENDED_VOICES
        assert len(RECOMMENDED_VOICES["en-US"]) > 0

    def test_recommended_voices_has_en_gb(self) -> None:
        """Test RECOMMENDED_VOICES contains en-GB."""
        assert "en-GB" in RECOMMENDED_VOICES
        assert len(RECOMMENDED_VOICES["en-GB"]) > 0
