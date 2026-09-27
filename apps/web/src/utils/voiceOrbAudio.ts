// Browser-only analysis for the large chat orb. No samples leave this module.
export interface OrbAudioFrame {
  level: number;
  bands: [number, number, number];
}

export function orbAudioFrame(
  wave: Uint8Array,
  frequencies: Uint8Array,
  sampleRate = 48000,
): OrbAudioFrame {
  let energy = 0;
  for (const sample of wave) {
    const centered = (sample - 128) / 128;
    energy += centered * centered;
  }
  const rms = wave.length ? Math.sqrt(energy / wave.length) : 0;
  const bands: [number, number, number] = [0, 0, 0];
  const binWidth = sampleRate / (frequencies.length * 2);
  const ranges = [
    [45, 250],
    [250, 2400],
    [2400, 12000],
  ];
  for (let band = 0; band < 3; band += 1) {
    const [low, high] = ranges[band]!;
    let energy = 0;
    for (
      let i = Math.max(1, Math.ceil(low / binWidth));
      i <= Math.min(frequencies.length - 1, Math.floor(high / binWidth));
      i += 1
    ) {
      energy += frequencies[i]! ** 2;
    }
    bands[band] = Math.min(1, Math.sqrt(energy) / 180);
  }
  return { level: Math.min(1, rms * 4), bands };
}

export function readOrbAudio(analyser: AnalyserNode): OrbAudioFrame {
  const wave = new Uint8Array(analyser.fftSize);
  const frequencies = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(wave);
  analyser.getByteFrequencyData(frequencies);
  return orbAudioFrame(wave, frequencies, analyser.context.sampleRate);
}

export function openMicrophoneAnalyser(stream: MediaStream): {
  analyser: AnalyserNode;
  close: () => Promise<void>;
} {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  // No connection to the destination: the microphone must not play through speakers.
  source.connect(analyser);
  return {
    analyser,
    async close() {
      source.disconnect();
      analyser.disconnect();
      await context.close();
    },
  };
}
