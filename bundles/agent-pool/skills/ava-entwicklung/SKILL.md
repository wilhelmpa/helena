---
name: ava-entwicklung
description: {appName}/Home entwickelt das eigene System mit Codex-Aufträgen, Branch-Review, Gate, Web-Artefakt, Probestart, Deploy und Nachprüfung über auditierte Entwicklungswerkzeuge.
---

# Ava treibt die Entwicklung voran

Nutze `get_codex_queue` für queue.txt, queue.log und laufende Aufträge und `get_development_release` für die letzten Gate-Zusammenfassungen und den SHA des Live-Checkouts. Ein Checkout-SHA beweist keinen abgeschlossenen Deploy. Prüfe vor einem neuen Auftrag, ob bereits ein passender läuft.

Reihe einen klar begrenzten Auftrag mit `enqueue_codex_task` ein: `name` ist ein kurzer Dateiname aus kleinen ASCII-Buchstaben, Zahlen und Bindestrichen; `model` normalerweise `gpt-6.1-sol`, `effort` normalerweise `high`, `body` der deutsche Auftrag. Das Werkzeug vergibt die nächste freie Nummer und schreibt die Köpfe „Modell:“ und „Denktiefe:“ selbst. Nutze ausschließlich diese Werkzeuge für die Auftragsablage.

Jeder Auftrag nennt die aktuelle Release-Basis samt voller SHA, einen eigenen Zielbranch, das konkrete Problem, erwartetes Verhalten und gezielte Abnahmekriterien. Verlange Tests rot→grün, passende Typechecks, Lint, Prettier und bei API-Änderungen Routenabdeckung/OpenAPI. Codex prüft vor dem Bericht immer den vollständigen Web-Lint. Codex bearbeitet genau seinen Auftrag und führt keinen Vollgate aus; Ava/Home übernimmt anschließend die Orchestrierung.

Codex macht Backend/API/Runner/Datenbank/Skripte. Sichtbare UI gestaltet Claude; nötige Daten, Hooks und minimale unformatierte Einbindungen verwenden vorhandene Bausteine aus `@/design-system` oder `components/helena`. Keine eigenen Stile oder Seitenlayouts. Intern heißen neue Bezeichner `volition`, das sichtbare Produkt heißt {appName}. Bestehende Namen werden nicht stückweise umbenannt.

Codex arbeitet genau einen Auftrag ab, verändert nie `/srv/volition/source/plan`, nutzt kein sudo und deployt nicht. Ergebnis ist ein Branch, der nach `/srv/volition/source/plan` gepusht wird. Keine Secrets lesen oder ausgeben, keine echten Owner-Konten, keine Logins oder Downloads/Installationen; Bun nur offline. Wenn die Aufgabe deutlich größer wird oder blockiert ist, stoppt Codex und meldet es.

Verlange einen Bericht mit höchstens zehn Sätzen nach `~/agent-work/codex-tasks/NNN-bericht.md`; Screenshots gehören nach `NNN-shots/`. Lies den Bericht mit `read_codex_report`. `control_codex_task` stoppt genau einen Auftrag oder reiht ihn erneut ein; erst stoppen, dann neu einreihen. `set_codex_maximum` setzt die Parallelität auf eins bis fünf; bei Speicherdruck reduzieren. Bei Modell-Limits einen begrenzten Folgeauftrag auf der vom Owner freigegebenen Laufzeit stellen.

Home besitzt auf der eigenen Laufzeit, Claude Code und Codex dieselben Rechte in Chat, Aufgaben und Owner-Terminals. Root über `run_as_root` benötigt im uneingeschränkten Home-Modus keine Rückfrage; Audit, Herkunft und Hauptschalter bleiben verbindlich. Koordinator und Spezialisten erhalten dadurch keine Home-Rechte. Der Koordinator des vorhandenen Projekts HELENA #15 heißt „Ava Entwicklung“ und kann mit `configure_development_project` zwischen Claude Code Opus 5.5 und Codex gpt-6.1-sol wechseln; Reviewer und Coder melden ihre Ergebnisse an Home.

Die gemeinsame Quelle ist `~/volition/CLAUDE.md`, mit Regeln und Befunden unter `~/volition/docs/`. Lies gezielt passende Abschnitte, nie den gesamten Handoff auf Vorrat. Das Wissensdokument „Ava Entwicklung“ verlinkt diese Datei und ersetzt sie nicht.

Prüfe Agenten-Branches in dieser Reihenfolge: geänderte bestehende Tests (abgeschwächte Assertions, Skips und Löschungen sind Vertragsänderungen), Diff gegen Auftrag, danach hartcodierten Erfolg, Catch-all mit Default, erfundene APIs/Imports, toten Code, doppelte Umsetzung, Tests auf Interna und spekulative Optionen. Führe passende Checks selbst aus; ein Bericht beweist keinen grünen Gate. Lücken ergeben einen begrenzten Folgeauftrag.

`run_development_operation` startet die typisierten Schritte `worktree`, `merge`, `review`, `gate`, `tests`, `build`, `probe`, `deploy`, `verify`; lies jeden Abschluss mit `get_development_job`. Übergib immer `branch` und dieselbe volle `expected`-SHA. Arbeitskopien liegen unter `~/agent-work/tmp`; eine Merge-Probe meldet Konflikte und verändert keinen Release-Branch. Löse Konflikte in einer Arbeitskopie, prüfe den integrierten Commit erneut und pushe ihn vor dem Gate in das lokale Release-Repository.

Beginne einen Probelauf mit `dryRun=true`; dies plant die Schritte, führt weder Codex-Modell noch Vollgate, Build, Dienste oder Deploy aus und erlaubt keinen echten Release. Für echte Schritte ist `dryRun=false` ausdrücklich erforderlich. Dokumentiere das Review mit konkreten Belegen, führe danach den Gate aus und warte auf `success`. Gates laufen über `full-test.sh` unter der gemeinsamen `.volition-full-test.lock`; auch manuelle Aufrufe verwenden diese Sperre. Gezielte Tests und Builds laufen über `heavy.sh`; keine parallelen schweren Jobs während eines Release-Builds.

Baue erst nach erfolgreichem Review/Gate das Artefakt für exakt denselben Commit; der Build verwendet den Offline-Bun-Cache. `probe` verifiziert das Artefakt, startet es auf `127.0.0.1:3091`, verlangt `/login` mit HTTP 200 und beendet den Probestart. `deploy` verwendet `deploy.sh --expect <volle SHA>` und dasselbe Artefakt, prüft vorher In-Flight und akzeptiert nur erfolgreiche echte Review-/Gate-/Build-/Probe-Ergebnisse für diesen Commit. Niemals den Live-Checkout resetten oder dort entwickeln.

`pauseHalogen=true` darf nur bei ungenutztem Halogen erfolgen: keine pending Agentenläufe oder streaming Chats, Priority-Proxy active/queued jeweils null und freie `halogen-bench.lock`. Reihenfolge: TTS-Proxy stoppen, TTS stoppen, Halogen stoppen; danach TTS-Proxy neu starten, Halogen starten, TTS starten. Die Operation stellt vorher aktive Dienste auch bei einem Fehler wieder her. Bei belegtem Halogen warten und den Job später neu starten; keine laufenden Agenten verdrängen.

Nach einem echten Deploy `verify` ausführen: `/login`, `/`, `/chat` und `~/volition/tools/integrity.sh`; unauthentifizierte Weiterleitungen von geschützten Seiten müssen als solche im Bericht stehen. Der Jobbericht nennt Commit, Status, Smoke und Integrity. Ein Checkout-SHA allein beweist kein erfolgreiches Einspielen. Fehlt ein Beleg, melde ihn offen und wiederhole nur den nötigen Schritt.
