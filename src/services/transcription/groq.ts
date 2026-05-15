/**
 * groq.ts — Groq transcription provider.
 *
 * Groq runs Whisper inference at very high speeds via an OpenAI-compatible API.
 * The free tier is generous (~2 hours of audio per day at time of writing).
 *
 * Limitations vs Gemini / GPT-4o:
 * - Max file size: 25 MB (same as OpenAI Whisper)
 * - No speaker diarization — returns a plain timestamped transcript
 * - Participant names are passed as a `prompt` hint so Whisper transcribes
 *   them correctly, but the output will not have Speaker X: labels
 *
 * Best for: quick transcripts, English meetings, users who want a free tier
 *
 * Get a free API key at: console.groq.com/keys
 *
 * ── FIXES IN THIS VERSION ────────────────────────────────────────────────────
 * FIX 1 — normalizeMimeType() strips codec parameters
 *   FormData sends file.type as-is. Groq's API rejects "audio/webm;codecs=opus"
 *   so we re-wrap the Blob with the clean MIME type before uploading.
 *
 * FIX 2 — Promise.race() fetch timeout (5 minutes)
 *   Without a timeout a stalled connection hangs the UI indefinitely.
 *
 * FIX 3 — Chunked transcription for uploaded files > 25 MB
 *   Large files are split into ≤ 23 MB blobs, each transcribed separately,
 *   then concatenated. Live recordings stay well under 25 MB because
 *   useAudioRecorder.ts caps the bitrate at 64 kbps.
 */

import type { MeetingContext, AudioTracks } from '@/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL               = 'https://api.groq.com/openai';
export const INLINE_LIMIT_BYTES_GROQ = 25 * 1024 * 1024; // 25 MB Groq hard limit
/** Each chunk sent to Groq must be comfortably under the 25 MB limit. */
const CHUNK_SIZE_BYTES       = 23 * 1024 * 1024;          // 23 MB per chunk
/** Timeout per Groq request. */
const REQUEST_TIMEOUT_MS     = 5 * 60 * 1_000;            // 5 minutes

export const GROQ_AUDIO_MODELS = [
  {
    id:              'whisper-large-v3',
    displayName:     'Whisper Large v3',
    description:     'Best accuracy — recommended for most meetings',
    isRecommended:   true,
    inputTokenLimit: null,
  },
  {
    id:              'whisper-large-v3-turbo',
    displayName:     'Whisper Large v3 Turbo',
    description:     'Faster, slightly less accurate',
    isRecommended:   false,
    inputTokenLimit: null,
  },
  {
    id:              'distil-whisper-large-v3-en',
    displayName:     'Distil-Whisper Large v3 (English only)',
    description:     'Fastest — English-only meetings',
    isRecommended:   false,
    inputTokenLimit: null,
  },
];

export const DEFAULT_GROQ_MODEL = 'whisper-large-v3';

// ── MIME type normalisation ───────────────────────────────────────────────────

/**
 * Strip codec / parameter suffixes that Groq's API does not accept.
 * "audio/webm;codecs=opus"  →  "audio/webm"
 */
function normalizeMimeType(type: string): string {
  const base = (type || 'audio/webm').split(';')[0].trim();
  return base || 'audio/webm';
}

/** Rejects after `ms` milliseconds with a clear timeout error. */
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
  if (lower.includes('timed out')) {
    return { message: raw, retryable: true };
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

// ── Timestamp merge helper ────────────────────────────────────────────────────

/**
 * Interleave two sets of [HH:MM:SS]-prefixed transcript lines by timestamp.
 * Used when we have separate mic and system transcripts that need to be
 * combined into a single chronological transcript.
 */
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

// ── Single-blob transcription helper ─────────────────────────────────────────

async function transcribeBlob(
  blob: Blob,
  mimeType: string,
  filename: string,
  apiKey: string,
  model: string,
  promptHint: string,
): Promise<any> {
  // FIX 1: Re-wrap with clean MIME type so Content-Type is "audio/webm" not
  // "audio/webm;codecs=opus" which Groq rejects.
  const cleanBlob = new Blob([blob], { type: mimeType });

  const form = new FormData();
  form.append('file', cleanBlob, filename);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  if (promptHint) form.append('prompt', promptHint);

  // FIX 2: Hard timeout so a stalled upload/response doesn't hang the UI.
  const res = await Promise.race([
    fetch(`${BASE_URL}/v1/audio/transcriptions`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    }),
    timeoutAfter(REQUEST_TIMEOUT_MS, 'Groq transcription request'),
  ]);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(
      new Error(data?.error?.message || `Groq error ${res.status}`),
      { status: res.status }
    );
  }

  return res.json();
}

// ── Segment formatter ─────────────────────────────────────────────────────────

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

// ── Core transcription ────────────────────────────────────────────────────────

export async function transcribeWithGroq(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
  tracks?: AudioTracks,
): Promise<string> {
  const mimeType = normalizeMimeType(file.type);
  const hostName = context?.hostName?.trim() || 'Host';

  // Build names prompt hint (vocabulary priming for Whisper)
  const names = [
    context?.hostName ?? '',
    ...(context?.participants ?? []),
  ].filter(Boolean);

  const promptHint = names.length > 0
    ? (context?.meetingTitle
        ? `${context.meetingTitle}: ${names.join(', ')}`
        : names.join(', '))
    : '';

  // ── Dual-track path: transcribe mic and system separately, then merge ─────
  // Whisper can't identify speakers by voice, but we CAN guarantee the host
  // label by transcribing the mic track alone (every word = host).
  if (tracks?.micFile) {
    const micMime = normalizeMimeType(tracks.micFile.type);
    const sysMime = tracks.systemFile ? normalizeMimeType(tracks.systemFile.type) : mimeType;

    onProgress('Transcribing', 'Transcribing host microphone track...');
    const micData = await transcribeBlob(
      tracks.micFile, micMime, tracks.micFile.name, apiKey, model, promptHint
    ).catch(err => { throw new Error(classifyGroqError(err).message); });

    const micLines = formatSegments(micData, 0, []).split('\n').filter(Boolean)
      .map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s*/, `[$1] ${hostName}: `));

    if (!tracks.systemFile) {
      // Mic-only: all lines are the host
      return micLines.join('\n');
    }

    onProgress('Transcribing', 'Transcribing participant audio track...');
    const sysData = await transcribeBlob(
      tracks.systemFile, sysMime, tracks.systemFile.name, apiKey, model, promptHint
    ).catch(err => { throw new Error(classifyGroqError(err).message); });

    const sysLines = formatSegments(sysData, 0, names).split('\n').filter(Boolean)
      .map(line => line.replace(/^\[(\d{2}:\d{2}:\d{2})\]\s*/, '$&Participant: '));

    // Merge both sets of timestamped lines in chronological order
    return mergeTimestampedLines([...micLines, ...sysLines]);
  }

  // ── FIX 3: Chunked transcription for large uploaded files ─────────────────
  // Live recordings are capped at 64 kbps (see useAudioRecorder.ts) so a 10-min
  // session is ~4.8 MB — well under the 25 MB limit. Chunking here is a safety
  // net for uploaded pre-existing files that exceed the limit.
  if (file.size > INLINE_LIMIT_BYTES_GROQ) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
    onProgress(
      'Transcribing',
      `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — splitting into ${totalChunks} chunks...`
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

      // Approximate timestamp offset based on byte position within the file
      const approxDuration = file.size / (64_000 / 8); // estimate at 64 kbps
      const offsetSeconds  = Math.round((start / file.size) * approxDuration);

      try {
        const data = await transcribeBlob(chunkBlob, mimeType, label, apiKey, model, promptHint);
        parts.push(formatSegments(data, offsetSeconds, names));
      } catch (err: any) {
        const { message } = classifyGroqError(err);
        throw new Error(`Chunk ${i + 1}/${totalChunks} failed: ${message}`);
      }
    }

    return parts.filter(Boolean).join('\n');
  }

  // ── Single-shot transcription (file ≤ 25 MB) ─────────────────────────────
  onProgress('Transcribing', `Sending to Groq Whisper (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);

  const data = await transcribeBlob(file, mimeType, file.name, apiKey, model, promptHint).catch(err => {
    const { message } = classifyGroqError(err);
    throw new Error(message);
  });

  return formatSegments(data, 0, names);
}
