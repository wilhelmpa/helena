import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_POLICY,
  parseStage,
  stagePrompt,
  type TeamPayload,
} from '../../builtin/steps/agent-team-contract';

const agent = { agentRef: 'agent:research', role: 'specialist', capabilities: [] };
const team: TeamPayload = {
  schemaVersion: 1,
  task: {
    taskRef: 'task:VOL-27',
    title: 'Astro',
    objective: 'Research Astro.',
    acceptanceCriteria: ['Cite docs.astro.build.'],
    labels: [],
  },
  coordinator: { ...agent, agentRef: 'agent:lead', role: 'coordinator' },
  specialists: [agent],
  policy: DEFAULT_POLICY,
  execution: {},
};
const stage = { phase: 'specialize' as const, team, agent };

describe('battle-test F1 stage answers', () => {
  it('repairs the reported mixed German opening quote and ASCII closing quote', () => {
    expect(
      parseStage(stage, '{"summary":"Move to „In Prüfung" after research.","evidence":[]}').summary,
    ).toBe('Move to „In Prüfung" after research.');
    expect(parseStage(stage, '{„summary":„In Prüfung",„evidence":[]}').summary).toBe('In Prüfung');
  });
  it('reads fenced JSON with prose around it and preserves valid typographic text', () => {
    const answer = { summary: 'Astro uses “islands” with {client:load}.', evidence: [] };
    expect(
      parseStage(stage, `Research complete.\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\nEnd.`)
        .summary,
    ).toBe(answer.summary);
  });
  it('maps the reported source evidence to link without losing the researched result', () => {
    expect(
      parseStage(
        stage,
        JSON.stringify({
          summary: 'Astro documentation checked.',
          evidence: [
            { kind: 'source', ref: 'https://docs.astro.build/', label: 'Astro documentation' },
          ],
        }),
      ).evidence,
    ).toEqual([{ kind: 'link', ref: 'https://docs.astro.build/', label: 'Astro documentation' }]);
  });
  it('uses a reference as the missing label and infers a missing kind from a URL', () => {
    expect(
      parseStage(
        stage,
        JSON.stringify({ summary: 'Checked.', evidence: [{ ref: 'https://docs.astro.build/' }] }),
      ).evidence,
    ).toEqual([
      { kind: 'link', ref: 'https://docs.astro.build/', label: 'https://docs.astro.build/' },
    ]);
  });
  it('rejects ambiguous objects, unsupported kinds and excessive arrays with useful errors', () => {
    expect(() => parseStage(stage, '{"summary":"one"}\n{"summary":"two"}')).toThrow(
      'one JSON object',
    );
    expect(() =>
      parseStage(
        stage,
        JSON.stringify({
          summary: 'Done.',
          evidence: [{ kind: 'source', ref: 'no-url', label: 'Source' }],
        }),
      ),
    ).toThrow('evidence[0].kind');
    expect(() =>
      parseStage(
        stage,
        JSON.stringify({
          summary: 'Done.',
          evidence: Array(101).fill({ kind: 'comment', ref: 'note', label: 'Note' }),
        }),
      ),
    ).toThrow('100');
  });
  it('documents every evidence kind and its limits', () => {
    const prompt = stagePrompt(stage, 'project:VOL');
    for (const word of ['comment', 'artifact', 'test', 'link', '2000', '300', '4000', '100'])
      expect(prompt).toContain(word);
    expect(prompt).toContain('https://docs.astro.build/');
  });
});
