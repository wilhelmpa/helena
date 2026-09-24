import { toast } from 'sonner';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The two notes the terminal clipboard shows: copied, or kept for the next copy key where
// the browser refused to copy on its own (see terminalClipboard.ts).
export function terminalClipboardToasts(text: {
  copied: string;
  pressToCopy: (keys: string) => string;
}) {
  return {
    copied: () => toast.success(text.copied, { id: 'terminal-copied', duration: 1500 }),
    pending: () =>
      toast(text.pressToCopy(isMac ? '⌘C' : 'Ctrl+Shift+C'), {
        id: 'terminal-copied',
        duration: 4000,
      }),
  };
}
