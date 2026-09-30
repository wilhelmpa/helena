import type { MemoryRevision } from '@/lib/api/endpoints/agentRuntime';
import type { AgentInventoryMemory } from '@/lib/api/endpoints/agents';

const FILES = ['MEMORY.md', 'USER.md'] as const;

// The two memory files as they stand now: what the runtime last reported, else the newest
// version Helena saw (revisions come newest first). A file nobody wrote yet is empty.
export function memoryFilesOf(
  reported: AgentInventoryMemory[] | undefined,
  revisions: MemoryRevision[] | undefined,
): AgentInventoryMemory[] {
  return FILES.map((file) => {
    const inventory = reported?.find((entry) => entry.file === file);
    if (inventory) return inventory;
    const revision = revisions?.find((entry) => entry.file === file);
    return revision
      ? {
          file,
          content: revision.content,
          truncated: false,
          sha256: revision.sha256,
          chars: revision.content.length,
        }
      : { file, content: '', truncated: false, chars: 0 };
  });
}
