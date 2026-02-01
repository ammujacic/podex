/**
 * Extension logging utility.
 */

import * as vscode from 'vscode';
import { EXTENSION_NAME } from './constants';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Get or create the output channel for logging.
 */
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME);
  }
  return outputChannel;
}

/**
 * Log an info message.
 */
export function logInfo(message: string): void {
  const channel = getOutputChannel();
  channel.appendLine(`[INFO] ${new Date().toISOString()} - ${message}`);
}

/**
 * Log a warning message.
 */
export function logWarning(message: string): void {
  const channel = getOutputChannel();
  channel.appendLine(`[WARN] ${new Date().toISOString()} - ${message}`);
}

/**
 * Log an error message.
 */
export function logError(message: string, error?: unknown): void {
  const channel = getOutputChannel();
  channel.appendLine(`[ERROR] ${new Date().toISOString()} - ${message}`);
  if (error) {
    if (error instanceof Error) {
      channel.appendLine(`  ${error.message}`);
      if (error.stack) {
        channel.appendLine(`  ${error.stack}`);
      }
    } else {
      channel.appendLine(`  ${String(error)}`);
    }
  }
}

/**
 * Log a debug message (only in development).
 */
export function logDebug(message: string): void {
  if (process.env.NODE_ENV !== 'production') {
    const channel = getOutputChannel();
    channel.appendLine(`[DEBUG] ${new Date().toISOString()} - ${message}`);
  }
}

/**
 * Show the output channel.
 */
export function showOutput(): void {
  getOutputChannel().show();
}

/**
 * Dispose the output channel.
 */
export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
