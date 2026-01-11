"""Orchestrator agent for dynamically creating and coordinating other agents."""

from src.agents.base import BaseAgent, Tool


class OrchestratorAgent(BaseAgent):
    """Orchestrator agent that creates and coordinates other agents autonomously."""

    def _get_system_prompt(self) -> str:
        """Get orchestrator system prompt."""
        return """You are the OrchestratorAgent, a master coordinator responsible for
managing complex multi-agent workflows.

## Your Role
You analyze complex tasks, determine what specialized agents are needed,
delegate work to them, monitor progress, and synthesize final results.
You operate fully autonomously without requiring user approval for each step.

## Available Agent Roles
- **architect**: System design, API planning, breaking down complex requirements into subtasks
- **coder**: Writing and modifying code, implementing features
- **reviewer**: Code review, security analysis, best practices validation
- **tester**: Writing tests, test execution, quality assurance
- **agent_builder**: Creates new agent templates with specific capabilities
- **orchestrator**: Spawns another orchestrator for nested coordination
- **custom**: Create specialized agents when existing roles don't fit the task

## Workflow Strategy
1. **Analyze**: Understand the full scope of the request
2. **Plan**: Use create_execution_plan to design the workflow
3. **Delegate**: Assign tasks to appropriate agents using delegate_task
4. **Monitor**: Check task progress with get_task_status or wait_for_tasks
5. **Synthesize**: Combine results into a coherent response

## When to Create Custom Agents
Create custom agents when:
- The task requires specialized domain knowledge not covered by existing agents
- You need an agent with a specific combination of tools
- The task needs a unique system prompt for best results
- You need an agent that can delegate tasks to other agents (use delegation tools)

## Using Agent Builder
Delegate to agent_builder when you need to create persistent agent templates:
- Use for reusable agent configurations that should persist across sessions
- The agent_builder guides through template creation interactively

## Creating Agents with Delegation Powers
When creating custom agents, you can give them delegation abilities:
- Include 'create_task' to let them queue work for other agents
- Include 'delegate_task' to let them directly delegate to specific roles
- Include task monitoring tools for complex sub-workflows

## Task Delegation Guidelines
- Use HIGH priority for blocking/critical-path tasks
- Use MEDIUM priority for standard workflow tasks
- Use LOW priority for non-blocking enhancements
- Provide clear context to each agent about what's expected
- Chain dependent tasks sequentially (wait for architect before coder)
- Run independent tasks in parallel when possible

## Best Practices
- Always read relevant files first to understand the codebase context
- Break complex tasks into focused subtasks for each agent
- Monitor task completion and handle failures gracefully
- Provide clear, actionable descriptions when delegating
- Synthesize results to give user a complete picture"""

    def _get_tools(self) -> list[Tool]:
        """Get orchestrator tools."""
        return [
            # Planning tools
            Tool(
                name="create_execution_plan",
                description=(
                    "Create a detailed execution plan for a complex task. "
                    "Returns a structured plan with steps and confidence scores."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "task_description": {
                            "type": "string",
                            "description": "Description of the task to plan",
                        },
                        "context": {
                            "type": "string",
                            "description": (
                                "Additional context for planning (e.g., codebase info, constraints)"
                            ),
                        },
                    },
                    "required": ["task_description"],
                },
            ),
            # Task delegation tools
            Tool(
                name="delegate_task",
                description=(
                    "Delegate a task to a specific agent role. The task is "
                    "enqueued and processed asynchronously."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_role": {
                            "type": "string",
                            "enum": [
                                "architect",
                                "coder",
                                "reviewer",
                                "tester",
                                "agent_builder",
                                "orchestrator",
                            ],
                            "description": "Target agent role",
                        },
                        "description": {
                            "type": "string",
                            "description": "Clear task description with requirements",
                        },
                        "priority": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": "Task priority level",
                            "default": "medium",
                        },
                        "context": {
                            "type": "object",
                            "description": "Additional context data for the agent",
                        },
                    },
                    "required": ["agent_role", "description"],
                },
            ),
            # Custom agent creation
            Tool(
                name="create_custom_agent",
                description=(
                    "Create a specialized custom agent for unique tasks. "
                    "The agent exists for the session duration."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Descriptive name for the agent",
                        },
                        "system_prompt": {
                            "type": "string",
                            "description": "System prompt defining agent behavior and expertise",
                        },
                        "tools": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Tools to enable. File tools: read_file, write_file, "
                                "search_code, run_command, list_directory. "
                                "Delegation tools: create_task, delegate_task, "
                                "get_task_status, wait_for_tasks, get_all_pending_tasks. "
                                "Git tools: git_status, git_diff, git_commit, git_push, "
                                "git_branch, git_log."
                            ),
                        },
                        "model": {
                            "type": "string",
                            "description": "LLM model to use",
                            "default": "claude-sonnet-4-20250514",
                        },
                    },
                    "required": ["name", "system_prompt", "tools"],
                },
            ),
            # Delegate to custom agent
            Tool(
                name="delegate_to_custom_agent",
                description=(
                    "Send a task to a previously created custom agent and get the response."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "agent_id": {
                            "type": "string",
                            "description": (
                                "ID of the custom agent (returned from create_custom_agent)"
                            ),
                        },
                        "message": {
                            "type": "string",
                            "description": "Task message for the agent",
                        },
                    },
                    "required": ["agent_id", "message"],
                },
            ),
            # Task monitoring
            Tool(
                name="get_task_status",
                description="Get the current status and result of a delegated task.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "description": "Task ID to check",
                        },
                    },
                    "required": ["task_id"],
                },
            ),
            Tool(
                name="wait_for_tasks",
                description=(
                    "Wait for multiple tasks to complete. Returns when all tasks finish or timeout."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "task_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of task IDs to wait for",
                        },
                        "timeout_seconds": {
                            "type": "integer",
                            "description": "Maximum seconds to wait",
                            "default": 300,
                        },
                    },
                    "required": ["task_ids"],
                },
            ),
            Tool(
                name="get_all_pending_tasks",
                description="Get all pending and active tasks in the current session.",
                parameters={
                    "type": "object",
                    "properties": {},
                    "required": [],
                },
            ),
            # Result synthesis
            Tool(
                name="synthesize_results",
                description="Gather results from completed tasks for final synthesis.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Task IDs to gather results from",
                        },
                        "synthesis_instructions": {
                            "type": "string",
                            "description": "How to combine/summarize the results",
                        },
                    },
                    "required": ["task_ids"],
                },
            ),
            # Context gathering tools
            Tool(
                name="read_file",
                description="Read a file from the workspace to understand context.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "File path to read",
                        },
                    },
                    "required": ["path"],
                },
            ),
            Tool(
                name="search_code",
                description="Search for code patterns in the workspace.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query or pattern",
                        },
                        "file_pattern": {
                            "type": "string",
                            "description": "File pattern to filter (e.g., '*.py')",
                        },
                    },
                    "required": ["query"],
                },
            ),
            Tool(
                name="list_directory",
                description="List files in a directory to understand project structure.",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Directory path to list",
                        },
                    },
                    "required": ["path"],
                },
            ),
        ]
