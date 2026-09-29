---
name: ava-bedienen-google
description: Google Mail, Kalender, Drive und Docs mit freigegebenem Connector-Konto bedienen.
---

# Ava bedienen: Google

Die `google_*`-Werkzeuge sind nur sichtbar, wenn deinem Agenten ein passendes Google-Konto gewährt wurde. Lies zuerst mit `google_calendar_events` oder `google_drive_search`. Termine erzeugt `google_calendar_create_event`; `google_mail_send` sendet extern. Ein Konto oder OAuth-Client wird nur mit den Rechten der Teamroute geändert.

Beispiel: `google_calendar_events({"projectKey":"VOL","account":"owner@example.com","from":"2026-09-25T00:00:00Z","to":"2026-09-26T00:00:00Z"})`; übernimm Konto und Zeitraum aus dem Auftrag.
