/**
 * openai.ts — OpenAI transcription provider.
 *
 * Two modes depending on the selected model:
 *
 *   gpt-4o-audio-preview  → Chat Completions with inline audio
 *                           Full speaker identification via our prompt (same quality as Gemini)
 *                           Max 25 MB — OpenAI has no async File API for audio
 *
 *   whisper-1             → /v1/audio/transcriptions (multipart form)
 *                           Plain timestamped transcript — no speaker diarization
 *                           Participant names passed as a `prompt` hint so names
 *                           are transcribed correctly, but no Speaker X: labels
 *
 * Get an API key at: platform.openai.com/api-keys
 */

import type { MeetingContext } from '@/types';
import { buildTranscriptionPrompt } from './gemini';  // prompt is provider-agnostic

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL            = 'https://api.openai.com';
export const INLINE_LIMIT_BYTES_OPENAI = 25 * 1024 * 1024; // OpenAI hard limit: 25 MB

export const OPENAI_AUDIO_MODELS = [
  {
    id:            'gpt-4o-audio-preview',
    displayName:   'GPT-4o Audio Preview',
    description:   'Best quality — understands context, identifies speakers by name',
    isRecommended: true,
    inputTokenLimit: null,
  },
  {
    id:            'gpt-4o-mini-audio-preview',
    displayName:   'GPT-4o Mini Audio Preview',
    description:   'Faster and cheaper — still supports speaker identification',
    isRecommended: false,
    inputTokenLimit: null,
  },
  {
    id:            'whisper-1',
    displayName:   'Whisper 1',
    description:   'Fast and economical — plain transcript, no speaker labels',
    isRecommended: false,
    inputTokenLimit: null,
  },
];

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-audio-preview';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAudioFormat(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a'))  return 'mp4';
  if (mimeType.includes('wav'))  return 'wav';
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg'))  return 'ogg';
  if (mimeType.includes('flac')) return 'flac';
  return 'mp3'; // fallback
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// ── Error classification ──────────────────────────────────────────────────────

export function classifyOpenAIError(err: unknown): { message: string; retryable: boolean; waitMs?: number } {
  const raw    = String((err as any)?.message ?? '');
  const lower  = raw.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode;

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return { message: 'OpenAI rate limit hit. Waiting 65 seconds before retry...', retryable: true, waitMs: 65_000 };
  }
  if (status === 401 || lower.includes('invalid api key') || lower.includes('authentication')) {
    return { message: 'Invalid OpenAI API key. Please check your key in Settings.', retryable: false };
  }
  if (status === 413 || lower.includes('too large') || lower.includes('maximum file size')) {
    return { message: 'File is too large for OpenAI (max 25 MB). Use Gemini for larger recordings.', retryable: false };
  }
  if (status === 503 || lower.includes('service unavailable')) {
    return { message: 'OpenAI is temporarily unavailable. Retrying...', retryable: true, waitMs: 10_000 };
  }
  if (status === 500 || lower.includes('internal')) {
    return { message: 'OpenAI internal error. Retrying...', retryable: true };
  }
  return { message: raw || 'Transcription failed. Please try again.', retryable: true };
}

// ── Validation / model discovery ──────────────────────────────────────────────

export async function validateOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || 'Invalid API key' };
  } catch {
    return { valid: false, error: 'Could not reach OpenAI — check your internet connection.' };
  }
}

export async function fetchOpenAIModels(apiKey: string) {
  // Verify the account has access to these models by checking the models list
  const res = await fetch(`${BASE_URL}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to fetch models');
  }
  const data   = await res.json();
  const avail  = new Set<string>((data.data ?? []).map((m: any) => m.id as string));
  return OPENAI_AUDIO_MODELS.filter(m => avail.has(m.id));
}

// ── Core transcription ────────────────────────────────────────────────────────

export async function transcribeWithOpenAI(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  if (file.size > INLINE_LIMIT_BYTES_OPENAI) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — OpenAI's API has a 25 MB limit. ` +
      `Switch to Gemini in Settings to handle larger recordings (supports up to 2 GB).`
    );
  }

  if (model === 'whisper-1') {
    return transcribeWithWhisper(file, apiKey, onProgress, context);
  }
  return transcribeWithGPT4oAudio(file, apiKey, model, onProgress, context);
}

// ── gpt-4o-audio-preview path ─────────────────────────────────────────────────

async function transcribeWithGPT4oAudio(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  onProgress('Preparing', `Encoding ${(file.size / 1024 / 1024).toFixed(1)} MB...`);
  const base64 = await fileToBase64(file);
  const format = getAudioFormat(file.type);

  onProgress('Transcribing', 'Sending to OpenAI (this may take a moment for long recordings)...');

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role:    'user',
        content: [
          { type: 'input_audio', input_audio: { data: base64, format } },
          { type: 'text',        text: buildTranscriptionPrompt(context) },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(data?.error?.message || `OpenAI error ${res.status}`),
      { status: res.status }
    );
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned an empty response. Please try again.');
  return text;
}

// ── whisper-1 path ────────────────────────────────────────────────────────────

async function transcribeWithWhisper(
  file: File,
  apiKey: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  onProgress('Transcribing', `Sending to Whisper (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  // Pass names as bare words, not a sentence — avoids Whisper echoing the prompt
  // during silence (a known hallucination pattern with speech-like prompts).
  const names = [
    context?.hostName ?? '',
    ...(context?.participants ?? []),
  ].filter(Boolean);
  if (names.length > 0) {
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
      new Error(data?.error?.message || `Whisper error ${res.status}`),
      { status: res.status }
    );
  }

  const data = await res.json();

  // Format verbose_json segments, stripping any hallucinated name-list lines
  if (data.segments?.length > 0) {
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
