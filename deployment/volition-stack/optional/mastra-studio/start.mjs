import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

// Mastra accepts API requests only with this token and the proxy is the only other
// process that gets it. It is new on every start and never written to disk.
const env = { ...process.env, MASTRA_UPSTREAM_TOKEN: randomBytes(32).toString('hex') };

const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 8000);
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))))
    .then(() => { clearTimeout(timeout); process.exit(code); });
}
for (const file of ['.mastra/output/index.mjs', 'readonly-proxy.mjs']) {
  const child = spawn(process.execPath, [file], { stdio: 'inherit', env });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
