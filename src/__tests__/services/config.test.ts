/**
 * Tests for config.ts — localStorage persistence layer.
 *
 * This is critical because the BYOK model depends entirely on localStorage
 * correctly storing and retrieving the API key + model.  If this breaks,
 * the user loses their key on every page reload.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, saveConfig, clearConfig, updateModel } from '@/services/config';

const VALID_CONFIG = { provider: 'gemini' as const, apiKey: 'AIza-test-key', model: 'gemini-2.5-flash' };

describe('loadConfig — empty localStorage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadConfig()).toBeNull();
  });
});

describe('saveConfig + loadConfig roundtrip', () => {
  it('stores and retrieves the full config', () => {
    saveConfig(VALID_CONFIG);
    expect(loadConfig()).toEqual(VALID_CONFIG);
  });

  it('stores provider correctly', () => {
    saveConfig(VALID_CONFIG);
    expect(loadConfig()?.provider).toBe('gemini');
  });

  it('stores apiKey correctly', () => {
    saveConfig(VALID_CONFIG);
    expect(loadConfig()?.apiKey).toBe('AIza-test-key');
  });

  it('stores model correctly', () => {
    saveConfig(VALID_CONFIG);
    expect(loadConfig()?.model).toBe('gemini-2.5-flash');
  });

  it('overwrites an existing config on second save', () => {
    saveConfig(VALID_CONFIG);
    saveConfig({ ...VALID_CONFIG, model: 'gemini-1.5-pro' });
    expect(loadConfig()?.model).toBe('gemini-1.5-pro');
  });
});

describe('clearConfig', () => {
  it('removes the stored config', () => {
    saveConfig(VALID_CONFIG);
    clearConfig();
    expect(loadConfig()).toBeNull();
  });

  it('is safe to call when nothing is stored', () => {
    expect(() => clearConfig()).not.toThrow();
  });
});

describe('updateModel', () => {
  it('changes the model without touching apiKey or provider', () => {
    saveConfig(VALID_CONFIG);
    updateModel('gemini-1.5-pro');
    const c = loadConfig()!;
    expect(c.model).toBe('gemini-1.5-pro');
    expect(c.apiKey).toBe(VALID_CONFIG.apiKey);
    expect(c.provider).toBe(VALID_CONFIG.provider);
  });

  it('does nothing when no config is stored', () => {
    expect(() => updateModel('gemini-1.5-pro')).not.toThrow();
    expect(loadConfig()).toBeNull();
  });
});

describe('loadConfig — corrupted localStorage', () => {
  it('returns null for non-JSON content', () => {
    localStorage.setItem('vt_config', 'not-valid-json{{{{');
    expect(loadConfig()).toBeNull();
  });

  it('returns null when apiKey is missing', () => {
    localStorage.setItem('vt_config', JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-flash' }));
    expect(loadConfig()).toBeNull();
  });

  it('returns null when model is missing', () => {
    localStorage.setItem('vt_config', JSON.stringify({ provider: 'gemini', apiKey: 'AIza-key' }));
    expect(loadConfig()).toBeNull();
  });

  it('returns null when provider is missing', () => {
    localStorage.setItem('vt_config', JSON.stringify({ apiKey: 'AIza-key', model: 'gemini-2.5-flash' }));
    expect(loadConfig()).toBeNull();
  });

  it('returns null for empty object', () => {
    localStorage.setItem('vt_config', JSON.stringify({}));
    expect(loadConfig()).toBeNull();
  });
});
