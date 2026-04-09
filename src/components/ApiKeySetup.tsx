/**
 * ApiKeySetup.tsx — First-run BYOK configuration screen.
 *
 * Flow:  1. Choose provider  →  2. Enter & validate API key  →  3. Pick model
 *
 * Security model:
 *   • Validation calls the provider's API directly from the browser.
 *   • On success the key is persisted to localStorage only.
 *   • The key is never sent anywhere except the chosen provider's own endpoints.
 */

import React, { useState, useEffect } from 'react';
import { PROVIDERS, validateApiKey, fetchModels, getDefaultModel } from '@/services/transcription';
import { saveConfig } from '@/services/config';
import type { ModelInfo, Provider } from '@/types';

interface Props {
  onConfigured: () => void;
}

type Step = 'provider' | 'key' | 'validating' | 'model' | 'done';

// ── Provider card icons ───────────────────────────────────────────────────────

function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"
        fill="currentColor" opacity="0.3" />
      <path d="M12 2L2 12l10 10 10-10L12 2zm0 3.5L19.5 12 12 18.5 4.5 12 12 5.5z" fill="currentColor" />
    </svg>
  );
}

function OpenAIIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      <path d="M22.28 9.98a5.77 5.77 0 00-.5-4.74 5.83 5.83 0 00-6.27-2.8A5.78 5.78 0 0011.35 1a5.83 5.83 0 00-5.56 4.04 5.78 5.78 0 00-3.86 2.8 5.83 5.83 0 00.72 6.83 5.77 5.77 0 00.5 4.73 5.83 5.83 0 006.27 2.8A5.77 5.77 0 0012.65 23a5.83 5.83 0 005.57-4.04 5.77 5.77 0 003.86-2.8 5.83 5.83 0 00-.8-6.18zm-8.66 12.15a4.32 4.32 0 01-2.77-1.01l.14-.08 4.6-2.66a.76.76 0 00.38-.66v-6.5l1.95 1.12a.07.07 0 01.04.05v5.38a4.33 4.33 0 01-4.34 4.36zm-9.33-3.98a4.31 4.31 0 01-.52-2.91l.14.08 4.6 2.66a.75.75 0 00.76 0l5.62-3.24v2.24a.07.07 0 01-.03.06L10.2 19.6a4.33 4.33 0 01-5.91-1.45zm-1.21-10.05a4.32 4.32 0 012.25-1.9v5.47a.75.75 0 00.38.65l5.6 3.23-1.95 1.13a.07.07 0 01-.07 0L5 14.04a4.33 4.33 0 01-.92-5.94zm16.05 3.72l-5.6-3.24 1.94-1.12a.07.07 0 01.07 0l4.37 2.52a4.33 4.33 0 01-.67 7.81v-5.47a.76.76 0 00-.11-.5zm1.94-2.93l-.14-.09-4.59-2.67a.75.75 0 00-.76 0L14.96 9.4V7.16a.07.07 0 01.03-.06l4.35-2.51a4.33 4.33 0 016.44 4.27 4.3 4.3 0 01-.65.98zm-12.28 4L7.83 12l1.95-1.13a.07.07 0 01.07 0L11.8 12l-1.95 1.12a.07.07 0 01-.07 0l-.99-.23z" />
    </svg>
  );
}

function GroqIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16zm-1-13h2v6h-2zm0 8h2v2h-2z" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<Provider, React.ReactElement> = {
  gemini: <GeminiIcon />,
  openai: <OpenAIIcon />,
  groq:   <GroqIcon />,
};

const PROVIDER_COLORS: Record<Provider, string> = {
  gemini: 'text-blue-600  bg-blue-50   border-blue-200',
  openai: 'text-slate-700 bg-slate-50  border-slate-200',
  groq:   'text-orange-600 bg-orange-50 border-orange-200',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ApiKeySetup({ onConfigured }: Props) {
  const [step,       setStep]       = useState<Step>('provider');
  const [provider,   setProvider]   = useState<Provider>('gemini');
  const [apiKey,     setApiKey]     = useState('');
  const [error,      setError]      = useState('');
  const [models,     setModels]     = useState<ModelInfo[]>([]);
  const [selModel,   setSelModel]   = useState('');
  const [loadModels, setLoadModels] = useState(false);
  const [modelErr,   setModelErr]   = useState('');

  const providerMeta = PROVIDERS.find(p => p.id === provider)!;

  // Load models once the key is validated
  useEffect(() => {
    if (step !== 'model') return;
    setLoadModels(true);
    setModelErr('');
    const defaultModel = getDefaultModel(provider);
    fetchModels(provider, apiKey)
      .then(list => {
        setModels(list);
        const preferred = list.find(m => m.id === defaultModel);
        setSelModel(preferred ? preferred.id : (list[0]?.id ?? defaultModel));
      })
      .catch(err => setModelErr(err.message || 'Failed to load models'))
      .finally(() => setLoadModels(false));
  }, [step, provider, apiKey]);

  const handleProviderSelect = (p: Provider) => {
    setProvider(p);
    setApiKey('');
    setError('');
    setStep('key');
  };

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = apiKey.trim();
    if (!key) { setError('Please enter your API key'); return; }
    setError('');
    setStep('validating');
    const { valid, error: valErr } = await validateApiKey(provider, key);
    if (!valid) {
      setError(valErr || 'Invalid API key. Please check and try again.');
      setStep('key');
      return;
    }
    setStep('model');
  };

  const handleFinish = () => {
    saveConfig({ provider, apiKey: apiKey.trim(), model: selModel });
    setStep('done');
    setTimeout(onConfigured, 600);
  };

  // ── Done ────────────────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center w-full max-w-sm">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-700">All set!</h3>
          <p className="text-slate-500 text-sm mt-1">Launching Voice Transcriber...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl mb-4 shadow-lg shadow-brand-200">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Voice Transcriber</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {step === 'provider' && 'Choose your AI provider to get started'}
            {(step === 'key' || step === 'validating') && `Enter your ${providerMeta.name} API key`}
            {step === 'model' && 'Choose your transcription model'}
          </p>
        </div>

        {/* Step indicator */}
        {step !== 'provider' && (
          <div className="flex items-center gap-2 mb-6 px-1">
            {(['key', 'model'] as const).map((s, i) => {
              const done   = (s === 'key' && (step === 'model' || step === 'done'));
              const active = step === s || (step === 'validating' && s === 'key');
              return (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${
                    active ? 'text-brand-600' : done ? 'text-green-600' : 'text-slate-400'
                  }`}>
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      active ? 'bg-brand-600 text-white' : done ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {done ? '✓' : i + 1}
                    </div>
                    {s === 'key' ? 'API Key' : 'Model'}
                  </div>
                  {i < 1 && <div className="flex-1 h-px bg-slate-200" />}
                </React.Fragment>
              );
            })}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">

          {/* ── Step 0: Provider selection ─────────────────────────────────── */}
          {step === 'provider' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 mb-1">
                All providers use your own API key — stored in your browser only, never on our servers.
              </p>
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handleProviderSelect(p.id)}
                  className={`w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all hover:border-brand-400 hover:bg-brand-50/30 group`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border ${PROVIDER_COLORS[p.id]}`}>
                    {PROVIDER_ICONS[p.id]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-sm">{p.name}</span>
                      {p.hasFreeTeir && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">Free tier</span>
                      )}
                      {p.speakerIdentification === 'full' && (
                        <span className="text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-medium">Speaker ID ✓</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{p.tagline}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Max file: {p.maxFileMB >= 1024 ? `${p.maxFileMB / 1024} GB` : `${p.maxFileMB} MB`}</p>
                  </div>
                  <svg className="w-4 h-4 text-slate-300 group-hover:text-brand-500 flex-shrink-0 mt-1 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* ── Step 1: API key ────────────────────────────────────────────── */}
          {(step === 'key' || step === 'validating') && (
            <form onSubmit={handleKeySubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setStep('provider')}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors mb-2"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Change provider
              </button>

              {/* Selected provider badge */}
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium ${PROVIDER_COLORS[provider]}`}>
                {PROVIDER_ICONS[provider]}
                {providerMeta.name}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  {providerMeta.name} API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setError(''); }}
                  placeholder={providerMeta.keyHint}
                  disabled={step === 'validating'}
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-surface-50 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all disabled:opacity-60"
                />
                {error && (
                  <p className="text-red-500 text-sm mt-2 flex items-start gap-1.5">
                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={step === 'validating' || !apiKey.trim()}
                className="w-full py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {step === 'validating' ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Validating...</>
                ) : 'Continue →'}
              </button>

              {/* Security note */}
              <div className="p-3 bg-green-50 rounded-xl border border-green-100">
                <p className="text-xs text-green-800 leading-relaxed flex items-start gap-1.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  <span>
                    <strong>Your key stays private.</strong> Stored only in your browser's localStorage and sent directly to {providerMeta.name}'s API — never to our servers.
                  </span>
                </p>
              </div>

              {/* How to get key */}
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-xs text-blue-700 leading-relaxed">
                  <span className="font-semibold">Don't have a key?</span>{' '}
                  Visit{' '}
                  <a href={providerMeta.keyLink} target="_blank" rel="noreferrer"
                    className="underline font-medium">{providerMeta.keyLinkLabel}
                  </a>
                  {' '}and create a new API key.
                  {provider === 'gemini' && ' The free tier supports audio transcription.'}
                  {provider === 'groq'   && ' Groq has a generous free tier — no credit card needed.'}
                </p>
              </div>

              {/* Speaker ID note for Groq */}
              {provider === 'groq' && (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <p className="text-xs text-amber-800 leading-relaxed flex items-start gap-1.5">
                    <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span>
                      <strong>Note:</strong> Groq's Whisper models produce a plain transcript without speaker labels. Participant names are used to improve name spelling. Switch to Gemini or OpenAI GPT-4o for full speaker identification.
                    </span>
                  </p>
                </div>
              )}

              {/* Speaker ID note for OpenAI whisper-1 */}
              {provider === 'openai' && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <strong>Tip:</strong> Choose <em>GPT-4o Audio Preview</em> in the next step for full speaker identification. <em>Whisper-1</em> is faster and cheaper but produces a plain transcript without speaker labels.
                  </p>
                </div>
              )}
            </form>
          )}

          {/* ── Step 2: Model selection ────────────────────────────────────── */}
          {step === 'model' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Transcription Model
                </label>
                <p className="text-xs text-slate-500 mb-3">
                  Models marked <span className="text-brand-600 font-medium">Recommended</span> have the best audio support.
                  You can change this later in Settings.
                </p>

                {loadModels && (
                  <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
                    <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    Loading available models...
                  </div>
                )}

                {modelErr && (
                  <div className="text-sm text-red-600 bg-red-50 p-3 rounded-xl border border-red-100">
                    {modelErr}
                    <button onClick={() => setStep('model')} className="ml-2 underline">Retry</button>
                  </div>
                )}

                {!loadModels && models.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {models.map(m => (
                      <label key={m.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          selModel === m.id
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-surface-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="model"
                          value={m.id}
                          checked={selModel === m.id}
                          onChange={() => setSelModel(m.id)}
                          className="mt-0.5 accent-brand-600"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-slate-900">{m.displayName}</span>
                            {m.isRecommended && (
                              <span className="text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-md font-medium">
                                Recommended
                              </span>
                            )}
                          </div>
                          {m.description && (
                            <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                          )}
                          {m.inputTokenLimit && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {(m.inputTokenLimit / 1_000_000).toFixed(1)}M token context
                            </p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleFinish}
                disabled={loadModels || !!modelErr || !selModel}
                className="w-full py-3 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Start Transcribing →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
