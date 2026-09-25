// Imports a Google OAuth client file into a team's access center from the console, the same
// way Zugänge → Google → "OAuth-Client-JSON importieren" does. For a headless install or a
// browser that cannot hand a file to the page. The file comes on stdin, never as an argument,
// and nothing of it but the client id is printed:
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=<checkout>/apps/api \
//     bun src/scripts/import-google-client.ts --team 1 --by <owner address> < client_secret_….json
import { importGoogleClient } from '#modules/connectors/google/service';
import { recordOwnerChange } from '#modules/agents/credentials/audit';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<number> {
  const teamId = Number(argValue('--team'));
  const by = argValue('--by')?.trim() || null;
  if (!Number.isInteger(teamId) || teamId <= 0) {
    console.error(
      'usage: import-google-client.ts --team <id> [--label <name>] [--by <address>]   (the file on stdin)',
    );
    return 2;
  }
  const json = await Bun.stdin.text();
  const client = await importGoogleClient(teamId, {
    json,
    label: argValue('--label') ?? undefined,
    engine: 'helena',
  });
  if (!client) {
    console.error('Nothing imported.');
    return 1;
  }
  await recordOwnerChange(teamId, client.id, { email: by, name: by }, 'created');
  console.log(`Imported OAuth client ${client.clientId} as #${client.id} (${client.type}).`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
