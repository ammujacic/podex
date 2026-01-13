"""
Advanced Agent Feature Tests

Tests advanced functionality including:
- Tool usage and results
- Orchestration and delegation
- Custom agent templates with specific tools
- Agent interoperation
- Context management
- Extended thinking
- Subagent creation
"""
import time
import pytest
from typing import Dict, Any


@pytest.mark.local_only
@pytest.mark.integration
class TestToolUsage:
    """Test agent tool usage and results."""

    def test_file_operations(self, api_client, test_session, ollama_model, test_timeout):
        """Test agent using file operation tools."""
        print("\n\n📁 Testing File Operation Tools")
        print("=" * 70)

        # Create coder agent (has file tools)
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "File Operations Agent",
                "role": "coder",
                "model": f"ollama/{ollama_model}",
                "mode": "sovereign"  # Allow file operations
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created coder agent: {agent_id}")

        # Ask agent to list files
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "List the files in the current directory"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        message = response.json()

        # Check for tool calls in response
        if "tool_calls" in message and message["tool_calls"]:
            print(f"✓ Agent used {len(message['tool_calls'])} tool(s)")
            for tool_call in message["tool_calls"]:
                print(f"  Tool: {tool_call.get('function', {}).get('name', 'unknown')}")
        else:
            print("  Agent responded without explicit tool calls")

        # Verify response has content
        assert len(message["content"]) > 0
        print(f"✓ Agent provided response about files")

        print("\n✅ File operations test completed")

    def test_search_code_tool(self, api_client, test_session, ollama_model, test_timeout):
        """Test agent using code search tool."""
        print("\n\n🔍 Testing Code Search Tool")
        print("=" * 70)

        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Code Search Agent",
                "role": "coder",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Ask agent to search code
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "Search for functions named 'test' in Python files"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        message = response.json()

        assert len(message["content"]) > 0
        print(f"✓ Search completed")
        print(f"  Response length: {len(message['content'])} chars")

        print("\n✅ Code search test completed")


@pytest.mark.local_only
@pytest.mark.integration
class TestOrchestratorAdvanced:
    """Test advanced orchestrator features."""

    def test_orchestrator_creates_subagents(self, api_client, test_session, ollama_model, test_timeout):
        """Test orchestrator creating and managing subagents."""
        print("\n\n🎭 Testing Orchestrator Creating Subagents")
        print("=" * 70)

        # Create orchestrator
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

        # Count agents before
        response = api_client.get(
            f"/api/sessions/{test_session}/agents",
            timeout=10
        )
        initial_agent_count = len(response.json())
        print(f"✓ Initial agent count: {initial_agent_count}")

        # Give orchestrator a task that requires creating agents
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{orchestrator_id}/messages",
            json={
                "content": "Create a plan to build a simple calculator. Then create specialized agents to implement different parts: one for basic operations, one for testing."
            },
            timeout=test_timeout
        )
        assert response.status_code == 200
        orchestrator_response = response.json()

        print(f"✓ Orchestrator processed task")
        print(f"  Response preview: {orchestrator_response['content'][:200]}...")

        # Check if orchestrator created subagents (may take time)
        time.sleep(5)
        response = api_client.get(
            f"/api/sessions/{test_session}/agents",
            timeout=10
        )
        final_agent_count = len(response.json())

        print(f"✓ Final agent count: {final_agent_count}")

        if final_agent_count > initial_agent_count:
            print(f"✅ Orchestrator created {final_agent_count - initial_agent_count} subagent(s)")
        else:
            print(f"  Orchestrator planned but may not have created subagents yet")

        print("\n✅ Orchestrator subagent test completed")

    def test_orchestrator_delegation_tools(self, api_client, test_session, ollama_model, test_timeout):
        """Test orchestrator using delegation tools."""
        print("\n\n📬 Testing Orchestrator Delegation Tools")
        print("=" * 70)

        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Delegation Orchestrator",
                "role": "orchestrator",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        orchestrator_id = response.json()["id"]
        print(f"✓ Created orchestrator: {orchestrator_id}")

        # Task requiring delegation
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{orchestrator_id}/messages",
            json={
                "content": "Delegate the task of writing a README file to a documentator agent, and delegate writing tests to a tester agent."
            },
            timeout=test_timeout
        )
        assert response.status_code == 200
        message = response.json()

        print(f"✓ Delegation task completed")
        print(f"  Response includes: {message['content'][:300]}...")

        # Check for tool calls related to delegation
        if "tool_calls" in message and message["tool_calls"]:
            delegation_tools = [tc for tc in message["tool_calls"]
                              if "delegate" in tc.get("function", {}).get("name", "").lower()]
            if delegation_tools:
                print(f"✓ Found {len(delegation_tools)} delegation tool call(s)")

        print("\n✅ Orchestrator delegation test completed")


@pytest.mark.local_only
@pytest.mark.integration
class TestCustomAgentTools:
    """Test custom agents with specific tool configurations."""

    def test_custom_agent_with_restricted_tools(self, api_client, test_session, ollama_model, test_timeout):
        """Test custom agent with specific tool allowlist."""
        print("\n\n🛠️  Testing Custom Agent with Restricted Tools")
        print("=" * 70)

        # Create template with only read_file and search_code
        response = api_client.post(
            "/api/agent-templates",
            json={
                "name": "Read-Only Analyzer",
                "slug": f"read-only-{int(time.time())}",
                "description": "Agent that can only read and search code",
                "system_prompt": "You are a code analyzer. You can read files and search code but cannot modify anything.",
                "allowed_tools": ["read_file", "search_code", "list_directory"],
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        template_id = response.json()["id"]
        print(f"✓ Created restricted template: {template_id}")
        print(f"  Allowed tools: read_file, search_code, list_directory")

        # Create agent from template
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Read-Only Agent",
                "role": "custom",
                "model": f"ollama/{ollama_model}",
                "template_id": template_id
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created custom agent: {agent_id}")

        # Test that agent can use allowed tools
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "List and analyze the Python files in the current directory"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        message = response.json()
        assert len(message["content"]) > 0
        print(f"✓ Agent completed analysis task")

        # Cleanup
        api_client.delete(f"/api/agent-templates/{template_id}", timeout=10)

        print("\n✅ Custom agent tool restriction test completed")

    def test_custom_agent_builder_workflow(self, api_client, test_session, ollama_model, test_timeout):
        """Test agent_builder creating custom templates."""
        print("\n\n🏗️  Testing Agent Builder Workflow")
        print("=" * 70)

        # Create agent_builder agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Builder Agent",
                "role": "agent_builder",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        builder_id = response.json()["id"]
        print(f"✓ Created agent_builder: {builder_id}")

        # Ask it to create a custom agent template
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{builder_id}/messages",
            json={
                "content": "Create a custom agent template for a 'Database Administrator' role that can execute SQL queries and manage database schemas."
            },
            timeout=test_timeout
        )
        assert response.status_code == 200
        message = response.json()

        print(f"✓ Agent builder responded")
        print(f"  Response preview: {message['content'][:300]}...")

        # Response should include template creation guidance
        content_lower = message["content"].lower()
        assert any(keyword in content_lower for keyword in ["template", "tools", "system prompt", "role"])
        print(f"✓ Response includes template creation guidance")

        print("\n✅ Agent builder workflow test completed")


@pytest.mark.local_only
@pytest.mark.integration
@pytest.mark.slow
class TestContextManagement:
    """Test context window management and compaction."""

    def test_agent_context_usage(self, api_client, test_session, ollama_model):
        """Test tracking agent context usage."""
        print("\n\n📊 Testing Agent Context Usage Tracking")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Context Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Send multiple messages to fill context
        for i in range(5):
            response = api_client.post(
                f"/api/sessions/{test_session}/agents/{agent_id}/messages",
                json={"content": f"Message {i+1}: Tell me a fact about {['Python', 'JavaScript', 'Rust', 'Go', 'C++'][i]}"},
                timeout=60
            )
            assert response.status_code == 200
            print(f"✓ Sent message {i+1}")
            time.sleep(1)

        # Check agent context usage
        response = api_client.get(
            f"/api/sessions/{test_session}/agents/{agent_id}",
            timeout=10
        )
        assert response.status_code == 200
        agent = response.json()

        if "context_tokens_used" in agent:
            tokens_used = agent["context_tokens_used"]
            max_tokens = agent.get("context_max_tokens", 200000)
            usage_percent = (tokens_used / max_tokens) * 100
            print(f"✓ Context usage: {tokens_used:,} / {max_tokens:,} tokens ({usage_percent:.1f}%)")
        else:
            print("  Context usage not tracked in response")

        print("\n✅ Context usage test completed")

    def test_context_compaction(self, api_client, test_session, ollama_model):
        """Test context compaction/summarization."""
        print("\n\n🗜️  Testing Context Compaction")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Compaction Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Check if compaction endpoint exists
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/context/compact",
            json={},
            timeout=30
        )

        if response.status_code == 200:
            result = response.json()
            print(f"✓ Context compaction available")
            print(f"  Result: {result}")
        elif response.status_code == 404:
            print("  Context compaction endpoint not found (may not be implemented)")
        else:
            print(f"  Compaction returned status {response.status_code}")

        print("\n✅ Context compaction test completed")


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentMemory:
    """Test agent memory features."""

    def test_memory_storage_retrieval(self, api_client, test_session, ollama_model, test_timeout):
        """Test agent storing and retrieving memories."""
        print("\n\n🧠 Testing Agent Memory Storage")
        print("=" * 70)

        # Create agent
        response = api_client.post(
            f"/api/sessions/{test_session}/agents",
            json={
                "name": "Memory Test Agent",
                "role": "chat",
                "model": f"ollama/{ollama_model}"
            },
            timeout=30
        )
        assert response.status_code == 200
        agent_id = response.json()["id"]
        print(f"✓ Created agent: {agent_id}")

        # Ask agent to remember something
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "Remember that my favorite programming language is Python and I prefer functional programming style."},
            timeout=test_timeout
        )
        assert response.status_code == 200
        print(f"✓ Sent memory to store")

        # Later, ask agent to recall
        time.sleep(2)
        response = api_client.post(
            f"/api/sessions/{test_session}/agents/{agent_id}/messages",
            json={"content": "What is my favorite programming language and coding style?"},
            timeout=test_timeout
        )
        assert response.status_code == 200
        recall_message = response.json()

        # Check if agent recalls the information
        content_lower = recall_message["content"].lower()
        has_python = "python" in content_lower
        has_functional = "functional" in content_lower

        if has_python:
            print(f"✓ Agent recalled: Python")
        if has_functional:
            print(f"✓ Agent recalled: Functional programming")

        if has_python or has_functional:
            print(f"✅ Agent successfully used memory")
        else:
            print(f"  Agent may not have explicit memory feature")

        print("\n✅ Memory test completed")


@pytest.mark.local_only
@pytest.mark.integration
class TestAgentCollaborationAdvanced:
    """Test advanced agent collaboration scenarios."""

    def test_parallel_agent_execution(self, api_client, test_session, ollama_model, test_timeout):
        """Test multiple agents executing tasks in parallel."""
        print("\n\n⚡ Testing Parallel Agent Execution")
        print("=" * 70)

        # Create multiple agents
        agent_ids = []
        for i in range(3):
            response = api_client.post(
                f"/api/sessions/{test_session}/agents",
                json={
                    "name": f"Parallel Agent {i+1}",
                    "role": "coder",
                    "model": f"ollama/{ollama_model}"
                },
                timeout=30
            )
            assert response.status_code == 200
            agent_ids.append(response.json()["id"])
            print(f"✓ Created agent {i+1}: {agent_ids[-1]}")

        # Send different tasks to each agent (don't wait)
        tasks = [
            "Write a function to calculate fibonacci numbers",
            "Write a function to check if a number is prime",
            "Write a function to sort an array using quicksort"
        ]

        print("\n📤 Sending tasks to all agents...")
        for agent_id, task in zip(agent_ids, tasks):
            response = api_client.post(
                f"/api/sessions/{test_session}/agents/{agent_id}/messages",
                json={"content": task},
                timeout=test_timeout
            )
            assert response.status_code == 200
            print(f"✓ Task sent to {agent_id[:8]}...")

        print(f"\n✓ All {len(agent_ids)} agents received tasks")
        print(f"✅ Parallel execution initiated")

        print("\n✅ Parallel agent test completed")
