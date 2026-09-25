// A name for a device the person recognises, from its browser's user agent: "iPhone ·
// Safari", "Mac · Chrome", "Android · Firefox". The person sees it in the device list; the
// server keeps what the device sent when it subscribed.

function platform(userAgent: string, maxTouchPoints: number): string {
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return '';
}

function browser(userAgent: string): string {
  if (/EdgiOS|EdgA|Edg\//.test(userAgent)) return 'Edge';
  if (/SamsungBrowser/.test(userAgent)) return 'Samsung Internet';
  if (/OPR\/|Opera/.test(userAgent)) return 'Opera';
  if (/FxiOS|Firefox\//.test(userAgent)) return 'Firefox';
  if (/CriOS|Chrome\/|Chromium\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return '';
}

export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  return [platform(userAgent, maxTouchPoints), browser(userAgent)].filter(Boolean).join(' · ');
}

// Who runs a push service, from its host.
export type PushService = 'apple' | 'google' | 'mozilla' | 'microsoft' | 'other';

export function pushServiceOf(host: string): PushService {
  if (host.endsWith('push.apple.com')) return 'apple';
  if (host.endsWith('googleapis.com')) return 'google';
  if (host.endsWith('mozilla.com') || host.endsWith('mozaws.net')) return 'mozilla';
  if (host.endsWith('notify.windows.com')) return 'microsoft';
  return 'other';
}
