// Whether this browser can receive Helena's pushes, and if not, what the person can do about
// it (docs/helena-decisions/push.md):
// - `insecure`: push needs a secure context (https, or localhost); Helena on plain http in
//   the home network cannot subscribe until the https address is set up.
// - `ios-install`: iPhone and iPad offer push only to a web app added to the home screen
//   (iOS 16.4+), never in a Safari tab.
// - `unsupported`: a browser without service workers or the Push API.
// - `denied`: the person (or the browser) blocked notifications for this site.
export type PushSupport = 'supported' | 'insecure' | 'ios-install' | 'unsupported' | 'denied';

export interface PushEnvironment {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
  userAgent: string;
  maxTouchPoints: number;
  // Opened from the home screen (display-mode standalone, or Safari's navigator.standalone).
  standalone: boolean;
}

// An iPhone, iPod or iPad, including an iPad that says it is a Mac.
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function pushSupport(env: PushEnvironment): PushSupport {
  if (!env.isSecureContext) return 'insecure';
  if (isAppleMobile(env.userAgent, env.maxTouchPoints) && !env.standalone) return 'ios-install';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'supported';
}

// This browser, read once where it runs.
export function currentPushEnvironment(): PushEnvironment | null {
  if (typeof window === 'undefined') return null;
  const nav = navigator as Navigator & { standalone?: boolean };
  const hasNotification = typeof Notification !== 'undefined';
  return {
    isSecureContext: window.isSecureContext,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}
