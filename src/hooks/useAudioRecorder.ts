/**
 * useAudioRecorder.ts — Dual-track audio recorder for Voice Transcriber.
 *
 * Captures three parallel streams from a single recording session:
 *   1. merged  — mic + system audio mixed into one stereo WebM (existing behaviour)
 *   2. micOnly — the host's microphone in isolation
 *   3. sysOnly — system/speaker audio (all remote participants) in isolation
 *
 * Why three streams?
 * The merged blob is sent to providers that only accept a single file (Groq,
 * OpenAI Whisper). The separate mic/system blobs are sent to Gemini as two
 * explicitly labelled audio parts, which gives it an unambiguous answer to
 * "who is speaking" — no guessing required.
 *
 * ── Speaker identification architecture ──────────────────────────────────────
 * Previous approach:  send one mixed file → ask Gemini to guess speakers.
 *                     Fails when voices are similar or meeting is technical.
 *
 * New approach:       send TWO separate files with explicit labels:
 *   Track 1 (micOnly)  → "Every word here is [HostName]. No exceptions."
 *   Track 2 (sysOnly)  → "These are the remote participants."
 *   Gemini's job is now to transcribe + time-align, not to guess identity.
 *
 * ── Other fixes retained from previous version ───────────────────────────────
 * FIX 1 — audioBitsPerSecond: 48_000 caps file sizes (10 min ≈ 3.6 MB)
 * FIX 2 — downloadAudio() fallback for data loss prevention
 * FIX 3 — lastChunksRef persists through cleanup() for the fallback download
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { RecordingState, ChannelInfo } from '@/types';

export interface RecordingResult {
  /** Full stereo mix — used by all providers */
  audio: Blob;
  mimeType: string;
  durationSeconds: number;
  /** Host mic only — used by Gemini for guaranteed host attribution */
  micAudio?: Blob;
  /** System/speaker audio only — used by Gemini for participant attribution */
  systemAudio?: Blob;
}

interface UseAudioRecorderReturn {
  state: RecordingState;
  duration: number;
  micLevel: number;
  systemLevel: number;
  channelInfo: ChannelInfo;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<RecordingResult>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
  downloadAudio: (filename?: string) => void;
  hasRecordedAudio: boolean;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state,       setState      ] = useState<RecordingState>('idle');
  const [duration,    setDuration   ] = useState(0);
  const [micLevel,    setMicLevel   ] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [error,       setError      ] = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<ChannelInfo>({
    hasMic: false, hasSystem: false, micLabel: '', systemLabel: '',
  });

  const cancelledRef      = useRef(false);
  const micStreamRef      = useRef<MediaStream | null>(null);
  const displayStreamRef  = useRef<MediaStream | null>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const micAnalyserRef    = useRef<AnalyserNode | null>(null);
  const sysAnalyserRef    = useRef<AnalyserNode | null>(null);

  // Three parallel recorders
  const recorderRef       = useRef<MediaRecorder | null>(null); // merged
  const micRecorderRef    = useRef<MediaRecorder | null>(null); // mic only
  const sysRecorderRef    = useRef<MediaRecorder | null>(null); // system only

  // Chunk buffers for each stream
  const chunksRef         = useRef<Blob[]>([]);
  const micChunksRef      = useRef<Blob[]>([]);
  const sysChunksRef      = useRef<Blob[]>([]);

  // Persist last recording for fallback download
  const lastChunksRef     = useRef<Blob[]>([]);
  const lastMimeTypeRef   = useRef('audio/webm');

  const startTimeRef      = useRef(0);
  const timerRef          = useRef<number | null>(null);
  const levelFrameRef     = useRef<number | null>(null);
  const mimeTypeRef       = useRef('audio/webm');

  useEffect(() => () => { cleanupHardware(); }, []);

  // ── Hardware cleanup (does NOT wipe chunk data) ───────────────────────────

  const cleanupHardware = useCallback(() => {
    if (timerRef.current)      { clearInterval(timerRef.current);           timerRef.current      = null; }
    if (levelFrameRef.current) { cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; }

    micStreamRef.current?.getTracks().forEach(t => t.stop());
    displayStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current     = null;
    displayStreamRef.current = null;

    if (audioCtxRef.current?.state !== 'closed') {
      audioCtxRef.current?.close().catch(() => {});
    }
    audioCtxRef.current    = null;
    micAnalyserRef.current = null;
    sysAnalyserRef.current = null;
    // Recorders are nulled here; chunks are intentionally preserved
    recorderRef.current    = null;
    micRecorderRef.current = null;
    sysRecorderRef.current = null;
  }, []);

  // ── Level metering ────────────────────────────────────────────────────────

  const startLevelMetering = useCallback(() => {
    const micData = new Uint8Array(64);
    const sysData = new Uint8Array(64);
    const tick = () => {
      if (cancelledRef.current) return;
      if (micAnalyserRef.current) {
        micAnalyserRef.current.getByteFrequencyData(micData);
        setMicLevel(Math.min(1, micData.reduce((a, b) => a + b, 0) / micData.length / 128));
      }
      if (sysAnalyserRef.current) {
        sysAnalyserRef.current.getByteFrequencyData(sysData);
        setSystemLevel(Math.min(1, sysData.reduce((a, b) => a + b, 0) / sysData.length / 128));
      }
      levelFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  // ── START ─────────────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    cancelledRef.current  = false;
    chunksRef.current     = [];
    micChunksRef.current  = [];
    sysChunksRef.current  = [];
    lastChunksRef.current = [];
    setError(null);
    setDuration(0);
    setMicLevel(0);
    setSystemLevel(0);
    setState('requesting');

    try {
      // 1. Microphone
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelledRef.current) { micStream.getTracks().forEach(t => t.stop()); return; }
        micStreamRef.current = micStream;
      } catch {
        console.warn('Microphone permission denied');
      }

      // 2. System / tab audio (optional)
      let systemAudio: MediaStream | null = null;
      if (!cancelledRef.current) {
        try {
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          if (cancelledRef.current) { display.getTracks().forEach(t => t.stop()); return; }
          displayStreamRef.current = display;
          display.getVideoTracks().forEach(t => t.stop());
          const audioTracks = display.getAudioTracks();
          if (audioTracks.length > 0) {
            systemAudio = new MediaStream(audioTracks);
          }
        } catch {
          // User cancelled or browser unsupported — proceed mic-only
        }
      }

      if (cancelledRef.current) return;
      if (!micStream && !systemAudio) {
        throw new Error('No audio source available. Please allow microphone access and try again.');
      }

      // 3. AudioContext for the merged stereo stream
      const audioCtx   = new AudioContext({ sampleRate: 48_000 });
      audioCtxRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();
      const merger      = audioCtx.createChannelMerger(2);
      merger.connect(destination);

      if (micStream && micStream.getAudioTracks().length > 0) {
        const src     = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 0); // left channel = mic
        micAnalyserRef.current = analyser;
      }

      if (systemAudio && systemAudio.getAudioTracks().length > 0) {
        const src      = audioCtx.createMediaStreamSource(systemAudio);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 1); // right channel = system
        sysAnalyserRef.current = analyser;
      }

      setChannelInfo({
        hasMic:      !!(micStream    && micStream.getAudioTracks().length > 0),
        hasSystem:   !!(systemAudio  && systemAudio.getAudioTracks().length > 0),
        micLabel:    micStream?.getAudioTracks()[0]?.label    || 'No microphone',
        systemLabel: systemAudio?.getAudioTracks()[0]?.label  || 'No system audio',
      });

      // 4. Choose MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeTypeRef.current     = mimeType;
      lastMimeTypeRef.current = mimeType;

      const recorderOpts: MediaRecorderOptions = {
        mimeType,
        // 48 kbps Opus stereo: transparent for speech, keeps files small
        //   10 min → ~3.6 MB  (all providers inline)
        //   2 hr   → ~43 MB   (Gemini File API)
        audioBitsPerSecond: 48_000,
      };

      // 5a. Merged recorder (AudioContext destination → stereo WebM)
      const mergedRec = new MediaRecorder(destination.stream, recorderOpts);
      mergedRec.ondataavailable = e => {
        if (e.data.size > 0 && !cancelledRef.current) {
          chunksRef.current.push(e.data);
          lastChunksRef.current = [...chunksRef.current];
        }
      };
      recorderRef.current = mergedRec;

      // 5b. Mic-only recorder — raw mic stream, NOT the AudioContext output.
      //     This gives Gemini a clean isolated track: every word = [HostName].
      if (micStream && micStream.getAudioTracks().length > 0) {
        const micRec = new MediaRecorder(micStream, recorderOpts);
        micRec.ondataavailable = e => {
          if (e.data.size > 0 && !cancelledRef.current) micChunksRef.current.push(e.data);
        };
        micRecorderRef.current = micRec;
        micRec.start(1_000);
      }

      // 5c. System-only recorder — raw system audio stream.
      //     This gives Gemini isolated participant voices.
      if (systemAudio && systemAudio.getAudioTracks().length > 0) {
        const sysRec = new MediaRecorder(systemAudio, recorderOpts);
        sysRec.ondataavailable = e => {
          if (e.data.size > 0 && !cancelledRef.current) sysChunksRef.current.push(e.data);
        };
        sysRecorderRef.current = sysRec;
        sysRec.start(1_000);
      }

      // Start merged last so all three recorders are as time-aligned as possible
      startTimeRef.current = Date.now();
      mergedRec.start(1_000);

      timerRef.current = window.setInterval(() => {
        if (!cancelledRef.current) setDuration(s => s + 1);
      }, 1_000);

      startLevelMetering();
      setState('recording');

    } catch (err: any) {
      if (!cancelledRef.current) {
        cleanupHardware();
        setError(err.message || 'Failed to start recording');
        setState('idle');
      }
    }
  }, [cleanupHardware, startLevelMetering]);

  // ── STOP ─────────────────────────────────────────────────────────────────

  const stopRecording = useCallback((): Promise<RecordingResult> => {
    return new Promise(resolve => {
      if (timerRef.current)      { clearInterval(timerRef.current);           timerRef.current      = null; }
      if (levelFrameRef.current) { cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; }

      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1_000);

      // We wait for all active recorders to fire their onstop event.
      // pendingStops starts at 3 (one per recorder slot). Each recorder
      // decrements it; when it hits zero we assemble the final result.
      let pendingStops = 3;

      const finish = () => {
        pendingStops--;
        if (pendingStops > 0) return;

        const merged = new Blob(chunksRef.current,    { type: mimeTypeRef.current });
        const mic    = micChunksRef.current.length > 0
          ? new Blob(micChunksRef.current,  { type: mimeTypeRef.current })
          : undefined;
        const sys    = sysChunksRef.current.length > 0
          ? new Blob(sysChunksRef.current,  { type: mimeTypeRef.current })
          : undefined;

        lastChunksRef.current   = [...chunksRef.current];
        lastMimeTypeRef.current = mimeTypeRef.current;

        cleanupHardware();
        setState('stopped');
        resolve({
          audio:         merged,
          mimeType:      mimeTypeRef.current,
          durationSeconds,
          micAudio:      mic,
          systemAudio:   sys,
        });
      };

      const stopOne = (rec: MediaRecorder | null) => {
        if (!rec || rec.state === 'inactive') { finish(); return; }
        rec.onstop = finish;
        rec.stop();
      };

      stopOne(recorderRef.current);
      stopOne(micRecorderRef.current);
      stopOne(sysRecorderRef.current);
    });
  }, [cleanupHardware]);

  // ── PAUSE / RESUME ────────────────────────────────────────────────────────

  const pauseRecording = useCallback(() => {
    [recorderRef, micRecorderRef, sysRecorderRef].forEach(r => {
      if (r.current?.state === 'recording') r.current.pause();
    });
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState('paused');
  }, []);

  const resumeRecording = useCallback(() => {
    [recorderRef, micRecorderRef, sysRecorderRef].forEach(r => {
      if (r.current?.state === 'paused') r.current.resume();
    });
    timerRef.current = window.setInterval(() => {
      if (!cancelledRef.current) setDuration(s => s + 1);
    }, 1_000);
    setState('recording');
  }, []);

  // ── CANCEL ────────────────────────────────────────────────────────────────

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    [recorderRef, micRecorderRef, sysRecorderRef].forEach(r => {
      if (r.current && r.current.state !== 'inactive') {
        r.current.ondataavailable = null;
        r.current.onstop          = null;
        try { r.current.stop(); } catch { /* already stopped */ }
      }
    });
    chunksRef.current    = [];
    micChunksRef.current = [];
    sysChunksRef.current = [];
    cleanupHardware();
    setDuration(0);
    setMicLevel(0);
    setSystemLevel(0);
    setError(null);
    setState('idle');
  }, [cleanupHardware]);

  // ── DOWNLOAD FALLBACK ─────────────────────────────────────────────────────

  const downloadAudio = useCallback((filename?: string) => {
    const chunks   = lastChunksRef.current;
    const mimeType = lastMimeTypeRef.current;
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename || `recording-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }, []);

  return {
    state, duration, micLevel, systemLevel, channelInfo, error,
    startRecording, stopRecording, pauseRecording, resumeRecording,
    cancelRecording, downloadAudio,
    hasRecordedAudio: lastChunksRef.current.length > 0,
  };
}
