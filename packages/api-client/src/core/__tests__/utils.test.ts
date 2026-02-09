import { describe, it, expect } from 'vitest';
import {
  calculateExpiry,
  isTokenExpiringSoon,
  snakeToCamel,
  camelToSnake,
  transformKeysToCamel,
  transformKeysToSnake,
  buildQueryString,
  joinPath,
} from '../utils';

describe('Utils', () => {
  describe('calculateExpiry', () => {
    it('should calculate expiry timestamp from seconds', () => {
      const now = Date.now();
      const expiresIn = 3600; // 1 hour
      const result = calculateExpiry(expiresIn);

      expect(result).toBeGreaterThanOrEqual(now + expiresIn * 1000);
      expect(result).toBeLessThanOrEqual(now + expiresIn * 1000 + 100); // Allow 100ms tolerance
    });

    it('should handle zero seconds', () => {
      const now = Date.now();
      const result = calculateExpiry(0);
      expect(result).toBeGreaterThanOrEqual(now);
      expect(result).toBeLessThanOrEqual(now + 100);
    });

    it('should handle large expiry values', () => {
      const expiresIn = 86400; // 24 hours
      const result = calculateExpiry(expiresIn);
      expect(result).toBeGreaterThan(Date.now());
    });
  });

  describe('isTokenExpiringSoon', () => {
    it('should return true when token expires within buffer', () => {
      const expiresAt = Date.now() + 2 * 60 * 1000; // 2 minutes from now
      expect(isTokenExpiringSoon(expiresAt)).toBe(true);
    });

    it('should return false when token expires beyond buffer', () => {
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes from now
      expect(isTokenExpiringSoon(expiresAt)).toBe(false);
    });

    it('should use custom buffer', () => {
      const expiresAt = Date.now() + 30 * 1000; // 30 seconds from now
      expect(isTokenExpiringSoon(expiresAt, 60 * 1000)).toBe(true); // 1 minute buffer
      expect(isTokenExpiringSoon(expiresAt, 10 * 1000)).toBe(false); // 10 second buffer
    });

    it('should return true for expired tokens', () => {
      const expiresAt = Date.now() - 1000; // 1 second ago
      expect(isTokenExpiringSoon(expiresAt)).toBe(true);
    });
  });

  describe('snakeToCamel', () => {
    it('should convert snake_case to camelCase', () => {
      expect(snakeToCamel('hello_world')).toBe('helloWorld');
      expect(snakeToCamel('user_id')).toBe('userId');
      expect(snakeToCamel('created_at')).toBe('createdAt');
    });

    it('should handle strings without underscores', () => {
      expect(snakeToCamel('hello')).toBe('hello');
    });

    it('should handle multiple underscores', () => {
      expect(snakeToCamel('this_is_a_test')).toBe('thisIsATest');
    });

    it('should handle empty string', () => {
      expect(snakeToCamel('')).toBe('');
    });
  });

  describe('camelToSnake', () => {
    it('should convert camelCase to snake_case', () => {
      expect(camelToSnake('helloWorld')).toBe('hello_world');
      expect(camelToSnake('userId')).toBe('user_id');
      expect(camelToSnake('createdAt')).toBe('created_at');
    });

    it('should handle strings without capitals', () => {
      expect(camelToSnake('hello')).toBe('hello');
    });

    it('should handle multiple capitals', () => {
      expect(camelToSnake('thisIsATest')).toBe('this_is_a_test');
    });

    it('should handle empty string', () => {
      expect(camelToSnake('')).toBe('');
    });
  });

  describe('transformKeysToCamel', () => {
    it('should transform object keys from snake_case to camelCase', () => {
      const input = { user_id: 1, created_at: '2024-01-01' };
      const result = transformKeysToCamel<{ userId: number; createdAt: string }>(input);
      expect(result).toEqual({ userId: 1, createdAt: '2024-01-01' });
    });

    it('should handle nested objects', () => {
      const input = {
        user_data: {
          user_id: 1,
          user_name: 'test',
        },
      };
      const result = transformKeysToCamel(input);
      expect(result).toEqual({
        userData: {
          userId: 1,
          userName: 'test',
        },
      });
    });

    it('should handle arrays of objects', () => {
      const input = [
        { user_id: 1, user_name: 'test1' },
        { user_id: 2, user_name: 'test2' },
      ];
      const result = transformKeysToCamel(input);
      expect(result).toEqual([
        { userId: 1, userName: 'test1' },
        { userId: 2, userName: 'test2' },
      ]);
    });

    it('should handle primitive values', () => {
      expect(transformKeysToCamel('string')).toBe('string');
      expect(transformKeysToCamel(42)).toBe(42);
      expect(transformKeysToCamel(true)).toBe(true);
      expect(transformKeysToCamel(null)).toBe(null);
    });

    it('should handle empty object', () => {
      expect(transformKeysToCamel({})).toEqual({});
    });

    it('should handle empty array', () => {
      expect(transformKeysToCamel([])).toEqual([]);
    });
  });

  describe('transformKeysToSnake', () => {
    it('should transform object keys from camelCase to snake_case', () => {
      const input = { userId: 1, createdAt: '2024-01-01' };
      const result = transformKeysToSnake(input);
      expect(result).toEqual({ user_id: 1, created_at: '2024-01-01' });
    });

    it('should handle nested objects', () => {
      const input = {
        userData: {
          userId: 1,
          userName: 'test',
        },
      };
      const result = transformKeysToSnake(input);
      expect(result).toEqual({
        user_data: {
          user_id: 1,
          user_name: 'test',
        },
      });
    });

    it('should handle arrays of objects', () => {
      const input = [
        { userId: 1, userName: 'test1' },
        { userId: 2, userName: 'test2' },
      ];
      const result = transformKeysToSnake(input);
      expect(result).toEqual([
        { user_id: 1, user_name: 'test1' },
        { user_id: 2, user_name: 'test2' },
      ]);
    });

    it('should handle primitive values', () => {
      expect(transformKeysToSnake('string')).toBe('string');
      expect(transformKeysToSnake(42)).toBe(42);
      expect(transformKeysToSnake(true)).toBe(true);
      expect(transformKeysToSnake(null)).toBe(null);
    });
  });

  describe('buildQueryString', () => {
    it('should build query string from params', () => {
      const params = { page: 1, limit: 10, search: 'test' };
      const result = buildQueryString(params);
      expect(result).toBe('?page=1&limit=10&search=test');
    });

    it('should handle boolean values', () => {
      const params = { active: true, archived: false };
      const result = buildQueryString(params);
      expect(result).toBe('?active=true&archived=false');
    });

    it('should skip undefined and null values', () => {
      const params = { page: 1, search: undefined, filter: null, limit: 10 };
      const result = buildQueryString(params);
      expect(result).toBe('?page=1&limit=10');
    });

    it('should return empty string for empty params', () => {
      const result = buildQueryString({});
      expect(result).toBe('');
    });

    it('should handle all null/undefined params', () => {
      const params = { search: undefined, filter: null };
      const result = buildQueryString(params);
      expect(result).toBe('');
    });

    it('should handle special characters', () => {
      const params = { search: 'hello world', filter: 'a&b' };
      const result = buildQueryString(params);
      expect(result).toContain('search=hello+world');
      expect(result).toContain('filter=a%26b');
    });
  });

  describe('joinPath', () => {
    it('should join path segments', () => {
      expect(joinPath('/api', 'users', '123')).toBe('/api/users/123');
    });

    it('should handle trailing slashes', () => {
      expect(joinPath('/api/', 'users/', '123/')).toBe('/api/users/123');
    });

    it('should handle leading slashes', () => {
      expect(joinPath('api', '/users', '/123')).toBe('api/users/123');
    });

    it('should handle multiple slashes', () => {
      expect(joinPath('/api//', '//users//', '//123')).toBe('/api/users/123');
    });

    it('should handle single segment', () => {
      expect(joinPath('/api')).toBe('/api');
    });

    it('should handle empty segments', () => {
      expect(joinPath('/api', '', 'users', '', '123')).toBe('/api/users/123');
    });

    it('should preserve first segment slash', () => {
      expect(joinPath('/api', 'users')).toBe('/api/users');
      expect(joinPath('api', 'users')).toBe('api/users');
    });
  });
});
