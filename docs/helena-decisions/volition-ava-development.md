# Ava: Root und Entwicklungsaufträge

Home auf der nativen Laufzeit `helena` führt Root-Befehle ohne Freigabe aus, wenn
`enabled` und `unrestricted` aktiviert sind. `unrestricted` ist auch bei vorhandenen
hostd-Einstellungen ohne dieses Feld standardmäßig an. Die Herkunft, Laufzeit,
Taint-Quellen, Agent/Run/Chat und das Ergebnis bleiben im Root-Audit. `directOnly`
gilt im eingeschränkten Modus; der Hauptschalter und die Epoch-Prüfung widerrufen
Root-Zugriff weiterhin. Andere Rollen und Laufzeiten behalten ihre Policy.

Das native Home-Profil ist `voll`; `run_as_root` wird direkt angeboten. Home-Aktionen
folgen der Owner-Regel „keine Blockaden oder Genehmigungen, nur Audit“: eigene
Genehmigungsanfragen erhalten sofort den Status `approved`, ohne Benachrichtigung
oder wartende Karte. Budgetverbrauch wird weiter erfasst, pausiert Home aber nicht.
Die bereits vorhandene Home-Policy erlaubt auch die Kategorien `pay` und
`credentials`; deren frühere allgemeinen Freigaberegeln werden für Home nicht
wieder eingeführt. Andere Agenten behalten ihre Genehmigungs- und Budgetregeln.

Die neuen Werkzeuge sind nur für den Home-Agenten des Instanz-Owners verfügbar:

| MCP-Werkzeug | API | hostd |
| --- | --- | --- |
| `enqueue_codex_task` | POST `/agent-development/tasks` | `DevelopmentEnqueue` |
| `get_codex_queue` | GET `/agent-development/status` | `DevelopmentStatus` |
| `read_codex_report` | GET `/agent-development/reports/:number` | `DevelopmentReport` |
| `get_development_release` | GET `/agent-development/release` | `DevelopmentRelease` |

hostd verwendet ausschließlich den konfigurierten `development.workDir`
(Standard `/home/wilhelmpa/agent-work`) und die feste Unterablage `codex-tasks`.
API-Parameter bestimmen keine Pfade. Dateinamen, Nummern, Modell, Denktiefe und
Auftragslänge werden validiert; Verzeichnis-Symlinks und verlinkte oder nicht
reguläre Dateien werden abgewiesen. Die nächste Nummer folgt auf die größte
bereits belegte Auftrags-/Berichtsnummer. Die Auftragsdatei enthält den Modell-
und Denktiefe-Kopf und gehört dem Ablagebenutzer. Der Broker serialisiert
Einreihungen mit `.volition-queue.lock`.

Der Status liefert queue.txt, den begrenzten Schluss von queue.log und
PID/Auftragsnummer laufender Codex-Aufträge. Gate-Daten bestehen aus den letzten
Zusammenfassungen von `api-full.log`, `web-full.log` und `extra-full.log` samt
Änderungszeit; es werden keine vollständigen Testlogs weitergereicht. `liveSha`
ist der HEAD von `/srv/volition/source/plan`, kein Nachweis eines abgeschlossenen
Deploys oder der Zuordnung eines Gate-Laufs zu diesem SHA.

## Einspielen durch Claude/Owner

1. Branch integrieren und den Vollgate durch Claude durchführen lassen.
2. Vor Aktivierung der Einreihung im vorhandenen unversionierten
   `~/agent-work/codex-tasks/queue-runner.sh` die Zeile `sed -i 1d queue.txt` durch
   `flock .volition-queue.lock sed -i 1d queue.txt` ersetzen und den Queue-Runner
   zwischen Aufträgen neu starten. Der Runner muss dieselbe Sperre beim Entfernen
   verwenden, damit `sed -i` keine parallele Einreihung verliert; andere manuelle
   Queue-Schreibzugriffe müssen ebenfalls diese Sperre nehmen.
3. Den vorhandenen hostd-Installer aus dem integrierten Checkout als Operator
   ausführen: `deployment/volition-stack/native/server/install.sh --owner wilhelmpa install`.
   Er installiert das zusätzliche Python-Modul und startet hostd neu; vorhandene
   Konfiguration bleibt erhalten. Für einen abweichenden Ablagepfad setzt der
   Operator `development.workDir` in der hostd-Konfiguration.
4. API/Web/Runner über den üblichen Releaseweg einspielen, das neue Home-Profil
   übernehmen lassen und `enabled=true`, `unrestricted=true` über die bestehende
   Sicherheits-Seite prüfen. Bereits wegen Budget erschöpfte Home-Agenten kann
   der Owner über den vorhandenen Fortsetzen-Schalter wieder starten.
5. Den lokalen Skill `bundles/agent-pool/skills/ava-entwicklung/SKILL.md` über die
   vorhandene Skill-/Bundle-Verwaltung importieren und Ava/Home zuweisen.
6. Mit Ava einen begrenzten Probeauftrag einreihen, Status und Bericht lesen und
   den Root-Widerruf prüfen. Aufträge zusammenführen und einspielen bleibt Aufgabe
   von Claude/Owner.

Die Oberfläche ergänzt ausschließlich den Schalter im bestehenden
`GodRootAccess` mit `SettingsRow` und `Switch` aus `@/design-system`; sie benötigt
keinen neuen Stil oder Seitenentwurf.
