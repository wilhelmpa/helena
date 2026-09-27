'use client';

import { createElement, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useVoiceOrbAudio } from '@/hooks/useVoiceOrbAudio';
import type { AgentOrbState, VoiceOrbPhase } from '@/utils/agentStatusOrb';
import { shipnotesState } from '@/utils/agentStatusOrb';
import styles from './AgentStatusOrb.module.css';

let scriptPromise: Promise<void> | null = null;

function loadSignalOrb(): Promise<void> {
  if (customElements.get('signal-orb')) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/shipnotes/signal-orb.js';
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error('Signal Orb could not load'));
      };
      document.head.append(script);
    });
  }
  return scriptPromise;
}

export default function AgentStatusOrb({
  state,
  size = 'small',
  className = '',
  motionEnabled = true,
  online = true,
  voicePhase = 'off',
  micStream = null,
  outputAnalyser = null,
}: {
  state: AgentOrbState;
  size?: 'small' | 'large';
  className?: string;
  motionEnabled?: boolean;
  online?: boolean;
  voicePhase?: VoiceOrbPhase;
  micStream?: MediaStream | null;
  outputAnalyser?: AnalyserNode | null;
}) {
  const t = useTranslations('common.statusOrb');
  const [animated, setAnimated] = useState(false);
  const [ready, setReady] = useState(false);
  const orbHostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size !== 'large' || !motionEnabled || !online) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (motion.matches) {
        setAnimated(false);
        return;
      }
      try {
        const context = document.createElement('canvas').getContext('webgl');
        setAnimated(Boolean(context));
        context?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        setAnimated(false);
      }
    };
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, [size, motionEnabled, online]);

  useEffect(() => {
    if (!animated || !motionEnabled || !online || size !== 'large') return;
    let mounted = true;
    void loadSignalOrb()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) setAnimated(false);
      });
    return () => {
      mounted = false;
    };
  }, [animated, motionEnabled, online, size]);

  useVoiceOrbAudio(orbHostRef, ready && animated && motionEnabled && online && size === 'large', {
    phase: voicePhase,
    micStream,
    outputAnalyser,
  });

  const label = t(state);
  const motionAllowed =
    size === 'large' &&
    typeof window !== 'undefined' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (size === 'small') {
    return (
      <span
        aria-label={online || state !== 'idle' ? label : t('offline')}
        role="img"
        className={`${styles.small} ${styles[state]} ${online || state !== 'idle' ? '' : styles.offline} ${motionEnabled ? '' : styles.still} ${className}`}
      />
    );
  }
  return (
    <span
      ref={orbHostRef}
      aria-label={online || state !== 'idle' ? label : t('offline')}
      role="img"
      className={`${styles.large} ${styles[state]} ${online ? '' : styles.offline} ${className}`}
    >
      {motionEnabled && motionAllowed && online && animated && ready ? (
        createElement('signal-orb', {
          state: shipnotesState[state],
          particles: '4000',
          'aria-hidden': true,
        })
      ) : (
        <span
          aria-hidden="true"
          className={`${styles.static} ${styles[state]} ${online || state !== 'idle' ? '' : styles.offline}`}
        />
      )}
    </span>
  );
}
