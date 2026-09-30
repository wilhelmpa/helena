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
  SchemaCatalogModel,
} from '@/lib/api/endpoints/modelMatrix';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import localAi from '../../../../messages/de/localAi.json';
import common from '../../../../messages/de/common.json';
import { useMatrixLabels } from '../utils/labels';
import { EMPTY_PENDING, setAgentValue } from '../utils/pending';
import { AgentMatrix } from './AgentMatrix';
import { ClassMatrix } from './ClassMatrix';
import { MatrixHeader } from './MatrixHeader';
import { SchemaCard } from './SchemaCard';
import { SchemaRoleCard } from './SchemaRoleCard';

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
  undo: { depth: 0, steps: [] },
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

describe('Kopf: Rückgängig über die Historie des Servers', () => {
  const header = (undoSteps: number) =>
    wrap(
      <Harness>
        {(labels) => (
          <MatrixHeader
            matrix={{
              ...matrix,
              profiles: [{ id: 'local-halogen', name: 'Lokal Halogen' } as MatrixProfile],
            }}
            pending={EMPTY_PENDING}
            project={null}
            labels={labels}
            onProfile={noop}
            onProjectSchema={noop}
            onUndo={noop}
            undoSteps={undoSteps}
          />
        )}
      </Harness>,
    );

  it('bietet beide lokalen Profile auch bei einem mitgelieferten Schema an', () => {
    const html = wrap(
      <Harness>
        {(labels) => (
          <MatrixHeader
            matrix={{
              ...matrix,
              schemas: { ...matrix.schemas, 'nur-lokal': { ...schema, builtIn: true } },
              profiles: [
                { id: 'local-halogen', name: 'Lokal Halogen' },
                { id: 'local-27b-npu', name: 'Lokal 27B + NPU' },
              ] as MatrixProfile[],
            }}
            pending={EMPTY_PENDING}
            project={null}
            labels={labels}
            onProfile={noop}
            onProjectSchema={noop}
            onUndo={noop}
            undoSteps={0}
          />
        )}
      </Harness>,
    );
    assert.match(html, /role="tablist"/);
    assert.match(html, /Lokal 27B \+ NPU/);
  });

  it('nennt, wie viele Schritte der Server zurücknehmen kann', () => {
    assert.match(header(4), /bis zu 4 Schritte/);
    assert.doesNotMatch(header(4), /Noch nichts zum Rückgängigmachen/);
  });

  it('ist ausgegraut, solange nichts zurückzunehmen ist', () => {
    const html = header(0);
    assert.match(html, /Noch nichts zum Rückgängigmachen/);
    assert.match(html, /disabled=""/);
  });
});

describe('Schemata als Karten', () => {
  const custom: MatrixSchema = {
    ...schema,
    id: 'eigenes',
    name: 'Mein Mix',
    description: 'Routine lokal, der Rest Codex.',
    roles: { general: values, coder: { ...values, runtime: 'codex', model: 'gpt-6-sol' } },
  };
  const card = (over: Partial<Parameters<typeof SchemaCard>[0]> = {}) =>
    wrap(
      <Harness>
        {(labels) => (
          <SchemaCard
            schema={custom}
            labels={labels}
            active={false}
            activating={false}
            projects={[]}
            selected={false}
            onSelect={noop}
            onActivate={noop}
            onCopy={noop}
            onEdit={noop}
            onDelete={noop}
            {...over}
          />
        )}
      </Harness>,
    );

  it('nennt Name, Beschreibung, Rollen und Laufzeiten', () => {
    const html = card();
    assert.match(html, /Mein Mix/);
    assert.match(html, /Routine lokal, der Rest Codex\./);
    assert.match(html, /2 Rollen/);
    assert.match(html, /Ava-Laufzeit, Codex/);
    assert.match(html, /Eigenes/);
    assert.match(html, /Rollen bearbeiten/);
    assert.match(html, /Aktivieren/);
  });

  it('zeigt, ob das Schema aktiv ist oder gerade dazu gewählt wurde', () => {
    assert.match(card({ active: true }), /Aktiv/);
    assert.doesNotMatch(card({ active: true }), /Aktivieren/);
    const staged = card({ activating: true });
    assert.match(staged, /Wird aktiviert/);
    assert.match(staged, /Aktivierung zurücknehmen/);
  });

  it('ein mitgeliefertes Schema wird nur angesehen und trägt unsere Beschreibung', () => {
    const html = card({ schema: { ...schema, builtIn: true } });
    assert.match(html, /Mitgeliefert/);
    assert.match(html, /Rollen ansehen/);
    assert.match(html, /Alle Agenten laufen lokal/);
  });

  it('nennt die Projekte, die dem Schema folgen', () => {
    const html = card({ projects: ['VOL', 'FAM'] });
    assert.match(html, /2 Projekte/);
    assert.match(html, /title="VOL, FAM"/);
  });
});

describe('Rollen eines Schemas als Karten', () => {
  const catalog: SchemaCatalogModel[] = [
    {
      id: 'volition-local-default',
      name: '',
      runtime: 'helena',
      reasoning: false,
      thinkingLevels: [],
      thinkingDefault: null,
    },
    {
      id: 'gpt-6-sol',
      name: 'GPT-6 Sol',
      runtime: 'codex',
      reasoning: true,
      thinkingLevels: ['low', 'high'],
      thinkingDefault: null,
    },
  ];
  const role = (over: Partial<Parameters<typeof SchemaRoleCard>[0]> = {}) =>
    wrap(
      <Harness>
        {(labels) => (
          <SchemaRoleCard
            roleId="coder"
            values={{ ...values, runtime: 'codex', model: 'gpt-6-sol', reasoning: null }}
            staged={new Set()}
            added={false}
            editable
            catalog={catalog}
            labels={labels}
            onChange={noop}
            onReset={noop}
            onDiscard={noop}
            {...over}
          />
        )}
      </Harness>,
    );

  it('zeigt jede Spalte der Rolle in Worten', () => {
    const html = role();
    assert.match(html, /Coder/);
    for (const column of [
      'Laufzeit',
      'Modell',
      'Denktiefe',
      'Eskalation',
      'Browser-Steuerung',
      'Entscheider',
      'Gerät',
    ])
      assert.match(html, new RegExp(column));
    assert.match(html, /GPT-6 Sol/);
    assert.match(html, /Standard des Modells/);
    assert.doesNotMatch(html, /volition-local-default|runtime:codex/);
  });

  it('ein eigenes Schema bietet die Werte als Knöpfe an', () => {
    assert.match(role(), /ds-matrix-cell/);
  });

  it('ein mitgeliefertes Schema zeigt die Werte nur', () => {
    const html = role({ editable: false });
    assert.doesNotMatch(html, /ds-matrix-cell"/);
    assert.match(html, /ds-matrix-value/);
    assert.match(html, /GPT-6 Sol/);
  });

  it('bietet Entfernen nur für gespeicherte Zusatzrollen an', () => {
    assert.match(role({ onRemove: noop }), /Entfernen/);
    assert.doesNotMatch(role({ roleId: 'general', onRemove: noop }), /Entfernen/);
    assert.doesNotMatch(role({ added: true, onRemove: noop }), /Entfernen/);
  });

  it('kennzeichnet geänderte Zellen und neue Rollen', () => {
    const changed = role({ staged: new Set(['reasoning'] as const) });
    assert.match(changed, /data-kind="changed"/);
    assert.match(changed, /Geändert/);
    const added = role({ added: true });
    assert.match(added, /Neu/);
    assert.match(added, /Verwerfen/);
  });
});
