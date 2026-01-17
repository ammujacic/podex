"""Default platform settings seed data."""

DEFAULT_SETTINGS = [
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
    {
        "key": "model_providers",
        "value": {
            "providers": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
                },
                {
                    "id": "openai",
                    "name": "OpenAI",
                    "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
                },
                {
                    "id": "google",
                    "name": "Google",
                    "models": ["gemini-1.5-pro", "gemini-1.5-flash"],
                },
                {
                    "id": "ollama",
                    "name": "Ollama (Local)",
                    "models": ["llama3", "codellama", "mistral"],
                },
            ]
        },
        "description": "Available LLM providers and their models",
        "category": "agents",
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
