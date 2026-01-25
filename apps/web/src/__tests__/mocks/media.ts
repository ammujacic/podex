/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { vi } from 'vitest';

export class MockMediaStream {
  private tracks: MediaStreamTrack[] = [];

  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t: any) => t.kind === 'audio');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t: any) => t.kind === 'video');
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }

  clone(): MediaStream {
    return new MockMediaStream() as any;
  }
}

export class MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: any) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onstart: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  private listeners: Map<string, Function[]> = new Map();

  constructor(stream: MediaStream, options?: any) {
    this.mimeType = options?.mimeType || 'audio/webm';
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.onstart?.();
    this.dispatchEvent('start', {});
  }

  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
    this.dispatchEvent('stop', {});
  }

  pause(): void {
    this.state = 'paused';
    this.onpause?.();
    this.dispatchEvent('pause', {});
  }

  resume(): void {
    this.state = 'recording';
    this.onresume?.();
    this.dispatchEvent('resume', {});
  }

  requestData(): void {
    const blob = new Blob(['mock audio data'], { type: this.mimeType });
    this.ondataavailable?.({ data: blob });
    this.dispatchEvent('dataavailable', { data: blob });
  }

  addEventListener(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  removeEventListener(event: string, handler: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      this.listeners.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    }
  }

  private dispatchEvent(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    handlers?.forEach((handler) => handler(data));
  }

  static isTypeSupported(mimeType: string): boolean {
    return ['audio/webm', 'audio/ogg', 'audio/wav'].includes(mimeType);
  }
}

export class MockAudio {
  src: string = '';
  currentTime: number = 0;
  duration: number = 0;
  paused: boolean = true;
  volume: number = 1;
  muted: boolean = false;
  playbackRate: number = 1;
  onended: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  private listeners: Map<string, Function[]> = new Map();

  constructor(src?: string) {
    if (src) this.src = src;
  }

  async play(): Promise<void> {
    this.paused = false;
    this.onplay?.();
    this.dispatchEvent('play', {});
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
    this.onpause?.();
    this.dispatchEvent('pause', {});
  }

  load(): void {
    // Simulate async loading - fire canplaythrough event
    setTimeout(() => {
      this.duration = 5; // Mock 5 second duration
      this.dispatchEvent('canplaythrough', {});
    }, 0);
  }

  addEventListener(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
  }

  removeEventListener(event: string, handler: Function): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      this.listeners.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    }
  }

  private dispatchEvent(event: string, data: any): void {
    const handlers = this.listeners.get(event);
    handlers?.forEach((handler) => handler(data));
  }
}

// Setup media mocks globally
export const setupMediaMocks = () => {
  global.MediaStream = MockMediaStream as any;
  global.MediaRecorder = MockMediaRecorder as any;
  global.Audio = MockAudio as any;

  if (!global.navigator.mediaDevices) {
    (global.navigator as any).mediaDevices = {};
  }

  global.navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(new MockMediaStream());
  global.navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([
    {
      deviceId: 'default',
      kind: 'audioinput' as MediaDeviceKind,
      label: 'Default Microphone',
      groupId: 'default',
      toJSON: () => ({}),
    },
  ]);
};

export const resetMediaMocks = () => {
  vi.mocked(global.navigator.mediaDevices.getUserMedia).mockClear();
  vi.mocked(global.navigator.mediaDevices.enumerateDevices).mockClear();
};
