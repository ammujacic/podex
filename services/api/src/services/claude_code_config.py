"""Helpers for managing Claude Code CLI configuration."""

from __future__ import annotations

import base64
import json
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from src.compute_client import compute_client
from src.mcp_config import get_effective_mcp_config
from src.services.cli_translators.claude_code import ClaudeCodeTranslator

if TYPE_CHECKING:
    from src.database import Session as SessionModel

logger = structlog.get_logger()


async def sync_claude_code_mcp_config(
    db: AsyncSession,
    session: SessionModel,
    user_id: str,
) -> None:
    """Ensure Claude Code's config.json includes current MCP servers."""
    if not session.workspace_id:
        logger.debug(
            "Skipping Claude Code MCP sync: session has no workspace",
            session_id=session.id,
            user_id=user_id,
        )
        return

    effective_mcp = await get_effective_mcp_config(db, user_id)
    if not effective_mcp or not effective_mcp.servers:
        logger.debug(
            "Skipping Claude Code MCP sync: no MCP servers",
            session_id=session.id,
            user_id=user_id,
        )
        return

    translator = ClaudeCodeTranslator()
    mcp_configs: dict[str, Any] = {}
    for server in effective_mcp.servers:
        translated = translator.translate_mcp(
            {
                "id": server.id,
                "name": server.name,
                "description": server.description,
                "transport": server.transport,
                "command": server.command,
                "args": server.args,
                "url": server.url,
                "env_vars": server.env_vars,
            }
        )
        mcp_configs[translated.name] = translated.cli_format

    if not mcp_configs:
        return

    payload = base64.b64encode(json.dumps(mcp_configs).encode("utf-8")).decode("ascii")
    config_json = json.dumps({"mcpServers": mcp_configs}, indent=2)
    command = f"""if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import base64
import json
import os

payload = json.loads(base64.b64decode('{payload}').decode('utf-8'))
config_path = "/home/dev/.claude/config.json"
try:
    with open(config_path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
except Exception:
    config = {{}}

config.setdefault("mcpServers", {{}})
config["mcpServers"].update(payload)
os.makedirs(os.path.dirname(config_path), exist_ok=True)
with open(config_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
PY
elif command -v python >/dev/null 2>&1; then
python - <<'PY'
import base64
import json
import os

payload = json.loads(base64.b64decode('{payload}').decode('utf-8'))
config_path = "/home/dev/.claude/config.json"
try:
    with open(config_path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
except Exception:
    config = {{}}

config.setdefault("mcpServers", {{}})
config["mcpServers"].update(payload)
os.makedirs(os.path.dirname(config_path), exist_ok=True)
with open(config_path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2)
PY
elif command -v node >/dev/null 2>&1; then
node - <<'JS'
const fs = require("fs");
const path = require("path");
const payload = JSON.parse(Buffer.from("{payload}", "base64").toString("utf8"));
const configPath = "/home/dev/.claude/config.json";
let config = {{}};
try {{
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
}} catch (_) {{}}
config.mcpServers = config.mcpServers || {{}};
Object.assign(config.mcpServers, payload);
fs.mkdirSync(path.dirname(configPath), {{ recursive: true }});
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
JS
else
mkdir -p /home/dev/.claude
cat <<'JSON' > /home/dev/.claude/config.json
{config_json}
JSON
fi"""

    logger.info(
        "Syncing Claude Code MCP config",
        session_id=session.id,
        user_id=user_id,
        workspace_id=session.workspace_id,
        server_count=len(mcp_configs),
    )

    result = await compute_client.exec_command(
        workspace_id=session.workspace_id,
        user_id=user_id,
        command=command,
        exec_timeout=30,
    )
    if result.get("exit_code", 0) != 0:
        logger.warning(
            "Claude Code MCP sync failed",
            session_id=session.id,
            user_id=user_id,
            workspace_id=session.workspace_id,
            stderr=result.get("stderr", "")[:500],
        )
