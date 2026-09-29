import { runtimeEnv } from './runtimeEnv';

// The product name shown to users: the login panel, the passkey label in the OS
// picker, and the account page. RuntimeEnvScript supplies the current setting.
export const APP_NAME = runtimeEnv().displayName ?? 'Helena';

// The page background of each theme (design-system/tokens.css --bg, as hex), for the
// places that need a literal colour before the stylesheet applies: the browser's
// theme-color (the phone status bar) and the install manifest's splash screen. They were
// the old palette's (#fbfaf7/#23201e): the status bar showed a band in another colour
// over the header, which read as a glow on the phone (owner, 29.09., O70). The test
// themeColor.test.ts keeps them equal to the tokens.
export const THEME_COLOR_LIGHT = '#f6f5f8';
export const THEME_COLOR_DARK = '#0b0a0e';

// The theme-color for a resolved theme ('light' | 'dark' | unknown → light).
export const themeColorFor = (theme: string | undefined) =>
  theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;

// The project this product is a fork of, named with its licence in the user menu.
export const UPSTREAM_URL = 'https://github.com/croffasia/itsaplan';

// The legal document URLs, linked from the logged-out screens: Google requires the
// privacy policy and terms registered for the OAuth client to be reachable before
// consent is given. Each instance points these at its own documents through its
// environment (see runtimeEnv); when unset, the legal notice is hidden.
export const PRIVACY_POLICY_URL = runtimeEnv().privacyUrl;
export const TERMS_URL = runtimeEnv().termsUrl;
