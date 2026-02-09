"""Tests for local LLM providers (Ollama and LM Studio).

Tests cover:
- OllamaProvider initialization and methods
- LMStudioProvider initialization and methods
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


class TestOllamaProviderInit:
    """Test OllamaProvider initialization."""

    def test_ollama_module_exists(self):
        """Test ollama module can be imported."""
        from src.providers import ollama
        assert ollama is not None

    def test_ollama_provider_class_exists(self):
        """Test OllamaProvider class exists."""
        from src.providers.ollama import OllamaProvider
        assert OllamaProvider is not None

    def test_ollama_provider_initialization(self):
        """Test OllamaProvider initialization."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()
        assert provider.base_url == "http://localhost:11434"

    def test_ollama_provider_custom_url(self):
        """Test OllamaProvider with custom URL."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider(base_url="http://custom:1234/")
        assert provider.base_url == "http://custom:1234"

    def test_ollama_provider_has_client(self):
        """Test OllamaProvider has HTTP client."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()
        assert provider.client is not None


class TestOllamaProviderMethods:
    """Test OllamaProvider methods."""

    @pytest.mark.asyncio
    async def test_list_models_success(self):
        """Test listing models from Ollama."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "models": [
                {"name": "llama2", "size": 1234567890},
                {"name": "codellama-32k", "size": 1234567890},
                {"name": "deepseek-128k", "size": 1234567890},
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            models = await provider.list_models()

        assert len(models) == 3
        assert models[0].id == "ollama:llama2"
        assert models[0].provider == "ollama"
        assert models[0].is_local is True
        assert models[1].context_window == 32768  # 32k model
        assert models[2].context_window == 131072  # 128k model

    @pytest.mark.asyncio
    async def test_list_models_connection_error(self):
        """Test listing models with connection error."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection refused")

            with pytest.raises(ConnectionError, match="Failed to connect to Ollama"):
                await provider.list_models()

    @pytest.mark.asyncio
    async def test_chat_success(self):
        """Test chat with Ollama."""
        from src.providers.ollama import OllamaProvider
        from src.providers.base import ChatMessage

        provider = OllamaProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "Hello there!"},
            "prompt_eval_count": 10,
            "eval_count": 5,
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            messages = [ChatMessage(role="user", content="Hello")]
            response = await provider.chat("ollama:llama2", messages)

        assert response.content == "Hello there!"
        assert response.input_tokens == 10
        assert response.output_tokens == 5
        assert response.stop_reason == "stop"

    @pytest.mark.asyncio
    async def test_chat_with_options(self):
        """Test chat with custom options."""
        from src.providers.ollama import OllamaProvider
        from src.providers.base import ChatMessage

        provider = OllamaProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "Response"},
            "prompt_eval_count": 10,
            "eval_count": 5,
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            messages = [ChatMessage(role="user", content="Hello")]
            await provider.chat(
                "ollama:llama2",
                messages,
                temperature=0.5,
                top_p=0.8,
                max_tokens=2048,
            )

            # Check the payload
            call_args = mock_post.call_args
            payload = call_args[1]["json"]
            assert payload["options"]["temperature"] == 0.5
            assert payload["options"]["top_p"] == 0.8
            assert payload["options"]["num_predict"] == 2048

    @pytest.mark.asyncio
    async def test_completion_success(self):
        """Test completion with Ollama."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "response": "Completed text",
            "prompt_eval_count": 10,
            "eval_count": 5,
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            response = await provider.completion("ollama:llama2", "Complete this:")

        assert response.content == "Completed text"
        assert response.input_tokens == 10
        assert response.output_tokens == 5

    @pytest.mark.asyncio
    async def test_is_available_true(self):
        """Test is_available when Ollama is running."""
        from src.providers.ollama import OllamaProvider
        from http import HTTPStatus

        provider = OllamaProvider()

        mock_response = MagicMock()
        mock_response.status_code = HTTPStatus.OK

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            is_available = await provider.is_available()

        assert is_available is True

    @pytest.mark.asyncio
    async def test_is_available_false(self):
        """Test is_available when Ollama is not running."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection refused")
            is_available = await provider.is_available()

        assert is_available is False

    @pytest.mark.asyncio
    async def test_close(self):
        """Test closing the provider."""
        from src.providers.ollama import OllamaProvider

        provider = OllamaProvider()

        with patch.object(provider.client, "aclose", new_callable=AsyncMock) as mock_close:
            await provider.close()
            mock_close.assert_called_once()


class TestLMStudioProviderInit:
    """Test LMStudioProvider initialization."""

    def test_lmstudio_module_exists(self):
        """Test lmstudio module can be imported."""
        from src.providers import lmstudio
        assert lmstudio is not None

    def test_lmstudio_provider_class_exists(self):
        """Test LMStudioProvider class exists."""
        from src.providers.lmstudio import LMStudioProvider
        assert LMStudioProvider is not None

    def test_lmstudio_provider_initialization(self):
        """Test LMStudioProvider initialization."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()
        assert provider.base_url == "http://localhost:1234"

    def test_lmstudio_provider_custom_url(self):
        """Test LMStudioProvider with custom URL."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider(base_url="http://custom:5678/")
        assert provider.base_url == "http://custom:5678"


class TestLMStudioProviderMethods:
    """Test LMStudioProvider methods."""

    @pytest.mark.asyncio
    async def test_list_models_success(self):
        """Test listing models from LM Studio."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [
                {"id": "model1"},
                {"id": "model2-32k"},
                {"id": "model3-128k"},
                {"id": "model4-100k"},
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            models = await provider.list_models()

        assert len(models) == 4
        assert models[0].id == "lmstudio:model1"
        assert models[0].provider == "lmstudio"
        assert models[0].is_local is True
        assert models[1].context_window == 32768  # 32k model
        assert models[2].context_window == 131072  # 128k model
        assert models[3].context_window == 100000  # 100k model

    @pytest.mark.asyncio
    async def test_list_models_connection_error(self):
        """Test listing models with connection error."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection refused")

            with pytest.raises(ConnectionError, match="Failed to connect to LM Studio"):
                await provider.list_models()

    @pytest.mark.asyncio
    async def test_chat_success(self):
        """Test chat with LM Studio."""
        from src.providers.lmstudio import LMStudioProvider
        from src.providers.base import ChatMessage

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [
                {
                    "message": {"content": "Hello there!"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
            },
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            messages = [ChatMessage(role="user", content="Hello")]
            response = await provider.chat("lmstudio:model1", messages)

        assert response.content == "Hello there!"
        assert response.input_tokens == 10
        assert response.output_tokens == 5
        assert response.stop_reason == "stop"

    @pytest.mark.asyncio
    async def test_chat_with_options(self):
        """Test chat with custom options."""
        from src.providers.lmstudio import LMStudioProvider
        from src.providers.base import ChatMessage

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Response"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            messages = [ChatMessage(role="user", content="Hello")]
            await provider.chat(
                "lmstudio:model1",
                messages,
                temperature=0.5,
                top_p=0.8,
                max_tokens=2048,
            )

            # Check the payload
            call_args = mock_post.call_args
            payload = call_args[1]["json"]
            assert payload["temperature"] == 0.5
            assert payload["top_p"] == 0.8
            assert payload["max_tokens"] == 2048

    @pytest.mark.asyncio
    async def test_completion_uses_chat(self):
        """Test completion wraps chat API."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "Completed"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            response = await provider.completion("lmstudio:model1", "Complete this:")

        assert response.content == "Completed"
        # Verify it hit the chat completions endpoint
        call_args = mock_post.call_args
        assert "chat/completions" in call_args[1].get("json", {}).get("model", "")  or "chat/completions" in str(call_args)

    @pytest.mark.asyncio
    async def test_embeddings_success(self):
        """Test embeddings with LM Studio."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": [
                {"embedding": [0.1, 0.2, 0.3]},
                {"embedding": [0.4, 0.5, 0.6]},
            ]
        }
        mock_response.raise_for_status = MagicMock()

        with patch.object(provider.client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            embeddings = await provider.embeddings(
                "lmstudio:model1",
                ["text1", "text2"],
            )

        assert len(embeddings) == 2
        assert embeddings[0] == [0.1, 0.2, 0.3]
        assert embeddings[1] == [0.4, 0.5, 0.6]

    @pytest.mark.asyncio
    async def test_is_available_true(self):
        """Test is_available when LM Studio is running."""
        from src.providers.lmstudio import LMStudioProvider
        from http import HTTPStatus

        provider = LMStudioProvider()

        mock_response = MagicMock()
        mock_response.status_code = HTTPStatus.OK

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response
            is_available = await provider.is_available()

        assert is_available is True

    @pytest.mark.asyncio
    async def test_is_available_false(self):
        """Test is_available when LM Studio is not running."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        with patch.object(provider.client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Connection refused")
            is_available = await provider.is_available()

        assert is_available is False

    @pytest.mark.asyncio
    async def test_close(self):
        """Test closing the provider."""
        from src.providers.lmstudio import LMStudioProvider

        provider = LMStudioProvider()

        with patch.object(provider.client, "aclose", new_callable=AsyncMock) as mock_close:
            await provider.close()
            mock_close.assert_called_once()


class TestBaseProviderDataclasses:
    """Test base provider dataclasses."""

    def test_chat_message_dataclass(self):
        """Test ChatMessage dataclass."""
        from src.providers.base import ChatMessage

        msg = ChatMessage(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"

    def test_chat_response_dataclass(self):
        """Test ChatResponse dataclass."""
        from src.providers.base import ChatResponse

        response = ChatResponse(
            content="Hello",
            model="test-model",
            input_tokens=10,
            output_tokens=5,
            stop_reason="stop",
        )
        assert response.content == "Hello"
        assert response.model == "test-model"
        assert response.input_tokens == 10
        assert response.output_tokens == 5

    def test_model_info_dataclass(self):
        """Test ModelInfo dataclass."""
        from src.providers.base import ModelInfo

        info = ModelInfo(
            id="test:model",
            name="Test Model",
            provider="test",
            context_window=8192,
            max_output_tokens=4096,
            input_price_per_million=0.01,
            output_price_per_million=0.03,
            is_local=True,
        )
        assert info.id == "test:model"
        assert info.provider == "test"
        assert info.is_local is True

    def test_model_info_defaults(self):
        """Test ModelInfo default values."""
        from src.providers.base import ModelInfo

        info = ModelInfo(
            id="test:model",
            name="Test Model",
            provider="test",
            context_window=8192,
            max_output_tokens=4096,
            input_price_per_million=0.01,
            output_price_per_million=0.03,
        )
        assert info.is_local is False
        assert info.capabilities == []
