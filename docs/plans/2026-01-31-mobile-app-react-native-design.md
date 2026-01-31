# Podex Mobile App - React Native + Expo Design

**Date:** 2026-01-31
**Status:** Draft
**Author:** AI Assistant + Team

## Overview

Build a native mobile app for iOS and Android using React Native + Expo that replicates the current mobile web UI functionality, providing a native feel, platform capabilities (push notifications, widgets), and App Store/Play Store distribution.

## Goals

1. **Native feel** - Smooth animations, native gestures, platform-consistent UI
2. **Platform capabilities** - Push notifications, background processing, widgets
3. **App Store presence** - Distribution via App Store and Google Play
4. **Minimal maintenance** - Leverage team's React/TypeScript expertise
5. **MVP scope** - Match current mobile web UI, then iterate

## Current Mobile Web Features (MVP Scope)

Based on existing `apps/web/src/components/workspace/Mobile*.tsx` components:

| Feature                     | Web Component           | Mobile App Priority |
| --------------------------- | ----------------------- | ------------------- |
| Agent chat with streaming   | `MobileAgentView`       | P0 - Core           |
| Session overview            | `MobileSessionOverview` | P0 - Core           |
| Agent switching (swipe)     | `MobileAgentTabs`       | P0 - Core           |
| Message input + attachments | `MobileAgentView`       | P0 - Core           |
| Agent toolbar (model/mode)  | `MobileAgentToolbar`    | P0 - Core           |
| Bottom sheet widgets        | `MobileWidgetSheet`     | P1 - Important      |
| File browser                | `FilesPanel`            | P1 - Important      |
| File viewer                 | `MobileFileViewerSheet` | P1 - Important      |
| Terminal                    | `TerminalPanel`         | P2 - Nice to have   |
| Code editor                 | `MobileCodeEditor`      | P2 - Nice to have   |
| Git panel                   | `GitPanel`              | P2 - Nice to have   |

## Technology Stack

### Core Framework

- **React Native** 0.76+ (New Architecture enabled)
- **Expo** SDK 52+ (Managed workflow)
- **TypeScript** 5.x

### Navigation

- **Expo Router** v4 - File-based routing (matches Next.js mental model)

### State Management

- **Zustand** - Same library as web, stores can be adapted
- **React Query (TanStack)** - Server state, same as web

### Real-time Communication

- **socket.io-client** - Same library as web
- **Expo Background Fetch** - For background updates

### UI Components

- **React Native Reanimated** - 60fps animations
- **React Native Gesture Handler** - Native gestures (swipes, pan)
- **Expo UI** / **Tamagui** / **NativeWind** - Styling (TBD)
- **React Native Bottom Sheet** - Native bottom sheets

### Platform Features

- **Expo Notifications** - Push notifications
- **Expo Secure Store** - Token storage
- **Expo Widgets** - Home screen widgets (iOS 17+, Android)

### Code Editor (P2)

- **react-native-code-editor** or custom with syntax highlighting
- Consider WebView with Monaco for complex editing

### Development

- **Expo Dev Client** - Custom dev builds
- **EAS Build** - Cloud builds for App Store
- **EAS Submit** - App Store submission

## Architecture

```
podex/
├── apps/
│   ├── web/                    # Existing Next.js web app
│   └── mobile/                 # New React Native + Expo app
│       ├── app/                # Expo Router screens
│       │   ├── (auth)/         # Auth screens
│       │   ├── (main)/         # Main app screens
│       │   │   ├── index.tsx   # Dashboard/Sessions
│       │   │   ├── session/
│       │   │   │   └── [id].tsx
│       │   │   └── settings/
│       │   └── _layout.tsx     # Root layout
│       ├── components/         # React Native components
│       │   ├── agent/          # Agent-related components
│       │   ├── chat/           # Message list, input
│       │   ├── common/         # Shared UI components
│       │   └── sheets/         # Bottom sheets
│       ├── hooks/              # Custom hooks
│       ├── lib/                # Utilities
│       │   ├── api.ts          # API client (adapted from web)
│       │   └── socket.ts       # Socket.IO setup
│       ├── stores/             # Zustand stores (adapted from web)
│       ├── app.json            # Expo config
│       ├── eas.json            # EAS Build config
│       └── package.json
├── packages/
│   └── shared/                 # Shared types (already exists)
└── ...
```

## Code Sharing Strategy

### Direct Reuse (copy + adapt)

- **Type definitions** from `packages/shared/src/types.ts`
- **API client patterns** from `apps/web/src/lib/api.ts`
- **Socket.IO patterns** from `apps/web/src/lib/socket.ts`
- **Zustand store structure** from `apps/web/src/stores/`

### Needs Rewrite (same logic, different UI)

- All React components (React Native uses `View`, `Text`, not `div`, `span`)
- Styling (Tailwind → StyleSheet or NativeWind)
- Navigation (Next.js Router → Expo Router)

### New Implementation

- Push notification handling
- Background fetch
- Secure token storage
- Native gestures and animations
- App widgets

## API Integration

The mobile app will use the same backend APIs:

```typescript
// Base configuration
const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://api.podex.dev';

// Authentication
- POST /api/auth/login → JWT token
- Token stored in Expo SecureStore

// Sessions
- GET /api/sessions → List user sessions
- POST /api/sessions → Create session
- GET /api/sessions/:id → Session details

// Agents
- GET /api/sessions/:id/agents → List agents
- POST /api/sessions/:id/agents/:agentId/messages → Send message
- POST /api/sessions/:id/agents/:agentId/abort → Abort agent

// Files
- GET /api/sessions/:id/files/:path → Read file
- POST /api/sessions/:id/files/:path → Write file
```

## WebSocket Integration

Same Socket.IO events as web:

```typescript
// Connection
socket.connect(API_BASE, { auth: { token } });

// Subscribe to session
socket.emit('join_session', { sessionId });

// Listen for events
socket.on('agent_message', handleMessage);
socket.on('agent_stream_token', handleStreamToken);
socket.on('agent_status', handleStatusChange);
socket.on('file_change', handleFileChange);
socket.on('workspace_status', handleWorkspaceStatus);
```

## Push Notifications

### Use Cases

1. **Agent needs attention** - Approval required, error occurred
2. **Agent completed task** - Long-running task finished
3. **Workspace status** - Provisioning complete, error state

### Implementation

- Backend sends to Expo Push Service
- Mobile app registers push token on login
- Deep links open relevant session/agent

## Screen Designs

### 1. Dashboard (Sessions List)

- List of active sessions with status indicators
- Quick actions: New session, recent sessions
- Pull to refresh

### 2. Session Overview

- Grid/list of agents in session
- Agent cards showing: name, role, status, last message preview
- Tap to open agent chat
- FAB: Add new agent

### 3. Agent Chat

- Message list with streaming support
- Swipe left/right to switch agents
- Input bar with attachment button
- Toolbar: Model selector, mode selector, thinking toggle
- Status indicators: thinking, executing, waiting

### 4. Widget Sheets (Bottom Sheet)

- Files: Tree browser, tap to preview
- Terminal: Read-only output, command input
- Git: Status, staged/unstaged files
- Search: Project-wide search

### 5. Settings

- Account info
- Notification preferences
- Theme (follow system / dark / light)
- Model defaults

## Gestures & Animations

| Gesture                  | Action                    |
| ------------------------ | ------------------------- |
| Swipe left/right on chat | Switch to prev/next agent |
| Pull down on list        | Refresh                   |
| Long press on message    | Copy, share, regenerate   |
| Swipe up from bottom     | Open widget sheet         |
| Pinch on code            | Zoom in/out               |

All animations target 60fps using Reanimated worklets.

## Offline Support

### Phase 1 (MVP)

- Show cached sessions list
- Show cached messages (read-only)
- Queue messages for sending when online
- Clear "offline" indicator

### Phase 2

- Full message history caching
- Optimistic updates
- Conflict resolution

## Security

1. **Token storage** - Expo SecureStore (Keychain/Keystore)
2. **Certificate pinning** - For API requests (optional, EAS managed)
3. **Biometric auth** - Optional app unlock
4. **Sensitive data** - Never log tokens, clear on logout

## Testing Strategy

1. **Unit tests** - Jest + React Native Testing Library
2. **Component tests** - Snapshot tests for UI
3. **E2E tests** - Detox or Maestro
4. **Manual testing** - Expo Dev Client on real devices

## Release Strategy

### Development

- Expo Dev Client for daily development
- Internal distribution via EAS for team testing

### Beta

- TestFlight (iOS) + Internal Testing (Android)
- Gather feedback from internal users

### Production

- EAS Submit to App Store + Play Store
- OTA updates for JS-only changes
- Native updates require store review

## Estimated Effort

| Phase     | Scope                               | Estimate        |
| --------- | ----------------------------------- | --------------- |
| Phase 1   | Project setup, auth, dashboard      | 1-2 weeks       |
| Phase 2   | Agent chat with streaming           | 2-3 weeks       |
| Phase 3   | Session management, agent switching | 1-2 weeks       |
| Phase 4   | Widget sheets (files, git)          | 2-3 weeks       |
| Phase 5   | Push notifications                  | 1 week          |
| Phase 6   | Polish, testing, App Store          | 2-3 weeks       |
| **Total** | **MVP Release**                     | **10-14 weeks** |

## Success Metrics

1. **Performance** - App startup < 2s, 60fps scrolling
2. **Reliability** - Crash-free rate > 99.5%
3. **Engagement** - DAU/MAU comparable to web
4. **Store ratings** - Target 4.5+ stars

## Open Questions

1. **Styling approach** - NativeWind (Tailwind for RN) vs Tamagui vs StyleSheet?
2. **Code editor** - WebView Monaco vs native syntax highlighting?
3. **Widget priority** - Which widgets to include in MVP?
4. **Monetization** - Same billing as web, or separate mobile subscription?

## Next Steps

1. Initialize Expo project in `apps/mobile/`
2. Set up Expo Router navigation structure
3. Implement authentication flow
4. Adapt API client and Zustand stores
5. Build core chat UI with streaming
6. Iterate on remaining features

---

## Appendix: Key Files to Reference

| Purpose         | Web File                                                      | Notes                  |
| --------------- | ------------------------------------------------------------- | ---------------------- |
| API Client      | `apps/web/src/lib/api.ts`                                     | Adapt for React Native |
| Socket.IO       | `apps/web/src/lib/socket.ts`                                  | Direct port possible   |
| Session Store   | `apps/web/src/stores/session.ts`                              | Adapt store structure  |
| Mobile UI Store | `apps/web/src/stores/mobileUI.ts`                             | Reference for state    |
| Agent Types     | `packages/shared/src/types.ts`                                | Direct import          |
| Mobile Layout   | `apps/web/src/components/workspace/MobileWorkspaceLayout.tsx` | UI reference           |
| Agent View      | `apps/web/src/components/workspace/MobileAgentView.tsx`       | UI reference           |
| Message List    | `apps/web/src/components/workspace/AgentMessageList.tsx`      | Logic reference        |
