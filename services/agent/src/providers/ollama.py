"""Ollama provider for local LLM inference."""

import json
from collections.abc import AsyncGenerator
from http import HTTPStatus
from typing import Any

import httpx

from .base import BaseProvider, ChatMessage, ChatResponse, ModelInfo


class OllamaProvider(BaseProvider):
    """Provider for Ollama local LLM server."""

    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=300.0)  # Long timeout for local inference

    async def list_models(self) -> list[ModelInfo]:
        """List available models from Ollama."""
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("models", []):
                # Parse model details
                name = model.get("name", "")
                model.get("size", 0)
                model.get("modified_at", "")

                # Estimate context window based on model name
                context_window = 8192
                if "32k" in name.lower():
                    context_window = 32768
                elif "128k" in name.lower():
                    context_window = 131072

                models.append(
                    ModelInfo(
                        id=f"ollama:{name}",
                        name=name,
                        provider="ollama",
                        context_window=context_window,
                        max_output_tokens=4096,
                        input_price_per_million=0.0,
                        output_price_per_million=0.0,
                        is_local=True,
                        capabilities=["chat", "completion", "code", "streaming"],
                    ),
                )

            return models
        except Exception as e:
            raise ConnectionError(f"Failed to connect to Ollama: {e}") from e

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> ChatResponse:
        """Send chat request to Ollama."""
        # Convert messages to Ollama format
        ollama_messages = []
        for msg in messages:
            ollama_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": model.replace("ollama:", ""),
            "messages": ollama_messages,
            "stream": False,
            "options": {
                "temperature": kwargs.get("temperature", 0.7),
                "top_p": kwargs.get("top_p", 0.9),
                "num_predict": kwargs.get("max_tokens", 4096),
            },
        }

        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        return ChatResponse(
            content=data.get("message", {}).get("content", ""),
            model=model,
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            stop_reason="stop",
        )

    async def chat_stream(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream chat response from Ollama."""
        # Convert messages to Ollama format
        ollama_messages = []
        for msg in messages:
            ollama_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": model.replace("ollama:", ""),
            "messages": ollama_messages,
            "stream": True,
            "options": {
                "temperature": kwargs.get("temperature", 0.7),
                "top_p": kwargs.get("top_p", 0.9),
                "num_predict": kwargs.get("max_tokens", 4096),
            },
        }

        async with self.client.stream(
            "POST",
            f"{self.base_url}/api/chat",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                        if data.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue

    async def completion(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> ChatResponse:
        """Send completion request to Ollama."""
        payload = {
            "model": model.replace("ollama:", ""),
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": kwargs.get("temperature", 0.7),
                "top_p": kwargs.get("top_p", 0.9),
                "num_predict": kwargs.get("max_tokens", 4096),
            },
        }

        response = await self.client.post(
            f"{self.base_url}/api/generate",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        return ChatResponse(
            content=data.get("response", ""),
            model=model,
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            stop_reason="stop",
        )

    async def completion_stream(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream completion from Ollama."""
        payload = {
            "model": model.replace("ollama:", ""),
            "prompt": prompt,
            "stream": True,
            "options": {
                "temperature": kwargs.get("temperature", 0.7),
                "top_p": kwargs.get("top_p", 0.9),
                "num_predict": kwargs.get("max_tokens", 4096),
            },
        }

        async with self.client.stream(
            "POST",
            f"{self.base_url}/api/generate",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        content = data.get("response", "")
                        if content:
                            yield content
                        if data.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue

    async def is_available(self) -> bool:
        """Check if Ollama server is running."""
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            return response.status_code == HTTPStatus.OK
        except Exception:
            return False

    async def close(self) -> None:
        """Close HTTP client."""
        await self.client.aclose()
