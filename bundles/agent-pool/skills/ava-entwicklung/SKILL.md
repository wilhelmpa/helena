---
name: ava-entwicklung
description: Als Home-Agent Codex-Aufträge einreihen, Warteschlange und Berichte prüfen und Folgeaufträge für die Entwicklung von Helena formulieren.
---

# Ava treibt die Entwicklung voran

Nutze `get_codex_queue` für queue.txt, queue.log und laufende Aufträge und `get_development_release` für die letzten Gate-Zusammenfassungen und den SHA des Live-Checkouts. Ein Checkout-SHA beweist keinen abgeschlossenen Deploy. Prüfe vor einem neuen Auftrag, ob bereits ein passender läuft.

Reihe einen klar begrenzten Auftrag mit `enqueue_codex_task` ein: `name` ist ein kurzer Dateiname aus kleinen ASCII-Buchstaben, Zahlen und Bindestrichen; `model` normalerweise `gpt-6.1-sol`, `effort` normalerweise `high`, `body` der deutsche Auftrag. Das Werkzeug vergibt die nächste freie Nummer und schreibt die Köpfe „Modell:“ und „Denktiefe:“ selbst. Nutze ausschließlich diese Werkzeuge für die Auftragsablage.

Jeder Auftrag nennt die aktuelle Basis (`hub/rel-12`, wenn Claude keine andere vorgibt), einen eigenen Zielbranch, das konkrete Problem, erwartetes Verhalten und gezielte Abnahmekriterien. Verlange Tests rot→grün, passende Typechecks, Lint, Prettier und bei API-Änderungen Routenabdeckung/OpenAPI. Codex prüft vor dem Bericht immer den vollständigen Web-Lint. Codex führt keinen Vollgate aus; `full-test.sh` ist Claudes Aufgabe.

Codex macht Backend/API/Runner/Datenbank/Skripte. Sichtbare UI gestaltet Claude; nötige Daten, Hooks und minimale unformatierte Einbindungen verwenden vorhandene Bausteine aus `@/design-system` oder `components/helena`. Keine eigenen Stile oder Seitenlayouts. Intern heißen neue Bezeichner `volition`, das sichtbare Produkt heißt Helena. Bestehende Namen werden nicht stückweise umbenannt.

Codex arbeitet genau einen Auftrag ab, verändert nie `/srv/volition/source/plan`, nutzt kein sudo und deployt nicht. Ergebnis ist ein Branch, der nach `/srv/volition/source/plan` gepusht wird. Keine Secrets lesen oder ausgeben, keine echten Owner-Konten, keine Logins oder Downloads/Installationen; Bun nur offline. Wenn die Aufgabe deutlich größer wird oder blockiert ist, stoppt Codex und meldet es.

Verlange einen Bericht mit höchstens zehn Sätzen nach `~/agent-work/codex-tasks/NNN-bericht.md`; Screenshots gehören nach `NNN-shots/`. Lies den Bericht mit `read_codex_report`, prüfe Verhalten, Belege, offene Punkte und Live-Schritte. Stelle bei konkreten Lücken einen begrenzten Folgeauftrag. Zusammenführen, Vollgate und Einspielen laufen über Claude/Owner; Queue-Einreihung ist keine Deploy-Freigabe. Melde den belegten Stand und halte die Entwicklung mit überprüfbaren Folgeaufträgen in Gang.
