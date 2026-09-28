import type { Bot } from 'grammy';
import { getInstanceBotConfig, isInstanceBotUsable } from '@repo/db';
import { botConfig } from './config';
import { createBot, deliverPending } from './bot';

// Keeps the running bot in step with the instance settings. The token is not env
// configuration: an administrator sets it in god mode, so this polls the database and
// starts, stops, or replaces the bot when it changes. Without that, adding the token
// would need a redeploy.
//
// Long polling means exactly one process may hold the token — Telegram hands each
// update to a single getUpdates caller. That is why this service runs as one
// instance and must not be scaled to several replicas.

let current: { token: string; bot: Bot } | null = null;
let stopped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let deliveryTimer: ReturnType<typeof setInterval> | null = null;
let deliveryRunning = false;

export interface SupervisorHandle {
  stop: () => Promise<void>;
}

export function startSupervisor(): SupervisorHandle {
  stopped = false;
  void loop();
  return { stop };
}

async function stop(): Promise<void> {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await stopCurrent();
}

async function stopCurrent(): Promise<void> {
  if (!current) return;
  const { bot } = current;
  current = null;
  if (deliveryTimer) clearInterval(deliveryTimer);
  deliveryTimer = null;
  deliveryRunning = false;
  await bot.stop();
}

async function loop(): Promise<void> {
  if (stopped) return;
  const cfg = botConfig();
  let delay = cfg.configPollIntervalMs;
  try {
    await reconcile();
  } catch {
    // The database being briefly unreachable must not kill the service, and a bot
    // already running keeps running meanwhile. This is the normal case at startup, so
    // retry sooner than the steady-state interval instead of leaving the bot idle for
    // a full poll cycle.
    delay = cfg.configRetryIntervalMs;
    console.error('[bot] could not read bot settings');
  }
  if (stopped) return;
  timer = setTimeout(loop, delay);
}

async function reconcile(): Promise<void> {
  const settings = await getInstanceBotConfig();

  if (!isInstanceBotUsable(settings)) {
    if (current) console.log('[bot] bot turned off, stopping');
    await stopCurrent();
    return;
  }
  if (current?.token === settings.botToken) return;

  if (current) console.log('[bot] bot token changed, restarting');
  await stopCurrent();

  const bot = createBot(settings.botToken);
  const entry = { token: settings.botToken, bot };
  current = entry;
  deliveryTimer = setInterval(() => {
    if (deliveryRunning) return;
    deliveryRunning = true;
    void deliverPending(bot)
      .catch(() => console.error('[bot] delivery tick failed'))
      .finally(() => {
        deliveryRunning = false;
      });
  }, 2_000);
  // bot.start() resolves only when the bot stops, so it is not awaited here. It
  // rejects when the token is rejected by Telegram, which bot.catch does not cover:
  // clear the entry so the next poll tries again instead of assuming it is running.
  bot
    .start({
      onStart: (me) => console.log(`[bot] polling as @${me.username}`),
      // Only what this bot acts on, so Telegram does not queue updates it ignores.
      allowed_updates: ['message', 'callback_query'],
    })
    .catch(() => {
      console.error('[bot] polling stopped');
      if (deliveryTimer) clearInterval(deliveryTimer);
      deliveryTimer = null;
      if (current === entry) current = null;
    });
}
