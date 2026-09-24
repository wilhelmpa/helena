// Writes the published JSON Schemas from their zod definitions: `bun run schema`.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bundleJsonSchema } from './bundle-schema';
import { manifestJsonSchema } from './manifest';

const dir = join(import.meta.dir, '../../schema');
for (const [file, schema] of [
  ['helena.plugin.schema.json', manifestJsonSchema()],
  ['helena.bundle.schema.json', bundleJsonSchema()],
] as const) {
  await writeFile(join(dir, file), `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
