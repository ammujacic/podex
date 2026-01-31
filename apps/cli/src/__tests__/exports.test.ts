/**
 * Tests for export paths.
 */

import { describe, it, expect } from 'vitest';

describe('Export paths', () => {
  describe('components/index', () => {
    it('should export common components', async () => {
      const components = await import('../components');
      expect(components.Spinner).toBeDefined();
      expect(components.ErrorBox).toBeDefined();
      expect(components.SuccessBox).toBeDefined();
    });

    it('should export layout components', async () => {
      const components = await import('../components');
      expect(components.Header).toBeDefined();
      expect(components.StatusBar).toBeDefined();
    });
  });

  describe('services/index', () => {
    it('should export services', async () => {
      const services = await import('../services');
      expect(services.getApiClient).toBeDefined();
      expect(services.getAuthService).toBeDefined();
      expect(services.getSocketClient).toBeDefined();
      expect(services.getSessionService).toBeDefined();
    });
  });

  describe('hooks/index', () => {
    it('should export hooks', async () => {
      const hooks = await import('../hooks');
      expect(hooks.useSession).toBeDefined();
      expect(hooks.useSocket).toBeDefined();
      expect(hooks.useLocalPod).toBeDefined();
    });
  });

  describe('theme/index', () => {
    it('should export theme utilities', async () => {
      const theme = await import('../theme');
      expect(theme.colors).toBeDefined();
      expect(theme.terminalColors).toBeDefined();
      expect(theme.spacing).toBeDefined();
      expect(theme.borders).toBeDefined();
    });
  });

  describe('commands/index', () => {
    it('should export command registrations', async () => {
      const commands = await import('../commands');
      expect(commands.registerAuthCommands).toBeDefined();
      expect(commands.registerConfigCommands).toBeDefined();
      expect(commands.registerSessionsCommands).toBeDefined();
      expect(commands.registerRunCommand).toBeDefined();
    });
  });

  describe('adapters/index', () => {
    it('should export adapters', async () => {
      const adapters = await import('../adapters');
      expect(adapters.getCliAuthProvider).toBeDefined();
      expect(adapters.createFileStorageAdapter).toBeDefined();
    });
  });

  describe('stores/index', () => {
    it('should export stores', async () => {
      const stores = await import('../stores');
      expect(stores.getCliConfigStore).toBeDefined();
      expect(stores.getCliUiStore).toBeDefined();
    });
  });

  describe('animations/index', () => {
    it('should export animations', async () => {
      const animations = await import('../animations');
      expect(animations.useTypewriter).toBeDefined();
      expect(animations.useFadeIn).toBeDefined();
      expect(animations.usePulse).toBeDefined();
      expect(animations.useLoadingDots).toBeDefined();
    });
  });
});
