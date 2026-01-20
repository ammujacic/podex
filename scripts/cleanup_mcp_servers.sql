-- Cleanup MCP servers that are no longer in the default catalog
-- Run this against your PostgreSQL database to remove obsolete MCP servers

-- 1. Delete filesystem MCP servers (no longer needed - native tools work directly)
DELETE FROM mcp_servers WHERE source_slug = 'filesystem';

-- 2. Delete git MCP servers (no longer needed - native tools work directly)
DELETE FROM mcp_servers WHERE source_slug = 'git';

-- 3. Disable podex-skills MCP servers (native agents use execute_skill tool instead)
-- We keep the records but disable them so users can re-enable if needed
UPDATE mcp_servers
SET is_enabled = false
WHERE source_slug = 'podex-skills';

-- 4. Verify the changes
SELECT source_slug, COUNT(*) as count,
       SUM(CASE WHEN is_enabled THEN 1 ELSE 0 END) as enabled_count
FROM mcp_servers
WHERE source_slug IN ('filesystem', 'git', 'podex-skills')
GROUP BY source_slug;

-- Show remaining MCP servers
SELECT source_slug, COUNT(*) as user_count
FROM mcp_servers
GROUP BY source_slug
ORDER BY user_count DESC;
