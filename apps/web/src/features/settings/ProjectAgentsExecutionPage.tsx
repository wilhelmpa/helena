'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import type { AutopilotLevel } from '@/lib/api/endpoints/autopilot';
import {
  useProjectAutopilot,
  useSetProjectBudgets,
  useSetProjectLevel,
} from '@/services/autopilot.service';
import { inputToLimit, limitToInput } from '@/features/autopilot/utils/autopilotFormat';

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-modal-setting-row">
      <div>
        <p>{label}</p>
        <p>{description}</p>
      </div>
      <div className="settings-modal-setting-control">{children}</div>
    </div>
  );
}

// Project-level controls remain on the existing Autopilot and budget API. The other
// values in the design belong to agents or the instance in today's data model, so
// their rows lead to the existing editor that owns them.
export default function ProjectAgentsExecutionPage() {
  const { project } = useShell();
  const router = useRouter();
  const { can } = usePermissions();
  const projectKey = project?.project.key ?? '';
  const teamId = project?.project.teamId ?? null;
  const editable = can('ai_agents', 'edit');
  const autopilot = useProjectAutopilot(projectKey);
  const setLevel = useSetProjectLevel(projectKey);
  const setBudgets = useSetProjectBudgets(projectKey);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const dayCost = autopilot.data?.budgets.find(
    (item) => item.metric === 'cost' && item.period === 'day',
  );
  const budgetValue = budgetDraft ?? limitToInput('cost', dayCost?.limit);

  async function saveBudget() {
    if (budgetDraft === null) return;
    const limit = inputToLimit('cost', budgetDraft);
    if (limit === undefined) {
      toast.error('Bitte ein gültiges Tagesbudget eingeben.');
      setBudgetDraft(null);
      return;
    }
    if (limit === (dayCost?.limit ?? null)) {
      setBudgetDraft(null);
      return;
    }
    try {
      await setBudgets.mutateAsync([{ metric: 'cost', period: 'day', limit }]);
      setBudgetDraft(null);
      toast.success('Tagesbudget gespeichert.');
    } catch {
      // The global mutation handler shows the API error.
    }
  }

  if (!project) return null;

  const agentsHref = teamId === null ? null : `/account/teams/${teamId}/ai-agents`;
  return (
    <div className="settings-modal-summary">
      <Row
        label="Standard-Ausführung"
        description="Gilt für neue Agenten und Aufgaben in diesem Projekt."
      >
        <button
          type="button"
          className="settings-modal-pill"
          disabled={!agentsHref}
          onClick={() => agentsHref && router.push(agentsHref)}
        >
          <span className="settings-modal-orange-dot" />
          {'Agenten verwalten ▾'}
        </button>
      </Row>
      <Row
        label="Autopilot-Stufe"
        description="3 = handelt selbst im Budget; Zahlungen und Zugangsdaten bleiben immer gesperrt."
      >
        <div className="settings-modal-levels" role="group" aria-label="Autopilot-Stufe">
          {([0, 1, 2, 3] as const).map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={autopilot.data?.level === level}
              disabled={!editable || !autopilot.data || setLevel.isPending}
              onClick={() => {
                void setLevel
                  .mutateAsync(level as AutopilotLevel)
                  .then(() => toast.success('Autopilot-Stufe gespeichert.'))
                  .catch(() => undefined);
              }}
            >
              {level}
            </button>
          ))}
        </div>
      </Row>
      <Row
        label="Tagesbudget"
        description="Danach wird gedrosselt und du bekommst einen Eintrag in der Inbox."
      >
        <label className="settings-modal-budget-pill">
          <input
            aria-label="Tagesbudget in Euro"
            inputMode="decimal"
            value={budgetValue}
            placeholder="–"
            disabled={!editable || !autopilot.data || setBudgets.isPending}
            onChange={(event) => setBudgetDraft(event.target.value)}
            onBlur={() => void saveBudget()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          {'€ / Tag'}
        </label>
      </Row>
      <Row
        label="Lokale KI für Hintergrundaufgaben"
        description="Zusammenfassungen, Einordnung und Vorprüfungen laufen auf Qwen; bei Ausfall die Cloud."
      >
        <span className="settings-modal-external">{'Instanzweit'}</span>
      </Row>
      <Row
        label="Jev-Vorstufe für News"
        description="Schnelle Einordnung vor dem Agenten, mit Rückfall bei Unsicherheit."
      >
        <span className="settings-modal-external">{'Instanzweit'}</span>
      </Row>
      <Row
        label="Gedächtnis ohne Freigabe"
        description="Agenten dürfen Erinnerungen direkt speichern."
      >
        <button
          type="button"
          className="settings-modal-external"
          disabled={!agentsHref}
          onClick={() => agentsHref && router.push(agentsHref)}
        >
          {'Je Agent ▾'}
        </button>
      </Row>
      <p className="settings-modal-summary-note">
        {
          'Änderungen werden sofort gespeichert. Home kann Werte für alle Projekte vorgeben; hier überschriebene Werte sind markiert.'
        }
      </p>
    </div>
  );
}
