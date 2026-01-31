/**
 * Session management commands.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getSessionService } from '../services/session-service';
import { getAuthService } from '../services/auth-service';
import type { SessionsListOptions } from '../types/commands';

/**
 * Register sessions commands.
 */
export function registerSessionsCommands(program: Command): void {
  const sessions = program.command('sessions').description('Session management commands');

  sessions
    .command('list')
    .description('List your sessions')
    .option('-f, --format <format>', 'Output format (table or json)', 'table')
    .option('-l, --limit <number>', 'Maximum sessions to show', '20')
    .action(async (options: SessionsListOptions) => {
      const authService = getAuthService();

      if (!authService.isAuthenticated()) {
        console.log(chalk.red('Not authenticated. Run `podex auth login` first.'));
        process.exit(1);
      }

      try {
        const sessionService = getSessionService();
        const limit = parseInt(String(options.limit || '20'), 10);
        const { sessions, total } = await sessionService.listSessions(limit, 0);

        if (options.format === 'json') {
          console.log(JSON.stringify(sessions, null, 2));
          return;
        }

        if (sessions.length === 0) {
          console.log(chalk.yellow('No sessions found'));
          console.log(chalk.gray('Run `podex` to start a new session'));
          return;
        }

        console.log(chalk.bold(`Sessions (${sessions.length} of ${total}):`));
        console.log('');

        for (const session of sessions) {
          const statusColor =
            session.status === 'active'
              ? chalk.green
              : session.status === 'paused'
                ? chalk.yellow
                : chalk.gray;

          const agentCount = session.agents?.length || 0;
          const createdAt = new Date(session.createdAt).toLocaleString();

          console.log(`  ${chalk.bold(session.name || 'Unnamed Session')}`);
          console.log(`    ${chalk.gray('ID:')} ${session.id}`);
          console.log(`    ${chalk.gray('Status:')} ${statusColor(session.status)}`);
          console.log(`    ${chalk.gray('Branch:')} ${session.branch || 'main'}`);
          console.log(`    ${chalk.gray('Agents:')} ${agentCount}`);
          console.log(`    ${chalk.gray('Created:')} ${createdAt}`);
          console.log('');
        }

        if (total > sessions.length) {
          console.log(chalk.gray(`  ... and ${total - sessions.length} more`));
        }
      } catch (error) {
        console.error(chalk.red(`Failed to list sessions: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  sessions
    .command('delete <sessionId>')
    .description('Delete a session')
    .option('-f, --force', 'Delete without confirmation')
    .action(async (sessionId: string, options: { force?: boolean }) => {
      const authService = getAuthService();

      if (!authService.isAuthenticated()) {
        console.log(chalk.red('Not authenticated. Run `podex auth login` first.'));
        process.exit(1);
      }

      try {
        const sessionService = getSessionService();

        // Get session info first
        const session = await sessionService.getSession(sessionId);

        if (!options.force) {
          console.log(
            chalk.yellow(`Are you sure you want to delete session "${session.name || sessionId}"?`)
          );
          console.log(chalk.gray('Use --force to skip this confirmation'));
          return;
        }

        await sessionService.deleteSession(sessionId);
        console.log(chalk.green(`Session "${session.name || sessionId}" deleted`));
      } catch (error) {
        console.error(chalk.red(`Failed to delete session: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  sessions
    .command('info <sessionId>')
    .description('Show session details')
    .action(async (sessionId: string) => {
      const authService = getAuthService();

      if (!authService.isAuthenticated()) {
        console.log(chalk.red('Not authenticated. Run `podex auth login` first.'));
        process.exit(1);
      }

      try {
        const sessionService = getSessionService();
        const session = await sessionService.getSession(sessionId);

        console.log(chalk.bold('Session Details'));
        console.log('');
        console.log(`  ${chalk.gray('Name:')} ${session.name || 'Unnamed Session'}`);
        console.log(`  ${chalk.gray('ID:')} ${session.id}`);
        console.log(`  ${chalk.gray('Status:')} ${session.status}`);
        console.log(`  ${chalk.gray('Branch:')} ${session.branch || 'main'}`);
        console.log(`  ${chalk.gray('Workspace:')} ${session.workspaceId || 'none'}`);
        console.log(`  ${chalk.gray('Created:')} ${new Date(session.createdAt).toLocaleString()}`);
        console.log(`  ${chalk.gray('Updated:')} ${new Date(session.updatedAt).toLocaleString()}`);

        if (session.agents && session.agents.length > 0) {
          console.log('');
          console.log(chalk.bold('  Agents:'));
          for (const agent of session.agents) {
            const statusColor =
              agent.status === 'idle'
                ? chalk.green
                : agent.status === 'thinking' || agent.status === 'executing'
                  ? chalk.cyan
                  : agent.status === 'error'
                    ? chalk.red
                    : chalk.gray;

            console.log(`    - ${agent.name} (${agent.role}) - ${statusColor(agent.status)}`);
          }
        }
      } catch (error) {
        console.error(chalk.red(`Failed to get session: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
