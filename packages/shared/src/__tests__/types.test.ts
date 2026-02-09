import { describe, it, expect } from 'vitest';
import type {
  User,
  UserRole,
  Session as _Session,
  SessionStatus,
  WorkspaceStatus,
  AgentStatus,
  AgentColor,
  MessageRole,
  ToolCallStatus,
  LLMProvider,
  ModelTier,
  ThinkingStatus,
  AgentAttentionType,
  AgentAttentionPriority,
} from '../types';

describe('Type Definitions', () => {
  describe('User Types', () => {
    it('should define valid user roles', () => {
      const roles: UserRole[] = ['owner', 'admin', 'member', 'viewer'];
      expect(roles).toBeDefined();
    });

    it('should create a valid user object', () => {
      const user: User = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        provider: 'github',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(user.id).toBe('1');
      expect(user.role).toBe('admin');
    });
  });

  describe('Session Types', () => {
    it('should define valid session statuses', () => {
      const statuses: SessionStatus[] = ['active', 'paused', 'terminated'];
      expect(statuses.length).toBe(3);
    });

    it('should define valid workspace statuses', () => {
      const statuses: WorkspaceStatus[] = [
        'provisioning',
        'running',
        'paused',
        'terminated',
        'error',
      ];
      expect(statuses.length).toBe(5);
    });
  });

  describe('Agent Types', () => {
    it('should define valid agent statuses', () => {
      const statuses: AgentStatus[] = ['idle', 'thinking', 'executing', 'waiting', 'error'];
      expect(statuses.length).toBe(5);
    });

    it('should define valid agent colors', () => {
      const colors: AgentColor[] = ['cyan', 'purple', 'green', 'orange', 'pink', 'yellow'];
      expect(colors.length).toBe(6);
    });
  });

  describe('Message Types', () => {
    it('should define valid message roles', () => {
      const roles: MessageRole[] = ['user', 'assistant', 'system', 'tool'];
      expect(roles.length).toBe(4);
    });

    it('should define valid tool call statuses', () => {
      const statuses: ToolCallStatus[] = ['pending', 'running', 'completed', 'error'];
      expect(statuses.length).toBe(4);
    });
  });

  describe('LLM Provider Types', () => {
    it('should define valid LLM providers', () => {
      const providers: LLMProvider[] = [
        'podex',
        'anthropic',
        'openai',
        'google',
        'ollama',
        'lmstudio',
      ];
      expect(providers.length).toBe(6);
    });

    it('should define valid model tiers', () => {
      const tiers: ModelTier[] = ['flagship', 'balanced', 'fast'];
      expect(tiers.length).toBe(3);
    });

    it('should define valid thinking statuses', () => {
      const statuses: ThinkingStatus[] = ['available', 'coming_soon', 'not_supported'];
      expect(statuses.length).toBe(3);
    });
  });

  describe('Agent Attention Types', () => {
    it('should define valid attention types', () => {
      const types: AgentAttentionType[] = ['needs_approval', 'completed', 'error', 'waiting_input'];
      expect(types.length).toBe(4);
    });

    it('should define valid attention priorities', () => {
      const priorities: AgentAttentionPriority[] = ['low', 'medium', 'high', 'critical'];
      expect(priorities.length).toBe(4);
    });
  });
});
