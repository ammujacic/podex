# Hook Tests

This directory contains comprehensive test suites for React hooks used in the Podex web application.

## Test Files

### useAgentSocket.test.ts (48 tests)

Comprehensive tests for the `useAgentSocket` hook that manages WebSocket communication for agent messaging.

**Coverage Areas:**

- **Connection & Initialization (7 tests)**
  - Socket connection on mount
  - Session joining/leaving
  - Missing parameter handling
  - Event listener setup
  - Cleanup on unmount

- **Agent Message Events (10 tests)**
  - User and assistant message handling
  - Tool calls in messages
  - Session filtering
  - Duplicate message prevention
  - Optimistic update ID replacement
  - Missing session/agent handling

- **Agent Status Events (4 tests)**
  - Status updates (idle, active, error)
  - Session filtering

- **Auto Mode Switch Events (3 tests)**
  - Mode switching with auto-revert
  - Mode revert notifications
  - Session filtering

- **Streaming Events (7 tests)**
  - Stream start/end
  - Token streaming
  - Thinking tokens
  - Multiple token handling
  - Tool calls in stream end
  - Session filtering

- **Config Update Events (5 tests)**
  - Model updates from CLI
  - Mode updates from CLI
  - Thinking config updates
  - Toast notifications for CLI changes
  - Session filtering

- **Workspace Status Events (3 tests)**
  - Standby status
  - Error status
  - Running status

- **Billing Standby Events (1 test)**
  - Credit exhaustion handling

- **Permission Request Events (3 tests)**
  - CLI permission requests
  - Default attention ID generation
  - Session filtering

- **Native Approval Request Events (3 tests)**
  - Command approval requests
  - File path approval requests
  - Session filtering

- **useSendAgentMessage Hook (3 tests)**
  - Message sending via API
  - Error handling
  - Correct session ID usage

### usePreviewDevTools.test.ts (52 tests)

Comprehensive tests for the `usePreviewDevTools` hook that handles DevTools integration with preview iframes.

**Coverage Areas:**

- **Initialization (5 tests)**
  - Message listener setup
  - DevTools state reset
  - Cleanup on unmount
  - Disabled state handling
  - Subscribe cleanup

- **Message Validation (4 tests)**
  - Origin validation
  - Type validation
  - Source validation
  - Prefix validation

- **DevTools Ready Events (2 tests)**
  - Ready event handling
  - DOM ready event handling

- **Console Events (7 tests)**
  - All console levels (log, warn, error, info, debug)
  - Multiple arguments
  - Missing required fields

- **Network Request Events (4 tests)**
  - GET/POST/XHR requests
  - Request body handling
  - Missing required fields

- **Network Response Events (4 tests)**
  - Successful responses
  - Network errors
  - 404 responses
  - Missing ID handling

- **DOM Snapshot Events (2 tests)**
  - Full DOM snapshots
  - Empty snapshots

- **Navigation Events (2 tests)**
  - Navigation handling
  - Missing URL handling

- **Error Events (3 tests)**
  - JavaScript errors
  - Unhandled rejections
  - Missing message handling

- **HTML Snapshot Events (2 tests)**
  - HTML snapshot capture
  - Missing required fields

- **Eval Result Events (3 tests)**
  - Successful eval results
  - Eval errors
  - Missing required fields

- **Send Command (4 tests)**
  - Basic command sending
  - Commands with payload
  - Missing iframe handling
  - PostMessage error handling

- **Request DOM Snapshot (1 test)**
  - DOM snapshot request command

- **Request HTML (1 test)**
  - HTML request command

- **Navigate (1 test)**
  - Navigation command

- **Reload (1 test)**
  - Reload command

- **Eval Code (2 tests)**
  - Code evaluation with ID generation
  - Unique ID generation

- **Integration Scenarios (3 tests)**
  - Full console logging flow
  - Network request/response flow
  - Page lifecycle events

## Running Tests

Run all hook tests:

```bash
npm run test -- src/hooks/__tests__/useAgentSocket.test.ts src/hooks/__tests__/usePreviewDevTools.test.ts --run
```

Run individual test files:

```bash
npm run test -- src/hooks/__tests__/useAgentSocket.test.ts --run
npm run test -- src/hooks/__tests__/usePreviewDevTools.test.ts --run
```

Run in watch mode:

```bash
npm run test -- src/hooks/__tests__/useAgentSocket.test.ts
npm run test -- src/hooks/__tests__/usePreviewDevTools.test.ts
```

## Test Statistics

- **Total Tests:** 100
- **useAgentSocket:** 48 tests
- **usePreviewDevTools:** 52 tests
- **Pass Rate:** 100%

## Test Patterns Used

1. **renderHook** from @testing-library/react for hook testing
2. **Mock socket handlers** for WebSocket event simulation
3. **Mock iframe/postMessage** for DevTools communication
4. **waitFor** for async event handling
5. **vi.fn()** for function mocking and spying
6. **Zustand store mocking** with proper state management
7. **Event triggering** for socket and postMessage events

## Dependencies

- vitest
- @testing-library/react
- Socket mocks from `@/__tests__/mocks/socket.ts`
