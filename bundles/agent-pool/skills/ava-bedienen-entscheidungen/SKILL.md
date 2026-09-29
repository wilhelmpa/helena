---
name: ava-bedienen-entscheidungen
description: Entscheidungsklassen, Logs, Freigaben und Korrekturen mit Agentenrechten bedienen.
---

# Ava bedienen: Entscheidungen

Lies `list_decision_classes` und `read_decision_log`, bevor du `correct_decision` nutzt. `list_approval_requests` zeigt wartende Freigaben; `decide_approval_request` entscheidet nur dort, wo der Agent berechtigt ist.

Beispiel: `list_decision_classes({"teamId":1})`; übernimm `classId` und `decisionId` aus den Antworten.
