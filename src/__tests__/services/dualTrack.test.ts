/**
 * Tests for dual-track speaker identification.
 *
 * Covers:
 *   - buildDualTrackPrompt()  — prompt used when both mic and system tracks are available
 *   - buildMicOnlyPrompt()    — prompt used when only the mic track is available
 *   - Routing: AudioTracks are forwarded from transcribe() → provider
 *   - Routing: mic-only tracks route correctly (no systemFile)
 *
 * The dual-track feature is the primary fix for speaker identification failures.
 * These tests assert the contract between the recorder, the routing layer, and
 * the prompt builder — the three components that must work together correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildDualTrackPrompt,
  buildMicOnlyPrompt,
  buildTranscriptionPrompt,
} from '@/services/transcription/gemini';
import { transcribe } from '@/services/transcription';
import type { MeetingContext, AudioTracks } from '@/types';

// ── Mock the Gemini provider so no real API calls are made ───────────────────

vi.mock('@/services/transcription/gemini', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/transcription/gemini')>();
  return {
    ...real,                                                 // keep real prompt functions
    transcribeWithGemini: vi.fn().mockResolvedValue('[00:00:00] Harish: Hello.'),
  };
});

const mockFile   = new File(['audio'], 'meeting.webm',  { type: 'audio/webm' });
const mockMic    = new File(['mic'],   'mic.webm',      { type: 'audio/webm' });
const mockSys    = new File(['sys'],   'system.webm',   { type: 'audio/webm' });
const mockConfig = { provider: 'gemini' as const, apiKey: 'AIza-key', model: 'gemini-2.5-flash' };
const mockCtx: MeetingContext = { hostName: 'Harish', participants: ['Priya', 'Raj'], meetingTitle: 'Q2 Planning' };

// ── buildDualTrackPrompt ──────────────────────────────────────────────────────

describe('buildDualTrackPrompt — structure', () => {
  it('returns a non-empty string', () => {
    expect(buildDualTrackPrompt()).toBeTruthy();
  });

  it('mentions TRACK 1 and TRACK 2', () => {
    const p = buildDualTrackPrompt();
    expect(p).toMatch(/TRACK 1/i);
    expect(p).toMatch(/TRACK 2/i);
  });

  it('instructs Gemini to interleave both tracks chronologically', () => {
    const p = buildDualTrackPrompt();
    expect(p).toMatch(/interleave/i);
    expect(p).toMatch(/chronological/i);
  });

  it('includes the output timestamp format', () => {
    const p = buildDualTrackPrompt();
    expect(p).toMatch(/\[HH:MM:SS\]/);
  });
});

describe('buildDualTrackPrompt — with host name', () => {
  const p = buildDualTrackPrompt({ hostName: 'Harish', participants: [], meetingTitle: 'Q2 Planning' });

  it('embeds the host name in Track 1 description', () => {
    expect(p).toContain('"Harish"');
  });

  it('guarantees Track 1 = host with strong language', () => {
    // The prompt must make it unambiguous — look for the guarantee phrase
    expect(p).toMatch(/EVERY SINGLE WORD.*Track 1|Track 1.*EVERY SINGLE WORD/is);
  });

  it('includes the meeting title', () => {
    expect(p).toContain('Q2 Planning');
  });

  it('uses the host name in the output format example', () => {
    expect(p).toContain('Harish:');
  });
});

describe('buildDualTrackPrompt — with participants', () => {
  const p = buildDualTrackPrompt({ hostName: 'Harish', participants: ['Priya', 'Raj'] });

  it('lists participant names for Track 2 identification', () => {
    expect(p).toContain('Priya');
    expect(p).toContain('Raj');
  });

  it('tells Gemini to use voice consistency for participants', () => {
    expect(p).toMatch(/voice consistency/i);
  });

  it('instructs Gemini to fall back to Participant B/C labels', () => {
    expect(p).toMatch(/Participant B/i);
    expect(p).toMatch(/Participant C/i);
  });
});

describe('buildDualTrackPrompt — no context', () => {
  const p = buildDualTrackPrompt();

  it('uses "Host" as the default host name', () => {
    // Default host label should appear somewhere
    expect(p).toMatch(/Host/i);
  });

  it('instructs Gemini to use Participant B/C labels when no names given', () => {
    expect(p).toMatch(/Participant B/i);
  });

  it('still includes core transcription rules', () => {
    expect(p).toMatch(/Transcribe every word/i);
    expect(p).toMatch(/\[inaudible\]/i);
  });
});

// ── buildMicOnlyPrompt ────────────────────────────────────────────────────────

describe('buildMicOnlyPrompt — structure', () => {
  it('returns a non-empty string', () => {
    expect(buildMicOnlyPrompt()).toBeTruthy();
  });

  it('explicitly states this is a microphone-only recording', () => {
    const p = buildMicOnlyPrompt();
    expect(p).toMatch(/microphone.only/i);
  });

  it('warns that remote participants are NOT reliably audible', () => {
    const p = buildMicOnlyPrompt();
    expect(p).toMatch(/NOT recorded|not.*recorded/i);
  });
});

describe('buildMicOnlyPrompt — with host name', () => {
  const p = buildMicOnlyPrompt({ hostName: 'Harish', participants: ['Priya'], meetingTitle: 'Standup' });

  it('names the host explicitly', () => {
    expect(p).toContain('"Harish"');
  });

  it('says the host voice is clearest/loudest', () => {
    expect(p).toMatch(/clearest|loudest/i);
  });

  it('mentions the known participants for reference', () => {
    expect(p).toContain('Priya');
  });

  it('includes the meeting title', () => {
    expect(p).toContain('Standup');
  });
});

// ── Difference between the three prompt types ─────────────────────────────────

describe('prompt type differentiation', () => {
  it('dual-track prompt is distinct from fallback prompt', () => {
    const dual     = buildDualTrackPrompt(mockCtx);
    const fallback = buildTranscriptionPrompt(mockCtx);
    expect(dual).not.toBe(fallback);
    expect(dual).toMatch(/TRACK 1.*TRACK 2|TRACK 2.*TRACK 1/is);
    expect(fallback).not.toMatch(/TRACK 1.*TRACK 2/is);
  });

  it('mic-only prompt is distinct from dual-track prompt', () => {
    const micOnly = buildMicOnlyPrompt(mockCtx);
    const dual    = buildDualTrackPrompt(mockCtx);
    expect(micOnly).not.toBe(dual);
    expect(micOnly).toMatch(/microphone.only/i);
    expect(dual).toMatch(/TRACK 2/i);
  });

  it('fallback prompt still contains CHANNEL SIGNAL for uploaded stereo files', () => {
    const p = buildTranscriptionPrompt(mockCtx);
    expect(p).toMatch(/CHANNEL SIGNAL/i);
    expect(p).toMatch(/left.*channel/i);
  });
});

// ── AudioTracks routing through transcribe() ──────────────────────────────────

describe('transcribe() — AudioTracks forwarding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes AudioTracks through to the provider when both tracks provided', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    const tracks: AudioTracks = { micFile: mockMic, systemFile: mockSys };
    await transcribe(mockFile, mockConfig, vi.fn(), mockCtx, tracks);
    expect(transcribeWithGemini).toHaveBeenCalledWith(
      mockFile,
      'AIza-key',
      'gemini-2.5-flash',
      expect.any(Function),
      mockCtx,
      tracks,
    );
  });

  it('passes mic-only AudioTracks correctly (no systemFile)', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    const tracks: AudioTracks = { micFile: mockMic };
    await transcribe(mockFile, mockConfig, vi.fn(), mockCtx, tracks);
    const callArg = (transcribeWithGemini as any).mock.calls[0][5] as AudioTracks;
    expect(callArg.micFile).toBe(mockMic);
    expect(callArg.systemFile).toBeUndefined();
  });

  it('passes undefined tracks when no tracks supplied (backward compatibility)', async () => {
    const { transcribeWithGemini } = await import('@/services/transcription/gemini');
    await transcribe(mockFile, mockConfig, vi.fn(), mockCtx);
    const callArg = (transcribeWithGemini as any).mock.calls[0][5];
    expect(callArg).toBeUndefined();
  });

  it('still returns the transcript string when tracks are provided', async () => {
    const tracks: AudioTracks = { micFile: mockMic, systemFile: mockSys };
    const result = await transcribe(mockFile, mockConfig, vi.fn(), mockCtx, tracks);
    expect(result).toBe('[00:00:00] Harish: Hello.');
  });
});

// ── AudioTracks type contract ─────────────────────────────────────────────────

describe('AudioTracks type contract', () => {
  it('accepts both tracks present', () => {
    const tracks: AudioTracks = { micFile: mockMic, systemFile: mockSys };
    expect(tracks.micFile).toBeDefined();
    expect(tracks.systemFile).toBeDefined();
  });

  it('accepts mic-only (systemFile optional)', () => {
    const tracks: AudioTracks = { micFile: mockMic };
    expect(tracks.micFile).toBeDefined();
    expect(tracks.systemFile).toBeUndefined();
  });

  it('accepts empty tracks (both optional)', () => {
    const tracks: AudioTracks = {};
    expect(tracks.micFile).toBeUndefined();
    expect(tracks.systemFile).toBeUndefined();
  });
});
