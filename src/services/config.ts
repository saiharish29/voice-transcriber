/**
 * config.ts — localStorage helpers for the user's BYOK configuration.
 *
 * The API key NEVER leaves the browser.  It is read from localStorage,
 * used directly in client-side calls to the provider's API, and never
 * sent to our own server (we don't even have one in this project).
 */

import type { StoredConfig } from '@/types';

const STORAGE_KEY = 'vt_config';

export function loadConfig(): StoredConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    if (!parsed.apiKey || !parsed.model || !parsed.provider) return null;
    return parsed as StoredConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: StoredConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function updateModel(model: string): void {
  const existing = loadConfig();
  if (!existing) return;
  saveConfig({ ...existing, model });
}
