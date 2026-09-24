'use client';

import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { McpSignInStart } from '@/lib/api/endpoints/access';
import { useFinishMcpSignIn, useStartMcpSignIn } from '@/services/access.service';
import { copyText } from '@/utils/clipboard';

// Connecting an MCP server that signs in with OAuth: Helena discovers the server,
// registers itself as a client and gives the address to sign in at; the owner brings back
// the address the browser ended on. A server of the MCP library then names the connection
// as its Authorization header.
export function McpOAuthDialog({
  teamId,
  again,
  onClose,
}: {
  teamId: number;
  // Signing in an existing connection again.
  again?: { id: number; label: string };
  onClose: () => void;
}) {
  const t = useTranslations('access.mcp');
  const tSignIn = useTranslations('access.signIn');
  const tCommon = useTranslations('common');
  const [label, setLabel] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [scope, setScope] = useState('');
  const [started, setStarted] = useState<McpSignInStart | null>(null);
  const [pasted, setPasted] = useState('');
  const start = useStartMcpSignIn(teamId);
  const finish = useFinishMcpSignIn(teamId);

  async function begin() {
    try {
      const result = await start.mutateAsync(
        again ? { id: again.id } : { label, serverUrl, scope: scope.trim() || null },
      );
      if (result.mode === 'connected') {
        toast.success(t('connected'));
        onClose();
        return;
      }
      setStarted(result);
    } catch {
      // Toasted by the request layer.
    }
  }

  async function complete() {
    if (!started) return;
    try {
      await finish.mutateAsync({ id: started.id, redirectUrl: pasted.trim() });
      toast.success(t('connected'));
      onClose();
    } catch {
      // Toasted; the owner can paste again.
    }
  }

  return (
    <Modal title={again ? t('againTitle', { name: again.label }) : t('title')} onClose={onClose}>
      {started?.url ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {started.mode === 'paste' ? tSignIn('pasteStep') : tSignIn('callbackStep')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={started.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                {t('open')}
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void copyText(started.url!).then(() => toast.success(tSignIn('linkCopied')))
              }
            >
              <Copy />
              {tSignIn('copyLink')}
            </Button>
          </div>
          {started.mode === 'paste' && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (pasted.trim()) void complete();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-redirect">{tSignIn('redirect')}</Label>
                <Textarea
                  id="mcp-redirect"
                  rows={3}
                  dir="ltr"
                  className="font-mono text-xs"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  {tCommon('cancel')}
                </Button>
                <Button type="submit" disabled={!pasted.trim() || finish.isPending}>
                  {tSignIn('finish')}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (again || serverUrl.trim()) void begin();
          }}
        >
          {!again && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-url">{t('serverUrl')}</Label>
                <Input
                  id="mcp-url"
                  dir="ltr"
                  placeholder="https://mcp.example.com/mcp"
                  value={serverUrl}
                  onChange={(event) => setServerUrl(event.target.value)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-label">{t('label')}</Label>
                  <Input
                    id="mcp-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mcp-scope">{t('scope')}</Label>
                  <Input
                    id="mcp-scope"
                    dir="ltr"
                    value={scope}
                    onChange={(event) => setScope(event.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('hint')}</p>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={(!again && !serverUrl.trim()) || start.isPending}>
              {tSignIn('start')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
