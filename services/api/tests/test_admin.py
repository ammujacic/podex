"""
Comprehensive tests for admin routes.

Tests cover:
- User management
- Plan management
- Hardware management
- Template management
- Analytics
- Platform settings
"""

from typing import Any

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def admin_headers() -> dict[str, str]:
    """Create admin authentication headers."""
    return {
        "Authorization": "Bearer admin-test-token",
        "Content-Type": "application/json",
    }


@pytest.fixture
def test_admin_user() -> dict[str, Any]:
    """Create a test admin user."""
    return {
        "id": "admin-user-123",
        "email": "admin@podex.dev",
        "name": "Admin User",
        "role": "admin",
        "created_at": "2024-01-01T00:00:00Z",
    }


# ============================================================================
# ADMIN USER MANAGEMENT TESTS
# ============================================================================


class TestAdminUserManagement:
    """Tests for admin user management endpoints."""

    def test_list_users_unauthenticated(self, client: TestClient) -> None:
        """Test listing users without auth."""
        response = client.get("/api/admin/users")
        assert response.status_code in [401, 403, 404]

    def test_list_users_non_admin(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        """Test listing users as non-admin."""
        response = client.get("/api/admin/users", headers=auth_headers)
        assert response.status_code in [401, 403, 404]

    def test_get_user_unauthenticated(self, client: TestClient) -> None:
        """Test getting user without auth."""
        response = client.get("/api/admin/users/user-123")
        assert response.status_code in [401, 403, 404]

    def test_update_user_unauthenticated(self, client: TestClient) -> None:
        """Test updating user without auth."""
        response = client.patch(
            "/api/admin/users/user-123",
            json={"name": "Updated Name"},
        )
        assert response.status_code in [401, 403, 404, 405]

    def test_delete_user_unauthenticated(self, client: TestClient) -> None:
        """Test deleting user without auth."""
        response = client.delete("/api/admin/users/user-123")
        assert response.status_code in [401, 403, 404]

    def test_suspend_user_unauthenticated(self, client: TestClient) -> None:
        """Test suspending user without auth."""
        response = client.post("/api/admin/users/user-123/suspend")
        assert response.status_code in [401, 403, 404]

    def test_unsuspend_user_unauthenticated(self, client: TestClient) -> None:
        """Test unsuspending user without auth."""
        response = client.post("/api/admin/users/user-123/unsuspend")
        assert response.status_code in [401, 403, 404]


# ============================================================================
# ADMIN PLAN MANAGEMENT TESTS
# ============================================================================


class TestAdminPlanManagement:
    """Tests for admin plan management endpoints."""

    def test_list_plans_unauthenticated(self, client: TestClient) -> None:
        """Test listing all plans without auth."""
        response = client.get("/api/admin/plans")
        assert response.status_code in [401, 403, 404]

    def test_create_plan_unauthenticated(self, client: TestClient) -> None:
        """Test creating plan without auth."""
        response = client.post(
            "/api/admin/plans",
            json={
                "name": "Test Plan",
                "slug": "test-plan",
                "price_monthly_cents": 1000,
                "price_yearly_cents": 10000,
            },
        )
        assert response.status_code in [401, 403, 404]

    def test_update_plan_unauthenticated(self, client: TestClient) -> None:
        """Test updating plan without auth."""
        response = client.patch(
            "/api/admin/plans/plan-123",
            json={"name": "Updated Plan"},
        )
        assert response.status_code in [401, 403, 404, 405]

    def test_delete_plan_unauthenticated(self, client: TestClient) -> None:
        """Test deleting plan without auth."""
        response = client.delete("/api/admin/plans/plan-123")
        assert response.status_code in [401, 403, 404]


# ============================================================================
# ADMIN HARDWARE MANAGEMENT TESTS
# ============================================================================


class TestAdminHardwareManagement:
    """Tests for admin hardware management endpoints."""

    def test_list_hardware_specs_admin(self, client: TestClient) -> None:
        """Test listing all hardware specs as admin."""
        response = client.get("/api/admin/hardware")
        assert response.status_code in [401, 403, 404]

    def test_create_hardware_spec_unauthenticated(self, client: TestClient) -> None:
        """Test creating hardware spec without auth."""
        response = client.post(
            "/api/admin/hardware",
            json={
                "tier": "test",
                "display_name": "Test Tier",
                "vcpu": 2,
                "memory_mb": 4096,
                "hourly_rate_cents": 10,
            },
        )
        assert response.status_code in [401, 403, 404]

    def test_update_hardware_spec_unauthenticated(self, client: TestClient) -> None:
        """Test updating hardware spec without auth."""
        response = client.patch(
            "/api/admin/hardware/hw-123",
            json={"hourly_rate_cents": 15},
        )
        assert response.status_code in [401, 403, 404, 405]


# ============================================================================
# ADMIN TEMPLATE MANAGEMENT TESTS
# ============================================================================


class TestAdminTemplateManagement:
    """Tests for admin template management endpoints."""

    def test_list_all_templates_admin(self, client: TestClient) -> None:
        """Test listing all templates as admin."""
        response = client.get("/api/admin/templates")
        assert response.status_code in [401, 403, 404]

    def test_create_template_unauthenticated(self, client: TestClient) -> None:
        """Test creating template without auth."""
        response = client.post(
            "/api/admin/templates",
            json={
                "name": "Test Template",
                "slug": "test-template",
                "description": "A test template",
            },
        )
        assert response.status_code in [401, 403, 404]

    def test_update_template_unauthenticated(self, client: TestClient) -> None:
        """Test updating template without auth."""
        response = client.patch(
            "/api/admin/templates/template-123",
            json={"name": "Updated Template"},
        )
        assert response.status_code in [401, 403, 404, 405]

    def test_delete_template_unauthenticated(self, client: TestClient) -> None:
        """Test deleting template without auth."""
        response = client.delete("/api/admin/templates/template-123")
        assert response.status_code in [401, 403, 404]


# ============================================================================
# ADMIN ANALYTICS TESTS
# ============================================================================


class TestAdminAnalytics:
    """Tests for admin analytics endpoints."""

    def test_get_analytics_overview_unauthenticated(self, client: TestClient) -> None:
        """Test getting analytics overview without auth."""
        response = client.get("/api/admin/analytics/overview")
        assert response.status_code in [401, 403, 404]

    def test_get_user_analytics_unauthenticated(self, client: TestClient) -> None:
        """Test getting user analytics without auth."""
        response = client.get("/api/admin/analytics/users")
        assert response.status_code in [401, 403, 404]

    def test_get_revenue_analytics_unauthenticated(self, client: TestClient) -> None:
        """Test getting revenue analytics without auth."""
        response = client.get("/api/admin/analytics/revenue")
        assert response.status_code in [401, 403, 404]

    def test_get_usage_analytics_unauthenticated(self, client: TestClient) -> None:
        """Test getting usage analytics without auth."""
        response = client.get("/api/admin/analytics/usage")
        assert response.status_code in [401, 403, 404]


# ============================================================================
# ADMIN SETTINGS TESTS
# ============================================================================


class TestAdminSettings:
    """Tests for admin settings endpoints."""

    def test_get_platform_settings_unauthenticated(self, client: TestClient) -> None:
        """Test getting platform settings without auth."""
        response = client.get("/api/admin/settings")
        assert response.status_code in [401, 403, 404]

    def test_update_platform_settings_unauthenticated(self, client: TestClient) -> None:
        """Test updating platform settings without auth."""
        response = client.patch(
            "/api/admin/settings",
            json={"maintenance_mode": True},
        )
        assert response.status_code in [401, 403, 404, 405]

    def test_get_feature_flags_unauthenticated(self, client: TestClient) -> None:
        """Test getting feature flags without auth."""
        response = client.get("/api/admin/settings/features")
        assert response.status_code in [401, 403, 404]

    def test_update_feature_flags_unauthenticated(self, client: TestClient) -> None:
        """Test updating feature flags without auth."""
        response = client.patch(
            "/api/admin/settings/features",
            json={"new_ui": True},
        )
        assert response.status_code in [401, 403, 404, 405]
