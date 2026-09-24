// Writes schema/helena.plugin.schema.json from the zod manifest schema: `bun run schema`.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manifestJsonSchema } from './manifest';

const target = join(import.meta.dir, '../../schema/helena.plugin.schema.json');
await writeFile(target, `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`);
console.log(`wrote ${target}`);
