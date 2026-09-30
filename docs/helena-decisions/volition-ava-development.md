# Ava entwickelt Ava

Home besitzt auf der eigenen Laufzeit `helena`, Claude Code und Codex dieselben Rechte in Chat, Aufgaben und Owner-Terminals; im uneingeschränkten Modus benötigt Root keine Genehmigung.
`enabled`, `unrestricted`, Herkunfts-/Taint-Audit und Epoch-Widerruf bleiben erhalten.
Andere Rollen behalten ihre Regeln; der Entwicklungskoordinator delegiert privilegierte Schritte an Home.

## Werkzeuge und Belege

Die vorhandenen Werkzeuge `enqueue_codex_task`, `get_codex_queue`, `read_codex_report` und `get_development_release` sind um folgende Home-Werkzeuge ergänzt:

| MCP | API | hostd |
| --- | --- | --- |
| `run_development_operation` | POST `/agent-development/operations` | DevelopmentWorktree/Merge/Review/Gate/Tests/Build/Probe/Deploy/Verify |
| `get_development_job` | GET `/agent-development/jobs/:id` | DevelopmentJob |
| `control_codex_task` | POST `/agent-development/tasks/:number/control` | DevelopmentQueueControl |
| `set_codex_maximum` | POST `/agent-development/queue/maximum` | DevelopmentMax |
| `configure_development_project` | POST `/agent-development/project` | vorhandene Projekt-/Agenten-/Skill-/Wissensdienste; Root-Audit |

`operation` wählt `worktree`, `merge`, `review`, `gate`, `tests`, `build`, `probe`, `deploy` oder `verify`.
Alle Schritte nennen einen `hub/...`-Branch und die volle `expected`-SHA; `dryRun=true` plant nur, `dryRun=false` startet den echten Job.
Worktrees verlangen `target` und `name`, Merge-Proben `target`, Reviews `evidence`, gezielte Tests `testFiles`.
Build/Deploy können `pauseHalogen=true` setzen.
Jobs laufen in eigenen systemd-Units, liefern sofort eine ID und lassen sich mit `get_development_job` verfolgen.
Audit enthält Aufrufer, Parameter und Erfolg des Werkzeugaufrufs sowie den Abschluss des Jobs.
Jobberichte liegen unter `<hostd.stateDir>/volition-development/<id>-bericht.md`; ihre Inhalte liefert das Job-Werkzeug.

Echte Build-/Probe-/Deploy-Jobs verlangen erfolgreiche echte Review- und Gate-Jobs für exakt denselben Commit; Probe/Deploy zusätzlich Build, Deploy zusätzlich Probe.
Ein fehlgeschlagener oder trockener Gate autorisiert keinen Release.
Der Gate führt `~/agent-work/full-test.sh <volle SHA>` unter `flock -n ~/agent-work/.volition-full-test.lock` aus.
Gezielte Tests verwenden eine eigene abgetrennte Arbeitskopie, Offline-Abhängigkeiten, `heavy.sh` und eine explizit konfigurierte private Loopback-Testdatenbank.
Der Artefakt-Build verwendet `native/web-artifact.py --offline` unter `heavy.sh`.
Der Probestart verifiziert das Artefakt, kopiert Standalone/Static/Public in eine eigene Probe-Arbeitskopie und verlangt HTTP 200 auf `127.0.0.1:3091/login` von der eigenen aktiven Probe-Unit.
Ein belegter Port wird abgewiesen; das Artefakt wird beim Probestart nicht verändert.

Vor Deploy und Halogen-Pause wartet der Job bis zu fünf Minuten auf ruhende Agentenarbeit; Root-Widerruf beendet das Warten.
Der anfordernde Home-Lauf muss dafür seinen Turn beenden; kontinuierliches Polling auf der lokalen Laufzeit hält den Job zurück.
Die Pause verlangt keine pending Agentenläufe/streaming Chats, Priority active/queued jeweils null und eine freie `halogen-bench.lock`.
Stoppreihenfolge: TTS-Proxy, TTS, Halogen; Wiederherstellung vorher aktiver Dienste: TTS-Proxy, Halogen, TTS.
Die Dienste werden im Fehlerfall wiederhergestellt; `ExecStopPost` übernimmt die Wiederherstellung auch nach einem beendeten Worker.
Deploy nutzt `deploy.sh --expect <volle SHA> --web-artifact <verifiziertes Artefakt> --wait-inflight 0 <branch>`.
Nachprüfung verlangt einen erfolgreichen Deploy, übereinstimmende Live-HEAD/Deploy-Marker und Smoke auf `/login`, `/`, `/chat` sowie `~/volition/tools/integrity.sh`.
Unauthentifizierte 302/307-Weiterleitungen auf `/` und `/chat` werden im Bericht als Weiterleitungen ausgewiesen.

## Owner-Terminals

Alle Claude-, Codex-, Flash- und 27B-Tabs erhalten denselben `volition`-MCP-Server und die Quelle `~/volition/CLAUDE.md` als Handoff.
Der Router tauscht den bestehenden signierten Terminal-Grant nativ gegen eine Capability aus; der gemeinsame stdio-Bridge reicht MCP an die reale API weiter.
Kein dauerhaftes Home-API-Schlüsselmaterial und kein Signierschlüssel werden an die CLI gereicht.
Capability-Dateien sind pro Tab privat; jeder Aufruf prüft Sitzung, Owner, Grant/LAN-Regel und den aktiven Home-Agenten erneut.
Cookies, Origin, Weiterleitungs- und Agent-Socket-Herkunft werden auf dieser nativen Capability-Verbindung abgewiesen.
Die Bootstrap-Routen sind über nginx nach außen gesperrt.
Terminal-Root bleibt als `owner-direct` mit Laufzeit und Terminal-Herkunft im Audit sichtbar.

## Einspielen durch Claude/Owner

1. Branch gegen Auftrag und geänderte bestehende Tests prüfen, integrieren und den Vollgate selbst ausführen; alle manuellen Vollgates ebenfalls unter `flock ~/agent-work/.volition-full-test.lock` starten.
2. Die Queue-Runner-Anforderung aus 164 beibehalten: Queue-Entnahme und alle manuellen Schreibzugriffe verwenden `.volition-queue.lock`; `max.txt` wird vom bestehenden Runner gelesen.
3. Nach normalem Release hostd aus dem integrierten Checkout installieren: `deployment/volition-stack/native/server/install.sh --owner wilhelmpa install`; kein zusätzlicher Operator-/Bindungsskript ist nötig.
4. In der vorhandenen root-eigenen hostd-Konfiguration `development.workDir=/home/wilhelmpa/agent-work` und `development.repo=/home/wilhelmpa/volition/plan` prüfen; die Entwicklungsarbeitskopie muss die gepushten Zielbranches kennen, und `agent-work/tmp` muss existieren.
   Für gezielte Tests `development.testDatabaseUrl` auf eine eigene private `127.0.0.1:<port>/<name>_test`-Postgres setzen; nie die Live-Datenbank verwenden.
   `development.database` benennt die bestehende Live-Datenbank für die In-Flight-Zählung (Standard bleibt der vorhandene Name `itsaplan`, keine stückweise Umbenennung).
5. API/SDK/Runner und den Owner-Terminal-Router im regulären Releaseweg übernehmen; `enabled=true` und `unrestricted=true` prüfen und Widerruf testen.
   Bestehende tmux-Tabs behalten ihre alten CLI-Argumente; die betroffenen Tabs bewusst schließen und neu öffnen, damit der gemeinsame MCP/Handoff aktiv wird.
6. Als Home `configure_development_project` zuerst mit `runtime=claude, dryRun=true`, dann mit `dryRun=false` aufrufen: HELENA #15 und sein Koordinator bleiben erhalten, der Projektname wird „Ava Entwicklung“, Reviewer/Coder und Skill erscheinen in bestehenden Listen, der Handoff-Link im vorhandenen Wissensdokument.
   `runtime=codex` wählt gpt-6.1-sol; `runtime=claude` wählt Opus 5.5.
   Fehlende/falsche #15, fehlendes Owner-Mitglied oder fehlender Koordinator werden gemeldet; es wird kein Ersatzprojekt angelegt.
7. Einen begrenzten echten Probeauftrag einreihen und auf dessen Bericht warten; Branch-Review durchführen, Review-Beleg erfassen und die Job-Kette mit `dryRun=true` prüfen.
   Echte Gate/Build/Probe/Deploy/Verify folgen nur im freigegebenen Releasefenster, mit derselben integrierten SHA und ohne parallele schwere Jobs.

## Nachweis zu Auftrag 165

Die gezielten Tests verwenden private Postgres, temporäre Spools und synthetische Terminal-Grants.
Der isolierte Probelauf führt die realen Spool-, Bericht-, Audit- und Dry-Run-Handler über eine Codex-Testfixture zusammen; er startet kein Codex-Modell, keinen Vollgate, kein Artefakt, keine Dienste und keinen Deploy.
Ein echter Modell-/Gate-/Release-Probelauf bleibt Bestandteil der Live-Schritte nach Claudes Review und Einspielen.
Es wurden keine sichtbaren Seiten, Komponenten, Stile oder Layouts geändert; neue Daten erscheinen über die vorhandenen Listen.
