"""Server management routes for compute service.

Provides endpoints for testing Docker server connections before adding them.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import docker
import structlog
from docker.tls import TLSConfig
from fastapi import APIRouter
from pydantic import BaseModel

from src.deps import InternalAuth  # noqa: TC001

logger = structlog.get_logger()

router = APIRouter(prefix="/servers", tags=["servers"])


class TestConnectionRequest(BaseModel):
    """Request to test a Docker server connection."""

    ip_address: str
    docker_port: int
    tls_enabled: bool
    tls_cert_path: str | None = None
    tls_key_path: str | None = None
    tls_ca_path: str | None = None


class DockerInfo(BaseModel):
    """Docker server information."""

    server_version: str | None = None
    os: str | None = None
    architecture: str | None = None
    containers: int | None = None
    images: int | None = None
    memory_total: int | None = None
    cpus: int | None = None


class TestConnectionResponse(BaseModel):
    """Response from connection test."""

    success: bool
    message: str
    docker_info: DockerInfo | None = None
    error: str | None = None


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_server_connection(
    request: TestConnectionRequest,
    _auth: InternalAuth,
) -> TestConnectionResponse:
    """Test Docker connection to a workspace server.

    This endpoint allows testing connectivity to a Docker host before adding it
    as a workspace server. It attempts to connect and retrieve Docker info.

    Args:
        request: Connection parameters (IP, port, TLS settings)
        _auth: Internal service authentication

    Returns:
        TestConnectionResponse with success status and Docker info if successful
    """
    loop = asyncio.get_event_loop()

    def _test_connection() -> tuple[bool, str, dict[str, Any] | None]:
        """Attempt to connect to Docker and get info."""
        client = None
        try:
            if request.tls_enabled:
                # TLS-secured connection
                if not all([request.tls_cert_path, request.tls_key_path, request.tls_ca_path]):
                    return (
                        False,
                        "All TLS paths (cert, key, ca) are required when TLS is enabled",
                        None,
                    )

                # Explicit checks for type narrowing (mypy doesn't understand all())
                cert_path = request.tls_cert_path
                key_path = request.tls_key_path
                ca_path = request.tls_ca_path
                if cert_path is None or key_path is None or ca_path is None:
                    return (False, "TLS paths are required", None)

                tls_config = TLSConfig(
                    client_cert=(cert_path, key_path),
                    ca_cert=ca_path,
                    verify=True,
                )
                base_url = f"https://{request.ip_address}:{request.docker_port}"
                client = docker.DockerClient(base_url=base_url, tls=tls_config, timeout=10)
            else:
                # HTTP connection (development)
                base_url = f"tcp://{request.ip_address}:{request.docker_port}"
                client = docker.DockerClient(base_url=base_url, timeout=10)

            # Ping to verify basic connectivity
            client.ping()

            # Get detailed info
            info = client.info()

            docker_info = {
                "server_version": info.get("ServerVersion"),
                "os": info.get("OperatingSystem"),
                "architecture": info.get("Architecture"),
                "containers": info.get("Containers"),
                "images": info.get("Images"),
                "memory_total": info.get("MemTotal"),
                "cpus": info.get("NCPU"),
            }

            return (True, "Connection successful", docker_info)

        except docker.errors.TLSParameterError as e:
            return (False, "TLS configuration error", {"error": str(e)})
        except docker.errors.DockerException as e:
            error_msg = str(e)
            # Simplify common error messages
            if "Connection refused" in error_msg:
                return (
                    False,
                    "Connection refused - check if Docker is running and accessible",
                    None,
                )
            if "certificate" in error_msg.lower() or "ssl" in error_msg.lower():
                return (False, f"TLS/Certificate error: {error_msg}", None)
            return (False, f"Docker connection error: {error_msg}", None)
        except FileNotFoundError as e:
            return (False, f"Certificate file not found: {e.filename}", None)
        except Exception as e:
            return (False, f"Connection failed: {e!s}", None)
        finally:
            if client:
                with contextlib.suppress(Exception):
                    client.close()

    try:
        success, message, docker_info_dict = await loop.run_in_executor(None, _test_connection)

        response = TestConnectionResponse(
            success=success,
            message=message,
        )

        if success and docker_info_dict:
            response.docker_info = DockerInfo(**docker_info_dict)
        elif not success and docker_info_dict and "error" in docker_info_dict:
            response.error = docker_info_dict["error"]

        logger.info(
            "Docker connection test completed",
            ip_address=request.ip_address,
            port=request.docker_port,
            tls_enabled=request.tls_enabled,
            success=success,
            message=message,
        )

        return response

    except Exception as e:
        logger.exception(
            "Unexpected error during connection test",
            ip_address=request.ip_address,
            port=request.docker_port,
        )
        return TestConnectionResponse(
            success=False,
            message="Internal error during connection test",
            error=str(e),
        )


# --- Docker Image Management Endpoints ---


class ImageInfo(BaseModel):
    """Docker image information."""

    id: str
    tags: list[str]
    size_mb: int
    created: str | None = None


class ListImagesResponse(BaseModel):
    """Response containing images on a server."""

    server_id: str
    images: list[ImageInfo]
    total_count: int


class PullImageRequest(BaseModel):
    """Request to pull a Docker image."""

    image: str
    tag: str = "latest"


class PullImageResponse(BaseModel):
    """Response from image pull operation."""

    success: bool
    message: str
    image: str
    server_id: str


@router.get("/{server_id}/images", response_model=ListImagesResponse)
async def list_server_images(
    server_id: str,
    _auth: InternalAuth,
) -> ListImagesResponse:
    """List Docker images on a specific server.

    Args:
        server_id: Server identifier
        _auth: Internal service authentication

    Returns:
        ListImagesResponse with images on the server
    """
    from src.deps import OrchestratorSingleton  # noqa: PLC0415

    docker_manager = OrchestratorSingleton.get_docker_manager()

    images = await docker_manager.list_images(server_id)

    logger.info(
        "Listed images on server",
        server_id=server_id,
        image_count=len(images),
    )

    return ListImagesResponse(
        server_id=server_id,
        images=[ImageInfo(**img) for img in images],
        total_count=len(images),
    )


@router.post("/{server_id}/images/pull", response_model=PullImageResponse)
async def pull_image_on_server(
    server_id: str,
    request: PullImageRequest,
    _auth: InternalAuth,
) -> PullImageResponse:
    """Pull a Docker image on a specific server.

    Args:
        server_id: Server identifier (from path)
        request: Pull request with image and tag
        _auth: Internal service authentication

    Returns:
        PullImageResponse with result of pull operation
    """
    from src.deps import OrchestratorSingleton  # noqa: PLC0415

    docker_manager = OrchestratorSingleton.get_docker_manager()

    full_image = f"{request.image}:{request.tag}"

    logger.info(
        "Starting image pull on server",
        server_id=server_id,
        image=full_image,
    )

    success, message = await docker_manager.pull_image(
        server_id=server_id,
        image=request.image,
        tag=request.tag,
    )

    logger.info(
        "Image pull completed",
        server_id=server_id,
        image=full_image,
        success=success,
        message=message,
    )

    return PullImageResponse(
        success=success,
        message=message,
        image=full_image,
        server_id=server_id,
    )
