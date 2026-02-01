/**
 * Authentication commands for the Podex extension.
 */

import * as vscode from 'vscode';
import { getAuthProvider } from '../adapters';
import { CONTEXT_KEYS, DEFAULT_API_URL } from '../utils/constants';
import { logInfo, logError, showOutput } from '../utils/logger';

/**
 * Login command - initiates device flow authentication.
 */
export async function loginCommand(): Promise<void> {
  const authProvider = getAuthProvider();

  if (authProvider.isAuthenticated()) {
    const creds = authProvider.getCredentials();
    vscode.window.showInformationMessage(
      `Already logged in as ${creds?.email || creds?.userId || 'user'}`
    );
    return;
  }

  try {
    // Get API URL from settings
    const config = vscode.workspace.getConfiguration('podex');
    const apiUrl = config.get<string>('apiUrl', DEFAULT_API_URL);

    // Show progress while authenticating
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Podex: Logging in...',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Requesting device code...' });

        // Request device code from API
        const response = await fetch(`${apiUrl}/api/v1/auth/device/code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: 'vscode-extension',
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to request device code: ${response.statusText}`);
        }

        const deviceCodeResponse = (await response.json()) as {
          device_code: string;
          user_code: string;
          verification_uri: string;
          expires_in: number;
          interval: number;
        };

        const { device_code, user_code, verification_uri, interval } = deviceCodeResponse;

        logInfo(`Device code received, user code: ${user_code}`);

        // Show user code and open browser
        const openBrowser = await vscode.window.showInformationMessage(
          `Enter code: ${user_code}`,
          { modal: false },
          'Open Browser',
          'Copy Code'
        );

        if (openBrowser === 'Open Browser') {
          await vscode.env.openExternal(vscode.Uri.parse(verification_uri));
        } else if (openBrowser === 'Copy Code') {
          await vscode.env.clipboard.writeText(user_code);
          vscode.window.showInformationMessage(`Code copied: ${user_code}`);
          await vscode.env.openExternal(vscode.Uri.parse(verification_uri));
        }

        // Poll for token
        progress.report({ message: 'Waiting for authorization...' });

        let pollInterval = interval * 1000;
        const maxAttempts = 60; // 5 minutes with 5s interval
        let attempts = 0;

        while (!token.isCancellationRequested && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          attempts++;

          try {
            const tokenResponse = await fetch(`${apiUrl}/api/v1/auth/device/token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              }),
            });

            if (tokenResponse.ok) {
              const tokens = (await tokenResponse.json()) as {
                access_token: string;
                refresh_token: string;
                expires_in: number;
                token_type: string;
              };

              // Calculate expiration timestamp
              const expiresAt = Date.now() + tokens.expires_in * 1000;

              // Fetch user info
              const userResponse = await fetch(`${apiUrl}/api/v1/users/me`, {
                headers: {
                  Authorization: `Bearer ${tokens.access_token}`,
                },
              });

              let userId: string | undefined;
              let email: string | undefined;

              if (userResponse.ok) {
                const user = (await userResponse.json()) as { id: string; email: string };
                userId = user.id;
                email = user.email;
              }

              // Store credentials
              authProvider.setCredentials({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt,
                userId,
                email,
              });

              // Update context
              await vscode.commands.executeCommand(
                'setContext',
                CONTEXT_KEYS.isAuthenticated,
                true
              );

              logInfo(`Login successful: ${email || userId || 'user'}`);
              vscode.window.showInformationMessage(`Logged in as ${email || 'user'}`);

              return;
            }

            // Handle polling errors
            const errorResponse = (await tokenResponse.json()) as { error: string };

            if (errorResponse.error === 'authorization_pending') {
              // User hasn't completed auth yet, continue polling
              continue;
            } else if (errorResponse.error === 'slow_down') {
              // Server is asking us to slow down
              pollInterval += 5000;
              continue;
            } else if (errorResponse.error === 'expired_token') {
              throw new Error('Device code expired. Please try again.');
            } else if (errorResponse.error === 'access_denied') {
              throw new Error('Authorization was denied.');
            } else {
              throw new Error(`Authentication failed: ${errorResponse.error}`);
            }
          } catch (pollError) {
            if (pollError instanceof Error && pollError.message.includes('expired')) {
              throw pollError;
            }
            // Network error, continue polling
            logError('Poll error', pollError);
          }
        }

        if (token.isCancellationRequested) {
          logInfo('Login cancelled by user');
          return;
        }

        throw new Error('Authentication timed out. Please try again.');
      }
    );
  } catch (error) {
    logError('Login failed', error);
    showOutput();
    vscode.window.showErrorMessage(
      `Login failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Logout command - clears credentials.
 */
export async function logoutCommand(): Promise<void> {
  const authProvider = getAuthProvider();

  if (!authProvider.isAuthenticated()) {
    vscode.window.showInformationMessage('Not logged in');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Are you sure you want to log out?',
    { modal: true },
    'Log Out'
  );

  if (confirm !== 'Log Out') {
    return;
  }

  authProvider.clearCredentials();

  // Update context
  await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.isAuthenticated, false);

  logInfo('Logged out');
  vscode.window.showInformationMessage('Logged out successfully');
}

/**
 * Status command - shows current authentication status.
 */
export async function statusCommand(): Promise<void> {
  const authProvider = getAuthProvider();

  if (authProvider.isAuthenticated()) {
    const creds = authProvider.getCredentials();
    const expiresIn = creds ? Math.round((creds.expiresAt - Date.now()) / 1000 / 60) : 0;

    vscode.window.showInformationMessage(
      `Logged in as ${creds?.email || creds?.userId || 'user'}\nToken expires in ${expiresIn} minutes`
    );
  } else if (authProvider.isTokenExpired()) {
    vscode.window.showWarningMessage('Session expired. Please log in again.');
  } else {
    vscode.window.showInformationMessage('Not logged in');
  }
}

/**
 * Register authentication commands.
 */
export function registerAuthCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('podex.login', loginCommand),
    vscode.commands.registerCommand('podex.logout', logoutCommand),
    vscode.commands.registerCommand('podex.status', statusCommand)
  );
}
