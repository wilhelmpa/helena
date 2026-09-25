import { expect } from 'bun:test';
import { settleEvals } from '#modules/local-ai/service';
import type { Api } from './app';

// Runs a local AI eval the way the settings page does: it starts in the background (202,
// `running`), and its score is read once it is done.
export async function evaluateLocalAi(api: Api, body: { classId: string; modelId: string }) {
  const started = await api.god['local-ai'].evals.post(body);
  if (started.status !== 202) throw new Error(`The eval did not start: ${started.status}`);
  expect(started.data).toMatchObject({ status: 'running', classId: body.classId });
  await settleEvals();
  const done = await api.god['local-ai'].evals({ id: started.data!.id }).get();
  return done.data!;
}
