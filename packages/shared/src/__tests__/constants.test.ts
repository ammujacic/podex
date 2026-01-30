import { describe, it, expect } from 'vitest';
import { SUPPORTED_IMAGE_TYPES, MAX_ATTACHMENT_SIZE_MB } from '../constants';

describe('Constants', () => {
  describe('Image Constants', () => {
    it('should define supported image types', () => {
      expect(SUPPORTED_IMAGE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
    });

    it('should define max attachment size', () => {
      expect(MAX_ATTACHMENT_SIZE_MB).toBe(20);
    });
  });
});
