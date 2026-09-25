// Copies the files the conversation mode's voice detector loads at run time into public/voice/,
// so Helena serves them itself (no CDN): Silero VAD v5 and the audio worklet of
// @ricky0123/vad-web (ISC; the model MIT), and ONNX Runtime Web's WebAssembly build (MIT) that
// runs it — the very version vad-web imports, so the JavaScript bundled by Next and the .wasm
// always match. Run before `next build` and `next dev` (package.json); the folder is ignored by
// git. Decision: docs/helena-decisions/voice.md.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(web, 'public', 'voice');
const require = createRequire(join(web, 'package.json'));
const vad = dirname(require.resolve('@ricky0123/vad-web/package.json'));
const fromVad = createRequire(join(vad, 'package.json'));

const files = [
  join(vad, 'dist', 'vad.worklet.bundle.min.js'),
  join(vad, 'dist', 'silero_vad_v5.onnx'),
  fromVad.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs'),
  fromVad.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'),
];

mkdirSync(target, { recursive: true });
for (const file of files) {
  const out = join(target, file.split('/').pop());
  let same = false;
  try {
    const [from, to] = [statSync(file), statSync(out)];
    same = from.size === to.size && from.mtimeMs <= to.mtimeMs;
  } catch {
    // not copied yet
  }
  if (!same) copyFileSync(file, out);
}
console.log(`voice assets: ${files.length} files in public/voice`);
