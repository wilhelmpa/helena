import { db, helenaModelServer, listModelServers } from '@repo/db';
import { NPU_BASE, NPU_SLUG } from '../modules/local-ai/npu-profile';

const existing = (await listModelServers()).find((server) => server.slug === NPU_SLUG);
if (existing && (existing.kind !== 'fastflowlm' || existing.baseUrl !== NPU_BASE))
  throw new Error('The NPU slug belongs to another server');
await db
  .insert(helenaModelServer)
  .values({
    slug: NPU_SLUG,
    name: 'Local NPU',
    kind: 'fastflowlm',
    baseUrl: NPU_BASE,
    keySource: 'file',
    keyFile: '/etc/helena/volition-npu.key',
    enabled: false,
  })
  .onConflictDoNothing();
console.log('NPU server registered; activate through the central local profile.');
process.exit(0);
