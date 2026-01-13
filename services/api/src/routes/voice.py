"""Voice API routes for speech-to-text and text-to-speech."""

import base64
import contextlib
import json
import logging
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from podex_shared import generate_tts_summary, get_command_description, parse_voice_command
from podex_shared.aws import get_polly_client, get_transcribe_client
from podex_shared.aws.polly import PollyClient, SynthesisOptions
from podex_shared.aws.s3 import S3Client
from podex_shared.aws.transcribe import TranscribeClient, TranscriptionJobConfig
from src.config import settings
from src.database import get_db
from src.database.models import Agent as AgentModel
from src.database.models import Message as MessageModel
from src.database.models import Session as SessionModel
from src.middleware.rate_limit import RATE_LIMIT_STANDARD, RATE_LIMIT_UPLOAD, limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# Type alias for database session dependency
DbSession = Annotated[AsyncSession, Depends(get_db)]

# Maximum characters allowed for neural voice synthesis
MAX_NEURAL_VOICE_TEXT_LENGTH = 3000

# Audio file size limits
MAX_AUDIO_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MIN_AUDIO_FILE_SIZE = 100  # Minimum size for valid audio


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


def get_current_user_id(request: Request) -> str:
    """Get current user ID from request state."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return str(user_id)


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


def _get_polly_client() -> PollyClient:
    """Get Polly client based on environment."""
    use_mock = settings.ENVIRONMENT == "development" or settings.AWS_ENDPOINT is not None
    return get_polly_client(
        region=settings.AWS_REGION,
        endpoint_url=settings.AWS_ENDPOINT,
        use_mock=use_mock,
    )


def _get_transcribe_client() -> TranscribeClient:
    """Get Transcribe client based on environment."""
    use_mock = settings.ENVIRONMENT == "development" or settings.AWS_ENDPOINT is not None
    return get_transcribe_client(
        region=settings.AWS_REGION,
        endpoint_url=settings.AWS_ENDPOINT,
        use_mock=use_mock,
    )


# ============== Voice List Endpoints ==============


@router.get("/voices", response_model=list[VoiceInfoResponse])
@limiter.limit(RATE_LIMIT_STANDARD)
async def list_voices(
    request: Request,
    response: Response,  # noqa: ARG001
    language: str | None = None,
) -> list[VoiceInfoResponse]:
    """List available TTS voices from AWS Polly."""
    get_current_user_id(request)

    polly = _get_polly_client()
    voices = await polly.list_voices(language_code=language)

    return [
        VoiceInfoResponse(
            id=v.id,
            name=v.name,
            language_code=v.language_code,
            language_name=v.language_name,
            gender=v.gender,
            engine=v.engine,
        )
        for v in voices
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
        voice_id=config.get("voice_id", settings.DEFAULT_POLLY_VOICE_ID),
        speed=config.get("speed", 1.0),
        language=config.get("language", settings.DEFAULT_TRANSCRIBE_LANGUAGE),
    )


@router.patch(
    "/sessions/{session_id}/agents/{agent_id}/voice-config",
    response_model=VoiceConfig,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def update_agent_voice_config(  # noqa: PLR0913
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
        voice_id=config.get("voice_id", settings.DEFAULT_POLLY_VOICE_ID),
        speed=config.get("speed", 1.0),
        language=config.get("language", settings.DEFAULT_TRANSCRIBE_LANGUAGE),
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
    """Parse AWS Transcribe output and return text, confidence, duration."""
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


async def _cleanup_transcription_files(
    s3: S3Client,
    input_key: str,
    output_key: str,
    job_name: str,
    transcribe: TranscribeClient,
) -> None:
    """Clean up S3 files and transcription job."""
    try:
        await s3.delete_object(input_key)
        await s3.delete_object(f"{output_key}.json")
    except Exception:
        logger.debug("Failed to clean up S3 transcription files: %s", input_key)

    with contextlib.suppress(Exception):
        await transcribe.delete_transcription_job(job_name)


@router.post(
    "/sessions/{session_id}/transcribe",
    response_model=TranscribeResponse,
)
@limiter.limit(RATE_LIMIT_UPLOAD)
async def transcribe_audio(
    session_id: str,
    request: Request,
    response: Response,  # noqa: ARG001
    data: TranscribeRequest,
) -> TranscribeResponse:
    """Transcribe audio to text using AWS Transcribe.

    Uploads audio to S3, starts a transcription job, and polls for completion.
    For short audio (< 60 seconds), this typically completes within 10-30 seconds.
    """
    get_current_user_id(request)

    # Decode and validate audio
    audio_data = _decode_audio_data(data.audio_b64)

    # Use local Whisper in development mode
    if settings.ENVIRONMENT == "development":
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

    transcribe = _get_transcribe_client()

    # Production: Upload to S3 and start transcription job
    s3 = S3Client(
        bucket=settings.S3_BUCKET,
        prefix=settings.VOICE_AUDIO_S3_PREFIX,
        region=settings.AWS_REGION,
        endpoint_url=settings.AWS_ENDPOINT,
    )

    # Generate unique job name and keys
    job_id = str(uuid4())
    job_name = f"transcribe-{session_id[:8]}-{job_id[:8]}"
    input_key = f"input/{session_id}/{job_id}.{data.format}"
    output_key = f"output/{session_id}/{job_id}"

    # Upload audio to S3
    await s3.put_object(
        input_key,
        audio_data,
        content_type=f"audio/{data.format}",
    )

    s3_uri = f"s3://{settings.S3_BUCKET}/{settings.VOICE_AUDIO_S3_PREFIX}/{input_key}"

    # Start transcription job
    config = TranscriptionJobConfig(
        job_name=job_name,
        s3_uri=s3_uri,
        output_bucket=settings.S3_BUCKET,
        output_key=f"{settings.VOICE_AUDIO_S3_PREFIX}/{output_key}",
        language_code=data.language,
        media_format=data.format,
    )

    await transcribe.start_transcription_job(config)

    # Wait for transcription to complete
    aws_result = await transcribe.wait_for_transcription(
        job_name,
        max_attempts=120,  # Up to 10 minutes
        delay_seconds=5,
    )

    if not aws_result:
        # Clean up
        await s3.delete_object(input_key)
        raise HTTPException(status_code=500, detail="Transcription failed or timed out")

    # Fetch and parse the transcript from S3
    try:
        transcript_json = await s3.get_object_text(f"{output_key}.json")
        transcript_data = json.loads(transcript_json)
        text, avg_confidence, duration_ms = _parse_transcription_result(
            transcript_data,
            audio_data,
        )
    except FileNotFoundError:
        text, avg_confidence, duration_ms = "", 0.0, 0
    finally:
        # Clean up S3 files and transcription job
        await _cleanup_transcription_files(s3, input_key, output_key, job_name, transcribe)

    if not text:
        raise HTTPException(status_code=500, detail="No transcript generated")

    return TranscribeResponse(
        text=text,
        confidence=avg_confidence,
        duration_ms=duration_ms,
    )


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

    Uses pyttsx3 (local system voices) in development mode,
    AWS Polly in production.
    """
    get_current_user_id(request)

    if not data.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    if len(data.text) > MAX_NEURAL_VOICE_TEXT_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Text too long for neural voice (max {MAX_NEURAL_VOICE_TEXT_LENGTH} chars)",
        )

    # Use local pyttsx3 in development mode
    if settings.ENVIRONMENT == "development":
        try:
            result = await _pyttsx3_synthesize(text=data.text, voice_id=data.voice_id)
            return SynthesizeResponse(
                audio_url="",
                audio_b64=result.audio_b64,
                duration_ms=result.duration_ms,
                content_type=result.content_type,
            )
        except ImportError:
            logger.warning("pyttsx3 not available, falling back to mock")
            # Return empty audio with warning
            return SynthesizeResponse(
                audio_url="",
                audio_b64="",
                duration_ms=0,
                content_type="audio/wav",
            )
        except Exception as e:
            logger.exception("pyttsx3 synthesis failed")
            raise HTTPException(status_code=500, detail=f"Synthesis failed: {e}") from e

    # Production: Use AWS Polly
    polly = _get_polly_client()
    voice_id = data.voice_id or settings.DEFAULT_POLLY_VOICE_ID

    options = SynthesisOptions(
        voice_id=voice_id,
        output_format=data.format,
        engine=settings.DEFAULT_POLLY_ENGINE,
    )
    polly_result = await polly.synthesize_speech(text=data.text, options=options)

    # Encode audio as base64 for direct response
    audio_b64 = base64.b64encode(polly_result.audio_data).decode("utf-8")

    # Estimate duration (~60ms per character for natural speech)
    duration_ms = len(data.text) * 60

    return SynthesizeResponse(
        audio_url="",  # Would be S3 URL in production
        audio_b64=audio_b64,
        duration_ms=duration_ms,
        content_type=polly_result.content_type,
    )


@router.post(
    "/sessions/{session_id}/agents/{agent_id}/messages/{message_id}/synthesize",
    response_model=SynthesizeResponse,
)
@limiter.limit(RATE_LIMIT_STANDARD)
async def synthesize_message(  # noqa: PLR0913
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

    # Verify agent exists in the session
    agent_check_query = select(AgentModel).where(
        AgentModel.id == agent_id,
        AgentModel.session_id == session_id,
    )
    agent_check_result = await db.execute(agent_check_query)
    if not agent_check_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found in session")

    # Get the message (verify it belongs to the agent)
    query = select(MessageModel).where(
        MessageModel.id == message_id,
        MessageModel.agent_id == agent_id,
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

    # Get agent voice config
    agent_query = select(AgentModel).where(AgentModel.id == agent_id)
    agent_result = await db.execute(agent_query)
    agent = agent_result.scalar_one_or_none()

    voice_config: dict[str, Any] | None = agent.voice_config if agent else None
    default_voice = settings.DEFAULT_POLLY_VOICE_ID
    voice_id = voice_config.get("voice_id", default_voice) if voice_config else default_voice

    # Use local pyttsx3 in development mode
    if settings.ENVIRONMENT == "development":
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

    # Production: Use AWS Polly
    polly = _get_polly_client()
    synth_options = SynthesisOptions(
        voice_id=voice_id,
        output_format="mp3",
        engine=settings.DEFAULT_POLLY_ENGINE,
    )
    synth_result = await polly.synthesize_speech(text=text_to_speak, options=synth_options)

    audio_b64 = base64.b64encode(synth_result.audio_data).decode("utf-8")
    duration_ms = len(text_to_speak) * 60

    return SynthesizeResponse(
        audio_url="",
        audio_b64=audio_b64,
        duration_ms=duration_ms,
        content_type=synth_result.content_type,
    )


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

    This endpoint uses AWS Textract for OCR. In development mode,
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

    # Use local OCR in development, AWS Textract in production
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
        # Use AWS Textract for production
        return await _aws_ocr(image_bytes, data.language)


async def _local_ocr(image_bytes: bytes, language: str) -> OCRResponse:
    """Perform OCR using pytesseract (local).

    Requires: pip install pytesseract pillow
    And tesseract-ocr system package installed.
    """
    from io import BytesIO  # noqa: PLC0415

    from PIL import Image  # noqa: PLC0415

    try:
        import pytesseract  # noqa: PLC0415
    except ImportError as e:
        raise ImportError("pytesseract not installed. Run: pip install pytesseract") from e  # noqa: TRY003

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


async def _aws_ocr(image_bytes: bytes, language: str) -> OCRResponse:
    """Perform OCR using AWS Textract."""
    import aioboto3  # noqa: PLC0415

    session = aioboto3.Session()

    try:
        async with session.client(
            "textract",
            region_name=settings.AWS_REGION,
            endpoint_url=settings.AWS_ENDPOINT,
        ) as textract:
            # Detect text in image
            ocr_response = await textract.detect_document_text(Document={"Bytes": image_bytes})

            # Parse response
            blocks: list[OCRTextBlock] = []
            full_text_parts: list[str] = []
            confidences: list[float] = []

            for block in ocr_response.get("Blocks", []):
                if block["BlockType"] == "LINE":
                    text = block.get("Text", "")
                    confidence = block.get("Confidence", 0) / 100.0

                    # Get bounding box
                    bbox = block.get("Geometry", {}).get("BoundingBox", {})

                    blocks.append(
                        OCRTextBlock(
                            text=text,
                            confidence=confidence,
                            bounding_box={
                                "left": bbox.get("Left", 0),
                                "top": bbox.get("Top", 0),
                                "width": bbox.get("Width", 0),
                                "height": bbox.get("Height", 0),
                            },
                        )
                    )
                    full_text_parts.append(text)
                    confidences.append(confidence)

            avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

            return OCRResponse(
                text="\n".join(full_text_parts),
                blocks=blocks,
                language=language,
                confidence=avg_confidence,
            )

    except Exception as e:
        logger.exception("AWS Textract error")
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
    import asyncio  # noqa: PLC0415
    import tempfile  # noqa: PLC0415

    try:
        import whisper  # noqa: PLC0415
    except ImportError as e:
        raise ImportError("whisper not installed. Run: pip install openai-whisper") from e  # noqa: TRY003

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

        result = await loop.run_in_executor(None, _transcribe)

        return LocalTranscribeResponse(
            text=result.get("text", "").strip(),
            language=result.get("language", language or "en"),
            confidence=0.9,  # Whisper doesn't provide confidence scores
        )

    finally:
        # Clean up temp file
        from pathlib import Path  # noqa: PLC0415

        with contextlib.suppress(OSError):
            Path(temp_path).unlink()


class LocalSynthesizeResponse(BaseModel):
    """Response for local TTS synthesis using pyttsx3."""

    audio_b64: str
    duration_ms: int
    content_type: str
    voice_used: str


async def _pyttsx3_synthesize(  # noqa: PLR0915
    text: str,
    voice_id: str | None = None,
    rate: int = 150,
    volume: float = 1.0,
) -> LocalSynthesizeResponse:
    """Synthesize speech using pyttsx3."""
    import asyncio  # noqa: PLC0415
    import os  # noqa: PLC0415
    import sys  # noqa: PLC0415
    import tempfile  # noqa: PLC0415
    from pathlib import Path  # noqa: PLC0415

    try:
        import pyttsx3  # noqa: PLC0415
    except ImportError as e:
        raise ImportError("pyttsx3 not installed. Run: pip install pyttsx3") from e  # noqa: TRY003

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
                try:
                    sys.stderr = open(os.devnull, "w")  # noqa: SIM115, PTH123
                    engine.runAndWait()
                finally:
                    sys.stderr.close()
                    sys.stderr = stderr_backup

                return voice_used
            finally:
                # Properly cleanup engine to prevent weak reference errors
                try:  # noqa: SIM105
                    engine.stop()
                except Exception:  # noqa: S110
                    pass  # Ignore cleanup errors
                del engine

        voice_used = await loop.run_in_executor(None, _synthesize)

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
        import pyttsx3  # noqa: PLC0415
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
