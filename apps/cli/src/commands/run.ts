/**
 * Run command for one-shot task execution.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { render } from 'ink';
import React from 'react';
import { getAuthService } from '../services/auth-service';
import type { RunOptions } from '../types/commands';

/**
 * Register run command.
 */
export function registerRunCommand(program: Command): void {
  program
    .command('run <task>')
    .description('Run a one-shot task')
    .option('-s, --session <id>', 'Resume an existing session')
    .option('--local', 'Use local pod instead of cloud')
    .option('--exit', 'Exit after task completion')
    .action(async (task: string, options: RunOptions) => {
      const authService = getAuthService();

      if (!authService.isAuthenticated()) {
        console.log(chalk.red('Not authenticated. Run `podex auth login` first.'));
        process.exit(1);
      }

      console.log(chalk.blue(`Running task: ${task}`));
      console.log(chalk.gray('Starting Podex...'));

      // Import dynamically to avoid loading React on non-interactive commands
      const { App } = await import('../app/App');

      const { waitUntilExit } = render(
        React.createElement(App, {
          mode: 'run',
          task,
          sessionId: options.session,
          local: options.local,
          exitOnComplete: options.exit,
        })
      );

      await waitUntilExit();
    });
}
