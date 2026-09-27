# Trading: explizite öffentliche Nachrichten für die optionale JEV-Stufe

Vorbereitet auf `2d334045213416528eb44ea8cb30bf47a5ed397c`, nicht live integriert. Keine Migration, keine Änderung bestehender Einstellungen, Credentials oder Modellzuweisungen.

## Eingabevertrag

`trading_classify` erhält zwei getrennte Modi. Gültige bisherige Aufrufe mit `kind`, `context` und optional `rule` bleiben zulässig. Ihr gesamter Kontext bleibt je Anfrage lokal: keine optionale Cloud-Stufe und keine Cloud-Verbindung als reguläres Modell oder Fallback. Die bestehende Definition von lokal umfasst den Server und das private LAN.

Öffentliche Nachrichten verwenden `kind: "news"` und ausschließlich `publicNews: { articleText, instruments, publicDataConfirmed: true }`. Die Bestätigung ist die bewusste Freigabe des Aufrufers; sie ist **keine serverseitige Prüfung**, dass der Inhalt tatsächlich öffentlich ist. Nur Artikeltext und Instrumentnamen werden als strukturierter Zustand weitergegeben. Es gibt keine automatische Konto-, Positions- oder Regelanreicherung und keine heuristische Redaktion. Gemischte Eingaben und zusätzliche Felder werden vor der Elysia-Normalisierung abgewiesen, damit private Felder nicht still entfernt und die restliche Nachricht als öffentlich behandelt werden.

Die interne Option `DecideRequest.localOnly` kann die Klassenrichtlinie ausschließlich einschränken. Sie wird bei jeder Verbindungswahl geprüft und ist weder API-Einstellung noch persistierte Ownerpräferenz. Andere Aufrufer behalten ihr bisheriges Verhalten.

## Einstellungen und Grenzen

Local AI zeigt den vorhandenen Team-Usecase `helena.trading.news` als „Trading: öffentliche Nachrichten“. Mail und Browser behalten ihre bestehenden Schlüssel. Der Team-Master und der Usecase-Schalter steuern nur die optionale erste Stufe. Unsicherheit, Fehler, Timeout sowie ein Ausschalten während der Anfrage führen über die bestehende Revisions-/Abort-Prüfung zum bisherigen regulären Pfad. Ein unabhängig als reguläres Modell eingestelltes JEV bleibt ein reguläres Modell.

Der bestehende MCP-Middleware-Vertrag liefert keinen authentisierten Chat-Message-Kontext bis `trading_classify`. Dieser Patch erfindet weder eine Authentisierungsschicht noch eine frei übergebbare Chat-ID. Chat `/jev off` wird daher nicht als Trading-Werkzeugschalter behauptet. Der Klassenschalter wird weiterhin am Anfang von `decide` geprüft; ein dynamisches Abschalten der gesamten Klasse während einer Anfrage ist nicht Bestandteil dieses Patches.

Die News-Frage und die synthetischen Evaluationszustände nennen nur Artikel und Instrumente. Bestehende Evaluationsfreigaben werden vom bisherigen Dienst anhand Klasse/Verbindung/Schwelle gelesen, nicht anhand eines Frageversionshashes. Es gibt deshalb **keine automatische Invalidierung alter Freigaben**. Vor einer realen Aktivierung muss Root die neue News-Frage mit dem tatsächlich ausgewählten Modell erneut bewerten. Die synthetischen Tests belegen Kontrollfluss und Datenschutzgrenzen, keine Modellqualität.

## Prüfung

Neue reine Vertragstests prüfen beide Modi, Mischformen, Bestätigung, Zusatzfelder und die tatsächliche MCP-Schemaableitung. Die Webtests prüfen den exakten Usecase-Schlüssel und den Erhalt bestehender Einstellungen. Die vorhandenen Trading-Katalogtests prüfen weiterhin Fragen und Evaluationsfälle.

Vierzehn neue native API-/DB-Integrationstests sind vorbereitet: öffentliche Anfrage, Master/Usecase Off, Unsicherheit/Fehler/Timeout, Master/Usecase Off während laufender Anfrage, Off/On mit später Antwort, unabhängig reguläres JEV, alle drei lokalen Legacy-Klassen einschließlich Cloud-Fallback-Verweigerung und MCP-Vertrag. Sie verwenden ausschließlich synthetischen Loopback-Transport. Ausführung erst in einem ausdrücklich freigegebenen privaten PG-Fenster; kein Provider- oder Live-Test.

Lokale Abnahme: 8 Vertrags-/Katalogtests mit 643 Assertions, 4 bestehende Abbruchtests mit 8 Assertions und 7 Webtests grün. API-, Web- und Trading-Typprüfung sowie gezieltes API-/Web-/Trading-ESLint (einschließlich aller zehn Locales), Prettier und `git diff --check` grün. Die 14 neuen PG-Integrationstests sind weiterhin nur authored, nicht ausgeführt; Root hält das Serverfenster für einen separaten Vollgate.

## Skill und Dokumentationsbasis

Der vorhandene Helena-TypeSafe-Skill wurde als lokale vorhandene Kopie gelesen (SHA256 `71ea90d7906c6554c4f4c460ef7361b2d26f59116ccdae986dc6d997b9389f52`, gepinnte Quelle `65a39f393687675ce170e6094757de20370365b9`). Es wurde kein Codex-Skill installiert. Die offiziellen Dokumentationsseiten [State](https://docs.typesafe.ai/concepts/state) und [API](https://docs.typesafe.ai/api) bestätigen den bestehenden strukturierten State-/Questions-Vertrag. Kein SDK- oder Dependencywechsel.
