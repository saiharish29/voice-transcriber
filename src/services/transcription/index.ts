/**
 * transcription/index.ts — LLM-agnostic transcription interface.
 *
 * Adding a new provider (e.g. AssemblyAI):
 *   1. Create src/services/transcription/assemblyai.ts
 *   2. Add 'assemblyai' to the Provider type in src/types.ts
 *   3. Add cases in transcribe(), validateApiKey(), fetchModels(), getDefaultModel()
 *   4. Add a ProviderMeta entry in PROVIDERS
 *   That's it — the rest of the app is untouched.
 */

import { transcribeWithGemini, validateGeminiKey,  fetchGeminiModels,  DEFAULT_GEMINI_MODEL } from './gemini';
import { transcribeWithOpenAI, validateOpenAIKey,  fetchOpenAIModels,  DEFAULT_OPENAI_MODEL } from './openai';
import { transcribeWithGroq,   validateGroqKey,    fetchGroqModels,    DEFAULT_GROQ_MODEL   } from './groq';
import type { Provider, MeetingContext } from '@/types';

// ── File constraints ──────────────────────────────────────────────────────────

/** Supported audio/video MIME types */
export const ACCEPTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];

/** Displayed file extensions in the upload drop-zone */
export const ACCEPTED_EXTENSIONS = '.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac,.mp4,.mov,.avi';

/** Hard limit enforced client-side before even attempting an upload (500 MB) */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

// ── Provider metadata (used by ApiKeySetup / SettingsPanel UI) ────────────────

export interface ProviderMeta {
  id:                    Provider;
  name:                  string;
  tagline:               string;
  /** Placeholder text for the API key input */
  keyHint:               string;
  /** URL where the user can obtain a key */
  keyLink:               string;
  keyLinkLabel:          string;
  /**
   * 'full'       — model can identify speakers by name (Gemini, GPT-4o audio)
   * 'names-hint' — names are passed as a hint but no Speaker X: labels (Whisper)
   */
  speakerIdentification: 'full' | 'names-hint';
  maxFileMB:             number;
  hasFreeTeir:           boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id:                    'gemini',
    name:                  'Google Gemini',
    tagline:               'Best for meetings — 2 GB files, full speaker identification',
    keyHint:               'AIza...',
    keyLink:               'https://aistudio.google.com/apikey',
    keyLinkLabel:          'aistudio.google.com/apikey',
    speakerIdentification: 'full',
    maxFileMB:             2048,
    hasFreeTeir:           true,
  },
  {
    id:                    'openai',
    name:                  'OpenAI',
    tagline:               'GPT-4o Audio for full speaker ID — or Whisper for speed',
    keyHint:               'sk-...',
    keyLink:               'https://platform.openai.com/api-keys',
    keyLinkLabel:          'platform.openai.com/api-keys',
    speakerIdentification: 'full',
    maxFileMB:             25,
    hasFreeTeir:           false,
  },
  {
    id:                    'groq',
    name:                  'Groq',
    tagline:               'Blazing-fast Whisper — generous free tier, ideal for quick transcripts',
    keyHint:               'gsk_...',
    keyLink:               'https://console.groq.com/keys',
    keyLinkLabel:          'console.groq.com/keys',
    speakerIdentification: 'names-hint',
    maxFileMB:             25,
    hasFreeTeir:           true,
  },
];

// ── TranscriptionConfig ───────────────────────────────────────────────────────

export interface TranscriptionConfig {
  provider: Provider;
  apiKey:   string;
  model:    string;
}

// ── Provider-agnostic helpers (used by ApiKeySetup / SettingsPanel) ───────────

export async function validateApiKey(
  provider: Provider,
  apiKey: string,
): Promise<{ valid: boolean; error?: string }> {
  switch (provider) {
    case 'gemini': return validateGeminiKey(apiKey);
    case 'openai': return validateOpenAIKey(apiKey);
    case 'groq':   return validateGroqKey(apiKey);
  }
}

export async function fetchModels(provider: Provider, apiKey: string) {
  switch (provider) {
    case 'gemini': return fetchGeminiModels(apiKey);
    case 'openai': return fetchOpenAIModels(apiKey);
    case 'groq':   return fetchGroqModels(apiKey);
  }
}

export function getDefaultModel(provider: Provider): string {
  switch (provider) {
    case 'gemini': return DEFAULT_GEMINI_MODEL;
    case 'openai': return DEFAULT_OPENAI_MODEL;
    case 'groq':   return DEFAULT_GROQ_MODEL;
  }
}

// ── Core transcription ────────────────────────────────────────────────────────

/**
 * Transcribe an audio/video file using the configured provider.
 * The API key is used only for the provider call — never stored or forwarded.
 */
export async function transcribe(
  file: File,
  config: TranscriptionConfig,
  onProgress: (stage: string, detail?: string) => void,
  context?: MeetingContext,
): Promise<string> {
  switch (config.provider) {
    case 'gemini':
      return transcribeWithGemini(file, config.apiKey, config.model, onProgress, context);
    case 'openai':
      return transcribeWithOpenAI(file, config.apiKey, config.model, onProgress, context);
    case 'groq':
      return transcribeWithGroq(file, config.apiKey, config.model, onProgress, context);
    default: {
      const _: never = config.provider;
      throw new Error(`Unknown transcription provider: ${_}`);
    }
  }
}

export type { MeetingContext };
