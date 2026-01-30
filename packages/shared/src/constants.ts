// ==========================================
// Agent Roles
// ==========================================
// NOTE: Agent role configurations (name, description, color, features, etc.) are stored
// in the database and fetched via /api/agent-roles endpoint.
// Frontend should use useConfigStore().agentRoles to get the authoritative list.
//
// The type below provides TypeScript autocomplete for known built-in roles,
// but also accepts any string to support custom roles added via admin panel.

/**
 * Known built-in agent role identifiers (for TypeScript autocomplete).
 * The authoritative list comes from the database via /api/agent-roles.
 * Custom roles can be added through the admin panel.
 */
export type KnownAgentRole =
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'security'
  | 'devops'
  | 'orchestrator'
  | 'agent_builder'
  | 'documentator'
  | 'chat'
  | 'custom'
  | 'claude-code'
  | 'openai-codex'
  | 'gemini-cli';

/**
 * Agent role type - accepts known roles for autocomplete plus any custom string.
 */
export type AgentRole = KnownAgentRole | (string & {});

// ==========================================
// Attachment & Image Constants
// ==========================================

/**
 * Supported image types for vision models
 */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Maximum file size for attachments (20MB)
 */
export const MAX_ATTACHMENT_SIZE_MB = 20;
