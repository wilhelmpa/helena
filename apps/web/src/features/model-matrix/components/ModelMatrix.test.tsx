import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type {
  MatrixAgentRow,
  MatrixClass,
  MatrixProfile,
  MatrixSchema,
  MatrixValues,
  ModelMatrix,
} from '@/lib/api/endpoints/modelMatrix';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import localAi from '../../../../messages/de/localAi.json';
import common from '../../../../messages/de/common.json';
import { useMatrixLabels } from '../utils/labels';
import { EMPTY_PENDING, setAgentValue } from '../utils/pending';
import { AgentMatrix } from './AgentMatrix';
import { ClassMatrix } from './ClassMatrix';

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" timeZone="Europe/Berlin" messages={{ localAi, common }}>
      {node}
    </NextIntlClientProvider>,
  );

const values: MatrixValues = {
  runtime: 'helena',
  model: 'volition-local-default',
  reasoning: 'high',
  escalation: { target: 'runtime:codex/gpt-6-sol', failures: 2, stalledSteps: 12, onRequest: true },
  browser: 'jev',
  decision: { backend: 'jev-local', threshold: 0.8, fallback: 'gpu', privateData: false },
  device: 'gpu',
};
const cells = (own: string[] = [], over: Partial<MatrixValues> = {}) =>
  Object.fromEntries(
    Object.entries({ ...values, ...over }).map(([key, value]) => [
      key,
      { value, source: own.includes(key) ? 'own' : 'schema' },
    ]),
  ) as MatrixAgentRow['cells'];
const row = (id: number, role: string, over: Partial<MatrixAgentRow> = {}): MatrixAgentRow => ({
  id,
  teamId: 1,
  username: `agent-${id}`,
  role,
  project: null,
  schemaId: 'nur-lokal',
  cells: cells(),
  ...over,
});
const schema: MatrixSchema = {
  id: 'nur-lokal',
  name: 'Nur lokal',
  description: '',
  profile: 'local-halogen',
  roles: { general: values, coder: values, home: values, coordinator: values },
  classes: {},
  npuSlots: 0,
  gpuSlots: 4,
  speechRecognition: 'cpu',
  jevPrivate: true,
};
const profiles: MatrixProfile[] = [];
const matrix: ModelMatrix = {
  revision: 3,
  active: 'nur-lokal',
  schemas: { 'nur-lokal': schema },
  profiles,
  projects: {},
  agents: [
    row(1, 'home'),
    row(2, 'coordinator'),
    row(3, 'coder', {
      cells: cells(['runtime', 'model'], { runtime: 'codex', model: 'gpt-6-sol' }),
    }),
  ],
  classes: [],
  local: { model: null, maintenance: null, job: null },
  browser: null,
};
const agent = (id: number, name: string, role: string | null, isHome = false) =>
  ({ id, name, role, isHome }) as OrganizationAgent;
const agents = [
  agent(1, 'Ava', null, true),
  agent(2, 'Koordinator VOL', 'coordinator'),
  agent(3, 'Coder VOL', 'specialist'),
];

function Harness({
  children,
}: {
  children: (labels: ReturnType<typeof useMatrixLabels>) => React.ReactNode;
}) {
  return <>{children(useMatrixLabels())}</>;
}
const noop = () => {};

describe('Matrix der Agenten', () => {
  const render = (pending = EMPTY_PENDING) =>
    wrap(
      <Harness>
        {(labels) => (
          <AgentMatrix
            matrix={matrix}
            agents={agents}
            pending={pending}
            selected={new Set([3])}
            models={[]}
            labels={labels}
            onSelect={noop}
            onCell={noop}
            onReset={noop}
            onRole={noop}
          />
        )}
      </Harness>,
    );

  it('gruppiert in Home, Koordinatoren und Spezialisten und nennt Agenten beim Namen', () => {
    const html = render();
    assert.match(html, /Home · 1/);
    assert.match(html, /Koordinatoren · 1/);
    assert.match(html, /Spezialisten · 1/);
    assert.match(html, /Coder VOL/);
    assert.doesNotMatch(html, /agent-3/);
  });

  it('zeigt Werte in Worten und nie als Rohwert', () => {
    const html = render();
    assert.match(html, /Lokales Standardmodell/);
    assert.match(html, /Codex/);
    assert.match(html, /GPT-6 Sol/);
    assert.match(html, /an Codex · nach 2 Fehlschlägen · bei Hängern · auf Anfrage/);
    assert.match(html, /Jev, dann lokal · ab 80 %/);
    assert.doesNotMatch(html, /runtime:codex|volition-local-default|jev-local|helena-/);
  });

  it('kennzeichnet eigene Einstellungen und vorgemerkte Änderungen', () => {
    const own = render();
    assert.equal((own.match(/data-kind="own"/g) ?? []).length, 2);
    assert.doesNotMatch(own, /data-kind="changed"/);
    const staged = render(setAgentValue(EMPTY_PENDING, 2, 'reasoning', 'low'));
    assert.match(staged, /data-kind="changed"/);
    assert.match(staged, /Niedrig/);
  });

  it('bietet Auswahl je Zeile und für alle', () => {
    const html = render();
    assert.match(html, /Alle auswählen/);
    assert.match(html, /Coder VOL auswählen/);
  });
});

describe('Matrix der Aufgabenklassen', () => {
  const classes: MatrixClass[] = [
    {
      id: 'triage',
      device: 'npu',
      model: 'qwen3.5:2b',
      eval: 'passed',
      score: 0.94,
      candidates: [{ device: 'npu', model: 'qwen3.5:4b', eval: 'failed' }],
    },
    {
      id: 'summaries',
      device: 'gpu',
      model: 'volition-local-default',
      eval: 'untested',
      candidates: [],
    },
    {
      id: 'helena.mail',
      device: 'cloud',
      model: 'jev-1.13.0',
      eval: 'passed',
      decision: { backend: 'jev-local', threshold: 0.7, fallback: 'gpu', privateData: true },
      candidates: [],
    },
    {
      id: 'embeddings',
      device: 'vulkan',
      model: 'Qwen3-Embedding-0.6B',
      eval: 'failed',
      candidates: [],
    },
  ];
  const html = wrap(
    <Harness>{(labels) => <ClassMatrix classes={classes} labels={labels} />}</Harness>,
  );

  it('zeigt Gerät, Modell und Auswertung mit Wörtern', () => {
    assert.match(html, /Triage und Zuordnung/);
    assert.match(html, /Qwen3\.5 2B/);
    assert.match(html, /bestanden · 94 %/);
    assert.match(html, /durchgefallen/);
    assert.match(html, /offen/);
    assert.match(html, /Mails einordnen/);
    assert.match(html, /Jev, dann lokal · ab 70 %/);
    assert.match(html, /Qwen3 Embedding 0\.6B/);
    assert.doesNotMatch(html, /helena\.mail|jev-1\.13\.0|qwen3\.5:2b/);
  });

  it('nennt weitere getestete Modelle und führt zu den bestehenden Einstellungen', () => {
    assert.match(html, /Qwen3\.5 4B/);
    assert.match(html, /href="\/settings\/local-ai"/);
    assert.match(html, /href="\/settings\/decisions"/);
  });
});
