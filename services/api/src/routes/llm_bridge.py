"""
LLM Bridge API Routes

Manages connections from desktop Electron apps that expose local LLMs
(Ollama, LM Studio) to cloud agents via secure WebSocket tunnels.
"""

import asyncio
import hashlib
import json
import secrets
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select

from src.database.models.core import User
from src.routes.dependencies import DbSession, get_current_user_id
from src.services.redis_client import RedisClient, get_redis

log = structlog.get_logger()

router = APIRouter(prefix="/llm-bridge", tags=["LLM Bridge"])


# ============================================
# Models
# ============================================


class BridgeRegistration(BaseModel):
    """Registration request from desktop app"""

    provider: str  # "ollama" | "lmstudio"
    models: list[str]
    device_name: str
    device_id: str


class BridgeInfo(BaseModel):
    """Information about a registered bridge"""

    id: str
    provider: str
    models: list[str]
    device_name: str
    connected: bool
    last_seen: datetime
    requests_today: int
    tokens_today: int


class LLMRequest(BaseModel):
    """Request to send to local LLM"""

    model: str
    messages: list[dict[str, Any]]
    options: dict[str, Any] | None = None


class LLMResponse(BaseModel):
    """Response from local LLM"""

    response: str
    tokens: dict[str, Any]
    error: str | None = None


# ============================================
# In-Memory Bridge Registry
# ============================================

# Active WebSocket connections by user_id -> bridge_id
active_bridges: dict[str, dict[str, WebSocket]] = {}

# Pending requests waiting for responses
pending_requests: dict[str, asyncio.Future[dict[str, Any]]] = {}


# ============================================
# REST Endpoints
# ============================================


async def get_current_user_dependency(request: Request, db: DbSession) -> User:
    """Get current user as User model from database."""
    user_id = get_current_user_id(request)
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/register", response_model=dict)
async def register_bridge(
    registration: BridgeRegistration,
    user: User = Depends(get_current_user_dependency),
    redis_client: RedisClient = Depends(get_redis),
) -> dict[str, Any]:
    """
    Register a local LLM bridge from desktop app.
    Returns a bridge token for WebSocket connection.
    """
    # Generate unique bridge ID
    bridge_id = f"bridge_{secrets.token_urlsafe(16)}"

    # Generate connection token (short-lived)
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    # Store bridge info in Redis
    bridge_data: dict[str, str | int] = {
        "id": bridge_id,
        "user_id": str(user.id),
        "provider": registration.provider,
        "models": json.dumps(registration.models),
        "device_name": registration.device_name,
        "device_id": registration.device_id,
        "token_hash": token_hash,
        "created_at": datetime.now(UTC).isoformat(),
        "requests_today": 0,
        "tokens_today": 0,
    }

    # Store with 24h expiry (refreshed on connection)
    await redis_client.hset(f"llm_bridge:{bridge_id}", mapping=bridge_data)  # type: ignore[arg-type]
    await redis_client.expire(f"llm_bridge:{bridge_id}", 86400)

    # Store token mapping
    await redis_client.setex(f"llm_bridge_token:{token_hash}", 300, bridge_id)  # 5 min to connect

    log.info(
        "LLM bridge registered",
        bridge_id=bridge_id,
        user_id=str(user.id),
        provider=registration.provider,
        models=registration.models,
    )

    return {
        "bridge_id": bridge_id,
        "token": token,
        "expires_in": 300,
        "websocket_url": f"/ws/llm-bridge?token={token}",
    }


@router.get("/bridges", response_model=list[BridgeInfo])
async def list_bridges(
    user: User = Depends(get_current_user_dependency),
    redis_client: RedisClient = Depends(get_redis),
) -> list[BridgeInfo]:
    """List all registered bridges for the current user."""
    bridges = []

    # Scan for user's bridges
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor, match="llm_bridge:*", count=100)
        for key in keys:
            data = await redis_client.hgetall(key)
            if data and data.get("user_id") == str(user.id):
                bridge_id = data["id"]
                bridges.append(
                    BridgeInfo(
                        id=bridge_id,
                        provider=data["provider"],
                        models=json.loads(data.get("models", "[]")),
                        device_name=data["device_name"],
                        connected=bridge_id in active_bridges.get(str(user.id), {}),
                        last_seen=datetime.fromisoformat(data.get("last_seen", data["created_at"])),
                        requests_today=int(data.get("requests_today", 0)),
                        tokens_today=int(data.get("tokens_today", 0)),
                    )
                )
        if cursor == 0:
            break

    return bridges


@router.delete("/bridges/{bridge_id}")
async def delete_bridge(
    bridge_id: str,
    user: User = Depends(get_current_user_dependency),
    redis_client: RedisClient = Depends(get_redis),
) -> dict[str, str]:
    """Delete a registered bridge."""
    # Verify ownership
    data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
    if not data or data.get("user_id") != str(user.id):
        raise HTTPException(status_code=404, detail="Bridge not found")

    # Disconnect if active
    user_bridges = active_bridges.get(str(user.id), {})
    if bridge_id in user_bridges:
        ws = user_bridges[bridge_id]
        await ws.close()
        del user_bridges[bridge_id]

    # Delete from Redis
    await redis_client.delete(f"llm_bridge:{bridge_id}")

    log.info("LLM bridge deleted", bridge_id=bridge_id, user_id=str(user.id))

    return {"status": "deleted"}


@router.get("/available-models")
async def get_available_models(
    user: User = Depends(get_current_user_dependency),
    redis_client: RedisClient = Depends(get_redis),
) -> dict[str, list[dict[str, str]]]:
    """Get all available models from connected bridges."""
    models = []
    user_bridges = active_bridges.get(str(user.id), {})

    for bridge_id in user_bridges:
        data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
        if data:
            bridge_models = json.loads(data.get("models", "[]"))
            for model in bridge_models:
                models.append(
                    {
                        "model": model,
                        "provider": data["provider"],
                        "bridge_id": bridge_id,
                        "device_name": data["device_name"],
                    }
                )

    return {"models": models}


# ============================================
# WebSocket Endpoint
# ============================================


@router.websocket("/ws")
async def llm_bridge_websocket(
    websocket: WebSocket,
    token: str,
    redis_client: RedisClient = Depends(get_redis),
) -> None:
    """
    WebSocket connection for LLM bridge.

    The desktop app connects here and receives LLM requests,
    processes them locally, and sends back responses.
    """
    await websocket.accept()

    # Validate token
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    bridge_id_bytes = await redis_client.get(f"llm_bridge_token:{token_hash}")

    if not bridge_id_bytes:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    bridge_id = (
        bridge_id_bytes.decode() if isinstance(bridge_id_bytes, bytes) else str(bridge_id_bytes)
    )

    # Get bridge data
    data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
    if not data:
        await websocket.close(code=4002, reason="Bridge not found")
        return

    user_id = data["user_id"]

    # Delete one-time token
    await redis_client.delete(f"llm_bridge_token:{token_hash}")

    # Register active connection
    if user_id not in active_bridges:
        active_bridges[user_id] = {}
    active_bridges[user_id][bridge_id] = websocket

    log.info(
        "LLM bridge connected",
        bridge_id=bridge_id,
        user_id=user_id,
        provider=data["provider"],
    )

    try:
        # Send connection confirmation
        await websocket.send_json(
            {
                "type": "connected",
                "bridge_id": bridge_id,
            }
        )

        # Update last_seen
        await redis_client.hset(
            f"llm_bridge:{bridge_id}", "last_seen", datetime.now(UTC).isoformat()
        )

        # Keep connection alive and handle messages
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=30)

                if message["type"] == "llm_response":
                    # Handle response from local LLM
                    request_id = message.get("request_id")
                    if request_id and request_id in pending_requests:
                        future = pending_requests[request_id]
                        if not future.done():
                            future.set_result(message)

                        # Update stats
                        tokens = message.get("tokens", {})
                        total_tokens = tokens.get("prompt", 0) + tokens.get("completion", 0)
                        await redis_client.hincrby(f"llm_bridge:{bridge_id}", "requests_today", 1)
                        await redis_client.hincrby(
                            f"llm_bridge:{bridge_id}", "tokens_today", total_tokens
                        )

                elif message["type"] == "ping":
                    await websocket.send_json({"type": "pong"})
                    await redis_client.hset(
                        f"llm_bridge:{bridge_id}",
                        "last_seen",
                        datetime.now(UTC).isoformat(),
                    )

                elif message["type"] == "update_models":
                    # Update available models
                    models = message.get("models", [])
                    await redis_client.hset(f"llm_bridge:{bridge_id}", "models", json.dumps(models))
                    log.info("Bridge models updated", bridge_id=bridge_id, models=models)

            except TimeoutError:
                # Send heartbeat
                try:
                    await websocket.send_json({"type": "heartbeat"})
                except Exception:
                    break

    except WebSocketDisconnect:
        log.info("LLM bridge disconnected", bridge_id=bridge_id, user_id=user_id)
    except Exception:
        log.exception("LLM bridge error", bridge_id=bridge_id)
    finally:
        # Cleanup
        if user_id in active_bridges and bridge_id in active_bridges[user_id]:
            del active_bridges[user_id][bridge_id]
            if not active_bridges[user_id]:
                del active_bridges[user_id]


# ============================================
# Internal Functions (for Agent Service)
# ============================================


async def send_llm_request(
    user_id: str,
    model: str,
    messages: list[dict[str, Any]],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Send an LLM request through a user's bridge.

    Called by the agent service when routing to local LLM.
    """
    user_bridges = active_bridges.get(user_id, {})

    if not user_bridges:
        raise HTTPException(status_code=503, detail="No active LLM bridge for this user")

    # Find a bridge with the requested model
    redis_client = await get_redis()
    target_bridge = None
    target_ws = None

    for bridge_id, ws in user_bridges.items():
        data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
        if data:
            models = json.loads(data.get("models", "[]"))
            if model in models:
                target_bridge = bridge_id
                target_ws = ws
                break

    if not target_bridge or not target_ws:
        available_models = []
        for bridge_id in user_bridges:
            data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
            if data:
                available_models.extend(json.loads(data.get("models", "[]")))
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model}' not available on any bridge. Available: {available_models}",
        )

    # Create request
    request_id = str(uuid4())
    request_message = {
        "type": "llm_request",
        "request_id": request_id,
        "model": model,
        "messages": messages,
        "options": options or {},
    }

    # Create future for response
    future: asyncio.Future[dict[str, Any]] = asyncio.get_event_loop().create_future()
    pending_requests[request_id] = future

    try:
        # Send request
        await target_ws.send_json(request_message)

        # Wait for response with timeout
        async with asyncio.timeout(300.0):
            response = await future

        if response.get("error"):
            raise HTTPException(status_code=500, detail=response["error"])

        return {
            "response": response.get("response", ""),
            "tokens": response.get("tokens", {}),
            "bridge_id": target_bridge,
        }

    except TimeoutError:
        raise HTTPException(status_code=504, detail="LLM bridge request timed out")
    finally:
        pending_requests.pop(request_id, None)


def is_bridge_available(user_id: str) -> bool:
    """Check if user has an active bridge connection."""
    return user_id in active_bridges and len(active_bridges[user_id]) > 0


async def get_bridge_models(user_id: str) -> list[dict[str, str]]:
    """Get all available models from user's bridges."""
    models = []
    user_bridges = active_bridges.get(user_id, {})
    redis_client = await get_redis()

    for bridge_id in user_bridges:
        data = await redis_client.hgetall(f"llm_bridge:{bridge_id}")
        if data:
            bridge_models = json.loads(data.get("models", "[]"))
            for model in bridge_models:
                models.append(
                    {
                        "model": model,
                        "provider": data["provider"],
                        "bridge_id": bridge_id,
                    }
                )

    return models
