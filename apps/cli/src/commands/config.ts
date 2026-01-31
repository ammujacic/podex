/**
 * Configuration commands.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';
import { getCliConfigStore } from '../stores/cli-config';
import type { CliConfig } from '../types/config';

type ConfigKey = keyof CliConfig;

/**
 * Register config commands.
 */
export function registerConfigCommands(program: Command): void {
  const config = program.command('config').description('Configuration commands');

  config
    .command('get [key]')
    .description('Get configuration value(s)')
    .action((key?: string) => {
      const configStore = getCliConfigStore();
      const state = configStore.getState();

      if (key) {
        if (!(key in state) || typeof state[key as ConfigKey] === 'function') {
          console.log(chalk.red(`Unknown configuration key: ${key}`));
          console.log(chalk.gray('Available keys: apiUrl, defaultLocal, autoApprove, debug'));
          process.exit(1);
        }

        const value = state[key as ConfigKey];
        if (Array.isArray(value)) {
          console.log(value.length > 0 ? value.join(', ') : '(empty)');
        } else {
          console.log(String(value));
        }
        return;
      }

      // Show all config
      console.log(chalk.bold('Current Configuration'));
      console.log('');
      console.log(`  ${chalk.gray('apiUrl:')} ${state.apiUrl}`);
      console.log(`  ${chalk.gray('defaultLocal:')} ${state.defaultLocal}`);
      console.log(
        `  ${chalk.gray('autoApprove:')} ${
          state.autoApprove.length > 0 ? state.autoApprove.join(', ') : '(none)'
        }`
      );
      console.log(`  ${chalk.gray('maxMessageHistory:')} ${state.maxMessageHistory}`);
      console.log(`  ${chalk.gray('debug:')} ${state.debug}`);
    });

  config
    .command('set <key> <value>')
    .description('Set configuration value')
    .action((key: string, value: string) => {
      const configStore = getCliConfigStore();

      const validKeys = ['apiUrl', 'defaultLocal', 'autoApprove', 'maxMessageHistory', 'debug'];
      if (!validKeys.includes(key)) {
        console.log(chalk.red(`Unknown configuration key: ${key}`));
        console.log(chalk.gray(`Available keys: ${validKeys.join(', ')}`));
        process.exit(1);
      }

      try {
        switch (key) {
          case 'apiUrl':
            // Validate URL
            new URL(value);
            configStore.getState().setApiUrl(value);
            break;

          case 'defaultLocal':
            configStore.getState().setDefaultLocal(value === 'true');
            break;

          case 'autoApprove': {
            // Comma-separated list
            const categories = value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            configStore.getState().setAutoApprove(categories);
            break;
          }

          case 'maxMessageHistory': {
            const num = parseInt(value, 10);
            if (isNaN(num) || num < 1) {
              throw new Error('maxMessageHistory must be a positive number');
            }
            configStore.getState().set('maxMessageHistory', num);
            break;
          }

          case 'debug':
            configStore.getState().setDebug(value === 'true');
            break;
        }

        console.log(chalk.green(`Set ${key} = ${value}`));
      } catch (error) {
        console.error(chalk.red(`Failed to set ${key}: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  config
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      const configStore = getCliConfigStore();
      configStore.getState().reset();
      console.log(chalk.green('Configuration reset to defaults'));
    });

  config
    .command('path')
    .description('Show configuration file path')
    .action(() => {
      const configPath = path.join(os.homedir(), '.podex', 'config.json');
      console.log(configPath);
    });
}
