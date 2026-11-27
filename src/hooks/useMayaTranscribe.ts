import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseMayaTranscribeOptions {
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
}

export interface UseMayaTranscribeReturn {
  isRecording: boolean;
  isTranscribing: boolean;
  durationSec: number;
  audioLevel: number;
  error: string | null;
  startRecording: () => Promise<void>;
  stopAndTranscribe: (overrideCallback?: (text: string) => void) => Promise<string | null>;
  cancelRecording: () => void;
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = String(reader.result || '');
      const idx = res.indexOf(',');
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

export function useMayaTranscribe(options?: UseMayaTranscribeOptions): UseMayaTranscribeReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>('audio/webm');
  const timerRef = useRef<number | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const cancelledRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const cleanupMedia = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing) return;
    setError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Microphone capture is not supported in this browser.';
      setError(msg);
      optionsRef.current?.onError?.(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      cancelledRef.current = false;

      const mime = pickSupportedAudioMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mimeRef.current = recorder.mimeType || mime || 'audio/webm';
      recorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      // Live microphone RMS level meter for visual feedback
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const sampleLevel = () => {
            if (!audioCtxRef.current) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            setAudioLevel(Math.min(1, rms * 4.2));
            meterRafRef.current = requestAnimationFrame(sampleLevel);
          };
          sampleLevel();
        }
      } catch {
        // level meter is optional
      }

      recorder.start(250);
      setIsRecording(true);
      setDurationSec(0);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => {
        setDurationSec(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
    } catch (err: any) {
      cleanupMedia();
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Please allow microphone access to dictate to MAYA.'
          : err?.message || 'Unable to access microphone.';
      setError(msg);
      optionsRef.current?.onError?.(msg);
    }
  }, [isRecording, isTranscribing, cleanupMedia]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    cleanupMedia();
    setIsRecording(false);
    setDurationSec(0);
    setError(null);
  }, [cleanupMedia]);

  const stopAndTranscribe = useCallback(
    async (overrideCallback?: (text: string) => void): Promise<string | null> => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') {
        setIsRecording(false);
        cleanupMedia();
        return null;
      }

      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          const out = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
          resolve(out);
        };
        try {
          rec.stop();
        } catch {
          resolve(new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' }));
        }
      });

      recorderRef.current = null;
      chunksRef.current = [];
      cleanupMedia();
      setIsRecording(false);

      if (cancelledRef.current) return null;
      if (!blob || blob.size < 400) {
        const msg = 'Recording was too short. Hold or speak for at least a second.';
        setError(msg);
        optionsRef.current?.onError?.(msg);
        return null;
      }

      setIsTranscribing(true);
      setError(null);
      try {
        const audioBase64 = await blobToBase64(blob);
        const res = await fetch('/api/maya/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType: blob.type || mimeRef.current || 'audio/webm',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Audio transcription failed.');
        }
        const text = String(data?.text || '').trim();
        if (!text) {
          const msg = 'No speech detected in the recording.';
          setError(msg);
          optionsRef.current?.onError?.(msg);
          return null;
        }
        if (overrideCallback) {
          overrideCallback(text);
        } else {
          optionsRef.current?.onTranscript?.(text);
        }
        return text;
      } catch (err: any) {
        const msg = err?.message || 'Unable to transcribe audio right now.';
        setError(msg);
        optionsRef.current?.onError?.(msg);
        return null;
      } finally {
        setIsTranscribing(false);
        setDurationSec(0);
      }
    },
    [cleanupMedia]
  );

  return {
    isRecording,
    isTranscribing,
    durationSec,
    audioLevel,
    error,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  };
}
