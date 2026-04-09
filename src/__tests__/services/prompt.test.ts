/**
 * Tests for buildTranscriptionPrompt()
 *
 * This is the most critical unit in the app — a wrong prompt means wrong
 * speaker names in the output, which breaks Project 2 (meeting notes).
 * Every branching condition in the builder is tested explicitly.
 */

import { describe, it, expect } from 'vitest';
import { buildTranscriptionPrompt } from '@/services/transcription/gemini';

// ── Helper: call once, keep result for multiple assertions ───────────────────
function build(opts?: Parameters<typeof buildTranscriptionPrompt>[0]) {
  return buildTranscriptionPrompt(opts);
}

describe('buildTranscriptionPrompt — no context provided', () => {
  it('returns a non-empty string', () => {
    expect(build()).toBeTruthy();
    expect(typeof build()).toBe('string');
  });

  it('contains fallback Speaker A/B labelling instruction', () => {
    const p = build();
    expect(p).toMatch(/Speaker A/i);
    expect(p).toMatch(/Speaker B/i);
  });

  it('does NOT contain any participant-specific instructions', () => {
    const p = build();
    expect(p).not.toMatch(/HOST \/ RECORDER/i);
    expect(p).not.toMatch(/MEETING PARTICIPANTS/i);
  });

  it('still contains core transcription rules', () => {
    const p = build();
    expect(p).toMatch(/Transcribe every word/i);
    expect(p).toMatch(/\[HH:MM:SS\]/);
    expect(p).toMatch(/\[inaudible\]/i);
  });
});

describe('buildTranscriptionPrompt — host name only', () => {
  const p = build({ hostName: 'Harish', participants: [] });

  it('mentions the host name', () => {
    expect(p).toContain('Harish');
  });

  it('labels the host as the primary mic / left channel owner', () => {
    expect(p).toMatch(/HOST.*RECORDER/i);
    expect(p).toContain('"Harish"');
  });

  it('describes stereo channel separation strategy', () => {
    expect(p).toMatch(/left.*channel/i);
  });

  it('does NOT list other participants when none provided', () => {
    expect(p).not.toMatch(/OTHER PARTICIPANTS:/);
  });
});

describe('buildTranscriptionPrompt — host + participants', () => {
  const p = build({ hostName: 'Harish', participants: ['Priya', 'Raj'] });

  it('mentions all participant names', () => {
    expect(p).toContain('Harish');
    expect(p).toContain('Priya');
    expect(p).toContain('Raj');
  });

  it('lists participants under the OTHER PARTICIPANTS section', () => {
    expect(p).toMatch(/OTHER PARTICIPANTS/i);
    expect(p).toContain('"Priya"');
    expect(p).toContain('"Raj"');
  });

  it('still includes voice consistency rule', () => {
    expect(p).toMatch(/VOICE CONSISTENCY/i);
  });

  it('includes the identification priority ladder', () => {
    expect(p).toMatch(/CHANNEL SIGNAL/i);
    expect(p).toMatch(/NAME MENTIONS/i);
    expect(p).toMatch(/FALLBACK/i);
  });
});

describe('buildTranscriptionPrompt — meeting title', () => {
  it('includes the meeting title when provided', () => {
    const p = build({ hostName: 'Harish', participants: [], meetingTitle: 'Q2 Planning' });
    expect(p).toContain('Q2 Planning');
  });

  it('omits the meeting title section when not provided', () => {
    const p = build({ hostName: 'Harish', participants: [] });
    expect(p).not.toMatch(/MEETING TITLE/i);
  });
});

describe('buildTranscriptionPrompt — edge cases', () => {
  it('handles whitespace-only hostName as no host', () => {
    const p = build({ hostName: '   ', participants: [] });
    // whitespace-only should be treated as empty → no HOST section
    expect(p).not.toMatch(/HOST.*RECORDER/i);
  });

  it('filters out empty strings from participants array', () => {
    const p = build({ hostName: 'Harish', participants: ['', 'Priya', ''] });
    expect(p).toContain('Priya');
    // Should not produce empty quoted strings like ""
    expect(p).not.toContain('""');
  });

  it('output format block is always present', () => {
    const p = build();
    expect(p).toMatch(/OUTPUT FORMAT/i);
    expect(p).toMatch(/\[HH:MM:SS\] Name:/);
  });

  it('no-speech fallback line is always present', () => {
    const p = build();
    expect(p).toMatch(/No speech detected/i);
  });
});
