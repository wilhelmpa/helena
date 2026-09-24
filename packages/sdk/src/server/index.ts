// Server side of @helena/sdk: the plugin host, the external plugin loader, manifest
// validation and the event outbox dispatcher. Node only; never import it from the web.

export {
  PluginHost,
  PluginRegistrationError,
  type LoadedPlugin,
  type PluginHostOptions,
  type PluginSource,
  type PluginStatus,
} from './host';
export {
  MANIFEST_FILE,
  approvalProblem,
  discoverPlugins,
  loadExternalPlugins,
  loadPluginDir,
  pluginDigest,
  type DiscoveredPlugin,
  type ExternalPluginPolicy,
  type PluginApproval,
  type PluginEntry,
} from './loader';
export {
  ManifestError,
  PLUGIN_ID,
  manifestJsonSchema,
  parseManifest,
  pluginManifestSchema,
} from './manifest';
export {
  createOutboxDispatcher,
  defaultBackoffMs,
  type DispatchReport,
  type OutboxDelivery,
  type OutboxDispatcherOptions,
  type OutboxStore,
} from './outbox';
export { bundleJsonSchema, checkBundle, templateBundleSchema } from './bundle-schema';
