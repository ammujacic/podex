"""MCP server endpoints for Podex skills."""

from __future__ import annotations

import json
from typing import Any

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ValidationError

from src.deps import require_internal_service_token
from src.tools.skill_tools import SkillRegistryHolder

logger = structlog.get_logger()

router = APIRouter(
    prefix="/mcp/skills",
    tags=["mcp-skills"],
    dependencies=[Depends(require_internal_service_token)],
)


class MCPToolsListRequest(BaseModel):
    """Optional request body for listing tools."""

    user_id: str | None = None


class MCPToolCallRequest(BaseModel):
    """MCP tool call request."""

    name: str
    arguments: dict[str, Any] | None = None


class JSONRPCRequest(BaseModel):
    """Minimal JSON-RPC request payload."""

    jsonrpc: str | None = None
    id: str | int | None = None
    method: str
    params: dict[str, Any] | None = None


def _extract_auth_context(
    request: Request,
    body: MCPToolsListRequest | None = None,
) -> tuple[str | None, str | None, str | None, str | None]:
    user_id = body.user_id if body else None
    header_user_id = request.headers.get("x-user-id")
    if header_user_id:
        user_id = header_user_id

    auth_header = request.headers.get("authorization", "")
    auth_token = auth_header.removeprefix("Bearer ").strip() if auth_header else None

    session_id = request.headers.get("x-session-id")
    agent_id = request.headers.get("x-agent-id")

    return user_id, auth_token, session_id, agent_id


@router.post("/tools/list")
async def list_tools(
    request: Request,
    body: MCPToolsListRequest | None = None,
) -> dict[str, Any]:
    """MCP: List available skills as tools."""
    registry = SkillRegistryHolder.get()
    user_id, auth_token, session_id, agent_id = _extract_auth_context(request, body)

    if not registry.is_loaded or user_id:
        try:
            registry.set_auth_context(
                auth_token=auth_token,
                session_id=session_id,
                agent_id=agent_id,
            )
            await registry.load_skills(user_id=user_id, auth_token=auth_token)
        except Exception as e:
            logger.warning("Failed to load skills for MCP tools list", error=str(e))

    tools = []
    for skill in registry.list_skills():
        tools.append(
            {
                "name": f"skill_{skill.slug}",
                "description": skill.description or f"Execute skill {skill.name}",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "context": {
                            "type": "object",
                            "description": "Execution context for skill steps",
                        },
                        "stop_on_failure": {
                            "type": "boolean",
                            "description": "Stop on first failed step",
                            "default": True,
                        },
                    },
                },
            }
        )

    return {"tools": tools}


@router.post("/tools/call")
async def call_tool(
    request: Request,
    payload: MCPToolCallRequest,
) -> dict[str, Any]:
    """MCP: Execute a skill tool."""
    registry = SkillRegistryHolder.get()
    user_id, auth_token, session_id, agent_id = _extract_auth_context(request)

    if not registry.is_loaded or user_id:
        try:
            registry.set_auth_context(
                auth_token=auth_token,
                session_id=session_id,
                agent_id=agent_id,
            )
            await registry.load_skills(user_id=user_id, auth_token=auth_token)
        except Exception as e:
            logger.warning("Failed to load skills for MCP tool call", error=str(e))

    tool_name = payload.name
    if not tool_name.startswith("skill_"):
        return {
            "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
            "isError": True,
        }

    skill_slug = tool_name.replace("skill_", "", 1)
    arguments = payload.arguments or {}
    context = arguments.get("context", {})
    stop_on_failure = bool(arguments.get("stop_on_failure", True))

    result = await registry.execute_skill(
        skill_name=skill_slug,
        context=context,
        stop_on_failure=stop_on_failure,
    )

    if result.error == "Tool executor not configured":
        return {
            "content": [
                {
                    "type": "text",
                    "text": "Skill execution is not available in this MCP context.",
                }
            ],
            "isError": True,
        }

    result_payload = json.dumps(result.to_dict(), indent=2)
    return {
        "content": [{"type": "text", "text": result_payload}],
        "isError": not result.success,
    }


@router.post("")
async def jsonrpc_entrypoint(request: Request, body: JSONRPCRequest) -> dict[str, Any]:
    """JSON-RPC entrypoint for MCP HTTP clients."""
    params = body.params or {}

    try:
        if body.method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": body.id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}, "resources": {}},
                    "serverInfo": {"name": "podex-skills", "version": "1.0.0"},
                },
            }
        if body.method == "tools/list":
            tools_result = await list_tools(
                request, MCPToolsListRequest(**params) if params else None
            )
            return {"jsonrpc": "2.0", "id": body.id, "result": tools_result}
        if body.method == "tools/call":
            tool_result = await call_tool(request, MCPToolCallRequest(**params))
            return {"jsonrpc": "2.0", "id": body.id, "result": tool_result}
        if body.method == "resources/list":
            return {
                "jsonrpc": "2.0",
                "id": body.id,
                "result": {"resources": []},
            }
    except ValidationError as exc:
        return {
            "jsonrpc": "2.0",
            "id": body.id,
            "error": {"code": -32602, "message": str(exc)},
        }

    return {
        "jsonrpc": "2.0",
        "id": body.id,
        "error": {"code": -32601, "message": f"Method not found: {body.method}"},
    }
