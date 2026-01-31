# Pod Card Controls Design

**Date:** 2026-01-31
**Status:** Draft

## Overview

Add unified control buttons to pod cards across all dashboard sections (Pinned Pods, Recent Pods, All Pods). Uses a hybrid pattern: inline start/stop toggle for the primary action, three-dot menu for secondary actions.

## Card Layout

### Current

```
┌─────────────────────────────────┐
│ [icon]            ○ Starting    │  ← status top-right
│                                 │
│ Python Project                  │
│                                 │
│ ⏱ 3m ago                        │
└─────────────────────────────────┘
```

### New

```
┌─────────────────────────────────┐
│ [icon]              [▶] [⋮]    │  ← controls top-right
│                                 │
│ Python Project                  │
│                                 │
│ ○ Starting · 3m ago             │  ← status + time bottom-left
└─────────────────────────────────┘
```

### Changes

- **Top-right:** Start/stop button + three-dot menu button
- **Bottom-left:** Status badge + timestamp combined on one line
- Status retains existing color scheme (green=running, gray=stopped, yellow=starting, red=error)

## Controls Specification

### Primary Action: Start/Stop Button

| Pod Status | Button Icon   | Enabled | On Click         |
| ---------- | ------------- | ------- | ---------------- |
| Running    | `⏹` (stop)    | Yes     | Stops workspace  |
| Stopped    | `▶` (play)    | Yes     | Starts workspace |
| Starting   | `⟳` (spinner) | No      | N/A              |
| Error      | `▶` (play)    | Yes     | Attempts restart |
| Offline    | `▶` (grayed)  | No      | N/A              |

### Secondary Actions: Three-Dot Menu

| Item   | Icon           | Visibility    | Action                           |
| ------ | -------------- | ------------- | -------------------------------- |
| Open   | `↗`            | Always        | Navigate to `/session/{id}`      |
| Rename | `✏`            | Always        | Opens rename input               |
| Pin    | `📌`           | If not pinned | Pins session                     |
| Unpin  | `📌` (crossed) | If pinned     | Unpins session                   |
| Delete | `🗑` (red)     | Always        | Shows confirmation, then deletes |

### Interaction Behavior

- Controls are always visible (no hover-to-reveal)
- Card hover shows subtle highlight/border (existing behavior)
- Delete triggers existing confirmation modal

## Implementation

### File Structure

```
apps/web/src/components/pods/
├── PodCard.tsx          # Main card component
├── PodCardControls.tsx  # Start/stop + menu buttons
└── PodCardMenu.tsx      # Dropdown menu content
```

### PodCard Props

```typescript
interface PodCardProps {
  session: Session;
  status: StatusConfig;
  template: PodTemplate | null;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onRename: (newName: string) => void;
  onTogglePin: () => void;
  onClick: () => void;
}
```

### Usage

- **Pinned Pods:** Uses `PodCard`
- **Recent Pods:** Uses `PodCard`
- **All Pods (grid view):** Uses `PodCard`
- **All Pods (list view):** Remains table row format (unchanged)

### Rename Feature

- Inline edit: clicking rename replaces pod name with text input
- Press Enter or blur to save
- Press Escape to cancel
- Uses existing session update API endpoint

## Scope

### In Scope

- Extract reusable PodCard component
- Add start/stop inline button
- Add three-dot menu with Open, Rename, Pin/Unpin, Delete
- Relocate status badge to bottom-left
- Rename functionality

### Out of Scope

- All Pods list view changes
- New Pod card styling
- Mobile-specific adjustments
