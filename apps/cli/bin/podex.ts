#!/usr/bin/env node
/**
 * Podex CLI entry point.
 */

import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import chalk from 'chalk';
import { registerCommands } from '../src/commands';
import type { ChatOptions } from '../src/types/commands';

const program = new Command();

program.name('podex').description('Podex CLI - AI-powered development assistant').version('0.1.0');

// Register subcommands
registerCommands(program);

// Chat command (explicit)
program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-s, --session <id>', 'Resume an existing session')
  .option('--local', 'Use local pod instead of cloud')
  .action(async (options: ChatOptions) => {
    await startInteractiveMode(options);
  });

// Default action (no subcommand) = interactive mode
program.action(async (options: ChatOptions) => {
  // If no subcommand, start interactive mode
  await startInteractiveMode(options);
});

// Global options
program
  .option('--local', 'Use local pod instead of cloud')
  .option('-s, --session <id>', 'Resume an existing session')
  .option('--debug', 'Enable debug output');

/**
 * Start interactive chat mode.
 * Authentication is handled within the App component if needed.
 */
async function startInteractiveMode(options: ChatOptions) {
  console.log(chalk.blue('Starting Podex interactive mode...'));

  // Import dynamically to avoid loading React on non-interactive commands
  const { App } = await import('../src/app/App');

  const { waitUntilExit } = render(
    React.createElement(App, {
      mode: 'interactive',
      sessionId: options.session,
      local: options.local,
    })
  );

  await waitUntilExit();
}

// Parse arguments
program.parse();
