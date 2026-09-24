'use client';

import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GOOGLE_SERVICES,
  type GoogleAccount,
  type GoogleClient,
  type GoogleEngine,
  type GoogleService,
  type SignInStart,
} from '@/lib/api/endpoints/access';
import { useFinishGoogleSignIn, useStartGoogleSignIn } from '@/services/access.service';
import { useProjectsQuery } from '@/services/projects.service';
import { copyText } from '@/utils/clipboard';

export type SignInMode =
  | { kind: 'new' }
  | { kind: 'again'; account: GoogleAccount }
  | { kind: 'move'; account: GoogleAccount };

// Connecting a Google account without a browser on the server: Helena gives the address
// to sign in at, the owner signs in on any device, and brings back the address the
// browser ended on (a page on 127.0.0.1 that does not load). With a Web client on https
// Google returns to Helena itself instead.
export function SignInDialog({
  teamId,
  mode,
  clients,
  gogAvailable,
  onClose,
}: {
  teamId: number;
  mode: SignInMode;
  clients: GoogleClient[];
  gogAvailable: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('access.signIn');
  const tGoogle = useTranslations('access.google');
  const tCommon = useTranslations('common');
  const tCredentials = useTranslations('credentials');
  const projects = useProjectsQuery().data?.filter((project) => project.teamId === teamId);
  const account = mode.kind === 'new' ? null : mode.account;
  const [engine, setEngine] = useState<GoogleEngine>(
    mode.kind === 'again' ? mode.account.engine : 'helena',
  );
  const [clientId, setClientId] = useState<number | null>(
    account?.clientCredentialId ?? clients[0]?.id ?? null,
  );
  const [email, setEmail] = useState(account?.email ?? '');
  const [services, setServices] = useState<Set<GoogleService>>(
    () =>
      new Set(
        account
          ? account.services.filter((service) => service.enabled).map((service) => service.id)
          : GOOGLE_SERVICES,
      ),
  );
  const [projectId, setProjectId] = useState<number | null>(account?.projectId ?? null);
  const [removeFromGog, setRemoveFromGog] = useState(true);
  const [started, setStarted] = useState<SignInStart | null>(null);
  const [pasted, setPasted] = useState('');
  const start = useStartGoogleSignIn(teamId);
  const finish = useFinishGoogleSignIn(teamId);

  const title =
    mode.kind === 'new'
      ? t('title')
      : t(mode.kind === 'again' ? 'againTitle' : 'moveTitle', { email: mode.account.email });
  const needsClient = engine === 'helena' && clientId === null;
  const ready = services.size > 0 && !needsClient && (engine === 'helena' || email.includes('@'));

  async function begin() {
    try {
      setStarted(
        await start.mutateAsync({
          engine,
          clientCredentialId: engine === 'helena' ? (clientId ?? undefined) : undefined,
          email: email.trim() || undefined,
          services: [...services],
          projectId,
          accountId: account?.id,
          removeFromGog: mode.kind === 'move' ? removeFromGog : undefined,
        }),
      );
    } catch {
      // Toasted by the request layer.
    }
  }

  async function complete() {
    if (!started) return;
    try {
      const connected = await finish.mutateAsync({
        sessionId: started.sessionId,
        redirectUrl: pasted.trim(),
      });
      toast.success(t('connected', { email: connected.email }));
      onClose();
    } catch {
      // Toasted; the owner can paste again or start over.
    }
  }

  const toggle = (service: GoogleService, on: boolean) =>
    setServices((current) => {
      const next = new Set(current);
      if (on) next.add(service);
      else next.delete(service);
      return next;
    });

  return (
    <Modal title={title} onClose={onClose} wide>
      {started ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {started.mode === 'paste' ? t('pasteStep') : t('callbackStep')}
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
              onClick={() => void copyText(started.url).then(() => toast.success(t('linkCopied')))}
            >
              <Copy />
              {t('copyLink')}
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
                <Label htmlFor="google-redirect">{t('redirect')}</Label>
                <Textarea
                  id="google-redirect"
                  rows={3}
                  dir="ltr"
                  className="font-mono text-xs"
                  placeholder="http://127.0.0.1:53682/?state=…&code=…"
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
                  {t('finish')}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) void begin();
          }}
        >
          {gogAvailable && mode.kind === 'new' && (
            <div className="flex flex-col gap-1.5">
              <Label>{t('engine')}</Label>
              <Select value={engine} onValueChange={(value) => setEngine(value as GoogleEngine)}>
                <SelectTrigger aria-label={t('engine')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="helena">{tGoogle('engine.helena')}</SelectItem>
                  <SelectItem value="gog">{tGoogle('engine.gog')}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{tGoogle(`engineHint.${engine}`)}</p>
            </div>
          )}
          {engine === 'helena' && (
            <div className="flex flex-col gap-1.5">
              <Label>{t('client')}</Label>
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noClient')}</p>
              ) : (
                <Select
                  value={clientId === null ? '' : String(clientId)}
                  onValueChange={(value) => setClientId(Number(value))}
                >
                  <SelectTrigger aria-label={t('client')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={String(client.id)}>
                        {client.label} · {tGoogle(`clientType.${client.type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {mode.kind === 'new' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="google-email">{t('email')}</Label>
                <Input
                  id="google-email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('scope')}</Label>
                <Select
                  value={projectId === null ? 'team' : String(projectId)}
                  onValueChange={(value) => setProjectId(value === 'team' ? null : Number(value))}
                >
                  <SelectTrigger aria-label={t('scope')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="team">{tCredentials('scopeTeam')}</SelectItem>
                    {(projects ?? []).map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t('services')}
            </legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              {GOOGLE_SERVICES.map((service) => (
                <label
                  key={service}
                  className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={services.has(service)}
                    onCheckedChange={(on) => toggle(service, on === true)}
                  />
                  {tGoogle(`services.${service}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {mode.kind === 'move' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={removeFromGog}
                onCheckedChange={(on) => setRemoveFromGog(on === true)}
              />
              {t('removeFromGog')}
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!ready || start.isPending}>
              {t('start')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
