export {
  db,
  listen,
  closeDatabase,
  databaseRuntimeName,
  withSettledTransactionCallbacks,
} from './client';
export * from './schema';
export * from './permissions';
export {
  DEFAULT_DISPLAY_NAME,
  DISPLAY_NAME_SETTING_KEY,
  getDisplayName,
  setDisplayName,
  validDisplayName,
} from './brand';
export {
  clearSettingsCache,
  forgetSetting,
  getSetting,
  getOrCreateSetting,
  setSetting,
} from './settings';
export { insertSecretIfAbsent, readRedactedSecret, readSecret, writeSecret } from './secrets';
export { containsPattern, escapeLike } from './like';
export { recordServiceCheck } from './service-heartbeat';
export {
  ENGINE_EVENT_TARGETS,
  ENGINE_TRIGGERS_TARGET,
  engineSchemaName,
  enqueueEngineEvents,
  type EngineEventTarget,
} from './engine-events';
export { recordJanitorRun, listJanitorRuns, type JanitorRunRow } from './janitor-run';
export {
  TELEGRAM_BOT_SECRET_KEY,
  getInstanceBotConfig,
  isInstanceBotUsable,
  type InstanceBotConfig,
} from './domains/telegram-bot';
export {
  INSTANCE_EMAIL_SECRET_KEY,
  defaultInstanceEmailConfig,
  getInstanceEmailConfig,
  getProjectEmailConfig,
  hasConfiguredEmailProvider,
  type InstanceEmailConfig,
} from './domains/instance-email';
export {
  defaultNotificationConfig,
  emailSource,
  getDeliveryConfig,
  notificationContext,
  readNotificationConfig,
  type NotificationConfig,
} from './domains/notification-settings';
export {
  credentialContext,
  nextCredentialId,
  openCredential,
  sealCredential,
} from './credential-crypto';
export { reencryptAll } from './reencrypt';
export {
  WEBHOOK_CONSUMER_ID,
  WEBHOOK_EVENT_PATTERNS,
  WEBHOOK_EVENT_SHAPE,
  fanOutWebhooks,
  webhookEventOf,
  type WebhookEventName,
} from './domains/webhook-fanout';
export {
  DEFAULT_PLUGIN_SETTINGS,
  PLUGIN_SETTINGS_KEY,
  getPluginSettings,
  pluginsDir,
  setPluginSettings,
  type PluginSettings,
} from './domains/plugins';
export {
  LOCAL_AI_KEY_DIR,
  LOCAL_AI_POLICY_KEY,
  STATUS_FRESH_MS,
  allowedKeyFile,
  defaultLocalAiPolicy,
  failedEvalModels,
  listModelServers,
  localAiServerSecretKey,
  modelServerBySlug,
  normalizeLocalAiPolicy,
  pickModel,
  readLocalAiPolicy,
  readModelServerKey,
  resolveLocalRoute,
  routeFor,
  writeLocalAiPolicy,
  type LocalAiClassSetting,
  type LocalAiPolicy,
  type LocalAiPreset,
  type LocalRoute,
  type ModelServerRow,
  type RouteRefusal,
  type RouteResult,
} from './domains/local-ai';
// A database dump on demand (the update center takes one before an update).
export { writeBackup, type BackupResult } from './backup';
