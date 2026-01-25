/**
 * Offline Cache
 *
 * SQLite-based cache for view-only offline mode.
 * Caches sessions, files, and user data for offline browsing.
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { promisify } from 'util';
import log from 'electron-log/main';
import { EventEmitter } from 'events';
import Store from 'electron-store';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// We'll use better-sqlite3 for synchronous SQLite operations
// This needs to be added to package.json
let Database: any;
try {
  Database = require('better-sqlite3');
} catch {
  // Fallback: SQLite operations will be no-ops if not available
  log.warn('better-sqlite3 not available, offline cache disabled');
}

export interface CachedSession {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CachedFile {
  sessionId: string;
  path: string;
  content: string;
  language: string | null;
  size: number;
  cachedAt: number;
}

export interface CachedMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface OfflineCacheConfig {
  enabled: boolean;
  maxCacheSizeMB: number;
  maxSessionsToCache: number;
  cacheFileContents: boolean;
  autoSync: boolean;
}

export interface CacheStats {
  sessionsCount: number;
  filesCount: number;
  messagesCount: number;
  totalSizeBytes: number;
  lastSyncAt: number | null;
  isOnline: boolean;
}

const DEFAULT_CONFIG: OfflineCacheConfig = {
  enabled: true,
  maxCacheSizeMB: 500,
  maxSessionsToCache: 50,
  cacheFileContents: true,
  autoSync: true,
};

export class OfflineCache extends EventEmitter {
  private store: Store;
  private db: any = null;
  private dbPath: string;
  private filesDir: string;
  private isOnline: boolean = true;
  private syncInProgress: boolean = false;
  private lastSyncAt: number | null = null;

  constructor(store: Store) {
    super();
    this.store = store;

    // Set up paths
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'offline-cache', 'sessions.db');
    this.filesDir = path.join(userDataPath, 'offline-cache', 'files');

    if (!this.store.has('offlineCache')) {
      this.store.set('offlineCache', DEFAULT_CONFIG);
    }
  }

  /**
   * Get configuration
   */
  getConfig(): OfflineCacheConfig {
    return (this.store.get('offlineCache') as OfflineCacheConfig) || DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<OfflineCacheConfig>): void {
    const current = this.getConfig();
    this.store.set('offlineCache', { ...current, ...updates });
    log.info('Offline cache config updated:', updates);
  }

  /**
   * Initialize the cache database
   */
  async initialize(): Promise<void> {
    if (!Database) {
      log.warn('SQLite not available, offline cache disabled');
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      log.info('Offline cache disabled');
      return;
    }

    try {
      // Ensure directories exist
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      if (!fs.existsSync(this.filesDir)) {
        fs.mkdirSync(this.filesDir, { recursive: true });
      }

      // Open database - this may fail if better-sqlite3 wasn't rebuilt for Electron
      try {
        this.db = new Database(this.dbPath);
      } catch (dbError: any) {
        // If Database constructor fails (e.g., missing native bindings), disable cache
        log.warn('Failed to create database connection, offline cache disabled:', dbError.message);
        Database = null; // Mark as unavailable
        return;
      }

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');

      // Create tables
      this.createTables();

      log.info('Offline cache initialized');
      this.emit('initialized');
    } catch (error) {
      log.error('Failed to initialize offline cache:', error);
      this.emit('error', error);
      // Don't throw - allow app to continue without offline cache
    }
  }

  /**
   * Create database tables
   */
  private createTables(): void {
    if (!this.db) return;

    // Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT,
        cached_at INTEGER NOT NULL
      )
    `);

    // Files table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        language TEXT,
        size INTEGER NOT NULL,
        cached_at INTEGER NOT NULL,
        UNIQUE(session_id, path),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT,
        cached_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // Sync queue table (for future sync functionality)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        data TEXT,
        created_at INTEGER NOT NULL,
        attempts INTEGER DEFAULT 0
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    `);

    log.info('Database tables created');
  }

  /**
   * Cache a session
   */
  async cacheSession(session: CachedSession): Promise<void> {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO sessions (id, name, description, status, created_at, updated_at, metadata, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        session.id,
        session.name,
        session.description,
        session.status,
        session.createdAt,
        session.updatedAt,
        JSON.stringify(session.metadata),
        Date.now()
      );

      log.debug(`Cached session: ${session.id}`);
      this.emit('session-cached', session.id);
    } catch (error) {
      log.error('Failed to cache session:', error);
    }
  }

  /**
   * Get cached session
   */
  getSession(sessionId: string): CachedSession | null {
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
      const row = stmt.get(sessionId);

      if (!row) return null;

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: JSON.parse(row.metadata || '{}'),
      };
    } catch (error) {
      log.error('Failed to get cached session:', error);
      return null;
    }
  }

  /**
   * Get all cached sessions
   */
  getAllSessions(): CachedSession[] {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
      const rows = stmt.all();

      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      log.error('Failed to get cached sessions:', error);
      return [];
    }
  }

  /**
   * Cache a file
   */
  async cacheFile(
    sessionId: string,
    filePath: string,
    content: string,
    language?: string
  ): Promise<void> {
    if (!this.db) return;

    const config = this.getConfig();
    if (!config.cacheFileContents) return;

    try {
      // Compress content
      const compressed = await gzip(Buffer.from(content, 'utf-8'));
      const hash = this.hashString(content);

      // Save compressed content to file
      const sessionDir = path.join(this.filesDir, sessionId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const contentPath = path.join(sessionDir, `${hash}.gz`);
      fs.writeFileSync(contentPath, compressed);

      // Update database
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO files (session_id, path, content_hash, language, size, cached_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(sessionId, filePath, hash, language || null, content.length, Date.now());

      log.debug(`Cached file: ${sessionId}/${filePath}`);
    } catch (error) {
      log.error('Failed to cache file:', error);
    }
  }

  /**
   * Get cached file content
   */
  async getFileContent(sessionId: string, filePath: string): Promise<string | null> {
    if (!this.db) return null;

    try {
      const stmt = this.db.prepare(
        'SELECT content_hash FROM files WHERE session_id = ? AND path = ?'
      );
      const row = stmt.get(sessionId, filePath);

      if (!row) return null;

      const contentPath = path.join(this.filesDir, sessionId, `${row.content_hash}.gz`);
      if (!fs.existsSync(contentPath)) return null;

      const compressed = fs.readFileSync(contentPath);
      const decompressed = await gunzip(compressed);

      return decompressed.toString('utf-8');
    } catch (error) {
      log.error('Failed to get cached file:', error);
      return null;
    }
  }

  /**
   * Get list of cached files for a session
   */
  getSessionFiles(
    sessionId: string
  ): Array<{ path: string; language: string | null; size: number }> {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare('SELECT path, language, size FROM files WHERE session_id = ?');
      return stmt.all(sessionId);
    } catch (error) {
      log.error('Failed to get session files:', error);
      return [];
    }
  }

  /**
   * Cache messages for a session
   */
  async cacheMessages(sessionId: string, messages: CachedMessage[]): Promise<void> {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO messages (id, session_id, role, content, created_at, metadata, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = this.db.transaction((msgs: CachedMessage[]) => {
        for (const msg of msgs) {
          stmt.run(
            msg.id,
            sessionId,
            msg.role,
            msg.content,
            msg.createdAt,
            JSON.stringify(msg.metadata),
            Date.now()
          );
        }
      });

      insertMany(messages);
      log.debug(`Cached ${messages.length} messages for session ${sessionId}`);
    } catch (error) {
      log.error('Failed to cache messages:', error);
    }
  }

  /**
   * Get cached messages for a session
   */
  getSessionMessages(sessionId: string): CachedMessage[] {
    if (!this.db) return [];

    try {
      const stmt = this.db.prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at'
      );
      const rows = stmt.all(sessionId);

      return rows.map((row: any) => ({
        id: row.id,
        sessionId: row.session_id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      log.error('Failed to get session messages:', error);
      return [];
    }
  }

  /**
   * Delete a cached session and all its data
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.db) return;

    try {
      // Delete from database (cascade will delete files and messages)
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      // Delete files from disk
      const sessionDir = path.join(this.filesDir, sessionId);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true });
      }

      log.info(`Deleted cached session: ${sessionId}`);
      this.emit('session-deleted', sessionId);
    } catch (error) {
      log.error('Failed to delete cached session:', error);
    }
  }

  /**
   * Clear all cache
   */
  async clearCache(): Promise<void> {
    if (!this.db) return;

    try {
      this.db.exec('DELETE FROM sessions');
      this.db.exec('DELETE FROM files');
      this.db.exec('DELETE FROM messages');
      this.db.exec('DELETE FROM sync_queue');

      // Clear files directory
      if (fs.existsSync(this.filesDir)) {
        fs.rmSync(this.filesDir, { recursive: true });
        fs.mkdirSync(this.filesDir, { recursive: true });
      }

      log.info('Cache cleared');
      this.emit('cache-cleared');
    } catch (error) {
      log.error('Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    if (!this.db) {
      return {
        sessionsCount: 0,
        filesCount: 0,
        messagesCount: 0,
        totalSizeBytes: 0,
        lastSyncAt: null,
        isOnline: this.isOnline,
      };
    }

    try {
      const sessionsCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
      const filesCount = this.db.prepare('SELECT COUNT(*) as count FROM files').get().count;
      const messagesCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;

      // Calculate total size
      let totalSizeBytes = 0;
      const dbStat = fs.statSync(this.dbPath);
      totalSizeBytes += dbStat.size;

      // Add files directory size
      if (fs.existsSync(this.filesDir)) {
        totalSizeBytes += this.getDirectorySize(this.filesDir);
      }

      return {
        sessionsCount,
        filesCount,
        messagesCount,
        totalSizeBytes,
        lastSyncAt: this.lastSyncAt,
        isOnline: this.isOnline,
      };
    } catch (error) {
      log.error('Failed to get cache stats:', error);
      return {
        sessionsCount: 0,
        filesCount: 0,
        messagesCount: 0,
        totalSizeBytes: 0,
        lastSyncAt: null,
        isOnline: this.isOnline,
      };
    }
  }

  /**
   * Set online status
   */
  setOnlineStatus(online: boolean): void {
    const wasOnline = this.isOnline;
    this.isOnline = online;

    if (!wasOnline && online) {
      this.emit('back-online');
      log.info('Back online');
    } else if (wasOnline && !online) {
      this.emit('went-offline');
      log.info('Went offline');
    }
  }

  /**
   * Check if a session is cached
   */
  isSessionCached(sessionId: string): boolean {
    if (!this.db) return false;

    try {
      const stmt = this.db.prepare('SELECT 1 FROM sessions WHERE id = ?');
      return !!stmt.get(sessionId);
    } catch {
      return false;
    }
  }

  /**
   * Prune old cache entries to stay within size limits
   */
  async pruneCache(): Promise<void> {
    if (!this.db) return;

    const config = this.getConfig();
    const stats = this.getStats();

    // Check if we need to prune
    const maxBytes = config.maxCacheSizeMB * 1024 * 1024;
    if (stats.totalSizeBytes <= maxBytes && stats.sessionsCount <= config.maxSessionsToCache) {
      return;
    }

    log.info('Pruning cache...');

    try {
      // Get sessions sorted by oldest updated_at
      const stmt = this.db.prepare(`
        SELECT id FROM sessions ORDER BY updated_at ASC
        LIMIT ?
      `);

      // Delete oldest sessions until we're under the limits
      const toDelete = Math.max(
        0,
        stats.sessionsCount - config.maxSessionsToCache + 5 // Delete 5 extra for buffer
      );

      if (toDelete > 0) {
        const sessionsToDelete = stmt.all(toDelete);
        for (const row of sessionsToDelete) {
          await this.deleteSession(row.id);
        }
      }

      log.info(`Pruned ${toDelete} sessions from cache`);
      this.emit('cache-pruned', toDelete);
    } catch (error) {
      log.error('Failed to prune cache:', error);
    }
  }

  /**
   * Simple hash function for content
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get directory size recursively
   */
  private getDirectorySize(dirPath: string): number {
    let size = 0;
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stat.size;
      }
    }

    return size;
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.removeAllListeners();
    log.info('Offline cache shutdown complete');
  }
}

// Singleton
let offlineCache: OfflineCache | null = null;

export function initializeOfflineCache(store: Store): OfflineCache {
  if (!offlineCache) {
    offlineCache = new OfflineCache(store);
  }
  return offlineCache;
}

export function getOfflineCache(): OfflineCache | null {
  return offlineCache;
}
