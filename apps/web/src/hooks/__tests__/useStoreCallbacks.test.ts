/**
 * Comprehensive tests for useStoreCallbacks hook
 * Tests stable reference pattern for store callbacks in effects
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoreCallbacks } from '../useStoreCallbacks';

describe('useStoreCallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return a ref object', () => {
      const callbacks = {
        onMessage: vi.fn(),
        onError: vi.fn(),
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      expect(result.current).toBeDefined();
      expect(result.current.current).toBeDefined();
    });

    it('should contain the initial callbacks', () => {
      const callbacks = {
        onMessage: vi.fn(),
        onError: vi.fn(),
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      expect(result.current.current.onMessage).toBe(callbacks.onMessage);
      expect(result.current.current.onError).toBe(callbacks.onError);
    });

    it('should handle single callback', () => {
      const callbacks = {
        handleClick: vi.fn(),
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      expect(result.current.current.handleClick).toBe(callbacks.handleClick);
    });

    it('should handle empty callbacks object', () => {
      const callbacks = {};

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      expect(result.current.current).toEqual({});
    });
  });

  // ========================================
  // Ref Stability Tests
  // ========================================

  describe('Ref Stability', () => {
    it('should maintain stable ref identity across rerenders', () => {
      const callbacks = {
        onMessage: vi.fn(),
      };

      const { result, rerender } = renderHook(() => useStoreCallbacks(callbacks));

      const firstRef = result.current;

      rerender();

      const secondRef = result.current;

      // Ref object should be the same
      expect(firstRef).toBe(secondRef);
    });

    it('should update ref.current with new callbacks', () => {
      const initialCallback = vi.fn();
      const updatedCallback = vi.fn();

      const { result, rerender } = renderHook(
        ({ callback }) => useStoreCallbacks({ action: callback }),
        { initialProps: { callback: initialCallback } }
      );

      expect(result.current.current.action).toBe(initialCallback);

      rerender({ callback: updatedCallback });

      expect(result.current.current.action).toBe(updatedCallback);
    });

    it('should not change ref identity when callbacks change', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const { result, rerender } = renderHook(
        ({ callback }) => useStoreCallbacks({ action: callback }),
        { initialProps: { callback: callback1 } }
      );

      const refBeforeUpdate = result.current;

      rerender({ callback: callback2 });

      const refAfterUpdate = result.current;

      // Ref identity should remain the same
      expect(refBeforeUpdate).toBe(refAfterUpdate);
    });
  });

  // ========================================
  // Callback Execution Tests
  // ========================================

  describe('Callback Execution', () => {
    it('should allow calling callbacks through ref', () => {
      const mockCallback = vi.fn();
      const callbacks = {
        handleEvent: mockCallback,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      result.current.current.handleEvent('test-arg');

      expect(mockCallback).toHaveBeenCalledWith('test-arg');
    });

    it('should call updated callback after rerender', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const { result, rerender } = renderHook(
        ({ callback }) => useStoreCallbacks({ action: callback }),
        { initialProps: { callback: callback1 } }
      );

      result.current.current.action('first');
      expect(callback1).toHaveBeenCalledWith('first');
      expect(callback2).not.toHaveBeenCalled();

      rerender({ callback: callback2 });

      result.current.current.action('second');
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledWith('second');
    });

    it('should handle callbacks with multiple arguments', () => {
      const mockCallback = vi.fn();
      const callbacks = {
        handleData: mockCallback,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      result.current.current.handleData('arg1', 'arg2', 'arg3');

      expect(mockCallback).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
    });

    it('should handle callbacks with return values', () => {
      const mockCallback = vi.fn().mockReturnValue('result');
      const callbacks = {
        getValue: mockCallback,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      const returnValue = result.current.current.getValue();

      expect(returnValue).toBe('result');
    });
  });

  // ========================================
  // Multiple Callbacks Tests
  // ========================================

  describe('Multiple Callbacks', () => {
    it('should handle multiple callbacks', () => {
      const callbacks = {
        onAdd: vi.fn(),
        onRemove: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      result.current.current.onAdd('add');
      result.current.current.onRemove('remove');
      result.current.current.onUpdate('update');
      result.current.current.onDelete('delete');

      expect(callbacks.onAdd).toHaveBeenCalledWith('add');
      expect(callbacks.onRemove).toHaveBeenCalledWith('remove');
      expect(callbacks.onUpdate).toHaveBeenCalledWith('update');
      expect(callbacks.onDelete).toHaveBeenCalledWith('delete');
    });

    it('should update all callbacks on rerender', () => {
      const initialCallbacks = {
        callback1: vi.fn(),
        callback2: vi.fn(),
      };

      const updatedCallbacks = {
        callback1: vi.fn(),
        callback2: vi.fn(),
      };

      const { result, rerender } = renderHook(({ cbs }) => useStoreCallbacks(cbs), {
        initialProps: { cbs: initialCallbacks },
      });

      rerender({ cbs: updatedCallbacks });

      result.current.current.callback1();
      result.current.current.callback2();

      expect(initialCallbacks.callback1).not.toHaveBeenCalled();
      expect(initialCallbacks.callback2).not.toHaveBeenCalled();
      expect(updatedCallbacks.callback1).toHaveBeenCalled();
      expect(updatedCallbacks.callback2).toHaveBeenCalled();
    });
  });

  // ========================================
  // TypeScript Type Tests
  // ========================================

  describe('TypeScript Types', () => {
    it('should preserve callback signatures', () => {
      const callbacks = {
        onNumber: (n: number): number => n * 2,
        onString: (s: string): string => s.toUpperCase(),
        onObject: (obj: { id: string }): boolean => obj.id.length > 0,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      const numResult = result.current.current.onNumber(5);
      const strResult = result.current.current.onString('hello');
      const objResult = result.current.current.onObject({ id: 'test' });

      expect(numResult).toBe(10);
      expect(strResult).toBe('HELLO');
      expect(objResult).toBe(true);
    });

    it('should handle async callbacks', async () => {
      const asyncCallback = vi.fn().mockResolvedValue('async result');
      const callbacks = {
        fetchData: asyncCallback,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      const promiseResult = await result.current.current.fetchData();

      expect(promiseResult).toBe('async result');
    });
  });

  // ========================================
  // Use Case: Socket Event Handlers
  // ========================================

  describe('Use Case: Socket Event Handlers', () => {
    it('should work with socket-like event pattern', () => {
      const addMessage = vi.fn();
      const updateStatus = vi.fn();
      const handleError = vi.fn();

      const { result } = renderHook(() =>
        useStoreCallbacks({
          addMessage,
          updateStatus,
          handleError,
        })
      );

      // Simulate socket event handlers using the ref
      const socketHandlers = {
        onMessage: (data: unknown) => result.current.current.addMessage(data),
        onStatus: (status: string) => result.current.current.updateStatus(status),
        onError: (err: Error) => result.current.current.handleError(err),
      };

      socketHandlers.onMessage({ text: 'Hello' });
      socketHandlers.onStatus('connected');
      socketHandlers.onError(new Error('Connection lost'));

      expect(addMessage).toHaveBeenCalledWith({ text: 'Hello' });
      expect(updateStatus).toHaveBeenCalledWith('connected');
      expect(handleError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should allow callback updates without effect re-run', () => {
      let effectRunCount = 0;
      const initialAddMessage = vi.fn();
      const updatedAddMessage = vi.fn();

      const { result, rerender } = renderHook(
        ({ addMessage }) => {
          const callbacks = useStoreCallbacks({ addMessage });

          // This simulates useEffect that depends on some other value
          // but NOT on the callbacks ref
          effectRunCount++;

          return callbacks;
        },
        { initialProps: { addMessage: initialAddMessage } }
      );

      expect(effectRunCount).toBe(1);

      // Update callback
      rerender({ addMessage: updatedAddMessage });

      // Effect ran again due to rerender, but callbacks ref is stable
      expect(effectRunCount).toBe(2);

      // The important part: calling through the ref uses the updated callback
      result.current.current.addMessage('test');
      expect(updatedAddMessage).toHaveBeenCalledWith('test');
      expect(initialAddMessage).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle undefined callback gracefully', () => {
      const callbacks = {
        defined: vi.fn(),
        // @ts-expect-error - Testing runtime behavior
        undefined: undefined,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      result.current.current.defined();
      expect(callbacks.defined).toHaveBeenCalled();

      // Calling undefined should throw (as expected)
      expect(() => {
        result.current.current.undefined();
      }).toThrow();
    });

    it('should handle callbacks that throw errors', () => {
      const throwingCallback = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });

      const callbacks = {
        throwError: throwingCallback,
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      expect(() => {
        result.current.current.throwError();
      }).toThrow('Callback error');

      expect(throwingCallback).toHaveBeenCalled();
    });

    it('should handle rapid callback updates', () => {
      const createCallback = (id: number) => vi.fn().mockReturnValue(id);

      const { result, rerender } = renderHook(
        ({ id }) => useStoreCallbacks({ callback: createCallback(id) }),
        { initialProps: { id: 0 } }
      );

      // Rapid updates
      for (let i = 1; i <= 100; i++) {
        rerender({ id: i });
      }

      // Should use the latest callback
      const returnValue = result.current.current.callback();
      expect(returnValue).toBe(100);
    });

    it('should handle callbacks with this context', () => {
      const obj = {
        value: 42,
        getValue(this: { value: number }) {
          return this.value;
        },
      };

      const callbacks = {
        boundMethod: obj.getValue.bind(obj),
      };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      const value = result.current.current.boundMethod();
      expect(value).toBe(42);
    });

    it('should handle callbacks object with prototype chain', () => {
      class CallbackClass {
        handleEvent = vi.fn();
      }

      const instance = new CallbackClass();
      const callbacks = { handleEvent: instance.handleEvent };

      const { result } = renderHook(() => useStoreCallbacks(callbacks));

      result.current.current.handleEvent('test');
      expect(instance.handleEvent).toHaveBeenCalledWith('test');
    });
  });
});
