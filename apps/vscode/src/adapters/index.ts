/**
 * Adapter exports.
 */

export {
  createFileStorageAdapter,
  readConfigFile,
  writeConfigFile,
  deleteConfigFile,
  configFileExists,
  getConfigFilePath,
} from './vscode-storage-adapter';

export {
  createVSCodeAuthProvider,
  initializeAuthProvider,
  getAuthProvider,
  type VSCodeAuthProvider,
} from './vscode-auth-provider';

export { createNodeHttpAdapter } from './vscode-http-adapter';
