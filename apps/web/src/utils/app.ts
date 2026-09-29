import { runtimeEnv } from './runtimeEnv';

// The product name shown to users: the login panel, the passkey label in the OS
// picker, and the account page. RuntimeEnvScript supplies the current setting.
export const APP_NAME = runtimeEnv().displayName ?? 'Helena';

// The page background of each theme (globals.css --background, as hex), for the places
// that need a literal colour before the stylesheet applies: the browser's theme-color
// (the phone status bar) and the install manifest's splash screen.
export const THEME_COLOR_LIGHT = '#fbfaf7';
export const THEME_COLOR_DARK = '#23201e';

// The project this product is a fork of, named with its licence in the user menu.
export const UPSTREAM_URL = 'https://github.com/croffasia/itsaplan';

// The legal document URLs, linked from the logged-out screens: Google requires the
// privacy policy and terms registered for the OAuth client to be reachable before
// consent is given. Each instance points these at its own documents through its
// environment (see runtimeEnv); when unset, the legal notice is hidden.
export const PRIVACY_POLICY_URL = runtimeEnv().privacyUrl;
export const TERMS_URL = runtimeEnv().termsUrl;
