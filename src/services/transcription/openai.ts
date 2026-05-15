/**
 * openai.ts — OpenAI transcription provider.
 *
 * Two modes depending on the selected model:
 *
 *   gpt-4o-audio-preview → Chat Completions with inline audio
 *     Full speaker identification via our prompt (same quality as Gemini)
 *     Max 25 MB — OpenAI has no async File API for audio
 *
 *   whisper-1 → /v1/audio/transcriptions (multipart form)
 *     Plain timestamped transcript — no speaker diarization
 *     Participant names passed as a `prompt` hint so names
 *     are transcribed correctly, but no Speaker X: labels
 *
 * Get an API key at: platform.openai.com/api-keys
 *
 * ── FIXES IN THIS VERSION ────────────────────────────────────────────────────
 * FIX 1 — normalizeMimeType() strips codec parameters
 *   "audio/webm;codecs=opus" → "audio/webm". OpenAI's API rejects the codec
 *   suffix; sending it causes silent transcription failures.
 *
 * FIX 2 — Promise.race() fetch timeouts (5–8 minutes)
 *   Without timeouts a stalled connection hangs the UI indefinitely.
 *
 * FIX 3 — Chunked Whisper transcription for files between 25–500 MB
 *   Large files are split into ≤ 23 MB blobs, each transcribed separately,
 *   then concatenated with approximate timestamp offsets. Live recordings
 *   stay well under 25 MB because useAudioRecorder.ts caps bitrate at 64 kbps.
 */

import type { MeetingContext, AudioTracks } from '@/types';
import { buildTranscriptionPrompt } from './gemini'; // prompt is provider-agnostic

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL                   = 'https://api.openai.com';
export const INLINE_LIMIT_BYTES_OPENAI = 25 * 1024 * 1024; // OpenAI hard limit: 25 MB
/** Each Whisper chunk must be safely under the 25 MB limit. */
const CHUNK_SIZE_BYTES           = 23 * 1024 * 1024;        // 23 MB
/** Timeout for a Whisper / GPT-4o Audio request. */
const REQUEST_TIMEOUT_MS         = 8 * 60 * 1_000;          // 8 minutes

export const OPENAI_AUDIO_MODELS = [
  {
    id:              'gpt-4o-audio-preview',
    displayName:     'GPT-4o Audio Preview',
    description:     'Best quality — understands context, identifies speakers by name',
    isRecommended:   true,
    inputTokenLimit: null,
  },
  {
    id:              'gpt-4o-mini-audio-preview',
    displayName:     'GPT-4o Mini Audio Preview',
    description:     'Faster and cheaper — still supports speaker identification',
    isRecommended:   false,
    inputTokenLimit: null,
  },
  {
    id:              'whisper-1',
    displayName:     'Whisper 1',
    description:     'Fast and economical — plain transcript, no speaker labels',
    isRecommended:   false,
    inputTokenLimit: null,
  },
];

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-audio-preview';

// ── MIME type normalisation ───────────────────────────────────────────────────

/**
 * Strip codec / parameter suffixes that OpenAI's API does not accept.
 * "audio/webm;codecs=opus"  →  "audio/webm"
 */
function normalizeMimeType(type: string): string {
  const base = (type || 'audio/webm').split(';')[0].trim();
  return base || 'audio/webm';
}

/** Rejects after `ms` milliseconds with a clear timeout message. */
function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(
        `${label} timed out after ${Math.round(ms / 60_000)} minutes. ` +
        `Check your network connection and try again.`
      )),
      ms
    )
  );
}

function getAudioFormat(mimeType: string): string {
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a'))  return 'mp4';
  if (mimeType.includes('wav'))                               return 'wav';
  if (mimeType.includes('webm'))                              return 'webm';
  if (mimeType.includes('ogg'))                               return 'ogg';
  if (mimeType.includes('flac'))                              return 'flac';
  return 'mp3'; // fallback
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = () => {
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
  if (lower.includes('timed out')) {
    return { message: raw, retryable: true };
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
  const res = await fetch(`${BASE_URL}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to fetch models');
  }
  const data  = await res.json();
  const avail = new Set<string>((data.data ?? []).map((m: any) => m.id as string));
  return OPENAI_AUDIO_MODELS.filter(m => avail.has(m.id));
}

// ── Core transcription dispatcher ─────────────────────────────────────────────

function mergeTimestampedLines(lines: string[]): string {
  const parsed = lines
    .map(line => {
      const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]/);
      if (!m) return null;
      const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
      return { secs, line };
    })
    .filter((x): x is { secs: number; line: string } => x !== null);
  parsed.sort((a, b) => a.secs - b.secs);
  return parsed.map(x => x.line).join('\n');
}

export async function transcribeWithOpenAI(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
  tracks?: AudioTracks,
): Promise<string> {
  if (model === 'whisper-1') {
    return transcribeWithWhisper(file, apiKey, onProgress, context, tracks);
  }
  // GPT-4o audio models have a hard 25 MB limit with no chunking path
  if (file.size > INLINE_LIMIT_BYTES_OPENAI) {
    throw new Error(
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — GPT-4o Audio has a 25 MB limit. ` +
      `Switch to Gemini in Settings to handle larger recordings (supports up to 2 GB), ` +
      `or use Whisper-1 which supports chunked uploads.`
    );
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
  // FIX 1: Normalise the MIME type before passing to the API
  const format = getAudioFormat(normalizeMimeType(file.type));

  onProgress('Transcribing', 'Sending to OpenAI (this may take a moment for long recordings)...');

  // FIX 2: Hard timeout
  const res = await Promise.race([
    fetch(`${BASE_URL}/v1/chat/completions`, {
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
            { type: 'text',        text: buildTranscriptionPrompt(context)  },
          ],
        }],
      }),
    }),
    timeoutAfter(REQUEST_TIMEOUT_MS, 'OpenAI transcription request'),
  ]);

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

async function transcribeBlob(
  blob: Blob,
  mimeType: string,
  filename: string,
  apiKey: string,
  promptHint: string,
): Promise<any> {
  // FIX 1: Re-wrap with clean MIME type to avoid "audio/webm;codecs=opus" rejection
  const cleanBlob = new Blob([blob], { type: mimeType });

  const form = new FormData();
  form.append('file',                    cleanBlob, filename);
  form.append('model',                   'whisper-1');
  form.append('response_format',         'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (promptHint) form.append('prompt', promptHint);

  // FIX 2: Hard timeout
  const res = await Promise.race([
    fetch(`${BASE_URL}/v1/audio/transcriptions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    }),
    timeoutAfter(REQUEST_TIMEOUT_MS, 'Whisper transcription request'),
  ]);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(data?.error?.message || `Whisper error ${res.status}`),
      { status: res.status }
    );
  }

  return res.json();
}

function formatSegments(data: any, offsetSeconds: number, names: string[]): string {
  if (!data.segments?.length) return data.text ?? '';

  const namePattern = names.length > 0
    ? new RegExp(
        `^\\[\\d{2}:\\d{2}:\\d{2}\\]\\s*(participants?[,:]?\\s*)?${
          names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[,\\s]+')
        }[.,]?\\s*$`,
        'i'
      )
    : null;

  return data.segments
    .map((seg: any) => {
      const t  = seg.start + offsetSeconds;
      const h  = Math.floor(t / 3600);
      const m  = Math.floor((t % 3600) / 60);
      const s  = Math.floor(t % 60);
      const ts = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      return `[${ts}] ${seg.text.trim()}`;
    })
    .filter((line: string) => !namePattern || !namePattern.test(line))
    .join('\n');
}

async function transcribeWithWhisper(
  file: File,
  apiKey: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
  tracks?: AudioTracks,
): Promise<string> {
  const mimeType   = normalizeMimeType(file.type);
  const hostName   = context?.hostName?.trim() || 'Host';

  const names = [
    context?.hostName ?? '',
    ...(context?.participants ?? []),
  ].filter(Boolean);

  const promptHint = names.length > 0
    ? (context?.meetingTitle
        ? `${context.meetingTitle}: ${names.join(', ')}`
        : names.join(', '))
    : '';

  // ── Dual-track path ───────────────────────────────────────────────────────
  if (tracks?.micFile) {
    const micMime = normalizeMimeType(tracks.micFile.type);
    const sysMime = tracks.systemFile ? normalizeMimeType(tracks.systemFile.type) : mimeType;

    onProgress('Transcribing', 'Transcribing host microphone track...');
    const micData = await transcribeBlob(tracks.micFile, micMime, tracks.micFile.name, apiKey, promptHint)
      .catch(err => { throw new Error(classifyOpenAIError(err).message); });

    const micLines = formatSegments(micData, 0, []).split('\n').filter(Boolean)
      .map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s*/, `[$1] ${hostName}: `));

    if (!tracks.systemFile) return micLines.join('\n');

    onProgress('Transcribing', 'Transcribing participant audio track...');
    const sysData = await transcribeBlob(tracks.systemFile, sysMime, tracks.systemFile.name, apiKey, promptHint)
      .catch(err => { throw new Error(classifyOpenAIError(err).message); });

    const sysLines = formatSegments(sysData, 0, names).split('\n').filter(Boolean)
      .map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s*/, '$&Participant: '));

    return mergeTimestampedLines([...micLines, ...sysLines]);
  }

  // ── FIX 3: Chunked transcription for large files ──────────────────────────
  // Live recordings are capped at 64 kbps (useAudioRecorder.ts) so they stay
  // well under 25 MB. Chunking here handles large uploaded pre-existing files.
  if (file.size > INLINE_LIMIT_BYTES_OPENAI) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
    onProgress(
      'Transcribing',
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — splitting into ${totalChunks} chunks for Whisper...`
    );

    const parts: string[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start     = i * CHUNK_SIZE_BYTES;
      const end       = Math.min(start + CHUNK_SIZE_BYTES, file.size);
      const chunkBlob = file.slice(start, end);
      const label     = `chunk-${i + 1}-of-${totalChunks}.webm`;

      onProgress(
        'Transcribing',
        `Chunk ${i + 1} / ${totalChunks} — ${(chunkBlob.size / 1024 / 1024).toFixed(1)} MB...`
      );

      const approxDuration = file.size / (64_000 / 8); // estimate at 64 kbps
      const offsetSeconds  = Math.round((start / file.size) * approxDuration);

      try {
        const data = await transcribeBlob(chunkBlob, mimeType, label, apiKey, promptHint);
        parts.push(formatSegments(data, offsetSeconds, names));
      } catch (err: any) {
        const { message } = classifyOpenAIError(err);
        throw new Error(`Chunk ${i + 1}/${totalChunks} failed: ${message}`);
      }
    }

    return parts.filter(Boolean).join('\n');
  }

  // ── Single-shot transcription ─────────────────────────────────────────────
  onProgress('Transcribing', `Sending to Whisper (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

  const data = await transcribeBlob(file, mimeType, file.name, apiKey, promptHint).catch(err => {
    const { message } = classifyOpenAIError(err);
    throw new Error(message);
  });

  return formatSegments(data, 0, names);
}
