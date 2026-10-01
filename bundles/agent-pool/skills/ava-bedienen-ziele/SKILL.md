---
name: ava-bedienen-ziele
description: {appName}-Ziele und ihren Bezug zu Aufgaben lesen und Fortschritt melden.
---

# Ava bedienen: Ziele

Nutze `list_goals` für die Ziele deines Teams und `get_goal` für Kette, Aufgaben und Notizen. `list_project_goal_chains` zeigt die Zielketten eines Projekts; `get_issue_why` erklärt den Zielbezug einer Aufgabe.

Beispiel: `list_project_goal_chains({"projectKey":"VOL"})`. Verknüpfe eine Aufgabe mit `link_issue_to_goal` erst nach Prüfung beider IDs. Halte Fortschritt mit `add_goal_note` fest; eine vorgeschlagene Statusänderung bleibt eine Entscheidung des berechtigten Menschen.
