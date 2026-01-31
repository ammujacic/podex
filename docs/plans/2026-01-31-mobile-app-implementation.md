# Podex Mobile App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React Native + Expo mobile app for iOS and Android that mirrors the current mobile web UI functionality.

**Architecture:** Expo managed workflow with Expo Router for navigation. Zustand stores adapted from web app. Socket.IO for real-time communication. Same REST API backend.

**Tech Stack:** React Native 0.76+, Expo SDK 52+, Expo Router v4, Zustand, Socket.IO, React Query, React Native Reanimated, React Native Gesture Handler

---

## Phase 1: Project Setup & Infrastructure

### Task 1.1: Initialize Expo Project

**Files:**

- Create: `apps/mobile/` directory structure
- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`

**Step 1: Create mobile app directory**

```bash
cd /Users/mujacic/podex
mkdir -p apps/mobile
```

**Step 2: Initialize Expo project**

```bash
cd apps/mobile
npx create-expo-app@latest . --template expo-template-blank-typescript
```

**Step 3: Update package.json with correct name and dependencies**

Replace `apps/mobile/package.json`:

```json
{
  "name": "@podex/mobile",
  "version": "0.1.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "build:ios": "eas build --platform ios",
    "build:android": "eas build --platform android",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "@expo/vector-icons": "^14.0.0",
    "@gorhom/bottom-sheet": "^5.0.0",
    "@react-navigation/native": "^7.0.0",
    "@tanstack/react-query": "^5.90.17",
    "expo": "~52.0.0",
    "expo-constants": "~17.0.0",
    "expo-linking": "~7.0.0",
    "expo-notifications": "~0.29.0",
    "expo-router": "~4.0.0",
    "expo-secure-store": "~14.0.0",
    "expo-splash-screen": "~0.29.0",
    "expo-status-bar": "~2.0.0",
    "react": "18.3.1",
    "react-native": "0.76.0",
    "react-native-gesture-handler": "~2.20.0",
    "react-native-reanimated": "~3.16.0",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "~4.0.0",
    "socket.io-client": "^4.8.3",
    "zustand": "^5.0.10"
  },
  "devDependencies": {
    "@babel/core": "^7.25.0",
    "@types/react": "~18.3.0",
    "eslint": "^9.0.0",
    "jest": "^29.7.0",
    "typescript": "~5.6.0"
  }
}
```

**Step 4: Configure app.json for Expo**

Create `apps/mobile/app.json`:

```json
{
  "expo": {
    "name": "Podex",
    "slug": "podex",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "podex",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#0a0a0a"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.podex.app",
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification"]
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#0a0a0a"
      },
      "package": "com.podex.app",
      "permissions": ["NOTIFICATIONS"]
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff"
        }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    }
  }
}
```

**Step 5: Create TypeScript config**

Create `apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@podex/shared": ["../../packages/shared/src"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

**Step 6: Create babel.config.js**

Create `apps/mobile/babel.config.js`:

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

**Step 7: Create assets directory with placeholders**

```bash
mkdir -p apps/mobile/assets
# Create placeholder images (1024x1024 icon, 2048x2048 splash)
```

**Step 8: Commit initial setup**

```bash
git add apps/mobile/
git commit -m "feat(mobile): initialize Expo project with TypeScript

- Set up Expo SDK 52 with new architecture enabled
- Configure Expo Router for file-based navigation
- Add core dependencies (Zustand, Socket.IO, React Query)
- Configure iOS and Android build settings

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.2: Configure Expo Router Navigation

**Files:**

- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(main)/_layout.tsx`
- Create: `apps/mobile/app/(main)/index.tsx`
- Create: `apps/mobile/app/(main)/session/[id].tsx`

**Step 1: Create root layout**

Create `apps/mobile/app/_layout.tsx`:

```tsx
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/stores/auth';

const queryClient = new QueryClient();

function RootLayoutNav() {
  const segments = useSegments();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);

  useEffect(() => {
    if (!isInitialized) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      router.replace('/(main)');
    }
  }, [user, segments, isInitialized]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <RootLayoutNav />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**Step 2: Create auth layout**

Create `apps/mobile/app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    />
  );
}
```

**Step 3: Create login screen placeholder**

Create `apps/mobile/app/(auth)/login.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';

export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Podex</Text>
      <Text style={styles.subtitle}>Login screen - TODO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
    marginTop: 8,
  },
});
```

**Step 4: Create main layout**

Create `apps/mobile/app/(main)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function MainLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#ffffff',
        contentStyle: { backgroundColor: '#0a0a0a' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Sessions' }} />
      <Stack.Screen name="session/[id]" options={{ title: 'Session', headerBackTitle: 'Back' }} />
    </Stack>
  );
}
```

**Step 5: Create dashboard placeholder**

Create `apps/mobile/app/(main)/index.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sessions</Text>
      <Text style={styles.subtitle}>Dashboard - TODO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
  },
});
```

**Step 6: Create session screen placeholder**

Create `apps/mobile/app/(main)/session/[id].tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Session {id}</Text>
      <Text style={styles.subtitle}>Agent workspace - TODO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
  },
});
```

**Step 7: Verify navigation works**

```bash
cd apps/mobile
npx expo start
# Press 'i' for iOS simulator or 'a' for Android emulator
```

**Step 8: Commit navigation setup**

```bash
git add apps/mobile/app/
git commit -m "feat(mobile): set up Expo Router navigation structure

- Add root layout with auth redirect logic
- Create (auth) and (main) route groups
- Add placeholder screens for login, dashboard, session
- Configure dark theme styling

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.3: Create Core Stores (Auth, Session, UI)

**Files:**

- Create: `apps/mobile/src/stores/auth.ts`
- Create: `apps/mobile/src/stores/session.ts`
- Create: `apps/mobile/src/stores/ui.ts`
- Create: `apps/mobile/src/stores/index.ts`

**Step 1: Create auth store (adapted from web)**

Create `apps/mobile/src/stores/auth.ts`:

```tsx
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  error: string | null;
  isInitialized: boolean;

  setUser: (user: User | null) => void;
  setTokens: (tokens: AuthTokens | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  logout: () => void;
  clearError: () => void;
}

// Custom storage adapter for Expo SecureStore
const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return await SecureStore.getItemAsync(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(name);
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      tokens: null,
      isLoading: false,
      error: null,
      isInitialized: false,

      setUser: (user) => set({ user }),
      setTokens: (tokens) => set({ tokens }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setInitialized: (isInitialized) => set({ isInitialized }),

      logout: () =>
        set({
          user: null,
          tokens: null,
          error: null,
        }),

      clearError: () => set({ error: null }),
    }),
    {
      name: 'podex-auth',
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setInitialized(true);
      },
    }
  )
);

// Selector hooks
export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () => useAuthStore((state) => !!state.user);
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);
```

**Step 2: Create session store**

Create `apps/mobile/src/stores/session.ts`:

```tsx
import { create } from 'zustand';

export interface Agent {
  id: string;
  sessionId: string;
  name: string;
  role: string;
  model: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';
  color: string;
}

export interface Message {
  id: string;
  agentId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface Session {
  id: string;
  name: string;
  branch: string;
  status: 'active' | 'paused' | 'terminated';
  agents: Agent[];
  createdAt: Date;
}

interface SessionState {
  sessions: Session[];
  currentSession: Session | null;
  currentAgentId: string | null;
  messages: Record<string, Message[]>; // agentId -> messages

  setSessions: (sessions: Session[]) => void;
  setCurrentSession: (session: Session | null) => void;
  setCurrentAgentId: (agentId: string | null) => void;
  addMessage: (agentId: string, message: Message) => void;
  updateMessage: (agentId: string, messageId: string, updates: Partial<Message>) => void;
  appendToMessage: (agentId: string, messageId: string, content: string) => void;
  setMessages: (agentId: string, messages: Message[]) => void;
  updateAgentStatus: (agentId: string, status: Agent['status']) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSession: null,
  currentAgentId: null,
  messages: {},

  setSessions: (sessions) => set({ sessions }),

  setCurrentSession: (session) => set({ currentSession: session }),

  setCurrentAgentId: (agentId) => set({ currentAgentId: agentId }),

  addMessage: (agentId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: [...(state.messages[agentId] || []), message],
      },
    })),

  updateMessage: (agentId, messageId, updates) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: (state.messages[agentId] || []).map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      },
    })),

  appendToMessage: (agentId, messageId, content) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: (state.messages[agentId] || []).map((m) =>
          m.id === messageId ? { ...m, content: m.content + content } : m
        ),
      },
    })),

  setMessages: (agentId, messages) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [agentId]: messages,
      },
    })),

  updateAgentStatus: (agentId, status) =>
    set((state) => ({
      currentSession: state.currentSession
        ? {
            ...state.currentSession,
            agents: state.currentSession.agents.map((a) =>
              a.id === agentId ? { ...a, status } : a
            ),
          }
        : null,
    })),
}));

// Selectors
export const useCurrentAgent = () => {
  const session = useSessionStore((state) => state.currentSession);
  const agentId = useSessionStore((state) => state.currentAgentId);
  return session?.agents.find((a) => a.id === agentId) || null;
};

export const useAgentMessages = (agentId: string) =>
  useSessionStore((state) => state.messages[agentId] || []);
```

**Step 3: Create UI store**

Create `apps/mobile/src/stores/ui.ts`:

```tsx
import { create } from 'zustand';

type WidgetId = 'files' | 'git' | 'terminal' | 'search' | null;

interface MobileFileState {
  path: string;
  content: string;
  language: string;
}

interface UIState {
  // Bottom sheet widget
  activeWidget: WidgetId;
  openWidget: (widget: WidgetId) => void;
  closeWidget: () => void;

  // File viewer
  openFile: MobileFileState | null;
  showFile: (path: string, content: string, language: string) => void;
  hideFile: () => void;

  // Connection status
  isConnected: boolean;
  setConnected: (connected: boolean) => void;

  // Loading states
  isRefreshing: boolean;
  setRefreshing: (refreshing: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeWidget: null,
  openWidget: (widget) => set({ activeWidget: widget }),
  closeWidget: () => set({ activeWidget: null }),

  openFile: null,
  showFile: (path, content, language) => set({ openFile: { path, content, language } }),
  hideFile: () => set({ openFile: null }),

  isConnected: false,
  setConnected: (isConnected) => set({ isConnected }),

  isRefreshing: false,
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
}));

// Selectors
export const useActiveWidget = () => useUIStore((state) => state.activeWidget);
export const useIsConnected = () => useUIStore((state) => state.isConnected);
```

**Step 4: Create store index**

Create `apps/mobile/src/stores/index.ts`:

```tsx
export { useAuthStore, useUser, useIsAuthenticated, useAuthLoading } from './auth';
export { useSessionStore, useCurrentAgent, useAgentMessages } from './session';
export { useUIStore, useActiveWidget, useIsConnected } from './ui';
```

**Step 5: Commit stores**

```bash
git add apps/mobile/src/stores/
git commit -m "feat(mobile): add Zustand stores for auth, session, and UI

- Auth store with SecureStore persistence for tokens
- Session store for managing sessions, agents, messages
- UI store for mobile-specific state (widgets, file viewer)
- Adapted from web app stores with React Native compatibility

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.4: Create API Client

**Files:**

- Create: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/src/lib/config.ts`

**Step 1: Create config**

Create `apps/mobile/src/lib/config.ts`:

```tsx
import Constants from 'expo-constants';

export const config = {
  apiUrl: Constants.expoConfig?.extra?.apiUrl || 'http://localhost:8000',
  wsUrl: Constants.expoConfig?.extra?.wsUrl || 'ws://localhost:8000',
};
```

**Step 2: Create API client**

Create `apps/mobile/src/lib/api.ts`:

```tsx
import { config } from './config';
import { useAuthStore } from '@/stores/auth';

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.apiUrl;
  }

  private getHeaders(): HeadersInit {
    const token = useAuthStore.getState().tokens?.accessToken;
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Auth
  async login(provider: 'github' | 'google'): Promise<{ authUrl: string }> {
    return this.request(`/api/auth/${provider}/authorize`);
  }

  async getCurrentUser() {
    return this.request('/api/users/me');
  }

  // Sessions
  async getSessions() {
    return this.request('/api/sessions');
  }

  async getSession(sessionId: string) {
    return this.request(`/api/sessions/${sessionId}`);
  }

  async createSession(data: { name: string; repositoryUrl?: string }) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Agents
  async getAgents(sessionId: string) {
    return this.request(`/api/sessions/${sessionId}/agents`);
  }

  async sendMessage(sessionId: string, agentId: string, content: string) {
    return this.request(`/api/sessions/${sessionId}/agents/${agentId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async abortAgent(sessionId: string, agentId: string) {
    return this.request(`/api/sessions/${sessionId}/agents/${agentId}/abort`, {
      method: 'POST',
    });
  }

  // Files
  async getFile(sessionId: string, path: string) {
    return this.request(`/api/sessions/${sessionId}/files/${encodeURIComponent(path)}`);
  }

  async listFiles(sessionId: string, path: string = '') {
    return this.request(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`);
  }

  // Messages
  async getMessages(sessionId: string, agentId: string) {
    return this.request(`/api/sessions/${sessionId}/agents/${agentId}/messages`);
  }
}

export const api = new ApiClient();
```

**Step 3: Commit API client**

```bash
git add apps/mobile/src/lib/
git commit -m "feat(mobile): add API client for backend communication

- Config with environment-based API URLs
- ApiClient class with auth header injection
- Methods for sessions, agents, messages, files
- Error handling with proper error extraction

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 1.5: Create Socket.IO Client

**Files:**

- Create: `apps/mobile/src/lib/socket.ts`
- Create: `apps/mobile/src/hooks/useSocket.ts`

**Step 1: Create socket client**

Create `apps/mobile/src/lib/socket.ts`:

```tsx
import { io, Socket } from 'socket.io-client';
import { config } from './config';
import { useAuthStore } from '@/stores/auth';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = useAuthStore.getState().tokens?.accessToken;

    socket = io(config.wsUrl, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function connectSocket(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function joinSession(sessionId: string): void {
  getSocket().emit('join_session', { sessionId });
}

export function leaveSession(sessionId: string): void {
  getSocket().emit('leave_session', { sessionId });
}

// Re-authenticate socket when token changes
useAuthStore.subscribe((state, prevState) => {
  if (state.tokens?.accessToken !== prevState.tokens?.accessToken && socket) {
    socket.auth = { token: state.tokens?.accessToken };
    if (socket.connected) {
      socket.disconnect().connect();
    }
  }
});
```

**Step 2: Create socket hook**

Create `apps/mobile/src/hooks/useSocket.ts`:

```tsx
import { useEffect, useCallback } from 'react';
import {
  getSocket,
  connectSocket,
  disconnectSocket,
  joinSession,
  leaveSession,
} from '@/lib/socket';
import { useSessionStore } from '@/stores/session';
import { useUIStore } from '@/stores/ui';
import { useIsAuthenticated } from '@/stores/auth';

export function useSocket() {
  const isAuthenticated = useIsAuthenticated();
  const setConnected = useUIStore((state) => state.setConnected);

  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();

    socket.on('connect', () => {
      console.log('Socket connected');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setConnected(false);
    });

    connectSocket();

    return () => {
      disconnectSocket();
    };
  }, [isAuthenticated, setConnected]);
}

export function useAgentSocket(sessionId: string | undefined) {
  const addMessage = useSessionStore((state) => state.addMessage);
  const appendToMessage = useSessionStore((state) => state.appendToMessage);
  const updateAgentStatus = useSessionStore((state) => state.updateAgentStatus);

  useEffect(() => {
    if (!sessionId) return;

    const socket = getSocket();
    joinSession(sessionId);

    // Handle streaming tokens
    socket.on(
      'agent_stream_token',
      (data: { agentId: string; messageId: string; token: string }) => {
        appendToMessage(data.agentId, data.messageId, data.token);
      }
    );

    // Handle complete messages
    socket.on('agent_message', (data: { agentId: string; message: any }) => {
      addMessage(data.agentId, {
        id: data.message.id,
        agentId: data.agentId,
        role: data.message.role,
        content: data.message.content,
        timestamp: new Date(data.message.timestamp),
        isStreaming: false,
      });
    });

    // Handle status updates
    socket.on('agent_status', (data: { agentId: string; status: string }) => {
      updateAgentStatus(data.agentId, data.status as any);
    });

    // Handle stream start (create placeholder message)
    socket.on('stream_start', (data: { agentId: string; messageId: string }) => {
      addMessage(data.agentId, {
        id: data.messageId,
        agentId: data.agentId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      });
    });

    // Handle stream end
    socket.on('stream_end', (data: { agentId: string; messageId: string }) => {
      useSessionStore.getState().updateMessage(data.agentId, data.messageId, {
        isStreaming: false,
      });
    });

    return () => {
      leaveSession(sessionId);
      socket.off('agent_stream_token');
      socket.off('agent_message');
      socket.off('agent_status');
      socket.off('stream_start');
      socket.off('stream_end');
    };
  }, [sessionId, addMessage, appendToMessage, updateAgentStatus]);
}
```

**Step 3: Commit socket integration**

```bash
git add apps/mobile/src/lib/socket.ts apps/mobile/src/hooks/
git commit -m "feat(mobile): add Socket.IO client for real-time updates

- Socket client with auth token injection
- Auto-reconnection with exponential backoff
- useSocket hook for connection management
- useAgentSocket hook for streaming messages
- Session join/leave room management

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Authentication Flow

### Task 2.1: Implement OAuth Login

**Files:**

- Modify: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(auth)/callback.tsx`
- Create: `apps/mobile/src/hooks/useAuth.ts`

**Step 1: Create auth hook**

Create `apps/mobile/src/hooks/useAuth.ts`:

```tsx
import { useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';

WebBrowser.maybeCompleteAuthSession();

export function useAuth() {
  const setUser = useAuthStore((state) => state.setUser);
  const setTokens = useAuthStore((state) => state.setTokens);
  const setLoading = useAuthStore((state) => state.setLoading);
  const setError = useAuthStore((state) => state.setError);
  const logout = useAuthStore((state) => state.logout);

  const loginWithProvider = useCallback(
    async (provider: 'github' | 'google') => {
      try {
        setLoading(true);
        setError(null);

        // Get auth URL from backend
        const { authUrl } = await api.login(provider);

        // Open browser for OAuth
        const redirectUrl = Linking.createURL('auth/callback');
        const result = await WebBrowser.openAuthSessionAsync(
          `${authUrl}&redirect_uri=${encodeURIComponent(redirectUrl)}`,
          redirectUrl
        );

        if (result.type === 'success' && result.url) {
          // Extract tokens from callback URL
          const url = new URL(result.url);
          const accessToken = url.searchParams.get('access_token');
          const refreshToken = url.searchParams.get('refresh_token');
          const expiresAt = url.searchParams.get('expires_at');

          if (accessToken) {
            setTokens({
              accessToken,
              refreshToken: refreshToken || '',
              expiresAt: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600000,
            });

            // Fetch user data
            const user = await api.getCurrentUser();
            setUser(user);
          }
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Login failed');
      } finally {
        setLoading(false);
      }
    },
    [setUser, setTokens, setLoading, setError]
  );

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  return {
    loginWithGitHub: () => loginWithProvider('github'),
    loginWithGoogle: () => loginWithProvider('google'),
    logout: handleLogout,
  };
}
```

**Step 2: Update login screen**

Update `apps/mobile/app/(auth)/login.tsx`:

```tsx
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/auth';
import { Ionicons } from '@expo/vector-icons';

export default function LoginScreen() {
  const { loginWithGitHub, loginWithGoogle } = useAuth();
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>Podex</Text>
        <Text style={styles.tagline}>AI-powered development environment</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, styles.githubButton]}
          onPress={loginWithGitHub}
          disabled={isLoading}
        >
          <Ionicons name="logo-github" size={24} color="#ffffff" />
          <Text style={styles.buttonText}>Continue with GitHub</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={loginWithGoogle}
          disabled={isLoading}
        >
          <Ionicons name="logo-google" size={24} color="#ffffff" />
          <Text style={styles.buttonText}>Continue with Google</Text>
        </TouchableOpacity>
      </View>

      {isLoading && <ActivityIndicator style={styles.loader} color="#ffffff" />}

      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  tagline: {
    fontSize: 16,
    color: '#888888',
    marginTop: 8,
  },
  buttons: {
    width: '100%',
    gap: 16,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  githubButton: {
    backgroundColor: '#24292e',
  },
  googleButton: {
    backgroundColor: '#4285f4',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  loader: {
    marginTop: 24,
  },
  error: {
    color: '#ef4444',
    marginTop: 16,
    textAlign: 'center',
  },
});
```

**Step 3: Add expo-web-browser dependency**

```bash
cd apps/mobile
npx expo install expo-web-browser expo-linking
```

**Step 4: Verify login flow works**

```bash
cd apps/mobile
npx expo start
# Test OAuth flow on device/simulator
```

**Step 5: Commit auth implementation**

```bash
git add apps/mobile/
git commit -m "feat(mobile): implement OAuth login with GitHub and Google

- useAuth hook for OAuth flow with expo-web-browser
- Login screen with provider buttons
- Token extraction from callback URL
- Error handling and loading states

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Core Chat UI

### Task 3.1: Build Session Dashboard

**Files:**

- Modify: `apps/mobile/app/(main)/index.tsx`
- Create: `apps/mobile/src/components/SessionCard.tsx`
- Create: `apps/mobile/src/hooks/useSessions.ts`

**Step 1: Create sessions hook**

Create `apps/mobile/src/hooks/useSessions.ts`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session';

export function useSessions() {
  const setSessions = useSessionStore((state) => state.setSessions);

  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const sessions = await api.getSessions();
      setSessions(sessions);
      return sessions;
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; repositoryUrl?: string }) => api.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
```

**Step 2: Create SessionCard component**

Create `apps/mobile/src/components/SessionCard.tsx`:

```tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@/stores/session';

interface SessionCardProps {
  session: Session;
}

export function SessionCard({ session }: SessionCardProps) {
  const router = useRouter();

  const statusColor = {
    active: '#22c55e',
    paused: '#eab308',
    terminated: '#ef4444',
  }[session.status];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/session/${session.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {session.name}
        </Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>

      <View style={styles.meta}>
        <Ionicons name="git-branch-outline" size={14} color="#888888" />
        <Text style={styles.branch}>{session.branch}</Text>
      </View>

      <View style={styles.agents}>
        <Ionicons name="people-outline" size={14} color="#888888" />
        <Text style={styles.agentCount}>
          {session.agents.length} agent{session.agents.length !== 1 ? 's' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    marginRight: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  branch: {
    fontSize: 13,
    color: '#888888',
  },
  agents: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  agentCount: {
    fontSize: 13,
    color: '#888888',
  },
});
```

**Step 3: Update dashboard screen**

Update `apps/mobile/app/(main)/index.tsx`:

```tsx
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from 'react-native';
import { useSessions } from '@/hooks/useSessions';
import { SessionCard } from '@/components/SessionCard';
import { useUIStore } from '@/stores/ui';
import { Ionicons } from '@expo/vector-icons';

export default function DashboardScreen() {
  const { data: sessions, isLoading, refetch } = useSessions();
  const isRefreshing = useUIStore((state) => state.isRefreshing);
  const setRefreshing = useUIStore((state) => state.setRefreshing);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <SessionCard session={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#ffffff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color="#444444" />
            <Text style={styles.emptyText}>No sessions yet</Text>
            <Text style={styles.emptySubtext}>Create a new session to get started</Text>
          </View>
        }
      />

      <TouchableOpacity style={styles.fab}>
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  list: {
    padding: 16,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
```

**Step 4: Commit dashboard**

```bash
git add apps/mobile/
git commit -m "feat(mobile): build session dashboard with session cards

- useSessions hook with React Query
- SessionCard component with status, branch, agent count
- Pull-to-refresh functionality
- Empty state with guidance
- FAB for creating new sessions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3.2: Build Agent Chat Screen

**Files:**

- Modify: `apps/mobile/app/(main)/session/[id].tsx`
- Create: `apps/mobile/src/components/AgentTabs.tsx`
- Create: `apps/mobile/src/components/MessageList.tsx`
- Create: `apps/mobile/src/components/MessageInput.tsx`
- Create: `apps/mobile/src/components/MessageBubble.tsx`

**Step 1: Create MessageBubble component**

Create `apps/mobile/src/components/MessageBubble.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import type { Message } from '@/stores/session';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.container, isUser && styles.userContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser && styles.userText]}>
          {message.content}
          {message.isStreaming && <Text style={styles.cursor}>▋</Text>}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#3b82f6',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#1a1a1a',
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: '#e0e0e0',
  },
  userText: {
    color: '#ffffff',
  },
  cursor: {
    color: '#3b82f6',
  },
});
```

**Step 2: Create MessageList component**

Create `apps/mobile/src/components/MessageList.tsx`:

```tsx
import { useRef, useEffect } from 'react';
import { FlatList, StyleSheet, View, Text } from 'react-native';
import { MessageBubble } from './MessageBubble';
import { useAgentMessages } from '@/stores/session';

interface MessageListProps {
  agentId: string;
}

export function MessageList({ agentId }: MessageListProps) {
  const messages = useAgentMessages(agentId);
  const listRef = useRef<FlatList>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No messages yet</Text>
        <Text style={styles.emptySubtext}>Send a message to start the conversation</Text>
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: 16,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#888888',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666666',
    marginTop: 4,
    textAlign: 'center',
  },
});
```

**Step 3: Create MessageInput component**

Create `apps/mobile/src/components/MessageInput.tsx`:

```tsx
import { useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session';

interface MessageInputProps {
  sessionId: string;
  agentId: string;
}

export function MessageInput({ sessionId, agentId }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const addMessage = useSessionStore((state) => state.addMessage);

  const handleSend = useCallback(async () => {
    if (!text.trim() || isSending) return;

    const content = text.trim();
    setText('');
    setIsSending(true);

    // Optimistically add user message
    addMessage(agentId, {
      id: `temp-${Date.now()}`,
      agentId,
      role: 'user',
      content,
      timestamp: new Date(),
    });

    try {
      await api.sendMessage(sessionId, agentId, content);
    } catch (error) {
      console.error('Failed to send message:', error);
      // TODO: Show error toast
    } finally {
      setIsSending(false);
    }
  }, [text, isSending, sessionId, agentId, addMessage]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={styles.container}>
        <TouchableOpacity style={styles.attachButton}>
          <Ionicons name="attach" size={24} color="#888888" />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message..."
          placeholderTextColor="#666666"
          multiline
          maxLength={10000}
        />

        <TouchableOpacity
          style={[styles.sendButton, (!text.trim() || isSending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || isSending}
        >
          <Ionicons
            name="send"
            size={20}
            color={text.trim() && !isSending ? '#ffffff' : '#666666'}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  attachButton: {
    padding: 8,
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 8,
    fontSize: 15,
    color: '#ffffff',
    maxHeight: 120,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#1a1a1a',
  },
});
```

**Step 4: Create AgentTabs component**

Create `apps/mobile/src/components/AgentTabs.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { Agent } from '@/stores/session';

interface AgentTabsProps {
  agents: Agent[];
  activeAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

export function AgentTabs({ agents, activeAgentId, onSelectAgent }: AgentTabsProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {agents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          const statusColor = {
            idle: '#22c55e',
            thinking: '#3b82f6',
            executing: '#eab308',
            waiting: '#f97316',
            error: '#ef4444',
          }[agent.status];

          return (
            <TouchableOpacity
              key={agent.id}
              style={[styles.tab, isActive && styles.activeTab]}
              onPress={() => onSelectAgent(agent.id)}
            >
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.tabText, isActive && styles.activeTabText]}>{agent.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tabText: {
    fontSize: 14,
    color: '#888888',
  },
  activeTabText: {
    color: '#ffffff',
    fontWeight: '500',
  },
});
```

**Step 5: Update session screen**

Update `apps/mobile/app/(main)/session/[id].tsx`:

```tsx
import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useAgentSocket } from '@/hooks/useSocket';
import { AgentTabs } from '@/components/AgentTabs';
import { MessageList } from '@/components/MessageList';
import { MessageInput } from '@/components/MessageInput';

export default function SessionScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setCurrentAgentId = useSessionStore((state) => state.setCurrentAgentId);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentAgentId = useSessionStore((state) => state.currentAgentId);

  // Fetch session data
  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.getSession(sessionId!),
    enabled: !!sessionId,
  });

  // Set up socket for real-time updates
  useAgentSocket(sessionId);

  // Set current session and default agent
  useEffect(() => {
    if (session) {
      setCurrentSession(session);
      if (!currentAgentId && session.agents.length > 0) {
        setCurrentAgentId(session.agents[0].id);
      }
    }
  }, [session, currentAgentId, setCurrentSession, setCurrentAgentId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setCurrentSession(null);
      setCurrentAgentId(null);
    };
  }, [setCurrentSession, setCurrentAgentId]);

  if (!currentSession || !currentAgentId) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      <AgentTabs
        agents={currentSession.agents}
        activeAgentId={currentAgentId}
        onSelectAgent={setCurrentAgentId}
      />
      <View style={styles.chat}>
        <MessageList agentId={currentAgentId} />
      </View>
      <MessageInput sessionId={currentSession.id} agentId={currentAgentId} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  chat: {
    flex: 1,
  },
});
```

**Step 6: Verify chat works end-to-end**

```bash
cd apps/mobile
npx expo start
# Test: Login, view sessions, open session, switch agents, send message
```

**Step 7: Commit chat implementation**

```bash
git add apps/mobile/
git commit -m "feat(mobile): build core agent chat UI with streaming

- AgentTabs for switching between agents with status indicators
- MessageList with auto-scroll to latest message
- MessageBubble with user/assistant styling and streaming cursor
- MessageInput with keyboard handling and optimistic updates
- Session screen integrating all chat components
- Socket integration for real-time message streaming

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Widget Bottom Sheets

### Task 4.1: Implement Bottom Sheet Infrastructure

**Files:**

- Create: `apps/mobile/src/components/WidgetSheet.tsx`
- Create: `apps/mobile/src/components/sheets/FilesSheet.tsx`
- Modify: `apps/mobile/app/(main)/session/[id].tsx`

**Step 1: Install bottom sheet**

```bash
cd apps/mobile
npx expo install @gorhom/bottom-sheet
```

**Step 2: Create WidgetSheet wrapper**

Create `apps/mobile/src/components/WidgetSheet.tsx`:

```tsx
import { useCallback, useMemo, forwardRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { useUIStore } from '@/stores/ui';

interface WidgetSheetProps {
  title: string;
  children: React.ReactNode;
}

export const WidgetSheet = forwardRef<BottomSheet, WidgetSheetProps>(({ title, children }, ref) => {
  const closeWidget = useUIStore((state) => state.closeWidget);
  const snapPoints = useMemo(() => ['50%', '90%'], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ),
    []
  );

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={closeWidget}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.indicator}
    >
      <BottomSheetView style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={closeWidget} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#888888" />
          </TouchableOpacity>
        </View>
        {children}
      </BottomSheetView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  background: {
    backgroundColor: '#1a1a1a',
  },
  indicator: {
    backgroundColor: '#444444',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  closeButton: {
    padding: 4,
  },
});
```

**Step 3: Create FilesSheet**

Create `apps/mobile/src/components/sheets/FilesSheet.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/lib/api';
import { useUIStore } from '@/stores/ui';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

interface FilesSheetProps {
  sessionId: string;
}

export function FilesSheet({ sessionId }: FilesSheetProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const showFile = useUIStore((state) => state.showFile);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, sessionId]);

  const loadFiles = async (path: string) => {
    setIsLoading(true);
    try {
      const result = await api.listFiles(sessionId, path);
      setFiles(result.files || []);
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilePress = async (item: FileItem) => {
    if (item.type === 'directory') {
      setCurrentPath(item.path);
    } else {
      try {
        const { content } = await api.getFile(sessionId, item.path);
        const ext = item.name.split('.').pop() || 'txt';
        showFile(item.path, content, ext);
      } catch (error) {
        console.error('Failed to load file:', error);
      }
    }
  };

  const handleBack = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  const renderItem = ({ item }: { item: FileItem }) => (
    <TouchableOpacity style={styles.item} onPress={() => handleFilePress(item)}>
      <Ionicons
        name={item.type === 'directory' ? 'folder' : 'document-outline'}
        size={20}
        color={item.type === 'directory' ? '#3b82f6' : '#888888'}
      />
      <Text style={styles.itemName} numberOfLines={1}>
        {item.name}
      </Text>
      {item.type === 'directory' && <Ionicons name="chevron-forward" size={16} color="#666666" />}
    </TouchableOpacity>
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {currentPath && (
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={20} color="#888888" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={files}
        keyExtractor={(item) => item.path}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    gap: 8,
  },
  backText: {
    color: '#888888',
    fontSize: 14,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
  },
  separator: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginLeft: 48,
  },
});
```

**Step 4: Add widget toolbar to session screen**

Update `apps/mobile/app/(main)/session/[id].tsx` to add widget toolbar and sheets.

**Step 5: Commit widget sheets**

```bash
git add apps/mobile/
git commit -m "feat(mobile): add bottom sheet widgets for files

- WidgetSheet wrapper with snap points and backdrop
- FilesSheet with directory navigation
- File preview integration with UI store
- Widget toolbar for quick access

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Push Notifications

### Task 5.1: Set Up Push Notifications

**Files:**

- Create: `apps/mobile/src/lib/notifications.ts`
- Create: `apps/mobile/src/hooks/useNotifications.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Step 1: Create notifications lib**

Create `apps/mobile/src/lib/notifications.ts`:

```tsx
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = await Notifications.getExpoPushTokenAsync({ projectId });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  return token.data;
}
```

**Step 2: Create notifications hook**

Create `apps/mobile/src/hooks/useNotifications.ts`:

```tsx
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { registerForPushNotifications } from '@/lib/notifications';
import { useIsAuthenticated } from '@/stores/auth';

export function useNotifications() {
  const router = useRouter();
  const isAuthenticated = useIsAuthenticated();
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    if (!isAuthenticated) return;

    // Register for push notifications
    registerForPushNotifications().then((token) => {
      if (token) {
        // TODO: Send token to backend
        console.log('Push token:', token);
      }
    });

    // Handle notifications received while app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification);
    });

    // Handle notification taps
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data.sessionId) {
        router.push(`/session/${data.sessionId}`);
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [isAuthenticated, router]);
}
```

**Step 3: Add to root layout**

Add `useNotifications()` call to `apps/mobile/app/_layout.tsx`.

**Step 4: Commit push notifications**

```bash
git add apps/mobile/
git commit -m "feat(mobile): implement push notification support

- Register for Expo push notifications
- Handle foreground and background notifications
- Deep link to session from notification tap
- Android notification channel setup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Polish & App Store Preparation

### Task 6.1: Add Splash Screen & App Icon

**Files:**

- Create: `apps/mobile/assets/icon.png` (1024x1024)
- Create: `apps/mobile/assets/splash-icon.png` (288x288)
- Create: `apps/mobile/assets/adaptive-icon.png` (1024x1024)
- Modify: `apps/mobile/app.json`

### Task 6.2: Configure EAS Build

**Files:**

- Create: `apps/mobile/eas.json`

**Step 1: Create EAS configuration**

Create `apps/mobile/eas.json`:

```json
{
  "cli": {
    "version": ">= 12.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "production": {
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "your-app-store-connect-app-id"
      },
      "android": {
        "serviceAccountKeyPath": "./google-services.json",
        "track": "internal"
      }
    }
  }
}
```

### Task 6.3: Final Testing Checklist

- [ ] Login with GitHub works
- [ ] Login with Google works
- [ ] Session list loads and refreshes
- [ ] Can open session and see agents
- [ ] Can switch between agents
- [ ] Can send messages
- [ ] Messages stream in real-time
- [ ] Can open file browser
- [ ] Push notifications work
- [ ] App handles offline gracefully
- [ ] No crashes in production build

### Task 6.4: Submit to App Stores

```bash
# Build for iOS
eas build --platform ios --profile production

# Build for Android
eas build --platform android --profile production

# Submit to App Store
eas submit --platform ios

# Submit to Google Play
eas submit --platform android
```

---

## Summary

| Phase | Tasks                                  | Outcome                |
| ----- | -------------------------------------- | ---------------------- |
| 1     | Setup, Navigation, Stores, API, Socket | Infrastructure ready   |
| 2     | OAuth Login                            | Users can authenticate |
| 3     | Dashboard, Chat UI                     | Core chat experience   |
| 4     | Bottom Sheet Widgets                   | Files, Git access      |
| 5     | Push Notifications                     | Background updates     |
| 6     | Polish, App Store                      | Production release     |

---

## Key Files Reference

| Purpose        | Path                                          |
| -------------- | --------------------------------------------- |
| Root Layout    | `apps/mobile/app/_layout.tsx`                 |
| Auth Store     | `apps/mobile/src/stores/auth.ts`              |
| Session Store  | `apps/mobile/src/stores/session.ts`           |
| API Client     | `apps/mobile/src/lib/api.ts`                  |
| Socket Client  | `apps/mobile/src/lib/socket.ts`               |
| Dashboard      | `apps/mobile/app/(main)/index.tsx`            |
| Session Screen | `apps/mobile/app/(main)/session/[id].tsx`     |
| Message List   | `apps/mobile/src/components/MessageList.tsx`  |
| Message Input  | `apps/mobile/src/components/MessageInput.tsx` |
