/**
 * CLI command registration.
 */

import type { Command } from 'commander';
import { registerAuthCommands } from './auth';
import { registerSessionsCommands } from './sessions';
import { registerConfigCommands } from './config';
import { registerRunCommand } from './run';

/**
 * Register all CLI commands.
 */
export function registerCommands(program: Command): void {
  registerAuthCommands(program);
  registerSessionsCommands(program);
  registerConfigCommands(program);
  registerRunCommand(program);
}

export { registerAuthCommands } from './auth';
export { registerSessionsCommands } from './sessions';
export { registerConfigCommands } from './config';
export { registerRunCommand } from './run';
