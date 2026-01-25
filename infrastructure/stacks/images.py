"""Docker image building and pushing to Artifact Registry.

Uses pulumi-docker to build images for linux/amd64 (required for Cloud Run)
and push them to Google Artifact Registry as part of the Pulumi deployment.
"""

from collections.abc import Mapping

import pulumi
import pulumi_docker as docker
import pulumi_gcp as gcp


def create_docker_images(
    project_id: str,
    region: str,
    env: str,
    artifact_repo: gcp.artifactregistry.Repository,
) -> dict[str, docker.Image]:
    """Build and push Docker images to Artifact Registry.

    Args:
        project_id: GCP project ID
        region: GCP region
        env: Environment name (dev, staging, prod)
        artifact_repo: Artifact Registry repository

    Returns:
        Dictionary mapping service names to their Docker images
    """
    images: dict[str, docker.Image] = {}

    # Base registry path
    registry_url = pulumi.Output.all(artifact_repo.location, artifact_repo.name).apply(
        lambda args: f"{args[0]}-docker.pkg.dev/{project_id}/{args[1]}"
    )

    # Service configurations
    # context is relative to infrastructure/ directory, so we need ../
    services = [
        {
            "name": "api",
            "dockerfile": "../services/api/Dockerfile",
            "context": "..",
            "tag": "latest",
            "target": "production",
        },
        {
            "name": "agent",
            "dockerfile": "../services/agent/Dockerfile",
            "context": "..",
            "tag": "latest",
            "target": "production",
        },
        {
            "name": "compute",
            "dockerfile": "../services/compute/Dockerfile",
            "context": "..",
            "tag": "latest",
            "target": "production",
        },
        {
            "name": "web",
            "dockerfile": "../apps/web/Dockerfile",
            "context": "..",
            "tag": "latest",
            "target": "production",
        },
        {
            "name": "workspace",
            "dockerfile": "../infrastructure/docker/workspace/Dockerfile",
            "context": "../infrastructure/docker/workspace",
            "tag": "latest-amd64",
        },
        {
            "name": "workspace-gpu",
            "registry_name": "workspace",
            "dockerfile": "../infrastructure/docker/workspace-gpu/Dockerfile",
            "context": "../infrastructure/docker/workspace-gpu",
            "tag": "latest-gpu",
        },
    ]

    def make_image_formatter(name: str):  # type: ignore[no-untyped-def]
        """Create a formatter function for image names."""

        def format_image(url: str) -> str:
            return f"{url}/{name}"

        return format_image

    for svc in services:
        svc_name = svc["name"]
        registry_name = svc.get("registry_name", svc_name)
        image_name = registry_url.apply(make_image_formatter(registry_name))

        tag = svc.get("tag", "latest")
        target = svc.get("target")
        build = docker.DockerBuildArgs(
            context=svc["context"],
            dockerfile=svc["dockerfile"],
            platform="linux/amd64",  # Required for Cloud Run (even on ARM Macs)
            cache_from=docker.CacheFromArgs(
                images=[image_name.apply(lambda n, t=tag: f"{n}:{t}")],  # type: ignore[misc]
            ),
            target=target,
        )

        # Build and push the image
        image = docker.Image(
            f"podex-{svc['name']}-image-{env}",
            build=build,
            image_name=image_name.apply(lambda n, t=tag: f"{n}:{t}"),  # type: ignore[misc]
            registry=docker.RegistryArgs(
                server=pulumi.Output.concat(region, "-docker.pkg.dev"),
                # Uses gcloud credentials automatically via Application Default Credentials
            ),
            # Skip push if PULUMI_SKIP_DOCKER_PUSH is set (useful for preview)
            skip_push=pulumi.Config().get_bool("skip_docker_push") or False,
        )

        images[svc["name"]] = image

    return images


def get_image_refs(
    images: Mapping[str, docker.Image],
) -> dict[str, pulumi.Output[str]]:
    """Get image references (with digest) for use in Cloud Run.

    Using the digest ensures Cloud Run pulls the exact image that was built,
    not just 'latest' which could have changed.

    Args:
        images: Dictionary of Docker images from create_docker_images

    Returns:
        Dictionary mapping service names to their full image references with digest
    """
    return {name: image.repo_digest for name, image in images.items()}
