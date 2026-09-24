import {
  createRegistry,
  definePlugin,
  type CaptureTarget,
  type KnowledgeSource,
  type PluginManifest,
  type Registry,
} from '@helena/sdk';
import { builtinCaptureTargets } from './capture';
import { builtinKnowledgeSources } from './sources';

// The knowledge sources and capture targets of this process. Helena's own are an
// internal plugin (`helena.knowledge`) registered through the same @helena/sdk
// registries an outside plugin uses. Once the process has the framework's plugin host,
// it hands its registries in with useKnowledgeRegistries and loads knowledgePlugin into
// it; until then the first call creates the registries and registers the built-ins.

export const KNOWLEDGE_PLUGIN_MANIFEST: PluginManifest = {
  id: 'helena.knowledge',
  name: { i18n: 'knowledge.plugin.name' },
  version: '0.1.0',
  description: { i18n: 'knowledge.plugin.description' },
  license: 'AGPL-3.0-only',
  sdk: '^0.1.0',
  provides: {
    knowledgeSources: builtinKnowledgeSources().map((source) => source.id),
    captureTargets: builtinCaptureTargets().map((target) => target.id),
  },
  permissions: { actions: ['read', 'write'] },
};

export const knowledgePlugin = definePlugin({
  register(ctx) {
    for (const source of builtinKnowledgeSources()) ctx.knowledgeSources.register(source);
    for (const target of builtinCaptureTargets()) ctx.captureTargets.register(target);
  },
});

interface Registries {
  sources: Registry<KnowledgeSource>;
  captureTargets: Registry<CaptureTarget>;
}

let registries: Registries | null = null;

export function useKnowledgeRegistries(next: Registries): void {
  registries = next;
}

export function knowledgeRegistries(): Registries {
  if (!registries) {
    const sources = createRegistry<KnowledgeSource>('knowledge source');
    const captureTargets = createRegistry<CaptureTarget>('capture target');
    for (const source of builtinKnowledgeSources()) {
      sources.register(source, KNOWLEDGE_PLUGIN_MANIFEST.id);
    }
    for (const target of builtinCaptureTargets()) {
      captureTargets.register(target, KNOWLEDGE_PLUGIN_MANIFEST.id);
    }
    registries = { sources, captureTargets };
  }
  return registries;
}

export function knowledgeSources(): KnowledgeSource[] {
  return knowledgeRegistries().sources.list();
}

export function knowledgeSource(id: string): KnowledgeSource | undefined {
  return knowledgeRegistries().sources.get(id);
}
