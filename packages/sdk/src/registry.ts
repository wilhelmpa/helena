// A registry holds the extensions of one kind (runtimes, tools, step types, …) by id. It
// is deliberately small: register, look up, list, and be told when the set changes. Every
// entry remembers the plugin that registered it, so a clash names both sides and the
// Administrator can show where an extension came from.

export const CORE_PLUGIN_ID = 'helena.core';

// Ids are stable, machine-readable names: `hermes`, `browser_click`, `hello.wait`.
// Letters, digits and `._:/-` after a leading letter or digit; MCP tool names fit it.
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export interface RegistryEntry<T> {
  id: string;
  value: T;
  pluginId: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

export class Registry<T> {
  private readonly entries = new Map<string, RegistryEntry<T>>();
  private readonly listeners = new Set<() => void>();
  // Bumped on every change, so a reader (React's useSyncExternalStore) can tell the list
  // changed without comparing it.
  private revision = 0;

  constructor(
    // What the registry holds, for error messages: "tool", "runtime", "panel tool".
    readonly kind: string,
    private readonly idOf: (value: T) => string,
  ) {}

  // Adds an extension and returns the function that removes it again. A second
  // registration under the same id is an error rather than a silent override: two plugins
  // claiming one id is a conflict the operator has to see.
  register(value: T, pluginId: string = CORE_PLUGIN_ID): () => void {
    const id = this.idOf(value);
    if (typeof id !== 'string' || !ID.test(id)) {
      throw new RegistryError(`Invalid ${this.kind} id "${String(id)}" from ${pluginId}`);
    }
    const clash = this.entries.get(id);
    if (clash) {
      throw new RegistryError(
        `Duplicate ${this.kind} "${id}": registered by ${clash.pluginId} and ${pluginId}`,
      );
    }
    const entry = { id, value, pluginId };
    this.entries.set(id, entry);
    this.changed();
    return () => {
      if (this.entries.get(id) !== entry) return;
      this.entries.delete(id);
      this.changed();
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }

  // Like get, for a caller that cannot go on without the extension.
  require(id: string): T {
    const entry = this.entries.get(id);
    if (!entry) throw new RegistryError(`Unknown ${this.kind} "${id}"`);
    return entry.value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  // In registration order: built-ins first, then plugins in the order they loaded.
  list(): T[] {
    return [...this.entries.values()].map((entry) => entry.value);
  }

  entriesList(): RegistryEntry<T>[] {
    return [...this.entries.values()];
  }

  pluginOf(id: string): string | undefined {
    return this.entries.get(id)?.pluginId;
  }

  // Removes everything one plugin registered, for a plugin that failed half way through
  // its registration.
  removePlugin(pluginId: string): void {
    let removed = false;
    for (const [id, entry] of this.entries) {
      if (entry.pluginId === pluginId) {
        this.entries.delete(id);
        removed = true;
      }
    }
    if (removed) this.changed();
  }

  version(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

// A registry of values that carry their id in an `id` field, which is most of them.
export function createRegistry<T extends { id: string }>(kind: string): Registry<T> {
  return new Registry<T>(kind, (value) => value.id);
}
