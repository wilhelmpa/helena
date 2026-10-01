---
name: ava-bedienen-google
description: Google Mail, Kalender, Drive und Docs mit freigegebenem Connector-Konto bedienen.
---

# Ava bedienen: Google

Die `google_*`-Werkzeuge sind nur sichtbar, wenn deinem Agenten ein passendes Google-Konto gewährt wurde. Lies zuerst mit `google_calendar_events` oder `google_drive_search`. Termine erzeugt `google_calendar_create_event`; `google_mail_send` sendet extern. Ein Konto oder OAuth-Client wird nur mit den Rechten der Teamroute geändert.

Beispiel: `google_calendar_events({"projectKey":"VOL","account":"owner@example.com","from":"2026-09-25T00:00:00Z","to":"2026-09-26T00:00:00Z"})`; übernimm Konto und Zeitraum aus dem Auftrag.

## Google-Dateien zuerst über Workspace-Werkzeuge

1. Prüfe `list_connections` im Projekt und verwende das freigegebene Konto aus dem Auftrag; eine vorhandene OAuth-/gog-Verbindung benötigt keine Browser-Anmeldung. Suche fehlende Werkzeuge mit `find_tools`.
2. Finde geteilte Dateien mit `google_drive_search({"projectKey":"FAM","account":"patrick@emrani-wilhelm.de","query":"sharedWithMe and trashed = false"})`. Ordnerinhalt: `query:"'ORDNER_ID' in parents and trashed = false"`; nicht auffindbare Ordner verhindern keine direkte Dateisuche. Nutze `nextPageToken` als `pageToken`, bis die gesuchten Dateien gefunden sind.
3. Lies Inhalte einschließlich PDF-Text mit `google_drive_read`; ein PDF ohne Textebene kann trotzdem kopiert werden.
4. Kopiere mit `google_drive_save_to_vault({"projectKey":"FAM","account":"patrick@emrani-wilhelm.de","fileId":"DATEI_ID","folder":"Files/Belege/2026-07","asReceipt":true})`. Übernimm Projekt, Konto, Datei-ID und Ziel aus dem Auftrag und dem bestätigten Suchergebnis; Google-Dokumente werden als PDF exportiert. Lösche oder teile keine Quelle.
5. Prüfe bestätigte Vault-Pfade und Dateianzahl, bevor du einen Vorgang oder eine Übergabe erledigst. Korrigiere veraltete Erinnerungen, die Downloads nur im Browser erlauben.
6. Nutze den Browser erst als letzten Ausweg nach dokumentiertem API-Fehler und Prüfung der anderen freigegebenen Verbindungen; ein fehlendes Suchergebnis oder eine alte Erinnerung belegt keinen Anmeldebedarf. Nenne bei echten Zugriffsproblemen Datei-ID, Konto, Werkzeug und Fehler.
