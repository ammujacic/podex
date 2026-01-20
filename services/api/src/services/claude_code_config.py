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
    mcp_payload: list[dict[str, Any]] = []
    for server in effective_mcp.servers:
        args = list(server.args or [])
        if getattr(server, "source_slug", None) == "filesystem":
            args = ["/home/dev" if arg == "/workspace" else arg for arg in args]
        translated = translator.translate_mcp(
            {
                "id": server.id,
                "name": server.name,
                "description": server.description,
                "transport": server.transport,
                "command": server.command,
                "args": args,
                "url": server.url,
                "env_vars": server.env_vars,
            }
        )
        if not translated:
            continue
        mcp_payload.append(
            {
                "name": translated.name,
                "transport": server.transport,
                "command": server.command,
                "args": args,
                "url": server.url,
                "env_vars": server.env_vars or {},
            }
        )

    if not mcp_payload:
        return

    payload = base64.b64encode(json.dumps(mcp_payload).encode("utf-8")).decode("ascii")
    command = """if command -v python3 >/dev/null 2>&1; then
python3 - <<'PY'
import base64
import json
import os
import shutil
import subprocess
import sys

payload = json.loads(base64.b64decode('__PAYLOAD__').decode('utf-8'))
os.environ["PATH"] = "/home/dev/.npm-global/bin:" + os.environ.get("PATH", "")
os.environ["HOME"] = "/home/dev"

if shutil.which("claude") is None:
    sys.exit(0)

if not (
    os.path.exists("/home/dev/.claude/.credentials.json")
    or os.path.exists("/home/dev/.claude/credentials.json")
):
    sys.exit(0)

errors = []
for server in payload:
    name = server.get("name") or ""
    transport = (server.get("transport") or "stdio").lower()
    env_vars = server.get("env_vars") or dict()

    if name:
        subprocess.run(
            ["claude", "mcp", "remove", name],
            text=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
        )

    if transport == "stdio":
        command = server.get("command") or ""
        if not command:
            errors.append(name + ": missing command")
            continue
        args = ["claude", "mcp", "add", "--transport", "stdio", name, "--", command]
        args.extend(server.get("args") or [])
        for key, value in env_vars.items():
            args.extend(["--env", str(key) + "=" + str(value)])
    elif transport in ("http", "sse"):
        url = server.get("url") or ""
        if not url:
            errors.append(name + ": missing url")
            continue
        args = ["claude", "mcp", "add", "--transport", transport, name, url]
        for key, value in env_vars.items():
            args.extend(["--header", str(key) + ": " + str(value)])
    else:
        errors.append(name + ": unsupported transport " + transport)
        continue

    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip().replace("\\n", " ")
        stdout = (result.stdout or "").strip().replace("\\n", " ")
        detail = stderr or stdout or "no output"
        errors.append(
            "%s: claude mcp add failed (exit %s): %s"
            % (name, result.returncode, detail[:200])
        )

if errors:
    sys.stderr.write("\\n".join(errors) + "\\n")
    sys.exit(1)
PY
elif command -v python >/dev/null 2>&1; then
python - <<'PY'
import base64
import json
import os
import shutil
import subprocess
import sys

payload = json.loads(base64.b64decode('__PAYLOAD__').decode('utf-8'))
os.environ["PATH"] = "/home/dev/.npm-global/bin:" + os.environ.get("PATH", "")
os.environ["HOME"] = "/home/dev"

if shutil.which("claude") is None:
    sys.exit(0)

if not (
    os.path.exists("/home/dev/.claude/.credentials.json")
    or os.path.exists("/home/dev/.claude/credentials.json")
):
    sys.exit(0)

errors = []
for server in payload:
    name = server.get("name") or ""
    transport = (server.get("transport") or "stdio").lower()
    env_vars = server.get("env_vars") or dict()

    if name:
        subprocess.run(
            ["claude", "mcp", "remove", name],
            text=True,
            capture_output=True,
            stdin=subprocess.DEVNULL,
        )

    if transport == "stdio":
        command = server.get("command") or ""
        if not command:
            errors.append(name + ": missing command")
            continue
        args = ["claude", "mcp", "add", "--transport", "stdio", name, "--", command]
        args.extend(server.get("args") or [])
        for key, value in env_vars.items():
            args.extend(["--env", str(key) + "=" + str(value)])
    elif transport in ("http", "sse"):
        url = server.get("url") or ""
        if not url:
            errors.append(name + ": missing url")
            continue
        args = ["claude", "mcp", "add", "--transport", transport, name, url]
        for key, value in env_vars.items():
            args.extend(["--header", str(key) + ": " + str(value)])
    else:
        errors.append(name + ": unsupported transport " + transport)
        continue

    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip().replace("\\n", " ")
        stdout = (result.stdout or "").strip().replace("\\n", " ")
        detail = stderr or stdout or "no output"
        errors.append(
            "%s: claude mcp add failed (exit %s): %s"
            % (name, result.returncode, detail[:200])
        )

if errors:
    sys.stderr.write("\\n".join(errors) + "\\n")
    sys.exit(1)
PY
elif command -v node >/dev/null 2>&1; then
node - <<'JS'
const payload = JSON.parse(Buffer.from("__PAYLOAD__", "base64").toString("utf8"));
process.env.PATH = `/home/dev/.npm-global/bin:${process.env.PATH || ""}`;
process.env.HOME = "/home/dev";

const { spawnSync } = require("child_process");
const check = spawnSync("claude", ["--version"], { stdio: "ignore" });
if (check.error && check.error.code === "ENOENT") {
  process.exit(0);
}

const fs = require("fs");
if (
  !fs.existsSync("/home/dev/.claude/.credentials.json") &&
  !fs.existsSync("/home/dev/.claude/credentials.json")
) {
  process.exit(0);
}

const errors = [];
for (const server of payload) {
  const name = server.name || "";
  const transport = (server.transport || "stdio").toLowerCase();
  const envVars = server.env_vars || {};

  if (name) {
    spawnSync("claude", ["mcp", "remove", name], { stdio: "ignore" });
  }
  let args = ["mcp", "add", "--transport", transport, name];

  if (transport === "stdio") {
    const command = server.command || "";
    if (!command) {
      errors.push(name + ": missing command");
      continue;
    }
    args.push("--", command, ...(server.args || []));
    for (const [key, value] of Object.entries(envVars)) {
      args.push("--env", String(key) + "=" + String(value));
    }
  } else if (transport === "http" || transport === "sse") {
    const url = server.url || "";
    if (!url) {
      errors.push(name + ": missing url");
      continue;
    }
    args.push(url);
    for (const [key, value] of Object.entries(envVars)) {
      args.push("--header", String(key) + ": " + String(value));
    }
  } else {
    errors.push(name + ": unsupported transport " + transport);
    continue;
  }

  const result = spawnSync("claude", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim().replace(/\n/g, " ");
    const stdout = (result.stdout || "").trim().replace(/\n/g, " ");
    const detail = stderr || stdout || "no output";
    errors.push(
      name + ": claude mcp add failed (exit " + result.status + "): " + detail.slice(0, 200)
    );
  }
}

if (errors.length) {
  process.stderr.write(errors.join("\\n") + "\\n");
  process.exit(1);
}
JS
else
echo "claude mcp add requires python or node" >&2
exit 1
fi"""
    command = command.replace("__PAYLOAD__", payload)

    logger.info(
        "Syncing Claude Code MCP config",
        session_id=session.id,
        user_id=user_id,
        workspace_id=session.workspace_id,
        server_count=len(mcp_payload),
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
