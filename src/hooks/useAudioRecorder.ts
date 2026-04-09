/**
 * useAudioRecorder.ts — Simplified audio recorder for Voice Transcriber.
 *
 * Captures:
 *   • Microphone (always asked)
 *   • System / tab audio (optional — obtained via getDisplayMedia)
 *
 * Both channels are merged into a single stereo WebM/Opus blob that is
 * handed back to the caller and can be passed directly to the transcription
 * service — no server upload required.
 *
 * Deliberately simpler than the original useMeetingRecorder:
 *   – No screenshot capture (not needed for transcription-only)
 *   – No speaker-timeline energy analysis (done by the LLM)
 *   – No separate host/system blobs (merged audio is sufficient)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { RecordingState, ChannelInfo } from '@/types';

export interface RecordingResult {
  audio: Blob;
  mimeType: string;
  durationSeconds: number;
}

interface UseAudioRecorderReturn {
  state:       RecordingState;
  duration:    number;         // seconds
  micLevel:    number;         // 0–1
  systemLevel: number;         // 0–1
  channelInfo: ChannelInfo;
  error:       string | null;
  startRecording:  () => Promise<void>;
  stopRecording:   () => Promise<RecordingResult>;
  pauseRecording:  () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state,       setState]       = useState<RecordingState>('idle');
  const [duration,    setDuration]    = useState(0);
  const [micLevel,    setMicLevel]    = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [error,       setError]       = useState<string | null>(null);
  const [channelInfo, setChannelInfo] = useState<ChannelInfo>({
    hasMic: false, hasSystem: false, micLabel: '', systemLabel: '',
  });

  const cancelledRef     = useRef(false);
  const micStreamRef     = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const micAnalyserRef   = useRef<AnalyserNode | null>(null);
  const sysAnalyserRef   = useRef<AnalyserNode | null>(null);
  const recorderRef      = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const startTimeRef     = useRef(0);
  const timerRef         = useRef<number | null>(null);
  const levelFrameRef    = useRef<number | null>(null);
  const mimeTypeRef      = useRef('audio/webm');

  useEffect(() => () => { cleanup(); }, []);

  // ── Internal cleanup ────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (timerRef.current)    { clearInterval(timerRef.current);         timerRef.current = null; }
    if (levelFrameRef.current) { cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; }

    micStreamRef.current?.getTracks().forEach(t => t.stop());
    displayStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current     = null;
    displayStreamRef.current = null;

    if (audioCtxRef.current?.state !== 'closed') {
      audioCtxRef.current?.close().catch(() => {});
    }
    audioCtxRef.current  = null;
    micAnalyserRef.current = null;
    sysAnalyserRef.current = null;
  }, []);

  // ── Level metering (animation frame loop) ──────────────────────────────────

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

  // ── START ───────────────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    cancelledRef.current = false;
    chunksRef.current    = [];
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
            video: true,  // required by spec even if we only want audio
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          });
          if (cancelledRef.current) { display.getTracks().forEach(t => t.stop()); return; }
          displayStreamRef.current = display;

          // Stop the video track — we only need system audio
          display.getVideoTracks().forEach(t => t.stop());

          const audioTracks = display.getAudioTracks();
          if (audioTracks.length > 0) {
            systemAudio = new MediaStream(audioTracks);
          }
        } catch {
          // User cancelled / browser doesn't support — proceed mic-only
        }
      }

      if (cancelledRef.current) return;

      if (!micStream && !systemAudio) {
        throw new Error('No audio source available. Please allow microphone access and try again.');
      }

      // 3. Mix both channels into one stream via AudioContext
      const audioCtx   = new AudioContext({ sampleRate: 48_000 });
      audioCtxRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();
      const merger       = audioCtx.createChannelMerger(2);
      merger.connect(destination);

      if (micStream && micStream.getAudioTracks().length > 0) {
        const src      = audioCtx.createMediaStreamSource(micStream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 0);  // left channel = mic
        micAnalyserRef.current = analyser;
      }

      if (systemAudio && systemAudio.getAudioTracks().length > 0) {
        const src      = audioCtx.createMediaStreamSource(systemAudio);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(merger, 0, 1);  // right channel = system
        sysAnalyserRef.current = analyser;
      }

      setChannelInfo({
        hasMic:      !!(micStream    && micStream.getAudioTracks().length > 0),
        hasSystem:   !!(systemAudio  && systemAudio.getAudioTracks().length > 0),
        micLabel:    micStream?.getAudioTracks()[0]?.label    || 'No microphone',
        systemLabel: systemAudio?.getAudioTracks()[0]?.label  || 'No system audio',
      });

      // 4. MediaRecorder on the mixed stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      mimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(destination.stream, { mimeType });
      recorder.ondataavailable = e => {
        if (e.data.size > 0 && !cancelledRef.current) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;

      // 5. Go!
      startTimeRef.current = Date.now();
      recorder.start(1_000);   // 1-second timeslice so chunks arrive continuously

      timerRef.current = window.setInterval(() => {
        if (!cancelledRef.current) setDuration(s => s + 1);
      }, 1_000);

      startLevelMetering();
      setState('recording');

    } catch (err: any) {
      if (!cancelledRef.current) {
        cleanup();
        setError(err.message || 'Failed to start recording');
        setState('idle');
      }
    }
  }, [cleanup, startLevelMetering]);

  // ── STOP ────────────────────────────────────────────────────────────────────

  const stopRecording = useCallback((): Promise<RecordingResult> => {
    return new Promise(resolve => {
      if (timerRef.current)      { clearInterval(timerRef.current);         timerRef.current = null; }
      if (levelFrameRef.current) { cancelAnimationFrame(levelFrameRef.current); levelFrameRef.current = null; }

      const durationSeconds = Math.round((Date.now() - startTimeRef.current) / 1_000);

      const finish = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        cleanup();
        setState('stopped');
        resolve({ audio: blob, mimeType: mimeTypeRef.current, durationSeconds });
      };

      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') { finish(); return; }

      recorder.onstop = finish;
      recorder.stop();
    });
  }, [cleanup]);

  // ── PAUSE / RESUME ──────────────────────────────────────────────────────────

  const pauseRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.pause();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setState('paused');
  }, []);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current?.state === 'paused') recorderRef.current.resume();
    timerRef.current = window.setInterval(() => {
      if (!cancelledRef.current) setDuration(s => s + 1);
    }, 1_000);
    setState('recording');
  }, []);

  // ── CANCEL ──────────────────────────────────────────────────────────────────

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop          = null;
      try { recorderRef.current.stop(); } catch { /* already stopped */ }
      recorderRef.current = null;
    }
    chunksRef.current = [];
    cleanup();
    setDuration(0);
    setMicLevel(0);
    setSystemLevel(0);
    setError(null);
    setState('idle');
  }, [cleanup]);

  return {
    state, duration, micLevel, systemLevel, channelInfo, error,
    startRecording, stopRecording, pauseRecording, resumeRecording, cancelRecording,
  };
}
