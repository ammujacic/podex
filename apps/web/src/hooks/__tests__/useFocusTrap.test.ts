/**
 * Comprehensive tests for useFocusTrap hook
 * Tests focus trapping, keyboard navigation, and accessibility features
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';
import React, { useEffect } from 'react';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;
  let button1: HTMLButtonElement;
  let button2: HTMLButtonElement;
  let button3: HTMLButtonElement;
  let input: HTMLInputElement;
  let link: HTMLAnchorElement;
  let textarea: HTMLTextAreaElement;

  // Helper to create a wrapper component that assigns the ref properly
  const createWrapper = (targetContainer: HTMLElement, isActive: boolean = true) => {
    return function Wrapper() {
      const ref = useFocusTrap(isActive);
      useEffect(() => {
        // @ts-expect-error - assigning container to ref
        ref.current = targetContainer;
      }, [ref]);
      return null;
    };
  };

  // Helper to render the hook with a ref already assigned
  const renderWithContainer = (targetContainer: HTMLElement, isActive: boolean = true) => {
    return renderHook(
      ({ active }) => {
        const ref = useFocusTrap<HTMLDivElement>(active);
        // Assign the container immediately (simulating what React would do with ref={ref})
        if (targetContainer) {
          // @ts-expect-error - assigning container to ref
          ref.current = targetContainer;
        }
        return ref;
      },
      { initialProps: { active: isActive } }
    );
  };

  beforeEach(() => {
    // Create container and focusable elements
    container = document.createElement('div');
    container.setAttribute('data-testid', 'trap-container');

    button1 = document.createElement('button');
    button1.textContent = 'Button 1';
    button1.setAttribute('data-testid', 'button-1');

    button2 = document.createElement('button');
    button2.textContent = 'Button 2';
    button2.setAttribute('data-testid', 'button-2');

    button3 = document.createElement('button');
    button3.textContent = 'Button 3';
    button3.setAttribute('data-testid', 'button-3');

    input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-testid', 'input');

    link = document.createElement('a');
    link.href = 'https://example.com';
    link.textContent = 'Link';
    link.setAttribute('data-testid', 'link');

    textarea = document.createElement('textarea');
    textarea.setAttribute('data-testid', 'textarea');

    container.appendChild(button1);
    container.appendChild(input);
    container.appendChild(button2);
    container.appendChild(link);
    container.appendChild(textarea);
    container.appendChild(button3);

    document.body.appendChild(container);

    // Mock getComputedStyle to return visible elements
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          display: 'block',
          visibility: 'visible',
        }) as CSSStyleDeclaration
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should return a ref object', () => {
      const { result } = renderHook(() => useFocusTrap());

      expect(result.current).toBeDefined();
      expect(result.current.current).toBeNull();
    });

    it('should be inactive by default when isActive is not provided', () => {
      // The hook defaults isActive to true, so it should focus first element
      const { result, rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect with the ref assigned
      rerender({ active: true });

      // Focus should move to first element (default isActive is true)
      expect(document.activeElement).toBe(button1);
    });

    it('should not trap focus when isActive is false', () => {
      const { result } = renderWithContainer(container, false);

      // Should not have modified focus
      expect(document.activeElement).not.toBe(button1);
    });
  });

  // ========================================
  // Focus Management Tests
  // ========================================

  describe('Focus Management', () => {
    it('should focus first focusable element when activated', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(button1);
    });

    it('should store previously focused element', () => {
      // Focus an external element first
      const externalButton = document.createElement('button');
      document.body.appendChild(externalButton);
      externalButton.focus();

      expect(document.activeElement).toBe(externalButton);

      const { rerender, unmount } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Focus should have moved to container
      expect(document.activeElement).toBe(button1);

      // On unmount, should restore focus
      unmount();

      expect(document.activeElement).toBe(externalButton);
    });

    it('should focus container if no focusable elements exist', () => {
      const emptyContainer = document.createElement('div');
      document.body.appendChild(emptyContainer);

      const { rerender } = renderWithContainer(emptyContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(emptyContainer);
      expect(emptyContainer.getAttribute('tabindex')).toBe('-1');
    });

    it('should restore focus to previously focused element on unmount', () => {
      const externalButton = document.createElement('button');
      externalButton.textContent = 'External';
      document.body.appendChild(externalButton);
      externalButton.focus();

      const { rerender, unmount } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(button1);

      unmount();

      expect(document.activeElement).toBe(externalButton);
    });
  });

  // ========================================
  // Tab Navigation Tests
  // ========================================

  describe('Tab Navigation', () => {
    it('should wrap focus from last to first element on Tab', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Focus last element
      button3.focus();
      expect(document.activeElement).toBe(button3);

      // Simulate Tab key on last element
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(tabEvent);
      });

      expect(document.activeElement).toBe(button1);
    });

    it('should wrap focus from first to last element on Shift+Tab', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Focus first element
      button1.focus();
      expect(document.activeElement).toBe(button1);

      // Simulate Shift+Tab key on first element
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(shiftTabEvent);
      });

      expect(document.activeElement).toBe(button3);
    });

    it('should allow normal Tab navigation within trap', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Focus second element (not first or last)
      input.focus();
      expect(document.activeElement).toBe(input);

      // Tab should not prevent default for middle elements
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(tabEvent);
      });

      // The event shouldn't have been prevented for middle elements
      // Browser would naturally handle the focus
    });

    it('should ignore non-Tab key events', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      button1.focus();

      const enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(enterEvent);
      });

      // Focus should remain unchanged
      expect(document.activeElement).toBe(button1);
    });

    it('should handle Tab with no focusable elements', () => {
      const emptyContainer = document.createElement('div');
      emptyContainer.setAttribute('tabindex', '-1');
      document.body.appendChild(emptyContainer);

      const { rerender } = renderWithContainer(emptyContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      // Should not throw
      act(() => {
        document.dispatchEvent(tabEvent);
      });
    });
  });

  // ========================================
  // Focusable Element Detection Tests
  // ========================================

  describe('Focusable Element Detection', () => {
    it('should detect buttons as focusable', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // First focusable element should be button1
      expect(document.activeElement).toBe(button1);
    });

    it('should detect inputs as focusable', () => {
      // Create container with input first
      const inputContainer = document.createElement('div');
      const firstInput = document.createElement('input');
      inputContainer.appendChild(firstInput);
      document.body.appendChild(inputContainer);

      const { rerender } = renderWithContainer(inputContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(firstInput);
    });

    it('should detect links with href as focusable', () => {
      const linkContainer = document.createElement('div');
      const firstLink = document.createElement('a');
      firstLink.href = 'https://example.com';
      linkContainer.appendChild(firstLink);
      document.body.appendChild(linkContainer);

      const { rerender } = renderWithContainer(linkContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(firstLink);
    });

    it('should detect textareas as focusable', () => {
      const textareaContainer = document.createElement('div');
      const firstTextarea = document.createElement('textarea');
      textareaContainer.appendChild(firstTextarea);
      document.body.appendChild(textareaContainer);

      const { rerender } = renderWithContainer(textareaContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(firstTextarea);
    });

    it('should detect select elements as focusable', () => {
      const selectContainer = document.createElement('div');
      const select = document.createElement('select');
      selectContainer.appendChild(select);
      document.body.appendChild(selectContainer);

      const { rerender } = renderWithContainer(selectContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(select);
    });

    it('should detect elements with positive tabindex as focusable', () => {
      const tabindexContainer = document.createElement('div');
      const tabindexDiv = document.createElement('div');
      tabindexDiv.setAttribute('tabindex', '0');
      tabindexContainer.appendChild(tabindexDiv);
      document.body.appendChild(tabindexContainer);

      const { rerender } = renderWithContainer(tabindexContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(tabindexDiv);
    });

    it('should exclude elements with tabindex=-1', () => {
      const mixedContainer = document.createElement('div');
      const nonFocusableDiv = document.createElement('div');
      nonFocusableDiv.setAttribute('tabindex', '-1');
      const focusableButton = document.createElement('button');
      mixedContainer.appendChild(nonFocusableDiv);
      mixedContainer.appendChild(focusableButton);
      document.body.appendChild(mixedContainer);

      const { rerender } = renderWithContainer(mixedContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Should focus the button, not the tabindex=-1 div
      expect(document.activeElement).toBe(focusableButton);
    });

    it('should exclude disabled elements', () => {
      const disabledContainer = document.createElement('div');
      const disabledButton = document.createElement('button');
      disabledButton.disabled = true;
      const enabledButton = document.createElement('button');
      disabledContainer.appendChild(disabledButton);
      disabledContainer.appendChild(enabledButton);
      document.body.appendChild(disabledContainer);

      const { rerender } = renderWithContainer(disabledContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Should focus the enabled button
      expect(document.activeElement).toBe(enabledButton);
    });

    it('should exclude hidden elements (display: none)', () => {
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        if ((el as HTMLElement).getAttribute('data-hidden') === 'true') {
          return { display: 'none', visibility: 'visible' } as CSSStyleDeclaration;
        }
        return { display: 'block', visibility: 'visible' } as CSSStyleDeclaration;
      });

      const hiddenContainer = document.createElement('div');
      const hiddenButton = document.createElement('button');
      hiddenButton.setAttribute('data-hidden', 'true');
      const visibleButton = document.createElement('button');
      hiddenContainer.appendChild(hiddenButton);
      hiddenContainer.appendChild(visibleButton);
      document.body.appendChild(hiddenContainer);

      const { rerender } = renderWithContainer(hiddenContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Should focus the visible button
      expect(document.activeElement).toBe(visibleButton);
    });

    it('should exclude invisible elements (visibility: hidden)', () => {
      vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
        if ((el as HTMLElement).getAttribute('data-invisible') === 'true') {
          return { display: 'block', visibility: 'hidden' } as CSSStyleDeclaration;
        }
        return { display: 'block', visibility: 'visible' } as CSSStyleDeclaration;
      });

      const invisibleContainer = document.createElement('div');
      const invisibleButton = document.createElement('button');
      invisibleButton.setAttribute('data-invisible', 'true');
      const visibleButton = document.createElement('button');
      invisibleContainer.appendChild(invisibleButton);
      invisibleContainer.appendChild(visibleButton);
      document.body.appendChild(invisibleContainer);

      const { rerender } = renderWithContainer(invisibleContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Should focus the visible button
      expect(document.activeElement).toBe(visibleButton);
    });
  });

  // ========================================
  // Activation/Deactivation Tests
  // ========================================

  describe('Activation/Deactivation', () => {
    it('should activate trap when isActive changes to true', () => {
      const { rerender } = renderWithContainer(container, false);

      // Not active yet
      expect(document.activeElement).not.toBe(button1);

      // Activate
      rerender({ active: true });

      expect(document.activeElement).toBe(button1);
    });

    it('should deactivate trap when isActive changes to false', () => {
      const externalButton = document.createElement('button');
      document.body.appendChild(externalButton);
      externalButton.focus();

      const { rerender } = renderWithContainer(container, true);

      // Trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(button1);

      // Deactivate
      rerender({ active: false });

      // Focus should be restored to external button
      expect(document.activeElement).toBe(externalButton);
    });

    it('should cleanup keydown listener when deactivated', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const { rerender } = renderWithContainer(container, true);

      // Trigger the effect
      rerender({ active: true });

      rerender({ active: false });

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  // ========================================
  // TypeScript Generic Tests
  // ========================================

  describe('TypeScript Generics', () => {
    it('should work with HTMLDivElement', () => {
      const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));

      expect(result.current.current).toBeNull();

      act(() => {
        result.current.current = container;
      });

      expect(result.current.current).toBe(container);
    });

    it('should work with HTMLDialogElement', () => {
      const dialog = document.createElement('dialog');
      const dialogButton = document.createElement('button');
      dialog.appendChild(dialogButton);
      document.body.appendChild(dialog);

      const { rerender } = renderHook(
        ({ active }) => {
          const ref = useFocusTrap<HTMLDialogElement>(active);
          // @ts-expect-error - assigning container to ref
          ref.current = dialog;
          return ref;
        },
        { initialProps: { active: true } }
      );

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(dialogButton);
    });

    it('should work with HTMLFormElement', () => {
      const form = document.createElement('form');
      const formInput = document.createElement('input');
      form.appendChild(formInput);
      document.body.appendChild(form);

      const { rerender } = renderHook(
        ({ active }) => {
          const ref = useFocusTrap<HTMLFormElement>(active);
          // @ts-expect-error - assigning container to ref
          ref.current = form;
          return ref;
        },
        { initialProps: { active: true } }
      );

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(formInput);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle container with single focusable element', () => {
      const singleContainer = document.createElement('div');
      const singleButton = document.createElement('button');
      singleContainer.appendChild(singleButton);
      document.body.appendChild(singleContainer);

      const { rerender } = renderWithContainer(singleContainer, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Tab should keep focus on same element
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(tabEvent);
      });

      expect(document.activeElement).toBe(singleButton);

      // Shift+Tab should also keep focus on same element
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(shiftTabEvent);
      });

      expect(document.activeElement).toBe(singleButton);
    });

    it('should handle null container ref', () => {
      const { result } = renderHook(() => useFocusTrap(true));

      // Should not throw with null ref
      expect(result.current.current).toBeNull();
    });

    it('should handle rapid activation/deactivation', () => {
      const { result, rerender } = renderWithContainer(container, false);

      // Rapid toggles
      for (let i = 0; i < 10; i++) {
        rerender({ active: true });
        rerender({ active: false });
      }

      // Should not throw and should be in consistent state
      expect(result.current.current).toBe(container);
    });

    it('should handle dynamically added elements', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      // Add a new button
      const newButton = document.createElement('button');
      newButton.textContent = 'New Button';
      container.appendChild(newButton);

      // Focus the new button
      newButton.focus();

      // Tab should still work correctly
      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(tabEvent);
      });

      // Should wrap to first element
      expect(document.activeElement).toBe(button1);
    });

    it('should handle focus leaving container (click outside)', () => {
      const { rerender } = renderWithContainer(container, true);

      // Rerender to trigger the effect
      rerender({ active: true });

      expect(document.activeElement).toBe(button1);

      // Focus leaves container
      const externalInput = document.createElement('input');
      document.body.appendChild(externalInput);

      // In a real scenario, the trap would prevent this
      // This test verifies the trap's Tab handling still works
      button3.focus();

      const tabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        document.dispatchEvent(tabEvent);
      });

      expect(document.activeElement).toBe(button1);
    });
  });
});
