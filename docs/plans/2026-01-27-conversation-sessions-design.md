# Conversation Sessions Design

## Overview

Decouple conversation sessions from agent cards to enable:

- Portable conversations that can be attached to any agent card
- Agent type switching while preserving conversation context
- Session monitoring with metadata (name, time, message count)
- Cross-device sync via backend persistence

## Data Model

### Current (tightly coupled)

```
Session (workspace)
└── agents: Agent[]
    └── agent.messages: AgentMessage[]  ← messages live inside agent
```

### New (decoupled)

```
Session (workspace)
├── agents: Agent[]                      ← agent cards (no messages)
└── conversationSessions: ConversationSession[]  ← portable conversations
```

## Types

### ConversationSession

```typescript
interface ConversationSession {
  id: string;
  name: string; // derived from first message
  messages: AgentMessage[];
  createdAt: string; // ISO timestamp
  lastMessageAt: string;
  messageCount: number;
  attachedToAgentId: string | null;
}
```

### Agent (updated)

```typescript
interface Agent {
  id: string;
  name: string;
  role: AgentRole; // changeable via dropdown
  model: string;
  modelDisplayName?: string;
  status: 'idle' | 'active' | 'error';
  color: string;
  position?: AgentPosition;
  gridSpan?: GridSpan;
  mode: AgentMode;
  thinkingConfig?: ThinkingConfig;
  conversationSessionId: string | null; // reference to attached conversation
  // NO messages array
}
```

## UI Design

### Card Title Format

```
[Role]: [Session Name]
```

Examples:

- **Coder: Refactor API Layer**
- **Architect: Fix Auth Bug**
- **Reviewer** (no session attached)

### Header Layout

```
┌─────────────────────────────────────────────────────────┐
│ Coder: Refactor API Layer                    [...] [×] │
│ [Role ▼]  [Session ▼]  [Model: Claude Sonnet ▼]        │
└─────────────────────────────────────────────────────────┘
```

### Session Dropdown

```
┌─────────────────────────────────┐
│ ● Current: Fix auth bug  2h ago │
├─────────────────────────────────┤
│ Available Sessions:             │
│   Refactor API layer    1d ago  │
│   Add dark mode         3d ago  │
├─────────────────────────────────┤
│ + New Session                   │
└─────────────────────────────────┘
```

## Key Behaviors

| Behavior                   | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| **Exclusive attachment**   | A session can only be attached to one agent card at a time |
| **Auto-create**            | Sending first message auto-creates a new session           |
| **Keep on role change**    | Switching agent role keeps session attached                |
| **Session naming**         | Derived from first message (truncated to ~40 chars)        |
| **Detach returns to pool** | Detached sessions appear in dropdown for other cards       |

## Backend API

### Endpoints

```
GET    /api/sessions/{sessionId}/conversations
POST   /api/sessions/{sessionId}/conversations
GET    /api/sessions/{sessionId}/conversations/{convId}
PATCH  /api/sessions/{sessionId}/conversations/{convId}
DELETE /api/sessions/{sessionId}/conversations/{convId}
POST   /api/sessions/{sessionId}/conversations/{convId}/attach
POST   /api/sessions/{sessionId}/conversations/{convId}/detach
POST   /api/sessions/{sessionId}/conversations/{convId}/messages
```

### Database Schema

```sql
CREATE TABLE conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  attached_to_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  message_count INT DEFAULT 0
);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_session_id UUID NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  thinking TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  tool_calls JSONB,
  tool_results JSONB,
  stop_reason VARCHAR(50),
  usage JSONB,
  model VARCHAR(100)
);
```

### WebSocket Events

```typescript
socket.on('conversation_attached', { convId, agentId });
socket.on('conversation_detached', { convId });
socket.on('conversation_updated', { convId, updates });
socket.on('conversation_message', { convId, message });
```

## Implementation Order

1. Backend models & tables
2. Backend API endpoints
3. Frontend types
4. Frontend store
5. Frontend components (dropdowns, AgentCard header)
6. WebSocket sync
7. Legacy cleanup
