'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsRow from '@/components/common/page/SettingsRow';
import StatusBadge from '@/components/common/page/StatusBadge';
import PageSaveAction from '@/components/common/page/PageSaveAction';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { EdgeAccessSettings } from '@/lib/api/endpoints/security';
import { useUpdateEdgeAccess } from '../services/security.service';

const lines = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);

// The edge sign-in in front of the tunnel entry (Cloudflare Access): the team domain and
// the Application Audience tag Helena checks every request from the internet against,
// and optionally the identities it admits. None of these is a secret; the tunnel token
// and the DNS token never pass through Helena (the owner enters them on the server).
// Below them the two switches that build on it: the Cloudflare sign-in (an Access login of
// an allowed identity is the Helena sign-in) and the switch to the home network's own
// origin at home (docs/helena-decisions/security-hardening.md §4.8, §5).
export default function EdgeAccessForm({ settings }: { settings: EdgeAccessSettings }) {
  const t = useTranslations('serverSecurity.edge');
  const update = useUpdateEdgeAccess();
  const [teamDomain, setTeamDomain] = useState(settings.teamDomain);
  const [audiences, setAudiences] = useState(settings.audiences.join('\n'));
  const [allowedEmails, setAllowedEmails] = useState(settings.allowedEmails.join('\n'));
  const [signIn, setSignIn] = useState(settings.signIn);
  const [homeAutoConnect, setHomeAutoConnect] = useState(settings.homeAutoConnect);

  const dirty =
    teamDomain.trim() !== settings.teamDomain ||
    lines(audiences).join('\n') !== settings.audiences.join('\n') ||
    lines(allowedEmails).join('\n') !== settings.allowedEmails.join('\n') ||
    signIn !== settings.signIn ||
    homeAutoConnect !== settings.homeAutoConnect;

  // The sign-in needs the provider and an explicit list of identities (the api refuses it
  // otherwise); it can always be switched off.
  const signInReady =
    teamDomain.trim() !== '' && lines(audiences).length > 0 && lines(allowedEmails).length > 0;
  const signInNote = !signInReady
    ? t('signInNeedsSetup')
    : !settings.entryProof
      ? t('signInNeedsProof')
      : undefined;

  async function save() {
    try {
      // The parent keys this form on the saved settings, so it starts over from what the
      // api stored (normalised) once the save lands.
      await update.mutateAsync({
        teamDomain: teamDomain.trim(),
        audiences: lines(audiences),
        allowedEmails: lines(allowedEmails),
        signIn,
        homeAutoConnect,
      });
      toast.success(t('saved'));
    } catch {
      // The api's reason (a malformed team domain or tag) arrives through the global
      // mutation error toast.
    }
  }

  return (
    <>
      <PageSaveAction onSave={() => void save()} disabled={!dirty} saving={update.isPending} />
      <SettingsCard className="space-y-4 p-4">
        <StatusBadge status={settings.configured ? 'success' : 'idle'}>
          {settings.configured ? t('configured') : t('notConfigured')}
        </StatusBadge>
        <div className="space-y-1.5 sm:max-w-md">
          <Label htmlFor="edge-team-domain">{t('teamDomain')}</Label>
          <Input
            id="edge-team-domain"
            value={teamDomain}
            onChange={(event) => setTeamDomain(event.target.value)}
            placeholder="volition.cloudflareaccess.com"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t('teamDomainHint')}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edge-audiences">{t('audiences')}</Label>
          <Textarea
            id="edge-audiences"
            value={audiences}
            onChange={(event) => setAudiences(event.target.value)}
            className="font-mono text-xs"
            rows={2}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t('audiencesHint')}</p>
        </div>
        <div className="space-y-1.5 sm:max-w-md">
          <Label htmlFor="edge-allowed">{t('allowedEmails')}</Label>
          <Textarea
            id="edge-allowed"
            value={allowedEmails}
            onChange={(event) => setAllowedEmails(event.target.value)}
            rows={2}
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t('allowedEmailsHint')}</p>
        </div>
      </SettingsCard>
      <SettingsCard className="mt-3 divide-y p-0">
        <SettingsRow
          title={t('signInTitle')}
          description={t('signInDescription')}
          note={signInNote}
          control={
            <Switch
              checked={signIn}
              onCheckedChange={setSignIn}
              disabled={!signIn && !signInReady}
            />
          }
        />
        <SettingsRow
          title={t('homeTitle')}
          description={
            settings.homeUrl
              ? t('homeDescription', { home: new URL(settings.homeUrl).host })
              : t('homeDescriptionGeneric')
          }
          note={settings.homeUrl ? undefined : t('homeNotSetUp')}
          control={
            <Switch
              checked={homeAutoConnect}
              onCheckedChange={setHomeAutoConnect}
              disabled={!settings.homeUrl && !homeAutoConnect}
            />
          }
        />
      </SettingsCard>
    </>
  );
}
