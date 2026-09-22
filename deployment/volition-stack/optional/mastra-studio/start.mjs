import { spawn } from 'node:child_process';

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
  const child = spawn(process.execPath, [file], { stdio: 'inherit' });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
