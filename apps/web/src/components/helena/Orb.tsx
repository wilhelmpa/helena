'use client';

import { createElement, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useVoiceOrbAudio } from '@/hooks/useVoiceOrbAudio';
import type { HelenaStatus, VoicePhase } from '@/utils/helenaStatus';
import styles from './Orb.module.css';

let scriptPromise: Promise<void> | null = null;

function loadVoiceOrb(): Promise<void> {
  if (customElements.get('voice-orb')) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/shipnotes/voice-orb.js';
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error('Voice Orb could not load'));
      };
      document.head.append(script);
    });
  }
  return scriptPromise;
}

export default function Orb({
  state,
  size = 'small',
  className = '',
  motionEnabled = true,
  voicePhase = 'off',
  micStream = null,
  outputAnalyser = null,
}: {
  state: HelenaStatus;
  size?: 'large' | 'medium' | 'small' | 'dot';
  className?: string;
  motionEnabled?: boolean;
  voicePhase?: VoicePhase;
  micStream?: MediaStream | null;
  outputAnalyser?: AnalyserNode | null;
}) {
  const t = useTranslations('common.status');
  // On a light ground the particles are drawn as colour, not as added light (owner, 28.09.:
  // the orb was a heavy dark ball in light mode).
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === 'light' ? 'light' : 'dark';
  const [animated, setAnimated] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const orbHostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (size !== 'large') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (!motionEnabled || motion.matches) {
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
    let intersecting = true;
    const updateVisibility = () => setHidden(document.hidden || !intersecting);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            intersecting = entries[0]?.isIntersecting ?? false;
            updateVisibility();
          });
    if (orbHostRef.current) observer?.observe(orbHostRef.current);
    update();
    updateVisibility();
    motion.addEventListener('change', update);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      motion.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', updateVisibility);
      observer?.disconnect();
    };
  }, [size, motionEnabled]);

  useEffect(() => {
    if (!animated || size !== 'large') return;
    let mounted = true;
    void loadVoiceOrb()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) setAnimated(false);
      });
    return () => {
      mounted = false;
    };
  }, [animated, size]);

  useVoiceOrbAudio(orbHostRef, ready && animated === true && !hidden && size === 'large', {
    phase: voicePhase,
    micStream,
    outputAnalyser,
  });

  const visual =
    state === 'tool'
      ? 'thinking'
      : state === 'listening' || state === 'thinking' || state === 'speaking'
        ? state
        : 'idle';
  const still =
    !motionEnabled || hidden || state === 'error' || state === 'throttled' || state === 'offline';
  if (size !== 'large') {
    return (
      <span
        role="img"
        aria-label={t(state)}
        data-status={state}
        className={`${styles.orb} ${styles[size]} ${styles[state]} ${still ? styles.still : ''} ${className}`}
      />
    );
  }
  return (
    <span
      ref={orbHostRef}
      role="img"
      aria-label={t(state)}
      data-status={state}
      data-ready={ready && animated && !still ? 'true' : 'false'}
      className={`${styles.orb} ${styles.large} ${styles[state]} ${ready && animated && !still ? styles.ready : ''} ${className}`}
    >
      {(animated === false || still) && <span aria-hidden="true" className={styles.static} />}
      {animated &&
        !still &&
        createElement('voice-orb', {
          state: visual,
          theme,
          glow: 'off',
          'aria-hidden': true,
        })}
    </span>
  );
}
