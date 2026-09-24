// Plays the live view's H.264 video: MP4 fragments of one frame each, after an initialization
// segment. WebCodecs decodes each frame onto a canvas as it arrives; it exists only in a
// secure context (HTTPS or localhost). Elsewhere, such as Plan over plain HTTP on the LAN,
// Media Source Extensions play the fragments in a video element.

export interface LiveVideo {
  push: (fragment: Uint8Array, keyframe: boolean) => void;
  close: () => void;
}

export type VideoPlayback = 'webcodecs' | 'mse';

// The frame duration the fragments carry; a decoder only needs the order.
const FRAME_US = 16_667;
// A video element within this of the newest buffered frame plays at its ordinary rate.
const LIVE_EDGE_S = 0.03;
// Between LIVE_EDGE_S and this, playing a little faster closes the gap without the jump (and
// the brief re-decode from the last keyframe it costs) a seek would; past it, behind by this
// much is assumed to be a stall or a reconnect, not routine drift, and worth the jump.
const CATCH_UP_RATE = 1.15;
const MAX_LAG_S = 0.25;
// Played video older than this is removed from the video element's buffer.
const KEEP_S = 5;

export function videoPlayback(): VideoPlayback | null {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext && 'VideoDecoder' in window) return 'webcodecs';
  if ('MediaSource' in window) return 'mse';
  return null;
}

// The payload of the first box of a type, searched from an offset, inside an MP4 buffer.
function findBox(data: Uint8Array, type: string, from = 0): Uint8Array | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const code = [...type].map((character) => character.charCodeAt(0));
  for (let offset = from; offset + 8 <= data.length; offset++) {
    if (code.every((byte, index) => data[offset + 4 + index] === byte)) {
      const size = view.getUint32(offset);
      if (size >= 8 && offset + size <= data.length) {
        return data.subarray(offset + 8, offset + size);
      }
    }
  }
  return null;
}

// The decoder configuration record (avcC) of an initialization segment.
export function avcDescription(init: Uint8Array): Uint8Array {
  const description = findBox(init, 'avcC');
  if (!description) throw new Error('No H.264 configuration');
  return description;
}

// The frame of a fragment: the payload of its mdat box, after the moof box.
export function fragmentSample(fragment: Uint8Array): Uint8Array {
  const moofSize = new DataView(fragment.buffer, fragment.byteOffset, 4).getUint32(0);
  const sample = findBox(fragment, 'mdat', moofSize);
  if (!sample) throw new Error('No frame in the fragment');
  return sample;
}

export function webCodecsVideo(
  canvas: HTMLCanvasElement,
  codec: string,
  init: Uint8Array,
  onFrame: () => void,
): LiveVideo {
  const context = canvas.getContext('2d');
  const decoder = new VideoDecoder({
    output(frame) {
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
      context?.drawImage(frame, 0, 0);
      frame.close();
      onFrame();
    },
    error() {
      // The next initialization segment starts a new decoder.
    },
  });
  decoder.configure({ codec, description: avcDescription(init), optimizeForLatency: true });
  let frames = 0;
  return {
    push(fragment, keyframe) {
      if (decoder.state !== 'configured') return;
      decoder.decode(
        new EncodedVideoChunk({
          type: keyframe ? 'key' : 'delta',
          timestamp: frames++ * FRAME_US,
          data: fragmentSample(fragment),
        }),
      );
    },
    close() {
      if (decoder.state !== 'closed') decoder.close();
    },
  };
}

// Appends each fragment in order, ignoring the timestamps, and keeps the element at the newest
// frame: a small lag behind it plays back a little faster to close the gap smoothly, a larger
// one (a stall, a reconnect) jumps there outright, and it drops what it has already played.
export function mseVideo(
  element: HTMLVideoElement,
  codec: string,
  init: Uint8Array,
  onFrame: () => void,
): LiveVideo {
  const source = new MediaSource();
  const url = URL.createObjectURL(source);
  const queue: Uint8Array[] = [init];
  let buffer: SourceBuffer | null = null;
  let closed = false;

  // Checked on every rendered frame, not only when the fragment queue runs dry: fragments can
  // arrive steadily enough that it rarely does, and the gap this closes is measured in tens of
  // milliseconds, so it needs watching that often to still do its job.
  const keepLive = () => {
    const ranges = element.buffered;
    if (!buffer || ranges.length === 0) return;
    const end = ranges.end(ranges.length - 1);
    const lag = end - element.currentTime;
    if (lag > MAX_LAG_S) {
      element.currentTime = end;
      element.playbackRate = 1;
    } else {
      element.playbackRate = lag > LIVE_EDGE_S ? CATCH_UP_RATE : 1;
    }
    const start = ranges.start(0);
    if (queue.length === 0 && element.currentTime - start > 2 * KEEP_S) {
      buffer.remove(start, element.currentTime - KEEP_S);
    }
  };
  const append = () => {
    if (closed || !buffer || buffer.updating) return;
    const next = queue.shift();
    if (next) buffer.appendBuffer(next as Uint8Array<ArrayBuffer>);
  };
  source.addEventListener(
    'sourceopen',
    () => {
      buffer = source.addSourceBuffer(`video/mp4; codecs="${codec}"`);
      buffer.mode = 'sequence';
      buffer.addEventListener('updateend', append);
      append();
    },
    { once: true },
  );
  element.src = url;
  void element.play().catch(() => {});
  const watch = () => {
    if (closed) return;
    keepLive();
    onFrame();
    element.requestVideoFrameCallback(watch);
  };
  element.requestVideoFrameCallback(watch);
  return {
    push(fragment) {
      queue.push(fragment);
      append();
    },
    close() {
      closed = true;
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(url);
    },
  };
}
