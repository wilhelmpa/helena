---
name: ava-bedienen-workflows
description: Workflows, Vorlagen und Läufe in Projekten lesen und ausführen.
---

# Ava bedienen: Workflows

Beginne mit `list_workflows_of_project`, dann `get_workflow`. `validate_workflow_in_project` prüft eine Vorlage. `start_workflow_on_issue` und `run_manual_action` lösen Arbeit aus; prüfe vorher Ziel, Parameter und Freigabebedarf.

Beispiel: `list_workflows_of_project({"projectKey":"VOL"})`, danach einen Lauf mit `get_workflow_run` verfolgen.
