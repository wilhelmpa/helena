import { useEffect, type RefObject } from 'react';
import type { VoiceOrbAudio } from '@/utils/helenaStatus';
import { openMicrophoneAnalyser, readOrbAudio } from '@/utils/voiceOrbAudio';

export function useVoiceOrbAudio(
  host: RefObject<HTMLSpanElement | null>,
  active: boolean,
  { phase, micStream, outputAnalyser }: VoiceOrbAudio,
): void {
  useEffect(() => {
    if (!active || (phase !== 'listening' && phase !== 'hearing' && phase !== 'speaking')) return;
    const orb = host.current?.querySelector('voice-orb') as
      (HTMLElement & { bands: [number, number, number] }) | null;
    if (!orb) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let input: ReturnType<typeof openMicrophoneAnalyser> | null = null;
    try {
      if (micStream && (phase === 'listening' || phase === 'hearing'))
        input = openMicrophoneAnalyser(micStream);
    } catch {
      // Visual analysis may fail while the conversation continues.
    }
    let frame = 0;
    const paint = () => {
      const analyser = phase === 'speaking' ? outputAnalyser : input?.analyser;
      let audio = null;
      try {
        audio = analyser ? readOrbAudio(analyser) : null;
      } catch {
        // A voice engine can close between two animation frames.
      }
      orb.bands = audio?.bands ?? [0, 0, 0];
      frame = window.requestAnimationFrame(paint);
    };
    const visibility = () => {
      window.cancelAnimationFrame(frame);
      orb.bands = [0, 0, 0];
      if (!document.hidden && !motion.matches) frame = window.requestAnimationFrame(paint);
    };
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', visibility);
    visibility();
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', visibility);
      orb.bands = [0, 0, 0];
      void input?.close();
    };
  }, [host, active, phase, micStream, outputAnalyser]);
}
