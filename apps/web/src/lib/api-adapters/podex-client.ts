/**
 * Podex-specific API client extending BaseApiClient.
 * Adds auth methods with response transformation.
 */

import {
  BaseApiClient,
  calculateExpiry,
  type ApiClientConfig,
  type AuthResponse,
  type TokenResponse,
} from '@podex/api-client';
import type { User, AuthTokens } from '@/stores/auth';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  invitation_token?: string;
}

/**
 * Transform snake_case API response to camelCase User.
 */
function transformUser(data: AuthResponse['user']): User {
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatar_url,
    role: data.role,
  };
}

export class PodexApiClient extends BaseApiClient {
  constructor(config: ApiClientConfig) {
    super(config);
  }

  /**
   * Login and get user with tokens.
   */
  async login(data: LoginRequest): Promise<{ user: User; tokens: AuthTokens }> {
    const response = await this.post<AuthResponse>('/api/auth/login', data, false);
    return {
      user: transformUser(response.user),
      tokens: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: calculateExpiry(response.expires_in),
      },
    };
  }

  /**
   * Register and get user with tokens.
   */
  async register(data: RegisterRequest): Promise<{ user: User; tokens: AuthTokens }> {
    const response = await this.post<AuthResponse>('/api/auth/register', data, false);
    return {
      user: transformUser(response.user),
      tokens: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: calculateExpiry(response.expires_in),
      },
    };
  }

  /**
   * Refresh tokens.
   */
  async refreshToken(refreshToken?: string | null): Promise<AuthTokens> {
    const body = refreshToken ? { refresh_token: refreshToken } : {};
    const response = await this.post<TokenResponse>('/api/auth/refresh', body, false);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: calculateExpiry(response.expires_in),
    };
  }

  /**
   * Get current user.
   */
  async getCurrentUser(): Promise<User> {
    const response = await this.get<AuthResponse['user']>('/api/auth/me');
    return transformUser(response);
  }
}
