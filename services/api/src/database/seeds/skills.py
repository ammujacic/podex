"""Default system skills seed data."""

DEFAULT_SYSTEM_SKILLS = [
    # 1. Bug Fix (from YAML)
    {
        "name": "Bug Fix",
        "slug": "bug_fix",
        "description": "Diagnose and fix a bug in the codebase",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["fix bug", "debug", "fix error", "resolve issue", "troubleshoot"],
        "tags": ["coder", "debugging", "fix"],
        "required_tools": ["search_code", "read_file", "write_file", "run_command"],
        "required_context": ["workspace_path", "error_message"],
        "steps": [
            {
                "name": "search_error",
                "description": "Search for error-related code",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "{{error_keyword}}",
                },
            },
            {
                "name": "read_context",
                "description": "Read surrounding code for context",
                "tool": "read_file",
                "parameters": {"file_path": "{{error_file}}"},
                "condition": "error_file != none",
            },
            {
                "name": "run_tests",
                "description": "Run tests to verify the fix",
                "tool": "run_command",
                "parameters": {"workspace_path": "{{workspace_path}}", "command": "npm test"},
                "on_failure": "analyze_failure",
            },
        ],
        "system_prompt": """You are debugging an issue. Follow a systematic approach:
1. Understand the error message and symptoms
2. Locate the source of the problem
3. Analyze the root cause
4. Implement a fix
5. Verify the fix works""",
        "examples": [
            {
                "input": "Fix the TypeError in login",
                "output": "Let me search for the login code and understand the type error...",
            },
            {
                "input": "Debug the null reference error",
                "output": "I'll trace the code path to find where the null reference occurs...",
            },
        ],
        "metadata": {
            "category": "maintenance",
            "estimated_duration": 300,
            "requires_approval": False,
        },
        "is_active": True,
        "is_default": True,
    },
    # 2. Code Review (from YAML)
    {
        "name": "Code Review",
        "slug": "code_review",
        "description": "Perform a comprehensive code review on changes",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "review",
            "code review",
            "check code",
            "review changes",
            "pull request review",
        ],
        "tags": ["reviewer", "code-quality", "git"],
        "required_tools": ["git_diff", "read_file", "search_code"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "get_diff",
                "description": "Get the current git diff",
                "tool": "git_diff",
                "parameters": {"workspace_path": "{{workspace_path}}"},
            },
            {
                "name": "analyze_changes",
                "description": "Analyze changed files for issues",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "TODO|FIXME|HACK|BUG",
                },
                "required": False,
            },
            {
                "name": "check_tests",
                "description": "Verify test files exist for changes",
                "tool": "list_directory",
                "parameters": {"path": "{{workspace_path}}/tests"},
                "condition": "has_tests == true",
                "required": False,
            },
        ],
        "system_prompt": """You are a senior code reviewer. Focus on:
- Code correctness and logic errors
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Test coverage""",
        "examples": [
            {
                "input": "Review the latest changes",
                "output": "I'll analyze the git diff and review the changes...",
            },
            {
                "input": "Check this pull request",
                "output": "Let me examine the changes in this PR...",
            },
        ],
        "metadata": {"category": "quality", "estimated_duration": 60, "requires_approval": False},
        "is_active": True,
        "is_default": True,
    },
    # 3. Project Setup (from YAML)
    {
        "name": "Project Setup",
        "slug": "project_setup",
        "description": "Set up a new project with standard structure and tooling",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "create project",
            "setup project",
            "initialize project",
            "new project",
            "scaffold",
        ],
        "tags": ["architect", "coder", "setup", "initialization"],
        "required_tools": ["write_file", "run_command", "list_directory"],
        "required_context": ["workspace_path", "project_name", "project_type"],
        "steps": [
            {
                "name": "create_structure",
                "description": "Create project directory structure",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "mkdir -p src tests docs",
                },
            },
            {
                "name": "init_git",
                "description": "Initialize git repository",
                "tool": "run_command",
                "parameters": {"workspace_path": "{{workspace_path}}", "command": "git init"},
            },
            {
                "name": "create_readme",
                "description": "Create README file",
                "tool": "write_file",
                "parameters": {
                    "file_path": "{{workspace_path}}/README.md",
                    "content": "# {{project_name}}\n\n## Getting Started\n\nTODO: Add instructions",
                },
            },
            {
                "name": "create_gitignore",
                "description": "Create .gitignore file",
                "tool": "write_file",
                "parameters": {
                    "file_path": "{{workspace_path}}/.gitignore",
                    "content": "node_modules/\n__pycache__/\n.env\ndist/\nbuild/\n*.pyc\ncoverage/",
                },
            },
        ],
        "system_prompt": """You are setting up a new project. Follow best practices.
Create a clean, well-organized structure.""",
        "examples": [
            {
                "input": "Create a new React project",
                "output": "I'll set up a React project with TypeScript, ESLint, and testing...",
            },
            {
                "input": "Initialize a Python package",
                "output": "Setting up a Python package with pyproject.toml, tests, and CI...",
            },
        ],
        "metadata": {"category": "setup", "estimated_duration": 120, "requires_approval": True},
        "is_active": True,
        "is_default": True,
    },
    # 4. Test Runner
    {
        "name": "Test Runner",
        "slug": "test_runner",
        "description": "Run test suites and analyze results for failures and coverage",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "run tests",
            "test",
            "check tests",
            "verify tests",
            "test suite",
            "run unit tests",
        ],
        "tags": ["testing", "qa", "verification"],
        "required_tools": ["run_command", "read_file", "search_code"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "detect_framework",
                "description": "Detect test framework from config files",
                "tool": "list_directory",
                "parameters": {"path": "{{workspace_path}}"},
            },
            {
                "name": "run_tests",
                "description": "Execute test suite",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{test_command}}",
                },
            },
            {
                "name": "analyze_failures",
                "description": "Analyze failed tests if any",
                "tool": "read_file",
                "parameters": {"file_path": "{{test_output}}"},
                "condition": "test_failed == true",
            },
        ],
        "system_prompt": """You are running tests and analyzing results. Focus on:
1. Identifying the correct test framework
2. Running all relevant tests
3. Analyzing failures and suggesting fixes
4. Reporting coverage metrics if available""",
        "examples": [
            {
                "input": "Run all tests",
                "output": "I'll detect the test framework and run the full suite...",
            },
            {
                "input": "Check why tests are failing",
                "output": "Let me run the tests and analyze the failures...",
            },
        ],
        "metadata": {"category": "testing", "estimated_duration": 120, "requires_approval": False},
        "is_active": True,
        "is_default": True,
    },
    # 5. Refactor
    {
        "name": "Refactor",
        "slug": "refactor",
        "description": "Refactor code for better quality, readability, and maintainability",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["refactor", "clean up code", "improve code", "restructure", "reorganize"],
        "tags": ["coder", "quality", "maintenance"],
        "required_tools": ["read_file", "write_file", "search_code", "run_command"],
        "required_context": ["workspace_path", "target_file"],
        "steps": [
            {
                "name": "read_code",
                "description": "Read the code to be refactored",
                "tool": "read_file",
                "parameters": {"file_path": "{{target_file}}"},
            },
            {
                "name": "find_usages",
                "description": "Find usages of code being refactored",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "{{search_pattern}}",
                },
            },
            {
                "name": "run_tests_before",
                "description": "Run tests before refactoring",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{test_command}}",
                },
            },
        ],
        "system_prompt": """You are refactoring code. Follow these principles:
1. Ensure tests pass before and after refactoring
2. Make small, incremental changes
3. Preserve existing behavior
4. Apply SOLID principles and clean code practices""",
        "examples": [
            {
                "input": "Refactor this function to be more readable",
                "output": "I'll analyze the function and apply clean code principles...",
            },
            {
                "input": "Extract common logic into a utility",
                "output": "Let me identify the common patterns and extract them...",
            },
        ],
        "metadata": {"category": "quality", "estimated_duration": 300, "requires_approval": True},
        "is_active": True,
        "is_default": True,
    },
    # 6. Documentation
    {
        "name": "Documentation",
        "slug": "documentation",
        "description": "Generate or update documentation for code and APIs",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["document", "add docs", "update docs", "generate documentation", "write docs"],
        "tags": ["documentation", "writer", "api"],
        "required_tools": ["read_file", "write_file", "search_code", "list_directory"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "scan_code",
                "description": "Scan code for undocumented functions and classes",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "def |class |function |export ",
                },
            },
            {
                "name": "read_readme",
                "description": "Read existing README if present",
                "tool": "read_file",
                "parameters": {"file_path": "{{workspace_path}}/README.md"},
                "required": False,
            },
            {
                "name": "generate_docs",
                "description": "Generate documentation",
                "tool": "write_file",
                "parameters": {"file_path": "{{doc_file}}", "content": "{{generated_docs}}"},
            },
        ],
        "system_prompt": """You are a technical writer. Focus on:
1. Clear and concise explanations
2. Code examples and usage patterns
3. API reference documentation
4. Installation and setup guides""",
        "examples": [
            {
                "input": "Add documentation to this module",
                "output": "I'll analyze the module and generate comprehensive docs...",
            },
            {
                "input": "Update the README",
                "output": "Let me review the project and update the README...",
            },
        ],
        "metadata": {
            "category": "documentation",
            "estimated_duration": 180,
            "requires_approval": False,
        },
        "is_active": True,
        "is_default": True,
    },
    # 7. Dependency Update
    {
        "name": "Dependency Update",
        "slug": "dependency_update",
        "description": "Update and audit dependencies for security and compatibility",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "update dependencies",
            "upgrade packages",
            "check outdated",
            "npm update",
            "pip update",
        ],
        "tags": ["maintenance", "security", "dependencies"],
        "required_tools": ["run_command", "read_file", "write_file"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "check_outdated",
                "description": "List outdated dependencies",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{outdated_command}}",
                },
            },
            {
                "name": "run_audit",
                "description": "Run security audit",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{audit_command}}",
                },
            },
            {
                "name": "update_deps",
                "description": "Update selected dependencies",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{update_command}}",
                },
            },
            {
                "name": "run_tests",
                "description": "Run tests after updates",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{test_command}}",
                },
            },
        ],
        "system_prompt": """You are updating dependencies. Follow these steps:
1. Identify outdated and vulnerable packages
2. Check for breaking changes in changelogs
3. Update incrementally, testing between updates
4. Fix any compatibility issues""",
        "examples": [
            {
                "input": "Update all dependencies",
                "output": "I'll check for outdated packages and update them safely...",
            },
            {
                "input": "Fix security vulnerabilities",
                "output": "Running security audit and updating vulnerable packages...",
            },
        ],
        "metadata": {
            "category": "maintenance",
            "estimated_duration": 300,
            "requires_approval": True,
        },
        "is_active": True,
        "is_default": True,
    },
    # 8. Security Scan
    {
        "name": "Security Scan",
        "slug": "security_scan",
        "description": "Run security analysis on codebase to identify vulnerabilities",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "security scan",
            "vulnerability check",
            "audit security",
            "find vulnerabilities",
            "security audit",
        ],
        "tags": ["security", "audit", "compliance"],
        "required_tools": ["run_command", "search_code", "read_file"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "check_dependencies",
                "description": "Audit dependencies for known vulnerabilities",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{audit_command}}",
                },
            },
            {
                "name": "scan_secrets",
                "description": "Search for hardcoded secrets and credentials",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "password|secret|api_key|token|credential",
                },
            },
            {
                "name": "check_permissions",
                "description": "Review file permissions",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "find . -type f -name '*.pem' -o -name '*.key'",
                },
            },
        ],
        "system_prompt": """You are a security analyst. Focus on:
1. Dependency vulnerabilities
2. Hardcoded secrets and credentials
3. SQL injection and XSS vulnerabilities
4. Insecure configurations
5. Sensitive data exposure""",
        "examples": [
            {
                "input": "Run a security scan",
                "output": "I'll audit dependencies and scan for common vulnerabilities...",
            },
            {
                "input": "Check for exposed secrets",
                "output": "Scanning the codebase for hardcoded credentials...",
            },
        ],
        "metadata": {"category": "security", "estimated_duration": 180, "requires_approval": True},
        "is_active": True,
        "is_default": True,
    },
    # 9. Performance Profile
    {
        "name": "Performance Profile",
        "slug": "performance_profile",
        "description": "Profile and optimize code performance",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "profile",
            "optimize performance",
            "speed up",
            "benchmark",
            "find bottlenecks",
        ],
        "tags": ["performance", "optimization", "profiling"],
        "required_tools": ["run_command", "read_file", "search_code"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "run_profiler",
                "description": "Run performance profiler",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{profile_command}}",
                },
            },
            {
                "name": "analyze_results",
                "description": "Analyze profiler output",
                "tool": "read_file",
                "parameters": {"file_path": "{{profile_output}}"},
            },
            {
                "name": "find_hotspots",
                "description": "Search for common performance issues",
                "tool": "search_code",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "pattern": "for.*for|while.*while|O\\(n\\^2\\)",
                },
            },
        ],
        "system_prompt": """You are optimizing performance. Focus on:
1. Identifying bottlenecks and hot paths
2. Analyzing time and space complexity
3. Caching and memoization opportunities
4. Database query optimization
5. Memory leak detection""",
        "examples": [
            {
                "input": "Profile this function",
                "output": "I'll run the profiler and identify bottlenecks...",
            },
            {
                "input": "Why is this slow?",
                "output": "Let me analyze the code and measure performance...",
            },
        ],
        "metadata": {
            "category": "performance",
            "estimated_duration": 240,
            "requires_approval": False,
        },
        "is_active": True,
        "is_default": True,
    },
    # 10. API Integration
    {
        "name": "API Integration",
        "slug": "api_integration",
        "description": "Connect to and integrate with external APIs",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["integrate api", "connect api", "add api", "api client", "external service"],
        "tags": ["api", "integration", "coder"],
        "required_tools": ["read_file", "write_file", "run_command", "web_fetch"],
        "required_context": ["workspace_path", "api_url"],
        "steps": [
            {
                "name": "fetch_docs",
                "description": "Fetch API documentation",
                "tool": "web_fetch",
                "parameters": {"url": "{{api_docs_url}}"},
                "required": False,
            },
            {
                "name": "create_client",
                "description": "Create API client code",
                "tool": "write_file",
                "parameters": {"file_path": "{{client_file}}", "content": "{{client_code}}"},
            },
            {
                "name": "add_types",
                "description": "Add type definitions",
                "tool": "write_file",
                "parameters": {"file_path": "{{types_file}}", "content": "{{type_definitions}}"},
            },
        ],
        "system_prompt": """You are integrating an external API. Focus on:
1. Understanding the API structure and authentication
2. Creating typed client code
3. Proper error handling
4. Rate limiting and retries
5. Testing the integration""",
        "examples": [
            {
                "input": "Integrate with the Stripe API",
                "output": "I'll set up the Stripe client with proper types and error handling...",
            },
            {
                "input": "Add a weather API",
                "output": "Creating a typed client for the weather API...",
            },
        ],
        "metadata": {
            "category": "integration",
            "estimated_duration": 300,
            "requires_approval": True,
        },
        "is_active": True,
        "is_default": True,
    },
    # 11. Database Migration
    {
        "name": "Database Migration",
        "slug": "database_migration",
        "description": "Run database migrations safely with rollback support",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "run migration",
            "migrate database",
            "db migration",
            "schema update",
            "alembic",
        ],
        "tags": ["database", "migration", "schema"],
        "required_tools": ["run_command", "read_file", "list_directory"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "check_status",
                "description": "Check current migration status",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{migration_status_command}}",
                },
            },
            {
                "name": "list_pending",
                "description": "List pending migrations",
                "tool": "list_directory",
                "parameters": {"path": "{{migrations_path}}"},
            },
            {
                "name": "run_migration",
                "description": "Run the migration",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{migration_command}}",
                },
            },
        ],
        "system_prompt": """You are running database migrations. Follow these safety steps:
1. Check current migration status
2. Review pending migrations
3. Backup data if needed
4. Run migrations in order
5. Verify schema changes""",
        "examples": [
            {
                "input": "Run database migrations",
                "output": "I'll check the status and run pending migrations...",
            },
            {
                "input": "Create a new migration",
                "output": "Generating a new migration file for the schema changes...",
            },
        ],
        "metadata": {"category": "database", "estimated_duration": 180, "requires_approval": True},
        "is_active": True,
        "is_default": True,
    },
    # 12. Git Workflow
    {
        "name": "Git Workflow",
        "slug": "git_workflow",
        "description": "Handle git operations including branching, merging, and PRs",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["git", "create branch", "merge", "pull request", "commit", "push"],
        "tags": ["git", "version-control", "collaboration"],
        "required_tools": ["run_command", "read_file"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "check_status",
                "description": "Check git status",
                "tool": "run_command",
                "parameters": {"workspace_path": "{{workspace_path}}", "command": "git status"},
            },
            {
                "name": "show_log",
                "description": "Show recent commits",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "git log --oneline -10",
                },
            },
            {
                "name": "show_diff",
                "description": "Show current changes",
                "tool": "run_command",
                "parameters": {"workspace_path": "{{workspace_path}}", "command": "git diff"},
            },
        ],
        "system_prompt": """You are managing git operations. Follow best practices:
1. Use meaningful commit messages
2. Keep commits atomic and focused
3. Follow branch naming conventions
4. Review changes before committing
5. Handle merge conflicts carefully""",
        "examples": [
            {
                "input": "Create a feature branch",
                "output": "I'll create a new branch from the main branch...",
            },
            {
                "input": "Prepare a pull request",
                "output": "Let me check the changes and prepare the PR...",
            },
        ],
        "metadata": {
            "category": "version-control",
            "estimated_duration": 60,
            "requires_approval": False,
        },
        "is_active": True,
        "is_default": True,
    },
    # 13. Deploy
    {
        "name": "Deploy",
        "slug": "deploy",
        "description": "Deploy application to staging or production environments",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["deploy", "release", "ship", "push to production", "deploy to staging"],
        "tags": ["deployment", "devops", "release"],
        "required_tools": ["run_command", "read_file"],
        "required_context": ["workspace_path", "environment"],
        "steps": [
            {
                "name": "run_tests",
                "description": "Run tests before deployment",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{test_command}}",
                },
            },
            {
                "name": "build",
                "description": "Build the application",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{build_command}}",
                },
            },
            {
                "name": "deploy",
                "description": "Deploy to target environment",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{deploy_command}}",
                },
            },
        ],
        "system_prompt": """You are deploying an application. Follow the deployment checklist:
1. Ensure all tests pass
2. Build the application
3. Check environment configuration
4. Deploy to target environment
5. Verify deployment success""",
        "examples": [
            {
                "input": "Deploy to staging",
                "output": "I'll run tests, build, and deploy to staging...",
            },
            {
                "input": "Ship to production",
                "output": "Running the full deployment pipeline to production...",
            },
        ],
        "metadata": {
            "category": "deployment",
            "estimated_duration": 600,
            "requires_approval": True,
        },
        "is_active": True,
        "is_default": True,
    },
    # 14. Rollback
    {
        "name": "Rollback",
        "slug": "rollback",
        "description": "Rollback deployments to a previous stable version",
        "version": "1.0.0",
        "author": "system",
        "triggers": ["rollback", "revert deployment", "undo release", "restore version"],
        "tags": ["deployment", "devops", "recovery"],
        "required_tools": ["run_command", "read_file"],
        "required_context": ["workspace_path", "environment"],
        "steps": [
            {
                "name": "list_versions",
                "description": "List available versions to rollback to",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{list_versions_command}}",
                },
            },
            {
                "name": "perform_rollback",
                "description": "Perform the rollback",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{rollback_command}}",
                },
            },
            {
                "name": "verify",
                "description": "Verify rollback success",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{health_check_command}}",
                },
            },
        ],
        "system_prompt": """You are rolling back a deployment. Follow these safety steps:
1. Identify the stable version to rollback to
2. Notify stakeholders
3. Perform the rollback
4. Verify application health
5. Document the incident""",
        "examples": [
            {
                "input": "Rollback to previous version",
                "output": "I'll identify the previous stable version and initiate rollback...",
            },
            {
                "input": "Revert the last deployment",
                "output": "Rolling back to the last known good deployment...",
            },
        ],
        "metadata": {
            "category": "deployment",
            "estimated_duration": 300,
            "requires_approval": True,
        },
        "is_active": True,
        "is_default": True,
    },
    # 15. Log Analysis
    {
        "name": "Log Analysis",
        "slug": "log_analysis",
        "description": "Analyze application logs to identify issues and patterns",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "analyze logs",
            "check logs",
            "find errors in logs",
            "log analysis",
            "debug logs",
        ],
        "tags": ["debugging", "monitoring", "analysis"],
        "required_tools": ["run_command", "read_file", "search_code"],
        "required_context": ["workspace_path", "log_path"],
        "steps": [
            {
                "name": "tail_logs",
                "description": "Get recent log entries",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "tail -n 100 {{log_path}}",
                },
            },
            {
                "name": "find_errors",
                "description": "Search for error patterns",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "grep -i 'error\\|exception\\|fail' {{log_path}} | tail -50",
                },
            },
            {
                "name": "analyze_patterns",
                "description": "Analyze error frequency",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "grep -i error {{log_path}} | sort | uniq -c | sort -rn | head -20",
                },
            },
        ],
        "system_prompt": """You are analyzing application logs. Focus on:
1. Error patterns and frequencies
2. Performance anomalies
3. Security-related events
4. Correlation between events
5. Root cause identification""",
        "examples": [
            {
                "input": "Analyze error logs",
                "output": "I'll search for errors and analyze the patterns...",
            },
            {
                "input": "Find the source of 500 errors",
                "output": "Searching logs for server error patterns...",
            },
        ],
        "metadata": {
            "category": "debugging",
            "estimated_duration": 120,
            "requires_approval": False,
        },
        "is_active": True,
        "is_default": True,
    },
    # 16. Environment Setup
    {
        "name": "Environment Setup",
        "slug": "environment_setup",
        "description": "Set up development environment with required tools and configurations",
        "version": "1.0.0",
        "author": "system",
        "triggers": [
            "setup environment",
            "dev setup",
            "install tools",
            "configure environment",
            "onboarding",
        ],
        "tags": ["setup", "environment", "development"],
        "required_tools": ["run_command", "write_file", "read_file"],
        "required_context": ["workspace_path"],
        "steps": [
            {
                "name": "check_requirements",
                "description": "Check for required tools",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "which node python docker git",
                },
            },
            {
                "name": "install_dependencies",
                "description": "Install project dependencies",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{install_command}}",
                },
            },
            {
                "name": "setup_env_file",
                "description": "Create environment file from template",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "cp .env.example .env",
                },
                "required": False,
            },
            {
                "name": "verify_setup",
                "description": "Verify environment is working",
                "tool": "run_command",
                "parameters": {
                    "workspace_path": "{{workspace_path}}",
                    "command": "{{verify_command}}",
                },
            },
        ],
        "system_prompt": """You are setting up a development environment. Ensure:
1. All required tools are installed
2. Dependencies are correctly installed
3. Environment variables are configured
4. The project can build and run
5. Tests can execute successfully""",
        "examples": [
            {
                "input": "Set up my dev environment",
                "output": "I'll check requirements and set up your development environment...",
            },
            {
                "input": "Help me get started with this project",
                "output": "Let me set up everything you need to start developing...",
            },
        ],
        "metadata": {"category": "setup", "estimated_duration": 300, "requires_approval": True},
        "is_active": True,
        "is_default": True,
    },
]
