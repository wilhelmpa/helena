# Jev in Helena: Strategie für lokale und starke KI

Stand: 27.09.2026. Diese Strategie beruht nur auf Lesen: Research-Notizen RES/Docs/AI 00–09, Codex-Berichte in `research-output/jev-*`, Entscheidungsdokumente am Commit `65b7a60a` und offizielle Webquellen. Es gab keine Code-, Einstellungs- oder Serveränderung, keinen Provider-Aufruf und kein Login.

## 1. Was Jev ist und was es gut kann

- **Jev** (TypeSafe AI, Modell `jev-1.13.0`, Alias `jev-latest`) ist ein „System One“-Modell. Es schreibt keinen Text, sondern beantwortet **typisierte Fragen** über einen Zustand (`state`):
  - `Choice`: eine Option aus einer festen Liste,
  - `Noul`: die Wahrscheinlichkeit für „ja“,
  - `Score`: ein Zahlenwert.

  Jede Antwort kommt mit Wahrscheinlichkeiten und einer Konfidenz. Veröffentlicht am 15.09.2026, zunächst im Early Access.
- **Herstellerangaben**, nicht in Helena gemessen:
  - Antwortzeit 70–500 ms, 40- bis 200-mal schneller als große LLMs.
  - $0,042 pro Million Eingabetokens, Ausgabe kostenlos. 1.000 Entscheidungen mit je 2.000 Tokens kosten damit etwa 0,08 $. **Kosten sind also kein Thema; es geht um Datenschutz und Qualität.**
  - Limits: 64k Tokens pro Anfrage, 32k für State plus die längste Frage.
- **Stark bei:** Routing, Klassifikation, Triage, Guardrails, Merkmalsextraktion und der Auswahl eines Ziels aus Kandidaten (etwa Browser-Elemente). Alles, was schnell, oft und billig entschieden werden muss.
- **Schwach bei** (offiziell dokumentiert für Jev 1.13):
  - Rechnen, Zählen, Datums- und Zeitlogik,
  - Mehrschritt-Schlüsse und doppelte Verneinung,
  - viel irrelevanter Kontext („context rot“),
  - eingeschleuste Anweisungen im State,
  - Textgenerierung.

  Deutsch ist nicht die Hauptsprache und muss je Aufgabe evaluiert werden.
- **Offizielles Muster, das Helena schon umsetzt:** Der Code steuert den Ablauf. Das Modell liefert nur ein Urteil. Bei Unsicherheit wird eskaliert (Kaskade bzw. „confidence-gated routing“). Laut TypeSafe liegt die Untergrenze bei etwa 0,6; Aktionen mit Folgen brauchen mehr als 0,85.

**Lokale Jev-kompatible Wege:**

| Backend | Was es ist | Bewertung für Kingston |
|---|---|---|
| **Qwen3.6-35B-A3B, Logit-Auslese** (Helena-eigen, Verbindung „Lokale KI auf diesem Server“) | Liest die Wahrscheinlichkeiten der Antwortoptionen aus einem Forward-Pass über Lemonade/llama.cpp ROCm; dasselbe Prinzip wie SemIf/OpenJev | **Bester lokaler Kandidat, schon gemessen:** besteht alle vier deutschen Klassen, siehe §2. 0,5–3 s pro Fall, privat, kostenlos |
| Qwen3.8-27B | Dichtes Modell, etwa 11 tok/s | Für Entscheidungen **nicht evaluiert** und langsamer. Nicht als Entscheidungsmodell einplanen, solange kein Eval vorliegt |
| NPU qwen3.5-2b-FLM | Local-AI-Klassen für Triage (0,94) und Routinen (1,00) | Nur für die Klassenpfade der lokalen KI. Ob es Logits für `decide()` liefern kann, ist ungeprüft |
| Laya (typed-decisions, auf Kingston unter :8791) | Kleines Encoder-Modell auf der CPU | Deutsch nahe Zufall (52–60 %); Browser öffentlich 3/10. **Aus lassen, nicht weiter investieren.** `laya-ultrafast` braucht einen Mac mit MLX und passt deshalb nicht zu Kingston |
| SemIf / OpenJev (TheoLeeCJ), `semif-serve` | Logit-Auslese auf offenen Modellen mit Jev-kompatiblem Wire-Protokoll | Helena macht dasselbe bereits selbst. Kein zweiter ML-Stack (Entscheidung vom 25.09.) |
| razorback16/openjev (DiffusionGemma 26B-A4B, Apache-2.0) | Jev-kompatibler Server; die TypeSafe-SDKs laufen unverändert | Interessantes späteres Experiment: Deutsch und ROCm sind ungeprüft, ein Download bräuchte das Owner-OK. Heute nicht nötig |

## 2. Stand in Helena heute

**LIVE**, gemessen oder beobachtet, Live-Stand `0e99cd6e`:

- **`decide()`-Dienst** mit Klassen, Evals, Schwellen, Primär- und Fallback-Verbindung, Protokoll, MCP-Tool `decide` und Engine-Schritt „Entscheidung“.
  - Die Eval-Sperre verhindert das Einschalten ohne bestandenes Eval.
  - Laut Owner-Einstellung vom 25.09. sind die Klassen Router, Mail, Belege und Allgemein aktiv, auf der **lokalen Verbindung (Qwen3.6-Logit)**.
  - Mail-Aktionen bleiben Vorschläge. Der Modellrouter ist nur für Agent 12 (Content & SEO VOL) aktiv.
  - **Vor jedem Rollout den tatsächlichen Schalterzustand neu lesen.**
- **Deutsche Evals mit Qwen3.6-Logit**, angegeben als Genauigkeit / Präzision / Abdeckung:

  | Klasse | Ergebnis | Zeit |
  |---|---|---|
  | Router | 88/91/83 | 1,1 s |
  | Mail | 90/92/90 | 3,2 s |
  | Belege | 96/96/100 | 1,0 s |
  | Allgemein | 100/100/96 | 0,5 s |

  Die Präzision steigt mit der Schwelle, die Konfidenz ist also brauchbar kalibriert. Empfohlene Schwellen: Router 0,8, Mail 0,7, Belege 0,95.
- **TypeSafe-Verbindung 46** (`decision_model`, teamweit, Team 1): Am 26.09. gegen 20:27 liefen drei synthetische Entscheidungen erfolgreich, zusammen 298 ms, 520 Eingabe- und 89 Ausgabetokens; der Provider meldete `jev-1.13.0`. **Das ist kein Qualitäts- und kein aktueller Verfügbarkeitsbeleg.**
  - Laut Codex-Metadatenprojektion vom 27.09. 03:05 steht dort `model: jev-latest` (nicht gepinnt) und `sourceCredentialId: null`. Die Verbindung hält also eine **eigene Schlüsselkopie** des Originals (Zugang 45).
  - Genau das verursachte am 26.09. die Fehlerkette 402 (billing) → 401 (veraltete Kopie), bis Root die Kopie synchronisierte.
  - Die Schlüsselreferenz (`keySource: credential`, siehe `typesafe-key-reference.md`) ist vorbereitet.
  - Eine vorbereitete Ein-Fragen-Probe (`research-output/typesafe-one-question-2026-09-27/`) ist nicht ausgeführt.
- **Mailtriage** über Hermes-Routinen ist vom Owner abgenommen. **Trading `trading_classify`** existiert mit den Klassen News (Cloud erlaubt), Regeln und Routing (beide `cloud: never`).

**VORBEREITET, nicht live.** Kandidat `65b7a60a` (JEV nach Vault) hat den ersten Gate verfehlt (Web 907/1); ein frischer vollständiger Gate steht aus. Inhalt:

- **Optionale JEV-Vorstufe** (`f0b45be7`, Doku `jev-first-stage-2026-09-26.md`):
  - Team-Master plus Freigabe pro Anwendungsfall mit Cloud-Freigabe; Eval-Pflicht je Verbindung.
  - Timeout 1.000 ms (einstellbar 200–3.000), kein Retry, Circuit-Breaker nach 3 Fehlern für 30 s.
  - Zusatzfrage `__helena_readiness`; bei „unsicher“ oder „Spezialist nötig“ wird eskaliert.
  - Abschalten wirkt auch mitten in der Anfrage (Prüfung alle 100 ms).
  - Private Tests: 72 Tests, 620 Assertions.
- **Local-AI-Schalter** (Master, Mail, Browser) und native Browser-Stufe (`33f386f2`, Migration `0194`); Chat `/jev on|off|inherit` (`a9a54816`/`944ecbd0`, Migration `0193`).
- **Trading: öffentliche News** (`75fdbe1c`):
  - Nur Artikeltext und Instrumente gehen in die Cloud; der alte freie Kontext bleibt lokal.
  - PG-v3: 81 Tests, 808 Assertions, 0 Fehler.
- **Coding-Skill** `helena-coding-workflow` (`83e8ead0`).
- **Forschungsprüfer** `trading_research_audit`: rechnet nur, keine Orders.

**OFFEN:**

- keine einzige fachliche Live-Abnahme eines Jev-Anwendungsfalls;
- keine deutschen Jev-Evals, also auch kein Vergleich Jev gegen Qwen3.6;
- nicht kalibriert: die Readiness-Frage der Vorstufe;
- nicht gebaut: eine anbieterübergreifende Kaskade „lokal → Claude/GPT“ (der Router wählt nur Stufen innerhalb eines Anbieters);
- kein Chat-Auto-Routing;
- keine Routine-Vorprüfung.

## 3. Einsatzmatrix

Grundregel: **Private Daten gehen zu Qwen3.6 lokal. Öffentliche Daten mit Tempo-Bedarf gehen zu Jev in der Cloud. Unsicher heißt immer: der bisherige Pfad bzw. das starke Modell übernimmt.** Starke Modelle sind Claude Opus 5.5 und GPT-6-sol/astra; mittel ist gpt-6-luna.

| Aufgabe | Entscheidungs-Backend | Starkes Modell dahinter | Schwelle / Fallback | Priorität |
|---|---|---|---|---|
| **Browser-Aktionen** (Operation plus Ziel wählen, Formularwert zuordnen) auf öffentlichen Seiten | **Jev Cloud** (Latenz pro Schritt entscheidet; Muster aus jev-ultrafast nativ übernommen) | Planer-Agent (gpt-6-luna) für Ziele und Werte; bei Ambiguität, Login oder CAPTCHA Übergabe an den Agenten bzw. den Owner | Ziel-Wahrscheinlichkeit per Browser-Eval bestimmen; `likely_done` nie ohne prüfbares Kriterium; jede Aktion weiter über die Action-Policy | **1** |
| **Trading: öffentliche News** (Relevanz, Richtung, Ereignisart) | **Jev Cloud** als Vorstufe, regulär Qwen3.6 lokal | Research-Agent (Opus/sol) nur für relevante Meldungen | 0,70; Pass bei mindestens 85 % Präzision und 50 % Abdeckung (72-Fragen-Eval); unsicher bedeutet Qwen, dann „unentschieden“ und **nie Order** | **2** |
| Trading: Regeln und Rollen-Routing (privat) | **nur lokal** (Qwen3.6) | Trading-Koordinator | `cloud: never` bleibt hart | bereits so |
| **Mailtriage** (Projekt, Kategorie, Priorität, Antwort nötig, Aufgabe) | **Qwen3.6 lokal** (live, 92 % Präzision) | Mail-Koordinator bzw. Home (Hermes) für Entwurf und Aufgabe | 0,7; unsicher geht an den bestehenden Hermes-Triagepfad. **Jev hier nur mit ausdrücklicher Cloud-Freigabe und nur, wenn es Qwen im Eval schlägt** | bleibt lokal |
| **Belege**: Kandidat wählen, Rechnung und Zahlungsbeleg paaren | **Qwen3.6 lokal** | Owner-Review; Beträge, Währung, Datum und Cent-Arithmetik **deterministisch im Code** | 0,95; darunter nur Vorschlag. Kein Auto-Zusammenführen | mittel |
| **Modellrouter / Coding** (einfach, Standard, stark) | **Qwen3.6 lokal** (Prompts enthalten Code und Private-Kontext) | Opus 5.5 bzw. GPT-6-sol für komplexe Arbeit; luna oder lokal für Routine | 0,8, nur abwärts routen, nie über das konfigurierte Modell hinaus. Kontextabhängig heißt: beim Spezialisten bleiben. Bestehende Sitzungen und explizite Modellwahl werden nie umgebogen | **4** |
| **Routine- und Cron-Vorprüfung** („Gibt es etwas zu tun?“ vor einem teuren Agentenlauf) | **Qwen3.6 lokal** (ggf. NPU nach Eval) | Der eigentliche Agentenlauf (Hermes/Claude/Codex) | Erst deterministisch zählen (neue Mails, offene Tickets). Nur bei Grenzfällen Noul „lohnt Lauf?“ ≥ 0,8 überspringt; sonst läuft er normal. **Größter Spareffekt, neuer Code nötig** | **3** |
| **Agent-Team-Vorstufe** (Ticket: welcher Koordinator bzw. Spezialist, Typ, Dublette?) | Qwen3.6 lokal; Jev nur für Tickets ohne Privatinhalt | Koordinator-Agent entscheidet bei Unsicherheit | Nur Vorschlag; nie automatisch zusammenführen oder löschen; der verantwortliche Mensch bleibt | 5 |
| Chat „Auto“-Modus (triviale Frage lokal, schwere Frage stark) | Qwen3.6 lokal | Opus / sol | Nur, wenn der Owner „Auto“ wählt; die explizite Modellwahl bleibt unangetastet. Neuer Code nötig | später |
| Wissenssuche neu ordnen, Skill-Empfehlung, Zitatprüfung | Qwen3.6 lokal | – | Bei Unsicherheit die ursprüngliche Reihenfolge behalten | später |
| Injection- bzw. Guardrail-Signal auf eingehenden Mails und Webseiten | Qwen3.6 lokal (Mail), Jev (öffentliche Webseiten) | – | **Nur Zusatzsignal**, nie alleinige Abwehr; Rechte und Freigaben bleiben maßgeblich | später |

**Nicht für Jev (und nicht für Qwen-Entscheidungen):**

- Geld- und Datumsrechnung, IDs, Rechte und Freigaben;
- Orders und Positionsgrößen;
- Codeerzeugung und freie Antworten;
- Login- und Einwilligungsdialoge;
- alles, bei dem ein Fehler nicht zurückholbar ist, ohne zusätzliche Policy.

## 4. Rollout-Reihenfolge mit Abnahmetests

Für jeden Schritt gilt:

- vorherige Einstellungen sichern und danach exakt wiederherstellen, außer einer ausdrücklich freigegebenen Aktivierung;
- neue Eval-ID zusammen mit Modell, Verbindung, Schwelle und Quell-Hash dokumentieren, denn alte grüne Evals gelten technisch weiter;
- nie eine Schwelle senken, nur damit ein Eval besteht.

**0. JEV-Code live bringen, alles aus.**

- Schritte: `65b7a60a` Gate-Fehler (Web 907/1) beheben, voller Gate, serieller Deploy (Migrationen 0193/0194).
- Abnahme:
  - UI unter Entscheidungen und Local AI zeigt dieselbe gespeicherte Policy (auch nach Reopen);
  - Master aus;
  - reguläre Modelle unverändert;
  - `/jev off|on|inherit` im Testchat erzeugt keinen Lauf;
  - gespeicherte Altwerte wurden vorher gelesen.

**1. Lokale Basis absichern (vor allem anderen).**

- Schritte:
  - Die Entscheidungsklassen **explizit an Qwen3.6-35B-A3B binden**, nicht „automatisch“: Laut Routing-Audit kann sich die Auto-Bindung ändern, wenn sich der Satz geladener Modelle ändert, etwa durch Qwen3.8.
  - Die vier Klassen-Evals frisch laufen lassen.
- Abnahme: Router, Mail, Belege und Allgemein erfüllen jeweils mindestens 85 % Präzision und 50 % Abdeckung bei den empfohlenen Schwellen; p95 unter dem Klassen-Timeout; Lemonade stabil (MemoryHigh 11 GiB).

**2. Jev-Verbindung härten und prüfen.**

- Schritte:
  - Verbindung 46 von `jev-latest` auf **`jev-1.13.0` pinnen**, damit Evals zu einer festen Modellversion gehören.
  - Auf **Schlüsselreferenz zu Zugang 45** umstellen, damit keine veraltete Kopie mehr entsteht; das braucht ein Release mit der Referenzfunktion.
  - Danach die vorbereitete Ein-Fragen-Probe (`typesafe-one-question-2026-09-27`) genau einmal ausführen.
- Abnahme: `passed`, `validAnswer=true`, Latenz erfasst.
- Bei 402 bzw. „kein Guthaben“: Owner-Schritt.

**3. Browser mit Jev (Priorität 1).**

- Schritte:
  - Browser-Eval (6 Fälle) auf Verbindung 46.
  - Danach `JEV-LIVE.md` A–D auf dem P6BROW26-Fixture: A echte Eingabe mit DOM-Beleg, B `likely_done` ohne Kriterium, C unmögliches Kriterium, D unklare Auswahl.
  - Dann die Pilotmatrix: Suche auf Deutsch und Englisch, Formular, Dropdown, gleiche Labels, Navigation-Race, Keine-Treffer, falsches „fertig“, Login-/CAPTCHA-Übergabe, eingeschleuste Anweisung, Read-only-Verweigerung, fremde Domain.
- Abnahme:
  - **0 unbeabsichtigte Wirkungen, 0 falsche Erfolgsmeldungen**;
  - Vergleich gleicher Aufgaben gegen die normalen Step-Tools: Gesamtzeit, Tokens, Übergabequote, Ground Truth;
  - Aktivierung nur, wenn Jev schneller oder gleich gut ist.

**4. Trading-News (Priorität 2).**

- Schritte:
  - Frischer 72-Fragen-Eval auf der Stage-Verbindung; Pass: `done`, keine Fehler, mindestens 85 % Präzision und 50 % Abdeckung bei 0,70.
  - Stage-Probe mit S = Jev und R = Qwen lokal (getrennte Verbindungen!): klare Meldung ergibt `decided` nur über S; ambige Meldung ergibt Fallback auf R bzw. unentschieden.
- Abnahme: keine Konto- oder Positionsdaten im Stage-State; danach nur der News-Usecase an.
- Wichtig (Codex): Die Classify-Antwort nennt weder die Versuchsrolle noch den Readiness-Wert. Stehen Stage und regulärer Pfad auf **derselben** Verbindung, ist der Stage-Nachweis nicht eindeutig (INCONCLUSIVE). Deshalb getrennte Verbindungen verwenden, höchstens drei classify-Aufrufe.
- Codex setzt Trading-News in seiner Forschungsliste nur auf P3. Hier steht es auf 2, weil der Code fertig getestet ist und nur öffentliche Daten fließen. Der Nutzen bleibt Sortierung, keine Prognose.
- Paper-Orders bleiben völlig getrennt; die Trading-Safety-Blocker (Reservierung, Stops) gelten weiter.

**5. Routine-Vorprüfung (Priorität 3, neuer Code).**

- Schritte:
  - Neue Klasse `helena.routine.gate` mit Eval-Set (mindestens 30 Fälle: zu tun / nichts zu tun / Grenzfall).
  - Einsatz zuerst bei den Mailroutinen 08/12/16/20 und beim Home-Audit.
- Abnahme:
  - 0 übersprungene Läufe, die nötig gewesen wären (gegen Owner-Labels, eine Woche Schattenmodus: nur protokollieren, nicht überspringen);
  - gemessene Einsparung an Agentenläufen und Tokens.

**6. Modellrouter und Kaskade (Priorität 4, teils neuer Code).**

- Schritte:
  - Router-Eval um die Stufe „lokal machbar“ erweitern.
  - Router zuerst für einen Coding-Agenten im Schattenmodus: Entscheidung protokollieren, aber das konfigurierte Modell nutzen.
  - Messen: Testerfolg, Nacharbeit, Gesamtzeit und Kosten gegen die Baseline.
  - Aktivieren nur, wenn Qualität gleich bleibt und Kosten oder Zeit sinken.
- Abnahme: explizite Chat- und Vorlagenmodelle unverändert; laufende Sitzungen werden nie umgeroutet.

**7. Mail mit Jev (optional).**

- Nur wenn der Owner Mail-Cloud freigibt **und** der deutsche Mail-Eval von Jev den von Qwen3.6 schlägt.
- Sonst bleibt Mail lokal: Die Latenz ist bei Hintergrundmail egal, die Privatsphäre nicht.

**8. Später**, jeweils mit eigenem Eval, lokal, nur als Vorschlag. Codex' Prioritäten aus `jev-application-opportunities-2026-09-26.md`:

- P1: erlaubte Suchtreffer nachsortieren (Recall/MRR gegen die bestehende Suche);
- P1: lokal extrahierte Belegwert-Kandidaten auswählen;
- P2: zugewiesene Skills vorschlagen;
- P2: Ticketart, Delegation und Dubletten;
- P2: Aussagen gegen Quellen prüfen;
- zusätzlich: Beleg-Paarvorschlag (Rechnung plus Zahlungsquittung) auf der vorbereiteten, deterministischen Beleggruppen-Zuordnung (`c2b269fc`, Migration 0195), Injection-Signal, Chat-„Auto“.

Hinweis: Das TypeSafe-Primitiv `Score` unterstützt Helenas Adapter noch nicht. Relevanz lässt sich vorerst über einzelne Ja/Nein-Fragen abbilden.

## 5. Risiken und Grenzen

- **Datenabfluss:** Alles, was an Jev geht, verlässt den Server und lässt sich durch Abschalten nicht zurückholen.
  - Cloud-Freigabe gilt pro Anwendungsfall und wird nie automatisch auf neue Datenarten erweitert.
  - `publicDataConfirmed` ist eine Erklärung des Aufrufers, keine Prüfung.
  - Eine Zero-Retention-Zusage ist nicht belegt.
- **Deutsch:** Jev ist auf Englisch optimiert. Ohne deutsche Evals gibt es keine Aktivierung. Qwen3.6 ist auf Deutsch bereits belegt gut.
- **Konfidenz ist nicht gleich Konfidenz:**
  - Helena berechnet in `decide` `(n·max(p)−1)/(n−1)`.
  - Der Browser nutzt die Provider-Konfidenz bzw. die Ziel-Wahrscheinlichkeit.
  - Schwellen dürfen nicht zwischen Backends oder Pfaden kopiert werden; pro Backend neu evaluieren.
- **Eval-Bindung:** Evals sind nicht an Frage-, Modell- oder Datensatz-Hash gebunden. Ein alter Pass bleibt gültig, bis ein neuer Lauf ihn verdrängt. Deshalb Eval-ID und Hashes immer mitprotokollieren.
- **Readiness-Frage ungeprüft:** `__helena_readiness` ist nur synthetisch getestet. Ob die Vorstufe zu oft „bereit“ sagt, zeigt erst eine echte Stage-Probe.
- **Prompt-Injection:** Webseiten, Mails und News können das Urteil lenken. Deshalb: Action-Policy, Freigaben und Rechte bleiben die einzige Autorität; Jev-Wahrscheinlichkeiten gewähren nichts.
- **Anbieter-Risiko:** Early Access, Modellalias wandert (`jev-latest`), mögliche 402-/Guthaben-Probleme (am 26.09. schon einmal aufgetreten). Der Fallback auf den regulären Pfad muss immer funktionieren. Der Circuit-Breaker gilt nur pro Prozess.
- **Lokale Ressourcen:** Qwen3.6-Entscheidungen teilen sich die GPU mit Chat- und Agentenlast. Lemonade mit 12 GiB MemoryMax ist knapp; keine Evals oder Benchmarks während Gate oder Deploy.
- **Klassen-Aus während einer laufenden Anfrage** ist kein Widerruf, nur Master bzw. Usecase-Aus. `/jev off` ist **kein** Trading-Tool-Schalter.
- **Keine Profit-Aussage:** News-Richtung ist ein Label, keine Prognose. Jev ersetzt keine Backtests.

## 6. Quellen

Offiziell:

- TypeSafe Use Case Map: https://docs.typesafe.ai/concepts/use-case-map
- Dokumentationsindex: https://docs.typesafe.ai/llms.txt
- Confidence-gated Routing: https://docs.typesafe.ai/patterns/confidence-routing
- Jev 1.13 Schwächen: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- Kaskade: https://docs.typesafe.ai/cookbooks/sde_cascade
- Konfidenz: https://docs.typesafe.ai/confidence
- API: https://docs.typesafe.ai/api
- JS-SDK: https://docs.typesafe.ai/sdk/javascript
- TypeSafe-Skill (Pin 65a39f39): https://github.com/typesafe-ai/skills/blob/65a39f393687675ce170e6094757de20370365b9/skills/typesafe-ai/SKILL.md
- Launch-Blog: https://typesafe.ai/blog/introducing-system-one-models-and-jev

Berichte Dritter (Preis, Latenz, Launch 15.09.):

- https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/
- https://www.datacamp.com/blog/system-one-models-jev

GitHub:

- https://github.com/browser-use/jev-ultrafast (MIT, geprüfter Pin 1231850a)
- https://github.com/ipenywis/laya-ultrafast (Laya/MLX, nur Mac)
- https://github.com/TheoLeeCJ/SemIf-OpenJev (dazu `semif-serve`, PR #27)
- https://github.com/razorback16/openjev (DiffusionGemma, Apache-2.0)
- https://github.com/Ying-Kai-Liao/jev-browser (Pin e35ab134)

Helena, intern. Codex-Ergebnisse sind die Basis dieses Dokuments:

- RES/Docs/AI 00–09 unter `/srv/volition/vault/Projects/RES/Docs/AI/`
- `research-output/typesafe-one-question-2026-09-27/` (Metadaten Verbindung 46, vorbereitete Probe)
- `research-output/jev-trading-pg-v3-2026-09-27/` (81/0/808)
- `research-output/jev-on-vault26d5-2026-09-27/` (104/1006 rein, 31 Web, 16 Mail)
- `research-output/jev-after-vault-65b7-2026-09-27/` (Operator, Live-Katalog vorher)
- `research-output/jev-paper-vault-sequence-2026-09-27.md` (Migrationsreihenfolge)
- `research-output/receipt-groups-after-jev-2026-09-27/`
- `research-output/agent-model-drift-2026-09-27.md` (das Abzeichen „weicht ab“ ist kein Laufzeitfehler)
- Branch `codex/jev-application-research-20260926`: `jev-application-opportunities`, `typesafe-provider-diagnostic`, `jev-community-research`, `jev-coding-and-skill-repositories` (alle vom 26.09.)
- `research-output/jev-trading-activation-source-plan-2026-09-27.md`
- `research-output/jev-live-acceptance-3f166161-2026-09-27.md`
- `research-output/jev-deploy-delta-65b7a60a-2026-09-27.md`
- `research-output/jev-trading-gap-2026-09-27.md`
- am Commit `65b7a60a` unter `docs/helena-decisions/`: `decisions.md` (§8 Evals), `jev-first-stage-2026-09-26.md`, `jev-local-ai-control-2026-09-27.md`, `jev-readiness-2026-09-26.md`, `local-model-routing-audit-2026-09-26.md`
