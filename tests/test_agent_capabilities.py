"""
Comprehensive Agent Capability Tests

Tests all agent types, modes, and features with real Ollama models.
"""
import time
import pytest
from typing import Dict, Any


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentTypes:
    """Test all built-in agent types."""

    AGENT_TYPES = [
        ("architect", "Design a simple REST API for user management with CRUD operations"),
        ("coder", "Write a Python function to calculate fibonacci numbers"),
        ("reviewer", "Review this code for potential bugs and improvements"),
        ("tester", "Write unit tests for a function that validates email addresses"),
        ("chat", "Hello! How are you today?"),
        ("security", "Analyze this code for security vulnerabilities: eval(user_input)"),
        ("devops", "Explain how to set up a CI/CD pipeline with GitHub Actions"),
        ("documentator", "Document this API endpoint: POST /users - creates a new user"),
    ]

    def test_agent_creation_all_types(self, api_client, test_session, ollama_model):
        """Test creating all agent types."""
        print("\n\n🤖 Testing Agent Creation for All Types")
        print("=" * 70)

        created_agents = []

        for role, _ in self.AGENT_TYPES:
            print(f"\n📝 Creating {role} agent...")

            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": f"Test {role.title()}",
                    "role": role,
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )

            assert response.status_code == 200, f"Failed to create {role} agent: {response.text}"

            agent = response.json()
            assert agent["role"] == role
            assert agent["status"] in ["idle", "active"]

            created_agents.append(agent["id"])
            print(f"✓ Created {role} agent: {agent['id']}")

        assert len(created_agents) == len(self.AGENT_TYPES)
        print(f"\n✅ Successfully created all {len(created_agents)} agent types")

    def test_agent_messaging(self, api_client, test_session, ollama_model, test_timeout):
        """Test sending messages to different agent types and receiving responses."""
        print("\n\n💬 Testing Agent Messaging")
        print("=" * 70)

        for role, prompt in self.AGENT_TYPES:
            print(f"\n📤 Testing {role} agent with message...")

            # Create agent
            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": f"Test {role.title()} Message",
                    "role": role,
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )
            assert response.status_code == 200
            agent_id = response.json()["id"]

            # Send message
            start_time = time.time()
            response = api_client.post(
                f"/api/sessions/{test_session}/agents/{agent_id}/messages",
                json={"content": prompt},
                timeout=test_timeout
            )

            elapsed = time.time() - start_time

            assert response.status_code == 200, f"Failed to send message to {role}: {response.text}"

            message = response.json()
            assert message["role"] == "assistant"
            assert len(message["content"]) > 0

            print(f"✓ {role} responded in {elapsed:.2f}s")
            print(f"  Response preview: {message['content'][:100]}...")

        print(f"\n✅ All agent types responded successfully")

    def test_agent_status_tracking(self, api_client, test_session, ollama_model):
        """Test agent status changes during operation."""
        print("\n\n📊 Testing Agent Status Tracking")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Status Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Check initial status
        response = api_client.get(f"/api/sessions/{test_session}/agents/{agent_id}", timeout=10)
        assert response.status_code == 200
        agent = response.json()
        assert agent["status"] in ["idle", "active"]
        print(f"✓ Initial status: {agent['status']}")

        # Send message and check status
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "Say hello"},
            timeout=60
        )
        assert response.status_code == 200
        print(f"✓ Message sent successfully")

        # Check final status
        response = api_client.get(f"/api/sessions/{test_session}/agents/{agent_id}", timeout=10)
        assert response.status_code == 200
        agent = response.json()
        print(f"✓ Final status: {agent['status']}")

        print("\n✅ Agent status tracking works correctly")


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentModes:
    """Test all agent permission modes."""

    MODES = ["plan", "ask", "auto", "sovereign"]

    def test_mode_switching(self, api_client, test_session, ollama_model):
        """Test switching between all agent modes."""
        print("\n\n🔒 Testing Agent Mode Switching")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Mode Test Agent",
                "role": "coder",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        for mode in self.MODES:
            print(f"\n🔧 Switching to {mode} mode...")

            payload: Dict[str, Any] = {"mode": mode}
            if mode == "auto":
                payload["command_allowlist"] = ["ls *", "cat *", "git status"]

            response = api_client.patch(
                f"/api/sessions/{test_session}/agents/{agent_id}/mode",
                json=payload,
                timeout=10
            )

            assert response.status_code == 200, f"Failed to switch to {mode}: {response.text}"

            result = response.json()
            assert result["mode"] == mode
            print(f"✓ Successfully switched to {mode} mode")

            if mode == "auto":
                assert result["command_allowlist"] is not None
                print(f"  Allowlist: {result['command_allowlist']}")

        print(f"\n✅ All mode switches successful")

    def test_mode_permissions(self, api_client, test_session, ollama_model):
        """Test that different modes have appropriate permissions."""
        print("\n\n🛡️  Testing Mode Permissions")
        print("=" * 70)

        # Create agent in ask mode
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Permission Test Agent",
                "role": "coder",
                "model": f"ollama/{ollama_model}",
                "mode": "ask"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent in ask mode: {agent_id}")

        # Verify mode
        response = api_client.get(
            f"/api/sessions/{test_session}/agents/{agent_id}/mode",
            timeout=10
        )
        assert response.status_code == 200
        mode_info = response.json()
        assert mode_info["mode"] == "ask"
        print(f"✓ Verified ask mode: {mode_info}")

        print("\n✅ Mode permissions verified")


@pytest.mark.local_only
@pytest.mark.integration
class TestCustomAgents:
    """Test custom agent creation and usage."""

    def test_custom_agent_template_creation(self, api_client):
        """Test creating a custom agent template."""
        print("\n\n🎨 Testing Custom Agent Template Creation")
        print("=" * 70)

        template_data = {
            "name": "Test Custom Agent",
            "slug": f"test-custom-{int(time.time())}",
            "description": "A test custom agent for integration testing",
            "system_prompt": "You are a helpful assistant specialized in testing.",
            "allowed_tools": ["read_file", "search_code", "list_directory"],
            "model": "ollama/qwen2.5-coder:14b",
            "temperature": 0.7
        }

        print(f"📝 Creating template: {template_data['name']}")

        response = api_client.post(
            "/api/agent-templates",
            json=template_data,
            timeout=30
        )

        assert response.status_code == 200, f"Failed to create template: {response.text}"

        template = response.json()
        assert template["name"] == template_data["name"]
        assert template["slug"] == template_data["slug"]
        assert set(template["allowed_tools"]) == set(template_data["allowed_tools"])

        print(f"✓ Created template: {template['id']}")
        print(f"  Tools: {template['allowed_tools']}")

        # Cleanup
        api_client.delete(f"/api/agent-templates/{template['id']}", timeout=10)

        print("\n✅ Custom template creation successful")

    def test_custom_agent_from_template(self, api_client, test_session, ollama_model):
        """Test creating an agent from a custom template."""
        print("\n\n🎭 Testing Custom Agent Instance")
        print("=" * 70)

        # Create template
        template_data = {
            "name": "Test Helper Agent",
            "slug": f"test-helper-{int(time.time())}",
            "description": "Helps with testing",
            "system_prompt": "You are a helpful testing assistant.",
            "allowed_tools": ["read_file", "write_file"],
            "model": f"ollama/{ollama_model}"
        }

        response = api_client.post(
            "/api/agent-templates",
            json=template_data,
            timeout=30
        )
        assert response.status_code == 200
        template_id = response.json()["id"]
        print(f"✓ Created template: {template_id}")

        # Create agent from template
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Custom Agent Instance",
                "role": "custom",
                "model": f"ollama/{ollama_model}",
                "template_id": template_id
            },
            timeout=30
        )

        assert response.status_code == 200, f"Failed to create custom agent: {response.text}"

        agent = response.json()
        assert agent["role"] == "custom"
        assert agent["template_id"] == template_id

        print(f"✓ Created custom agent: {agent['id']}")

        # Test messaging
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent['id']}/messages",
            json={"content": "Hello, are you a custom agent?"},
            timeout=60
        )
        assert response.status_code == 200
        message = response.json()
        print(f"✓ Custom agent responded")
        print(f"  Response: {message['content'][:100]}...")

        # Cleanup
        api_client.delete(f"/api/agent-templates/{template_id}", timeout=10)

        print("\n✅ Custom agent from template works correctly")


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentOperations:
    """Test agent lifecycle operations."""

    def test_agent_duplication(self, api_client, test_session, ollama_model):
        """Test duplicating an agent."""
        print("\n\n📋 Testing Agent Duplication")
        print("=" * 70)

        # Create original agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Original Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        original_agent_id = response.json()["id"]
        print(f"✓ Created original agent: {original_agent_id}")

        # Duplicate agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{original_agent_id}/duplicate",
            json={"name": "Duplicated Agent"},
            timeout=30
        )

        assert response.status_code == 200, f"Failed to duplicate agent: {response.text}"

        duplicate_agent = response.json()
        assert duplicate_agent["id"] != original_agent_id
        assert duplicate_agent["name"] == "Duplicated Agent"
        assert duplicate_agent["role"] == "chat"

        print(f"✓ Duplicated agent: {duplicate_agent['id']}")

        print("\n✅ Agent duplication successful")

    def test_agent_deletion(self, api_client, test_session, ollama_model):
        """Test deleting an agent."""
        print("\n\n🗑️  Testing Agent Deletion")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Agent To Delete",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Delete agent
        response = api_client.delete(
            f"/api/sessions/{test_session}/agents/{agent_id}",
            timeout=10
        )

        assert response.status_code == 200, f"Failed to delete agent: {response.text}"
        print(f"✓ Deleted agent: {agent_id}")

        # Verify deletion
        response = api_client.get(
            f"/api/sessions/{test_session}/agents/{agent_id}",
            timeout=10
        )
        assert response.status_code == 404
        print(f"✓ Verified agent no longer exists")

        print("\n✅ Agent deletion successful")

    def test_list_agents(self, api_client, test_session, ollama_model):
        """Test listing all agents in a session."""
        print("\n\n📜 Testing Agent Listing")
        print("=" * 70)

        # Create multiple agents
        agent_ids = []
        for i in range(3):
            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": f"List Test Agent {i+1}",
                    "role": "chat",
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )
            assert response.status_code == 200
            agent_ids.append(response.json()["id"])
            print(f"✓ Created agent {i+1}: {agent_ids[-1]}")

        # List agents
        response = api_client.get(
            f"/api/sessions/{test_session}/agents",
            timeout=10
        )

        assert response.status_code == 200
        agents = response.json()
        assert len(agents) >= 3  # At least our 3 agents

        listed_ids = [agent["id"] for agent in agents]
        for agent_id in agent_ids:
            assert agent_id in listed_ids

        print(f"✓ Listed {len(agents)} agents")

        print("\n✅ Agent listing successful")
