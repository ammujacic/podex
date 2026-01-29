"""Voice API routes for speech-to-text and text-to-speech.

Supports multiple voice providers:
- local: pyttsx3 for TTS, whisper for STT (no cloud dependency)
- openai: OpenAI TTS and Whisper API (requires OPENAI_API_KEY)
- google: Google Cloud TTS and Speech-to-Text (requires GCP credentials)
"""

import base64
import contextlib
import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from podex_shared import generate_tts_summary, get_command_description, parse_voice_command
from podex_shared.gcp import get_speech_client, get_tts_client
from podex_shared.gcp.stt import SpeechClient
from podex_shared.gcp.tts import TTSClient
from src.config import settings
from src.database.models import Agent as AgentModel
from src.database.models import ConversationMessage
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, RATE_LIMIT_UPLOAD, limiter
from src.routes.dependencies import DbSession, get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter()

# Maximum characters allowed for neural voice synthesis
MAX_NEURAL_VOICE_TEXT_LENGTH = 3000

# Audio file size limits
MAX_AUDIO_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MIN_AUDIO_FILE_SIZE = 100  # Minimum size for valid audio

# SECURITY: Timeouts for voice processing to prevent resource exhaustion
WHISPER_TRANSCRIPTION_TIMEOUT = 120  # 2 minutes max for transcription
TTS_SYNTHESIS_TIMEOUT = 60  # 1 minute max for TTS synthesis


class VisionAPIError(HTTPException):
    """Exception raised for Vision API errors."""

    def __init__(self, message: str) -> None:
        super().__init__(
            status_code=503,
            detail=f"Vision API error: {message}",
        )


# ============== Pydantic Models ==============


class VoiceConfig(BaseModel):
    """Voice configuration for an agent."""

    tts_enabled: bool = False
    auto_play: bool = False
    voice_id: str | None = None
    speed: float = 1.0
    language: str = "en-US"


class VoiceConfigUpdate(BaseModel):
    """Voice configuration update request."""

    tts_enabled: bool | None = None
    auto_play: bool | None = None
    voice_id: str | None = None
    speed: float | None = None
    language: str | None = None


class VoiceInfoResponse(BaseModel):
    """Voice information response."""

    id: str
    name: str
    language_code: str
    language_name: str
    gender: str
    engine: str


class TranscribeRequest(BaseModel):
    """Transcription request."""

    audio_b64: str
    format: str = "webm"
    language: str = "en-US"


class TranscribeResponse(BaseModel):
    """Transcription response."""

    text: str
    confidence: float
    duration_ms: int


class SynthesizeRequest(BaseModel):
    """TTS synthesis request."""

    text: str
    voice_id: str | None = None
    format: str = "mp3"
    speed: float = 1.0


class SynthesizeResponse(BaseModel):
    """TTS synthesis response."""

    audio_url: str
    audio_b64: str | None = None
    duration_ms: int
    content_type: str


class VoiceCommandRequest(BaseModel):
    """Voice command request."""

    text: str  # Transcribed text to parse as command
    session_id: str | None = None  # Optional session context


class VoiceCommandResponse(BaseModel):
    """Parsed voice command response."""

    command_type: str
    target: str | None = None
    message: str | None = None
    confidence: float
    description: str
    raw_text: str
    metadata: dict[str, Any] | None = None


# ============== Helper Functions ==============


async def verify_session_access(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> SessionModel:
    """Verify user has access to the session.

    Args:
        session_id: The session ID to check.
        request: The FastAPI request.
        db: Database session.

    Returns:
        The session if access is granted.

    Raises:
        HTTPException: If session not found or access denied.
    """
    user_id = get_current_user_id(request)

    query = select(SessionModel).where(SessionModel.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return session


def _get_tts_client() -> TTSClient:
    """Get Google Cloud TTS client based on environment."""
    use_mock = settings.ENVIRONMENT == "development"
    return get_tts_client(use_mock=use_mock)


def _get_speech_client() -> SpeechClient:
    """Get Google Cloud Speech-to-Text client based on environment."""
    use_mock = settings.ENVIRONMENT == "development"
    return get_speech_client(use_mock=use_mock)


def _get_voice_provider() -> str:
    """Get the configured voice provider."""
    return getattr(settings, "VOICE_PROVIDER", "local").lower()


# ============== OpenAI Voice Service Helpers ==============


class OpenAITTSResponse(BaseModel):
    """Response for OpenAI TTS synthesis."""

    audio_b64: str
    duration_ms: int
    content_type: str
    voice_used: str


async def _openai_tts_synthesize(
    text: str,
    voice_id: str | None = None,
    output_format: str = "mp3",
) -> OpenAITTSResponse:
    """Synthesize speech using OpenAI TTS API.

    Args:
        text: Text to synthesize
        voice_id: Voice ID (alloy, echo, fable, onyx, nova, shimmer)
        output_format: Output format (mp3, opus, aac, flac)

    Returns:
        OpenAITTSResponse with audio data
    """
    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in environment.",
        )

    voice = voice_id or getattr(settings, "DEFAULT_TTS_VOICE_ID", "alloy")
    model = getattr(settings, "OPENAI_TTS_MODEL", "tts-1")

    # Valid OpenAI voices
    valid_voices = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
    if voice not in valid_voices:
        voice = "alloy"

    # Map format to response_format
    format_map = {
        "mp3": "mp3",
        "wav": "pcm",  # OpenAI returns PCM for wav-like output
        "ogg": "opus",
        "opus": "opus",
        "aac": "aac",
        "flac": "flac",
    }
    response_format = format_map.get(output_format, "mp3")

    content_type_map = {
        "mp3": "audio/mpeg",
        "pcm": "audio/wav",
        "opus": "audio/ogg",
        "aac": "audio/aac",
        "flac": "audio/flac",
    }

    try:
        async with httpx.AsyncClient(timeout=TTS_SYNTHESIS_TIMEOUT) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "input": text,
                    "voice": voice,
                    "response_format": response_format,
                },
            )
            response.raise_for_status()

            audio_data = response.content
            audio_b64 = base64.b64encode(audio_data).decode("utf-8")

            # Estimate duration (~60ms per character)
            duration_ms = len(text) * 60

            return OpenAITTSResponse(
                audio_b64=audio_b64,
                duration_ms=duration_ms,
                content_type=content_type_map.get(response_format, "audio/mpeg"),
                voice_used=voice,
            )

    except httpx.HTTPStatusError as e:
        logger.exception("OpenAI TTS API error")
        raise HTTPException(
            status_code=503,
            detail=f"OpenAI TTS error: {e.response.text}",
        ) from e
    except Exception as e:
        logger.exception("OpenAI TTS synthesis failed")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {e}") from e


class OpenAISTTResponse(BaseModel):
    """Response for OpenAI Whisper API transcription."""

    text: str
    language: str
    confidence: float


async def _openai_whisper_transcribe(
    audio_bytes: bytes,
    language: str | None = None,
    audio_format: str = "webm",
) -> OpenAISTTResponse:
    """Transcribe audio using OpenAI Whisper API.

    Args:
        audio_bytes: Audio data
        language: Optional language hint (ISO 639-1 code)
        audio_format: Audio format (webm, mp3, wav, etc.)

    Returns:
        OpenAISTTResponse with transcription
    """
    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY in environment.",
        )

    # Map format to file extension
    ext_map = {
        "webm": "webm",
        "mp3": "mp3",
        "wav": "wav",
        "ogg": "ogg",
        "m4a": "m4a",
        "flac": "flac",
    }
    file_ext = ext_map.get(audio_format.lower(), "webm")

    try:
        # Build multipart form data
        files = {
            "file": (f"audio.{file_ext}", audio_bytes, f"audio/{file_ext}"),
        }
        data: dict[str, str] = {
            "model": "whisper-1",
        }
        if language:
            # OpenAI expects ISO 639-1 codes (e.g., "en", not "en-US")
            data["language"] = language.split("-")[0]

        async with httpx.AsyncClient(timeout=WHISPER_TRANSCRIPTION_TIMEOUT) as client:
            response = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                },
                files=files,
                data=data,
            )
            response.raise_for_status()

            result = response.json()
            text = result.get("text", "").strip()

            return OpenAISTTResponse(
                text=text,
                language=language or "en",
                confidence=0.95,  # OpenAI doesn't provide confidence scores
            )

    except httpx.HTTPStatusError as e:
        logger.exception("OpenAI Whisper API error")
        raise HTTPException(
            status_code=503,
            detail=f"OpenAI transcription error: {e.response.text}",
        ) from e
    except Exception as e:
        logger.exception("OpenAI Whisper transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e


# ============== Voice List Endpoints ==============


@router.get("/voices", response_model=list[VoiceInfoResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_voices(
    request: Request,
    response: Response,  # noqa: ARG001
    language: str | None = None,
) -> list[VoiceInfoResponse]:
    """List available TTS voices based on configured provider.

    Returns voices from the configured VOICE_PROVIDER:
    - local: System voices via pyttsx3
    - openai: OpenAI TTS voices (alloy, echo, fable, onyx, nova, shimmer)
    - google: Google Cloud TTS voices
    """
    get_current_user_id(request)

    provider = _get_voice_provider()

    # OpenAI TTS voices
    if provider == "openai":
        openai_voices = [
            VoiceInfoResponse(
                id="alloy",
                name="Alloy",
                language_code="en",
                language_name="English",
                gender="Neutral",
                engine="openai-tts",
            ),
            VoiceInfoResponse(
                id="echo",
                name="Echo",
                language_code="en",
                language_name="English",
                gender="Male",
                engine="openai-tts",
            ),
            VoiceInfoResponse(
                id="fable",
                name="Fable",
                language_code="en",
                language_name="English",
                gender="Neutral",
                engine="openai-tts",
            ),
            VoiceInfoResponse(
                id="onyx",
                name="Onyx",
                language_code="en",
                language_name="English",
                gender="Male",
                engine="openai-tts",
            ),
            VoiceInfoResponse(
                id="nova",
                name="Nova",
                language_code="en",
                language_name="English",
                gender="Female",
                engine="openai-tts",
            ),
            VoiceInfoResponse(
                id="shimmer",
                name="Shimmer",
                language_code="en",
                language_name="English",
                gender="Female",
                engine="openai-tts",
            ),
        ]
        # Filter by language if requested
        if language:
            lang_prefix = language.split("-")[0].lower()
            # OpenAI voices support all languages, but we show English as primary
            if lang_prefix != "en":
                # Still return all voices as they support multiple languages
                return openai_voices
        return openai_voices

    # Google Cloud TTS voices
    if provider == "google":
        tts = _get_tts_client()
        voices = await tts.list_voices(language_code=language)
        return [
            VoiceInfoResponse(
                id=v.id,
                name=v.name,
                language_code=v.language_code,
                language_name=v.language_name,
                gender=v.gender,
                engine="neural",
            )
            for v in voices
        ]

    # Local voices (pyttsx3) - redirect to /voices/local endpoint
    # Return mock voices for API compatibility
    return [
        VoiceInfoResponse(
            id="system-default",
            name="System Default",
            language_code="en",
            language_name="English",
            gender="Neutral",
            engine="local",
        ),
    ]


# ============== Agent Voice Config Endpoints ==============


@router.get(
    "/sessions/{session_id}/agents/{agent_id}/voice-config",
    response_model=VoiceConfig,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def get_agent_voice_config(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
) -> VoiceConfig:
    """Get voice configuration for an agent."""
    # Verify user has access to the session
    await verify_session_access(session_id, request, db)

    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = agent.voice_config or {}
    return VoiceConfig(
        tts_enabled=config.get("tts_enabled", False),
        auto_play=config.get("auto_play", False),
        voice_id=config.get("voice_id", settings.DEFAULT_TTS_VOICE_ID),
        speed=config.get("speed", 1.0),
        language=config.get("language", settings.DEFAULT_SPEECH_LANGUAGE),
    )


@router.patch(
    "/sessions/{session_id}/agents/{agent_id}/voice-config",
    response_model=VoiceConfig,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent_voice_config(
    session_id: str,
    agent_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: VoiceConfigUpdate,
    db: DbSession,
) -> VoiceConfig:
    """Update voice configuration for an agent."""
    # Verify user has access to the session
    await verify_session_access(session_id, request, db)

    query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    result = await db.execute(query)
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Update voice config
    config = agent.voice_config or {}
    if data.tts_enabled is not None:
        config["tts_enabled"] = data.tts_enabled
    if data.auto_play is not None:
        config["auto_play"] = data.auto_play
    if data.voice_id is not None:
        config["voice_id"] = data.voice_id
    if data.speed is not None:
        config["speed"] = data.speed
    if data.language is not None:
        config["language"] = data.language

    agent.voice_config = config
    await db.commit()

    return VoiceConfig(
        tts_enabled=config.get("tts_enabled", False),
        auto_play=config.get("auto_play", False),
        voice_id=config.get("voice_id", settings.DEFAULT_TTS_VOICE_ID),
        speed=config.get("speed", 1.0),
        language=config.get("language", settings.DEFAULT_SPEECH_LANGUAGE),
    )


# ============== Transcription Endpoints ==============


def _decode_audio_data(audio_b64: str) -> bytes:
    """Decode and validate base64 audio data."""
    try:
        audio_data = base64.b64decode(audio_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio data") from None

    if len(audio_data) > MAX_AUDIO_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Audio file too large (max 10MB)")

    if len(audio_data) < MIN_AUDIO_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Audio file too small")

    return audio_data


def _parse_transcription_result(
    transcript_data: dict[str, Any],
    audio_data: bytes,
) -> tuple[str, float, int]:
    """Parse transcription output and return text, confidence, duration."""
    results = transcript_data.get("results", {})
    transcripts = results.get("transcripts", [])
    text = transcripts[0].get("transcript", "") if transcripts else ""

    # Calculate average confidence from items
    items = results.get("items", [])
    confidences = [
        float(item.get("alternatives", [{}])[0].get("confidence", 0))
        for item in items
        if item.get("alternatives")
    ]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    # Estimate duration from audio size (rough approximation)
    duration_ms = len(audio_data) // 16  # ~16 bytes per ms for webm audio

    return text, avg_confidence, duration_ms


@router.post(
    "/sessions/{session_id}/transcribe",
    response_model=TranscribeResponse,
)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def transcribe_audio(
    session_id: str,  # noqa: ARG001
    request: Request,
    response: Response,  # noqa: ARG001
    data: TranscribeRequest,
) -> TranscribeResponse:
    """Transcribe audio to text.

    Supports multiple providers based on VOICE_PROVIDER setting:
    - local: Uses OpenAI Whisper model running locally
    - openai: Uses OpenAI Whisper API (cloud)
    - google: Uses Google Cloud Speech-to-Text
    """
    get_current_user_id(request)

    # Decode and validate audio
    audio_data = _decode_audio_data(data.audio_b64)

    provider = _get_voice_provider()

    # Local Whisper (runs on-device)
    if provider == "local":
        try:
            result = await _whisper_transcribe(audio_data, data.language)
            return TranscribeResponse(
                text=result.text,
                confidence=result.confidence,
                duration_ms=len(audio_data) // 16,  # Estimate from audio size
            )
        except ImportError:
            logger.warning("Whisper not available, falling back to mock")
            return TranscribeResponse(
                text="[Whisper not installed - run: pip install openai-whisper]",
                confidence=0.0,
                duration_ms=1000,
            )
        except Exception as e:
            logger.exception("Whisper transcription failed")
            raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e

    # OpenAI Whisper API (cloud)
    if provider == "openai":
        try:
            result = await _openai_whisper_transcribe(
                audio_bytes=audio_data,
                language=data.language,
                audio_format=data.format,
            )
            return TranscribeResponse(
                text=result.text,
                confidence=result.confidence,
                duration_ms=len(audio_data) // 16,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("OpenAI Whisper transcription failed")
            raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e

    # Google Cloud Speech-to-Text
    if provider == "google":
        speech = _get_speech_client()
        try:
            result = await speech.transcribe(  # type: ignore[attr-defined]
                audio_data=audio_data,
                encoding=data.format.upper(),
                language_code=data.language or "en-US",
            )

            text = result.transcript
            avg_confidence = result.confidence
            duration_ms = int(result.duration_seconds * 1000) if result.duration_seconds else 0
        except Exception as e:
            logger.exception("GCP Speech transcription failed")
            raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e

        if not text:
            raise HTTPException(status_code=500, detail="No transcript generated")

        return TranscribeResponse(
            text=text,
            confidence=avg_confidence,
            duration_ms=duration_ms,
        )

    # Unknown provider - fall back to local
    logger.warning(f"Unknown voice provider '{provider}', falling back to local")
    try:
        result = await _whisper_transcribe(audio_data, data.language)
        return TranscribeResponse(
            text=result.text,
            confidence=result.confidence,
            duration_ms=len(audio_data) // 16,
        )
    except Exception as e:
        logger.exception("Fallback transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e


# ============== Synthesis Endpoints ==============


@router.post(
    "/sessions/{session_id}/synthesize",
    response_model=SynthesizeResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def synthesize_speech(
    _session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: SynthesizeRequest,
) -> SynthesizeResponse:
    """Synthesize text to speech.

    Supports multiple providers based on VOICE_PROVIDER setting:
    - local: Uses pyttsx3 (system voices - espeak on Linux, SAPI on Windows, etc.)
    - openai: Uses OpenAI TTS API (alloy, echo, fable, onyx, nova, shimmer voices)
    - google: Uses Google Cloud Text-to-Speech
    """
    get_current_user_id(request)

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if len(data.text) > MAX_NEURAL_VOICE_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long for neural voice (max {MAX_NEURAL_VOICE_TEXT_LENGTH} chars)",
        )

    provider = _get_voice_provider()
    voice_id = data.voice_id or settings.DEFAULT_TTS_VOICE_ID

    # Local pyttsx3 (system voices)
    if provider == "local":
        try:
            result = await _pyttsx3_synthesize(text=data.text, voice_id=voice_id)
            return SynthesizeResponse(
                audio_url="",
                audio_b64=result.audio_b64,
                duration_ms=result.duration_ms,
                content_type=result.content_type,
            )
        except ImportError:
            logger.warning("pyttsx3 not available, falling back to mock")
            return SynthesizeResponse(
                audio_url="",
                audio_b64="",
                duration_ms=0,
                content_type="audio/wav",
            )
        except Exception as e:
            logger.exception("pyttsx3 synthesis failed")
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

    # OpenAI TTS API
    if provider == "openai":
        try:
            result = await _openai_tts_synthesize(
                text=data.text,
                voice_id=voice_id,
                output_format=data.format,
            )
            return SynthesizeResponse(
                audio_url="",
                audio_b64=result.audio_b64,
                duration_ms=result.duration_ms,
                content_type=result.content_type,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("OpenAI TTS synthesis failed")
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

    # Google Cloud TTS
    if provider == "google":
        tts = _get_tts_client()
        tts_result = await tts.synthesize_speech(  # type: ignore[call-arg]
            text=data.text,
            voice_name=voice_id,
            audio_encoding=data.format.upper(),
        )

        audio_b64 = base64.b64encode(tts_result.audio_data).decode("utf-8")
        duration_ms = len(data.text) * 60

        return SynthesizeResponse(
            audio_url="",
            audio_b64=audio_b64,
            duration_ms=duration_ms,
            content_type=tts_result.content_type,
        )

    # Unknown provider - fall back to local
    logger.warning(f"Unknown voice provider '{provider}', falling back to local")
    try:
        result = await _pyttsx3_synthesize(text=data.text, voice_id=voice_id)
        return SynthesizeResponse(
            audio_url="",
            audio_b64=result.audio_b64,
            duration_ms=result.duration_ms,
            content_type=result.content_type,
        )
    except Exception as e:
        logger.exception("Fallback synthesis failed")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e


@router.post(
    "/sessions/{session_id}/agents/{agent_id}/messages/{message_id}/synthesize",
    response_model=SynthesizeResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def synthesize_message(
    session_id: str,
    agent_id: str,
    message_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    db: DbSession,
    *,
    regenerate: bool = False,
) -> SynthesizeResponse:
    """Synthesize TTS for an existing message.

    Uses the TTS summary if available, otherwise generates one.
    Summaries provide spoken-friendly versions that avoid reading code verbatim.
    """

    # Verify user has access to the session
    await verify_session_access(session_id, request, db)

    # Verify agent exists in the session and get its conversation session
    from sqlalchemy.orm import selectinload

    agent_check_query = (
        select(AgentModel)
        .options(selectinload(AgentModel.conversation_session))
        .where(
            AgentModel.id == agent_id,
            AgentModel.session_id == session_id,
        )
    )
    agent_check_result = await db.execute(agent_check_query)
    agent = agent_check_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found in session")

    if not agent.conversation_session:
        raise HTTPException(status_code=404, detail="Agent has no conversation session")

    # Get the message from the agent's conversation session
    query = select(ConversationMessage).where(
        ConversationMessage.id == message_id,
        ConversationMessage.conversation_session_id == agent.conversation_session.id,
    )
    result = await db.execute(query)
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Use existing TTS summary or generate one
    if message.tts_summary and not regenerate:
        text_to_speak = message.tts_summary
    else:
        # Generate summary on the fly
        summary_result = generate_tts_summary(message.content)
        text_to_speak = summary_result.summary

        # Save the summary for future use
        if summary_result.was_summarized or regenerate:
            message.tts_summary = summary_result.summary
            await db.commit()

    if not text_to_speak.strip():
        raise HTTPException(status_code=400, detail="No speakable content")

    # Get agent voice config (agent was already loaded above)
    voice_config: dict[str, Any] | None = agent.voice_config if agent else None
    default_voice = settings.DEFAULT_TTS_VOICE_ID
    voice_id = voice_config.get("voice_id", default_voice) if voice_config else default_voice

    provider = _get_voice_provider()

    # Local pyttsx3 (system voices)
    if provider == "local":
        try:
            local_result = await _pyttsx3_synthesize(text=text_to_speak, voice_id=voice_id)
            return SynthesizeResponse(
                audio_url="",
                audio_b64=local_result.audio_b64,
                duration_ms=local_result.duration_ms,
                content_type=local_result.content_type,
            )
        except ImportError:
            logger.warning("pyttsx3 not available for message synthesis")
            return SynthesizeResponse(
                audio_url="",
                audio_b64="",
                duration_ms=0,
                content_type="audio/wav",
            )
        except Exception as e:
            logger.exception("pyttsx3 message synthesis failed")
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

    # OpenAI TTS API
    if provider == "openai":
        try:
            result = await _openai_tts_synthesize(
                text=text_to_speak,
                voice_id=voice_id,
                output_format="mp3",
            )
            return SynthesizeResponse(
                audio_url="",
                audio_b64=result.audio_b64,
                duration_ms=result.duration_ms,
                content_type=result.content_type,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("OpenAI TTS message synthesis failed")
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

    # Google Cloud TTS
    if provider == "google":
        tts = _get_tts_client()
        tts_result = await tts.synthesize_speech(  # type: ignore[call-arg]
            text=text_to_speak,
            voice_name=voice_id,
            audio_encoding="MP3",
        )

        audio_b64 = base64.b64encode(tts_result.audio_data).decode("utf-8")
        duration_ms = len(text_to_speak) * 60

        return SynthesizeResponse(
            audio_url="",
            audio_b64=audio_b64,
            duration_ms=duration_ms,
            content_type=tts_result.content_type,
        )

    # Unknown provider - fall back to local
    logger.warning(f"Unknown voice provider '{provider}', falling back to local")
    try:
        local_result = await _pyttsx3_synthesize(text=text_to_speak, voice_id=voice_id)
        return SynthesizeResponse(
            audio_url="",
            audio_b64=local_result.audio_b64,
            duration_ms=local_result.duration_ms,
            content_type=local_result.content_type,
        )
    except Exception as e:
        logger.exception("Fallback message synthesis failed")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e


# ============== Voice Command Endpoints ==============


@router.post("/command", response_model=VoiceCommandResponse)
@limiter.limit(RATE_LIMIT_STANDARD)
async def parse_voice_command_endpoint(
    request: Request,
    response: Response,  # noqa: ARG001
    data: VoiceCommandRequest,
) -> VoiceCommandResponse:
    """Parse a voice command from transcribed text.

    Takes transcribed speech and returns a structured command that
    the frontend can execute (open file, talk to agent, etc.).
    """

    get_current_user_id(request)

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    # Parse the command
    parsed = parse_voice_command(data.text)

    return VoiceCommandResponse(
        command_type=parsed.type.value,
        target=parsed.target,
        message=parsed.message,
        confidence=parsed.confidence,
        description=get_command_description(parsed),
        raw_text=parsed.raw_text,
        metadata=parsed.metadata,
    )


# ============== OCR (Optical Character Recognition) ==============


class OCRRequest(BaseModel):
    """Request for OCR text extraction."""

    image_b64: str  # Base64 encoded image
    language: str = "en"  # Language hint


class OCRTextBlock(BaseModel):
    """A block of text extracted from an image."""

    text: str
    confidence: float
    bounding_box: dict[str, float] | None = None


class OCRResponse(BaseModel):
    """Response for OCR text extraction."""

    text: str  # Full extracted text
    blocks: list[OCRTextBlock]
    language: str
    confidence: float


@router.post("/ocr", response_model=OCRResponse)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def extract_text_from_image(
    request: Request,
    response: Response,  # noqa: ARG001
    data: OCRRequest,
) -> OCRResponse:
    """Extract text from an image using OCR.

    Supports base64-encoded images in common formats (PNG, JPEG, WebP).

    This endpoint uses Google Cloud Vision for OCR. In development mode,
    it falls back to pytesseract if available.
    """
    get_current_user_id(request)

    # Decode base64 image
    try:
        # Handle data URL format
        image_data = data.image_b64
        if image_data.startswith("data:"):
            image_data = image_data.split(",", 1)[1] if "," in image_data else image_data

        image_bytes = base64.b64decode(image_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}") from e

    # Validate size
    if len(image_bytes) > MAX_AUDIO_FILE_SIZE:  # Reuse 10MB limit
        raise HTTPException(status_code=400, detail="Image too large. Maximum size is 10MB")

    min_image_size = 100
    if len(image_bytes) < min_image_size:
        raise HTTPException(status_code=400, detail="Image too small to process")

    # Use local OCR in development, GCP Vision in production
    if settings.ENVIRONMENT == "development":
        # Try pytesseract for local OCR
        try:
            return await _local_ocr(image_bytes, data.language)
        except ImportError:
            # Fallback to mock if pytesseract not available
            logger.warning("pytesseract not available, returning mock OCR result")
            return OCRResponse(
                text="[OCR not available in dev mode - install pytesseract]",
                blocks=[
                    OCRTextBlock(
                        text="[OCR not available in dev mode]",
                        confidence=0.0,
                    )
                ],
                language=data.language,
                confidence=0.0,
            )
    else:
        # Use GCP Vision for production
        return await _gcp_vision_ocr(image_bytes, data.language)


async def _local_ocr(image_bytes: bytes, language: str) -> OCRResponse:
    """Perform OCR using pytesseract (local).

    Requires: pip install pytesseract pillow
    And tesseract-ocr system package installed.
    """
    from io import BytesIO

    from PIL import Image

    try:
        import pytesseract
    except ImportError as e:
        raise ImportError("pytesseract not installed") from e  # noqa: TRY003

    # Load image
    img = Image.open(BytesIO(image_bytes))

    # Map language codes
    lang_map = {
        "en": "eng",
        "es": "spa",
        "fr": "fra",
        "de": "deu",
        "it": "ita",
        "pt": "por",
        "zh": "chi_sim",
        "ja": "jpn",
        "ko": "kor",
    }
    tess_lang = lang_map.get(language, "eng")

    # Perform OCR
    # Get detailed data including confidence
    ocr_data = pytesseract.image_to_data(img, lang=tess_lang, output_type=pytesseract.Output.DICT)

    # Build response
    blocks: list[OCRTextBlock] = []
    full_text_parts: list[str] = []
    confidences: list[float] = []

    n_boxes = len(ocr_data["text"])
    for i in range(n_boxes):
        text = ocr_data["text"][i].strip()
        conf = float(ocr_data["conf"][i])

        if text and conf > 0:
            block = OCRTextBlock(
                text=text,
                confidence=conf / 100.0,  # Convert from 0-100 to 0-1
                bounding_box={
                    "left": ocr_data["left"][i],
                    "top": ocr_data["top"][i],
                    "width": ocr_data["width"][i],
                    "height": ocr_data["height"][i],
                },
            )
            blocks.append(block)
            full_text_parts.append(text)
            confidences.append(conf / 100.0)

    # Also get plain text
    full_text = pytesseract.image_to_string(img, lang=tess_lang)

    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    return OCRResponse(
        text=full_text.strip(),
        blocks=blocks,
        language=language,
        confidence=avg_confidence,
    )


async def _gcp_vision_ocr(image_bytes: bytes, language: str) -> OCRResponse:
    """Perform OCR using Google Cloud Vision API."""
    from google.cloud import vision  # type: ignore[attr-defined,import-untyped]

    try:
        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_bytes)

        # Perform text detection
        response = client.text_detection(image=image)

        if response.error.message:

            def _raise_vision_api_error() -> None:
                raise VisionAPIError(response.error.message)  # noqa: TRY301

            _raise_vision_api_error()

        # Parse response
        blocks: list[OCRTextBlock] = []
        full_text = ""

        for text_annotation in response.text_annotations:
            if text_annotation == response.text_annotations[0]:
                # First annotation is the full text
                full_text = text_annotation.description
            else:
                # Subsequent annotations are individual words/blocks
                vertices = text_annotation.bounding_poly.vertices
                blocks.append(
                    OCRTextBlock(
                        text=text_annotation.description,
                        confidence=0.95,  # Vision API doesn't provide per-block confidence
                        bounding_box={
                            "left": vertices[0].x if vertices else 0,
                            "top": vertices[0].y if vertices else 0,
                            "width": (vertices[2].x - vertices[0].x) if len(vertices) > 2 else 0,
                            "height": (vertices[2].y - vertices[0].y) if len(vertices) > 2 else 0,
                        },
                    )
                )

        return OCRResponse(
            text=full_text,
            blocks=blocks,
            language=language,
            confidence=0.95,
        )

    except Exception as e:
        logger.exception("GCP Vision OCR error")
        raise HTTPException(status_code=503, detail=f"OCR service error: {e}") from e


# ============== Local Voice Service Helpers ==============


class LocalTranscribeResponse(BaseModel):
    """Response for local transcription using Whisper."""

    text: str
    language: str
    confidence: float


async def _whisper_transcribe(
    audio_bytes: bytes,
    language: str | None = None,
) -> LocalTranscribeResponse:
    """Transcribe audio using Whisper model."""
    import asyncio
    import tempfile

    try:
        import whisper
    except ImportError as e:
        raise ImportError("whisper not installed") from e  # noqa: TRY003

    # Write audio to temp file (Whisper needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        # Load model (use tiny for speed in dev, base for better accuracy)
        model_name = "tiny" if settings.ENVIRONMENT == "development" else "base"

        # Run in thread pool to not block event loop
        loop = asyncio.get_event_loop()

        def _transcribe() -> dict[str, Any]:
            model = whisper.load_model(model_name)
            options: dict[str, Any] = {}
            if language:
                options["language"] = language
            result: dict[str, Any] = model.transcribe(temp_path, **options)
            return result

        # SECURITY: Add timeout to prevent resource exhaustion from long-running transcriptions
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _transcribe),
                timeout=WHISPER_TRANSCRIPTION_TIMEOUT,
            )
        except TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Transcription timed out after {WHISPER_TRANSCRIPTION_TIMEOUT} seconds",
            )

        return LocalTranscribeResponse(
            text=result.get("text", "").strip(),
            language=result.get("language", language or "en"),
            confidence=0.9,  # Whisper doesn't provide confidence scores
        )

    finally:
        # Clean up temp file
        from pathlib import Path

        with contextlib.suppress(OSError):
            Path(temp_path).unlink()


class LocalSynthesizeResponse(BaseModel):
    """Response for local TTS synthesis using pyttsx3."""

    audio_b64: str
    duration_ms: int
    content_type: str
    voice_used: str


async def _pyttsx3_synthesize(
    text: str,
    voice_id: str | None = None,
    rate: int = 150,
    volume: float = 1.0,
) -> LocalSynthesizeResponse:
    """Synthesize speech using pyttsx3."""
    import asyncio
    import os
    import sys
    import tempfile
    from pathlib import Path

    try:
        import pyttsx3
    except ImportError as e:
        raise ImportError("pyttsx3 not installed") from e  # noqa: TRY003

    # Create temp file for output
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
        temp_path = tmp_file.name

    voice_used = "default"

    try:
        loop = asyncio.get_event_loop()

        def _synthesize() -> str:
            nonlocal voice_used
            engine = pyttsx3.init()

            try:
                # Set properties
                engine.setProperty("rate", rate)
                engine.setProperty("volume", volume)

                # Set voice if specified
                if voice_id:
                    voices = engine.getProperty("voices")
                    for voice in voices:
                        if voice.id == voice_id or voice_id in voice.id:
                            engine.setProperty("voice", voice.id)
                            voice_used = voice.name
                            break
                else:
                    # Get default voice name
                    voices = engine.getProperty("voices")
                    if voices:
                        voice_used = voices[0].name

                # Save to file
                engine.save_to_file(text, temp_path)

                # Suppress stderr to hide pyttsx3 espeak ReferenceError warnings
                # These errors are harmless but noisy - they occur in espeak's C callbacks
                stderr_backup = sys.stderr
                with open(os.devnull, "w") as devnull:
                    sys.stderr = devnull
                    try:
                        engine.runAndWait()
                    finally:
                        sys.stderr = stderr_backup

                return voice_used
            finally:
                # Properly cleanup engine to prevent weak reference errors
                with contextlib.suppress(Exception):
                    engine.stop()
                del engine

        # SECURITY: Add timeout to prevent resource exhaustion from long-running synthesis
        try:
            voice_used = await asyncio.wait_for(
                loop.run_in_executor(None, _synthesize),
                timeout=TTS_SYNTHESIS_TIMEOUT,
            )
        except TimeoutError:
            raise HTTPException(
                status_code=504,
                detail=f"Speech synthesis timed out after {TTS_SYNTHESIS_TIMEOUT} seconds",
            )

        # Read the audio file
        audio_data = Path(temp_path).read_bytes()

        audio_b64 = base64.b64encode(audio_data).decode("utf-8")

        # Estimate duration (~60ms per character for natural speech)
        duration_ms = len(text) * 60

        return LocalSynthesizeResponse(
            audio_b64=audio_b64,
            duration_ms=duration_ms,
            content_type="audio/wav",
            voice_used=voice_used,
        )

    finally:
        # Clean up temp file
        with contextlib.suppress(OSError):
            Path(temp_path).unlink()


class LocalVoiceInfo(BaseModel):
    """Information about a local system voice."""

    id: str
    name: str
    languages: list[str]
    gender: str | None = None


@router.get("/voices/local", response_model=list[LocalVoiceInfo])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_local_voices(
    request: Request,
    response: Response,  # noqa: ARG001
) -> list[LocalVoiceInfo]:
    """List available local TTS voices from pyttsx3.

    Returns system voices available on the machine
    (SAPI on Windows, NSSpeechSynthesizer on macOS, espeak on Linux).
    """
    get_current_user_id(request)

    try:
        import pyttsx3
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail="pyttsx3 not available. Install with: pip install pyttsx3",
        ) from e

    try:
        engine = pyttsx3.init()
        voices = engine.getProperty("voices")

        result: list[LocalVoiceInfo] = [
            LocalVoiceInfo(
                id=voice.id,
                name=voice.name,
                languages=voice.languages if voice.languages else [],
                gender=getattr(voice, "gender", None),
            )
            for voice in voices
        ]
    except Exception as e:
        logger.exception("Failed to list local voices")
        raise HTTPException(status_code=500, detail=f"Failed to list voices: {e}") from e
    else:
        return result
