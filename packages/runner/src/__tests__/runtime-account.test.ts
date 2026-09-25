import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ShortCommand } from '../cli-runtime';
import { answerRuntimeRequest, isRuntimeRequest } from '../readers';
import {
  answerLoginRead,
  claudeAccountFrom,
  codexAccountFrom,
  readRuntimeAccount,
  signOutArgs,
} from '../runtime-account';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function dir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'helena-account-'));
  roots.push(path);
  return path;
}

const never: ShortCommand = async () => {
  throw new Error('not asked');
};

describe("Codex' account", () => {
  it('reads the kind of login, the e-mail and the plan from `account/read`', () => {
    expect(
      codexAccountFrom({
        account: { type: 'chatgpt', email: 'owner@example.com', planType: 'pro' },
        requiresOpenaiAuth: true,
      }),
    ).toEqual({
      signedIn: true,
      method: 'chatgpt',
      email: 'owner@example.com',
      plan: 'pro',
      organization: null,
    });
    expect(codexAccountFrom({ account: { type: 'apiKey' } })).toMatchObject({
      signedIn: true,
      method: 'api-key',
      email: null,
    });
    expect(codexAccountFrom({ account: null, requiresOpenaiAuth: true })).toMatchObject({
      signedIn: false,
    });
    expect(
      codexAccountFrom({ account: { type: 'chatgpt', email: null, planType: 'unknown' } }),
    ).toMatchObject({ plan: null });
    expect(codexAccountFrom('nonsense')).toBeNull();
  });

  it('asks the app-server without a renewal, and times the login by its file', async () => {
    const home = await dir();
    await writeFile(join(home, 'auth.json'), '{"tokens":{"refresh_token":"rt_x"}}');
    const when = new Date('2026-09-20T12:00:00.000Z');
    await utimes(join(home, 'auth.json'), when, when);
    const asked: unknown[] = [];
    const account = await readRuntimeAccount({
      runtime: 'codex',
      dir: home,
      env: { CODEX_HOME: home },
      command: never,
      appServer: async (method, params) => {
        asked.push([method, params]);
        return { account: { type: 'chatgpt', email: 'owner@example.com', planType: 'plus' } };
      },
      now: () => Date.parse('2026-09-25T10:00:00.000Z'),
    });
    expect(asked).toEqual([['account/read', { refreshToken: false }]]);
    expect(account).toEqual({
      signedIn: true,
      method: 'chatgpt',
      email: 'owner@example.com',
      plan: 'plus',
      organization: null,
      refreshedAt: when.toISOString(),
      checkedAt: '2026-09-25T10:00:00.000Z',
      command: null,
    });
    expect(JSON.stringify(account)).not.toContain('rt_x');
  });

  it('falls back to `codex login status` where the app-server cannot answer', async () => {
    const home = await dir();
    const calls: string[][] = [];
    const account = await readRuntimeAccount({
      runtime: 'codex',
      dir: home,
      env: {},
      command: async (bin, args) => {
        calls.push([bin, ...args]);
        return { code: 0, stdout: 'Logged in using ChatGPT', missing: false };
      },
      appServer: async () => {
        throw new Error('unknown method');
      },
    });
    expect(calls).toEqual([['codex', 'login', 'status']]);
    expect(account).toMatchObject({ signedIn: true, method: null, email: null });
  });
});

describe("Claude Code's account", () => {
  it('reads `claude auth status`', () => {
    expect(
      claudeAccountFrom({
        code: 0,
        missing: false,
        stdout: JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'owner@example.com',
          orgName: 'Volition',
          subscriptionType: 'max',
        }),
      }),
    ).toEqual({
      signedIn: true,
      method: 'claude.ai',
      email: 'owner@example.com',
      plan: 'max',
      organization: 'Volition',
    });
    expect(
      claudeAccountFrom({
        code: 0,
        missing: false,
        stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }),
      }),
    ).toMatchObject({ signedIn: false, method: null });
    expect(claudeAccountFrom({ code: 1, missing: false, stdout: 'Not logged in' })).toMatchObject({
      signedIn: false,
    });
    expect(claudeAccountFrom({ code: null, missing: true, stdout: '' }).signedIn).toBeNull();
  });

  it('signs out with the runtime’s own command', () => {
    expect(signOutArgs('claude')).toEqual(['auth', 'logout']);
    expect(signOutArgs('codex')).toEqual(['logout']);
  });
});

describe('login.read in the profile helper', () => {
  it("answers with the account, in the runtime's own directory of the home", async () => {
    const home = await dir();
    const seen: Record<string, string>[] = [];
    const answer = await answerLoginRead(
      { runtime: 'claude', home, env: {} },
      async (_, __, env) => {
        seen.push(env);
        return { code: 0, stdout: JSON.stringify({ loggedIn: false }), missing: false };
      },
    );
    expect(answer.account).toMatchObject({ signedIn: false });
    expect(seen[0]).toMatchObject({
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      DISABLE_AUTOUPDATER: '1',
    });
    await expect(answerLoginRead({ runtime: 'hermes', home, env: {} }, never)).rejects.toThrow(
      /no login of its own/,
    );
  });

  it('knows the login requests, and refuses a sign-out there', async () => {
    expect(isRuntimeRequest({ op: 'login.read' })).toBe(true);
    expect(isRuntimeRequest({ op: 'login.logout' })).toBe(true);
    await expect(
      answerRuntimeRequest(
        { op: 'login.logout' },
        { runtime: 'codex', home: await dir(), cwd: null, env: {} },
      ),
    ).rejects.toThrow(/not answered here/);
  });
});
