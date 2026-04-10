/**
 * groq.ts — Groq transcription provider.
 *
 * Groq runs Whisper inference at very high speeds via an OpenAI-compatible API.
 * The free tier is generous (~2 hours of audio per day at the time of writing).
 *
 * Limitations vs Gemini / GPT-4o:
 *   - Max file size: 25 MB (same as OpenAI Whisper)
 *   - No speaker diarization — returns a plain timestamped transcript
 *   - Participant names are passed as a `prompt` hint so Whisper transcribes
 *     them correctly, but the output will not have Speaker X: labels
 *
 * Best for: quick transcripts, English meetings, users who want a free tier
 *
 * Get a free API key at: console.groq.com/keys
 */

import type { MeetingContext } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL            = 'https://api.groq.com/openai';
export const INLINE_LIMIT_BYTES_GROQ = 25 * 1024 * 1024; // 25 MB

export const GROQ_AUDIO_MODELS = [
  {
    id:            'whisper-large-v3',
    displayName:   'Whisper Large v3',
    description:   'Best accuracy — recommended for most meetings',
    isRecommended: true,
    inputTokenLimit: null,
  },
  {
    id:            'whisper-large-v3-turbo',
    displayName:   'Whisper Large v3 Turbo',
    description:   'Faster, slightly less accurate',
    isRecommended: false,
    inputTokenLimit: null,
  },
  {
    id:            'distil-whisper-large-v3-en',
    displayName:   'Distil-Whisper Large v3 (English only)',
    description:   'Fastest — English-only meetings',
    isRecommended: false,
    inputTokenLimit: null,
  },
];

export const DEFAULT_GROQ_MODEL = 'whisper-large-v3';

// ── Error classification ──────────────────────────────────────────────────────

export function classifyGroqError(err: unknown): { message: string; retryable: boolean; waitMs?: number } {
  const raw    = String((err as any)?.message ?? '');
  const lower  = raw.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode;

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { message: 'Groq rate limit hit. Waiting 65 seconds before retry...', retryable: true, waitMs: 65_000 };
  }
  if (status === 401 || lower.includes('invalid api key') || lower.includes('authentication')) {
    return { message: 'Invalid Groq API key. Please check your key in Settings.', retryable: false };
  }
  if (status === 413 || lower.includes('too large')) {
    return { message: 'File is too large for Groq (max 25 MB). Use Gemini for larger recordings.', retryable: false };
  }
  if (status === 503 || lower.includes('service unavailable')) {
    return { message: 'Groq is temporarily unavailable. Retrying...', retryable: true, waitMs: 10_000 };
  }
  return { message: raw || 'Transcription failed. Please try again.', retryable: true };
}

// ── Validation / model discovery ──────────────────────────────────────────────

export async function validateGroqKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || 'Invalid API key' };
  } catch {
    return { valid: false, error: 'Could not reach Groq — check your internet connection.' };
  }
}

export async function fetchGroqModels(_apiKey: string) {
  // Groq's model list is stable — return our curated list directly
  return GROQ_AUDIO_MODELS;
}

// ── Core transcription ────────────────────────────────────────────────────────

export async function transcribeWithGroq(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  if (file.size > INLINE_LIMIT_BYTES_GROQ) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — Groq's Whisper API has a 25 MB limit. ` +
      `Switch to Gemini in Settings to handle larger recordings (supports up to 2 GB).`
    );
  }

  onProgress('Transcribing', `Sending to Groq Whisper (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

  const form = new FormData();
  form.append('file', file);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  // Pass names as a bare word list — NOT a full sentence like "Participants: X, Y."
  // Whisper hallucinates by repeating the prompt verbatim during silence when the
  // prompt looks like speech. Bare names are treated as vocabulary, not as spoken words.
  const names = [
    context?.hostName ?? '',
    ...(context?.participants ?? []),
  ].filter(Boolean);
  if (names.length > 0) {
    // Brief title prefix helps domain context; names alone fix spelling
    const hint = context?.meetingTitle
      ? `${context.meetingTitle}: ${names.join(', ')}`
      : names.join(', ');
    form.append('prompt', hint);
  }

  const res = await fetch(`${BASE_URL}/v1/audio/transcriptions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body:    form,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(data?.error?.message || `Groq error ${res.status}`),
      { status: res.status }
    );
  }

  const data = await res.json();

  if (data.segments?.length > 0) {
    // Build a regex that matches Whisper hallucinations of the participant names prompt.
    // Whisper sometimes echoes the prompt text verbatim as a standalone segment during
    // silence — strip those lines so they don't pollute the transcript.
    const namePattern = names.length > 0
      ? new RegExp(`^\\[\\d{2}:\\d{2}:\\d{2}\\]\\s*(participants?[,:]?\\s*)?${
          names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[,\\s]+')
        }[.,]?\\s*$`, 'i')
      : null;

    return data.segments
      .map((seg: any) => {
        const h  = Math.floor(seg.start / 3600);
        const m  = Math.floor((seg.start % 3600) / 60);
        const s  = Math.floor(seg.start % 60);
        const ts = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        return `[${ts}] ${seg.text.trim()}`;
      })
      .filter((line: string) => !namePattern || !namePattern.test(line))
      .join('\n');
  }

  return data.text ?? '';
}
