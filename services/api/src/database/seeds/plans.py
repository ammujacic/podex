"""Default subscription plans seed data.

These plans define pricing, limits, and features for each subscription tier.
The new UI/display fields allow frontend to render plans without hardcoding.
"""

DEFAULT_PLANS = [
    {
        "name": "Free",
        "slug": "free",
        "description": "Get started with Podex for free",
        "price_monthly_cents": 0,
        "price_yearly_cents": 0,
        "currency": "USD",
        "tokens_included": 100000,
        "compute_credits_cents_included": 500,
        "storage_gb_included": 5,
        "max_agents": 1,
        "max_sessions": 3,
        "max_team_members": 1,
        "overage_allowed": False,
        "llm_margin_percent": 0,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": False,
            "git_integration": True,
            "team_collaboration": False,
            "gpu_access": False,
            "community_support": True,
        },
        # New UI/display fields
        "color": "#6b7280",  # gray-500
        "icon": "Zap",
        "cta_text": "Get Started",
        "highlight_features": [
            "100K tokens/month",
            "1 AI agent",
            "Basic workspace",
            "Community support",
        ],
        # Session/workspace configuration
        "session_timeout_options": [15, 30],  # Limited timeout options
        "max_thinking_tokens": 8000,  # Limited thinking
        "workspace_cpu_limit": 1000,  # 1 CPU
        "workspace_memory_limit": 2048,  # 2 GB
        "workspace_disk_limit": 10,  # 10 GB
        "max_session_duration_minutes": 120,  # 2 hour max
        "is_active": True,
        "is_popular": False,
        "is_enterprise": False,
        "sort_order": 0,
    },
    {
        "name": "Pro",
        "slug": "pro",
        "description": "For professional developers and small teams",
        "price_monthly_cents": 2900,
        "price_yearly_cents": 29000,
        "currency": "USD",
        "tokens_included": 1000000,
        "compute_credits_cents_included": 2000,
        "storage_gb_included": 50,
        "max_agents": 5,
        "max_sessions": 10,
        "max_team_members": 5,
        "overage_allowed": True,
        "llm_margin_percent": 20,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": True,
            "git_integration": True,
            "team_collaboration": True,
            "gpu_access": False,
            "advanced_analytics": True,
            "custom_agents": True,
            "email_support": True,
        },
        # New UI/display fields
        "color": "#8b5cf6",  # violet-500
        "icon": "Crown",
        "cta_text": "Upgrade to Pro",
        "highlight_features": [
            "1M tokens/month",
            "5 AI agents",
            "Private projects",
            "Custom agent templates",
            "Email support",
        ],
        # Session/workspace configuration
        "session_timeout_options": [15, 30, 60, 120],  # More options
        "max_thinking_tokens": 16000,  # Higher thinking
        "workspace_cpu_limit": 2000,  # 2 CPUs
        "workspace_memory_limit": 4096,  # 4 GB
        "workspace_disk_limit": 50,  # 50 GB
        "max_session_duration_minutes": 480,  # 8 hour max
        "is_active": True,
        "is_popular": True,
        "is_enterprise": False,
        "sort_order": 1,
    },
    {
        "name": "Max",
        "slug": "max",
        "description": "For growing teams with advanced needs",
        "price_monthly_cents": 9900,
        "price_yearly_cents": 99000,
        "currency": "USD",
        "tokens_included": 5000000,
        "compute_credits_cents_included": 5000,
        "storage_gb_included": 200,
        "max_agents": 20,
        "max_sessions": 50,
        "max_team_members": 20,
        "overage_allowed": True,
        "llm_margin_percent": 25,
        "compute_margin_percent": 20,
        "features": {
            "private_projects": True,
            "git_integration": True,
            "team_collaboration": True,
            "gpu_access": True,
            "advanced_analytics": True,
            "audit_logs": True,
            "custom_agents": True,
            "priority_support": True,
        },
        # New UI/display fields
        "color": "#f59e0b",  # amber-500
        "icon": "Rocket",
        "cta_text": "Go Max",
        "highlight_features": [
            "5M tokens/month",
            "20 AI agents",
            "GPU access",
            "Audit logs",
            "Priority support",
        ],
        # Session/workspace configuration
        "session_timeout_options": [15, 30, 60, 120, None],  # All options including never
        "max_thinking_tokens": 32000,  # Max thinking
        "workspace_cpu_limit": 4000,  # 4 CPUs
        "workspace_memory_limit": 8192,  # 8 GB
        "workspace_disk_limit": 100,  # 100 GB
        "max_session_duration_minutes": None,  # Unlimited
        "is_active": True,
        "is_popular": False,
        "is_enterprise": False,
        "sort_order": 2,
    },
]
