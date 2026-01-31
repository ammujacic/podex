# Terminal Windows as First-Class Workspace Citizens

**Date:** 2026-01-31
**Status:** Approved

## Overview

Integrate terminals as first-class windows in the workspace, appearing alongside agents in Grid/Focus/Freeform layouts and listed in the sidebar. This creates a unified window model while keeping the existing bottom terminal panel for quick access.

## Key Decisions

| Decision          | Choice                                                  |
| ----------------- | ------------------------------------------------------- |
| Architecture      | Terminal as distinct window type (not special agent)    |
| Sidebar           | Unified "Windows" list with icons differentiating types |
| Terminal per card | One terminal per card - use grid layout for splits      |
| Creation UI       | Unified "Add" dropdown alongside agent creation         |
| Bottom panel      | Keep both systems - independent from card terminals     |
| Focus mode        | Terminals appear as tabs mixed with agents              |

## Data Model

### New Type: TerminalWindow

```typescript
// sessionTypes.ts
interface TerminalWindow {
  id: string;
  name: string; // User-editable, e.g., "Build Server"
  shell: string; // 'bash', 'zsh', etc.
  status: 'connected' | 'disconnected' | 'error';

  // Layout (shared with agents)
  gridSpan?: GridSpan; // For grid mode
  position?: AgentPosition; // For freeform mode

  // Terminal-specific
  workingDirectory?: string; // Current cwd to display
  createdAt: string;
}
```

### Session Extension

```typescript
interface Session {
  // ... existing fields
  agents: Agent[];
  terminalWindows: TerminalWindow[]; // NEW
  activeWindowId: string | null; // Replaces activeAgentId
  // ... rest
}
```

## Sidebar: Unified Windows List

The "Agents" panel becomes "Windows" panel:

```
┌─────────────────────────────┐
│  Windows                    │
├─────────────────────────────┤
│  🤖 Architect          idle │
│  🤖 Coder            active │
│  🤖 Reviewer           idle │
│  ⬛ Build Server  connected │
│  ⬛ Dev Server    connected │
│  + Add Window ▾             │
└─────────────────────────────┘
```

- Icons differentiate type (🤖 agents, ⬛ terminals)
- Status shown on right
- Clicking focuses the window
- "Add Window" dropdown: "Add Agent" / "Add Terminal"

## Layout Modes

### Grid Mode

- Terminal cards use `ResizableGridCard` wrapper (same as agents)
- Header: terminal name, shell badge, status dot, close button
- Body: xterm.js terminal instance
- Resize handles: bottom-left, bottom-right

### Focus Mode

Tab bar shows all windows mixed:

```
[Architect] [Coder] [Reviewer] [Build Server] [Dev Server]
```

- Active tab determined by `activeWindowId`
- Main area renders `AgentCard` or `TerminalCard` based on type

### Freeform Mode

- `DraggableTerminalCard` mirrors `DraggableAgentCard`
- Uses `position` for x, y, width, height, zIndex
- Same drag/resize behavior as agent windows

## Terminal Card Component

```typescript
// TerminalCard.tsx
interface TerminalCardProps {
  terminalWindow: TerminalWindow;
  expanded?: boolean; // true in focus mode
}
```

### Header

- Terminal icon + editable name
- Shell badge (e.g., "zsh")
- Status indicator (green/red/gray dot)
- Close button

### Body

- Wraps existing `TerminalInstance` (xterm.js)
- Each card manages own Socket.IO connection
- Terminal ID: `terminal-card-{terminalWindow.id}`

### Lifecycle

```
TerminalCard mounts
  → Socket.IO connect with terminal ID
  → Backend spawns shell
  → xterm.js streams I/O
  → User closes card
  → Socket.IO disconnect
  → Backend terminates shell
```

## State Management

### New Session Store Actions

```typescript
// Terminal window CRUD
addTerminalWindow: (sessionId: string, name?: string) => string;
removeTerminalWindow: (sessionId: string, terminalId: string) => void;
updateTerminalWindow: (sessionId: string, terminalId: string, updates: Partial<TerminalWindow>) => void;

// Layout actions
updateTerminalWindowGridSpan: (sessionId: string, terminalId: string, gridSpan: GridSpan) => void;
updateTerminalWindowPosition: (sessionId: string, terminalId: string, position: AgentPosition) => void;
bringTerminalWindowToFront: (sessionId: string, terminalId: string) => void;

// Unified window focus (replaces setActiveAgent)
setActiveWindow: (sessionId: string, windowId: string | null) => void;
```

### Helpers

```typescript
getWindowType: (sessionId: string, windowId: string) => 'agent' | 'terminal' | null;
getWindowById: (sessionId: string, windowId: string) => Agent | TerminalWindow | null;
```

## Migration Strategy

### Renaming activeAgentId → activeWindowId

1. Add `activeWindowId` as new field
2. Create getter `activeAgentId` for backwards compat (filters for agent type)
3. Migrate components to use `activeWindowId`
4. Remove deprecated getter

### Components to Update

| Component                   | Change                                    |
| --------------------------- | ----------------------------------------- |
| `AgentGrid.tsx`             | Render both agents and terminal windows   |
| `SidebarContainer.tsx`      | Show unified windows list                 |
| `AgentsPanel.tsx`           | Rename to `WindowsPanel`, list both types |
| `WorkspaceLayout.tsx`       | Handle focus for both window types        |
| `FocusModeTabs`             | Include terminal tabs                     |
| `MobileWorkspaceLayout.tsx` | Same changes for mobile                   |
| `MobileAgentToolbar.tsx`    | Include terminal switching                |

### New Components

| Component                   | Purpose                            |
| --------------------------- | ---------------------------------- |
| `TerminalCard.tsx`          | Main terminal window card          |
| `TerminalCardHeader.tsx`    | Header with name, status, controls |
| `DraggableTerminalCard.tsx` | Freeform mode wrapper              |

## Bottom Panel Relationship

- Bottom panel terminals remain **completely independent**
- Managed by existing `terminal.ts` store
- Card terminals managed by session store
- No interaction between the two systems
- Bottom panel = ephemeral/quick access
- Cards = persistent workspace terminals

## Default Naming

- First terminal: "Terminal 1"
- Subsequent: "Terminal 2", "Terminal 3", etc.
- User can rename via header click

---

## Implementation Sequence

1. Add `TerminalWindow` type to `sessionTypes.ts`
2. Add `terminalWindows[]` and actions to session store
3. Rename `activeAgentId` → `activeWindowId` with compat getter
4. Create `TerminalCard` component
5. Update `AgentGrid` to render terminal windows
6. Update sidebar to show unified windows list
7. Add "Add Terminal" to creation UI
8. Update Focus mode tabs
9. Add `DraggableTerminalCard` for freeform mode
10. Update mobile components
