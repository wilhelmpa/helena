---
name: ava-bedienen-zeitplaene
description: Helena-Routinen und geplante Agentenarbeit lesen, prüfen und verwalten.
---

# Ava bedienen: Zeitpläne

Nutze `list_routines` für Cron, Zeitzone, nächsten und letzten Lauf eines Projekts. `list_routine_runs` zeigt die Ausführung einer Routine. Prüfe mit `preview_routine_mentions`, welche weiteren Agenten in den Anweisungen erwähnt werden.

Beispiel: `list_routines({"projectKey":"VOL"})`. Für `create_routine` und `update_routine` müssen Agent, Aufgabe, Cron-Ausdruck und Zeitzone zum Auftrag passen. `run_routine` startet sofort und kann eine Aufgabe samt Agentenlauf auslösen; nutze es nur auf ausdrücklichen Auftrag.
