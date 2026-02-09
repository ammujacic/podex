/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';

export class MockYText {
  private content = '';
  private observers: Array<() => void> = [];

  get length(): number {
    return this.content.length;
  }

  toString(): string {
    return this.content;
  }

  insert(index: number, text: string): void {
    this.content = this.content.slice(0, index) + text + this.content.slice(index);
    this.notify();
  }

  delete(index: number, length: number): void {
    this.content = this.content.slice(0, index) + this.content.slice(index + length);
    this.notify();
  }

  observe(fn: () => void): void {
    this.observers.push(fn);
  }

  unobserve(fn: () => void): void {
    this.observers = this.observers.filter((o) => o !== fn);
  }

  private notify(): void {
    this.observers.forEach((fn) => fn());
  }

  // Reset for tests
  reset(): void {
    this.content = '';
    this.observers = [];
  }
}

export class MockYArray {
  private items: any[] = [];
  private observers: Array<() => void> = [];

  get length(): number {
    return this.items.length;
  }

  toArray(): any[] {
    return [...this.items];
  }

  forEach(callback: (item: any, index: number) => void): void {
    this.items.forEach(callback);
  }

  push(items: any[]): void {
    this.items.push(...items);
    this.notify();
  }

  insert(index: number, content: any[]): void {
    this.items.splice(index, 0, ...content);
    this.notify();
  }

  delete(index: number, length: number): void {
    this.items.splice(index, length);
    this.notify();
  }

  observe(fn: () => void): void {
    this.observers.push(fn);
  }

  unobserve(fn: () => void): void {
    this.observers = this.observers.filter((o) => o !== fn);
  }

  private notify(): void {
    this.observers.forEach((fn) => fn());
  }

  reset(): void {
    this.items = [];
    this.observers = [];
  }
}

export class MockYMap {
  private data: Map<string, any> = new Map();
  private observers: Array<() => void> = [];

  set(key: string, value: any): void {
    this.data.set(key, value);
    this.notify();
  }

  get(key: string): any {
    return this.data.get(key);
  }

  delete(key: string): void {
    this.data.delete(key);
    this.notify();
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  toJSON(): Record<string, any> {
    return Object.fromEntries(this.data);
  }

  observe(fn: () => void): void {
    this.observers.push(fn);
  }

  unobserve(fn: () => void): void {
    this.observers = this.observers.filter((o) => o !== fn);
  }

  private notify(): void {
    this.observers.forEach((fn) => fn());
  }

  reset(): void {
    this.data.clear();
    this.observers = [];
  }
}

export class MockYDoc {
  private texts = new Map<string, MockYText>();
  private arrays = new Map<string, MockYArray>();
  private maps = new Map<string, MockYMap>();

  getText(name: string): MockYText {
    if (!this.texts.has(name)) {
      this.texts.set(name, new MockYText());
    }
    return this.texts.get(name)!;
  }

  getArray(name: string): MockYArray {
    if (!this.arrays.has(name)) {
      this.arrays.set(name, new MockYArray());
    }
    return this.arrays.get(name)!;
  }

  getMap(name: string): MockYMap {
    if (!this.maps.has(name)) {
      this.maps.set(name, new MockYMap());
    }
    return this.maps.get(name)!;
  }

  destroy(): void {
    this.texts.clear();
    this.arrays.clear();
    this.maps.clear();
  }
}

export class MockAwareness {
  private localState: any = null;
  private states = new Map<number, any>();
  private listeners: Array<() => void> = [];

  setLocalState(state: any): void {
    this.localState = state;
    this.notify();
  }

  getLocalState(): any {
    return this.localState;
  }

  getStates(): Map<number, any> {
    return new Map(this.states);
  }

  on(event: string, fn: () => void): void {
    this.listeners.push(fn);
  }

  off(event: string, fn: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  destroy(): void {
    this.localState = null;
    this.states.clear();
    this.listeners = [];
  }
}

export const mockYjs = {
  Doc: MockYDoc,
  Text: MockYText,
  Array: MockYArray,
  Map: MockYMap,
};

export const mockAwarenessProtocol = {
  Awareness: MockAwareness,
  encodeAwarenessUpdate: vi.fn(() => new Uint8Array()),
  applyAwarenessUpdate: vi.fn(),
};
