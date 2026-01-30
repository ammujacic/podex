"""Default hardware specifications seed data.

Pricing based on Hetzner Cloud VPS (January 2026):
- ARM (CAX): Best value, ~50-70% cheaper than x86
- x86 (CPX): Standard compatibility, moderate pricing

Server costs (EUR/hr → USD/hr @ 1.08 rate):
- CAX41 (16 vCPU, 32 GB): €0.0392/hr ≈ $0.042/hr → 7 Starter or 3 Pro workspaces
- CPX51 (16 vCPU, 32 GB): €0.0970/hr ≈ $0.105/hr → 7 Starter or 3 Pro workspaces

Pricing includes 20% margin + rounding to nice numbers.
"""

DEFAULT_HARDWARE_SPECS = [
    # ==================== ARM64 CPU Tiers (Best Value) ====================
    # Recommended default - Ampere Altra processors on Hetzner CAX servers
    {
        "tier": "starter_arm",
        "display_name": "Starter (ARM)",
        "description": "Basic development environment - ARM architecture",
        "architecture": "arm64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 20,
        "bandwidth_mbps": 100,  # Basic dev work, git, package installs
        "hourly_rate_cents": 2,  # $0.02/hr - CAX41 cost/7 workspaces + margin
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 0,
    },
    {
        "tier": "pro_arm",
        "display_name": "Pro (ARM)",
        "description": "Standard development environment - ARM architecture",
        "architecture": "arm64",
        "vcpu": 4,
        "memory_mb": 8192,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 50,
        "bandwidth_mbps": 250,  # Heavier workloads, CI builds
        "hourly_rate_cents": 3,  # $0.03/hr - CAX41 cost/3 workspaces + margin
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 1,
    },
    {
        "tier": "power_arm",
        "display_name": "Power (ARM)",
        "description": "High-performance development - ARM architecture",
        "architecture": "arm64",
        "vcpu": 8,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 100,
        "bandwidth_mbps": 500,  # Large data transfers
        "hourly_rate_cents": 5,  # $0.05/hr - CAX41 cost/1.5 workspaces + margin
        "is_available": True,
        "requires_subscription": "max",
        "sort_order": 2,
    },
    {
        "tier": "enterprise_arm",
        "display_name": "Enterprise (ARM)",
        "description": "Maximum ARM resources for demanding workloads",
        "architecture": "arm64",
        "vcpu": 16,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 200,
        "bandwidth_mbps": 1000,  # Full server speed
        "hourly_rate_cents": 8,  # $0.08/hr - dedicated CAX41 + margin
        "is_available": True,
        "requires_subscription": "max",
        "sort_order": 3,
    },
    # ==================== x86_64 CPU Tiers ====================
    # For workloads requiring x86 compatibility (legacy software, specific binaries)
    {
        "tier": "starter",
        "display_name": "Starter (x86)",
        "description": "Basic development environment - x86 compatibility",
        "architecture": "amd64",
        "vcpu": 2,
        "memory_mb": 4096,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 20,
        "bandwidth_mbps": 100,  # Basic dev work, git, package installs
        "hourly_rate_cents": 3,  # $0.03/hr - CPX51 cost/7 workspaces + margin
        "is_available": True,
        "requires_subscription": None,
        "sort_order": 10,
    },
    {
        "tier": "pro",
        "display_name": "Pro (x86)",
        "description": "Standard development environment - x86 compatibility",
        "architecture": "amd64",
        "vcpu": 4,
        "memory_mb": 8192,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 50,
        "bandwidth_mbps": 250,  # Heavier workloads, CI builds
        "hourly_rate_cents": 6,  # $0.06/hr - CPX51 cost/3 workspaces + margin
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 11,
    },
    {
        "tier": "power",
        "display_name": "Power (x86)",
        "description": "High-performance development - x86 compatibility",
        "architecture": "amd64",
        "vcpu": 8,
        "memory_mb": 16384,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 100,
        "bandwidth_mbps": 500,  # Large data transfers
        "hourly_rate_cents": 10,  # $0.10/hr - CPX51 cost/1.5 workspaces + margin
        "is_available": True,
        "requires_subscription": "max",
        "sort_order": 12,
    },
    {
        "tier": "enterprise",
        "display_name": "Enterprise (x86)",
        "description": "Maximum x86 resources for demanding workloads",
        "architecture": "amd64",
        "vcpu": 16,
        "memory_mb": 32768,
        "gpu_type": None,
        "gpu_memory_gb": None,
        "gpu_count": 0,
        "is_gpu": False,
        "requires_gke": False,
        "storage_gb": 200,
        "bandwidth_mbps": 1000,  # Full server speed
        "hourly_rate_cents": 15,  # $0.15/hr - dedicated CPX51 + margin
        "is_available": True,
        "requires_subscription": "max",
        "sort_order": 13,
    },
    # ==================== GPU Tiers (Hetzner Dedicated GPU Servers) ====================
    # GEX44: RTX 4000 SFF Ada (20GB) @ €184/mo = €0.29/hr ≈ $0.32/hr
    # GEX131: RTX 6000 Blackwell (96GB) @ €889/mo = €1.43/hr ≈ $1.54/hr
    # Note: 1 workspace per GPU server (GPUs can't be easily shared)
    {
        "tier": "gpu_starter",
        "display_name": "GPU Starter",
        "description": "RTX 4000 Ada - ML inference and light training",
        "architecture": "amd64",
        "vcpu": 8,
        "memory_mb": 65536,  # 64 GB
        "gpu_type": "NVIDIA RTX 4000 SFF Ada",
        "gpu_memory_gb": 20,
        "gpu_count": 1,
        "is_gpu": True,
        "requires_gke": False,  # Runs on Hetzner dedicated, not GKE
        "storage_gb": 100,
        "bandwidth_mbps": 500,  # ML data loading needs
        "hourly_rate_cents": 40,  # $0.40/hr - GEX44 €0.29/hr + margin
        "is_available": True,
        "requires_subscription": "pro",
        "sort_order": 20,
    },
    {
        "tier": "gpu_pro",
        "display_name": "GPU Pro",
        "description": "RTX 6000 Blackwell - serious ML training and large models",
        "architecture": "amd64",
        "vcpu": 24,
        "memory_mb": 262144,  # 256 GB
        "gpu_type": "NVIDIA RTX 6000 Blackwell",
        "gpu_memory_gb": 96,
        "gpu_count": 1,
        "is_gpu": True,
        "requires_gke": False,
        "storage_gb": 500,
        "bandwidth_mbps": 1000,  # Full speed for large model downloads
        "hourly_rate_cents": 180,  # $1.80/hr - GEX131 €1.43/hr + margin
        "is_available": True,
        "requires_subscription": "max",
        "sort_order": 21,
    },
]
