/**
 * Authentication-related types.
 */

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

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
  access_token: string | null; // null when using httpOnly cookies in production
  refresh_token: string | null; // null when using httpOnly cookies in production
  expires_in: number;
}

export interface TokenResponse {
  access_token: string | null; // null when using httpOnly cookies in production
  refresh_token: string | null; // null when using httpOnly cookies in production
  token_type: string;
  expires_in: number;
}

export interface OAuthURLResponse {
  url: string;
  state: string;
}

export interface OAuthTokenResponse {
  access_token: string | null; // null when using httpOnly cookies in production
  refresh_token: string | null; // null when using httpOnly cookies in production
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
}
