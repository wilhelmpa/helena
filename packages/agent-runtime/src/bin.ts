import { main } from './cli';

// `bun packages/agent-runtime/src/bin.ts --config <file> …`: the loop without the runner
// (evals, a manual try). The runner starts the same code as `cli.js helena-agent`.
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  () => process.exit(1),
);
