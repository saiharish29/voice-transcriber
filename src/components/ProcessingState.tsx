import React from 'react';

interface Props {
  stage:  string;
  detail?: string;
}

const STAGE_ICONS: Record<string, string> = {
  uploading:         '⬆️',
  'processing upload': '⏳',
  'upload complete': '✅',
  preparing:         '📦',
  ready:             '✅',
  transcribing:      '✍️',
  retrying:          '🔄',
  'rate limit':      '⏱️',
  error:             '❌',
};

function getIcon(stage: string): string {
  const key = stage.toLowerCase();
  for (const [k, v] of Object.entries(STAGE_ICONS)) {
    if (key.includes(k)) return v;
  }
  return '🎙️';
}

export function ProcessingState({ stage, detail }: Props) {
  return (
    <div className="w-full max-w-md mx-auto animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">

        {/* Animated rings */}
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-brand-100" />
          <div className="absolute inset-0 rounded-full border-4 border-brand-500 border-t-transparent animate-spin" />
          <div className="absolute inset-2 rounded-full border-4 border-brand-200 border-b-transparent animate-spin"
            style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
          <div className="absolute inset-0 flex items-center justify-center text-2xl">
            {getIcon(stage)}
          </div>
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-1">{stage}</h2>
        {detail && (
          <p className="text-sm text-slate-500 leading-relaxed break-words">{detail}</p>
        )}

        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <div className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>

        <p className="text-xs text-slate-400 mt-4">
          Large recordings can take a few minutes — please keep this tab open.
        </p>
      </div>
    </div>
  );
}
