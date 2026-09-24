'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { copyText } from '@/utils/clipboard';

// A copyable command or snippet. Shared: the MCP connection guide, the post-upgrade
// screen and the approval requests show one.
export default function CodeBlock({ code }: { code: string }) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await copyText(code);
    setCopied(true);
    toast.success(t('copied'));
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    // The copy button sits beside the snippet, not over it, so a long line scrolls under
    // nothing. The snippet stays left to right in a mirrored page; the button follows
    // the interface and moves to the other side.
    <div className="flex min-w-0 items-start gap-1 rounded-md border border-sidebar-border bg-background">
      <pre className="min-w-0 flex-1 overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code dir="ltr" className="block text-start">
          {code}
        </code>
      </pre>
      <button
        type="button"
        aria-label={t('copy')}
        onClick={copy}
        className="m-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
