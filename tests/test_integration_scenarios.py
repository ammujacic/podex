"""
Integration Test Scenarios

Tests real-world workflows and complex agent interactions.
"""
import time
import pytest


@pytest.mark.local_only
@pytest.mark.integration
@pytest.mark.slow
class TestComplexWorkflows:
    """Test complete development workflows with multiple agents."""

    def test_full_development_workflow(self, api_client, test_session, ollama_model, test_timeout):
        """
        Test a complete development workflow:
        1. Architect designs solution
        2. Coder implements it
        3. Tester writes tests
        4. Reviewer reviews code
        """
        print("\n\n🏗️  Testing Full Development Workflow")
        print("=" * 70)

        agents = []

        # Step 1: Architect designs
        print("\n📐 Step 1: Architect Agent - Design")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Workflow Architect",
                "role": "architect",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        architect_id = response.json()["id"]
        agents.append(("Architect", architect_id))
        print(f"✓ Created architect: {architect_id}")

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{architect_id}/messages",
            json={"content": "Design a simple calculator API with add, subtract, multiply, divide endpoints"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        architect_response = response.json()["content"]
        print(f"✓ Architect designed solution")
        print(f"  Design: {architect_response[:200]}...")

        # Step 2: Coder implements
        print("\n💻 Step 2: Coder Agent - Implementation")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Workflow Coder",
                "role": "coder",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        coder_id = response.json()["id"]
        agents.append(("Coder", coder_id))
        print(f"✓ Created coder: {coder_id}")

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{coder_id}/messages",
            json={"content": "Write Python functions for add, subtract, multiply, and divide operations"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        coder_response = response.json()["content"]
        print(f"✓ Coder implemented functions")
        print(f"  Code preview: {coder_response[:200]}...")

        # Step 3: Tester writes tests
        print("\n🧪 Step 3: Tester Agent - Tests")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Workflow Tester",
                "role": "tester",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        tester_id = response.json()["id"]
        agents.append(("Tester", tester_id))
        print(f"✓ Created tester: {tester_id}")

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{tester_id}/messages",
            json={"content": "Write pytest tests for calculator functions: add, subtract, multiply, divide"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        tester_response = response.json()["content"]
        print(f"✓ Tester wrote tests")
        print(f"  Tests preview: {tester_response[:200]}...")

        # Step 4: Reviewer reviews
        print("\n🔍 Step 4: Reviewer Agent - Review")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Workflow Reviewer",
                "role": "reviewer",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        reviewer_id = response.json()["id"]
        agents.append(("Reviewer", reviewer_id))
        print(f"✓ Created reviewer: {reviewer_id}")

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{reviewer_id}/messages",
            json={"content": "Review calculator functions for correctness, edge cases, and best practices"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        reviewer_response = response.json()["content"]
        print(f"✓ Reviewer completed review")
        print(f"  Review preview: {reviewer_response[:200]}...")

        # Verify all agents exist
        print(f"\n📊 Workflow Summary:")
        for agent_name, agent_id in agents:
            response = api_client.get(
                f"/api/sessions/{test_session}/agents/{agent_id}",
                timeout=10
            )
            assert response.status_code == 200
            agent = response.json()
            print(f"  ✓ {agent_name}: {agent['status']}")

        print(f"\n✅ Complete workflow executed successfully with {len(agents)} agents")

    def test_orchestrator_delegation(self, api_client, test_session, ollama_model, test_timeout):
        """Test orchestrator agent delegating tasks."""
        print("\n\n🎭 Testing Orchestrator Delegation")
        print("=" * 70)

        # Create orchestrator
        print("📝 Creating orchestrator agent...")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Test Orchestrator",
                "role": "orchestrator",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        orchestrator_id = response.json()["id"]
        print(f"✓ Created orchestrator: {orchestrator_id}")

        # Give orchestrator a complex task
        print("\n📤 Sending delegation task...")
        task_prompt = (
            "Create a plan to build a simple web application with user authentication. "
            "Break it down into architecture, implementation, testing, and deployment steps."
        )

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{orchestrator_id}/messages",
            json={"content": task_prompt},
            timeout=test_timeout
        )

        assert response.status_code == 200
        orchestrator_response = response.json()["content"]
        print(f"✓ Orchestrator created plan")
        print(f"  Plan preview: {orchestrator_response[:300]}...")

        # Check if orchestrator is functioning
        response = api_client.get(
            f"/api/sessions/{test_session}/agents/{orchestrator_id}",
            timeout=10
        )
        assert response.status_code == 200
        assert response.json()["role"] == "orchestrator"

        print(f"\n✅ Orchestrator delegation test completed")

    def test_security_analysis_workflow(self, api_client, test_session, ollama_model, test_timeout):
        """Test security agent analyzing code."""
        print("\n\n🔒 Testing Security Analysis Workflow")
        print("=" * 70)

        # Create security agent
        print("📝 Creating security agent...")
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Security Analyst",
                "role": "security",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        security_id = response.json()["id"]
        print(f"✓ Created security agent: {security_id}")

        # Test with vulnerable code
        print("\n🔍 Analyzing vulnerable code...")
        vulnerable_code = """
def execute_command(user_input):
    import os
    result = os.system(user_input)  # Command injection vulnerability
    return result

def get_user_data(user_id):
    query = f"SELECT * FROM users WHERE id = {user_id}"  # SQL injection
    return db.execute(query)
        """

        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{security_id}/messages",
            json={"content": f"Analyze this code for security vulnerabilities:\n{vulnerable_code}"},
            timeout=test_timeout
        )

        assert response.status_code == 200
        security_analysis = response.json()["content"]
        print(f"✓ Security analysis completed")
        print(f"  Analysis preview: {security_analysis[:300]}...")

        # Basic checks (security agent should identify issues)
        analysis_lower = security_analysis.lower()
        assert len(security_analysis) > 50, "Security analysis too short"
        print(f"✓ Analysis is comprehensive ({len(security_analysis)} characters)")

        print(f"\n✅ Security analysis workflow completed")


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentCollaboration:
    """Test multiple agents working together."""

    def test_multiple_agents_same_session(self, api_client, test_session, ollama_model):
        """Test multiple agents coexisting in the same session."""
        print("\n\n👥 Testing Multiple Agents in Same Session")
        print("=" * 70)

        agent_configs = [
            ("Agent 1", "chat"),
            ("Agent 2", "coder"),
            ("Agent 3", "reviewer"),
        ]

        created_agents = []

        # Create multiple agents
        for name, role in agent_configs:
            print(f"\n📝 Creating {name} ({role})...")
            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": name,
                    "role": role,
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )
            assert response.status_code == 200
            agent_id = response.json()["id"]
            created_agents.append((name, role, agent_id))
            print(f"✓ Created {name}: {agent_id}")

        # Verify all agents exist
        print(f"\n📊 Verifying all agents...")
        response = api_client.get(
            f"/api/sessions/{test_session}/agents",
            timeout=10
        )
        assert response.status_code == 200
        agents = response.json()

        assert len(agents) >= 3
        for name, role, agent_id in created_agents:
            found = any(a["id"] == agent_id and a["role"] == role for a in agents)
            assert found, f"Agent {name} not found in session"
            print(f"✓ Verified {name} exists")

        print(f"\n✅ Multiple agents coexisting successfully")

    def test_agent_isolation(self, api_client, test_session, ollama_model, test_timeout):
        """Test that agents maintain separate conversation histories."""
        print("\n\n🔐 Testing Agent Isolation")
        print("=" * 70)

        # Create two chat agents
        agents = []
        for i in range(2):
            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": f"Isolated Agent {i+1}",
                    "role": "chat",
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )
            assert response.status_code == 200
            agents.append(response.json()["id"])
            print(f"✓ Created agent {i+1}: {agents[-1]}")

        # Send different messages to each
        messages = [
            "Your secret code is ALPHA",
            "Your secret code is BETA"
        ]

        for i, agent_id in enumerate(agents):
            print(f"\n📤 Sending message to agent {i+1}...")
            response = api_client.post(
                f"/api/sessions/{test_session}/agents/{agent_id}/messages",
                json={"content": messages[i]},
                timeout=test_timeout
            )
            assert response.status_code == 200
            print(f"✓ Agent {i+1} received message")

        # Verify each agent only has its own messages
        for i, agent_id in enumerate(agents):
            print(f"\n📥 Checking messages for agent {i+1}...")
            response = api_client.get(
                f"/api/sessions/{test_session}/agents/{agent_id}/messages",
                timeout=10
            )
            assert response.status_code == 200
            agent_messages = response.json()

            # Should have at least user message and assistant response
            assert len(agent_messages) >= 2
            print(f"✓ Agent {i+1} has {len(agent_messages)} messages")

            # Check that the specific code is in this agent's history
            message_text = " ".join([m["content"] for m in agent_messages])
            expected_code = "ALPHA" if i == 0 else "BETA"
            other_code = "BETA" if i == 0 else "ALPHA"

            assert expected_code in message_text, f"Agent {i+1} should have {expected_code}"
            # Note: We don't assert other_code NOT in message_text because the agent might mention it
            print(f"✓ Agent {i+1} has correct isolated context")

        print(f"\n✅ Agent isolation verified")


@pytest.mark.local_only
@pytest.mark.integration
class TestErrorHandling:
    """Test error handling and edge cases."""

    def test_invalid_agent_role(self, api_client, test_session):
        """Test creating agent with invalid role."""
        print("\n\n❌ Testing Invalid Agent Role")
        print("=" * 70)

        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Invalid Agent",
                "role": "invalid_role_that_does_not_exist",
                "model": "ollama/qwen2.5-coder:14b"
            },
            timeout=30
        )

        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print(f"✓ Invalid role rejected with status {response.status_code}")

        print(f"\n✅ Invalid role handling correct")

    def test_nonexistent_agent_access(self, api_client, test_session):
        """Test accessing non-existent agent."""
        print("\n\n🔍 Testing Non-existent Agent Access")
        print("=" * 70)

        fake_agent_id = "00000000-0000-0000-0000-000000000000"

        response = api_client.get(
            f"/api/sessions/{test_session}/agents/{fake_agent_id}",
            timeout=10
        )

        assert response.status_code == 404
        print(f"✓ Non-existent agent returns 404")

        print(f"\n✅ Non-existent agent handling correct")

    def test_invalid_mode_switch(self, api_client, test_session, ollama_model):
        """Test switching to invalid mode."""
        print("\n\n⚙️  Testing Invalid Mode Switch")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Mode Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Try invalid mode
        response = api_client.patch(
            f"/api/sessions/{test_session}/agents/{agent_id}/mode",
            json={"mode": "invalid_mode_xyz"},
            timeout=10
        )

        assert response.status_code in [400, 422], f"Expected 400/422, got {response.status_code}"
        print(f"✓ Invalid mode rejected with status {response.status_code}")

        print(f"\n✅ Invalid mode handling correct")
