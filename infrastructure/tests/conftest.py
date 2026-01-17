"""Pulumi Infrastructure Tests Configuration."""

import os
import sys
from typing import Any

import pytest

# Set test environment variables
os.environ.setdefault("PULUMI_CONFIG_PASSPHRASE", "test-passphrase")
os.environ.setdefault("PULUMI_SKIP_UPDATE_CHECK", "true")


# Mock pulumi to avoid import errors
class MockPulumi:
    def log_info(self, msg: str) -> None:
        pass

    def export(self, name: str, value: Any) -> None:
        pass

    def get_stack(self) -> str:
        return "test"

    def Config(self) -> "MockConfig":
        return MockConfig()

    class Output:
        @staticmethod
        def all(*args: Any, **kwargs: Any) -> "MockOutput":
            return MockOutput()


class MockConfig:
    def get(self, key: str, default: Any = None) -> Any:
        return default

    def require(self, key: str) -> str:
        return f"mock-{key}"


class MockOutput:
    def apply(self, func: Any) -> str:
        return "mock-output"

    @staticmethod
    def all(*args: Any, **kwargs: Any) -> "MockOutput":
        return MockOutput()


class MockRandomPassword:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.result = "mock-password-123"


# Mock GCP modules with proper attribute access
class MockGCP:
    class secretmanager:
        class Secret:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.secret_id = kwargs.get("secret_id", "mock-secret-id")
                self.id = f"projects/mock-project/secrets/{self.secret_id}"

        class SecretVersion:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.secret_data = kwargs.get("secret_data", "mock-data")

        class SecretReplication:
            class Auto:
                def __init__(self, *args: Any, **kwargs: Any) -> None:
                    pass

        class SecretReplicationArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class SecretReplicationAutoArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

    class sql:
        class DatabaseInstance:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-db-instance")
                self.connection_name = "project:region:instance"
                self.public_ip_address = "10.0.0.1"
                self.private_ip_address = "10.0.0.2"

        class Database:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-database")

        class User:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class DatabaseInstanceSettingsArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class DatabaseInstanceSettingsBackupConfigurationArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class DatabaseInstanceSettingsBackupConfigurationBackupRetentionSettingsArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class DatabaseInstanceSettingsIpConfigurationArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class DatabaseInstanceSettingsIpConfigurationAuthorizedNetworkArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class DatabaseInstanceSettingsDatabaseFlagArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

    class compute:
        class Network:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.id = "mock-network-id"
                self.name = kwargs.get("name", "mock-network")

        class Subnetwork:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-subnet")

        class SubnetworkSecondaryIpRangeArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class Router:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-router")

        class RouterNat:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class RouterNatLogConfigArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class Firewall:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class FirewallAllowArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class Instance:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.network_interfaces = [
                    type("NetworkInterface", (), {"network_ip": "10.0.1.100"})()
                ]

        class InstanceBootDiskArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class InstanceBootDiskInitializeParamsArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class InstanceNetworkInterfaceArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class InstanceSchedulingArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class InstanceServiceAccountArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

    class storage:
        class Bucket:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-bucket")

    class serviceaccount:
        class Account:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                # Return a mock output-like object with apply method
                self.email = type(
                    "MockOutput",
                    (),
                    {
                        "apply": lambda func: func(
                            "mock-service-account@test-project.iam.gserviceaccount.com"
                        )
                    },
                )()

    class projects:
        class IAMMember:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

    class vpcaccess:
        class Connector:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.id = "mock-connector-id"

    class cloudrunv2:
        class Service:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-service")
                self.uri = "https://mock-service-url"

        class ServiceIamMember:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class ServiceTemplateArgs:
            pass

        class ServiceTemplateContainerArgs:
            pass

        class ServiceTemplateContainerEnvArgs:
            pass

        class ServiceTemplateContainerEnvValueSourceArgs:
            pass

        class ServiceTemplateContainerEnvValueSourceSecretKeyRefArgs:
            pass

        class ServiceTemplateContainerPortArgs:
            pass

        class ServiceTemplateContainerResourcesArgs:
            pass

        class ServiceTemplateContainerStartupProbeArgs:
            pass

        class ServiceTemplateContainerStartupProbeHttpGetArgs:
            pass

        class ServiceTemplateScalingArgs:
            pass

        class ServiceTemplateVpcAccessArgs:
            pass

    class container:
        class Cluster:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.name = kwargs.get("name", "mock-cluster")
                self.endpoint = "mock-endpoint"
                self.location = kwargs.get("location", "us-central1")

        class NodePool:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

        class ClusterIpAllocationPolicyArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterWorkloadIdentityConfigArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterClusterAutoscalingArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterClusterAutoscalingResourceLimitArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterClusterAutoscalingAutoProvisioningDefaultsArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterClusterAutoscalingAutoProvisioningDefaultsManagementArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterReleaseChannelArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterMaintenancePolicyArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class ClusterMaintenancePolicyDailyMaintenanceWindowArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolAutoscalingArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolNodeConfigArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolNodeConfigGuestAcceleratorArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolNodeConfigGuestAcceleratorGpuDriverInstallationConfigArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolNodeConfigTaintArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

        class NodePoolManagementArgs:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                for k, v in kwargs.items():
                    setattr(self, k, v)

    class artifactregistry:
        class Repository:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.location = kwargs.get("location", "us-central1")
                self.name = kwargs.get("name", "mock-repo")


class MockRandom:
    RandomPassword = MockRandomPassword


# Monkey patch to avoid import errors
sys.modules["pulumi"] = MockPulumi()  # type: ignore[assignment]
sys.modules["pulumi_gcp"] = MockGCP()  # type: ignore[assignment]
sys.modules["pulumi_random"] = MockRandom()  # type: ignore[assignment]
sys.modules["pulumi_docker"] = type("MockDocker", (), {})()


@pytest.fixture(scope="session")
def project_id() -> str:
    """Test GCP project ID."""
    return "podex-test"


@pytest.fixture(scope="session")
def region() -> str:
    """Test GCP region."""
    return "us-central1"


@pytest.fixture(scope="session")
def env() -> str:
    """Test environment."""
    return "test"


@pytest.fixture(scope="session")
def domain() -> str:
    """Test domain."""
    return "test.podex.dev"


@pytest.fixture(autouse=True)
def mock_pulumi_stack() -> None:
    """Mock Pulumi stack for testing."""
    # This ensures tests don't try to connect to real Pulumi backend
    pass
