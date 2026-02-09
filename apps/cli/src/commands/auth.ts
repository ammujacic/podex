/**
 * Authentication commands.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import qrcode from 'qrcode-terminal';
import { getAuthService } from '../services/auth-service';
import type { AuthLoginOptions } from '../types/commands';

/**
 * Register auth commands.
 */
export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Log in to Podex')
    .option('--no-browser', 'Do not open browser automatically')
    .action(async (options: AuthLoginOptions) => {
      const authService = getAuthService();

      if (authService.isAuthenticated()) {
        const creds = authService.getCredentials();
        console.log(chalk.yellow(`Already logged in as ${creds?.email || 'unknown'}`));
        console.log(chalk.gray('Run `podex auth logout` to log out first'));
        return;
      }

      console.log(chalk.blue('Starting device authentication...'));

      try {
        const deviceCode = await authService.initiateDeviceAuth();

        console.log();
        console.log(chalk.bold('To authenticate, visit:'));
        console.log(chalk.cyan(deviceCode.verification_uri_complete));
        console.log();
        console.log(chalk.bold('Or scan this QR code:'));
        qrcode.generate(deviceCode.verification_uri_complete, { small: true });
        console.log();
        console.log(chalk.gray(`Your code: ${chalk.bold(deviceCode.user_code)}`));
        console.log(chalk.gray(`Expires in ${Math.floor(deviceCode.expires_in / 60)} minutes`));
        console.log();

        // Open browser if allowed
        if (options.noBrowser !== true) {
          console.log(chalk.gray('Opening browser...'));
          await authService.openBrowser(deviceCode.verification_uri_complete);
        }

        console.log(chalk.gray('Waiting for authentication...'));

        // Poll for completion
        let dots = 0;
        await authService.pollForToken(deviceCode.device_code, deviceCode.interval, () => {
          // Show progress dots
          dots = (dots + 1) % 4;
          process.stdout.write(
            `\r${chalk.gray('Waiting' + '.'.repeat(dots) + ' '.repeat(3 - dots))}`
          );
        });

        console.log('\r' + ' '.repeat(20)); // Clear the waiting line

        const user = await authService.getCurrentUser();
        console.log(chalk.green(`Successfully logged in as ${user?.email || 'unknown'}`));
      } catch (error) {
        console.error(chalk.red(`Authentication failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Log out from Podex')
    .action(async () => {
      const authService = getAuthService();

      if (!authService.isAuthenticated()) {
        console.log(chalk.yellow('Not logged in'));
        return;
      }

      try {
        await authService.logout();
        console.log(chalk.green('Successfully logged out'));
      } catch (error) {
        console.error(chalk.red(`Logout failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  auth
    .command('status')
    .description('Show authentication status')
    .action(async () => {
      const authService = getAuthService();
      const creds = authService.getCredentials();

      if (!creds) {
        console.log(chalk.yellow('Not logged in'));
        console.log(chalk.gray('Run `podex auth login` to authenticate'));
        return;
      }

      const isExpired = Date.now() >= creds.expiresAt;
      const expiresIn = Math.max(0, Math.floor((creds.expiresAt - Date.now()) / 1000 / 60));

      console.log(chalk.bold('Authentication Status'));
      console.log('');
      console.log(`  ${chalk.gray('Email:')} ${creds.email || 'unknown'}`);
      console.log(`  ${chalk.gray('User ID:')} ${creds.userId || 'unknown'}`);
      console.log(
        `  ${chalk.gray('Status:')} ${
          isExpired
            ? chalk.red('Token expired')
            : chalk.green(`Valid (expires in ${expiresIn} minutes)`)
        }`
      );

      if (isExpired) {
        console.log('');
        console.log(chalk.gray('Run `podex auth login` to re-authenticate'));
      }
    });
}
