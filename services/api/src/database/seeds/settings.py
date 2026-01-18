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
        "key": "agent_defaults",
        "value": {
            "architect": {"model": "claude-3-opus", "temperature": 0.7, "max_tokens": 8192},
            "coder": {"model": "claude-3-sonnet", "temperature": 0.3, "max_tokens": 4096},
            "reviewer": {"model": "claude-3-sonnet", "temperature": 0.5, "max_tokens": 4096},
            "tester": {"model": "claude-3-haiku", "temperature": 0.3, "max_tokens": 2048},
        },
        "description": "Default AI agent model configurations",
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
]
