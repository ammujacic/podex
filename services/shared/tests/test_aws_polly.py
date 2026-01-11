"""Comprehensive tests for AWS Polly client."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from podex_shared.aws.polly import (
    RECOMMENDED_VOICES,
    MockPollyClient,
    PollyClient,
    StreamingSynthesisOptions,
    SynthesisOptions,
    SynthesisResult,
    VoiceInfo,
    get_polly_client,
)


class TestVoiceInfo:
    """Tests for VoiceInfo dataclass."""

    def test_voice_info(self) -> None:
        """Test creating VoiceInfo."""
        voice = VoiceInfo(
            id="Joanna",
            name="Joanna",
            language_code="en-US",
            language_name="US English",
            gender="Female",
            engine="neural",
            supported_engines=["neural", "standard"],
        )
        assert voice.id == "Joanna"
        assert voice.gender == "Female"
        assert "neural" in voice.supported_engines


class TestSynthesisResult:
    """Tests for SynthesisResult dataclass."""

    def test_synthesis_result(self) -> None:
        """Test creating SynthesisResult."""
        result = SynthesisResult(
            audio_data=b"audio bytes",
            content_type="audio/mpeg",
            request_characters=100,
        )
        assert result.audio_data == b"audio bytes"
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 100


class TestSynthesisOptions:
    """Tests for SynthesisOptions dataclass."""

    def test_synthesis_options_defaults(self) -> None:
        """Test SynthesisOptions default values."""
        options = SynthesisOptions()
        assert options.voice_id == "Joanna"
        assert options.output_format == "mp3"
        assert options.engine == "neural"
        assert options.language_code == "en-US"
        assert options.sample_rate == "24000"

    def test_synthesis_options_custom(self) -> None:
        """Test SynthesisOptions with custom values."""
        options = SynthesisOptions(
            voice_id="Matthew",
            output_format="ogg_vorbis",
            engine="standard",
            language_code="en-GB",
            sample_rate="16000",
        )
        assert options.voice_id == "Matthew"
        assert options.output_format == "ogg_vorbis"


class TestStreamingSynthesisOptions:
    """Tests for StreamingSynthesisOptions dataclass."""

    def test_streaming_options_defaults(self) -> None:
        """Test StreamingSynthesisOptions default values."""
        options = StreamingSynthesisOptions()
        assert options.chunk_size == 4096

    def test_streaming_options_custom(self) -> None:
        """Test StreamingSynthesisOptions with custom chunk size."""
        options = StreamingSynthesisOptions(chunk_size=8192)
        assert options.chunk_size == 8192


class TestRecommendedVoices:
    """Tests for RECOMMENDED_VOICES constant."""

    def test_en_us_voices(self) -> None:
        """Test US English recommended voices."""
        voices = RECOMMENDED_VOICES.get("en-US")
        assert voices is not None
        assert len(voices) > 0
        voice_ids = [v["id"] for v in voices]
        assert "Joanna" in voice_ids
        assert "Matthew" in voice_ids

    def test_en_gb_voices(self) -> None:
        """Test British English recommended voices."""
        voices = RECOMMENDED_VOICES.get("en-GB")
        assert voices is not None
        voice_ids = [v["id"] for v in voices]
        assert "Amy" in voice_ids


class TestPollyClientInit:
    """Tests for PollyClient initialization."""

    def test_init_defaults(self) -> None:
        """Test PollyClient default initialization."""
        client = PollyClient()
        assert client.region == "us-east-1"
        assert client.endpoint_url is None

    def test_init_custom(self) -> None:
        """Test PollyClient with custom parameters."""
        client = PollyClient(
            region="eu-west-1",
            endpoint_url="http://localhost:4566",
        )
        assert client.region == "eu-west-1"
        assert client.endpoint_url == "http://localhost:4566"


class TestPollyClientSynthesis:
    """Tests for PollyClient speech synthesis."""

    @pytest.fixture
    def mock_polly_client(self) -> MagicMock:
        """Create a mock Polly client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_synthesize_speech(self, mock_polly_client: MagicMock) -> None:
        """Test synthesizing speech."""
        mock_audio_stream = MagicMock()
        mock_audio_stream.read = AsyncMock(return_value=b"audio data")
        mock_polly_client.synthesize_speech = AsyncMock(
            return_value={
                "AudioStream": mock_audio_stream,
                "ContentType": "audio/mpeg",
                "RequestCharacters": 20,
            }
        )

        client = PollyClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_polly_client
            result = await client.synthesize_speech("Hello world")

        assert result.audio_data == b"audio data"
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 20

    @pytest.mark.asyncio
    async def test_synthesize_speech_with_options(
        self, mock_polly_client: MagicMock
    ) -> None:
        """Test synthesizing speech with custom options."""
        mock_audio_stream = MagicMock()
        mock_audio_stream.read = AsyncMock(return_value=b"audio data")
        mock_polly_client.synthesize_speech = AsyncMock(
            return_value={
                "AudioStream": mock_audio_stream,
                "ContentType": "audio/mpeg",
                "RequestCharacters": 20,
            }
        )

        client = PollyClient()
        options = SynthesisOptions(voice_id="Matthew", engine="standard")

        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_polly_client
            await client.synthesize_speech("Hello", options=options)

        call_kwargs = mock_polly_client.synthesize_speech.call_args[1]
        assert call_kwargs["VoiceId"] == "Matthew"
        assert call_kwargs["Engine"] == "standard"


class TestPollyClientListVoices:
    """Tests for PollyClient voice listing."""

    @pytest.fixture
    def mock_polly_client(self) -> MagicMock:
        """Create a mock Polly client."""
        mock = MagicMock()
        mock.__aenter__ = AsyncMock(return_value=mock)
        mock.__aexit__ = AsyncMock(return_value=None)
        return mock

    @pytest.mark.asyncio
    async def test_list_voices(self, mock_polly_client: MagicMock) -> None:
        """Test listing voices."""
        mock_polly_client.describe_voices = AsyncMock(
            return_value={
                "Voices": [
                    {
                        "Id": "Joanna",
                        "Name": "Joanna",
                        "LanguageCode": "en-US",
                        "LanguageName": "US English",
                        "Gender": "Female",
                        "SupportedEngines": ["neural", "standard"],
                    }
                ]
            }
        )

        client = PollyClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_polly_client
            voices = await client.list_voices()

        assert len(voices) == 1
        assert voices[0].id == "Joanna"

    @pytest.mark.asyncio
    async def test_list_voices_with_filters(
        self, mock_polly_client: MagicMock
    ) -> None:
        """Test listing voices with filters."""
        mock_polly_client.describe_voices = AsyncMock(
            return_value={"Voices": []}
        )

        client = PollyClient()
        with patch.object(client, "_session") as mock_session:
            mock_session.client.return_value = mock_polly_client
            await client.list_voices(language_code="en-US", engine="neural")

        call_kwargs = mock_polly_client.describe_voices.call_args[1]
        assert call_kwargs["LanguageCode"] == "en-US"
        assert call_kwargs["Engine"] == "neural"


class TestPollyClientGetRecommendedVoices:
    """Tests for recommended voices method."""

    @pytest.mark.asyncio
    async def test_get_recommended_voices_default(self) -> None:
        """Test getting recommended voices for default language."""
        client = PollyClient()
        voices = await client.get_recommended_voices()
        assert len(voices) > 0
        assert any(v["id"] == "Joanna" for v in voices)

    @pytest.mark.asyncio
    async def test_get_recommended_voices_en_gb(self) -> None:
        """Test getting recommended voices for British English."""
        client = PollyClient()
        voices = await client.get_recommended_voices("en-GB")
        assert any(v["id"] == "Amy" for v in voices)

    @pytest.mark.asyncio
    async def test_get_recommended_voices_unknown(self) -> None:
        """Test getting recommended voices for unknown language."""
        client = PollyClient()
        voices = await client.get_recommended_voices("de-DE")
        # Falls back to en-US
        assert any(v["id"] == "Joanna" for v in voices)


class TestMockPollyClient:
    """Tests for MockPollyClient."""

    @pytest.mark.asyncio
    async def test_mock_synthesize_speech(self) -> None:
        """Test mock speech synthesis."""
        client = MockPollyClient()
        result = await client.synthesize_speech("Test text")

        assert result.audio_data == MockPollyClient.MOCK_MP3_DATA
        assert result.content_type == "audio/mpeg"
        assert result.request_characters == 9

    @pytest.mark.asyncio
    async def test_mock_synthesize_speech_streaming(self) -> None:
        """Test mock streaming synthesis."""
        client = MockPollyClient()
        chunks = []
        async for chunk in client.synthesize_speech_streaming("Test"):
            chunks.append(chunk)

        assert len(chunks) == 1
        assert chunks[0] == MockPollyClient.MOCK_MP3_DATA

    @pytest.mark.asyncio
    async def test_mock_list_voices(self) -> None:
        """Test mock voice listing."""
        client = MockPollyClient()
        voices = await client.list_voices()

        assert len(voices) == 3
        assert any(v.id == "Joanna" for v in voices)
        assert any(v.id == "Matthew" for v in voices)

    @pytest.mark.asyncio
    async def test_mock_list_voices_filtered(self) -> None:
        """Test mock voice listing with filter."""
        client = MockPollyClient()
        voices = await client.list_voices(language_code="en-US")

        assert all(v.language_code == "en-US" for v in voices)


class TestGetPollyClient:
    """Tests for get_polly_client factory function."""

    def test_get_real_client(self) -> None:
        """Test getting real Polly client."""
        client = get_polly_client(region="us-west-2")
        assert isinstance(client, PollyClient)
        assert not isinstance(client, MockPollyClient)
        assert client.region == "us-west-2"

    def test_get_mock_client_explicit(self) -> None:
        """Test getting mock client explicitly."""
        client = get_polly_client(use_mock=True)
        assert isinstance(client, MockPollyClient)

    def test_get_mock_client_with_endpoint(self) -> None:
        """Test that endpoint URL triggers mock client."""
        client = get_polly_client(endpoint_url="http://localhost:4566")
        assert isinstance(client, MockPollyClient)
