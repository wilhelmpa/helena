// @helena/sdk: the contracts of Helena's extension points and a small registry core.
// This entry is isomorphic (API, worker, runner, web) and has no runtime dependencies
// beyond itself. Server-only pieces (plugin host, loader, manifest validation, the event
// outbox dispatcher) are in '@helena/sdk/server'; the web's slot registry in
// '@helena/sdk/web'.

export { SDK_VERSION } from './version';
export {
  CORE_PLUGIN_ID,
  Registry,
  RegistryError,
  createRegistry,
  type RegistryEntry,
} from './registry';
export { createRegistries, type HelenaRegistries } from './registries';
export {
  ACTION_CATEGORIES,
  ACTION_META_KEY,
  actionRank,
  annotationsForCategory,
  categoryFromAcpToolKind,
  categoryFromAnnotations,
  isActionCategory,
  type ActionCategory,
} from './actions';
export { consoleLogger, type AgentRef, type Logger, type ProjectRef } from './common';
export { resolveText, type LocalizedText, type Translate } from './text';
export {
  SchemaError,
  isStandardSchema,
  toJsonSchema,
  validate,
  type JsonSchema,
  type SchemaLike,
} from './schema';
export {
  TOOL_NAME,
  declaredCategory,
  isCallToolResult,
  toCallToolResult,
  toMcpTool,
  toolCategory,
  toolDescriptor,
  toolError,
  type AgentTool,
  type AnyAgentTool,
  type ToolCallContext,
  type ToolDescriptor,
} from './tools';
export {
  CredentialError,
  coerceCredential,
  redactCredential,
  type Connector,
  type ConnectorAuth,
  type ConnectorAuthContext,
  type ConnectorAuthStep,
  type ConnectorHealth,
  type ConnectorService,
  type CredentialField,
  type CredentialFieldType,
  type CredentialValues,
} from './connectors';
export type {
  StepExecutionContext,
  StepIssue,
  StepOutcome,
  StepRun,
  StepSignal,
  StepUiHints,
  StepValidationContext,
  TriggerMatch,
  TriggerType,
  WorkflowStepType,
} from './workflows';
export {
  DEFAULT_DECISION,
  decide,
  type PolicyContext,
  type PolicyDecision,
  type PolicyEffect,
  type PolicyEvaluator,
  type PolicyRequest,
} from './policy';
export {
  CORE_EVENT_TYPES,
  createEvent,
  createEventBus,
  eventSource,
  matchesEventPattern,
  type ApprovalEventData,
  type CoreEvent,
  type CoreEventData,
  type CoreEventType,
  type EventBus,
  type EventBusOptions,
  type EventHandler,
  type EventInit,
  type EventSubscription,
  type HelenaEvent,
  type IssueRef,
  type RunEventData,
} from './events';
export type {
  CaptureInput,
  CaptureKind,
  CaptureResult,
  CaptureTarget,
  KnowledgeItem,
  KnowledgeLink,
  KnowledgeLinkKind,
  KnowledgeListContext,
  KnowledgeMetadataValue,
  KnowledgeProvenance,
  KnowledgeScope,
  KnowledgeSource,
} from './knowledge';
export {
  cliArgv,
  cliPrompt,
  type AcpLaunch,
  type AcpRuntimeAdapter,
  type CliCommand,
  type CliRuntimeAdapter,
  type RuntimeAdapter,
  type RuntimeCapabilities,
  type RuntimeProfile,
  type RuntimeProfileContext,
  type RuntimeProfileResult,
  type RuntimeReaders,
  type RuntimeSessionSummary,
  type RuntimeStreamEvent,
  type RuntimeStreamParser,
  type RuntimeTaskSettings,
} from './runtime';
export {
  sortSlots,
  uiSlotKey,
  type AdminSectionSlot,
  type AgentSectionProps,
  type AgentSectionSlot,
  type CaptureActionSlot,
  type ComponentRender,
  type DashboardWidgetProps,
  type DashboardWidgetSlot,
  type FrameRender,
  type HeaderActionSlot,
  type HomeNavSlot,
  type PanelToolProps,
  type PanelToolSlot,
  type ProjectSettingsProps,
  type ProjectSettingsSlot,
  type SlotComponent,
  type SlotOf,
  type SlotRender,
  type UiSlot,
  type UiSlotDescriptor,
  type UiSlotName,
} from './ui';
export {
  ACCEPTED_LICENSES,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_MANIFEST,
  parseBundleJson,
  skillMarkdownName,
  validateBundle,
  type BundleAgent,
  type BundleMcpServer,
  type BundleOffer,
  type BundleSkill,
  type SkillSource,
  type TemplateBundle,
} from './templates';
export {
  definePlugin,
  type HelenaPlugin,
  type HostProcess,
  type PluginContext,
  type Registrar,
} from './plugin';
export type {
  McpServerContribution,
  PluginEntries,
  PluginManifest,
  PluginPermissions,
  PluginProvides,
} from './manifest-types';
