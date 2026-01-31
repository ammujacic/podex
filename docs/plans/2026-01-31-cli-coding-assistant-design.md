# Podex CLI Coding Assistant Design

**Date:** 2026-01-31
**Status:** Draft
**Author:** Brainstorming session

## Overview

This document explores the design for a terminal-based CLI coding assistant for Podex. The CLI would provide a graphical terminal interface for AI-powered development, similar to tools like Claude Code, Aider, or Gemini CLI, but integrated with Podex's cloud and local pod infrastructure.

### Goals

- Native terminal experience with rich UI (colors, panels, streaming)
- Full agent interaction (chat, approvals, streaming responses, tool calls)
- Integration with Podex cloud API and local pods
- Works on any repository (local or cloud workspace)
- Competitive feature set with Claude Code, Aider, Cline
- Maximum code reuse with existing services

### Non-Goals (for MVP)

- Replacing the web app (complementary interface)
- Full IDE features (delegate to VSCode extension for that)
- Offline mode (requires API connection)

---

## Market Analysis

### Existing CLI Coding Agents (2026)

| Tool            | Stars | Language   | Backend       | Key Features                            |
| --------------- | ----- | ---------- | ------------- | --------------------------------------- |
| **Cline**       | 48K+  | TypeScript | Multi-model   | Plan/Act modes, MCP, VSCode integration |
| **Claude Code** | 27K   | TypeScript | Claude only   | Native Anthropic tool, hooks, skills    |
| **Aider**       | 12.9K | Python     | Multi-model   | Git integration, auto-commits           |
| **Gemini CLI**  | 15K+  | TypeScript | Gemini        | 1M token context, Google Search         |
| **OpenCode**    | 8K    | TypeScript | 75+ providers | Client/server, Docker workspaces        |
| **Plandex**     | 10K   | Go         | Multi-model   | Tree-sitter maps, 20M token context     |
| **Goose**       | 5K    | Python     | Multi-model   | Block/Square, extensible agents         |

### Key Differentiators for Podex CLI

1. **Hybrid Cloud/Local** - Seamlessly switch between cloud pods and local execution
2. **Multi-Agent Grid** - Run multiple agents in parallel (unique to Podex)
3. **Shared Sessions** - Collaborate with team members on the same session
4. **Enterprise Ready** - SSO, billing, team management built-in
5. **Tool Marketplace** - Access to curated tool configurations

---

## Framework Options

### Option A: TypeScript + Ink (Recommended)

**Ink** is React for the terminal, enabling a component-based approach.

```
┌─────────────────────────────────────────────────────────────────┐
│  Podex CLI built with Ink                                        │
├─────────────────────────────────────────────────────────────────┤
│  Pros:                                                           │
│  • React mental model (familiar to web team)                    │
│  • Share code with @podex/ui (same patterns)                    │
│  • npm ecosystem (socket.io-client, etc.)                       │
│  • TypeScript + strong typing                                   │
│  • Used by Vercel, Gatsby, Jest                                 │
│  • Claude Code is built this way                                │
│                                                                  │
│  Cons:                                                           │
│  • Node.js runtime required                                     │
│  • Larger binary size (~50MB bundled)                           │
│  • Limited terminal widget set                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Dependencies:**

- `ink` - React for CLI
- `@inkjs/ui` - Pre-built components (Spinner, TextInput, Select)
- `zustand` - State management (reuse from @podex/stores pattern)
- `socket.io-client` - Real-time communication
- `marked` / `marked-terminal` - Markdown rendering
- `cli-highlight` - Syntax highlighting
- `xterm.js` (via node-pty) - Full terminal emulation if needed

### Option B: Go + Charmbracelet

**Bubble Tea** is the leading Go TUI framework from Charm.

```
┌─────────────────────────────────────────────────────────────────┐
│  Podex CLI built with Bubble Tea                                 │
├─────────────────────────────────────────────────────────────────┤
│  Pros:                                                           │
│  • Single binary distribution (no runtime)                      │
│  • ~10MB binary size                                            │
│  • Fast startup time                                            │
│  • Beautiful defaults (Lip Gloss styling)                       │
│  • Used by GitHub CLI, k9s, lazygit                             │
│                                                                  │
│  Cons:                                                           │
│  • Different language from web stack                            │
│  • Can't share code with apps/web                               │
│  • Elm architecture (different mental model)                    │
│  • Need to reimplement API client                               │
└─────────────────────────────────────────────────────────────────┘
```

**Libraries:**

- `bubbletea` - TUI framework
- `bubbles` - Common components
- `lipgloss` - Styling
- `glamour` - Markdown rendering
- `chroma` - Syntax highlighting

### Option C: Python + Textual

**Textual** is a modern Python TUI framework by the Rich team.

```
┌─────────────────────────────────────────────────────────────────┐
│  Podex CLI built with Textual                                    │
├─────────────────────────────────────────────────────────────────┤
│  Pros:                                                           │
│  • Same language as services/agent                              │
│  • Can share code with podex-local-pod                          │
│  • CSS-based styling (familiar)                                 │
│  • Rich widget library                                          │
│  • pip install distribution                                     │
│                                                                  │
│  Cons:                                                           │
│  • Python runtime required                                      │
│  • Async complexity                                             │
│  • Less portable than Go                                        │
│  • Different patterns from web team                             │
└─────────────────────────────────────────────────────────────────┘
```

**Libraries:**

- `textual` - TUI framework
- `rich` - Rich text rendering
- `python-socketio` - Socket.IO client
- `httpx` - HTTP client
- `typer` / `click` - CLI argument parsing

### Recommendation: TypeScript + Ink

Given Podex's monorepo structure and the goal of code reuse with `apps/web`:

1. **Code Sharing** - Can reuse `@podex/api-client` and patterns from `@podex/stores`
2. **Team Familiarity** - Web team already knows React/TypeScript
3. **Industry Proven** - Claude Code, Gemini CLI use similar stacks
4. **Ecosystem** - npm has mature Socket.IO, markdown, and syntax highlighting libraries

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Terminal                                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ podex                                                       │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ Session: my-project  │ Agent: Coder  │ Cloud Pod     │   │ │
│  │ ├──────────────────────────────────────────────────────┤   │ │
│  │ │                                                       │   │ │
│  │ │ > Add a user authentication system with JWT          │   │ │
│  │ │                                                       │   │ │
│  │ │ ┌─────────────────────────────────────────────────┐  │   │ │
│  │ │ │ 🤖 Coder                                         │  │   │ │
│  │ │ │ I'll help you implement JWT authentication.      │  │   │ │
│  │ │ │                                                   │  │   │ │
│  │ │ │ Let me start by examining the current auth...   │  │   │ │
│  │ │ │ ████████░░░░░░░░░░                              │  │   │ │
│  │ │ └─────────────────────────────────────────────────┘  │   │ │
│  │ │                                                       │   │ │
│  │ │ [Tool Call] Read: src/auth/handler.ts                │   │ │
│  │ │ [Tool Call] Edit: src/auth/jwt.ts                    │   │ │
│  │ │                                                       │   │ │
│  │ │ ┌─────────────────────────────────────────────────┐  │   │ │
│  │ │ │ ⚠️  Approval Required                            │  │   │ │
│  │ │ │ Agent wants to run: npm install jsonwebtoken    │  │   │ │
│  │ │ │                                                   │  │   │ │
│  │ │ │ [Y] Approve  [N] Deny  [A] Always Allow          │  │   │ │
│  │ │ └─────────────────────────────────────────────────┘  │   │ │
│  │ │                                                       │   │ │
│  │ ├──────────────────────────────────────────────────────┤   │ │
│  │ │ > _                                                   │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Socket.IO + REST
                              ▼
                    ┌─────────────────────┐
                    │   Podex Cloud API   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              ▼                                  ▼
     ┌─────────────────┐                ┌─────────────────┐
     │   Cloud Pod     │                │   Local Pod     │
     │  (default)      │                │  (--local flag) │
     └─────────────────┘                └─────────────────┘
```

---

## Monorepo Structure

### Proposed Addition

```
podex/
├── apps/
│   ├── web/                    # Next.js frontend
│   ├── vscode/                 # VSCode extension
│   └── cli/                    # NEW: Terminal CLI
│
├── packages/
│   ├── api-client/             # REST + Socket.IO client (shared)
│   ├── stores/                 # Zustand state patterns (shared)
│   └── ui/                     # Web components (web/vscode only)
│
├── services/
│   ├── api/
│   ├── compute/
│   ├── agent/
│   └── local-pod/
│
└── turbo.json
```

---

## CLI Structure

```
apps/cli/
├── src/
│   ├── index.tsx               # Entry point
│   ├── app.tsx                 # Main Ink app
│   │
│   ├── commands/               # CLI command definitions
│   │   ├── index.ts            # Command router
│   │   ├── chat.tsx            # Interactive chat mode
│   │   ├── run.tsx             # One-shot task execution
│   │   ├── session.ts          # Session management
│   │   ├── auth.ts             # Login/logout
│   │   └── config.ts           # Configuration
│   │
│   ├── components/             # Ink React components
│   │   ├── ChatView.tsx        # Main chat interface
│   │   ├── MessageList.tsx     # Scrollable message history
│   │   ├── AgentMessage.tsx    # Individual agent message
│   │   ├── UserInput.tsx       # Input field with history
│   │   ├── ToolCall.tsx        # Tool execution display
│   │   ├── ApprovalPrompt.tsx  # Approval modal
│   │   ├── DiffPreview.tsx     # File diff rendering
│   │   ├── StatusBar.tsx       # Bottom status bar
│   │   ├── Spinner.tsx         # Loading indicator
│   │   └── CodeBlock.tsx       # Syntax-highlighted code
│   │
│   ├── hooks/                  # React hooks
│   │   ├── useSocket.ts        # Socket.IO connection
│   │   ├── useSession.ts       # Session state
│   │   ├── useAgent.ts         # Agent interaction
│   │   ├── useApproval.ts      # Approval queue
│   │   ├── useKeyBindings.ts   # Keyboard shortcuts
│   │   └── useConfig.ts        # Configuration access
│   │
│   ├── lib/                    # Utilities
│   │   ├── api.ts              # REST API wrapper
│   │   ├── auth.ts             # Token storage
│   │   ├── config.ts           # Config file management
│   │   ├── markdown.ts         # Markdown rendering
│   │   ├── diff.ts             # Diff formatting
│   │   └── logger.ts           # Debug logging
│   │
│   └── types/                  # TypeScript types
│       ├── api.ts              # API response types
│       ├── message.ts          # Message types
│       └── config.ts           # Config schema
│
├── package.json
├── tsconfig.json
├── tsup.config.ts              # Build configuration
└── README.md
```

---

## Command Interface

### Basic Usage

```bash
# Start interactive chat in current directory
podex

# Start with specific session
podex --session my-project

# One-shot task execution
podex run "Add error handling to the API routes"

# Use local pod instead of cloud
podex --local

# Specify agent type
podex --agent coder

# Pipe input
echo "Explain this code" | podex

# Continue previous session
podex --continue

# List sessions
podex sessions list

# Authentication
podex auth login
podex auth logout
podex auth status

# Configuration
podex config set api-url https://api.podex.dev
podex config get api-url
```

---

## Core Components

### ChatView (Main Interface)

```tsx
// src/components/ChatView.tsx
import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useSocket } from '../hooks/useSocket';
import { useSession } from '../hooks/useSession';
import { MessageList } from './MessageList';
import { UserInput } from './UserInput';
import { ApprovalPrompt } from './ApprovalPrompt';
import { StatusBar } from './StatusBar';

export function ChatView({ sessionId, useLocal }) {
  const { exit } = useApp();
  const { connected, messages, sendMessage, pending } = useSocket(sessionId);
  const { session, agent, status } = useSession();
  const [pendingApproval, setPendingApproval] = useState(null);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          Podex
        </Text>
        <Text dimColor> │ </Text>
        <Text>Session: {session?.name || 'New'}</Text>
        <Text dimColor> │ </Text>
        <Text color={useLocal ? 'yellow' : 'green'}>
          {useLocal ? '⬢ Local Pod' : '☁ Cloud Pod'}
        </Text>
      </Box>

      {/* Messages */}
      <Box flexGrow={1} flexDirection="column">
        <MessageList messages={messages} streaming={pending} />
      </Box>

      {/* Approval Modal */}
      {pendingApproval && (
        <ApprovalPrompt
          request={pendingApproval}
          onRespond={(approved, allowlist) => {
            setPendingApproval(null);
          }}
        />
      )}

      {/* Input */}
      <UserInput onSubmit={sendMessage} disabled={!!pendingApproval || !connected} />

      {/* Status Bar */}
      <StatusBar connected={connected} status={status} />
    </Box>
  );
}
```

### ApprovalPrompt Component

```tsx
// src/components/ApprovalPrompt.tsx
import React from 'react';
import { Box, Text, useInput } from 'ink';

export function ApprovalPrompt({ request, onRespond }) {
  useInput((input) => {
    if (input === 'y' || input === 'Y') onRespond(true);
    else if (input === 'n' || input === 'N') onRespond(false);
    else if (input === 'a' || input === 'A') onRespond(true, true);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
      <Text bold color="yellow">
        ⚠️ Approval Required
      </Text>
      <Box marginY={1}>
        <Text>Agent wants to run:</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="cyan">{request.tool}: </Text>
        <Text>{request.description}</Text>
      </Box>

      {request.command && (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>$ </Text>
          <Text>{request.command}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text>[Y] Approve [N] Deny [A] Always Allow</Text>
      </Box>
    </Box>
  );
}
```

---

## Socket.IO Integration

```typescript
// src/hooks/useSocket.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket(sessionId?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const socket = io(config.apiUrl, {
      auth: { token: config.authToken },
      query: { session_id: sessionId },
    });

    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('agent:message', (data) => {
      setMessages((prev) => [...prev, data]);
      setPending(false);
    });

    socket.on('agent:stream:token', (data) => {
      // Handle streaming
    });

    return () => socket.disconnect();
  }, [sessionId]);

  const sendMessage = useCallback((content: string) => {
    socketRef.current?.emit('user:message', { content });
  }, []);

  return { connected, messages, pending, sendMessage };
}
```

---

## Authentication Flow

### Device Flow (Recommended for CLI)

```
┌─────────────────┐                              ┌─────────────────┐
│  podex CLI      │                              │  Podex API      │
└────────┬────────┘                              └────────┬────────┘
         │                                                │
         │  1. Request device code                        │
         │───────────────────────────────────────────────>│
         │                                                │
         │  2. Receive device_code, user_code,           │
         │     verification_uri                           │
         │<───────────────────────────────────────────────│
         │                                                │
         │  3. Display: "Go to podex.dev/device           │
         │             Enter code: ABCD-1234"             │
         │                                                │
         │  4. Poll for token (every 5s)                  │
         │───────────────────────────────────────────────>│
         │                                                │
         │  (User completes auth in browser)              │
         │                                                │
         │  5. Receive access_token, refresh_token        │
         │<───────────────────────────────────────────────│
         │                                                │
         │  6. Store in ~/.config/podex/credentials.json  │
```

---

## Local Pod Integration

```typescript
// src/lib/localPod.ts
import net from 'net';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const PID_FILE = path.join(os.homedir(), '.podex', 'local-pod.pid');

export async function discoverLocalPod() {
  try {
    const content = await fs.readFile(PID_FILE, 'utf-8');
    const info = JSON.parse(content);

    if (await isPortReachable(info.port)) {
      return info;
    }
    return null;
  } catch {
    return null;
  }
}

async function isPortReachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.connect(port, '127.0.0.1');
  });
}
```

---

## Command Structure (Unified)

The `podex` command is the primary entry point, with `podex-pod` handling infrastructure:

```bash
# Main CLI (Node.js/Ink) - installed via npm
podex                         # Interactive AI chat (default)
podex chat                    # Explicit chat mode
podex run "Add auth to API"   # One-shot task execution
podex --local                 # Use local pod instead of cloud
podex --session my-project    # Join specific session

podex auth login              # Device flow authentication
podex auth logout
podex auth status

podex sessions list           # Session management
podex sessions delete <id>

podex config set key value    # Configuration
podex config get key

# Local Pod (Python) - installed via pip
podex-pod start               # Start local pod agent
podex-pod stop                # Stop local pod
podex-pod status              # Show pod status
podex-pod check               # System requirements check
```

### Routing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  User types: podex                                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  npm: podex (Node.js)                                           │
│  ├── podex              → Ink TUI interactive chat              │
│  ├── podex chat         → Ink TUI                               │
│  ├── podex run          → Ink TUI one-shot                      │
│  ├── podex auth *       → Node.js auth flows                    │
│  ├── podex sessions *   → Node.js API calls                     │
│  └── podex config *     → Node.js config management             │
│                                                                  │
│  pip: podex-pod (Python)                                        │
│  ├── podex-pod start    → Python local pod daemon               │
│  ├── podex-pod stop     → Python                                │
│  ├── podex-pod status   → Python                                │
│  └── podex-pod check    → Python system check                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Registry Strategy

### Reserved Package Names

| Registry     | Package      | Command     | Purpose                                 |
| ------------ | ------------ | ----------- | --------------------------------------- |
| **npm**      | `podex`      | `podex`     | Main CLI (Ink TUI)                      |
| **npm**      | `@podex/cli` | -           | Scoped alias                            |
| **PyPI**     | `podex`      | `podex`     | Reserved (future Python TUI or wrapper) |
| **PyPI**     | `podex-pod`  | `podex-pod` | Local pod infrastructure                |
| **Homebrew** | `podex`      | `podex`     | Points to npm package                   |

### Migration: `podex-local-pod` → `podex-pod`

```toml
# services/local-pod/pyproject.toml
[project]
name = "podex-pod"  # Changed from podex-local-pod

[project.scripts]
podex-pod = "podex_local_pod.main:cli"        # New primary command
podex-local-pod = "podex_local_pod.main:cli"  # Deprecated alias
```

---

## Build & Distribution

### Package.json (npm)

```json
{
  "name": "podex",
  "version": "0.1.0",
  "description": "Podex CLI - AI-powered coding assistant",
  "bin": {
    "podex": "./dist/index.js"
  },
  "scripts": {
    "dev": "tsup --watch",
    "build": "tsup",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "ink": "^5.0.1",
    "@inkjs/ui": "^2.0.0",
    "commander": "^12.0.0",
    "socket.io-client": "^4.7.0",
    "marked": "^12.0.0",
    "marked-terminal": "^7.0.0",
    "@podex/api-client": "workspace:*"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Installation

```bash
# Main CLI (interactive AI chat)
npm install -g podex
# or
brew install podex

# Local Pod (infrastructure - optional)
pip install podex-pod
# or
pipx install podex-pod
```

### Distribution Channels

| Method       | Package     | Command                  | Size  |
| ------------ | ----------- | ------------------------ | ----- |
| **npm**      | `podex`     | `npm i -g podex`         | ~30MB |
| **Homebrew** | `podex`     | `brew install podex`     | ~50MB |
| **PyPI**     | `podex-pod` | `pip install podex-pod`  | ~5MB  |
| **pipx**     | `podex-pod` | `pipx install podex-pod` | ~5MB  |

---

## Feature Comparison

| Feature             | Podex CLI | Claude Code | Aider | Gemini CLI |
| ------------------- | --------- | ----------- | ----- | ---------- |
| **Cloud execution** | ✅        | ❌          | ❌    | ❌         |
| **Local execution** | ✅        | ✅          | ✅    | ✅         |
| **Multi-agent**     | ✅        | ❌          | ❌    | ❌         |
| **Streaming**       | ✅        | ✅          | ✅    | ✅         |
| **Session sharing** | ✅        | ❌          | ❌    | ❌         |
| **Team billing**    | ✅        | ❌          | ❌    | ❌         |
| **Multi-model**     | ✅        | ❌          | ✅    | ❌         |

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

- [ ] Project scaffold with Ink + TypeScript
- [ ] Basic chat interface (input/output)
- [ ] REST API authentication (device flow)
- [ ] Credential storage

### Phase 2: Core Chat (Week 3-4)

- [ ] Socket.IO connection
- [ ] Message streaming display
- [ ] Markdown rendering
- [ ] Tool call display

### Phase 3: Approvals (Week 5)

- [ ] Approval prompt UI
- [ ] Keyboard shortcuts (Y/N/A)
- [ ] Diff preview for file edits

### Phase 4: Local Pod (Week 6)

- [ ] Local pod discovery
- [ ] Mode switching (cloud/local)

### Phase 5: Polish (Week 7-8)

- [ ] Session management
- [ ] One-shot `run` command
- [ ] Error handling

### Phase 6: Distribution (Week 9)

- [ ] npm publish
- [ ] Standalone binaries
- [ ] Homebrew formula

---

## Immediate Actions

### Reserve Package Names

1. **npm** - Publish placeholder `podex` package

   ```bash
   cd apps/cli
   npm init -y
   npm publish --access public
   ```

2. **PyPI** - Publish placeholder `podex` package

   ```bash
   # Create minimal package
   mkdir -p podex-placeholder && cd podex-placeholder
   cat > pyproject.toml << 'EOF'
   [project]
   name = "podex"
   version = "0.0.1"
   description = "Podex CLI - AI-powered coding assistant (coming soon)"
   readme = "README.md"
   requires-python = ">=3.11"
   license = {text = "MIT"}
   authors = [{name = "Podex", email = "support@podex.dev"}]

   [project.urls]
   Homepage = "https://podex.dev"
   EOF

   echo "# Podex CLI\n\nComing soon. See https://podex.dev" > README.md
   pip install build twine
   python -m build
   twine upload dist/*
   ```

3. **Rename local-pod** - Update `podex-local-pod` → `podex-pod`
   - Update pyproject.toml name and scripts
   - Publish to PyPI under new name
   - Keep old name as deprecated alias

---

## Open Questions

1. **Multi-agent in CLI?** - Grid view with multiple agents or single-agent for simplicity?
2. **File editing UX** - Inline diffs or open in external editor ($EDITOR)?
3. **MCP support** - Implement Model Context Protocol for extensibility?
4. **Headless mode** - Support piping for CI/CD integration?

---

## References

- [Ink - React for CLIs](https://github.com/vadimdemedes/ink)
- [Claude Code](https://github.com/anthropics/claude-code)
- [Aider](https://github.com/paul-gauthier/aider)
- [Charm - Go TUI libraries](https://charm.sh/)
- [Textual - Python TUI](https://textual.textualize.io/)
