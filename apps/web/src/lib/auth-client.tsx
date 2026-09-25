import { createContext, useContext, type ReactNode } from 'react';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import {
  genericOAuthClient,
  magicLinkClient,
  twoFactorClient,
  usernameClient,
} from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { apiKeyClient } from '@better-auth/api-key/client';
import { API_URL, markSigningOut } from '@/lib/api/core/client';

// The better-auth handler lives on the backend (Elysia), so baseURL is the API origin.
// inferAdditionalFields declares the custom `role` column added in @repo/auth so the
// session user is typed with it (the web app never imports server packages).
export const authClient = createAuthClient({
  baseURL: `${API_URL.replace(/\/+$/, '')}/api/auth`,
  plugins: [
    inferAdditionalFields({
      user: {
        // Server-assigned (see @repo/auth) — not part of the sign-up input.
        role: { type: 'string', input: false },
      },
    }),
    // WebAuthn passkeys: signIn.passkey() and passkey.addPasskey().
    passkeyClient(),
    // Personal API keys: apiKey.create()/list()/delete().
    apiKeyClient(),
    // Sign-in by emailed link: signIn.magicLink(). Whether it is offered is an
    // instance setting the sign-in screen reads from /auth-config; the server
    // refuses to send when it is off.
    magicLinkClient(),
    // The instance's own OIDC provider: signIn.oauth2(). One provider, configured in
    // god mode; whether it is offered comes from /auth-config.
    genericOAuthClient(),
    // Usernames: signIn.username(). The sign-in screen sends its one field here when
    // what was typed is not an address, and the plugin types `username` on the
    // session user so the profile page can show it.
    usernameClient(),
    // TOTP (Account -> Security): twoFactor.enable()/getTotpUri()/verifyTotp()/disable().
    // Once set up, a password sign-in asks for the code as its second step (the login
    // form's code step, verifySignInCode); the owner terminal's step-up checks it too.
    // The LAN auto sign-in and passkeys need no code.
    twoFactorClient(),
  ],
});

export const {
  signIn,
  signUp,
  // Not exported: every reader goes through useSession below, one shared
  // subscription instead of one per caller (see the comment on SessionProvider).
  useSession: useBetterAuthSession,
  getSession,
  passkey,
  apiKey,
  twoFactor,
  updateUser,
  changePassword,
  // Password reset by email: request sends the link, reset consumes its token.
  requestPasswordReset,
  resetPassword,
  // Resends the address confirmation link.
  sendVerificationEmail,
  // Connected sign-in providers, managed on the account's Accounts page.
  listAccounts,
  linkSocial,
  unlinkAccount,
} = authClient;

// Sign out through this wrapper rather than through the client: it tells lib/api
// that the 401s the dropped session causes are expected, so they do not send the
// browser to the expired-session screen.
export async function signOut() {
  markSigningOut();
  return authClient.signOut();
}

export type SessionUser = typeof authClient.$Infer.Session.user;

type SessionState = ReturnType<typeof useBetterAuthSession>;

const SessionContext = createContext<SessionState | null>(null);

// The one better-auth session subscription for the whole app. Every reader used to
// call the client's own useSession() directly — the sidebar, the header, every page,
// every list row with an assignee or a watcher — which is one subscriber per
// component rather than one per app: a page that mounts many of them at once (the
// chat workspace, a board full of issue cards) turned into a burst of duplicate
// GET /auth/get-session requests on load. Mounted once in Providers; everything below
// reads the same fetch through useSession.
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useBetterAuthSession();
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within SessionProvider');
  return session;
}
