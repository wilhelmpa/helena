# Optionale JEV-Vorstufe

Stand: 2026-09-26. Additive Erweiterung auf `c731203f`, keine Live- oder Provider-
Ausführung durch den Implementierungsagenten. Agentenzuweisungen, Modelle, Routinen,
Werkzeugrechte und ausdrücklich gewählte Browser-Verbindungen bleiben unverändert.

## Architektur und bestehende Lücken

Helena besitzt bereits typisierte Entscheidungsklassen, Owner-Evals, einen Schalter
pro Klasse, Primär-/Fallback-Verbindungen und Modellrouting pro Agent/Projekt.
Vorher beendete geringe Konfidenz eine Entscheidung ohne Fallback; ein langsamer
Primärdienst konnte das komplette Zeitbudget verbrauchen. Fehler beim Laden der
Verbindung lagen außerhalb des Backend-Catchs; der TypeSafe-SDK wiederholte intern.

Die neue Vorstufe nutzt genau diesen Dienst, keine weitere Runtime. Unter
**Entscheidungen → Arten → Optionale JEV-Vorstufe** wählt ein Teammanager eine
bestehende teamweite TypeSafe-/Vercel-JEV-Verbindung, die maximale Wartezeit sowie
explizite Anwendungsfälle mit Cloud-Freigabe. Master und Anwendungsfälle sind ohne
Konfiguration aus. Ein Verbindungswechsel deaktiviert die Vorstufe. Die bestehende
Klasse muss ebenfalls eingeschaltet sein; ihre Eval-Freigabe und Schwelle gelten.
Die JEV-Verbindung braucht für jeden gewählten Anwendungsfall ein bestandenes Eval.

Der Master betrifft diese zusätzliche Vorstufe. Eine bereits ausdrücklich als
Primärdienst oder Browser-Verbindung ausgewählte JEV-Verbindung behält ihre eigene
Konfiguration; ihre Einstellungen werden nicht still verändert.

## Ablauf und sichere Eskalation

1. Vertrauenswürdige Team-/Projekt-/Agent-IDs prüfen. Nur registrierte Klassen mit
   `input.cloud = allowed` und explizitem `cloudAllowed: true` dürfen zur Vorstufe.
   Trading-Regeln und internes Trading-Routing bleiben lokal. Eingaben plus Fragen
   oberhalb von 16.000 Zeichen überspringen die Optimierung.
2. JEV erhält die vorhandenen Fragen plus eine getrennte Frage nach ausreichender,
   eindeutiger Evidenz bzw. Spezialistenbedarf. Da die Modellfragen einander nicht
   sehen, stehen die tatsächlichen Fragen zusätzlich als serverseitige Metadaten
   `__helena_judgments` im Zustand. Vorhandene Quellfelder bleiben erhalten; Text
   und darin eingebettete Anweisungen sind Daten, keine Policy oder Berechtigung.
3. Nur gültige, ausreichend sichere und semantisch passende Antworten dürfen die
   Entscheidung übernehmen. Geringe Noul-/Choice-Konfidenz, die expliziten Optionen
   `uncertain`/`unsure`, fehlende Evidenz und Spezialistenbedarf eskalieren. Teilweise
   sichere Felder des bisherigen Pfads bleiben erhalten, damit etwa eine bekannte
   Rechnung bei unsicherem Aufgabenbedarf weiterhin unabhängig abgelegt werden kann.
4. Schemafehler, Netzfehler, fehlende/verschobene Schlüssel, Timeout und ausgeschaltete
   Vorstufe führen zum bisherigen Primär-/Fallbackpfad. Pro Verbindung höchstens ein
   Versuch, ohne SDK-Retry. Das Gesamtzeitbudget der Klasse wird auf verbleibende
   Verbindungen verteilt; JEV erhält zusätzlich höchstens den eigenen Grenzwert
   (Standard 1.000 ms, konfigurierbar 200–3.000 ms).
5. Drei technische Fehler öffnen einen pro Team/Verbindung begrenzten Circuit-Breaker
   für 30 Sekunden. Er enthält keine Eingaben oder Schlüssel und ist pro API-Prozess;
   nach Prozessneustart kann wieder ein begrenzter Versuch stattfinden. Semantische
   Unsicherheit wird nicht als Providerfehler gezählt. Keine zufälligen Wiederholungen.
6. Der Schalter wird unmittelbar vor Dispatch, während der Anfrage alle 100 ms und
   vor Ergebnisübernahme erneut geprüft. Ausschalten oder Entzug der Cloud-Freigabe
   bricht nur die Vorstufe ab; ein spätes Ergebnis wird verworfen. `enabled:false`
   gewinnt auch bei inzwischen ungültiger Verbindung, Eval- oder Use-case-Konfiguration.
   Dieser Patch schaltet nur aus; Neukonfiguration erfolgt separat.

JEV und alle Fallbacks liefern ausschließlich Urteile. Die Vorstufe führt keine
Werkzeuge, Tickets, Orders oder sonstige Außenwirkung aus. Der Workflow konsumiert
ein Endergebnis; Wiederaufnahme/Idempotenz der bestehenden Ausführung bleibt erhalten.
Sind sämtliche bisherigen Dienste ebenfalls ausgefallen, bleibt das Ergebnis
unentschieden. Der normale Workflow nimmt seine bestehende Unsicherheitsabzweigung;
ein ausdrücklich konfiguriertes `unsure: fail` wird nicht in eine Aktion umgedeutet.

Modellrouting behält den zugewiesenen Spezialisten bei unklarer Stufe, unzureichend
sicherer Kontextabhängigkeit und komplexen Aufgaben. Eine ausdrücklich erlaubte
Aufwertung bleibt möglich. Ein im Chat ausdrücklich ausgewähltes Modell und globale
Modellvorgaben werden nicht geändert. Claude/Codex bleiben für eigentliche komplexe
Arbeit zuständig; JEV erzeugt weder Programme noch freie Antworten.

## Prüfung und Abnahme

Private Loopback-Regressionen prüfen ausgeschaltete Master/Use-cases, Erfolg ohne
zweiten Aufruf, 402/503 und echten Verbindungsfehler, Schemafehler, geringe Noul-
Konfidenz, semantische Unsicherheit/Spezialist, Zeitreserve, Abschalten während eines
gehaltenen Gates und während eines Provideraufrufs, Circuit-Breaker, fehlende
Fallbacks, Eval-/Cloud-/Scope-Verweigerung und ungültigen Altzustand beim Ausschalten.
Die bestehenden Mail-, Browser- und Routertests laufen zusätzlich. Der abschließende
private Lauf bestand mit **72 Tests, 620 Assertions, 0 Fehlern** in vier Dateien;
API-/Web-Typprüfung und Scoped ESLint sind ebenfalls grün. Tests verwenden nur synthetische Daten;
sie belegen nicht die reale Entscheidungsqualität von JEV.

Der bestehende Klassen-Eval misst ausschließlich die bisherigen fachlichen Fragen
mit dem bisherigen Zustand. Er kalibriert weder die zusätzliche Frage
`__helena_readiness` noch die Anreicherung `__helena_judgments`. Diese neue
Eskalationsentscheidung ist bisher nur mit synthetischen Providerantworten
regressionsgeprüft. Vor breiter Aktivierung sind echte synthetische Proben mit
fehlendem Kontext, widersprüchlicher Evidenz und Spezialistenbedarf erforderlich;
alte Klassen-Evalzahlen sind kein Qualitätsnachweis der gesamten Vorstufe.

Root prüft den finalen Commit zusammen mit den privaten Testergebnissen und dem
Fullgate. Nach Deployment zunächst ausgeschaltete Vorstufe und unveränderte
Agentenzuweisungen in der UI prüfen. Danach nur ausdrücklich freigegebene, synthetische
Use-cases auf der vorhandenen Verbindung evaluieren, einen Anwendungsfall aktivieren
und die echten primären/Fallback-Entscheidungslogs samt Abschalten prüfen. Keine
Kontodaten, privaten Mails oder Browser-Sitzungen als spontane Probe versenden.

Die bestehenden Logs erfassen jeden tatsächlich beantworteten Versuch mit Tokens
und gegebenenfalls bekanntem Preis; unbekannte Kosten bleiben unbekannt. Es gibt
keine Behauptung zu Kostenersparnis, realer Latenz oder Modellqualität ohne eigene
Messung. Inputtext wird weiterhin nur auf ausdrückliche bestehende Klassenfreigabe
protokolliert, sonst nur sein Fingerabdruck.

## Verwendete Grundlage

Der bereits in Helenas Bibliothek referenzierte offizielle
[TypeSafe-Skill, Revision 65a39f393687675ce170e6094757de20370365b9](https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md)
wurde erneut gelesen. Die [Use-case-Map](https://docs.typesafe.ai/concepts/use-case-map),
[Konfidenzbeschreibung](https://docs.typesafe.ai/confidence),
[JavaScript-SDK-Dokumentation](https://docs.typesafe.ai/sdk/javascript) und das
[Kaskadenbeispiel](https://docs.typesafe.ai/cookbooks/sde_cascade) dienen als Referenz:
Code steuert den Ablauf, Modelle liefern typisierte Urteile, Unsicherheit eskaliert.
Die vorhandenen Helena-Browser-/Trading-Skills wurden auf diese Grenzen geprüft und
bleiben unverändert. Keine Fremdruntime, neue Dependency oder Skill-Installation.
