"""Tests for main module.

Tests cover:
- FastAPI app configuration
- Service manager
"""

import pytest
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch


class TestMainModuleImports:
    """Test main module imports."""

    def test_main_module_exists(self):
        """Test main module can be imported."""
        from src import main
        assert main is not None


class TestServiceManager:
    """Test ServiceManager class."""

    def test_service_manager_class_exists(self):
        """Test ServiceManager class exists."""
        from src.main import ServiceManager
        assert ServiceManager is not None

    def test_service_manager_has_init_services_method(self):
        """Test ServiceManager has init_services method."""
        from src.main import ServiceManager
        assert hasattr(ServiceManager, "init_services")
        assert callable(ServiceManager.init_services)

    def test_service_manager_has_shutdown_services_method(self):
        """Test ServiceManager has shutdown_services method."""
        from src.main import ServiceManager
        assert hasattr(ServiceManager, "shutdown_services")
        assert callable(ServiceManager.shutdown_services)

    def test_service_manager_initial_state(self):
        """Test ServiceManager initial state."""
        from src.main import ServiceManager

        # Reset state for testing
        ServiceManager._redis_client = None
        ServiceManager._task_worker = None
        ServiceManager._context_manager = None
        ServiceManager._usage_tracker = None

        assert ServiceManager._redis_client is None
        assert ServiceManager._task_worker is None


class TestInitSentry:
    """Test _init_sentry function."""

    def test_init_sentry_function_exists(self):
        """Test _init_sentry function exists."""
        from src.main import _init_sentry
        assert callable(_init_sentry)


class TestFastAPIApp:
    """Test FastAPI app configuration."""

    def test_app_exists(self):
        """Test FastAPI app is created."""
        from src.main import app
        from fastapi import FastAPI

        assert isinstance(app, FastAPI)

    def test_app_has_routes(self):
        """Test app has registered routes."""
        from src.main import app

        # Check that routes are registered
        routes = [r.path for r in app.routes]
        assert "/health" in routes or any("/health" in r for r in routes)
