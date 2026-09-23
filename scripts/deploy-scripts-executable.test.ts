import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';

// deploy.sh runs the scripts next to it directly; one committed without the executable
// bit stops a live deploy halfway (it happened with vault-setup.sh and isolation.sh).
describe('deployment scripts', () => {
  it('are executable when they start with a shebang', () => {
    const listing = execFileSync('git', ['ls-files', '-s', 'deployment/volition-stack/native'], {
      encoding: 'utf8',
    });
    const missing = listing
      .split('\n')
      .filter((line) => line.startsWith('100644 '))
      .map((line) => line.split('\t')[1]!)
      .filter((path) => /\.(sh|py|mjs)$/.test(path) && !path.includes('/test'))
      .filter((path) => {
        const head = execFileSync('head', ['-c', '2', path], { encoding: 'utf8' });
        return head === '#!';
      });
    expect(missing).toEqual([]);
  });
});
