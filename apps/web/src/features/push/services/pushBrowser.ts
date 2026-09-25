import { API_URL } from '@/lib/api/core/client';
import { base64UrlToBytes, bytesToBase64Url } from '../utils/base64';
import { currentPushEnvironment, type PushEnvironment } from '../utils/pushSupport';

// The browser's side of push: the service worker (public/sw.js) and its push subscription.
// The worker is registered at the site root, so it may show notifications for every page
// and open any of them from a click. It learns the API's address from its own URL, for
// renewing a subscription the push service replaced (pushsubscriptionchange).

export const SERVICE_WORKER_PATH = '/sw.js';

export function serviceWorkerUrl(apiUrl: string = API_URL): string {
  return `${SERVICE_WORKER_PATH}?api=${encodeURIComponent(apiUrl)}`;
}

export async function pushRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(serviceWorkerUrl(), { scope: '/' });
  return navigator.serviceWorker.ready;
}

export interface LocalSubscription {
  endpoint: string;
  // The applicationServerKey it was made with, base64url.
  key: string | null;
  subscription: PushSubscription;
}

export async function localSubscription(): Promise<LocalSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = (await registration?.pushManager.getSubscription()) ?? null;
  if (!subscription) return null;
  const key = subscription.options.applicationServerKey;
  return {
    endpoint: subscription.endpoint,
    key: key ? bytesToBase64Url(key) : null,
    subscription,
  };
}

export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(`Notifications are ${permission}`);
    this.name = 'PushPermissionError';
  }
}

// Asks for permission (first, while the click still counts as the person's gesture, which
// Safari insists on), then subscribes with the instance's key. A subscription made with
// another key is replaced.
export async function subscribeBrowser(publicKey: string): Promise<PushSubscription> {
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new PushPermissionError(permission);
  const registration = await pushRegistration();
  const existing = await registration.pushManager.getSubscription();
  const existingKey = existing?.options.applicationServerKey;
  if (existing && existingKey && bytesToBase64Url(existingKey) === publicKey) return existing;
  if (existing) await existing.unsubscribe();
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
}

// Ends this browser's subscription; returns its endpoint, or null when there was none.
export async function unsubscribeBrowser(): Promise<string | null> {
  const local = await localSubscription();
  if (!local) return null;
  await local.subscription.unsubscribe();
  return local.endpoint;
}

// ── The environment, as a store React reads without an effect ─────────────────────────────

let snapshot: PushEnvironment | null | undefined;
const listeners = new Set<() => void>();

export const pushEnvironmentStore = {
  get(): PushEnvironment | null {
    if (snapshot === undefined) snapshot = currentPushEnvironment();
    return snapshot;
  },
  getServer(): PushEnvironment | null {
    return null;
  },
  // Read again (after the person answered the permission prompt).
  refresh(): void {
    snapshot = currentPushEnvironment();
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
