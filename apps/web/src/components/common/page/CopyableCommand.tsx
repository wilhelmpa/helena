'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyText } from '@/utils/clipboard';

// A command the owner copies into the owner terminal (sign a runtime in, sign Hermes in
// again): shown whole, left to right in every locale, with a copy button. Helena never runs it.
export default function CopyableCommand({
  command,
  copyLabel,
  copiedLabel,
}: {
  command: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The browser can refuse the clipboard; the command can still be selected.
    }
  }
  return (
    <div className="flex items-start gap-2">
      <code
        dir="ltr"
        className="min-w-0 flex-1 rounded-md border border-sidebar-border bg-background px-2 py-1.5 font-mono text-xs break-all"
      >
        {command}
      </code>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={() => void copy()}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
