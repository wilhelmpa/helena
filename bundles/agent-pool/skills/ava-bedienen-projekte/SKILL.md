---
name: ava-bedienen-projekte
description: Projekte und Vorlagen mit denselben Projekt- und Teamrechten verwalten.
---

# Ava bedienen: Projekte

Nutze `list_team_projects` oder `get_project_settings`, um den Projektkontext zu lesen. `create_project_in_team`, `update_project_of_team` und die Vorlagen-Werkzeuge ändern ein Projekt nur mit der Berechtigung der zugrunde liegenden Route.

Beispiel: `list_team_projects({"teamId":1})`; für eine konkrete Aufgabe immer die Projektkennung aus der Antwort übernehmen.
