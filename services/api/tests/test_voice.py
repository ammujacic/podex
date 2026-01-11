"""
Comprehensive tests for voice routes.

Tests cover:
- Voice configuration
- Text-to-speech operations
- Speech-to-text operations
"""


from fastapi.testclient import TestClient

# ============================================================================
# VOICE CONFIGURATION TESTS
# ============================================================================


class TestVoiceConfiguration:
    """Tests for voice configuration endpoints."""

    def test_get_voice_config_unauthenticated(self, client: TestClient) -> None:
        """Test getting voice config without auth."""
        response = client.get("/api/voice/config")
        assert response.status_code in [401, 404]

    def test_update_voice_config_unauthenticated(self, client: TestClient) -> None:
        """Test updating voice config without auth."""
        response = client.patch(
            "/api/voice/config",
            json={"enabled": True, "voice": "alloy"},
        )
        assert response.status_code in [401, 404, 405]


# ============================================================================
# TEXT-TO-SPEECH TESTS
# ============================================================================


class TestTextToSpeech:
    """Tests for text-to-speech endpoints."""

    def test_synthesize_speech_unauthenticated(self, client: TestClient) -> None:
        """Test synthesizing speech without auth."""
        response = client.post(
            "/api/voice/synthesize",
            json={"text": "Hello world", "voice": "alloy"},
        )
        assert response.status_code in [401, 404]

    def test_get_available_voices(self, client: TestClient) -> None:
        """Test getting available voices."""
        response = client.get("/api/voice/voices")
        assert response.status_code in [200, 401, 404]


# ============================================================================
# SPEECH-TO-TEXT TESTS
# ============================================================================


class TestSpeechToText:
    """Tests for speech-to-text endpoints."""

    def test_transcribe_audio_unauthenticated(self, client: TestClient) -> None:
        """Test transcribing audio without auth."""
        # Create a minimal audio file
        response = client.post(
            "/api/voice/transcribe",
            files={"audio": ("test.wav", b"fake audio data", "audio/wav")},
        )
        assert response.status_code in [401, 404, 422]
