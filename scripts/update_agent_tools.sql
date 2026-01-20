-- Update agent role tools in the database
-- Run this against your PostgreSQL database to update tools without reseeding

-- Architect: Add get_skill and get_skill_stats
UPDATE agent_role_configs SET tools = '[
    "read_file", "list_directory", "search_code", "glob_files", "grep",
    "create_task", "delegate_task",
    "store_memory", "recall_memory",
    "list_skills", "get_skill", "match_skills", "recommend_skills", "get_skill_stats",
    "fetch_url", "search_web"
]'::jsonb WHERE role = 'architect';

-- Coder: Add get_skill, create_skill, delete_skill, design_to_code
UPDATE agent_role_configs SET tools = '[
    "read_file", "write_file", "list_directory", "search_code", "glob_files", "grep", "apply_patch",
    "run_command",
    "git_status", "git_diff", "git_commit", "git_branch", "git_log", "create_pr",
    "store_memory", "recall_memory",
    "list_skills", "get_skill", "match_skills", "execute_skill", "create_skill", "delete_skill",
    "design_to_code"
]'::jsonb WHERE role = 'coder';

-- Reviewer: No changes needed
UPDATE agent_role_configs SET tools = '[
    "read_file", "list_directory", "search_code", "glob_files", "grep",
    "git_status", "git_diff", "git_log",
    "store_memory", "recall_memory"
]'::jsonb WHERE role = 'reviewer';

-- Tester: Add browser/vision tools for e2e testing
UPDATE agent_role_configs SET tools = '[
    "read_file", "write_file", "list_directory", "search_code", "glob_files", "grep",
    "run_command",
    "git_status", "git_diff",
    "store_memory", "recall_memory",
    "deploy_preview", "run_e2e_tests", "get_preview_status", "check_deployment_health",
    "screenshot_page", "interact_with_page", "extract_page_data", "analyze_screenshot"
]'::jsonb WHERE role = 'tester';

-- Security: No changes needed
UPDATE agent_role_configs SET tools = '[
    "read_file", "list_directory", "search_code", "glob_files", "grep",
    "git_status", "git_diff", "git_log",
    "store_memory", "recall_memory",
    "fetch_url", "search_web"
]'::jsonb WHERE role = 'security';

-- DevOps: Add get_skill, create_skill, delete_skill
UPDATE agent_role_configs SET tools = '[
    "read_file", "write_file", "list_directory", "search_code", "glob_files", "grep", "apply_patch",
    "run_command",
    "git_status", "git_diff", "git_commit", "git_push", "git_branch", "git_log", "create_pr",
    "deploy_preview", "get_preview_status", "stop_preview", "run_e2e_tests", "rollback_deploy",
    "check_deployment_health", "wait_for_deployment", "list_previews", "get_preview_logs",
    "store_memory", "recall_memory",
    "list_skills", "get_skill", "execute_skill", "create_skill", "delete_skill"
]'::jsonb WHERE role = 'devops';

-- Orchestrator: Add get_skill, get_skill_stats
UPDATE agent_role_configs SET tools = '[
    "read_file", "list_directory", "search_code", "glob_files", "grep",
    "git_status", "git_diff", "git_log",
    "create_execution_plan", "delegate_task", "create_custom_agent", "delegate_to_custom_agent",
    "get_task_status", "wait_for_tasks", "get_all_pending_tasks", "synthesize_results", "create_task",
    "store_memory", "recall_memory",
    "list_skills", "get_skill", "match_skills", "execute_skill", "recommend_skills", "get_skill_stats"
]'::jsonb WHERE role = 'orchestrator';

-- Documentator: No changes needed
UPDATE agent_role_configs SET tools = '[
    "read_file", "write_file", "list_directory", "search_code", "glob_files", "grep",
    "git_status", "git_log",
    "store_memory", "recall_memory",
    "fetch_url", "search_web"
]'::jsonb WHERE role = 'documentator';

-- Custom: No changes needed
UPDATE agent_role_configs SET tools = '[
    "read_file", "write_file", "list_directory", "search_code", "glob_files", "grep", "apply_patch",
    "run_command",
    "git_status", "git_diff", "git_commit", "git_branch", "git_log",
    "store_memory", "recall_memory",
    "fetch_url"
]'::jsonb WHERE role = 'custom';

-- Verify the updates
SELECT role, jsonb_array_length(tools) as tool_count
FROM agent_role_configs
WHERE role IN ('architect', 'coder', 'reviewer', 'tester', 'security', 'devops', 'orchestrator', 'documentator', 'custom')
ORDER BY tool_count DESC;
