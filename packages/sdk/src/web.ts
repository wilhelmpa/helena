// The web app's side of @helena/sdk: the UI slot registry. React-free on purpose; the app
// reads it with useSyncExternalStore (subscribe + version).

import { CORE_PLUGIN_ID, Registry } from './registry';
import { sortSlots, uiSlotKey, type SlotOf, type UiSlot, type UiSlotName } from './ui';

export * from './ui';
export { resolveText, type LocalizedText, type Translate } from './text';
export { CORE_PLUGIN_ID, Registry } from './registry';

export type UiSlotRegistry = Registry<UiSlot>;

export function createUiSlotRegistry(): UiSlotRegistry {
  return new Registry<UiSlot>('UI slot', uiSlotKey);
}

// The registered extensions of one slot, in display order.
export function slotsOf<Name extends UiSlotName>(
  registry: UiSlotRegistry,
  name: Name,
): SlotOf<Name>[] {
  return sortSlots(registry.list().filter((slot): slot is SlotOf<Name> => slot.slot === name));
}

export function slotById<Name extends UiSlotName>(
  registry: UiSlotRegistry,
  name: Name,
  id: string,
): SlotOf<Name> | undefined {
  return registry.get(uiSlotKey({ slot: name, id })) as SlotOf<Name> | undefined;
}

// Registers several slots of the same plugin at once; returns one function removing all.
export function registerSlots(
  registry: UiSlotRegistry,
  slots: UiSlot[],
  pluginId: string = CORE_PLUGIN_ID,
): () => void {
  const offs = slots.map((slot) => registry.register(slot, pluginId));
  return () => {
    for (const off of offs) off();
  };
}
// The template bundle format, for upload and download in the browser (types only).
export type {
  BundleAgent,
  BundleMcpServer,
  BundleSkill,
  SkillSource,
  TemplateBundle,
} from './templates';
