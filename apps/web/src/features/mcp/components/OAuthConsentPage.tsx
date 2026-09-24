'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { API_URL } from '@/lib/api/core/client';
import AuthFrame from '@/components/common/page/AuthFrame';
import HelenaMark from '@/components/brand/HelenaMark';
import { Button } from '@/components/ui/button';

type ConsentResponse = { redirectURI?: string; message?: string };

// Where an MCP client (Claude, Codex, an editor) asks to act with the member's Helena
// account: in the same frame as sign-in (AuthFrame), with the mark, the request and
// the two ways to answer it.
export default function OAuthConsentPage() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <ConsentForm />
      </Suspense>
    </AuthFrame>
  );
}

function ConsentForm() {
  const t = useTranslations('mcp');
  const searchParams = useSearchParams();
  const consentCode = searchParams.get('consent_code');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide(accept: boolean) {
    if (!consentCode || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/auth/oauth2/consent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const result = (await response.json()) as ConsentResponse;
      if (!response.ok || !result.redirectURI)
        throw new Error(result.message || t('oauth.consent.failed'));
      window.location.assign(result.redirectURI);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('oauth.consent.failed'));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col items-center gap-1 text-center">
        <HelenaMark className="mb-3 size-12 md:hidden" />
        <h1 className="text-2xl font-semibold">{t('oauth.consent.title')}</h1>
        <p className="text-xs text-balance text-muted-foreground">
          {t('oauth.consent.description')}
        </p>
      </div>
      {!consentCode ? (
        <p className="text-center text-sm text-destructive">{t('oauth.consent.missingCode')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
            {t('oauth.consent.cancel')}
          </Button>
          <Button disabled={pending} onClick={() => decide(true)}>
            {pending ? t('oauth.consent.pending') : t('oauth.consent.authorize')}
          </Button>
        </div>
      )}
      {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
