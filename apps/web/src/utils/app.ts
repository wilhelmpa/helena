import { runtimeEnv } from './runtimeEnv';

// The product name shown to users: the login panel, the passkey label in the OS
// picker, and the account page. It is defined once, so a rebrand is one edit.
//
// Helena is the app; Volition is the company and the whole system (Helena, Mastra,
// Hermes) that Helena is the UI for — see the brand lockup in BrandPanel/SidebarBrandFooter
// ("Helena – by Volition"). Do not conflate the two here.
export const APP_NAME = 'Helena';

// The project this product is a fork of, named with its licence in the user menu.
export const UPSTREAM_URL = 'https://github.com/croffasia/itsaplan';

// The legal document URLs, linked from the logged-out screens: Google requires the
// privacy policy and terms registered for the OAuth client to be reachable before
// consent is given. Each instance points these at its own documents through its
// environment (see runtimeEnv); when unset, the legal notice is hidden.
export const PRIVACY_POLICY_URL = runtimeEnv().privacyUrl;
export const TERMS_URL = runtimeEnv().termsUrl;
