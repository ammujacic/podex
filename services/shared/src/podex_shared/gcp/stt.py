"""Google Cloud Speech-to-Text client.

Replaces AWS Transcribe with Google Cloud Speech-to-Text for Podex services.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import partial
from typing import Any, cast

from google.cloud import speech  # type: ignore[import-untyped,attr-defined]
from google.longrunning import operations_pb2  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# Thread pool for running sync GCP operations
_executor = ThreadPoolExecutor(max_workers=5)


async def _run_in_executor(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a sync function in a thread pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, partial(func, *args, **kwargs))


@dataclass
class TranscriptionResult:
    """Result from speech-to-text transcription."""

    text: str
    confidence: float
    language: str
    duration_ms: int
    words: list[dict[str, Any]] = field(default_factory=list)
    is_final: bool = True
    alternatives: list[str] = field(default_factory=list)


@dataclass
class TranscriptionConfig:
    """Configuration for transcription."""

    language_code: str = "en-US"
    sample_rate_hertz: int = 48000
    audio_channel_count: int = 1
    enable_automatic_punctuation: bool = True
    enable_word_time_offsets: bool = True
    model: str = "latest_long"  # Best for general transcription
    use_enhanced: bool = True


@dataclass
class AsyncTranscriptionConfig:
    """Configuration for async (long-running) transcription."""

    gcs_uri: str  # gs://bucket/path/to/audio
    language_code: str = "en-US"
    sample_rate_hertz: int = 48000
    audio_channel_count: int = 1
    encoding: str = "WEBM_OPUS"
    enable_automatic_punctuation: bool = True
    enable_word_time_offsets: bool = True


# Encoding mapping
ENCODING_MAP = {
    "webm": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
    "mp3": speech.RecognitionConfig.AudioEncoding.MP3,
    "wav": speech.RecognitionConfig.AudioEncoding.LINEAR16,
    "flac": speech.RecognitionConfig.AudioEncoding.FLAC,
    "ogg": speech.RecognitionConfig.AudioEncoding.OGG_OPUS,
    "mulaw": speech.RecognitionConfig.AudioEncoding.MULAW,
    "alaw": speech.RecognitionConfig.AudioEncoding.MULAW,
}


class SpeechClient:
    """Google Cloud Speech-to-Text client for transcription operations."""

    def __init__(
        self,
        project_id: str | None = None,
    ):
        """Initialize Speech client.

        Args:
            project_id: GCP project ID (uses default if not specified)
        """
        self.project_id = project_id
        self._client = speech.SpeechClient()

    def _get_encoding(self, format_str: str) -> speech.RecognitionConfig.AudioEncoding:
        """Map format string to GCP encoding."""
        return ENCODING_MAP.get(  # type: ignore[return-value]
            format_str.lower(),
            speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED,
        )

    async def transcribe_audio(
        self,
        audio_data: bytes,
        config: TranscriptionConfig | None = None,
    ) -> TranscriptionResult:
        """Transcribe audio data synchronously.

        Best for audio < 1 minute in duration.

        Args:
            audio_data: Raw audio bytes
            config: Transcription configuration

        Returns:
            TranscriptionResult with transcribed text
        """
        if config is None:
            config = TranscriptionConfig()

        def _transcribe() -> TranscriptionResult:
            recognition_config = speech.RecognitionConfig(
                language_code=config.language_code,
                sample_rate_hertz=config.sample_rate_hertz,
                audio_channel_count=config.audio_channel_count,
                enable_automatic_punctuation=config.enable_automatic_punctuation,
                enable_word_time_offsets=config.enable_word_time_offsets,
                model=config.model,
                use_enhanced=config.use_enhanced,
            )

            audio = speech.RecognitionAudio(content=audio_data)

            response = self._client.recognize(config=recognition_config, audio=audio)

            # Combine all results
            full_text = ""
            words: list[dict[str, Any]] = []
            confidence = 0.0
            alternatives: list[str] = []
            duration_ms = 0

            for result in response.results:
                if result.alternatives:
                    best = result.alternatives[0]
                    full_text += best.transcript + " "
                    confidence = max(confidence, best.confidence)

                    # Collect words
                    for word_info in best.words:
                        words.append(
                            {
                                "word": word_info.word,
                                "start_time": word_info.start_time.total_seconds() * 1000,
                                "end_time": word_info.end_time.total_seconds() * 1000,
                                "confidence": word_info.confidence
                                if hasattr(word_info, "confidence")
                                else None,
                            }
                        )
                        duration_ms = max(
                            duration_ms, int(word_info.end_time.total_seconds() * 1000)
                        )

                    # Collect alternatives
                    for alt in result.alternatives[1:]:
                        alternatives.append(alt.transcript)

            return TranscriptionResult(
                text=full_text.strip(),
                confidence=confidence,
                language=config.language_code,
                duration_ms=duration_ms,
                words=words,
                is_final=True,
                alternatives=alternatives,
            )

        return cast("TranscriptionResult", await _run_in_executor(_transcribe))

    async def transcribe_gcs_async(
        self,
        config: AsyncTranscriptionConfig,
    ) -> str:
        """Start an async transcription job for audio in GCS.

        Best for audio > 1 minute in duration.

        Args:
            config: Async transcription configuration

        Returns:
            Operation name for tracking the job
        """

        def _start_async() -> str:
            recognition_config = speech.RecognitionConfig(
                encoding=self._get_encoding(config.encoding),
                sample_rate_hertz=config.sample_rate_hertz,
                language_code=config.language_code,
                audio_channel_count=config.audio_channel_count,
                enable_automatic_punctuation=config.enable_automatic_punctuation,
                enable_word_time_offsets=config.enable_word_time_offsets,
            )

            audio = speech.RecognitionAudio(uri=config.gcs_uri)

            operation = self._client.long_running_recognize(config=recognition_config, audio=audio)

            return cast("str", operation.operation.name)

        return cast("str", await _run_in_executor(_start_async))

    async def get_async_result(
        self,
        operation_name: str,
    ) -> TranscriptionResult | None:
        """Get the result of an async transcription job.

        Args:
            operation_name: The operation name from transcribe_gcs_async

        Returns:
            TranscriptionResult if complete, None if still processing
        """

        def _get_result() -> TranscriptionResult | None:
            # Get the operation
            request = operations_pb2.GetOperationRequest(name=operation_name)
            operation = self._client._transport.operations_client.get_operation(request)

            if not operation.done:
                return None

            # Parse the response
            response = speech.LongRunningRecognizeResponse()
            operation.response.Unpack(response)

            # Combine all results
            full_text = ""
            words: list[dict[str, Any]] = []
            confidence = 0.0
            duration_ms = 0

            for result in response.results:
                if result.alternatives:
                    best = result.alternatives[0]
                    full_text += best.transcript + " "
                    confidence = max(confidence, best.confidence)

                    for word_info in best.words:
                        words.append(
                            {
                                "word": word_info.word,
                                "start_time": word_info.start_time.total_seconds() * 1000,
                                "end_time": word_info.end_time.total_seconds() * 1000,
                            }
                        )
                        duration_ms = max(
                            duration_ms, int(word_info.end_time.total_seconds() * 1000)
                        )

            return TranscriptionResult(
                text=full_text.strip(),
                confidence=confidence,
                language="en-US",  # Would need to track from config
                duration_ms=duration_ms,
                words=words,
                is_final=True,
            )

        return cast("TranscriptionResult | None", await _run_in_executor(_get_result))

    async def wait_for_transcription(
        self,
        operation_name: str,
        max_attempts: int = 60,
        delay_seconds: int = 5,
    ) -> TranscriptionResult | None:
        """Wait for an async transcription job to complete.

        Args:
            operation_name: The operation name from transcribe_gcs_async
            max_attempts: Maximum polling attempts
            delay_seconds: Delay between attempts

        Returns:
            TranscriptionResult if successful, None if failed/timeout
        """
        for _ in range(max_attempts):
            result = await self.get_async_result(operation_name)
            if result is not None:
                return result
            await asyncio.sleep(delay_seconds)

        logger.error(f"Transcription job timed out: {operation_name}")
        return None


class MockSpeechClient(SpeechClient):
    """Mock Speech client for local development.

    Provides placeholder responses for testing without GCP credentials.
    """

    def __init__(self, **kwargs: Any):
        """Initialize mock client."""
        self.project_id = kwargs.get("project_id")
        self._client: speech.SpeechClient | None = None  # type: ignore[assignment]
        self._jobs: dict[str, dict[str, Any]] = {}

    async def transcribe_audio(
        self,
        audio_data: bytes,
        config: TranscriptionConfig | None = None,
    ) -> TranscriptionResult:
        """Mock audio transcription."""
        if config is None:
            config = TranscriptionConfig()
        logger.info(f"[MOCK] Transcribing {len(audio_data)} bytes of audio")
        return TranscriptionResult(
            text="[Mock transcription - voice features in dev mode]",
            confidence=0.95,
            language=config.language_code,
            duration_ms=1000,
            words=[
                {"word": "Mock", "start_time": 0, "end_time": 200},
                {"word": "transcription", "start_time": 200, "end_time": 600},
            ],
            is_final=True,
        )

    async def transcribe_gcs_async(
        self,
        config: AsyncTranscriptionConfig,
    ) -> str:
        """Mock starting async transcription."""
        operation_name = f"mock-operation-{hash(config.gcs_uri)}"
        self._jobs[operation_name] = {
            "gcs_uri": config.gcs_uri,
            "language": config.language_code,
            "status": "COMPLETED",
        }
        logger.info(f"[MOCK] Started async transcription job: {operation_name}")
        return operation_name

    async def get_async_result(
        self,
        operation_name: str,
    ) -> TranscriptionResult | None:
        """Mock getting async result."""
        job = self._jobs.get(operation_name)
        if not job:
            return None

        return TranscriptionResult(
            text="[Mock transcription from GCS audio file]",
            confidence=0.92,
            language=job.get("language", "en-US"),
            duration_ms=5000,
            is_final=True,
        )

    async def wait_for_transcription(
        self,
        operation_name: str,
        _max_attempts: int = 60,
        _delay_seconds: int = 5,
    ) -> TranscriptionResult | None:
        """Mock waiting - returns immediately."""
        return await self.get_async_result(operation_name)


def get_speech_client(
    project_id: str | None = None,
    use_mock: bool = False,
) -> SpeechClient:
    """Get a Speech client instance.

    Args:
        project_id: GCP project ID
        use_mock: Use mock client for local development

    Returns:
        SpeechClient or MockSpeechClient
    """
    if use_mock:
        return MockSpeechClient(project_id=project_id)
    return SpeechClient(project_id=project_id)
