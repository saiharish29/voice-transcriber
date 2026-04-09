/**
 * AudioInput.tsx — Upload an existing file OR record live audio.
 *
 * Two tabs:
 *   Upload  — drag-and-drop / browse for any audio or video file
 *   Record  — mic + optional system audio via screen share
 */

import React, { useState, useRef } from 'react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/services/transcription';
import type { MeetingContext } from '@/types';

interface Props {
  onTranscribe: (file: File, context: MeetingContext) => void;
  disabled: boolean;
}

type Tab = 'upload' | 'record';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function LevelBar({ level, label }: { level: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-20 truncate">{label}</span>
      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-500 rounded-full transition-all duration-75"
          style={{ width: `${Math.min(100, level * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function AudioInput({ onTranscribe, disabled }: Props) {
  const [tab,       setTab]       = useState<Tab>('upload');
  const [file,      setFile]      = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [dragOver,  setDragOver]  = useState(false);

  // Recorded result waiting to be submitted
  const [recordedFile, setRecordedFile] = useState<File | null>(null);

  // ── Participant / speaker identification fields ──────────────────────────
  const [hostName,      setHostName]      = useState('');
  const [participants,  setParticipants]  = useState<string[]>([]);
  const [newParticipant, setNewParticipant] = useState('');
  const [meetingTitle,  setMeetingTitle]  = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorder     = useAudioRecorder();

  const addParticipant = () => {
    const name = newParticipant.trim();
    if (name && !participants.includes(name)) {
      setParticipants(prev => [...prev, name]);
      setNewParticipant('');
    }
  };

  const removeParticipant = (i: number) => setParticipants(prev => prev.filter((_, j) => j !== i));

  // ── File validation ──────────────────────────────────────────────────────

  const validateFile = (f: File): string | null => {
    if (!ACCEPTED_MIME_TYPES.includes(f.type) && f.type !== '') {
      return `Unsupported format: ${f.type}. Please use MP3, WAV, WebM, MP4, M4A, OGG, AAC, FLAC, or MOV.`;
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      return `File too large (${formatBytes(f.size)}). Maximum size is 500 MB.`;
    }
    if (f.size === 0) {
      return 'The selected file appears to be empty.';
    }
    return null;
  };

  const handleFile = (f: File) => {
    const err = validateFile(f);
    if (err) { setFileError(err); setFile(null); return; }
    setFileError('');
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  // ── Recording controls ───────────────────────────────────────────────────

  const handleStartRecording = async () => {
    setRecordedFile(null);
    await recorder.startRecording();
  };

  const handleStopRecording = async () => {
    const result = await recorder.stopRecording();
    const ext    = result.mimeType.includes('webm') ? 'webm' : 'ogg';
    const blob   = new File(
      [result.audio],
      `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`,
      { type: result.mimeType }
    );
    setRecordedFile(blob);
  };

  const isRecording = recorder.state === 'recording' || recorder.state === 'paused';

  // ── Derived: what file will be transcribed ───────────────────────────────

  const activeFile = tab === 'upload' ? file : recordedFile;

  const buildContext = (): MeetingContext => ({
    hostName:     hostName.trim(),
    participants: participants.filter(Boolean),
    meetingTitle: meetingTitle.trim() || undefined,
  });

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up">

      {/* Tab switcher */}
      <div className="flex rounded-xl bg-surface-100 p-1 mb-6">
        {(['upload', 'record'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setFileError(''); }}
            disabled={isRecording || disabled}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
              tab === t
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
            }`}
          >
            {t === 'upload' ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload File
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                Record Live
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Upload tab ──────────────────────────────────────────────────────── */}
      {tab === 'upload' && (
        <div>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
              dragOver
                ? 'border-brand-500 bg-brand-50'
                : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />

            {file ? (
              <div>
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
                <p className="font-semibold text-slate-900 truncate max-w-xs mx-auto">{file.name}</p>
                <p className="text-sm text-slate-500 mt-1">{formatBytes(file.size)}</p>
                <p className="text-xs text-brand-600 mt-2 font-medium">Click to change file</p>
              </div>
            ) : (
              <div>
                <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="font-semibold text-slate-700">Drop your audio or video file here</p>
                <p className="text-sm text-slate-500 mt-1">or click to browse</p>
                <p className="text-xs text-slate-400 mt-3">
                  MP3 · WAV · WebM · MP4 · M4A · OGG · AAC · FLAC · MOV — up to 500 MB
                </p>
              </div>
            )}
          </div>

          {fileError && (
            <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100 flex items-start gap-2 text-sm text-red-700">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {fileError}
            </div>
          )}
        </div>
      )}

      {/* ── Record tab ──────────────────────────────────────────────────────── */}
      {tab === 'record' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">

          {recorder.error && (
            <div className="mb-4 p-3 bg-red-50 rounded-xl border border-red-100 text-sm text-red-700">
              {recorder.error}
            </div>
          )}

          {/* Channel info */}
          {(recorder.state === 'recording' || recorder.state === 'paused') && (
            <div className="mb-4 space-y-2">
              {recorder.channelInfo.hasMic && (
                <LevelBar level={recorder.micLevel} label={recorder.channelInfo.micLabel || 'Microphone'} />
              )}
              {recorder.channelInfo.hasSystem && (
                <LevelBar level={recorder.systemLevel} label={recorder.channelInfo.systemLabel || 'System audio'} />
              )}
              {!recorder.channelInfo.hasSystem && (
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg border border-amber-100">
                  System audio not captured. For online meetings (Zoom, Teams, Meet), share your screen with audio when prompted to capture all participants.
                </p>
              )}
            </div>
          )}

          {/* Timer */}
          {(recorder.state === 'recording' || recorder.state === 'paused') && (
            <div className="text-center mb-4">
              <div className={`text-4xl font-mono font-bold ${
                recorder.state === 'recording' ? 'text-slate-900' : 'text-slate-400'
              }`}>
                {formatDuration(recorder.duration)}
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-1">
                {recorder.state === 'recording' ? (
                  <><div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" /><span className="text-xs text-red-600 font-medium">Recording</span></>
                ) : (
                  <><div className="w-2 h-2 bg-amber-400 rounded-full" /><span className="text-xs text-amber-600 font-medium">Paused</span></>
                )}
              </div>
            </div>
          )}

          {/* Recorded result waiting to transcribe */}
          {recorder.state === 'stopped' && recordedFile && (
            <div className="mb-4 p-3 bg-green-50 rounded-xl border border-green-200 flex items-center gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-green-800">Recording ready</p>
                <p className="text-xs text-green-600">{formatBytes(recordedFile.size)} · {recordedFile.name}</p>
              </div>
            </div>
          )}

          {/* Idle state description */}
          {recorder.state === 'idle' && !recordedFile && (
            <div className="text-center py-4 mb-4">
              <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">Ready to record</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                You'll be asked for microphone access. For online meetings, share your screen with audio to capture all participants.
              </p>
            </div>
          )}

          {/* Control buttons */}
          <div className="flex gap-3 justify-center flex-wrap">
            {recorder.state === 'idle' && (
              <button
                onClick={handleStartRecording}
                disabled={disabled}
                className="px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <div className="w-3 h-3 bg-white rounded-full" />
                Start Recording
              </button>
            )}

            {recorder.state === 'stopped' && (
              <button
                onClick={handleStartRecording}
                disabled={disabled}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                Record Again
              </button>
            )}

            {recorder.state === 'recording' && (
              <>
                <button
                  onClick={() => recorder.pauseRecording()}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                  Pause
                </button>
                <button
                  onClick={handleStopRecording}
                  className="px-5 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  <div className="w-3 h-3 bg-white rounded-sm" />
                  Stop
                </button>
                <button
                  onClick={() => recorder.cancelRecording()}
                  className="px-5 py-2.5 bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 font-semibold rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
              </>
            )}

            {recorder.state === 'paused' && (
              <>
                <button
                  onClick={() => recorder.resumeRecording()}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Resume
                </button>
                <button
                  onClick={handleStopRecording}
                  className="px-5 py-2.5 bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  <div className="w-3 h-3 bg-white rounded-sm" />
                  Stop & Save
                </button>
                <button
                  onClick={() => recorder.cancelRecording()}
                  className="px-5 py-2.5 bg-white border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 font-semibold rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
              </>
            )}

            {recorder.state === 'requesting' && (
              <div className="flex items-center gap-2 text-slate-500 text-sm py-2">
                <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                Requesting permissions...
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Participant / speaker identification ─────────────────────────────── */}
      {/* Always visible so user can pre-fill before picking a file too */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Who is in this meeting?
            <span className="text-xs font-normal text-slate-400">(optional — improves speaker identification)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Providing names lets Gemini label speakers by their real names instead of "Speaker A / Speaker B".
          </p>
        </div>

        {/* Meeting title */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Meeting title</label>
          <input
            type="text"
            value={meetingTitle}
            onChange={e => setMeetingTitle(e.target.value)}
            placeholder="e.g. Q2 Planning, Client Demo, 1:1 with Sarah..."
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-surface-50 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
        </div>

        {/* Host name */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Your name <span className="text-slate-400">(the person recording)</span>
          </label>
          <input
            type="text"
            value={hostName}
            onChange={e => setHostName(e.target.value)}
            placeholder="e.g. Harish"
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-surface-50 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          />
          <p className="text-xs text-slate-400 mt-1">
            Your mic is the clearest channel — knowing your name gives Gemini a strong starting anchor.
          </p>
        </div>

        {/* Other participants */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Other participants</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newParticipant}
              onChange={e => setNewParticipant(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addParticipant(); } }}
              placeholder="Add a name and press Enter"
              className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-surface-50 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
            <button
              type="button"
              onClick={addParticipant}
              disabled={!newParticipant.trim()}
              className="px-3 py-2 bg-brand-100 text-brand-700 text-sm font-semibold rounded-xl hover:bg-brand-200 disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
          {participants.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {participants.map((name, i) => (
                <span key={i}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-50 text-brand-700 text-xs font-medium rounded-lg border border-brand-100">
                  {name}
                  <button onClick={() => removeParticipant(i)}
                    className="text-brand-400 hover:text-brand-700 transition-colors leading-none">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tip when no names entered */}
        {!hostName && participants.length === 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 rounded-xl border border-amber-100 text-xs text-amber-800">
            <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            No names provided — speakers will be labelled "Speaker A", "Speaker B", etc.
            You can still transcribe and add names manually later.
          </div>
        )}
      </div>

      {/* ── Transcribe button ────────────────────────────────────────────────── */}
      {activeFile && !isRecording && (
        <button
          onClick={() => onTranscribe(activeFile, buildContext())}
          disabled={disabled}
          className="w-full mt-4 py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-lg shadow-lg shadow-brand-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-3"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Transcribe Now
        </button>
      )}
    </div>
  );
}
