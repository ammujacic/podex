/**
 * User configuration API client
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { api } from '@/lib/api';

interface UserConfig {
  id: string;
  user_id: string;
  default_shell: string;
  git_name: string | null;
  git_email: string | null;
  default_template_id: string | null;
  theme: string;
  custom_keybindings: Record<string, any> | null;
  editor_settings: Record<string, any> | null;
  ui_preferences: Record<string, any> | null;
  voice_preferences: Record<string, any> | null;
  agent_preferences: Record<string, any> | null;
}

interface UpdateUserConfigRequest {
  default_shell?: string;
  git_name?: string | null;
  git_email?: string | null;
  default_template_id?: string | null;
  theme?: string;
  custom_keybindings?: Record<string, any> | null;
  editor_settings?: Record<string, any> | null;
  ui_preferences?: Record<string, any> | null;
  voice_preferences?: Record<string, any> | null;
  agent_preferences?: Record<string, any> | null;
}

/**
 * Get user configuration
 * Returns null if user is not authenticated or config doesn't exist
 */
export async function getUserConfig(): Promise<UserConfig | null> {
  try {
    return await api.get<UserConfig>('/api/user/config');
  } catch (error: any) {
    // 401/404 are expected for unauthenticated users or first-time access
    if (error.status === 401 || error.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Update user configuration (partial update)
 * Returns null if user is not authenticated or during initialization
 */
export async function updateUserConfig(
  updates: UpdateUserConfigRequest
): Promise<UserConfig | null> {
  try {
    return await api.patch<UserConfig>('/api/user/config', updates);
  } catch (error: any) {
    // 401/404 are expected for unauthenticated users or during initialization - silently skip sync
    if (error.status === 401 || error.status === 404) {
      return null;
    }
    throw error;
  }
}
