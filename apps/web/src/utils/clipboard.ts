// navigator.clipboard exists only in a secure context (https or localhost). Over plain
// http on the LAN it is undefined, so copying falls back to a hidden textarea and
// execCommand, which still works inside the click that asked for it.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
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
