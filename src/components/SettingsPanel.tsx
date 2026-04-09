/**
 * SettingsPanel.tsx — Inline settings flyout.
 * Shows current provider + model, allows model change or full provider reset.
 */

import React, { useState, useEffect } from 'react';
import { fetchModels, getDefaultModel, PROVIDERS } from '@/services/transcription';
import { loadConfig, saveConfig, clearConfig } from '@/services/config';
import type { ModelInfo } from '@/types';

interface Props {
  onClose:  () => void;
  onReset:  () => void;  // called after "Change Provider" to force re-setup
}

export function SettingsPanel({ onClose, onReset }: Props) {
  const config       = loadConfig();
  const providerMeta = PROVIDERS.find(p => p.id === config?.provider);

  const [models,   setModels]   = useState<ModelInfo[]>([]);
  const [selModel, setSelModel] = useState(config?.model ?? getDefaultModel(config?.provider ?? 'gemini'));
  const [loading,  setLoading]  = useState(true);
  const [loadErr,  setLoadErr]  = useState('');
  const [saved,    setSaved]    = useState(false);

  useEffect(() => {
    if (!config?.apiKey || !config?.provider) return;
    fetchModels(config.provider, config.apiKey)
      .then(list => { setModels(list); setLoading(false); })
      .catch(err  => { setLoadErr(err.message); setLoading(false); });
  }, []);

  const handleSave = () => {
    if (!config) return;
    saveConfig({ ...config, model: selModel });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const handleChangeProvider = () => {
    clearConfig();
    onReset();
  };

  const maskedKey = config?.apiKey
    ? config.apiKey.slice(0, 6) + '••••••••••••' + config.apiKey.slice(-4)
    : 'Not configured';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/30 backdrop-blur-sm animate-fade-in"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md animate-slide-up">

        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Settings</h2>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-surface-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">

          {/* Provider + API Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Provider &amp; API Key
            </label>
            <div className="p-3 bg-surface-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">
                  {providerMeta?.name ?? config?.provider ?? 'Unknown'}
                </span>
                <button onClick={handleChangeProvider}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 flex-shrink-0">
                  Change Provider
                </button>
              </div>
              <p className="font-mono text-xs text-slate-500">{maskedKey}</p>
            </div>
            <p className="text-xs text-slate-400 mt-1.5">
              Stored in your browser only — never sent to our servers.
            </p>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Transcription Model
            </label>

            {loading && (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                Loading models...
              </div>
            )}

            {loadErr && (
              <p className="text-sm text-red-600">{loadErr}</p>
            )}

            {!loading && models.length > 0 && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {models.map(m => (
                  <label key={m.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-colors ${
                      selModel === m.id
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}>
                    <input
                      type="radio"
                      name="setting-model"
                      value={m.id}
                      checked={selModel === m.id}
                      onChange={() => setSelModel(m.id)}
                      className="accent-brand-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-slate-900">{m.displayName}</span>
                        {m.isRecommended && (
                          <span className="text-xs bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded font-medium">
                            Recommended
                          </span>
                        )}
                      </div>
                      {m.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 pb-5">
          <button
            onClick={handleSave}
            disabled={loading || !!loadErr}
            className={`w-full py-2.5 font-semibold rounded-xl transition-colors text-sm ${
              saved
                ? 'bg-green-500 text-white'
                : 'bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50'
            }`}
          >
            {saved ? '✓ Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
