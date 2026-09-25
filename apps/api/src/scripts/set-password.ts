// Sets a person's Helena password from the console: for an owner who cannot sign in with the
// old one while the instance has no mail provider for a reset link. It does what a reset link
// does (better-auth's own length limits, hash and credential account; every session of that
// person ends), without a token. The password comes on stdin, never on the command line, so it
// is not visible in the process list; the console wrapper asks for it hidden:
//
//   sudo deployment/volition-stack/native/local-owner/set-password.sh <email>
//
// or, as the API's user with the API's env:  <password on stdin> | bun src/scripts/set-password.ts --email <address>
import { auth } from '@repo/auth';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<number> {
  const email = argValue('--email')?.trim().toLowerCase();
  if (!email) {
    console.error('usage: set-password.ts --email <address>   (the password on stdin)');
    return 2;
  }
  const password = (await Bun.stdin.text()).replace(/\r?\n$/, '');
  const ctx = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength) {
    console.error(`The password needs at least ${minPasswordLength} characters; nothing changed.`);
    return 1;
  }
  if (password.length > maxPasswordLength) {
    console.error(
      `The password may have at most ${maxPasswordLength} characters; nothing changed.`,
    );
    return 1;
  }
  const found = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  if (!found) {
    console.error(`No account with the address ${email}; nothing changed.`);
    return 1;
  }
  const userId = found.user.id;
  const hash = await ctx.password.hash(password);
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  if (accounts.some((account) => account.providerId === 'credential')) {
    await ctx.internalAdapter.updatePassword(userId, hash);
  } else {
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hash,
    });
  }
  await ctx.internalAdapter.deleteUserSessions(userId);
  console.log(`Password set for ${email}; every session of this account ended.`);
  return 0;
}

process.exit(await main());
