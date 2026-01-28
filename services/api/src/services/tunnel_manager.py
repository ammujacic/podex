"""Tunnel manager: Cloudflare tunnel + DNS + daemon lifecycle."""

# ruff: noqa: I001

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database.connection import get_db_context
from src.database.models import Workspace, WorkspaceTunnel
from src.services.cloudflare_client import (
    create_dns_cname,
    create_tunnel,
    delete_dns_record_by_name,
    delete_tunnel as cf_delete_tunnel,
    update_tunnel_config,
)
from src.websocket.local_pod_hub import (
    PodNotConnectedError,
    RPCMethods,
    call_pod,
    is_pod_online,
)

logger = structlog.get_logger()

TUNNEL_DOMAIN = settings.TUNNEL_DOMAIN
RPC_TIMEOUT = 30.0


def _hostname(workspace_id: str, port: int) -> str:
    return f"{workspace_id}-p{port}.{TUNNEL_DOMAIN}"


def _public_url(workspace_id: str, port: int) -> str:
    return f"https://{_hostname(workspace_id, port)}"


async def _get_local_pod_id(db: AsyncSession, workspace_id: str) -> str | None:
    r = await db.execute(select(Workspace.local_pod_id).where(Workspace.id == workspace_id))
    return r.scalar_one_or_none()


async def create_tunnel_for_workspace(
    db: AsyncSession,
    workspace_id: str,
    port: int,
) -> WorkspaceTunnel:
    """Create Cloudflare tunnel, DNS, DB record, and start daemon on workspace's pod.

    Supports local-pod workspaces only. Compute support TBD.
    """
    pod_id = await _get_local_pod_id(db, workspace_id)
    if not pod_id:
        msg = "Tunnels only supported for workspaces on a local pod"
        raise RuntimeError(msg)
    if not is_pod_online(str(pod_id)):
        raise PodNotConnectedError(str(pod_id))

    name = f"podex-{workspace_id}-{port}"
    hostname = _hostname(workspace_id, port)
    service_url = f"http://localhost:{port}"

    tunnel_id, token = await create_tunnel(name, config_src="cloudflare")
    try:
        await update_tunnel_config(tunnel_id, hostname, service_url)
    except Exception as e:
        await cf_delete_tunnel(tunnel_id)
        msg = f"Failed to set tunnel config: {e}"
        raise RuntimeError(msg) from e

    target = f"{tunnel_id}.cfargotunnel.com"
    try:
        await create_dns_cname(hostname, target)
    except Exception as e:
        await cf_delete_tunnel(tunnel_id)
        msg = f"Failed to create DNS CNAME: {e}"
        raise RuntimeError(msg) from e

    public_url = _public_url(workspace_id, port)
    rec = WorkspaceTunnel(
        workspace_id=workspace_id,
        port=port,
        tunnel_id=tunnel_id,
        tunnel_token=token,
        public_url=public_url,
        status="starting",
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)

    try:
        await call_pod(
            str(pod_id),
            RPCMethods.TUNNEL_START,
            {
                "workspace_id": workspace_id,
                "config": {
                    "token": token,
                    "port": port,
                    "hostname": hostname,
                },
            },
            rpc_timeout=RPC_TIMEOUT,
        )
    except Exception as e:
        logger.warning(
            "tunnel.start RPC failed, cleaning up", workspace_id=workspace_id, error=str(e)
        )
        await delete_tunnel_for_workspace(db, workspace_id, port)
        msg = f"Failed to start tunnel daemon: {e}"
        raise RuntimeError(msg) from e

    rec.status = "running"
    await db.commit()
    await db.refresh(rec)
    return rec


async def delete_tunnel_for_workspace(
    db: AsyncSession,
    workspace_id: str,
    port: int,
) -> None:
    """Stop daemon, delete DNS, delete Cloudflare tunnel, remove DB record."""
    r = await db.execute(
        select(WorkspaceTunnel).where(
            WorkspaceTunnel.workspace_id == workspace_id,
            WorkspaceTunnel.port == port,
        )
    )
    rec = r.scalar_one_or_none()
    if not rec:
        return

    pod_id = await _get_local_pod_id(db, workspace_id)
    if pod_id and is_pod_online(str(pod_id)):
        try:
            await call_pod(
                str(pod_id),
                RPCMethods.TUNNEL_STOP,
                {"workspace_id": workspace_id, "port": port},
                rpc_timeout=RPC_TIMEOUT,
            )
        except Exception as e:
            logger.warning("tunnel.stop RPC failed", workspace_id=workspace_id, error=str(e))

    hostname = _hostname(workspace_id, port)
    try:
        await delete_dns_record_by_name(hostname)
    except Exception as e:
        logger.warning("delete DNS failed", hostname=hostname, error=str(e))

    try:
        await cf_delete_tunnel(rec.tunnel_id)
    except Exception as e:
        logger.warning("delete CF tunnel failed", tunnel_id=rec.tunnel_id, error=str(e))

    await db.delete(rec)
    await db.commit()


async def list_tunnels(db: AsyncSession, workspace_id: str) -> list[WorkspaceTunnel]:
    r = await db.execute(
        select(WorkspaceTunnel).where(WorkspaceTunnel.workspace_id == workspace_id)
    )
    return list(r.scalars().all())


async def get_tunnel_status(workspace_id: str) -> dict[str, Any]:
    """Query daemon health via RPC. Requires workspace on local pod."""
    async with get_db_context() as db:
        pod_id = await _get_local_pod_id(db, workspace_id)
    if not pod_id or not is_pod_online(str(pod_id)):
        return {"status": "offline", "connected": False}

    try:
        out = await call_pod(
            str(pod_id),
            RPCMethods.TUNNEL_STATUS,
            {"workspace_id": workspace_id},
            rpc_timeout=10.0,
        )
        return out if isinstance(out, dict) else {"status": "unknown", "connected": False}
    except Exception as e:
        logger.warning("tunnel.status RPC failed", workspace_id=workspace_id, error=str(e))
        return {"status": "error", "connected": False, "error": str(e)}
