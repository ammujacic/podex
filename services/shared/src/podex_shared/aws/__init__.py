"""Shared AWS utilities for Podex services."""

from podex_shared.aws.polly import (
    MockPollyClient,
    PollyClient,
    SynthesisResult,
    VoiceInfo,
    get_polly_client,
)
from podex_shared.aws.s3 import S3Client
from podex_shared.aws.transcribe import (
    MockTranscribeClient,
    TranscribeClient,
    TranscriptionResult,
    get_transcribe_client,
)

__all__ = [
    "MockPollyClient",
    "MockTranscribeClient",
    "PollyClient",
    "S3Client",
    "SynthesisResult",
    "TranscribeClient",
    "TranscriptionResult",
    "VoiceInfo",
    "get_polly_client",
    "get_transcribe_client",
]
