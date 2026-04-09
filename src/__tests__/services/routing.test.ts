/**
 * Tests for transcription/index.ts — provider routing.
 *
 * Validates that the LLM-agnostic interface correctly dispatches to the
 * right provider and that adding a new provider in future won't silently
 * fall through without the exhaustiveness check catching it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribe } from '@/services/transcription';
import type { MeetingContext } from '@/types';

// Mock the Gemini provider so tests don't make real API calls
vi.mock('@/services/transcription/gemini', () => ({
  transcribeWithGemini:  vi.fn().mockResolvedValue('[00:00:00] Harish: Hello everyone.'),
  validateGeminiKey:     vi.fn().mockResolvedValue({ valid: true }),
  fetchGeminiModels:     vi.fn().mockResolvedValue([]),
  buildTranscriptionPrompt: vi.fn().mockReturnValue('mock prompt'),
  classifyError:         vi.fn().mockReturnValue({ message: 'err', retryable: false }),
  AUDIO_CAPABLE_MODELS:  [],
  DEFAULT_GEMINI_MODEL:  'gemini-2.5-flash',
}));

const mockFile   = new File(['audio'], 'meeting.webm', { type: 'audio/webm' });
const mockConfig = { provider: 'gemini' as const, apiKey: 'AIza-key', model: 'gemini-2.5-flash' };
const mockCtx: MeetingContext = { hostName: 'Harish', participants: ['Priya'] };

describe('transcribe() routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the Gemini provider for provider="gemini"', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    await transcribe(mockFile, mockConfig, vi.fn());
    expect(transcribeWithGemini).toHaveBeenCalledOnce();
  });

  it('passes the file through to the provider', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    await transcribe(mockFile, mockConfig, vi.fn());
    expect(transcribeWithGemini).toHaveBeenCalledWith(
      mockFile,
      expect.any(String),   // apiKey
      expect.any(String),   // model
      expect.any(Function), // onProgress
      undefined,            // context (not passed)
    );
  });

  it('passes MeetingContext to the provider when supplied', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    await transcribe(mockFile, mockConfig, vi.fn(), mockCtx);
    expect(transcribeWithGemini).toHaveBeenCalledWith(
      mockFile,
      'AIza-key',
      'gemini-2.5-flash',
      expect.any(Function),
      mockCtx,
    );
  });

  it('returns the transcript string from the provider', async () => {
    const result = await transcribe(mockFile, mockConfig, vi.fn());
    expect(result).toBe('[00:00:00] Harish: Hello everyone.');
  });

  it('calls onProgress callback (provider is responsible for calling it)', async () => {
    // onProgress is forwarded to the provider — the routing layer does not call it itself
    const onProgress = vi.fn();
    await transcribe(mockFile, mockConfig, onProgress);
    // Confirm onProgress was passed (not swallowed)
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    const callArgs = (transcribeWithGemini as any).mock.calls[0];
    expect(callArgs[3]).toBe(onProgress);
  });
});

describe('transcribe() constants exported from index', () => {
  it('exports ACCEPTED_MIME_TYPES as a non-empty array', async () => {
    const { ACCEPTED_MIME_TYPES } = await import('@/services/transcription');
    expect(Array.isArray(ACCEPTED_MIME_TYPES)).toBe(true);
    expect(ACCEPTED_MIME_TYPES.length).toBeGreaterThan(0);
  });

  it('includes common audio formats', async () => {
    const { ACCEPTED_MIME_TYPES } = await import('@/services/transcription');
    expect(ACCEPTED_MIME_TYPES).toContain('audio/mpeg');
    expect(ACCEPTED_MIME_TYPES).toContain('audio/wav');
    expect(ACCEPTED_MIME_TYPES).toContain('audio/webm');
    expect(ACCEPTED_MIME_TYPES).toContain('video/mp4');
  });

  it('exports MAX_FILE_SIZE_BYTES as 500 MB', async () => {
    const { MAX_FILE_SIZE_BYTES } = await import('@/services/transcription');
    expect(MAX_FILE_SIZE_BYTES).toBe(500 * 1024 * 1024);
  });

  it('exports ACCEPTED_EXTENSIONS string', async () => {
    const { ACCEPTED_EXTENSIONS } = await import('@/services/transcription');
    expect(typeof ACCEPTED_EXTENSIONS).toBe('string');
    expect(ACCEPTED_EXTENSIONS).toContain('.mp3');
    expect(ACCEPTED_EXTENSIONS).toContain('.mp4');
  });
});
