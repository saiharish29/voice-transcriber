// ── Provider / Config ─────────────────────────────────────────────────────────

/** Supported transcription providers.  Add new entries here as we expand. */
export type Provider = 'gemini' | 'openai' | 'groq';

/** Stored in localStorage under STORAGE_KEY. Never sent to our own server. */
export interface StoredConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

// ── Meeting context (participant names for speaker identification) ─────────────

/**
 * Optional meeting metadata provided by the user before transcription.
 * Passed to the LLM so it can match voices to real names instead of
 * labelling everyone "Speaker A / Speaker B".
 */
export interface MeetingContext {
  /** The person recording / hosting — their mic is the primary channel */
  hostName: string;
  /** Names of other participants in the call */
  participants: string[];
  /** Optional — gives the LLM extra context for disambiguation */
  meetingTitle?: string;
}

// ── App state ─────────────────────────────────────────────────────────────────

export type AppStatus = 'idle' | 'processing' | 'success' | 'error';

export interface AppState {
  status: AppStatus;
  transcript?: string;
  error?: string;
  /** File name shown in the result header */
  fileName?: string;
}

// ── Audio recording ───────────────────────────────────────────────────────────

export type RecordingState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopped';

export interface ChannelInfo {
  hasMic: boolean;
  hasSystem: boolean;
  micLabel: string;
  systemLabel: string;
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  displayName: string;
  description: string;
  isRecommended: boolean;
  inputTokenLimit: number | null;
}
