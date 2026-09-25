// Recordings for the voice tests.

// A WAV header plus `seconds` of silence, as the browser's encoder writes it.
export function wav(
  seconds: number,
  { rate = 16000, channels = 1, bits = 16, format = 1 } = {},
): Uint8Array {
  const frame = channels * (bits / 8);
  const dataBytes = Math.round(seconds * rate) * frame;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string) =>
    [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * frame, true);
  view.setUint16(32, frame, true);
  view.setUint16(34, bits, true);
  put(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}
