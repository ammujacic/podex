"""Google Cloud Text-to-Speech client.

Replaces AWS Polly with Google Cloud TTS for Podex services.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import partial
from typing import Any, cast

from google.cloud import texttospeech

logger = logging.getLogger(__name__)

# Thread pool for running sync GCP operations
_executor = ThreadPoolExecutor(max_workers=5)


async def _run_in_executor(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a sync function in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, partial(func, *args, **kwargs))


@dataclass
class VoiceInfo:
    """Information about an available voice."""

    id: str
    name: str
    language_code: str
    language_name: str
    gender: str
    natural: bool  # WaveNet/Neural2/Journey voices are "natural"
    supported_types: list[str]


@dataclass
class SynthesisResult:
    """Result from text-to-speech synthesis."""

    audio_data: bytes
    content_type: str
    request_characters: int


@dataclass
class SynthesisOptions:
    """Options for text-to-speech synthesis."""

    voice_name: str = "en-US-Neural2-J"  # High-quality neural voice
    output_format: str = "mp3"
    language_code: str = "en-US"
    speaking_rate: float = 1.0
    pitch: float = 0.0


@dataclass
class StreamingSynthesisOptions:
    """Options for streaming text-to-speech synthesis."""

    voice_name: str = "en-US-Neural2-J"
    output_format: str = "mp3"
    language_code: str = "en-US"
    chunk_size: int = 4096


# Google Cloud TTS voice types
VOICE_TYPES = {
    "Standard": "Standard quality",
    "WaveNet": "DeepMind WaveNet (natural sounding)",
    "Neural2": "Latest neural (recommended)",
    "Journey": "Long-form audio optimized",
    "Studio": "Studio quality (limited availability)",
    "Polyglot": "Multi-language support",
}

# Recommended voices for different use cases
RECOMMENDED_VOICES = {
    "en-US": [
        {"id": "en-US-Neural2-J", "gender": "Male", "style": "Casual"},
        {"id": "en-US-Neural2-F", "gender": "Female", "style": "Casual"},
        {"id": "en-US-Neural2-A", "gender": "Male", "style": "Professional"},
        {"id": "en-US-Neural2-C", "gender": "Female", "style": "Professional"},
        {"id": "en-US-Journey-D", "gender": "Male", "style": "Storytelling"},
        {"id": "en-US-Journey-F", "gender": "Female", "style": "Storytelling"},
    ],
    "en-GB": [
        {"id": "en-GB-Neural2-B", "gender": "Male", "style": "British"},
        {"id": "en-GB-Neural2-A", "gender": "Female", "style": "British"},
    ],
}


class TTSClient:
    """Google Cloud Text-to-Speech client for TTS operations."""

    def __init__(
        self,
        project_id: str | None = None,
    ):
        """Initialize TTS client.

        Args:
            project_id: GCP project ID (uses default if not specified)
        """
        self.project_id = project_id
        self._client = texttospeech.TextToSpeechClient()

    def _get_audio_encoding(self, output_format: str) -> texttospeech.AudioEncoding:
        """Map output format to GCP audio encoding."""
        format_map = {
            "mp3": texttospeech.AudioEncoding.MP3,
            "wav": texttospeech.AudioEncoding.LINEAR16,
            "ogg": texttospeech.AudioEncoding.OGG_OPUS,
            "mulaw": texttospeech.AudioEncoding.MULAW,
            "alaw": texttospeech.AudioEncoding.ALAW,
        }
        return format_map.get(output_format, texttospeech.AudioEncoding.MP3)

    def _get_content_type(self, output_format: str) -> str:
        """Get MIME type for output format."""
        content_type_map = {
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "ogg": "audio/ogg",
            "mulaw": "audio/basic",
            "alaw": "audio/basic",
        }
        return content_type_map.get(output_format, "audio/mpeg")

    async def synthesize_speech(
        self,
        text: str,
        options: SynthesisOptions | None = None,
    ) -> SynthesisResult:
        """Synthesize text to speech.

        Args:
            text: Text to synthesize
            options: Synthesis options (voice, format, etc.)

        Returns:
            SynthesisResult with audio data
        """
        if options is None:
            options = SynthesisOptions()

        def _synthesize() -> SynthesisResult:
            # Build the synthesis input
            synthesis_input = texttospeech.SynthesisInput(text=text)

            # Build voice parameters
            voice = texttospeech.VoiceSelectionParams(
                language_code=options.language_code,
                name=options.voice_name,
            )

            # Build audio config
            audio_config = texttospeech.AudioConfig(
                audio_encoding=self._get_audio_encoding(options.output_format),
                speaking_rate=options.speaking_rate,
                pitch=options.pitch,
            )

            # Synthesize
            response = self._client.synthesize_speech(
                input=synthesis_input,
                voice=voice,
                audio_config=audio_config,
            )

            return SynthesisResult(
                audio_data=response.audio_content,
                content_type=self._get_content_type(options.output_format),
                request_characters=len(text),
            )

        return cast("SynthesisResult", await _run_in_executor(_synthesize))

    async def synthesize_speech_streaming(
        self,
        text: str,
        options: StreamingSynthesisOptions | None = None,
    ) -> AsyncIterator[bytes]:
        """Synthesize text to speech with streaming output.

        Note: Google Cloud TTS doesn't have native streaming synthesis,
        so we synthesize the full audio and yield it in chunks.

        Args:
            text: Text to synthesize
            options: Streaming synthesis options

        Yields:
            Audio data chunks
        """
        if options is None:
            options = StreamingSynthesisOptions()

        synthesis_options = SynthesisOptions(
            voice_name=options.voice_name,
            output_format=options.output_format,
            language_code=options.language_code,
        )

        result = await self.synthesize_speech(text, synthesis_options)

        # Yield in chunks
        audio_data = result.audio_data
        for i in range(0, len(audio_data), options.chunk_size):
            yield audio_data[i : i + options.chunk_size]

    async def list_voices(
        self,
        language_code: str | None = None,
    ) -> list[VoiceInfo]:
        """List available voices.

        Args:
            language_code: Filter by language code (e.g., "en-US")

        Returns:
            List of VoiceInfo objects
        """

        def _list_voices() -> list[VoiceInfo]:
            response = self._client.list_voices(language_code=language_code)

            voices = []
            for voice in response.voices:
                # Determine if it's a natural voice
                is_natural = any(
                    t in voice.name for t in ["WaveNet", "Neural2", "Journey", "Studio"]
                )

                # Map gender
                gender_map = {
                    texttospeech.SsmlVoiceGender.MALE: "Male",
                    texttospeech.SsmlVoiceGender.FEMALE: "Female",
                    texttospeech.SsmlVoiceGender.NEUTRAL: "Neutral",
                }
                gender = gender_map.get(voice.ssml_gender, "Unknown")

                # Get supported voice types from name
                voice_types = []
                for vtype in VOICE_TYPES:
                    if vtype in voice.name:
                        voice_types.append(vtype)
                if not voice_types:
                    voice_types = ["Standard"]

                voices.append(
                    VoiceInfo(
                        id=voice.name,
                        name=voice.name,
                        language_code=voice.language_codes[0] if voice.language_codes else "",
                        language_name=voice.language_codes[0] if voice.language_codes else "",
                        gender=gender,
                        natural=is_natural,
                        supported_types=voice_types,
                    )
                )

            return voices

        return cast("list[VoiceInfo]", await _run_in_executor(_list_voices))

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


class MockTTSClient(TTSClient):
    """Mock TTS client for local development.

    Provides placeholder responses for testing without GCP credentials.
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
        """Initialize mock client (ignores project_id)."""
        self.project_id = kwargs.get("project_id")
        self._client: texttospeech.TextToSpeechClient | None = None

    async def synthesize_speech(
        self,
        text: str,
        options: SynthesisOptions | None = None,
    ) -> SynthesisResult:
        """Mock speech synthesis."""
        if options is None:
            options = SynthesisOptions()
        logger.info(f"[MOCK] Synthesizing {len(text)} chars with voice {options.voice_name}")
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
            f"[MOCK] Streaming synthesis for {len(text)} chars with voice {options.voice_name}"
        )
        yield self.MOCK_MP3_DATA

    async def list_voices(
        self,
        language_code: str | None = None,
    ) -> list[VoiceInfo]:
        """Mock listing voices."""
        voices = [
            VoiceInfo(
                id="en-US-Neural2-J",
                name="en-US-Neural2-J",
                language_code="en-US",
                language_name="US English",
                gender="Male",
                natural=True,
                supported_types=["Neural2"],
            ),
            VoiceInfo(
                id="en-US-Neural2-F",
                name="en-US-Neural2-F",
                language_code="en-US",
                language_name="US English",
                gender="Female",
                natural=True,
                supported_types=["Neural2"],
            ),
            VoiceInfo(
                id="en-US-Standard-A",
                name="en-US-Standard-A",
                language_code="en-US",
                language_name="US English",
                gender="Male",
                natural=False,
                supported_types=["Standard"],
            ),
        ]
        if language_code:
            voices = [v for v in voices if v.language_code.startswith(language_code.split("-")[0])]
        return voices


def get_tts_client(
    project_id: str | None = None,
    use_mock: bool = False,
) -> TTSClient:
    """Get a TTS client instance.

    Args:
        project_id: GCP project ID
        use_mock: Use mock client for local development

    Returns:
        TTSClient or MockTTSClient
    """
    if use_mock:
        return MockTTSClient(project_id=project_id)
    return TTSClient(project_id=project_id)
