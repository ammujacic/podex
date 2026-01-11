"""AWS Polly client for text-to-speech."""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import aioboto3

logger = logging.getLogger(__name__)


@dataclass
class VoiceInfo:
    """Information about an available voice."""

    id: str
    name: str
    language_code: str
    language_name: str
    gender: str
    engine: str  # "neural" or "standard"
    supported_engines: list[str]


@dataclass
class SynthesisResult:
    """Result from text-to-speech synthesis."""

    audio_data: bytes
    content_type: str
    request_characters: int


@dataclass
class SynthesisOptions:
    """Options for text-to-speech synthesis."""

    voice_id: str = "Joanna"
    output_format: str = "mp3"
    engine: str = "neural"
    language_code: str = "en-US"
    sample_rate: str = "24000"


@dataclass
class StreamingSynthesisOptions:
    """Options for streaming text-to-speech synthesis."""

    voice_id: str = "Joanna"
    output_format: str = "mp3"
    engine: str = "neural"
    language_code: str = "en-US"
    chunk_size: int = 4096


# Popular neural voices for different use cases
RECOMMENDED_VOICES = {
    "en-US": [
        {"id": "Joanna", "gender": "Female", "style": "Conversational"},
        {"id": "Matthew", "gender": "Male", "style": "Conversational"},
        {"id": "Kendra", "gender": "Female", "style": "Professional"},
        {"id": "Joey", "gender": "Male", "style": "Casual"},
        {"id": "Salli", "gender": "Female", "style": "Warm"},
        {"id": "Ivy", "gender": "Female", "style": "Child"},
    ],
    "en-GB": [
        {"id": "Amy", "gender": "Female", "style": "British"},
        {"id": "Brian", "gender": "Male", "style": "British"},
    ],
}


class PollyClient:
    """AWS Polly client for text-to-speech operations."""

    def __init__(
        self,
        region: str = "us-east-1",
        endpoint_url: str | None = None,
    ):
        """Initialize Polly client.

        Args:
            region: AWS region
            endpoint_url: Optional endpoint URL (for LocalStack, not supported)
        """
        self.region = region
        self.endpoint_url = endpoint_url
        self._session = aioboto3.Session()

    async def synthesize_speech(
        self,
        text: str,
        options: SynthesisOptions | None = None,
    ) -> SynthesisResult:
        """Synthesize text to speech.

        Args:
            text: Text to synthesize (max 3000 chars for neural)
            options: Synthesis options (voice, format, engine, etc.)

        Returns:
            SynthesisResult with audio data
        """
        if options is None:
            options = SynthesisOptions()

        async with self._session.client(
            "polly",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            response = await client.synthesize_speech(
                Text=text,
                VoiceId=options.voice_id,
                OutputFormat=options.output_format,
                Engine=options.engine,
                LanguageCode=options.language_code,
                SampleRate=options.sample_rate,
            )

            # Read the audio stream
            audio_stream = response["AudioStream"]
            audio_data = await audio_stream.read()

            return SynthesisResult(
                audio_data=audio_data,
                content_type=response["ContentType"],
                request_characters=response["RequestCharacters"],
            )

    async def synthesize_speech_streaming(
        self,
        text: str,
        options: StreamingSynthesisOptions | None = None,
    ) -> AsyncIterator[bytes]:
        """Synthesize text to speech with streaming output.

        Args:
            text: Text to synthesize
            options: Streaming synthesis options (voice, format, engine, etc.)

        Yields:
            Audio data chunks
        """
        if options is None:
            options = StreamingSynthesisOptions()

        async with self._session.client(
            "polly",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            response = await client.synthesize_speech(
                Text=text,
                VoiceId=options.voice_id,
                OutputFormat=options.output_format,
                Engine=options.engine,
                LanguageCode=options.language_code,
            )

            audio_stream = response["AudioStream"]
            while True:
                chunk = await audio_stream.read(options.chunk_size)
                if not chunk:
                    break
                yield chunk

    async def list_voices(
        self,
        language_code: str | None = None,
        engine: str | None = None,
    ) -> list[VoiceInfo]:
        """List available voices.

        Args:
            language_code: Filter by language code
            engine: Filter by engine (neural or standard)

        Returns:
            List of VoiceInfo objects
        """
        async with self._session.client(
            "polly",
            region_name=self.region,
            endpoint_url=self.endpoint_url,
        ) as client:
            kwargs: dict[str, Any] = {}
            if language_code:
                kwargs["LanguageCode"] = language_code
            if engine:
                kwargs["Engine"] = engine

            response = await client.describe_voices(**kwargs)

            voices = []
            for voice in response.get("Voices", []):
                voices.append(
                    VoiceInfo(
                        id=voice["Id"],
                        name=voice["Name"],
                        language_code=voice["LanguageCode"],
                        language_name=voice["LanguageName"],
                        gender=voice["Gender"],
                        engine=engine or "neural",
                        supported_engines=voice.get("SupportedEngines", ["neural"]),
                    ),
                )

            return voices

    async def get_recommended_voices(
        self,
        language_code: str = "en-US",
    ) -> list[dict[str, str]]:
        """Get recommended voices for a language.

        Args:
            language_code: Language code

        Returns:
            List of recommended voice configurations
        """
        return RECOMMENDED_VOICES.get(language_code, RECOMMENDED_VOICES["en-US"])


class MockPollyClient(PollyClient):
    """Mock Polly client for local development.

    Since AWS Polly is not supported in LocalStack,
    this mock provides placeholder responses for testing.
    """

    # Minimal valid MP3 file (silence)
    MOCK_MP3_DATA = bytes(
        [
            0xFF,
            0xFB,
            0x90,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
        ]
    )

    def __init__(self, **kwargs: Any):
        """Initialize mock client."""
        super().__init__(**kwargs)

    async def synthesize_speech(
        self,
        text: str,
        options: SynthesisOptions | None = None,
    ) -> SynthesisResult:
        """Mock speech synthesis."""
        if options is None:
            options = SynthesisOptions()
        logger.info(f"[MOCK] Synthesizing {len(text)} chars with voice {options.voice_id}")
        return SynthesisResult(
            audio_data=self.MOCK_MP3_DATA,
            content_type="audio/mpeg",
            request_characters=len(text),
        )

    async def synthesize_speech_streaming(
        self,
        text: str,
        options: StreamingSynthesisOptions | None = None,
    ) -> AsyncIterator[bytes]:
        """Mock streaming synthesis."""
        if options is None:
            options = StreamingSynthesisOptions()
        logger.info(
            f"[MOCK] Streaming synthesis for {len(text)} chars with voice {options.voice_id}"
        )
        yield self.MOCK_MP3_DATA

    async def list_voices(
        self,
        language_code: str | None = None,
        _engine: str | None = None,
    ) -> list[VoiceInfo]:
        """Mock listing voices."""
        voices = [
            VoiceInfo(
                id="Joanna",
                name="Joanna",
                language_code="en-US",
                language_name="US English",
                gender="Female",
                engine="neural",
                supported_engines=["neural", "standard"],
            ),
            VoiceInfo(
                id="Matthew",
                name="Matthew",
                language_code="en-US",
                language_name="US English",
                gender="Male",
                engine="neural",
                supported_engines=["neural", "standard"],
            ),
            VoiceInfo(
                id="Kendra",
                name="Kendra",
                language_code="en-US",
                language_name="US English",
                gender="Female",
                engine="neural",
                supported_engines=["neural"],
            ),
        ]
        if language_code:
            voices = [v for v in voices if v.language_code == language_code]
        return voices


def get_polly_client(
    region: str = "us-east-1",
    endpoint_url: str | None = None,
    use_mock: bool = False,
) -> PollyClient:
    """Get a Polly client instance.

    Args:
        region: AWS region
        endpoint_url: Optional endpoint URL
        use_mock: Use mock client for local development

    Returns:
        PollyClient or MockPollyClient
    """
    if use_mock or endpoint_url:
        # Use mock for LocalStack since Polly isn't supported
        return MockPollyClient(region=region, endpoint_url=endpoint_url)
    return PollyClient(region=region)
