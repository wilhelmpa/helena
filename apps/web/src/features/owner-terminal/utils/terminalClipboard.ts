// Copy and paste for the browser terminals, and no "Leave site?" from them: wetty
// (xterm.js) in a same-origin frame, usually with tmux inside (owner, 2026-09-24: "ich muss
// copy paste können im Terminal").
//
// - Copying: text marked with the mouse is copied when the button comes up. tmux marks
//   it (mouse on) and hands it over as an OSC 52 sequence; with Shift held the terminal
//   marks it itself. Ctrl+C with a marking copies instead of interrupting, and
//   Ctrl+Shift+C / Cmd+C copy as well.
// - Pasting: Ctrl+V, Ctrl+Shift+V and Cmd+V leave the key to the browser, whose paste
//   event xterm already turns into input. That works over plain http as well, where no
//   script may read the clipboard.
//
// navigator.clipboard exists only in a secure context; over plain http the frame gets
// a writing-only stand-in backed by execCommand, which still works inside the mouse
// press or key press that asked for it (see @/utils/clipboard).

interface Disposable {
  dispose(): void;
}

interface TerminalLike {
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  focus(): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  parser: {
    registerOscHandler(ident: number, callback: (data: string) => boolean): Disposable;
  };
}

type TerminalWindow = Window & { wetty_term?: TerminalLike };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Reads the "Pc;Pd" of an OSC 52 sequence: the text to copy, or null for a query or
// anything that is not text.
export function textFromOsc52(data: string): string | null {
  const separator = data.indexOf(';');
  if (separator < 0) return null;
  const payload = data.slice(separator + 1);
  if (payload === '' || payload === '?') return null;
  try {
    const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export type ClipboardKeyAction = 'copy' | 'paste' | null;

// Which clipboard action a key press asks for. Ctrl+C copies only while something is
// marked; without a marking it stays the interrupt it always was.
export function clipboardKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  hasSelection: boolean,
  mac = isMac,
): ClipboardKeyAction {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key !== 'c' && key !== 'v') return null;
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!command) return null;
  if (key === 'v') return 'paste';
  if (event.shiftKey || mac) return 'copy';
  return hasSelection ? 'copy' : null;
}

function copyInFrame(win: TerminalWindow, term: TerminalLike, text: string): boolean {
  const doc = win.document;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  try {
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    term.focus();
  }
}

// Wires one terminal frame up and returns the clean-up. wetty builds a new terminal on
// every reconnect, so the frame is checked for a new one every second.
export function attachTerminalClipboard(
  frame: HTMLIFrameElement,
  onCopied: () => void,
): () => void {
  const attached = new WeakSet<TerminalLike>();
  const quieted = new WeakSet<Window>();
  const disposables: Disposable[] = [];

  function copy(win: TerminalWindow, term: TerminalLike, text: string) {
    if (!text) return;
    const secure = win.navigator.clipboard as (Clipboard & { helenaFallback?: true }) | undefined;
    if (secure?.writeText && !secure.helenaFallback) {
      secure.writeText(text).then(onCopied, () => {
        if (copyInFrame(win, term, text)) onCopied();
      });
      return;
    }
    if (copyInFrame(win, term, text)) onCopied();
  }

  function attach() {
    let win: TerminalWindow | null;
    try {
      win = frame.contentWindow as TerminalWindow | null;
      if (!win?.document) return;
    } catch {
      return; // another origin
    }
    const term = win.wetty_term;
    if (!term || attached.has(term)) return;
    attached.add(term);
    const frameWindow = win;

    // wetty asks "Leave site?" before its page unloads, so reloading or leaving Helena asked
    // too. The session lives on in tmux, so nothing is lost: a capture listener at the
    // window runs before wetty's own and ends the event there.
    if (!quieted.has(frameWindow)) {
      quieted.add(frameWindow);
      frameWindow.addEventListener(
        'beforeunload',
        (event) => event.stopImmediatePropagation(),
        true,
      );
    }

    // wetty copies a marking on mouse-up through navigator.clipboard, which plain http
    // does not have: the call threw and nothing was copied.
    if (typeof frameWindow.navigator.clipboard?.writeText !== 'function') {
      Object.defineProperty(frameWindow.navigator, 'clipboard', {
        configurable: true,
        value: {
          helenaFallback: true,
          writeText: async (text: string) => {
            if (!copyInFrame(frameWindow, term, text)) throw new Error('copy refused');
            if (text) onCopied();
          },
        },
      });
    }

    term.attachCustomKeyEventHandler((event) => {
      const action = clipboardKeyAction(event, term.hasSelection());
      if (action === 'paste') return false; // the browser pastes, xterm sends it
      if (action !== 'copy') return true;
      if (event.type === 'keydown') {
        event.preventDefault();
        copy(frameWindow, term, term.getSelection());
        if (!event.shiftKey && !event.metaKey) term.clearSelection();
      }
      return false;
    });

    disposables.push(
      term.parser.registerOscHandler(52, (data) => {
        const text = textFromOsc52(data);
        if (text) copy(frameWindow, term, text);
        return true;
      }),
    );
  }

  attach();
  frame.addEventListener('load', attach);
  const timer = window.setInterval(attach, 1000);
  return () => {
    window.clearInterval(timer);
    frame.removeEventListener('load', attach);
    for (const disposable of disposables) disposable.dispose();
  };
}
