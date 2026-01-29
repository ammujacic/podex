"""Cloudflare API client for tunnel and DNS operations."""

from __future__ import annotations

from typing import Any, Mapping, Sequence, cast  # noqa: UP035

import structlog
from httpx import AsyncClient

from src.config import settings

logger = structlog.get_logger()

CF_API_BASE = "https://api.cloudflare.com/client/v4"


def _http_client() -> AsyncClient:
    token = settings.CLOUDFLARE_API_TOKEN or ""
    return AsyncClient(
        base_url=CF_API_BASE,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    )


def _check(res: dict[str, object]) -> None:
    if not res.get("success"):
        raw_errors = res.get("errors") or []
        errs = cast("Sequence[Mapping[str, Any]]", raw_errors)
        if errs:
            msg_obj = errs[0].get("message", "Unknown Cloudflare API error")
            msg = str(msg_obj)
        else:
            msg = "Unknown error"
        error_msg = f"Cloudflare API error: {msg}"
        raise RuntimeError(error_msg)


async def create_tunnel(name: str, config_src: str = "cloudflare") -> tuple[str, str]:
    """Create a Cloudflare Tunnel.

    Args:
        name: Tunnel name (e.g. workspace-port identifier).
        config_src: "cloudflare" (config via API) or "local".

    Returns:
        (tunnel_id, connector_token) for cloudflared.

    Raises:
        RuntimeError: If API token/account not configured or create fails.
    """
    aid = settings.CLOUDFLARE_ACCOUNT_ID
    if not aid or not settings.CLOUDFLARE_API_TOKEN:
        msg = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set"
        raise RuntimeError(msg)

    async with _http_client() as client:
        r = await client.post(
            f"/accounts/{aid}/cfd_tunnel",
            json={"name": name, "config_src": config_src},
        )
        r.raise_for_status()
        data = r.json()
        _check(data)
        result = data.get("result", {})
        tunnel_id = result.get("id")
        token = result.get("token")
        if not tunnel_id or not token:
            msg = "Cloudflare create tunnel response missing id or token"
            raise RuntimeError(msg)
        logger.info("Created Cloudflare tunnel", tunnel_id=tunnel_id, name=name)
        return tunnel_id, token


async def update_tunnel_config(
    tunnel_id: str,
    hostname: str,
    service_url: str,
    service_type: str = "http",
) -> None:
    """Set tunnel ingress config: hostname -> service URL.

    Args:
        tunnel_id: The Cloudflare tunnel ID.
        hostname: Public hostname for the tunnel.
        service_url: Internal service URL (e.g., "localhost:22" or "localhost:3000").
        service_type: Service type - "http" for HTTP proxy, "ssh" for TCP passthrough.
    """
    aid = settings.CLOUDFLARE_ACCOUNT_ID
    if not aid or not settings.CLOUDFLARE_API_TOKEN:
        msg = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set"
        raise RuntimeError(msg)

    # For SSH, use ssh:// protocol; for HTTP, use http://
    if service_type == "ssh":
        full_service_url = f"ssh://{service_url}"
    elif service_url.startswith(("http://", "https://")):
        full_service_url = service_url
    else:
        full_service_url = f"http://{service_url}"

    config = {
        "ingress": [
            {"hostname": hostname, "service": full_service_url},
            {"service": "http_status:404"},
        ],
    }
    async with _http_client() as client:
        r = await client.put(
            f"/accounts/{aid}/cfd_tunnel/{tunnel_id}/configurations",
            json={"config": config},
        )
        r.raise_for_status()
        data = r.json()
        _check(data)
        logger.info(
            "Updated tunnel config",
            tunnel_id=tunnel_id,
            hostname=hostname,
            service=full_service_url,
            service_type=service_type,
        )


async def create_dns_cname(hostname: str, target: str) -> str:
    """Create CNAME record. Target typically {tunnel_id}.cfargotunnel.com.

    Returns:
        DNS record id.
    """
    zid = settings.CLOUDFLARE_ZONE_ID
    if not zid or not settings.CLOUDFLARE_API_TOKEN:
        msg = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set"
        raise RuntimeError(msg)

    # If hostname is full (e.g. x.tunnel.podex.dev), use as name; else append zone.
    zone_name = settings.TUNNEL_DOMAIN
    if hostname.endswith("." + zone_name):
        name = hostname.removesuffix("." + zone_name)
    else:
        name = hostname if "." not in hostname else hostname.split(".")[0]

    async with _http_client() as client:
        r = await client.post(
            f"/zones/{zid}/dns_records",
            json={
                "type": "CNAME",
                "name": name,
                "content": target,
                "ttl": 1,
                "proxied": True,
            },
        )
        r.raise_for_status()
        data = r.json()
        _check(data)
        rid = data.get("result", {}).get("id")
        if not isinstance(rid, str) or not rid:
            msg = "Cloudflare DNS create response missing record id"
            raise RuntimeError(msg)
        logger.info("Created DNS CNAME", name=name, target=target, record_id=rid)
        return rid


async def delete_tunnel(tunnel_id: str) -> None:
    """Delete a Cloudflare Tunnel."""
    aid = settings.CLOUDFLARE_ACCOUNT_ID
    if not aid or not settings.CLOUDFLARE_API_TOKEN:
        msg = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set"
        raise RuntimeError(msg)

    async with _http_client() as client:
        r = await client.delete(f"/accounts/{aid}/cfd_tunnel/{tunnel_id}")
        r.raise_for_status()
        data = r.json()
        _check(data)
        logger.info("Deleted Cloudflare tunnel", tunnel_id=tunnel_id)


async def delete_dns_record_by_name(hostname: str) -> None:
    """Delete DNS record by name (exact match or subdomain of tunnel domain)."""
    zid = settings.CLOUDFLARE_ZONE_ID
    if not zid or not settings.CLOUDFLARE_API_TOKEN:
        msg = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set"
        raise RuntimeError(msg)

    zone_name = settings.TUNNEL_DOMAIN
    if hostname.endswith("." + zone_name):
        name = hostname.removesuffix("." + zone_name)
    else:
        name = hostname if "." not in hostname else hostname.split(".")[0]
    full_name = f"{name}.{zone_name}" if name != zone_name else zone_name

    async with _http_client() as client:
        r = await client.get(
            f"/zones/{zid}/dns_records",
            params={"type": "CNAME", "name": full_name},
        )
        r.raise_for_status()
        data = r.json()
        _check(data)
        for rec in data.get("result", []):
            rid = rec.get("id")
            if rid:
                await client.delete(f"/zones/{zid}/dns_records/{rid}")
                logger.info("Deleted DNS record", name=full_name, record_id=rid)
                return
        logger.warning("No DNS record found to delete", name=full_name)
