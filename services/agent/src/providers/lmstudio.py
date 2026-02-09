"""LM Studio provider for local LLM inference (OpenAI-compatible API)."""

import json
from collections.abc import AsyncGenerator
from http import HTTPStatus
from typing import Any

import httpx

from .base import BaseProvider, ChatMessage, ChatResponse, ModelInfo


class LMStudioProvider(BaseProvider):
    """Provider for LM Studio local LLM server (OpenAI-compatible API)."""

    def __init__(self, base_url: str = "http://localhost:1234"):
        self.base_url = base_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=300.0)  # Long timeout for local inference

    async def list_models(self) -> list[ModelInfo]:
        """List available models from LM Studio."""
        try:
            response = await self.client.get(f"{self.base_url}/v1/models")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("data", []):
                model_id = model.get("id", "")

                # LM Studio doesn't provide context window info, estimate based on model
                context_window = 8192
                if "32k" in model_id.lower():
                    context_window = 32768
                elif "128k" in model_id.lower():
                    context_window = 131072
                elif "100k" in model_id.lower():
                    context_window = 100000

                models.append(
                    ModelInfo(
                        id=f"lmstudio:{model_id}",
                        name=model_id,
                        provider="lmstudio",
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
            raise ConnectionError(f"Failed to connect to LM Studio: {e}") from e

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> ChatResponse:
        """Send chat request to LM Studio using OpenAI-compatible API."""
        # Convert messages to OpenAI format
        openai_messages = []
        for msg in messages:
            openai_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": model.replace("lmstudio:", ""),
            "messages": openai_messages,
            "temperature": kwargs.get("temperature", 0.7),
            "top_p": kwargs.get("top_p", 0.9),
            "max_tokens": kwargs.get("max_tokens", 4096),
            "stream": False,
        }

        response = await self.client.post(
            f"{self.base_url}/v1/chat/completions",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        choice = data.get("choices", [{}])[0]
        usage = data.get("usage", {})

        return ChatResponse(
            content=choice.get("message", {}).get("content", ""),
            model=model,
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            stop_reason=choice.get("finish_reason", "stop"),
        )

    async def chat_stream(
        self,
        model: str,
        messages: list[ChatMessage],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream chat response from LM Studio."""
        # Convert messages to OpenAI format
        openai_messages = []
        for msg in messages:
            openai_messages.append({"role": msg.role, "content": msg.content})

        payload = {
            "model": model.replace("lmstudio:", ""),
            "messages": openai_messages,
            "temperature": kwargs.get("temperature", 0.7),
            "top_p": kwargs.get("top_p", 0.9),
            "max_tokens": kwargs.get("max_tokens", 4096),
            "stream": True,
        }

        async with self.client.stream(
            "POST",
            f"{self.base_url}/v1/chat/completions",
            json=payload,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        choice = data.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    async def completion(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> ChatResponse:
        """Send completion request to LM Studio."""
        # LM Studio uses chat completions API, so we wrap the prompt
        messages = [ChatMessage(role="user", content=prompt)]
        return await self.chat(model, messages, **kwargs)

    async def completion_stream(
        self,
        model: str,
        prompt: str,
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Stream completion from LM Studio."""
        messages = [ChatMessage(role="user", content=prompt)]
        async for chunk in self.chat_stream(model, messages, **kwargs):
            yield chunk

    async def embeddings(
        self,
        model: str,
        texts: list[str],
        **_kwargs: Any,
    ) -> list[list[float]]:
        """Generate embeddings (if LM Studio supports it)."""
        payload = {
            "model": model.replace("lmstudio:", ""),
            "input": texts,
        }

        response = await self.client.post(
            f"{self.base_url}/v1/embeddings",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        embeddings = []
        for item in data.get("data", []):
            embeddings.append(item.get("embedding", []))

        return embeddings

    async def is_available(self) -> bool:
        """Check if LM Studio server is running."""
        try:
            response = await self.client.get(f"{self.base_url}/v1/models")
            return response.status_code == HTTPStatus.OK
        except Exception:
            return False

    async def close(self) -> None:
        """Close HTTP client."""
        await self.client.aclose()
