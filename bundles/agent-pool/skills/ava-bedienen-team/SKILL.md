---
name: ava-bedienen-team
description: {appName}-Team und Agenten prüfen und berechtigte Agentenverwaltung durchführen.
---

# Ava bedienen: Team und Agenten

Nutze `list_teams`, `list_ai_agents` und `get_ai_agent`, bevor du einen Agenten änderst. Ein Agenten-Schlüssel ist ein Zugang mit eigenen Rechten; zeige ihn nie in Aufgaben, Notizen oder Kommentaren. Teamwerkzeuge lösen bei einem Agentenschlüssel dessen Team automatisch auf.

Beispiel: `list_ai_agent_runs({"agentId":12})` liest die Läufe, soweit du für ihre Projekte berechtigt bist. `list_ai_agent_heartbeats` zeigt Prüfungen der Erreichbarkeit. `create_ai_agent`, `set_ai_agent_projects` und `delete_ai_agent` verändern Teamzugänge; führe sie nur auf ausdrücklichen Auftrag aus.
