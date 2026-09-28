'use client';

import Link from 'next/link';
import { useShell } from '@/context/shellContext';

const groups = {
  tools: [
    ['Browser', 'Browserzugriff und Steuerung der Agenten einstellen.', 'settings/browser'],
    ['Netzwerk', 'Netzwerkzugriff und Ausnahmen verwalten.', 'settings/network'],
    ['Umgebung', 'Umgebungsvariablen für Agenten verwalten.', 'settings/environment'],
    ['Aktionen', 'Aktionen und Abläufe verwalten.', 'settings/actions'],
  ],
  knowledge: [
    ['Wissen', 'Dateien und Dokumente dieses Projekts verwalten.', 'files'],
    ['Belege', 'Entscheidungen und Belege prüfen.', 'receipts'],
  ],
  integrations: [
    ['Git', 'Repositorys und Automatisierungen verwalten.', 'settings/git'],
    ['Webhooks', 'Ereignisse an externe Dienste senden.', 'settings/webhooks'],
    ['MCP-Zugänge', 'MCP-Zugriff für das Projekt verwalten.', 'mcp'],
  ],
} as const;

export default function ProjectSettingsLinksPage({ slug }: { slug: keyof typeof groups }) {
  const { project } = useShell();
  if (!project) return null;
  return (
    <div className="settings-modal-summary">
      {groups[slug].map(([label, description, path]) => (
        <Link
          key={path}
          href={
            path.startsWith('/')
              ? path
              : `/project/${encodeURIComponent(project.project.key)}/${path}`
          }
          className="settings-modal-setting-row"
        >
          <span>
            <span>{label}</span>
            <span>{description}</span>
          </span>
          <span className="settings-modal-external">{'Öffnen ›'}</span>
        </Link>
      ))}
    </div>
  );
}
