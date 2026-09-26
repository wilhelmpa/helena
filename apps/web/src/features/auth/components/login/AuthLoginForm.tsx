'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import AuthFormHeader from '../AuthFormHeader';
import AuthPersonPicker from './AuthPersonPicker';
import AuthLoginAlternatives from './AuthLoginAlternatives';
import AuthLoginPasswordFields from './AuthLoginPasswordFields';
import AuthMessagePanel from '../AuthMessagePanel';
import AuthUnconfirmedNotice from './AuthUnconfirmedNotice';
import {
  EmailNotConfirmedError,
  isEmailAddress,
  resendVerificationEmail,
  sendMagicLink,
  signInWithPassword,
  signInWithGoogle,
  signInWithOidc,
  signInWithPasskey,
  verifySignInCode,
} from '../../services/auth.service';
import { useAuthAction } from '../../hooks/useAuthAction';
import { useAuthConfig } from '@/services/authConfig.service';
import { useRedirectError } from '../../hooks/useRedirectError';
import { authCallbackPath } from '../../utils/authCallbackPath';

// How the visitor is signing in. The screen holds one method at a time: with a
// password, or with a link mailed to the address. Passkeys stay available in both,
// since they need neither field.
type Method = 'password' | 'link';

export default function AuthLoginForm({
  edgeSignInAvailable = false,
}: {
  edgeSignInAvailable?: boolean;
}) {
  const t = useTranslations('auth');
  const [method, setMethod] = useState<Method>('password');
  // With a password this is either an address or a username; a sign-in link can only
  // go to an address.
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // The password was right and the account has an authenticator app: the screen now
  // asks for its code instead.
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState('');
  // The address a sign-in link went to. Set on success, and it replaces the form:
  // there is nothing left to do on this screen until the inbox is opened.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  // A confirmation email was re-sent. Inline, because the sign-in form stays useful.
  const [resent, setResent] = useState(false);
  // The last sign-in attempt was held back by the verification gate, so this screen
  // offers the confirmation link again.
  const [unconfirmed, setUnconfirmed] = useState(false);
  const { error, pending, setError, run } = useAuthAction();
  const authConfig = useAuthConfig();
  // An instance that runs entirely off its identity provider offers no form at all,
  // only the buttons below it.
  const passwordEnabled = authConfig?.emailPassword !== false;
  const params = useSearchParams();
  const justReset = params.get('reset') === '1';
  const switching = params.get('switch') === '1';
  // `apiFailure` in lib/api/core/client.ts sends the browser here with ?expired=1 after the API
  // refused the session, so the screen can say why the user is back on it.
  const sessionExpired = params.get('expired') === '1';
  // A Google sign-in or a confirmation link that could not complete comes back here
  // as a redirect rather than as a rejected promise, so its reason arrives in the
  // query string.
  const redirectErrorMessage = useRedirectError();
  const redirectError = redirectErrorMessage(params.get('error'), params.get('error_description'));
  const callbackPath = authCallbackPath(params.get('callbackURL'));
  const oidcOnly =
    authConfig?.oidc === true && authConfig.emailPassword === false && authConfig.google === false;
  const autoOidcStarted = useRef(false);
  // The confirmation link carries ?verified=1 and adds ?error=… when it failed, so
  // the success line only stands while there is no error next to it.
  const justVerified = params.get('verified') === '1' && !redirectError;

  useEffect(() => {
    if (
      !oidcOnly ||
      switching ||
      autoOidcStarted.current ||
      params.has('error') ||
      params.has('error_description')
    ) {
      return;
    }
    autoOidcStarted.current = true;
    void run(() => signInWithOidc(callbackPath), { redirect: false });
  }, [callbackPath, oidcOnly, params, run, switching]);

  function switchTo(next: Method) {
    setMethod(next);
    setError(null);
    setUnconfirmed(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setUnconfirmed(false);
    setResent(false);
    if (method === 'link') {
      run(
        async () => {
          await sendMagicLink(identifier);
          setLinkSentTo(identifier);
        },
        { redirect: false },
      );
      return;
    }
    if (codeStep) {
      run(() => verifySignInCode(code));
      return;
    }
    run(async () => {
      try {
        const outcome = await signInWithPassword({ identifier, password });
        if (outcome === 'code-needed') {
          setCodeStep(true);
          return 'stay';
        }
      } catch (err) {
        if (err instanceof EmailNotConfirmedError) setUnconfirmed(true);
        throw err;
      }
    });
  }

  if (linkSentTo) {
    return (
      <AuthMessagePanel
        title={t('login.linkSentTitle')}
        description={t('login.linkSentDescription', { email: linkSentTo })}
        footer={
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => {
              setLinkSentTo(null);
              switchTo('password');
            }}
          >
            {t('login.backToSignIn')}
          </button>
        }
      />
    );
  }

  const signingInWithLink = method === 'link';

  function subtitle() {
    if (codeStep) return t('login.subtitleCode');
    if (sessionExpired) return t('login.subtitleExpired');
    if (justVerified) return t('login.subtitleVerified');
    if (justReset) return t('login.subtitleReset');
    if (!passwordEnabled) return t('login.subtitleSso');
    if (signingInWithLink) return t('login.subtitleLink');
    return t('login.subtitlePassword');
  }

  function submitLabel() {
    if (codeStep) return pending ? t('login.verifyCodePending') : t('login.verifyCode');
    if (signingInWithLink) return pending ? t('login.sendLinkPending') : t('login.sendLink');
    return pending ? t('login.submitPending') : t('login.submit');
  }

  return (
    <form onSubmit={onSubmit} className="p-6 md:p-8">
      <FieldGroup>
        <AuthFormHeader title={t('login.title')} description={subtitle()} />
        {!codeStep && (
          <AuthPersonPicker
            onSelect={(value) => {
              setIdentifier(value);
              setPassword('');
              setError(null);
            }}
          />
        )}
        {!codeStep && edgeSignInAvailable && (
          <Button type="button" variant="outline" asChild>
            <Link href={`/login?continue=1&callbackURL=${encodeURIComponent(callbackPath)}`}>
              {t('login.continueAccess')}
            </Link>
          </Button>
        )}

        {codeStep && (
          <Field>
            <FieldLabel htmlFor="code">{t('login.codeLabel')}</FieldLabel>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              disabled={pending}
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
        )}

        {passwordEnabled && !codeStep && (
          <AuthLoginPasswordFields
            signingInWithLink={signingInWithLink}
            identifier={identifier}
            password={password}
            pending={pending}
            onIdentifierChange={setIdentifier}
            onPasswordChange={setPassword}
          />
        )}

        {(error || redirectError) && <FieldError>{error ?? redirectError}</FieldError>}

        {unconfirmed && (
          <AuthUnconfirmedNotice
            resent={resent}
            pending={pending}
            canResend={isEmailAddress(identifier)}
            onResend={() =>
              run(
                async () => {
                  await resendVerificationEmail(identifier);
                  setResent(true);
                },
                { redirect: false },
              )
            }
          />
        )}

        {passwordEnabled && (
          <>
            <Field>
              <Button type="submit" disabled={pending}>
                {submitLabel()}
              </Button>
            </Field>

            {!codeStep && <FieldSeparator>{t('login.or')}</FieldSeparator>}
          </>
        )}

        {codeStep && (
          <FieldDescription className="text-center">
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setCodeStep(false);
                setCode('');
                setError(null);
              }}
            >
              {t('login.backToSignIn')}
            </button>
          </FieldDescription>
        )}

        {!codeStep && (
          <AuthLoginAlternatives
            signingInWithLink={signingInWithLink}
            pending={pending}
            onToggleMethod={() => switchTo(signingInWithLink ? 'password' : 'link')}
            onOidc={() => run(() => signInWithOidc(callbackPath), { redirect: false })}
            onGoogle={() => run(signInWithGoogle, { redirect: false })}
            onPasskey={() => run(signInWithPasskey, { fallback: t('errors.passkey') })}
          />
        )}

        {/* Only when anyone can register with a password. An invite-only instance
            hands out links directly, a closed one has nowhere to send the visitor,
            and with single sign-on the identity provider makes the account. */}
        {authConfig?.registration === 'open' && passwordEnabled && !codeStep && (
          <FieldDescription className="text-center">
            {t('login.noAccount')}{' '}
            <Link href="/register" className="underline underline-offset-4">
              {t('login.signUp')}
            </Link>
          </FieldDescription>
        )}
      </FieldGroup>
    </form>
  );
}
