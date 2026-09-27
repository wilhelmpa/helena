// Browser-only analysis for the large chat orb. No samples leave this module.
export interface OrbAudioFrame {
  level: number;
  bands: [number, number, number];
}

export function orbAudioFrame(wave: Uint8Array, frequencies: Uint8Array): OrbAudioFrame {
  let energy = 0;
  for (const sample of wave) {
    const centered = (sample - 128) / 128;
    energy += centered * centered;
  }
  const rms = wave.length ? Math.sqrt(energy / wave.length) : 0;
  const bands: [number, number, number] = [0, 0, 0];
  // The first quarter of the FFT covers most of the speech spectrum.
  const width = Math.max(1, Math.floor(frequencies.length / 12));
  for (let band = 0; band < 3; band += 1) {
    let sum = 0;
    for (let i = band * width; i < (band + 1) * width && i < frequencies.length; i += 1)
      sum += frequencies[i]!;
    bands[band] = Math.min(1, sum / (width * 180));
  }
  return { level: Math.min(1, rms * 4), bands };
}

export function readOrbAudio(analyser: AnalyserNode): OrbAudioFrame {
  const wave = new Uint8Array(analyser.fftSize);
  const frequencies = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(wave);
  analyser.getByteFrequencyData(frequencies);
  return orbAudioFrame(wave, frequencies);
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
