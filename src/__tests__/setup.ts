import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';

// ── Reset localStorage between every test ────────────────────────────────────
beforeEach(() => {
  localStorage.clear();
});

// ── Silence console.warn in tests unless explicitly expected ─────────────────
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ── Stub browser APIs that jsdom doesn't implement ───────────────────────────

// MediaDevices (not available in jsdom)
Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia:   vi.fn().mockResolvedValue({ getTracks: () => [] }),
    getDisplayMedia: vi.fn().mockResolvedValue({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] }),
  },
});

// Clipboard API (not available in jsdom)
Object.defineProperty(global.navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// URL.createObjectURL (not available in jsdom)
global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
global.URL.revokeObjectURL = vi.fn();

// AudioContext stub
global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource:      vi.fn().mockReturnValue({ connect: vi.fn() }),
  createMediaStreamDestination: vi.fn().mockReturnValue({ stream: {}, connect: vi.fn() }),
  createChannelMerger:          vi.fn().mockReturnValue({ connect: vi.fn() }),
  createAnalyser:               vi.fn().mockReturnValue({ fftSize: 0, connect: vi.fn(), getByteFrequencyData: vi.fn(), getFloatTimeDomainData: vi.fn() }),
  close:                        vi.fn().mockResolvedValue(undefined),
  state: 'running',
})) as any;

// MediaRecorder stub
global.MediaRecorder = vi.fn().mockImplementation(() => ({
  start:  vi.fn(),
  stop:   vi.fn(),
  pause:  vi.fn(),
  resume: vi.fn(),
  state:  'inactive',
  ondataavailable: null,
  onstop: null,
})) as any;
(global.MediaRecorder as any).isTypeSupported = vi.fn().mockReturnValue(true);
