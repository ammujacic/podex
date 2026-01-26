# Claude Code Bi-Directional Sync Design

**Date**: 2026-01-27
**Status**: Approved

## Overview

This design enables seamless bi-directional sync between local Claude Code sessions and Podex agents. Users can work in VS Code, Podex Web, or Podex Mobile interchangeably, with all changes syncing in real-time.

### Goals

1. When user selects a session, sync local Claude session to Podex agent
2. All commands sent to Claude include session ID to continue the same conversation
3. File watcher detects local changes and pushes updates to Podex
4. No duplicate messages - sync matches state 1:1 using UUID-based deduplication
5. Cross-device sync: VS Code → Podex Web → Podex Mobile seamlessly

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's Machine                               │
│  ┌──────────────┐    ┌─────────────────────────────────────────┐    │
│  │  Claude CLI  │    │              Local Pod                   │    │
│  │              │    │  ┌─────────────────────────────────┐    │    │
│  │  writes to   │    │  │  File Watcher (watchdog)        │    │    │
│  │      ↓       │    │  │  - monitors ~/.claude/projects  │    │    │
│  │  session.jsonl────────→ - debounces changes (500ms)    │    │    │
│  │              │    │  │  - extracts new messages        │    │    │
│  └──────────────┘    │  │  - tracks last sync UUID        │    │    │
│                      │  └──────────────┬──────────────────┘    │    │
│                      │                 │                        │    │
│                      │                 │ RPC: sync_claude_session│    │
│                      │                 ↓                        │    │
│                      │  ┌─────────────────────────────────┐    │    │
│                      │  │  Socket.IO Client               │    │    │
│                      │  └──────────────┬──────────────────┘    │    │
│                      └─────────────────┼────────────────────────┘    │
└────────────────────────────────────────┼────────────────────────────┘
                                         │
                                         │ WebSocket
                                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│                        Podex Backend                                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    Sync Handler                              │    │
│  │  - receives sync_claude_session RPC                         │    │
│  │  - deduplicates by UUID (idempotent)                        │    │
│  │  - updates agent messages in session store                  │    │
│  │  - broadcasts claude:session:sync to all clients            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│                              │ WebSocket broadcast                   │
│                              ↓                                       │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ↓                    ↓                    ↓
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │  Web UI  │        │ Mobile UI│        │ Other    │
    │          │        │          │        │ Clients  │
    └──────────┘        └──────────┘        └──────────┘
```

## Component Details

### 1. Local Pod File Watcher

**Location**: `services/local-pod/src/podex_local_pod/session_watcher.py`

**Responsibilities**:

- Monitor `~/.claude/projects/` for JSONL file changes
- Debounce rapid changes (500ms) to batch updates
- Track last synced UUID per session to detect new messages
- Push only new messages to backend via RPC

**Implementation**:

```python
# Key data structures
watched_sessions: dict[str, WatchedSession] = {}

class WatchedSession:
    session_id: str
    project_path: str
    last_synced_uuid: str | None
    last_sync_time: float
```

**Flow**:

1. watchdog detects JSONL file modification
2. Debounce timer starts (500ms)
3. After debounce, read JSONL file
4. Find messages after `last_synced_uuid`
5. Send new messages via `sync_claude_session` RPC
6. Update `last_synced_uuid` to latest message UUID

### 2. Backend Sync Handler

**Location**: `services/api/src/websocket/local_pod_hub.py`

**RPC Method**: `sync_claude_session`

**Request Payload**:

```python
{
    "session_id": str,           # Podex session ID
    "agent_id": str,             # Podex agent ID
    "claude_session_id": str,    # Claude Code session ID
    "project_path": str,
    "messages": [
        {
            "uuid": str,         # Claude's unique message ID
            "role": "user" | "assistant",
            "content": str,
            "timestamp": str,
            "tool_calls": list | None
        }
    ],
    "sync_type": "incremental" | "full"
}
```

**Deduplication Logic**:

```python
# Get existing message UUIDs for this agent
existing_uuids = {msg.uuid for msg in agent.messages}

# Filter to only new messages
new_messages = [
    msg for msg in incoming_messages
    if msg["uuid"] not in existing_uuids
]
```

**WebSocket Broadcast**:

```python
# Broadcast to all clients viewing this session
await sio.emit(
    "claude:session:sync",
    {
        "session_id": session_id,
        "agent_id": agent_id,
        "new_messages": new_messages,
        "total_count": len(agent.messages) + len(new_messages)
    },
    room=f"session:{session_id}"
)
```

### 3. Frontend Sync Hook

**Location**: `apps/web/src/hooks/useClaudeSessionSync.ts`

**Responsibilities**:

- Listen for `claude:session:sync` WebSocket events
- Deduplicate incoming messages client-side
- Update Zustand store with new messages

**Implementation**:

```typescript
export function useClaudeSessionSync(sessionId: string, agentId: string) {
  const socket = useSocket();
  const updateAgent = useSessionStore((state) => state.updateAgent);

  useEffect(() => {
    if (!socket) return;

    const handleSync = (data: ClaudeSyncEvent) => {
      if (data.session_id !== sessionId || data.agent_id !== agentId) return;

      updateAgent(sessionId, agentId, (agent) => {
        // Client-side deduplication by UUID
        const existingUuids = new Set(agent.messages.map((m) => m.id));
        const newMessages = data.new_messages
          .filter((m) => !existingUuids.has(m.uuid))
          .map(convertToAgentMessage);

        return {
          ...agent,
          messages: [...agent.messages, ...newMessages],
        };
      });
    };

    socket.on('claude:session:sync', handleSync);
    return () => socket.off('claude:session:sync', handleSync);
  }, [socket, sessionId, agentId]);
}
```

### 4. Command Sending with Session ID

**Current Flow** (already implemented):

1. User types message in Podex UI
2. Frontend sends command to backend
3. Backend sends to local-pod via RPC
4. Local-pod writes to Claude CLI via tmux

**Enhancement**:

- Include `--resume <session_id>` flag when sending to Claude CLI
- This ensures Claude continues the selected session

**Terminal Command Format**:

```bash
# When claudeSessionInfo is set:
claude --resume abc123-def456 "user message here"

# When no session selected:
claude "user message here"
```

### 5. Polling Fallback

**Trigger**: On WebSocket reconnection

**Purpose**: Catch any messages missed during disconnection

**Implementation**:

```typescript
// In useClaudeSessionSync hook
useEffect(() => {
  if (!socket) return;

  const handleReconnect = async () => {
    // Poll for current session state
    const currentState = await api.getClaudeSessionState(sessionId, agentId);

    // Reconcile with local state
    updateAgent(sessionId, agentId, (agent) => {
      const existingUuids = new Set(agent.messages.map((m) => m.id));
      const missingMessages = currentState.messages.filter((m) => !existingUuids.has(m.uuid));

      return {
        ...agent,
        messages: [...agent.messages, ...missingMessages],
      };
    });
  };

  socket.on('connect', handleReconnect);
  return () => socket.off('connect', handleReconnect);
}, [socket, sessionId, agentId]);
```

## Implementation Sequence

1. **Local Pod File Watcher** (`session_watcher.py`)
   - Add watchdog dependency
   - Implement `ClaudeSessionWatcher` class
   - Integrate with local-pod main loop

2. **Backend Sync Handler**
   - Add `sync_claude_session` RPC method
   - Implement UUID-based deduplication
   - Add WebSocket broadcast

3. **Frontend Sync Hook**
   - Create `useClaudeSessionSync` hook
   - Add client-side deduplication
   - Integrate with agent components

4. **Command Sending**
   - Update terminal manager to include `--resume` flag
   - Pass `claudeSessionId` through RPC chain

5. **Polling Fallback**
   - Add reconnection handler
   - Implement state reconciliation

## Error Handling

- **File watcher errors**: Log and continue, retry on next change
- **RPC failures**: Queue messages for retry (max 3 attempts)
- **Deduplication conflicts**: UUID is source of truth, skip duplicates silently
- **WebSocket disconnects**: Polling fallback catches missed messages

## Testing Strategy

1. **Unit tests**: Deduplication logic, message conversion
2. **Integration tests**: File watcher → backend → frontend flow
3. **E2E tests**: Multi-device sync scenarios
