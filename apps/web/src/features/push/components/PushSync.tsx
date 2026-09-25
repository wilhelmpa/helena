'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  reportPushPresence,
  subscribePushDevice,
  updatePushDevice,
} from '@/lib/api/endpoints/push';
import { useSession } from '@/lib/auth-client';
import { usePushOverview, usePushSupport } from '../services/push.service';
import { localSubscription, pushRegistration } from '../services/pushBrowser';
import { base64UrlToBytes } from '../utils/base64';

const PRESENCE_EVERY_MS = 60_000;

// Keeps push working in the background of every page (docs/helena-decisions/push.md).
// Renders nothing.
// - Registers the service worker where push works, so a tap on a notification can open
//   Helena and a subscription the push service renewed is reported.
// - A device made with an older key (after a key rotation) subscribes anew; a device whose
//   interface language changed gets its messages in the new one.
// - While a page of Helena is visible, reports it every minute, so an agent's chat answer
//   does not buzz the phone of someone reading it on the desk. Only for a person with a
//   device that wants those answers.
// - Opens the page a notification points at when the worker asks this tab to.
export default function PushSync() {
  const { data: session } = useSession();
  const signedIn = Boolean(session?.user);
  const support = usePushSupport();
  const overview = usePushOverview(signedIn);
  const router = useRouter();
  const locale = useLocale();

  const publicKey = overview.data?.publicKey ?? null;
  const devices = overview.data?.devices;
  const wantsReplies = (devices ?? []).some((device) => device.categories['agent-replies']);

  // The worker, and this browser's device as the server knows it.
  useEffect(() => {
    if (!signedIn || support !== 'supported' || !publicKey || !devices) return;
    let cancelled = false;
    void (async () => {
      try {
        await pushRegistration();
        if (Notification.permission !== 'granted') return;
        const local = await localSubscription();
        // A subscription the server does not know was switched off or removed on purpose
        // (here or on another device): it stays off until the person switches it on.
        const known = local && devices.find((device) => device.endpoint === local.endpoint);
        if (!local || !known || cancelled) return;
        if (!known.currentKey || local.key !== publicKey) {
          // Made with an older key, which the push services refuse now: subscribe anew
          // with the current one and hand the device over, keeping its name and choices.
          await local.subscription.unsubscribe();
          const registration = await pushRegistration();
          const renewed = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToBytes(publicKey),
          });
          if (cancelled) return;
          await subscribePushDevice({
            subscription: renewed.toJSON(),
            vapidKey: publicKey,
            label: known.label,
            locale,
            replaces: local.endpoint,
          });
        } else if (known.locale !== locale) {
          // Its messages follow the language the interface runs in.
          await updatePushDevice(known.id, { locale });
        } else {
          return;
        }
        await overview.refetch();
      } catch (error) {
        console.warn('[push] could not renew this device', error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // overview.refetch is stable; the devices list is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, support, publicKey, devices, locale]);

  // Presence while a page is visible.
  useEffect(() => {
    if (!signedIn || !wantsReplies) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const report = (visible: boolean) => {
      void reportPushPresence(visible, !visible).catch(() => {});
    };
    const start = () => {
      report(true);
      timer ??= setInterval(() => report(true), PRESENCE_EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
      report(false);
    };
    const onChange = () => (document.visibilityState === 'visible' ? start() : stop());
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pagehide', stop);
      if (timer) clearInterval(timer);
    };
  }, [signedIn, wantsReplies]);

  // The worker asks an open tab to show a notification's page.
  useEffect(() => {
    if (support !== 'supported' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === 'helena-push-open' && typeof data.url === 'string') {
        if (data.url.startsWith('/') && !data.url.startsWith('//')) router.push(data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [support, router]);

  return null;
}
