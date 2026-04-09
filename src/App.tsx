import React, { useState, useCallback } from 'react';
import { ApiKeySetup }    from '@/components/ApiKeySetup';
import { AudioInput }     from '@/components/AudioInput';
import { ProcessingState} from '@/components/ProcessingState';
import { TranscriptView } from '@/components/TranscriptView';
import { SettingsPanel }  from '@/components/SettingsPanel';
import { loadConfig }     from '@/services/config';
import { transcribe }           from '@/services/transcription';
import type { AppState, MeetingContext } from '@/types';

export default function App() {
  // null = loading check; true/false = config present or not
  const [configured,    setConfigured]    = useState<boolean>(() => !!loadConfig());
  const [appState,      setAppState]      = useState<AppState>({ status: 'idle' });
  const [stage,         setStage]         = useState('');
  const [detail,        setDetail]        = useState('');
  const [showSettings,  setShowSettings]  = useState(false);

  const handleTranscribe = useCallback(async (file: File, context: MeetingContext) => {
    const config = loadConfig();
    if (!config) { setConfigured(false); return; }

    setAppState({ status: 'processing', fileName: file.name });
    setStage('Starting');
    setDetail('');

    try {
      const transcript = await transcribe(
        file,
        config,
        (s, d) => { setStage(s); setDetail(d ?? ''); },
        context,
      );
      setAppState({ status: 'success', transcript, fileName: file.name });
    } catch (err: any) {
      setAppState({
        status: 'error',
        error:    err.message || 'Transcription failed. Please try again.',
        fileName: file.name,
      });
    }
  }, []);

  const handleReset = useCallback(() => {
    setAppState({ status: 'idle' });
    setStage('');
    setDetail('');
  }, []);

  // ── First-run / key-change setup screen ────────────────────────────────────
  if (!configured) {
    return <ApiKeySetup onConfigured={() => setConfigured(true)} />;
  }

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">

      {/* ── Top nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 text-sm">Voice Transcriber</span>
            <span className="hidden sm:inline text-xs text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">
              Powered by Gemini
            </span>
          </div>

          <div className="flex items-center gap-2">
            {appState.status !== 'idle' && appState.status !== 'processing' && (
              <button
                onClick={handleReset}
                className="text-sm font-medium text-slate-600 hover:text-brand-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-brand-50"
              >
                + New Transcription
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-surface-100 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-start px-4 py-10">

        {/* ── Idle: show upload / record UI ─────────────────────────────────── */}
        {appState.status === 'idle' && (
          <div className="w-full max-w-2xl">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-slate-900">Transcribe Your Meeting</h1>
              <p className="text-slate-500 mt-2">
                Upload an audio or video file, or record live — get a timestamped transcript in seconds.
              </p>
            </div>
            <AudioInput onTranscribe={handleTranscribe} disabled={false} />
          </div>
        )}

        {/* ── Processing ────────────────────────────────────────────────────── */}
        {appState.status === 'processing' && (
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-slate-900">Transcribing...</h1>
              <p className="text-slate-500 mt-1 text-sm truncate max-w-xs mx-auto">
                {appState.fileName}
              </p>
            </div>
            <ProcessingState stage={stage} detail={detail} />
          </div>
        )}

        {/* ── Success ───────────────────────────────────────────────────────── */}
        {appState.status === 'success' && appState.transcript && (
          <TranscriptView
            transcript={appState.transcript}
            fileName={appState.fileName ?? 'recording'}
            onReset={handleReset}
          />
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {appState.status === 'error' && (
          <div className="w-full max-w-lg animate-slide-up">
            <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-red-700 font-bold text-lg mb-2">Transcription Failed</h3>
              <p className="text-red-600 text-sm leading-relaxed whitespace-pre-line text-left bg-red-50 rounded-xl p-4 mb-6">
                {appState.error}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleReset}
                  className="px-5 py-2.5 bg-white border border-red-200 text-red-700 font-semibold rounded-xl hover:bg-red-50 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-5 py-2.5 bg-brand-600 text-white font-semibold rounded-xl hover:bg-brand-700 transition-colors"
                >
                  Check Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="text-center text-xs text-slate-400 py-4 border-t border-slate-100">
        Voice Transcriber · BYOK · Your API key never leaves your browser
      </footer>

      {/* ── Settings overlay ─────────────────────────────────────────────────── */}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onReset={() => { setShowSettings(false); setConfigured(false); setAppState({ status: 'idle' }); }}
        />
      )}
    </div>
  );
}
