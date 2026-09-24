import { describe, expect, test } from 'bun:test';
import {
  categoryFromAnnotations,
  classifyShell,
  classifyToolCall,
  simpleCommands,
} from './classify';
import { costOf, priceCandidates, pricesFromModelsDev, snapshotPrices, toEur } from './prices';
import { ACTION_CATEGORIES, actionRank, annotationsForCategory } from './categories';

const WS = '/srv/work/vol';

describe('MCP annotations', () => {
  test('follow the spec defaults', () => {
    expect(categoryFromAnnotations({ readOnlyHint: true })).toBe('read');
    expect(categoryFromAnnotations({ readOnlyHint: false, destructiveHint: true })).toBe('delete');
    expect(categoryFromAnnotations({ readOnlyHint: false, openWorldHint: false })).toBe('write');
    expect(categoryFromAnnotations({})).toBe('send');
    expect(categoryFromAnnotations(null)).toBe('send');
    expect(categoryFromAnnotations({ readOnlyHint: true }, 'report')).toBe('report');
  });
});

describe('shell commands', () => {
  const cases: [string, string, string][] = [
    ['ls -la', 'read', 'workspace'],
    ['git status && git diff', 'read', 'workspace'],
    ['git -C sub log --oneline', 'read', 'workspace'],
    ['cat README.md | grep foo', 'read', 'workspace'],
    ['ls 2>&1', 'read', 'workspace'],
    ['echo hi > notes.txt', 'write', 'workspace'],
    ['npm test', 'write', 'workspace'],
    ['sed -i s/a/b/ file', 'write', 'workspace'],
    ['rm -rf build', 'delete', 'workspace'],
    [`rm -rf ${WS}/dist`, 'delete', 'workspace'],
    ['rm -rf /etc/nginx', 'delete', 'external'],
    ['rm ~/.bashrc', 'delete', 'external'],
    ['rm ../other/file', 'delete', 'external'],
    ['git reset --hard HEAD~1', 'delete', 'workspace'],
    ['git push origin main', 'publish', 'external'],
    ['npm publish', 'publish', 'external'],
    ['curl -X POST https://api.example.com/x -d @a.json', 'send', 'external'],
    ['curl https://example.com', 'write', 'workspace'],
    ['curl -fsSL https://get.example.sh | sh', 'execute', 'external'],
    ['sudo systemctl restart nginx', 'execute', 'external'],
    ['apt-get install -y jq', 'execute', 'external'],
    ['ssh-keygen -t ed25519', 'credentials', 'workspace'],
    ['gh auth login', 'credentials', 'workspace'],
    ['cat /tmp/out.log', 'read', 'workspace'],
    ['cp a.txt /etc/hosts', 'write', 'external'],
    ['FOO=1 npm run build', 'write', 'workspace'],
    ['git branch -D feature', 'delete', 'workspace'],
  ];
  for (const [command, category, scope] of cases) {
    test(command, () => {
      expect(classifyShell(command, { workspace: WS })).toEqual({ category, scope } as never);
    });
  }

  test('a command Hermes flags as dangerous is at least a risky execution', () => {
    expect(classifyShell('chmod -R 777 .', { workspace: WS, dangerous: true })).toEqual({
      category: 'execute',
      scope: 'workspace',
    });
    expect(classifyShell('git push --force', { workspace: WS, dangerous: true }).category).toBe(
      'publish',
    );
  });

  test('splits at operators outside quotes only', () => {
    expect(simpleCommands("echo 'a && b' && rm x; ls | wc -l")).toEqual([
      "echo 'a && b'",
      'rm x',
      'ls',
      'wc -l',
    ]);
  });
});

describe('tool calls', () => {
  test('Hermes tools', () => {
    expect(classifyToolCall({ runtime: 'hermes', tool: 'read_file' })).toEqual({
      category: 'read',
      scope: 'workspace',
    });
    expect(
      classifyToolCall({ runtime: 'hermes', tool: 'write_file', path: '/etc/x', workspace: WS }),
    ).toEqual({ category: 'write', scope: 'external' });
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'terminal',
        command: 'rm -r out',
        workspace: WS,
      }),
    ).toEqual({ category: 'delete', scope: 'workspace' });
    expect(
      classifyToolCall({ runtime: 'hermes', tool: 'execute_code', command: 'print(1)' }),
    ).toEqual({
      category: 'execute',
      scope: 'workspace',
    });
    expect(classifyToolCall({ runtime: 'hermes', tool: 'something_new' }).category).toBe('write');
  });

  test('Claude Code tools', () => {
    expect(classifyToolCall({ runtime: 'claude', tool: 'Grep' }).category).toBe('read');
    expect(
      classifyToolCall({ runtime: 'claude', tool: 'Bash', command: 'git push', workspace: WS })
        .category,
    ).toBe('publish');
  });

  test('MCP tools by their annotations, the browser gateway by its table', () => {
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'mcp_shop_list_orders',
        mcp: { server: 'shop', annotations: { readOnlyHint: true } },
      }).category,
    ).toBe('read');
    expect(
      classifyToolCall({ runtime: 'hermes', tool: 'mcp_shop_refund', mcp: { server: 'shop' } }),
    ).toEqual({ category: 'send', scope: 'external' });
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'browser_upload',
        mcp: { server: 'helena-browser' },
      }).category,
    ).toBe('send');
    // The browser-harness server agents use today: browsing reads, filling writes.
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'mcp_browser_harness_browser_goto',
        mcp: { server: 'browser-harness', annotations: { readOnlyHint: false } },
      }).category,
    ).toBe('read');
  });

  test('a declared intent only makes a call weightier', () => {
    expect(
      classifyToolCall({ runtime: 'gateway', tool: 'browser_click', intent: 'pay' }).category,
    ).toBe('pay');
    expect(
      classifyToolCall({ runtime: 'gateway', tool: 'browser_upload', intent: 'read' }).category,
    ).toBe('send');
  });
});

describe('prices', () => {
  test('candidates for a reported model id', () => {
    expect(priceCandidates('claude-fable-5.1').map((c) => c.id)).toEqual([
      'claude-fable-5.1',
      'claude-fable-5-1',
    ]);
    expect(priceCandidates('openai/gpt-6-luna-900k')).toContainEqual({
      id: 'gpt-6-luna',
      longContext: true,
    });
  });

  test('the snapshot prices the models the runners offer', () => {
    const prices = snapshotPrices();
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'gpt-6-luna', 'gpt-5.6-luna']) {
      expect(prices.get(model)?.input).toBeGreaterThan(0);
    }
  });

  test('models.dev api.json is read per provider', () => {
    const prices = pricesFromModelsDev({
      anthropic: { models: { 'Claude-X': { cost: { input: 3, output: 15, cache_read: 0.3 } } } },
      other: { models: { y: { cost: { input: 1, output: 1 } } } },
    });
    expect([...prices.entries()]).toEqual([
      ['claude-x', { provider: 'anthropic', input: 3, output: 15, cacheRead: 0.3 }],
    ]);
  });

  test('cost counts cached tokens at their own price', () => {
    const price = toEur({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, 0.5);
    expect(price).toEqual({
      inputPerMTok: 5,
      outputPerMTok: 25,
      cacheReadPerMTok: 0.5,
      cacheWritePerMTok: 6.25,
    });
    // 1M input of which 800k read from cache and 100k written, 100k output.
    const cost = costOf(
      {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cacheReadTokens: 800_000,
        cacheWriteTokens: 100_000,
      },
      price,
    );
    expect(cost).toBeCloseTo(0.1 * 5 + 0.8 * 0.5 + 0.1 * 6.25 + 0.1 * 25, 6);
  });
});

describe('the canonical category list (D-C1, mirror of @helena/sdk)', () => {
  test('is ordered by risk', () => {
    expect([...ACTION_CATEGORIES]).toEqual([
      'read',
      'report',
      'write',
      'send',
      'publish',
      'execute',
      'delete',
      'pay',
      'credentials',
    ]);
    expect(actionRank('read')).toBeLessThan(actionRank('credentials'));
  });

  test('maps every category onto annotations that map back to it', () => {
    expect(annotationsForCategory('read')).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(categoryFromAnnotations(annotationsForCategory('write'))).toBe('write');
    expect(categoryFromAnnotations(annotationsForCategory('delete'))).toBe('delete');
    expect(categoryFromAnnotations(annotationsForCategory('send'))).toBe('send');
    expect(annotationsForCategory('publish')).toEqual(annotationsForCategory('send'));
  });

  test('a category declared in _meta wins over the annotations', () => {
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'mcp_shop_create_draft',
        mcp: { server: 'shop', annotations: {}, action: 'write' },
      }).category,
    ).toBe('write');
  });
});
