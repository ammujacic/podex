"""Shared GCP utilities for Podex services."""

from podex_shared.gcp.storage import GCSClient, WorkspaceGCSClient
from podex_shared.gcp.stt import (
    MockSpeechClient,
    SpeechClient,
    TranscriptionResult,
    get_speech_client,
)
from podex_shared.gcp.tts import (
    MockTTSClient,
    SynthesisResult,
    TTSClient,
    VoiceInfo,
    get_tts_client,
)

__all__ = [
    "GCSClient",
    "MockSpeechClient",
    "MockTTSClient",
    "SpeechClient",
    "SynthesisResult",
    "TTSClient",
    "TranscriptionResult",
    "VoiceInfo",
    "WorkspaceGCSClient",
    "get_speech_client",
    "get_tts_client",
]
