import { mock } from 'bun:test';
import assert from 'node:assert/strict';

let acquired = true;
let held = false;
let filesystemError: string | null = null;
let transactionOpen = false;
let transactions = 0;
let tokens = 0;
let simulateLoss = false;
let loseConnection!: () => void;
mock.module('@repo/db', () => ({
  db: {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      transactionOpen = true;
      transactions++;
      try {
        const operation = work({ execute: async () => [{ acquired }] });
        return await (simulateLoss
          ? Promise.race([
              operation,
              new Promise((_, reject) => {
                loseConnection = () => reject(new Error('database disconnected'));
              }),
            ])
          : operation);
      } finally {
        transactionOpen = false;
      }
    },
  },
}));
mock.module('../../maintenance-state', () => ({
  registerTranscription: async () => {
    tokens++;
    return async () => {
      tokens--;
    };
  },
  voiceMaintenanceHeld: async () => {
    if (filesystemError) throw Object.assign(new Error('fixture'), { code: filesystemError });
    return held;
  },
}));
const { withTranscriptionAdmission } = await import('../../maintenance');

let finish!: (value: string) => void;
let entered!: () => void;
const started = new Promise<void>((resolve) => {
  entered = resolve;
});
const work = withTranscriptionAdmission(() => {
  assert(transactionOpen);
  entered();
  return new Promise<string>((resolve) => {
    finish = resolve;
  });
});
await started;
assert(transactionOpen, 'Admission must remain held through the full response body');
assert.equal(tokens, 1);
finish('transcript');
assert.equal(await work, 'transcript');
assert.equal(tokens, 0);
assert.equal(transactionOpen, false);

simulateLoss = true;
let finishLost!: (value: string) => void;
let enteredLost!: () => void;
const lostStarted = new Promise<void>((resolve) => {
  enteredLost = resolve;
});
const lostWork = withTranscriptionAdmission(() => {
  enteredLost();
  return new Promise<string>((resolve) => {
    finishLost = resolve;
  });
});
await lostStarted;
loseConnection();
await assert.rejects(lostWork, /database disconnected/);
assert.equal(transactionOpen, false);
assert.equal(tokens, 1, 'Request admission survives loss of the outer DB transaction');
finishLost('completed after connection loss');
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(tokens, 0, 'Only actual completed body work may release its token');
simulateLoss = false;

await assert.rejects(
  withTranscriptionAdmission(async () => {
    throw new Error('upstream failed');
  }),
  /upstream failed/,
);
assert.equal(transactionOpen, false, 'Rejected requests release the transaction');
assert.equal(tokens, 1, 'Uncertain backend completion must retain the request token');

for (const state of ['busy', 'hold', 'unreadable']) {
  acquired = state !== 'busy';
  held = state === 'hold';
  filesystemError = state === 'unreadable' ? 'EACCES' : null;
  let called = false;
  await assert.rejects(
    withTranscriptionAdmission(async () => {
      called = true;
    }),
  );
  assert.equal(called, false, state);
  assert.equal(transactionOpen, false);
}
assert.equal(transactions, 6);
console.log('voice admission lifecycle: PASS');
