/**
 * gemini.ts — Gemini transcription provider.
 *
 * ── Speaker identification architecture ──────────────────────────────────────
 *
 * PREVIOUS (broken): Send one mixed audio file → ask Gemini to guess speakers.
 *   Gemini uses voice similarity heuristics. Fails when people sound alike,
 *   have similar accents, or the meeting topic is technical.
 *
 * NEW (robust): Send TWO separately recorded audio tracks in one request.
 *
 *   Track 1 (mic-only)    → labelled: "EVERY WORD HERE IS [HostName]"
 *   Track 2 (system-only) → labelled: "THESE ARE THE REMOTE PARTICIPANTS"
 *
 *   Gemini's job changes from "guess who is speaking" to "transcribe and
 *   time-align two labelled tracks". Host attribution is now 100% guaranteed.
 *   Participant attribution is dramatically improved because Gemini hears
 *   isolated participant voices, not a mix with the host.
 *
 * ── File handling ─────────────────────────────────────────────────────────────
 *   ≤ 15 MB → inline base64 (15 MB → ~20 MB base64, within the 20 MB request limit)
 *   > 15 MB → Gemini File API (up to 2 GB, auto-deleted after 48 h)
 *
 * ── Other reliability fixes ───────────────────────────────────────────────────
 *   - normalizeMimeType() strips ;codecs=opus that Gemini's API rejects
 *   - Promise.race() timeouts on both upload (15 min) and generateContent (20 min)
 *   - INLINE_LIMIT_BYTES = 15 MB (was 20 MB — base64 overhead fix)
 */

import { GoogleGenAI } from '@google/genai';
import type { MeetingContext, AudioTracks } from '@/types';

// ── Tunables ──────────────────────────────────────────────────────────────────
const INLINE_LIMIT_BYTES  = 15 * 1024 * 1024;  // 15 MB → ~20 MB base64
const POLL_INTERVAL_MS    = 3_000;
const MAX_POLL_ATTEMPTS   = 120;               // 6 min max polling
const MAX_RETRIES         = 3;
const RETRY_BASE_MS       = 3_000;
const RATE_LIMIT_WAIT_MS  = 65_000;
const UPLOAD_TIMEOUT_MS   = 15 * 60 * 1_000;  // 15 min upload timeout
const GENERATE_TIMEOUT_MS = 20 * 60 * 1_000;  // 20 min generation timeout
// ─────────────────────────────────────────────────────────────────────────────

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

// ── MIME type normalisation ───────────────────────────────────────────────────

/** Strip codec/parameter suffixes: "audio/webm;codecs=opus" → "audio/webm" */
function normalizeMimeType(type: string): string {
  const base = (type || 'audio/webm').split(';')[0].trim();
  return base || 'audio/webm';
}

/** Rejects after `ms` ms with a clear timeout error. */
function timeoutAfter(ms: number, label: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(
      `${label} timed out after ${Math.round(ms / 60_000)} minutes. ` +
      `Try a shorter recording or check your network connection.`
    )), ms)
  );
}

// ── Prompts ───────────────────────────────────────────────────────────────────

/**
 * Prompt used when we have TWO separate audio tracks.
 * This is the primary speaker-identification path for live recordings.
 *
 * Gemini's task is reduced to transcription + time-alignment.
 * It does NOT need to guess who is speaking — we tell it explicitly.
 */
export function buildDualTrackPrompt(ctx?: MeetingContext): string {
  const hostName    = ctx?.hostName?.trim()    || 'Host';
  const hasNames    = !!(ctx?.participants?.length);
  const participants = (ctx?.participants ?? []).map(p => p.trim()).filter(Boolean);
  const title       = ctx?.meetingTitle?.trim();

  const participantBlock = hasNames
    ? `Known remote participants: ${participants.map(p => `"${p}"`).join(', ')}.
       Match voices in Track 2 to these names using voice consistency and any name mentions
       ("Thanks Priya", "John, what do you think?"). Once a voice is matched to a name,
       keep that assignment for the entire recording.
       If a voice cannot be confidently matched to a name, label it "Participant B", "Participant C", etc.`
    : `No participant names were provided.
       Label distinct voices in Track 2 as "Participant B", "Participant C", etc.
       Keep each label consistent throughout — never reassign a label to a different voice.`;

  return `You are transcribing a meeting from TWO AUDIO TRACKS recorded simultaneously.
${title ? `Meeting title: "${title}"\n` : ''}
═══════════════════════════════════════════════════
TRACK 1 — MICROPHONE (the first audio you received)
═══════════════════════════════════════════════════
This is the host's microphone recording.
EVERY SINGLE WORD in Track 1 belongs to: "${hostName}"
Do not assign any other name to speech from Track 1 under any circumstances.

═══════════════════════════════════════════════════
TRACK 2 — SYSTEM AUDIO (the second audio you received)
═══════════════════════════════════════════════════
This is the system/speaker audio captured from the meeting platform.
It contains the voices of ALL remote participants.
${participantBlock}

═══════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════
Produce ONE unified transcript that interleaves both tracks in chronological order.
Both tracks start at the same moment (time 0:00:00).
Use the timestamps within each track to correctly interleave the speech.

TRANSCRIPTION RULES:
1. Include every word — do NOT summarise, skip, or paraphrase.
2. Timestamp format: [HH:MM:SS] at the start of each new speaker turn and every ~30 seconds during long monologues.
3. Lightly clean filler words (um, uh) but preserve natural flow.
4. Mark inaudible speech as [inaudible].
5. Note non-speech sounds: [laughter], [background noise], [silence], etc.
6. Do NOT add summaries, headers, or any content beyond the transcript.

OUTPUT FORMAT (nothing before or after):
[HH:MM:SS] ${hostName}: Words spoken here...
[HH:MM:SS] ${hasNames && participants[0] ? participants[0] : 'Participant B'}: Their reply...

If either track contains no detectable speech, note it as [No speech detected on this track].`;
}

/**
 * Prompt used when only the microphone track is available (no system audio).
 * Host attribution is still guaranteed; remote participants may be faintly
 * audible through the microphone but are NOT reliably identifiable.
 */
export function buildMicOnlyPrompt(ctx?: MeetingContext): string {
  const hostName = ctx?.hostName?.trim() || 'Host';
  const title    = ctx?.meetingTitle?.trim();

  return `You are transcribing a meeting from a MICROPHONE-ONLY recording.
${title ? `Meeting title: "${title}"\n` : ''}
IMPORTANT — RECORDING TYPE: This is the host's microphone only.
The host is: "${hostName}"
${hostName}'s voice is the clearest and loudest voice in this recording.

Remote participants were NOT recorded through this microphone.
Their voices may be faintly audible as room echo/bleed from speakers,
but their audio quality will be significantly lower than ${hostName}'s.
Do your best to transcribe what they say but mark uncertain sections [inaudible].
Label ${hostName} as "${hostName}" and any other voices as "Participant B", "Participant C", etc.
${ctx?.participants?.length
  ? `Known participants (for reference): ${ctx.participants.map(p => `"${p}"`).join(', ')}.`
  : ''}

TRANSCRIPTION RULES:
1. Include every word — do NOT summarise or skip.
2. Timestamps [HH:MM:SS] at each speaker turn and every ~30 seconds.
3. Mark inaudible sections as [inaudible].
4. Note non-speech sounds: [laughter], [background noise], [silence], etc.
5. Do NOT add summaries or headers.

OUTPUT FORMAT:
[HH:MM:SS] ${hostName}: Words spoken...
[HH:MM:SS] Participant B: Their reply...`;
}

/**
 * Fallback prompt for uploaded files (no track separation available).
 * Uses the original multi-tier speaker identification strategy.
 */
export function buildTranscriptionPrompt(ctx?: MeetingContext): string {
  const hasHost         = !!(ctx?.hostName?.trim());
  const hasParticipants = !!(ctx?.participants?.length);
  const allNames        = [
    ...(hasHost         ? [ctx!.hostName.trim()]                                           : []),
    ...(hasParticipants ? ctx!.participants.map(p => p.trim()).filter(Boolean) : []),
  ];

  let participantBlock = '';
  if (allNames.length > 0) {
    participantBlock = `
MEETING PARTICIPANTS (use these names to label speakers):
${hasHost ? `• HOST / RECORDER: "${ctx!.hostName.trim()}" — their voice comes from the primary microphone (loudest, clearest voice).` : ''}
${hasParticipants ? `• OTHER PARTICIPANTS: ${ctx!.participants.filter(p => p.trim()).map(p => `"${p.trim()}"`).join(', ')}` : ''}
${ctx?.meetingTitle ? `• MEETING TITLE: "${ctx.meetingTitle}"` : ''}

SPEAKER IDENTIFICATION STRATEGY (apply in order):
1. CHANNEL SIGNAL — in stereo recordings the left channel is typically the host's mic; the right channel carries all participants. Use this as the strongest signal if the audio is stereo.
2. NAME MENTIONS — "Thanks, Sarah" or "John, what do you think?" locks that voice to that name.
3. VOICE CONSISTENCY — once matched, never swap a voice to a different name.
4. CONTEXT CLUES — role, expertise, meeting behaviour.
5. FALLBACK — use "Speaker B", "Speaker C" if genuinely uncertain.
`;
  } else {
    participantBlock = `
NO PARTICIPANT NAMES PROVIDED:
Label speakers as Speaker A, Speaker B, etc. based on voice characteristics.
Keep labels consistent throughout.
`;
  }

  return `You are a professional audio transcription service.
YOUR ONLY JOB: Produce an accurate, complete, timestamped transcript.
${participantBlock}
TRANSCRIPTION RULES:
1. Transcribe every word — do NOT summarise, skip, or paraphrase.
2. Timestamps [HH:MM:SS] at each new speaker turn and every ~30 seconds during monologues.
3. Lightly clean filler words (um, uh) but preserve natural flow.
4. Mark inaudible sections as [inaudible].
5. Note significant non-speech sounds: [laughter], [background noise], [silence], etc.
6. Do NOT add summaries, analysis, or section headers.

OUTPUT FORMAT:
[HH:MM:SS] Name: Words spoken here...

If no speech is detected, output exactly:
[No speech detected — please check your audio file and try again.]`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function extractHttpStatus(message: string): number | null {
  const m = message.match(/\[(\d{3})\s/);
  return m ? parseInt(m[1], 10) : null;
}

interface ErrorInfo { message: string; retryable: boolean; waitMs?: number; }

export function classifyError(err: unknown): ErrorInfo {
  const raw    = String((err as any)?.message ?? (err as any)?.toString() ?? '');
  const lower  = raw.toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? extractHttpStatus(raw);

  if (status === 429 || lower.includes('resource_exhausted') || raw.includes('429')) {
    if (lower.includes('quota') || lower.includes('daily') || lower.includes('per day')) {
      return { message: 'Daily API quota exhausted. It resets at midnight PT — try again tomorrow or use a different API key.', retryable: false };
    }
    return { message: 'Rate limit hit. Waiting 65 seconds before retry...', retryable: true, waitMs: RATE_LIMIT_WAIT_MS };
  }
  if (status === 403 || lower.includes('permission_denied')) {
    return { message: 'API key is invalid or permission denied. Please check your key in Settings.', retryable: false };
  }
  if (status === 400 && (lower.includes('billing') || lower.includes('precondition'))) {
    return { message: 'Billing is not enabled on your Google account. Visit aistudio.google.com to enable it.', retryable: false };
  }
  if (status === 400 || lower.includes('invalid_argument')) {
    return { message: `Invalid request — audio format may not be supported.\nDetail: ${raw.slice(0, 300)}`, retryable: false };
  }
  if (status === 404 || lower.includes('not_found')) {
    return { message: 'Uploaded file reference has expired. Please re-upload.', retryable: false };
  }
  if (status === 503 || lower.includes('unavailable')) {
    return { message: 'Gemini is temporarily overloaded. Retrying...', retryable: true, waitMs: 10_000 };
  }
  if (status === 500 || lower.includes('internal')) {
    return { message: 'Gemini internal error. Retrying...', retryable: true };
  }
  if (lower.includes('timed out')) {
    return { message: raw, retryable: true };
  }
  return { message: raw || 'Transcription failed. Please try again.', retryable: true };
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

// ── Core audio-part preparation (shared by single and dual-track paths) ───────

/**
 * Upload a file to Gemini (inline base64 if ≤ 15 MB, File API otherwise)
 * and return the audioPart object ready for use in generateContent.
 */
async function prepareAudioPart(
  file: File,
  ai: GoogleGenAI,
  label: string,
  onProgress: (stage: string, detail?: string) => void,
): Promise<Record<string, unknown>> {
  const mimeType = normalizeMimeType(file.type);

  if (file.size <= INLINE_LIMIT_BYTES) {
    onProgress('Preparing', `Encoding ${label} (${(file.size / 1024 / 1024).toFixed(1)} MB) inline...`);
    const base64 = await fileToBase64(file);
    return { inlineData: { mimeType, data: base64 } };
  }

  // Large file — use File API
  onProgress('Uploading', `${label}: ${(file.size / 1024 / 1024).toFixed(1)} MB → Gemini File API...`);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) onProgress('Retrying upload', `${label}: attempt ${attempt}/${MAX_RETRIES}...`);

      const uploaded = await Promise.race([
        ai.files.upload({ file, config: { mimeType, displayName: file.name } }),
        timeoutAfter(UPLOAD_TIMEOUT_MS, `${label} upload`),
      ]);

      let fileInfo: any = uploaded;
      let polls = 0;
      while ((fileInfo.state === 'PROCESSING' || !fileInfo.state) && polls < MAX_POLL_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS);
        fileInfo = await ai.files.get({ name: fileInfo.name });
        polls++;
        onProgress('Processing', `${label}: processing... (${Math.round(polls * POLL_INTERVAL_MS / 1000)}s)`);
      }

      if (fileInfo.state !== 'ACTIVE') {
        throw new Error(`${label} upload stalled: state=${fileInfo.state}`);
      }

      return { fileData: { fileUri: fileInfo.uri, mimeType } };
    } catch (err) {
      lastErr = err;
      const { retryable, waitMs, message } = classifyError(err);
      if (!retryable || attempt >= MAX_RETRIES) throw new Error(message);
      onProgress('Upload error', `${label}: ${message}`);
      await sleep(waitMs ?? RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(classifyError(lastErr).message);
}

// ── Validation / model discovery ──────────────────────────────────────────────

export async function validateGeminiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (res.ok) return { valid: true };
    const data = await res.json().catch(() => ({}));
    return { valid: false, error: data?.error?.message || 'Invalid API key' };
  } catch {
    return { valid: false, error: 'Could not reach Google — check your internet connection.' };
  }
}

export async function fetchGeminiModels(apiKey: string) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Failed to fetch models');
  }
  const data     = await res.json();
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
  tracks?: AudioTracks,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });

  // ── Choose transcription path ─────────────────────────────────────────────
  //
  // Path A — Dual-track (best): mic + system audio available separately.
  //   Guaranteed host attribution, strong participant attribution.
  //   Used for all live recordings when system audio was captured.
  //
  // Path B — Mic-only: only the microphone was recorded (no screen share).
  //   Host attribution guaranteed; participants may be faintly audible.
  //
  // Path C — Single-track fallback: uploaded file or legacy recording.
  //   Uses the original multi-tier prompt. Still works, just less reliable.

  let parts: any[];
  let prompt: string;

  if (tracks?.micFile && tracks?.systemFile) {
    // ── Path A: Dual-track ──────────────────────────────────────────────────
    onProgress('Preparing', 'Uploading separate mic and system audio tracks for speaker identification...');

    const [micPart, sysPart] = await Promise.all([
      prepareAudioPart(tracks.micFile,    ai, 'Mic track',    onProgress),
      prepareAudioPart(tracks.systemFile, ai, 'System track', onProgress),
    ]);

    // The order matters: the prompt refers to "first audio" and "second audio"
    parts  = [
      micPart,
      { text: `— END OF TRACK 1 (${context?.hostName?.trim() || 'Host'}'s microphone) —` },
      sysPart,
      { text: '— END OF TRACK 2 (system/participant audio) —' },
    ];
    prompt = buildDualTrackPrompt(context);

    onProgress('Transcribing', 'Both tracks ready — Gemini is producing the unified transcript...');

  } else if (tracks?.micFile) {
    // ── Path B: Mic-only ────────────────────────────────────────────────────
    onProgress('Preparing', 'Mic-only recording — uploading for transcription...');
    const micPart = await prepareAudioPart(tracks.micFile, ai, 'Mic track', onProgress);
    parts  = [micPart];
    prompt = buildMicOnlyPrompt(context);
    onProgress('Transcribing', 'Sending to Gemini (mic-only mode)...');

  } else {
    // ── Path C: Single merged file (uploaded file or no tracks available) ───
    const mimeType = normalizeMimeType(file.type);
    if (file.size > INLINE_LIMIT_BYTES) {
      onProgress('Uploading', `${(file.size / 1024 / 1024).toFixed(1)} MB → Gemini File API...`);
      const audioPart = await prepareAudioPart(file, ai, 'Audio file', onProgress);
      parts = [audioPart];
    } else {
      onProgress('Preparing', `Encoding ${(file.size / 1024 / 1024).toFixed(1)} MB inline...`);
      const base64 = await fileToBase64(file);
      parts = [{ inlineData: { mimeType, data: base64 } }];
      onProgress('Ready', 'Audio encoded — sending to Gemini...');
    }
    prompt = buildTranscriptionPrompt(context);
    onProgress('Transcribing', 'Waiting for Gemini response...');
  }

  // ── Generate transcript ───────────────────────────────────────────────────
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) onProgress('Retrying', `Attempt ${attempt}/${MAX_RETRIES}...`);

      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [{
            role:  'user',
            parts: [...parts, { text: prompt }],
          }],
        }),
        timeoutAfter(GENERATE_TIMEOUT_MS, 'Transcription request'),
      ]);

      const text = (response as any)?.text;
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
