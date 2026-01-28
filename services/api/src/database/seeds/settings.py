"""Default platform settings seed data.

These settings are the single source of truth for configurable platform values.
Frontend fetches these from the API instead of hardcoding.
Admins can modify these via the admin panel.
"""

DEFAULT_SETTINGS = [
    # ===================
    # WORKSPACE SETTINGS
    # ===================
    {
        "key": "workspace_defaults",
        "value": {
            "cpu_limit": 2000,  # 2 CPU cores in millicores
            "memory_limit": 4096,  # 4 GB in MB
            "disk_limit": 20,  # 20 GB
            "idle_timeout": 1800000,  # 30 minutes in ms
            "max_session_duration": 86400000,  # 24 hours in ms
        },
        "description": "Default workspace resource limits",
        "category": "workspace",
        "is_public": True,
    },
    # ===================
    # AGENT SETTINGS
    # ===================
    {
        "key": "thinking_presets",
        "value": {
            "low": {"label": "Low", "tokens": 1024, "description": "Quick responses"},
            "medium": {"label": "Medium", "tokens": 8000, "description": "Balanced thinking"},
            "high": {"label": "High", "tokens": 16000, "description": "Deep analysis"},
            "max": {"label": "Max", "tokens": 32000, "description": "Maximum reasoning"},
        },
        "description": "Thinking token presets for extended thinking models",
        "category": "agents",
        "is_public": True,
    },
    {
        "key": "timeout_options",
        "value": [
            {"value": 15, "label": "15 minutes"},
            {"value": 30, "label": "30 minutes"},
            {"value": 60, "label": "1 hour"},
            {"value": 120, "label": "2 hours"},
            {"value": None, "label": "Never"},
        ],
        "description": "Available session timeout options",
        "category": "agents",
        "is_public": True,
    },
    {
        "key": "agent_mode_config",
        "value": {
            "plan": {
                "label": "Plan",
                "icon": "Eye",
                "color": "text-blue-400",
                "description": "Review changes before applying",
            },
            "ask": {
                "label": "Ask",
                "icon": "HelpCircle",
                "color": "text-yellow-400",
                "description": "Ask questions before proceeding",
            },
            "auto": {
                "label": "Auto",
                "icon": "Zap",
                "color": "text-green-400",
                "description": "Automatic execution with minimal prompts",
            },
            "sovereign": {
                "label": "Sovereign",
                "icon": "ShieldOff",
                "color": "text-red-400",
                "description": "Full autonomous execution",
            },
        },
        "description": "Agent mode configurations for UI display",
        "category": "agents",
        "is_public": True,
    },
    {
        "key": "agent_model_defaults",
        "value": {
            "architect": {"model_id": "claude-sonnet-4-5", "temperature": 0.7, "max_tokens": 8192},
            "coder": {"model_id": "claude-sonnet-4-5", "temperature": 0.3, "max_tokens": 4096},
            "reviewer": {"model_id": "claude-sonnet-4-5", "temperature": 0.5, "max_tokens": 4096},
            "tester": {"model_id": "claude-sonnet-4-5", "temperature": 0.3, "max_tokens": 4096},
            "chat": {"model_id": "claude-haiku-4-5", "temperature": 0.7, "max_tokens": 4096},
            "security": {"model_id": "claude-sonnet-4-5", "temperature": 0.3, "max_tokens": 4096},
            "devops": {"model_id": "claude-sonnet-4-5", "temperature": 0.5, "max_tokens": 4096},
            "documentator": {
                "model_id": "claude-sonnet-4-5",
                "temperature": 0.7,
                "max_tokens": 4096,
            },
            "agent_builder": {
                "model_id": "claude-sonnet-4-5",
                "temperature": 0.5,
                "max_tokens": 8192,
            },
            "orchestrator": {
                "model_id": "claude-sonnet-4-5",
                "temperature": 0.5,
                "max_tokens": 8192,
            },
            "custom": {"model_id": "claude-sonnet-4-5", "temperature": 0.5, "max_tokens": 4096},
        },
        "description": "Default model settings per agent type",
        "category": "agents",
        "is_public": False,
    },
    # ===================
    # VOICE SETTINGS
    # ===================
    {
        "key": "supported_languages",
        "value": [
            {"code": "en-US", "name": "English (US)"},
            {"code": "en-GB", "name": "English (UK)"},
            {"code": "en-AU", "name": "English (Australia)"},
            {"code": "es-ES", "name": "Spanish (Spain)"},
            {"code": "es-MX", "name": "Spanish (Mexico)"},
            {"code": "fr-FR", "name": "French"},
            {"code": "de-DE", "name": "German"},
            {"code": "it-IT", "name": "Italian"},
            {"code": "pt-BR", "name": "Portuguese (Brazil)"},
            {"code": "ja-JP", "name": "Japanese"},
            {"code": "ko-KR", "name": "Korean"},
            {"code": "zh-CN", "name": "Chinese (Simplified)"},
            {"code": "zh-TW", "name": "Chinese (Traditional)"},
            {"code": "nl-NL", "name": "Dutch"},
            {"code": "pl-PL", "name": "Polish"},
            {"code": "ru-RU", "name": "Russian"},
            {"code": "ar-SA", "name": "Arabic"},
            {"code": "hi-IN", "name": "Hindi"},
            {"code": "tr-TR", "name": "Turkish"},
            {"code": "sv-SE", "name": "Swedish"},
        ],
        "description": "Supported languages for voice/TTS",
        "category": "voice",
        "is_public": True,
    },
    {
        "key": "voice_defaults",
        "value": {
            "tts_enabled": False,
            "auto_play": False,
            "voice_id": None,
            "speed": 1.0,
            "language": "en-US",
        },
        "description": "Default text-to-speech settings",
        "category": "voice",
        "is_public": True,
    },
    {
        "key": "editor_defaults",
        "value": {
            "key_mode": "default",
            "font_size": 13,
            "tab_size": 2,
            "word_wrap": "off",
            "minimap": False,
            "line_numbers": True,
            "bracket_pair_colorization": True,
        },
        "description": "Default code editor settings",
        "category": "editor",
        "is_public": True,
    },
    {
        "key": "feature_flags",
        "value": {
            "registration_enabled": True,
            "voice_enabled": True,
            "collaboration_enabled": True,
            "custom_agents_enabled": True,
            "git_integration_enabled": True,
            "planning_mode_enabled": True,
            "vision_enabled": True,
        },
        "description": "Platform-wide feature toggles",
        "category": "features",
        "is_public": True,
    },
    {
        "key": "platform_limits",
        "value": {
            "max_concurrent_agents": 3,
            "max_sessions_per_user": 10,
            "max_file_size_mb": 50,
            "max_upload_size_mb": 100,
        },
        "description": "Global platform constraints and limits",
        "category": "limits",
        "is_public": True,
    },
    # ===================
    # LOCAL POD SETTINGS
    # ===================
    {
        "key": "local_pod_pricing",
        "value": {
            "hourly_rate_cents": 0,  # Cost per hour for local pod usage (0 = free)
            "description": "Your local machine",
            "billing_enabled": False,  # Whether to track billing for local pods
        },
        "description": (
            "Pricing configuration for local pod compute. "
            "Set hourly_rate_cents to 0 for free usage."
        ),
        "category": "billing",
        "is_public": True,  # Frontend needs to display pricing
    },
    # ===================
    # UI DEFAULTS
    # ===================
    {
        "key": "sidebar_layout_defaults",
        "value": {
            "left": {
                "collapsed": False,
                "width": 280,
                "panels": [
                    {"panelId": "files", "height": 50},
                    {"panelId": "git", "height": 50},
                ],
            },
            "right": {
                "collapsed": False,
                "width": 360,
                "panels": [
                    {"panelId": "agents", "height": 60},
                    {"panelId": "mcp", "height": 40},
                ],
            },
        },
        "description": "Default sidebar layout configuration for new users",
        "category": "ui_defaults",
        "is_public": True,
    },
    {
        "key": "grid_config_defaults",
        "value": {
            "columns": 2,
            "rowHeight": 300,
            "maxRows": 0,
            "maxCols": 0,
        },
        "description": "Default grid layout configuration for workspace",
        "category": "ui_defaults",
        "is_public": True,
    },
    {
        "key": "card_dimensions",
        "value": {
            "terminal": {"width": 500, "height": 400, "minWidth": 400, "minHeight": 300},
            "editor": {"width": 600, "height": 500, "minWidth": 400, "minHeight": 300},
            "agent": {"width": 450, "height": 500, "minWidth": 350, "minHeight": 300},
            "preview": {"width": 500, "height": 350, "minWidth": 400, "minHeight": 250},
        },
        "description": "Default dimensions for draggable cards in freeform mode",
        "category": "ui_defaults",
        "is_public": True,
    },
    # ===================
    # CONTEXT MANAGEMENT
    # ===================
    {
        "key": "context_compaction_defaults",
        "value": {
            "autoCompactEnabled": True,
            "autoCompactThresholdPercent": 80,
            "customCompactionInstructions": None,
            "preserveRecentMessages": 15,
        },
        "description": "Default context compaction settings for sessions",
        "category": "context",
        "is_public": True,
    },
    {
        "key": "context_usage_defaults",
        "value": {
            "tokensUsed": 0,
            "tokensMax": 200000,
            "percentage": 0,
        },
        "description": "Default context usage configuration",
        "category": "context",
        "is_public": True,
    },
    {
        "key": "context_limits",
        "value": {
            "maxContextTokens": 100000,
            "outputReservation": 4096,
            "safetyBuffer": 2000,
            "messageThreshold": 40,
            "summarizationThreshold": 80000,
            "tokenThreshold": 50000,
        },
        "description": "Backend context window limits and thresholds",
        "category": "context",
        "is_public": False,
    },
    # ===================
    # DOTFILES SYNC
    # ===================
    {
        "key": "default_dotfiles",
        "value": [
            ".bashrc",
            ".zshrc",
            ".gitconfig",
            ".npmrc",
            ".vimrc",
            ".profile",
            ".config/starship.toml",
            ".ssh/config",
            ".claude/",
            ".claude.json",
            ".codex/",
            ".gemini/",
            ".opencode/",
        ],
        "description": "Default dotfiles to sync for new users",
        "category": "dotfiles",
        "is_public": True,
    },
    # ===================
    # AI FEATURES
    # ===================
    {
        "key": "ai_completion_config",
        "value": {
            "debounceMs": 300,
            "maxPrefixLines": 50,
            "maxSuffixLines": 10,
            "minTriggerLength": 3,
            "enabled": True,
        },
        "description": "Configuration for AI code completions",
        "category": "ai_features",
        "is_public": True,
    },
    {
        "key": "code_generator_config",
        "value": {
            "enabled": True,
            "patterns": [
                "//\\s*TODO:\\s*(.+)$",
                "//\\s*GENERATE:\\s*(.+)$",
                "//\\s*IMPLEMENT:\\s*(.+)$",
                "#\\s*TODO:\\s*(.+)$",
                "#\\s*GENERATE:\\s*(.+)$",
                "/\\*\\s*TODO:\\s*(.+?)\\s*\\*/",
                "/\\*\\s*GENERATE:\\s*(.+?)\\s*\\*/",
            ],
        },
        "description": "Configuration for TODO/GENERATE comment detection",
        "category": "ai_features",
        "is_public": True,
    },
    {
        "key": "bug_detector_config",
        "value": {
            "debounceMs": 5000,
            "enabled": True,
            "minCodeLength": 50,
            "autoAnalyze": True,
        },
        "description": "Configuration for AI bug detection",
        "category": "ai_features",
        "is_public": True,
    },
    {
        "key": "editor_ai_config",
        "value": {
            "defaultModel": None,
            "completionsEnabled": True,
            "completionsDebounceMs": 300,
        },
        "description": "Editor AI feature configuration including default model",
        "category": "ai_features",
        "is_public": True,
    },
    # ===================
    # DASHBOARD
    # ===================
    {
        "key": "time_range_options",
        "value": [
            {"label": "Last 24 Hours", "value": "1d", "days": 1},
            {"label": "Last 7 Days", "value": "7d", "days": 7},
            {"label": "Last 30 Days", "value": "30d", "days": 30},
            {"label": "Last Year", "value": "1y", "days": 365},
            {"label": "All Time", "value": "all", "days": 9999},
        ],
        "description": "Time range options for dashboard analytics",
        "category": "dashboard",
        "is_public": True,
    },
    # ===================
    # STORAGE
    # ===================
    {
        "key": "storage_quota_defaults",
        "value": {
            "defaultQuotaBytes": 5242880,
            "warningThreshold": 0.8,
            "criticalThreshold": 0.95,
        },
        "description": "localStorage quota monitoring configuration",
        "category": "storage",
        "is_public": True,
    },
    # ===================
    # THINKING BUDGET
    # ===================
    {
        "key": "thinking_budget_config",
        "value": {
            "default": 8000,
            "min": 1024,
            "max": 32000,
        },
        "description": "Thinking budget token limits",
        "category": "agents",
        "is_public": False,
    },
    # ===================
    # MONITORING
    # ===================
    {
        "key": "sentry_config",
        "value": {
            "tracesSampleRate": 0.2,
            "profilesSampleRate": 0.1,
            "errorSampleRate": 1.0,
        },
        "description": "Sentry monitoring sample rates",
        "category": "monitoring",
        "is_public": False,
    },
    # ===================
    # PREVIEW PORTS
    # ===================
    {
        "key": "default_preview_ports",
        "value": [
            {"port": 3000, "label": "Dev Server", "protocol": "http"},
            {"port": 5173, "label": "Vite", "protocol": "http"},
            {"port": 8080, "label": "Backend API", "protocol": "http"},
            {"port": 4000, "label": "GraphQL", "protocol": "http"},
        ],
        "description": "Default preview ports for workspace",
        "category": "workspace",
        "is_public": True,
    },
    # ===================
    # INVITATIONS
    # ===================
    {
        "key": "invitation_defaults",
        "value": {
            "platform_expiration_days": 7,  # Default expiration for platform invites (1-30)
            "org_expiration_days": 7,  # Default expiration for org invites (1-30)
            "max_expiration_days": 30,  # Maximum allowed expiration days
            "allow_resend": True,  # Whether admins can resend expired invitations
        },
        "description": "Default settings for platform and organization invitations",
        "category": "invitations",
        "is_public": False,
    },
    # ===================
    # ORGANIZATION
    # ===================
    {
        "key": "blocked_email_domains",
        "value": [
            "gmail.com",
            "yahoo.com",
            "hotmail.com",
            "outlook.com",
            "aol.com",
            "icloud.com",
            "live.com",
            "msn.com",
            "protonmail.com",
            "proton.me",
            "zoho.com",
            "yandex.com",
            "mail.com",
            "gmx.com",
            "fastmail.com",
        ],
        "description": "Email domains blocked from organization auto-join",
        "category": "organization",
        "is_public": False,
    },
    # ===================
    # INFRASTRUCTURE
    # ===================
    {
        "key": "rpc_config",
        "value": {
            "defaultTimeout": 30.0,
            "maxRetries": 3,
            "retryBackoffMs": 1000,
        },
        "description": "RPC configuration for pod communication",
        "category": "infrastructure",
        "is_public": False,
    },
    {
        "key": "background_task_config",
        "value": {
            "db_operation_timeout": 60,  # Max seconds for DB operation in background tasks
            "quota_reset_interval": 300,  # Quota reset check interval (5 min)
            "billing_interval": 300,  # Billing maintenance interval (5 min)
            "workspace_delete_timeout": 120,  # Workspace deletion timeout
            "standby_cleanup_interval": 3600,  # Standby cleanup interval (1 hour)
        },
        "description": (
            "Timeouts and intervals for background tasks (prevents connection pool exhaustion)"
        ),
        "category": "infrastructure",
        "is_public": False,
    },
    {
        "key": "session_quota_config",
        "value": {
            "max_retries": 3,  # Max retries on lock contention
            "retry_delay": 0.1,  # Initial retry delay in seconds
            "retry_backoff": 2.0,  # Exponential backoff multiplier
        },
        "description": "Session quota check retry settings (prevents race condition rejections)",
        "category": "infrastructure",
        "is_public": False,
    },
    {
        "key": "default_pricing",
        "value": {
            "inputPerMillion": "5.00",
            "outputPerMillion": "15.00",
        },
        "description": "Default model pricing when not found in database",
        "category": "billing",
        "is_public": False,
    },
    # ===================
    # PARALLEL PLANNING
    # ===================
    {
        "key": "parallel_planning_config",
        "value": {
            "maxParallelPlans": 5,
            "defaultModels": [
                # Use Claude Sonnet 4.5 + Opus 4.5 as planning defaults
                "claude-sonnet-4-5",
                "gpt-4o",
                "claude-opus-4-5",
            ],
        },
        "description": "Configuration for parallel plan generation",
        "category": "agents",
        "is_public": False,
    },
    # ===================
    # VOICE/TTS BACKEND
    # ===================
    {
        "key": "tts_backend_config",
        "value": {
            "defaultVoiceId": "en-US-Neural2-F",
            "defaultLanguage": "en-US",
            "pollyVoiceId": "Joanna",
            "pollyEngine": "neural",
            "transcribeLanguage": "en-US",
        },
        "description": "Backend TTS and speech configuration",
        "category": "voice",
        "is_public": False,
    },
    # ===================
    # OAUTH PROVIDERS
    # ===================
    {
        "key": "oauth_providers",
        "value": {
            "anthropic": {
                "enabled": True,
                "name": "Anthropic (Claude Pro/Max)",
                "description": (
                    "Connect your Claude Pro or Max subscription to use your personal quota"
                ),
                "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
                "scopes": ["org:create_api_key", "user:profile", "user:inference"],
                "icon": "anthropic",
            },
            "google": {
                "enabled": True,
                "name": "Google (Gemini)",
                "description": "Connect your Google account to use Gemini models",
                "scopes": [
                    "https://www.googleapis.com/auth/generative-language",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://www.googleapis.com/auth/userinfo.profile",
                ],
                "icon": "google",
            },
            "github": {
                "enabled": True,
                "name": "GitHub (Copilot)",
                "description": "Connect your GitHub account to use GitHub Copilot",
                "scopes": ["read:user", "user:email", "copilot"],
                "icon": "github",
            },
        },
        "description": "OAuth provider configuration for personal LLM subscriptions",
        "category": "oauth",
        "is_public": True,  # Frontend needs to display available providers
    },
    {
        "key": "oauth_redirect_urls",
        "value": {
            "development": "http://localhost:3000/api/oauth/callback",
            "production": "https://app.podex.dev/api/oauth/callback",
        },
        "description": "OAuth redirect URLs by environment",
        "category": "oauth",
        "is_public": False,
    },
]
