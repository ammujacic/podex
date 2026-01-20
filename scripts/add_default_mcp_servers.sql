-- Migration: Add default_mcp_servers table and seed data
-- This table stores the MCP server catalog (previously hardcoded in mcp_defaults.py)

-- Create the table
CREATE TABLE IF NOT EXISTS default_mcp_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(30) NOT NULL,  -- version_control, web, memory, monitoring, productivity
    transport VARCHAR(20) NOT NULL,  -- stdio, sse, http
    command TEXT,  -- For stdio transport
    args JSONB,
    url TEXT,  -- For sse/http transport
    env_vars JSONB,  -- Default env vars
    required_env JSONB,  -- Required env var names
    optional_env JSONB,  -- Optional env var names
    icon VARCHAR(50),
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    docs_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,  -- System servers can't be deleted
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on slug for fast lookups
CREATE INDEX IF NOT EXISTS ix_default_mcp_servers_slug ON default_mcp_servers(slug);

-- Insert default MCP servers
INSERT INTO default_mcp_servers (slug, name, description, category, transport, command, args, url, env_vars, required_env, optional_env, icon, is_builtin, docs_url, sort_order)
VALUES
    -- Version Control
    (
        'github',
        'GitHub',
        'GitHub API: issues, PRs, repos, actions, and code search',
        'version_control',
        'stdio',
        'npx',
        '[ "-y", "@modelcontextprotocol/server-github"]'::jsonb,
        NULL,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        'github',
        FALSE,
        'https://github.com/github/github-mcp-server',
        0
    ),
    -- Web
    (
        'fetch',
        'Web Fetch',
        'Fetch and parse web pages, APIs, and documentation',
        'web',
        'stdio',
        'npx',
        '["-y", "@modelcontextprotocol/server-fetch"]'::jsonb,
        NULL,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        'globe',
        FALSE,
        'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
        1
    ),
    (
        'puppeteer',
        'Puppeteer',
        'Browser automation, screenshots, and web scraping',
        'web',
        'stdio',
        'npx',
        '["-y", "@modelcontextprotocol/server-puppeteer"]'::jsonb,
        NULL,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        'chrome',
        FALSE,
        'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
        2
    ),
    -- Memory & AI
    (
        'memory',
        'Memory',
        'Persistent memory and knowledge graph for context retention',
        'memory',
        'stdio',
        'npx',
        '["-y", "@modelcontextprotocol/server-memory"]'::jsonb,
        NULL,
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        'brain',
        FALSE,
        'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
        3
    ),
    -- Productivity (Podex Skills)
    (
        'podex-skills',
        'Podex Skills',
        'Execute Podex skills as MCP tools (for external MCP clients)',
        'productivity',
        'http',
        NULL,
        NULL,
        'http://agent:3002/mcp/skills',
        '{}'::jsonb,
        '[]'::jsonb,
        NULL,
        'sparkles',
        FALSE,
        'https://docs.podex.ai/skills',
        4
    ),
    -- Monitoring
    (
        'sentry',
        'Sentry',
        'Error tracking and performance monitoring via Sentry API',
        'monitoring',
        'stdio',
        'npx',
        '["-y", "@sentry/mcp-server@latest"]'::jsonb,
        NULL,
        '{}'::jsonb,
        '["SENTRY_ACCESS_TOKEN"]'::jsonb,
        '["SENTRY_HOST"]'::jsonb,
        'sentry',
        FALSE,
        'https://docs.sentry.io/product/sentry-mcp/',
        5
    )
ON CONFLICT (slug) DO NOTHING;

-- Verify the data was inserted
SELECT slug, name, category, transport FROM default_mcp_servers ORDER BY sort_order;
