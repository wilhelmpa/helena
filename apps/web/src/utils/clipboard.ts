// Set once installClipboardFallback has put its stand-in in place (below).
let fallbackInstalled = false;

// navigator.clipboard exists only in a secure context (https or localhost). Over plain
// http on the LAN it is undefined, so copying falls back to a hidden textarea and
// execCommand, which still works inside the click that asked for it.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText && !fallbackInstalled) {
    await navigator.clipboard.writeText(text);
    return;
  }
  copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('The browser refused to copy');
  } finally {
    area.remove();
  }
}

// Reading has no such fallback: outside a secure context the browser offers no way in.
export async function readClipboardText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error('Reading the clipboard needs https');
  return navigator.clipboard.readText();
}

// Libraries copy through the standard Clipboard API (Streamdown's code and table buttons,
// for one) and give up where it is missing. On plain http this puts a writing-only
// Clipboard in its place, backed by the same execCommand fallback as copyText, so their
// buttons work too. Text only: a ClipboardItem without text/plain is refused the way a
// browser refuses a type it cannot write. Does nothing in a secure context, where the
// real API exists, and nothing on a second call.
export function installClipboardFallback(): void {
  if (typeof window === 'undefined' || fallbackInstalled) return;
  if (typeof navigator.clipboard?.writeText === 'function') return;
  fallbackInstalled = true;

  class TextClipboardItem {
    readonly types: string[];
    constructor(
      private readonly items: Record<string, Blob | string | PromiseLike<Blob | string>>,
    ) {
      this.types = Object.keys(items);
    }
    async getType(type: string): Promise<Blob> {
      const value = await this.items[type];
      if (value === undefined) throw new DOMException(`No ${type} data`, 'NotFoundError');
      return typeof value === 'string' ? new Blob([value], { type }) : value;
    }
  }

  const clipboard = {
    writeText: async (text: string) => copyWithExecCommand(text),
    write: async (items: TextClipboardItem[]) => {
      const item = items.find((candidate) => candidate.types.includes('text/plain'));
      if (!item) throw new DOMException('Only text can be copied here', 'NotAllowedError');
      copyWithExecCommand(await (await item.getType('text/plain')).text());
    },
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  if (!('ClipboardItem' in window)) {
    Object.defineProperty(window, 'ClipboardItem', {
      configurable: true,
      writable: true,
      value: TextClipboardItem,
    });
  }
}
