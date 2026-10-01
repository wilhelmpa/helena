---
name: ava-bedienen-aufgaben
description: {appName}-Aufgaben suchen, lesen, ändern, archivieren und ihre Abläufe prüfen.
---

# Ava bedienen: Aufgaben

Nutze diesen Skill für Aufgaben und Unteraufgaben in einem Projekt. Suche mit `search_issues` oder `list_issues`, lies Details mit `get_issue` und Statusverlauf mit `get_issue_status_timeline`. `list_issue_checklists` liefert die Schritte; `list_issue_cycle_history` zeigt frühere Zyklen.

Beispiel: `list_archived_issues({"projectKey":"VOL"})` liest das Archiv. `bulk_update_issues` ändert dieselben Felder für mehrere IDs im angegebenen Projekt. Prüfe IDs und Patch vor einem Sammelaufruf; `bulk_archive_issues` und `bulk_delete_issues` wirken auf alle genannten Aufgaben. Ein Agententeam startest du mit `start_issue_agent_team` nur auf ausdrücklichen Arbeitsauftrag.
