/**
 * Global setup for vitest - runs once before all tests.
 * Ensures coverage temp directory exists to avoid race conditions with v8 coverage.
 */

import * as fs from 'fs';
import * as path from 'path';

export default function globalSetup() {
  const coverageTmpDir = path.join(__dirname, '..', 'coverage', '.tmp');
  if (!fs.existsSync(coverageTmpDir)) {
    fs.mkdirSync(coverageTmpDir, { recursive: true });
  }
}
