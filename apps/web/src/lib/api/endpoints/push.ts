import { request } from '@/lib/api/core/client';
import type { LocalizedText } from '@helena/sdk/web';

// Web Push to the signed-in person's devices (docs/helena-decisions/push.md).

export interface PushCategory {
  id: string;
  label: LocalizedText;
  description: LocalizedText | null;
  defaultOn: boolean;
  audience: string;
}

export interface PushDevice {
  id: number;
  label: string;
  userAgent: string;
  locale: string;
  // The push service's host: web.push.apple.com, fcm.googleapis.com, …
  service: string;
  endpoint: string;
  // Subscribed with the instance's current key; false means it must subscribe again.
  currentKey: boolean;
  categories: Record<string, boolean>;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
}

export interface PushOverview {
  // Null where the server holds no key: push is not offered.
  publicKey: string | null;
  categories: PushCategory[];
  devices: PushDevice[];
}

export interface PushSubscribeBody {
  subscription: PushSubscriptionJSON;
  vapidKey: string;
  label?: string;
  locale?: string;
  categories?: Record<string, boolean>;
  replaces?: string;
}

export interface PushTestResult {
  ok: boolean;
  status: number | null;
  gone: boolean;
  error: string | null;
}

export const getPushOverview = () => request<PushOverview>('/account/push');

export const subscribePushDevice = (body: PushSubscribeBody) =>
  request<PushDevice>('/account/push/devices', { method: 'POST', body: JSON.stringify(body) });

export const updatePushDevice = (
  id: number,
  patch: { label?: string; locale?: string; categories?: Record<string, boolean> },
) =>
  request<PushDevice>(`/account/push/devices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const removePushDevice = (id: number) =>
  request<void>(`/account/push/devices/${id}`, { method: 'DELETE' });

export const testPushDevice = (id: number) =>
  request<PushTestResult>(`/account/push/devices/${id}/test`, { method: 'POST' });

export const reportPushPresence = (visible: boolean, keepalive = false) =>
  request<void>('/account/push/presence', {
    method: 'PUT',
    body: JSON.stringify({ visible }),
    ...(keepalive ? { keepalive: true } : {}),
  });
