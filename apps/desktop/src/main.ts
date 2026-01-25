import {
  app,
  BrowserWindow,
  shell,
  Tray,
  Menu,
  nativeImage,
  NativeImage,
  ipcMain,
  dialog,
  globalShortcut,
  session,
  Notification,
  TouchBar,
  powerMonitor,
} from 'electron';
import * as Sentry from '@sentry/electron/main';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';
import log from 'electron-log/main';
import * as path from 'path';
import {
  LocalServicesManager,
  initializeLocalServices,
  getLocalServicesManager,
} from './local-services/index';

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
  app.quit();
}

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:3000';
const APP_URL = `${DEV_URL}/dashboard`; // Load dashboard directly, web app handles auth redirect
const PROTOCOL = 'podex';

// ============================================
// Logging Setup
// ============================================

// Configure electron-log
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'info';
log.transports.file.maxSize = 10 * 1024 * 1024; // 10MB
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

// Replace console with log in production
if (!isDev) {
  Object.assign(console, log.functions);
}

log.info('App starting...');
log.info(`Version: ${app.getVersion()}`);
log.info(`Platform: ${process.platform}`);
log.info(`Arch: ${process.arch}`);

// ============================================
// Sentry Error Tracking
// ============================================

const SENTRY_DSN = process.env.SENTRY_DSN_DESKTOP || '';

if (SENTRY_DSN && !isDev) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: isDev ? 'development' : 'production',
    release: `podex-desktop@${app.getVersion()}`,
    tracesSampleRate: isDev ? 1.0 : 0.2,
    beforeSend(event) {
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter(
          (breadcrumb) =>
            !breadcrumb.message?.includes('token') && !breadcrumb.message?.includes('password')
        );
      }
      return event;
    },
  });
  log.info('Sentry initialized');
}

// ============================================
// Settings Store (Persistent)
// ============================================

interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: number;
}

interface StoreSchema {
  windowState: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
    zoomLevel: number;
  };
  settings: {
    autoLaunch: boolean;
    minimizeToTray: boolean;
    hardwareAcceleration: boolean;
    globalShortcut: string;
    apiUrl: string;
  };
  recentWorkspaces: RecentWorkspace[];
}

const store = new Store<StoreSchema>({
  defaults: {
    windowState: {
      width: 1400,
      height: 900,
      isMaximized: false,
      zoomLevel: 1.0,
    },
    settings: {
      autoLaunch: false,
      minimizeToTray: true,
      hardwareAcceleration: true,
      globalShortcut: 'CommandOrControl+Shift+P',
      apiUrl: process.env.API_URL || 'http://localhost:3001',
    },
    recentWorkspaces: [],
  },
});

const MAX_RECENT_WORKSPACES = 10;

// ============================================
// GPU Acceleration
// ============================================

const hardwareAcceleration = store.get('settings.hardwareAcceleration');
if (!hardwareAcceleration) {
  app.disableHardwareAcceleration();
  log.info('Hardware acceleration disabled');
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let isPowerSuspended = false;
let localServicesManager: LocalServicesManager | null = null;

// ============================================
// Recent Workspaces
// ============================================

function addRecentWorkspace(workspacePath: string): void {
  const name = path.basename(workspacePath);
  const recentWorkspaces = (store.get('recentWorkspaces') as RecentWorkspace[]) || [];

  // Remove if already exists
  const filtered = recentWorkspaces.filter((w) => w.path !== workspacePath);

  // Add to front
  filtered.unshift({
    path: workspacePath,
    name,
    lastOpened: Date.now(),
  });

  // Keep only MAX_RECENT_WORKSPACES
  const trimmed = filtered.slice(0, MAX_RECENT_WORKSPACES);
  store.set('recentWorkspaces', trimmed);

  // Update app recent documents (macOS/Windows)
  app.addRecentDocument(workspacePath);

  // Update menus
  createAppMenu();
  updateTrayMenu();

  log.info(`Added recent workspace: ${workspacePath}`);
}

function getRecentWorkspaces(): RecentWorkspace[] {
  return (store.get('recentWorkspaces') as RecentWorkspace[]) || [];
}

function clearRecentWorkspaces(): void {
  store.set('recentWorkspaces', []);
  app.clearRecentDocuments();
  createAppMenu();
  updateTrayMenu();
  log.info('Cleared recent workspaces');
}

// ============================================
// Zoom Level Persistence
// ============================================

function getZoomLevel(): number {
  return (store.get('windowState.zoomLevel') as number) || 1.0;
}

function setZoomLevel(level: number): void {
  const clamped = Math.max(0.5, Math.min(2.0, level));
  store.set('windowState.zoomLevel', clamped);
  if (mainWindow) {
    mainWindow.webContents.setZoomFactor(clamped);
  }
  log.info(`Zoom level set to ${clamped}`);
}

// ============================================
// Power Monitor
// ============================================

function setupPowerMonitor(): void {
  powerMonitor.on('suspend', () => {
    isPowerSuspended = true;
    log.info('System suspending - pausing background activities');
    mainWindow?.webContents.send('power-suspend');
  });

  powerMonitor.on('resume', () => {
    isPowerSuspended = false;
    log.info('System resumed - resuming background activities');
    mainWindow?.webContents.send('power-resume');

    // Reconnect socket after resume
    mainWindow?.webContents.send('reconnect-socket');
  });

  powerMonitor.on('lock-screen', () => {
    log.info('Screen locked');
    mainWindow?.webContents.send('screen-locked');
  });

  powerMonitor.on('unlock-screen', () => {
    log.info('Screen unlocked');
    mainWindow?.webContents.send('screen-unlocked');
  });

  // Battery status (laptops)
  powerMonitor.on('on-battery', () => {
    log.info('Running on battery');
    mainWindow?.webContents.send('on-battery');
  });

  powerMonitor.on('on-ac', () => {
    log.info('Connected to AC power');
    mainWindow?.webContents.send('on-ac');
  });
}

// ============================================
// Taskbar/Dock Progress
// ============================================

function setProgressBar(progress: number): void {
  // progress: -1 = indeterminate, 0-1 = percentage, > 1 = hide
  if (mainWindow) {
    if (progress < 0) {
      mainWindow.setProgressBar(progress, { mode: 'indeterminate' });
    } else if (progress >= 0 && progress <= 1) {
      mainWindow.setProgressBar(progress, { mode: 'normal' });
    } else {
      mainWindow.setProgressBar(-1, { mode: 'none' });
    }
  }
}

// ============================================
// Drag & Drop
// ============================================

function setupDragDrop(): void {
  if (!mainWindow) return;

  // Prevent default drag behavior
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow normal navigation but prevent file drops from navigating
    if (url.startsWith('file://')) {
      event.preventDefault();
    }
  });
}

// ============================================
// Context Menu
// ============================================

function setupContextMenu(): void {
  if (!mainWindow) return;

  mainWindow.webContents.on('context-menu', (event, params) => {
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    // Add text editing options if in editable field
    if (params.isEditable) {
      menuTemplate.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      );
    } else if (params.selectionText) {
      // Text is selected
      menuTemplate.push(
        { role: 'copy' },
        { type: 'separator' },
        {
          label: 'Search Google',
          click: () => {
            shell.openExternal(
              `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`
            );
          },
        }
      );
    }

    // Add link options if clicking on a link
    if (params.linkURL) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: 'separator' });
      }
      menuTemplate.push(
        {
          label: 'Open Link in Browser',
          click: () => {
            shell.openExternal(params.linkURL);
          },
        },
        {
          label: 'Copy Link',
          click: () => {
            const { clipboard } = require('electron');
            clipboard.writeText(params.linkURL);
          },
        }
      );
    }

    // Add image options
    if (params.mediaType === 'image') {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: 'separator' });
      }
      menuTemplate.push(
        {
          label: 'Save Image As...',
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showSaveDialog(mainWindow, {
              defaultPath: 'image.png',
            });
            if (!result.canceled && result.filePath) {
              mainWindow.webContents.downloadURL(params.srcURL);
            }
          },
        },
        {
          label: 'Copy Image',
          click: () => {
            mainWindow?.webContents.copyImageAt(params.x, params.y);
          },
        }
      );
    }

    // Always show inspect element in dev
    if (isDev) {
      if (menuTemplate.length > 0) {
        menuTemplate.push({ type: 'separator' });
      }
      menuTemplate.push({
        label: 'Inspect Element',
        click: () => {
          mainWindow?.webContents.inspectElement(params.x, params.y);
        },
      });
    }

    // Only show menu if we have items
    if (menuTemplate.length > 0) {
      const menu = Menu.buildFromTemplate(menuTemplate);
      menu.popup();
    }
  });
}

// ============================================
// Auto-Launch Setup
// ============================================

function setupAutoLaunch(): void {
  const autoLaunch = store.get('settings.autoLaunch') as boolean;

  try {
    app.setLoginItemSettings({
      openAtLogin: autoLaunch,
      openAsHidden: true,
      args: ['--hidden'],
    });
    log.info(`Auto-launch ${autoLaunch ? 'enabled' : 'disabled'}`);
  } catch (err) {
    // This can fail on macOS if the app doesn't have permission or is not signed
    log.warn('Failed to set login item settings (requires signing/permission):', err);
  }
}

// ============================================
// Window State Persistence
// ============================================

function getWindowState(): StoreSchema['windowState'] {
  return store.get('windowState');
}

function saveWindowState(): void {
  if (!mainWindow) return;

  const isMaximized = mainWindow.isMaximized();

  if (!isMaximized) {
    const bounds = mainWindow.getBounds();
    store.set('windowState', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: false,
    });
  } else {
    store.set('windowState.isMaximized', true);
  }
}

// ============================================
// Auto-Updater Configuration
// ============================================

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatusToWindow('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    sendStatusToWindow(`Update available: ${info.version}`);
    showNotification('Update Available', `Version ${info.version} is available`);
  });

  autoUpdater.on('update-not-available', () => {
    sendStatusToWindow('App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatusToWindow(`Downloading: ${Math.round(progress.percent)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatusToWindow(`Update ready: ${info.version}`);
    if (mainWindow) {
      dialog
        .showMessageBox(mainWindow, {
          type: 'info',
          title: 'Update Ready',
          message: `Version ${info.version} has been downloaded. Restart to apply the update?`,
          buttons: ['Restart Now', 'Later'],
        })
        .then((result) => {
          if (result.response === 0) {
            isQuitting = true;
            autoUpdater.quitAndInstall();
          }
        });
    }
  });

  autoUpdater.on('error', (err) => {
    log.error('Update error:', err);
    sendStatusToWindow(`Update error: ${err.message}`);
  });

  autoUpdater.checkForUpdatesAndNotify();
}

function sendStatusToWindow(message: string): void {
  log.info(`Update status: ${message}`);
  if (mainWindow) {
    mainWindow.webContents.send('updater-status', message);
  }
}

// ============================================
// Notifications
// ============================================

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// ============================================
// Badge / Taskbar Overlay
// ============================================

function updateBadge(count: number): void {
  if (process.platform === 'darwin') {
    // macOS dock badge
    app.dock?.setBadge(count > 0 ? String(count) : '');
  } else if (process.platform === 'win32' && mainWindow) {
    // Windows taskbar overlay
    if (count > 0) {
      // Create a badge overlay (simple red circle with number)
      const canvas = `
        <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="8" fill="#ef4444"/>
          <text x="8" y="12" text-anchor="middle" font-size="10" fill="white" font-family="Arial">${count > 9 ? '9+' : count}</text>
        </svg>
      `;
      const icon = nativeImage.createFromDataURL(
        `data:image/svg+xml;base64,${Buffer.from(canvas).toString('base64')}`
      );
      mainWindow.setOverlayIcon(icon, `${count} notifications`);
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }
}

// ============================================
// System Tray
// ============================================

function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'resources', 'icon.png')
    : path.join(process.resourcesPath, 'icon.png');

  let icon: NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('Podex');

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

function updateTrayMenu(): void {
  if (!tray) return;

  const settings = store.get('settings');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Podex',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Start with System',
      type: 'checkbox',
      checked: settings.autoLaunch,
      click: (menuItem) => {
        store.set('settings.autoLaunch', menuItem.checked);
        setupAutoLaunch();
        updateTrayMenu();
      },
    },
    {
      label: 'Minimize to Tray',
      type: 'checkbox',
      checked: settings.minimizeToTray,
      click: (menuItem) => {
        store.set('settings.minimizeToTray', menuItem.checked);
        updateTrayMenu();
      },
    },
    {
      label: 'Hardware Acceleration',
      type: 'checkbox',
      checked: settings.hardwareAcceleration,
      click: (menuItem) => {
        store.set('settings.hardwareAcceleration', menuItem.checked);
        dialog.showMessageBox({
          type: 'info',
          title: 'Restart Required',
          message: 'Please restart Podex for this change to take effect.',
          buttons: ['OK'],
        });
        updateTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      enabled: !isDev,
      click: () => {
        if (!isDev) {
          autoUpdater.checkForUpdatesAndNotify();
        }
      },
    },
    {
      label: 'View Logs',
      click: () => {
        shell.openPath(log.transports.file.getFile().path);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Podex',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ============================================
// Application Menu
// ============================================

function createAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Preferences...',
                accelerator: 'Cmd+,',
                click: () => {
                  mainWindow?.webContents.send('open-settings');
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('new-session');
          },
        },
        {
          label: 'Open Workspace...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
              title: 'Open Workspace',
            });
            if (!result.canceled && result.filePaths[0]) {
              addRecentWorkspace(result.filePaths[0]);
              mainWindow?.webContents.send('open-workspace', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Open Recent',
          submenu: [
            ...getRecentWorkspaces().map((workspace) => ({
              label: workspace.name,
              sublabel: workspace.path,
              click: () => {
                addRecentWorkspace(workspace.path);
                mainWindow?.webContents.send('open-workspace', workspace.path);
              },
            })),
            ...(getRecentWorkspaces().length > 0
              ? [
                  { type: 'separator' as const },
                  {
                    label: 'Clear Recent',
                    click: () => {
                      clearRecentWorkspaces();
                    },
                  },
                ]
              : [{ label: 'No Recent Workspaces', enabled: false }]),
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            mainWindow?.webContents.send('open-search');
          },
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            setZoomLevel(1.0);
          },
        },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            const current = mainWindow?.webContents.getZoomFactor() || 1.0;
            setZoomLevel(current + 0.1);
          },
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            const current = mainWindow?.webContents.getZoomFactor() || 1.0;
            setZoomLevel(current - 0.1);
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            mainWindow?.webContents.send('toggle-sidebar');
          },
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => {
            mainWindow?.webContents.send('toggle-terminal');
          },
        },
      ],
    },

    // Go menu
    {
      label: 'Go',
      submenu: [
        {
          label: 'Go to File...',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            mainWindow?.webContents.send('open-file-picker');
          },
        },
        {
          label: 'Go to Command...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            mainWindow?.webContents.send('open-command-palette');
          },
        },
        { type: 'separator' },
        {
          label: 'Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            mainWindow?.webContents.send('navigate', '/dashboard');
          },
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.send('navigate', '/settings');
          },
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: () => {
            shell.openExternal('https://docs.podex.dev');
          },
        },
        {
          label: 'Report Issue',
          click: () => {
            shell.openExternal('https://github.com/podex/podex/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'View Logs',
          click: () => {
            shell.openPath(log.transports.file.getFile().path);
          },
        },
        { type: 'separator' },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============================================
// Touch Bar (macOS)
// ============================================

function createTouchBar(): TouchBar | undefined {
  if (process.platform !== 'darwin') return undefined;

  const { TouchBarButton, TouchBarSpacer } = TouchBar;

  const newSessionButton = new TouchBarButton({
    label: '+ New Session',
    backgroundColor: '#3b82f6',
    click: () => {
      mainWindow?.webContents.send('new-session');
    },
  });

  const dashboardButton = new TouchBarButton({
    label: 'Dashboard',
    click: () => {
      mainWindow?.webContents.send('navigate', '/dashboard');
    },
  });

  const commandPaletteButton = new TouchBarButton({
    label: 'Commands',
    click: () => {
      mainWindow?.webContents.send('open-command-palette');
    },
  });

  return new TouchBar({
    items: [
      newSessionButton,
      new TouchBarSpacer({ size: 'small' }),
      dashboardButton,
      new TouchBarSpacer({ size: 'small' }),
      commandPaletteButton,
    ],
  });
}

// ============================================
// Global Keyboard Shortcuts
// ============================================

function registerGlobalShortcuts(): void {
  const shortcut = store.get('settings.globalShortcut') as string;

  // Unregister all first
  globalShortcut.unregisterAll();

  // Register global shortcut to show/focus window
  const success = globalShortcut.register(shortcut, () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });

  if (success) {
    log.info(`Global shortcut registered: ${shortcut}`);
  } else {
    log.warn(`Failed to register global shortcut: ${shortcut}`);
  }
}

// ============================================
// Deep Linking (podex:// protocol)
// ============================================

function setupDeepLinking(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', (_, commandLine) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }

      const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
      if (url) {
        handleDeepLink(url);
      }
    });
  }
}

function handleDeepLink(url: string): void {
  log.info(`Deep link received: ${url}`);

  try {
    const parsed = new URL(url);
    const action = parsed.hostname;
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (mainWindow) {
      mainWindow.webContents.send('deep-link', {
        action,
        params: pathParts,
        query: Object.fromEntries(parsed.searchParams),
      });
    }

    if (mainWindow) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    } else {
      app.whenReady().then(() => {
        createWindow();
        mainWindow?.webContents.once('did-finish-load', () => {
          mainWindow?.webContents.send('deep-link', {
            action,
            params: pathParts,
            query: Object.fromEntries(parsed.searchParams),
          });
        });
      });
    }
  } catch (err) {
    log.error('Failed to parse deep link:', err);
  }
}

// ============================================
// IPC Handlers
// ============================================

function setupIpcHandlers(): void {
  // Native file dialogs
  ipcMain.handle('dialog:openDirectory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Directory',
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    'dialog:openFile',
    async (_, options: { filters?: { name: string; extensions: string[] }[] }) => {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Select File',
        filters: options?.filters,
      });
      if (result.canceled) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    'dialog:saveFile',
    async (
      _,
      options: {
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }
    ) => {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save File',
        defaultPath: options?.defaultPath,
        filters: options?.filters,
      });
      if (result.canceled) return null;
      return result.filePath;
    }
  );

  // Update checker
  ipcMain.handle('updater:checkForUpdates', async () => {
    if (isDev) {
      return { updateAvailable: false, message: 'Updates disabled in dev mode' };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        updateAvailable: !!result?.updateInfo,
        version: result?.updateInfo?.version,
      };
    } catch (err) {
      return { updateAvailable: false, error: (err as Error).message };
    }
  });

  // App info
  ipcMain.handle('app:getVersion', () => app.getVersion());

  // Settings
  ipcMain.handle('settings:get', (_, key: string) => store.get(key));
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    store.set(key, value);
    // Handle specific settings changes
    if (key === 'settings.autoLaunch') {
      setupAutoLaunch();
    }
    if (key === 'settings.globalShortcut') {
      registerGlobalShortcuts();
    }
    updateTrayMenu();
  });

  // Badge
  ipcMain.handle('badge:set', (_, count: number) => {
    updateBadge(count);
  });

  // Logs
  ipcMain.handle('log:getPath', () => log.transports.file.getFile().path);
  ipcMain.handle('log:open', () => {
    shell.openPath(log.transports.file.getFile().path);
  });

  // Recent workspaces
  ipcMain.handle('recent:get', () => getRecentWorkspaces());
  ipcMain.handle('recent:add', (_, workspacePath: string) => {
    addRecentWorkspace(workspacePath);
  });
  ipcMain.handle('recent:clear', () => {
    clearRecentWorkspaces();
  });

  // Zoom
  ipcMain.handle('zoom:get', () => getZoomLevel());
  ipcMain.handle('zoom:set', (_, level: number) => {
    setZoomLevel(level);
  });

  // Progress bar
  ipcMain.handle('progress:set', (_, progress: number) => {
    setProgressBar(progress);
  });

  // Power status
  ipcMain.handle('power:isSuspended', () => isPowerSuspended);

  // Drag and drop - handle files dropped
  ipcMain.on('file:dropped', (_, filePaths: string[]) => {
    log.info(`Files dropped: ${filePaths.join(', ')}`);
    // Check if it's a directory (workspace)
    const fs = require('fs');
    for (const filePath of filePaths) {
      if (fs.statSync(filePath).isDirectory()) {
        addRecentWorkspace(filePath);
        mainWindow?.webContents.send('open-workspace', filePath);
        break;
      }
    }
    // Send to renderer for file handling
    mainWindow?.webContents.send('files-dropped', filePaths);
  });
}

// ============================================
// Security: Content Security Policy
// ============================================

function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // In development, don't enforce CSP to allow all local network connections
    if (isDev) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    // Strict CSP for production only
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://*.podex.dev wss://*.podex.dev https://*.sentry.io",
          ].join('; '),
        ],
      },
    });
  });
}

// ============================================
// Offline Detection
// ============================================

function setupOfflineDetection(): void {
  // Monitor network status changes
  ipcMain.handle('network:getStatus', () => {
    return { online: true }; // Main process can't directly check, renderer handles this
  });

  // The renderer will use navigator.onLine and send status updates
  ipcMain.on('network:statusChanged', (_, online: boolean) => {
    log.info(`Network status: ${online ? 'online' : 'offline'}`);
    if (!online) {
      showNotification('Offline', 'You are currently offline. Some features may be unavailable.');
    }
  });
}

// ============================================
// OAuth Window Handling
// ============================================

let authWindow: BrowserWindow | null = null;

/**
 * Check if a URL is an OAuth authorization URL that should open in a popup
 */
function isOAuthUrl(url: string): boolean {
  const oauthPatterns = [
    'github.com/login/oauth',
    'accounts.google.com/o/oauth2',
    'accounts.google.com/signin/oauth',
    'login.microsoftonline.com',
    'gitlab.com/oauth',
    'bitbucket.org/site/oauth2',
  ];
  return oauthPatterns.some((pattern) => url.includes(pattern));
}

/**
 * Check if a URL is our app's OAuth callback
 */
function isOAuthCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Check if it's localhost (dev) or our production domain
    const isOurDomain =
      parsed.hostname === 'localhost' ||
      parsed.hostname.endsWith('.podex.dev') ||
      parsed.hostname === 'podex.dev';

    // Check if it's a callback path
    const isCallbackPath =
      parsed.pathname.includes('/auth/') ||
      parsed.pathname.includes('/oauth/') ||
      parsed.pathname.includes('/callback');

    // Check if it has OAuth parameters
    const hasOAuthParams = parsed.searchParams.has('code') || parsed.searchParams.has('error');

    return isOurDomain && (isCallbackPath || hasOAuthParams);
  } catch {
    return false;
  }
}

/**
 * Open OAuth flow in a dedicated popup window
 */
function openOAuthWindow(url: string): void {
  // Close existing auth window if any
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }

  authWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: mainWindow || undefined,
    modal: false,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    title: 'Sign in',
    autoHideMenuBar: true,
  });

  // Center on parent
  if (mainWindow) {
    const parentBounds = mainWindow.getBounds();
    const x = Math.round(parentBounds.x + (parentBounds.width - 600) / 2);
    const y = Math.round(parentBounds.y + (parentBounds.height - 700) / 2);
    authWindow.setPosition(x, y);
  }

  log.info(`Opening OAuth window for: ${url}`);

  // Monitor navigation for OAuth callback
  authWindow.webContents.on('will-navigate', (event, navUrl) => {
    log.info(`OAuth window navigating to: ${navUrl}`);

    if (isOAuthCallback(navUrl)) {
      event.preventDefault();
      log.info('OAuth callback detected, redirecting to main window');

      // Navigate main window to the callback URL
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(navUrl);
        mainWindow.focus();
      }

      // Close the auth window
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
      authWindow = null;
    }
  });

  // Also check redirects
  authWindow.webContents.on('will-redirect', (event, navUrl) => {
    log.info(`OAuth window redirecting to: ${navUrl}`);

    if (isOAuthCallback(navUrl)) {
      event.preventDefault();
      log.info('OAuth callback redirect detected, redirecting to main window');

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(navUrl);
        mainWindow.focus();
      }

      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
      authWindow = null;
    }
  });

  // Handle window closed by user
  authWindow.on('closed', () => {
    log.info('OAuth window closed');
    authWindow = null;
  });

  // Load the OAuth URL
  authWindow.loadURL(url);
}

// ============================================
// Main Window
// ============================================

function createWindow(): void {
  const windowState = getWindowState();

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    title: 'Podex',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0a0a0a',
    show: false,
  });

  // Restore maximized state
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  // Touch Bar (macOS)
  const touchBar = createTouchBar();
  if (touchBar) {
    mainWindow.setTouchBar(touchBar);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    log.info('Window ready and shown');

    // Apply saved zoom level
    const zoomLevel = getZoomLevel();
    mainWindow?.webContents.setZoomFactor(zoomLevel);
    log.info(`Applied zoom level: ${zoomLevel}`);
  });

  // Filter out harmless DevTools protocol errors from console
  const suppressedErrors = [
    'Autofill.enable',
    'Autofill.setAddresses',
    'Storage.getStorageKeyForFrame',
    'Request Autofill.enable failed',
    'Request Autofill.setAddresses failed',
    'Request Storage.getStorageKeyForFrame failed',
  ];
  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Suppress known harmless DevTools errors
    if (suppressedErrors.some((err) => message.includes(err))) {
      event.preventDefault();
    }
  });

  // Setup context menu and drag/drop after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    setupContextMenu();
    setupDragDrop();
  });

  // Load the app - go directly to dashboard, web app handles auth redirect
  if (isDev) {
    mainWindow.loadURL(APP_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(APP_URL);
  }

  // Open external links in default browser, except OAuth flows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Check if this is an OAuth URL that should open in a popup window
      if (isOAuthUrl(url)) {
        openOAuthWindow(url);
        return { action: 'deny' };
      }
      // Regular external links open in browser
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Save window state on changes
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);
  mainWindow.on('maximize', saveWindowState);
  mainWindow.on('unmaximize', saveWindowState);

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('settings.minimizeToTray')) {
      event.preventDefault();
      mainWindow?.hide();
      log.info('Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================
// App Lifecycle
// ============================================

// Setup deep linking before app is ready
setupDeepLinking();

app.whenReady().then(async () => {
  log.info('App ready');

  setupCSP();
  setupIpcHandlers();
  setupOfflineDetection();
  setupPowerMonitor();
  setupAutoLaunch();
  createAppMenu();
  createWindow();
  createTray();
  registerGlobalShortcuts();
  setupAutoUpdater();

  // Initialize local services
  localServicesManager = initializeLocalServices(store);
  if (mainWindow) {
    localServicesManager.setMainWindow(mainWindow);
  }
  await localServicesManager.initialize();

  // Show guided setup if not completed
  localServicesManager.on('show-guided-setup', () => {
    mainWindow?.webContents.send('show-local-services-setup');
  });

  // Check if launched hidden (auto-launch)
  if (process.argv.includes('--hidden')) {
    mainWindow?.hide();
    log.info('Launched hidden (auto-start)');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running in tray
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  saveWindowState();

  // Shutdown local services
  if (localServicesManager) {
    await localServicesManager.shutdown();
  }

  log.info('App quitting');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    // Allow localhost navigation in dev mode
    if (isDev && parsedUrl.hostname === 'localhost') {
      return;
    }
    // Allow navigation within the app
    if (url.startsWith(DEV_URL)) {
      return;
    }
    // Allow OAuth URLs to be handled by the OAuth window system
    if (isOAuthUrl(url)) {
      event.preventDefault();
      openOAuthWindow(url);
      return;
    }
    // Block external navigation - open in browser instead
    event.preventDefault();
    shell.openExternal(url);
  });
});
