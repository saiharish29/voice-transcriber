/**
 * gemini.ts — Gemini transcription provider.
 *
 * The API key comes from the caller (loaded from localStorage in the browser).
 * It is passed directly to Google's API via the @google/genai SDK.
 * This module is stateless — it never stores, logs, or forwards the key.
 *
 * File handling strategy:
 *   ≤ 20 MB  →  inline base64 in the generateContent request (fast, simple)
 *   > 20 MB  →  Gemini File API upload → poll until ACTIVE → reference by URI
 *              (File API supports up to 2 GB per file, files auto-delete in 48 h)
 */

import { GoogleGenAI } from '@google/genai';
import type { MeetingContext } from '@/types';

// ── Tunables ──────────────────────────────────────────────────────────────────
const INLINE_LIMIT_BYTES  = 20 * 1024 * 1024; // 20 MB
const POLL_INTERVAL_MS    = 3_000;
const MAX_POLL_ATTEMPTS   = 120;               // 120 × 3 s = 6 min max
const MAX_RETRIES         = 3;
const RETRY_BASE_MS       = 3_000;
const RATE_LIMIT_WAIT_MS  = 65_000;
// ─────────────────────────────────────────────────────────────────────────────

/** Known Gemini models that support audio input */
export const AUDIO_CAPABLE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

// ── Transcription prompt ──────────────────────────────────────────────────────

/**
 * Builds the transcription prompt.
 *
 * Speaker identification quality ranking (best → worst):
 *   1. Host name + participant list provided  → Gemini matches voices to real names
 *   2. Host name only                         → Host is labelled, others are Speaker B/C...
 *   3. No names provided                      → Everyone is Speaker A/B/C...
 *
 * Gemini uses three signals to assign names:
 *   a) Explicit mentions ("Thanks, Sarah" / "I agree, John")
 *   b) Audio channel: if stereo, left channel = recorder's mic = host
 *   c) Voice consistency: once a voice is matched to a name, it stays matched
 */
export function buildTranscriptionPrompt(ctx?: MeetingContext): string {
  const hasHost         = !!(ctx?.hostName?.trim());
  const hasParticipants = !!(ctx?.participants?.length);
  const allNames        = [
    ...(hasHost         ? [ctx!.hostName.trim()]                         : []),
    ...(hasParticipants ? ctx!.participants.map(p => p.trim()).filter(Boolean) : []),
  ];

  // ── Participant context block ──────────────────────────────────────────────
  let participantBlock = '';
  if (allNames.length > 0) {
    participantBlock = `
MEETING PARTICIPANTS (use these names to label speakers):
${hasHost ? `• HOST / RECORDER: "${ctx!.hostName.trim()}" — this person's voice comes from the primary microphone (left audio channel in stereo recordings). Every voice on that channel belongs to them.` : ''}
${hasParticipants ? `• OTHER PARTICIPANTS: ${ctx!.participants.filter(p => p.trim()).map(p => `"${p.trim()}"`).join(', ')} — their voices come through the system/speaker audio (right channel or mixed channel).` : ''}
${ctx?.meetingTitle ? `• MEETING TITLE: "${ctx.meetingTitle}"` : ''}

SPEAKER IDENTIFICATION STRATEGY (apply in this order):
1. CHANNEL SIGNAL — If the recording is stereo: left channel = ${hasHost ? `"${ctx!.hostName.trim()}"` : 'the host'}; right channel = participants. This is the strongest signal — never contradict it.
2. NAME MENTIONS — When someone is addressed by name ("Thanks, Sarah" / "John, what do you think?") assign that name to that voice from that point forward.
3. VOICE CONSISTENCY — Each person has a unique voice (pitch, pace, accent). Once you identify a voice, keep that assignment for the entire transcript. Never swap names mid-recording without a clear reason.
4. CONTEXT CLUES — Role descriptions, technical expertise, meeting behaviour (e.g., who is presenting, who is asking questions).
5. FALLBACK — If you genuinely cannot identify a speaker after all the above, use "Speaker B", "Speaker C", etc. Do not guess randomly.
`;
  } else {
    participantBlock = `
NO PARTICIPANT NAMES PROVIDED:
Label speakers as Speaker A, Speaker B, Speaker C, etc. based on distinct voice characteristics.
Keep assignments consistent throughout — once a voice is Speaker B, it is always Speaker B.
`;
  }

  return `You are a professional audio transcription service.

YOUR ONLY JOB: Produce an accurate, complete, timestamped transcript of the audio.
${participantBlock}
TRANSCRIPTION RULES:
1. Transcribe every word spoken — do NOT summarize, skip, or paraphrase.
2. Add a timestamp in [HH:MM:SS] format at the start of each new speaker turn and every ~30 seconds during long monologues.
3. Lightly clean filler words (um, uh) but preserve natural flow and meaning.
4. Mark inaudible sections as [inaudible].
5. Note significant non-speech sounds inline: [laughter], [applause], [background noise], [silence], [sound of disconnecting], etc.
6. Do NOT add summaries, analysis, section headers, or any content beyond the transcript itself.

OUTPUT FORMAT (follow exactly — nothing before or after):
[HH:MM:SS] Name: Words spoken here...
[HH:MM:SS] Name: Their reply...

EXAMPLE (if host is Harish and participant is Priya):
[00:00:00] Harish: Good morning everyone, let's get started.
[00:00:08] Priya: Morning! Can everyone hear me okay?
[00:00:45] Harish: Yes, all good. So the agenda today is...

If the audio contains no detectable speech, output exactly:
[No speech detected — please check your audio file and try again.]`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function extractHttpStatus(message: string): number | null {
  const m = message.match(/\[(\d{3})\s/);
  return m ? parseInt(m[1], 10) : null;
}

interface ErrorInfo {
  message: string;
  retryable: boolean;
  waitMs?: number;
}

export function classifyError(err: unknown): ErrorInfo {
  const raw   = String((err as any)?.message ?? (err as any)?.toString() ?? '');
  const lower = raw.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? extractHttpStatus(raw);

  if (status === 429 || lower.includes('resource_exhausted') || raw.includes('429')) {
    if (lower.includes('quota') || lower.includes('daily') || lower.includes('per day')) {
      return {
        message:   'Daily API quota exhausted. It resets at midnight PT — try again tomorrow, or use a different API key.',
        retryable: false,
      };
    }
    return {
      message:   'Rate limit hit (too many requests per minute). Waiting 65 seconds before retry...',
      retryable: true,
      waitMs:    RATE_LIMIT_WAIT_MS,
    };
  }

  if (status === 403 || lower.includes('permission_denied') || lower.includes('permission denied')) {
    return {
      message:   'API key is invalid or permission was denied. Please check your key in Settings — it should start with "AI...".',
      retryable: false,
    };
  }

  if (status === 400 && (lower.includes('billing') || lower.includes('precondition'))) {
    return {
      message:   'Billing is not enabled on your Google account. Visit aistudio.google.com to enable it.',
      retryable: false,
    };
  }

  if (status === 400 || lower.includes('invalid_argument')) {
    return {
      message:   `Invalid request — the audio format may not be supported by this model.\nDetail: ${raw.slice(0, 300)}`,
      retryable: false,
    };
  }

  if (status === 404 || lower.includes('not_found')) {
    return {
      message:   'The uploaded file reference has expired (Gemini File API files expire after 48 h). Please re-upload.',
      retryable: false,
    };
  }

  if (status === 503 || lower.includes('unavailable')) {
    return { message: 'Gemini is temporarily overloaded. Retrying...', retryable: true, waitMs: 10_000 };
  }

  if (status === 500 || lower.includes('internal')) {
    return { message: 'Gemini internal error. Retrying...', retryable: true };
  }

  return { message: raw || 'Transcription failed. Please try again.', retryable: true };
}

/** Read a File as a base64 string (strips the data: URI prefix). */
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

// ── Validate API key (browser → Google directly) ──────────────────────────────

export async function validateGeminiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || 'Invalid API key' };
  } catch {
    return { valid: false, error: 'Could not reach Google — check your internet connection.' };
  }
}

// ── Fetch available models (browser → Google directly) ────────────────────────

export async function fetchGeminiModels(apiKey: string) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to fetch models');
  }
  const data = await res.json();
  const audioSet = new Set(AUDIO_CAPABLE_MODELS);

  const capable = (data.models ?? []).filter((m: any) => {
    const name    = (m.name ?? '').toLowerCase();
    const methods = m.supportedGenerationMethods ?? [];
    return name.includes('gemini') && methods.includes('generateContent');
  });

  capable.sort((a: any, b: any) => {
    const aId = a.name.replace('models/', '');
    const bId = b.name.replace('models/', '');
    const ap  = audioSet.has(aId) ? 0 : 1;
    const bp  = audioSet.has(bId) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return aId.localeCompare(bId);
  });

  return capable.map((m: any) => ({
    id:              m.name.replace('models/', ''),
    displayName:     m.displayName || m.name.replace('models/', ''),
    description:     m.description || '',
    inputTokenLimit: m.inputTokenLimit ?? null,
    isRecommended:   audioSet.has(m.name.replace('models/', '')),
  }));
}

// ── Core transcription ────────────────────────────────────────────────────────

export async function transcribeWithGemini(
  file: File,
  apiKey: string,
  model: string,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  // ── Step 1: prepare audio part ────────────────────────────────────────────
  let audioPart: Record<string, unknown>;

  if (file.size > INLINE_LIMIT_BYTES) {
    // Large file → Gemini File API
    onProgress('Uploading', `${(file.size / 1024 / 1024).toFixed(1)} MB — uploading to Gemini File API...`);

    let uploadedRef: Record<string, unknown> | null = null;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 1) onProgress('Retrying upload', `Attempt ${attempt}/${MAX_RETRIES}...`);

        const uploaded = await ai.files.upload({
          file,
          config: { mimeType: file.type || 'audio/webm', displayName: file.name },
        });

        // Poll until ACTIVE
        let fileInfo: any = uploaded;
        let polls = 0;
        while (
          (fileInfo.state === 'PROCESSING' || !fileInfo.state) &&
          polls < MAX_POLL_ATTEMPTS
        ) {
          await sleep(POLL_INTERVAL_MS);
          fileInfo = await ai.files.get({ name: fileInfo.name });
          polls++;
          onProgress(
            'Processing upload',
            `Gemini is processing the file... (${Math.round((polls * POLL_INTERVAL_MS) / 1000)}s)`
          );
        }

        if (fileInfo.state !== 'ACTIVE') {
          throw new Error(`File upload stalled: state=${fileInfo.state} after ${polls} polls`);
        }

        onProgress('Upload complete', `File ready (${fileInfo.uri})`);
        uploadedRef = { fileData: { fileUri: fileInfo.uri, mimeType: fileInfo.mimeType || file.type } };
        break;
      } catch (err) {
        lastErr = err;
        const { retryable, waitMs, message } = classifyError(err);
        if (!retryable || attempt >= MAX_RETRIES) throw new Error(message);
        onProgress('Upload error', message);
        await sleep(waitMs ?? RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }

    if (!uploadedRef) throw new Error(classifyError(lastErr).message);
    audioPart = uploadedRef;
  } else {
    // Small file → inline base64
    onProgress('Preparing', `Encoding ${(file.size / 1024 / 1024).toFixed(1)} MB inline...`);
    const base64 = await fileToBase64(file);
    audioPart    = { inlineData: { mimeType: file.type || 'audio/webm', data: base64 } };
    onProgress('Ready', 'Audio encoded — sending to Gemini...');
  }

  // ── Step 2: transcribe ────────────────────────────────────────────────────
  onProgress('Transcribing', 'Waiting for Gemini response (may take a minute for long recordings)...');

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) onProgress('Retrying', `Attempt ${attempt}/${MAX_RETRIES}...`);

      const response = await ai.models.generateContent({
        model,
        contents: [{
          role:  'user',
          parts: [audioPart as any, { text: buildTranscriptionPrompt(context) }],
        }],
      });

      const text = response?.text;
      if (!text) throw new Error('Gemini returned an empty response. Please try again.');
      return text;
    } catch (err) {
      lastErr = err;
      const { retryable, waitMs, message } = classifyError(err);
      if (!retryable || attempt >= MAX_RETRIES) throw new Error(message);
      onProgress('Retrying', message);
      await sleep(waitMs ?? RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(classifyError(lastErr).message);
}
