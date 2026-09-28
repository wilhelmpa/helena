# Entscheidung: Helenas zentrale Laufzeit (Ersatz für Hermes)

Stand 28.09.2026, Zweig `hub/zentrale-laufzeit`. Auftrag: Phase 3 aus `docs/plan-lokal-halogen.md`. Grundlagen: `hermes-ersatz.md`, `helena-decisions/hermes-bewertung.md`, `helena-decisions/vergleich-openclaw-hermes-paperclip.md`, `code-zustand-2026-09-28.md`, `runtime-protocol.md`, `glass-box-runs.md`, `local-ai-platform.md`.

Status: **Entwurf mit Umsetzung hinter Feature-Flag (Standard aus).** Nichts ist live.

## 1. Kurzfassung

- Helena bekommt eine **eigene Agenten-Schleife**, die Laufzeit `helena`. Sie ist eine neue Laufzeit neben Hermes, Claude Code und Codex, hinter dem vorhandenen `RuntimeAdapter`/Preset-Muster des Runners. Nichts am Run-, Chat-, Claim- oder Timeline-Weg wird dafür neu gebaut.
- **Die Schleife läuft als Unterbefehl des Runner-Bundles** (`cli.js helena-agent`). Bei aktiver Isolation startet sie der Launcher wie Claude Code als Projekt-Benutzer in dessen Sandbox-Unit. Werkzeuge, die Dateien anfassen oder Befehle ausführen, laufen damit automatisch in der Projekt-Sandbox.
- **Bibliotheken:**
  - Vercel AI SDK 7 (`ai`, Apache-2.0, schon im Monorepo) für Modellaufrufe und Streaming, mit `@ai-sdk/openai-compatible` für Halogen und OpenAI-kompatible Schlüssel-Anbieter und `@ai-sdk/anthropic` für Anthropic-API-Schlüssel.
  - Das offizielle MCP-SDK (`@modelcontextprotocol/sdk`, MIT, schon im Monorepo) für Helena-MCP, Browser-Gateway und Bibliotheks-Server.
  - Die Schleife selbst ist ein **eigener, kleiner manueller Tool-Loop**: ein Modellaufruf je Schritt, Werkzeuge führt Helena selbst aus. Nur so liegen Policy, Zeitgrenzen, Kompression, Eskalation und Persistenz vollständig in Helenas Hand.
- **Helena hält den Vertrag:** Sitzungen, Gedächtnis (Markdown plus Tagesnotizen), Faktenspeicher (Holographic-Prinzip), Skills, Verbrauch, Freigaben und Policy liegen in Postgres bzw. in Helenas API.
  - Gedächtnis und Fakten sind **laufzeitunabhängig** über Helena-MCP erreichbar, also auch für Claude Code und Codex.
- **Lokal zuerst, gezielt eskalieren:**
  - **Rückfall-Kette** innerhalb der Schleife bei Anbieterfehlern.
  - **Eskalation** an Claude Code/Codex (Abos) bzw. ein großes API-Modell nach Aufgabenart, Unsicherheit, Fehlschlag oder Festlegung, mit Übergabe des bisherigen Verlaufs.
- **Feature-Flag:** `HELENA_NATIVE_RUNTIME=on` in der API-Umgebung schaltet die Laufzeit frei. Danach wird pro Agent `runtimePolicy.runtime = 'helena'` gesetzt.
  - Ohne Flag, oder mit zurückgesetzter Einstellung, läuft der Agent wieder über Hermes. Das ist der Rückweg.

## 2. Was vorhanden ist und genutzt wird

| Baustein | Wo | Nutzung durch `helena` |
|---|---|---|
| Runner, Claims, Heartbeat, Resume nach Absturz | `packages/runner/src/{run,chat,cli}.ts`, Migrationen 0158/0161 | unverändert. Die Laufzeit meldet ihre Sitzungs-ID früh (Event `session`), der Runner speichert sie (`reportSession`), ein neuer Claim setzt mit `--resume <id>` fort |
| Runtime-Registry und Presets | `runtimes.ts`, `presets.ts`, `@helena/sdk` `CliRuntimeType` | neuer Eintrag `helena` mit eigenem Ausgabeformat `helena-jsonl` und Parser |
| Stream-Events → AG-UI → Chat/Timeline | `agui.ts`, `@helena/sdk` `RuntimeStreamEvent` | die Laufzeit schreibt genau diese Events als JSON-Zeilen. Erweitert um `spend` und `result.error` (auch für Plugin-Laufzeiten nützlich) |
| RuntimeAdapter + ProfileContributions (MCP-Server, Anweisungen, Skills) | `adapters.ts`, `contributions.ts`, `cli-runtime.ts` | neuer `HelenaRuntimeAdapter`. Er sammelt dieselben Contributions und reicht MCP-Server, Anweisungen, Skills, lokale Server und Modelle als eine JSON-Datei pro Aufruf weiter (kein Profil auf der Platte, keine Drift) |
| Isolation (Projekt-Benutzer, Sandbox, Egress, plan.sock) | `deployment/volition-stack/isolation/launcher.json` | neuer Launcher-Eintrag `helena`: exec `node`, fest `dist/cli.js helena-agent`, nur lesend das Runner-Bundle |
| Policy/Autopilot `decide()` | `POST /agent-policy/decide`, `packages/policy` | vor jedem nicht-lesenden Werkzeugaufruf, wie Claude Codes PreToolUse-Hook (`policy-hook.ts`), nur direkt im Prozess statt über einen Hook-Befehl. Helena-MCP-Werkzeuge prüft Helena serverseitig |
| Helena-MCP | `apps/api/src/mcp`, Contribution `helena-mcp` | direkt als MCP-Client (Streamable HTTP) |
| Browser-Gateway | `packages/browser-gateway`, Contribution `projekt-browser` (stdio-Shim) | **direkt** als eigene Werkzeuge im Modell (`browser_navigate`, `browser_snapshot` …), ohne Hermes' `tool_search`/`tool_call`-Umweg |
| Usage-Ledger | `agent_usage`, `recordUsage()` | über das `spend`-Event und den vorhandenen Bericht an die API, Laufzeit `helena`, Anbieter `helena-<server>`, lokal zum Preis 0 |
| Gedächtnis-Editor mit Freigabe | `agent_memory_revision`, `agent_proposal`, `agents/memory` | dieselben Tabellen. `MEMORY.md`/`USER.md` sind die neuesten Revisionen. Schreibt der Agent bei aktiver Freigabe, entsteht ein Vorschlag `memory-write`. Neu: Tagesnotizen als Datei `notes/JJJJ-MM-TT.md` |
| Skills | Policy-Snapshot `skills[]` (Markdown plus Dateien) | Index (Name und Beschreibung) im Systemprompt, Inhalt erst über `load_skill` |
| Lokale KI (Server, Modelle, Schlüssel-Variablen) | Snapshot `localAi.servers[]`, `localRoute()` | Modell-ID `helena-<slug>/<modell>` wird auf den Server aufgelöst (Basis-URL, Schlüssel aus `keyEnv`). Halogen und der Weiterleiter für isolierte Agenten kommen aus `hub/halogen-integration` |
| Entscheider | `@helena/decisions`, `decide`-MCP | Unsicherheits-Eskalation fragt den Entscheider-Dienst (Klasse `router`) |
| Reflexion, Kurator (heute nur Hermes) | `agents/runner/reflection.ts`, `chat-reflection` | Reflexion wird ein kurzer eigener `helena`-Lauf mit Erfolgsprüfung (§8.4) |

## 3. Bibliothekswahl

Recherche am installierten Stand (`ai@7.0.112` im Lockfile, Doku im Paket) und an der Aufgabe.

| Kandidat | Lizenz | Bewertung |
|---|---|---|
| **Vercel AI SDK 7 Core (`streamText`) + Provider-Pakete** | Apache-2.0 | **gewählt.** Es ist schon im Monorepo (Web-Chat) und normiert OpenAI-kompatible, Anthropic- und OpenAI-Anbieter, Streaming, `reasoning_content`, Tool-Call-Parsing samt Reparatur, Abbruch und Zeitgrenzen (`timeout.stepMs/chunkMs`). Genutzt wird es **ohne** `execute` an den Werkzeugen: Das SDK liefert die Tool-Calls eines Schritts, Helena führt sie selbst aus |
| AI SDK `ToolLoopAgent` / Mehrschritt-`stopWhen` | Apache-2.0 | nicht gewählt: Die Schleife läge im SDK. Persistenz nach jedem Schritt, Policy vor jedem Aufruf, Kompression, Modellwechsel mitten im Lauf und Schleifenerkennung müssten dann über Callbacks laufen. Die Schleife selbst sind ~300 Zeilen |
| `@ai-sdk/mcp` | Apache-2.0 | nicht gewählt: Es liefert fertige SDK-Tools mit `execute`, verbirgt aber die Annotationen, die die Policy braucht. Das offizielle MCP-SDK ist ohnehin Abhängigkeit von SDK und Gateway |
| OpenAI Agents SDK (JS) | MIT | nicht gewählt: auf OpenAI-Responses ausgerichtet, eigene Tracing- und Handoff-Semantik doppelt zu Helena |
| LangGraph.js | MIT | nicht gewählt: schwere Graph- und Checkpoint-Abstraktion, doppelt zur Helena-Engine (DBOS) |
| Mastra | Apache-2.0/ELv2-Teile | wurde gerade entfernt (D-C2). Nicht wieder einführen |
| Hermes über ACP | MIT | nicht gewählt: pro Lauf keine Toolsets, max-turns oder Reasoning (`runtime-protocol.md`), dazu hoher Fremd-Churn |
| Eigenes `fetch` gegen `/v1/chat/completions` | — | nicht gewählt: Das würde Anthropic, Reasoning-Formate und Tool-Call-Reparatur selbst nachbauen |

Neue npm-Abhängigkeiten: `@ai-sdk/openai-compatible` und `@ai-sdk/anthropic` (beide Apache-2.0). Im Runner kommen `ai` und `@modelcontextprotocol/sdk` als Bundle-Abhängigkeiten dazu. Kein neuer Dienst, kein Systempaket.

## 4. Architektur

```
Runner (volition-hermes)                         Sandbox-Unit des Projekts (vp-<slug>)
  run.ts / chat.ts                                 node dist/cli.js helena-agent --config <json> [--resume <id>]
   └ execute() ─ launch(helena) ─────────────────►  Schleife (packages/agent-runtime)
        ▲  stdout: helena-jsonl Events                ├ Modell: AI SDK streamText (Halogen / API-Key)
        │  (session, model, text, thinking,           ├ Werkzeuge: Helena-MCP (HTTP über plan.sock)
        │   tool-call, tool-result, usage,            │            Browser-Gateway (stdio-Shim, direkt)
        │   spend, result, escalate)                  │            Dateien/Shell (Arbeitsordner)
        │                                             │            Gedächtnis, Fakten, Skills, clarify
        └──────────────────────────────────────────── ├ Policy: POST /agent-policy/decide
                                                      └ Sitzung, Gedächtnis: Helena-API /agent-runtime/*
```

- **Eingabe:** Die Aufgabe kommt über stdin, die Einstellungen über `--config <datei>`. Die Datei schreibt der Adapter 0600 in den Arbeitsbereich des Laufs; bei Isolation liest sie der Projekt-Benutzer. Sie enthält MCP-Spezifikationen, Anweisungen, Skills, lokale Server, Modell, Rückfall-Kette, Werkzeug-Profil, Zeitgrenzen und Eskalationsregeln. Werte, die Geheimnisse sind, stehen nur als Variablennamen darin (wie bei `McpServerSpec`).
- **Ausgabe:** JSON-Zeilen im Format `helena-jsonl`: ein `RuntimeStreamEvent` je Zeile plus `spend`, `escalate` und `result`. Der Runner liest sie mit dem Parser der Laufzeit. Nicht-JSON auf stdout gibt es nicht, Diagnosen gehen nach stderr.
- **Beendigung:** SIGINT beendet die Schleife sauber. Der aktuelle Schritt wird abgebrochen, der Stand gespeichert, `result` mit Exit-Code 130 geschrieben. SIGKILL nach der Karenzzeit des Runners bleibt als Notbremse.

## 5. Die Schleife

1. **Start:**
   - Die Sitzung wird geladen (bei `--resume`) oder angelegt und ihre ID sofort als `session` gemeldet.
   - Das Modell wird aufgelöst und als `model` gemeldet.
   - Der Systemprompt entsteht aus Anweisungen, Gedächtnis (`MEMORY.md`, `USER.md`, Tagesnotizen von heute und gestern), Skill-Index und Werkzeug-Hinweisen.
2. **Schritt n:**
   - `streamText({model, instructions, messages, tools(ohne execute), abortSignal, timeout: {stepMs, chunkMs}})`.
   - Text- und Denk-Deltas gehen sofort als Events hinaus.
   - Die Tool-Calls des Schritts werden gesammelt.
3. **Werkzeuge:**
   - Sie laufen der Reihe nach, jedes mit eigener Zeitgrenze. Vor jedem nicht-lesenden Aufruf steht `decide()`.
   - Das Ergebnis geht auf höchstens 32.000 Zeichen gekürzt an das Modell. Fehler kommen als Tool-Ergebnis mit `isError` zurück, damit das Modell korrigieren kann.
   - `clarify` beendet den Zug: Frage und Auswahl gehen an den Chat, die Antwort kommt als nächste Nachricht.
4. **Nach jedem Schritt:**
   - Die neuen Nachrichten werden an die Sitzung angehängt (Append, idempotent über die Schrittnummer) und Verbrauch und Kontextgröße gemeldet.
   - Danach laufen die Prüfungen: Grenzen, Schleifenerkennung, Kompressionsschwelle, Eskalation.
5. **Ende:**
   - Ein Schritt ohne Tool-Calls ist die Antwort.
   - Dann folgen `spend` (Summe aller Schritte), `result` und Exit 0.

**Grenzen und Zeitgrenzen (hart):**

| Grenze | Standard | Quelle |
|---|---|---|
| Laufbudget gesamt | `runBudgetSeconds` des Laufs, sonst 1.800 s. Chat: 900 s | Lauf, Agent |
| Schritte | `maxTurns` des Laufs, sonst 40 | Lauf |
| Erstes Token eines Schritts / Pause zwischen Chunks | 120 s / 60 s | Konfiguration |
| Werkzeugaufruf | 120 s, Shell 300 s | Werkzeug-Profil |
| Browser-Aufgabe | 240 s für alle Browser-Werkzeuge eines Laufs zusammen (Owner: „harte Zeitgrenzen pro Browser-Aufgabe“). Danach bekommt das Modell nur noch „Browser-Zeit aufgebraucht“ | Werkzeug-Profil |

Der Runner behält darüber seine eigene Obergrenze (`timeoutMs`), der Launcher `runtimeMaxSec`.

**Schleifenerkennung:** Kommt derselbe Aufruf (Werkzeug plus Argumente) seit der letzten verändernden Aktion dreimal vor, oder bleiben fünf Schritte in Folge ohne neues Ergebnis, gilt das als Schleife. Die Folge ist ein Fehlschlag, der die Eskalation auslöst (§9).

## 6. Werkzeuge: wenige und gute pro Rolle

Werkzeug-Profile legen fest, was ein Agent sieht. Der Standard hängt an der Rolle, einstellbar über `runtimePolicy.helena.toolProfile`.

| Profil | Werkzeuge |
|---|---|
| `assistent` (Home, Koordinator, Triage) | Helena-MCP (Kernsatz: Aufgaben, Kommentare, Delegation, Wissen), Gedächtnis, Fakten, Skills, `clarify`, `find_tools` |
| `recherche` | wie `assistent` plus Browser direkt |
| `coder-lite` (Astro, Texte, einfache Änderungen) | `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `shell` im Arbeitsordner, plus Kernsatz |
| `voll` | alle Helena-MCP-Werkzeuge direkt |

- **`find_tools(query)`:** Werkzeuge außerhalb des Profils (übrige Helena-MCP-Werkzeuge, Bibliotheks-Server) lädt das Modell bei Bedarf. Treffer werden im **nächsten Schritt direkt** aufrufbar, mit echtem Schema und nicht über eine `tool_call`-Brücke. Genau diese Brücke ließ im Browser-Eval 11 von 112 Aufrufen scheitern.
- **Browser:** Die Schritt-Werkzeuge des Gateways (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, …) sind direkt im Modell. Die Gateway-Anweisungen (`BROWSER_INSTRUCTIONS`) kommen in den Systemprompt.
- **Dateien und Shell:**
  - Wege sind auf den Arbeitsordner begrenzt (realpath-Prüfung, keine Symlinks hinaus).
  - `shell` läuft in der Sandbox des Projekt-Benutzers (Isolation) mit Zeitgrenze und Ausgabe-Obergrenze.
  - Die Policy klassifiziert Shell-Befehle wie bei Hermes' `terminal` (`classifyShell`).

## 7. Datenmodell (Postgres, neue Tabellen mit `helena_`)

```
helena_agent_session         id uuid pk, agent_id fk, team_id, project_id null, kind 'run'|'chat'|'reflection',
                             run_id null, chat_thread_id null, model, created_at, updated_at,
                             summary text null (letzte Kompression), compacted_through int
helena_agent_session_item    id bigserial, session_id fk, seq int (unique je Sitzung), step int,
                             role 'system'|'user'|'assistant'|'tool', content jsonb (AI-SDK ModelMessage),
                             text tsvector (Volltext für die Sitzungssuche), tokens int, created_at
helena_fact                  id serial, team_id, project_id null (null = teamweit/Home), agent_id null,
                             content, category, tags, trust real (0..1, Start 0.5), helpful_count,
                             unhelpful_count, confirmations, retrieval_count, contradicted_by null fk,
                             hrr bytea (Phasenvektor float32, dim 1024), search tsvector, source jsonb
                             (run/chat/session), created_at, updated_at, deleted_at
helena_fact_entity           id, team_id, project_id null, name, name_lower (unique je Bereich)
helena_fact_entity_link      fact_id, entity_id
```

- **Gedächtnis:** keine neue Tabelle.
  - `agent_memory_revision.file` nimmt zusätzlich `notes/JJJJ-MM-TT.md` auf.
  - Die neueste Revision je Datei ist der aktuelle Stand. So zeigt der vorhandene Editor Versionen, Quelle (Agent, Owner) und Vorschläge.
- **Löschen:** nie hart. Sitzungen folgen der Aufbewahrung des Agenten (`sessionRetentionDays`). Fakten werden per `deleted_at` ausgeblendet.

## 8. Gedächtnis und Lernen

### 8.1 Markdown-Gedächtnis (OpenClaw-Muster)

- **`MEMORY.md`:** langfristig, kuratiert, Obergrenze 12.000 Zeichen statt Hermes' 2.200.
- **`USER.md`:** über den Owner.
- **Tagesnotizen `notes/<Datum>.md`:** knapp, nur anhängen.
- **Werkzeug `memory`:** Aktionen `read`, `note` (an die Tagesnotiz anhängen, ohne Freigabe) und `propose` (Änderung an `MEMORY.md`/`USER.md`). Mit `memoryApproval` wird daraus ein Vorschlag, ohne diese Einstellung sofort eine Revision.
- **Flush vor der Kompression:** Vor einer Kompression wird das Modell einmal gebeten, Wichtiges als Tagesnotiz festzuhalten. Nach einem Lauf kommt zusätzlich eine automatische Notiz mit Lauf-ID, Ergebnis und Stichworten (ohne Modell).
- **Konsolidierung („Träumen“, täglich oder nach N Notizen):**
  - Ein Reflexionslauf der Laufzeit `helena` auf dem lokalen Modell liest die Tagesnotizen seit der letzten Konsolidierung.
  - Er schlägt eine neue `MEMORY.md` vor, **immer als Vorschlag** (`agent_proposal` kind `memory-write`, Titel „Konsolidierung“). Das ist das Prüf-Tagebuch: Der Owner sieht den Vorher-/Nachher-Unterschied im vorhandenen Editor.

### 8.2 Faktenspeicher (Holographic-Prinzip, Owner-Zusatz)

Übernommen wird nur das **Prinzip** aus Hermes' `plugins/memory/holographic`, eigener TypeScript-Code in `packages/facts` (`@helena/facts`), kein Python.

- **Fakt:** ein kurzer Satz, dazu Kategorie, Schlagworte und Vertrauen. Entitäten werden erkannt (Großschreibung, Anführungszeichen, `@`/`#`, Projekt- und Ticket-Kürzel) und verknüpft.
- **HRR, Phasen-Kodierung:**
  - Jedes Atom ist ein Vektor aus 1.024 Winkeln, deterministisch aus SHA-256 von `wort:i`.
  - Binden ist Addition der Phasen, Lösen Subtraktion, Bündeln der zirkuläre Mittelwert. Ähnlichkeit ist der Mittelwert von cos(Δ).
  - Faktvektor = bündel(binde(Text, ROLLE_INHALT), binde(Entität_i, ROLLE_ENTITÄT) …).
  - Gespeichert als float32 in `hrr bytea` (4 KB je Fakt). Berechnet wird in der API im Prozess.
  - Für ≤ 5.000 Fakten je Bereich reicht ein Scan. pgvector ist bei Bedarf möglich: [cos θ, sin θ]/√d ergibt ein Skalarprodukt gleich der Phasen-Ähnlichkeit. Vorerst nicht nötig.
- **Suche:**
  - Volltext-Kandidaten (Postgres `websearch_to_tsquery`, Konfiguration `simple` plus `german`), dreifaches Limit.
  - Neu gewichtet: 0,4 × FTS-Rang + 0,3 × Jaccard + 0,3 × HRR-Ähnlichkeit. Das Ergebnis mal Vertrauen, mal zeitlicher Verfall 0,5^(Alter/Halbwertszeit, Standard 90 Tage).
  - Nur Fakten mit Vertrauen ≥ 0,3.
- **Weitere Abfragen:**
  - `probe(entität)`: Fakten, in denen die Entität eine Rolle spielt (Lösen des Rollen-Schlüssels, Vergleich mit dem Inhaltsvektor).
  - `related(entität)`: strukturell verbundene Fakten.
  - `reason([entitäten])`: UND-Verknüpfung (Minimum der Ähnlichkeiten), eine Art JOIN im Vektorraum.
- **Widerspruch mit Verfall:**
  - Beim Anlegen, und über `contradict` auf Abruf, werden Paare mit hoher Entitäts-Überlappung (≥ 0,3) und niedriger Inhaltsähnlichkeit gesucht. Wert = Überlappung × (1 − Ähnlichkeit), Schwelle 0,3.
  - Beim Anlegen verliert der ältere Fakt 0,1 Vertrauen und bekommt `contradicted_by`. Der Agent sieht den Widerspruch im Ergebnis und kann auflösen (`update`/`remove`).
- **Vertrauen steigt:**
  - Wird ein inhaltlich gleicher Fakt in einer anderen Sitzung erneut angelegt (Ähnlichkeit ≥ 0,9, gleiche Entitäten), gibt es kein Duplikat, sondern `confirmations+1` und +0,05.
  - `fact_feedback(helpful)` gibt +0,05, `unhelpful` −0,10. Der Wert bleibt in [0, 1].
- **Werkzeuge über Helena-MCP**, damit auch Claude Code und Codex sie nutzen:
  - `fact_store` mit `action` ∈ add, search, probe, related, reason, contradict, update, remove, list;
  - dazu `fact_feedback`.
  - Die native Laufzeit ruft sie über denselben MCP-Weg. Hermes' Issue #4781 (nicht injizierte Tools) entfällt, weil die Werkzeuge im Kernsatz jedes Profils stehen.
- **Bereich und ACL:**
  - Ein Agent sieht Fakten seines Projekts und teamweite Fakten.
  - Der Home-Agent sieht alle Projekte, auf die sein Owner Zugriff hat.
  - Schreiben geht nur ins eigene Projekt oder teamweit (Home).
  - Die Projekt-ACL prüft dieselbe Funktion wie beim Wissen (`agentProjectScope`).
- **Aufnahme-Regeln (wie die Reflexion):**
  - keine Geheimnisse: Secret-Scan vor dem Speichern, bei Treffer Ablehnung;
  - nur Nicht-Offensichtliches, keine Wiederholung von Code oder Tickets;
  - höchstens 500 Zeichen je Fakt.
- **UI:** Der vorhandene Gedächtnis-Editor bekommt einen Abschnitt „Fakten“ (Liste, Suche, bearbeiten, löschen, Vertrauen, Widersprüche) über Owner-Routen `/teams/:id/ai-agents/:agentId/facts`.

### 8.3 Skills

- Das Format ist `agentskills.io` (SKILL.md mit Frontmatter `name` und `description`); es liegt im Snapshot schon so vor.
- Der Systemprompt enthält nur den Index. `load_skill(name)` liefert die SKILL.md, `load_skill(name, file)` eine Zusatzdatei.
- Gelernte Skills schlägt die Reflexion vor (`agent_proposal` kind `skill`). Übernahme nur mit Freigabe.

### 8.4 Reflexion mit Erfolgsprüfung

- Nur nach Läufen mit **belegtem** Erfolg:
  - Status `success`;
  - kein Schleifenabbruch;
  - bei Code-Aufgaben: der letzte Testbefehl mit Exit 0.
- Bei Fehlschlag gibt es nur eine Tagesnotiz „was nicht ging“ und keinen Skill. Das behebt Hermes' „hält sich fast immer für erfolgreich“.
- Die Reflexion ist ein kurzer `helena`-Lauf ohne Browser und Shell, mit den Werkzeugen `memory` (nur `note`/`propose`), `fact_store` (add) und `propose_skill`.

### 8.5 Sitzungssuche und Kompression

- **Werkzeug `search_sessions(query)`:** Volltext über `helena_agent_session_item.text`. Treffer aus Sitzungen desselben Agenten, beim Home-Agenten alle, mit Auszug und Verweis.
- **Kompression:**
  - Ab 60 % des Kontextfensters des Modells (Halogen: 262k, Standard-Schwelle 128k) kommt zuerst der Gedächtnis-Flush.
  - Dann fasst das lokale Modell die Nachrichten vor den letzten 6 Schritten zusammen.
  - Die Zusammenfassung ersetzt sie im Kontext. Die Einträge bleiben in der Datenbank (`compacted_through`), die Sitzung bleibt vollständig lesbar.
  - Ein Tool-Ergebnis älter als 3 Schritte wird im Kontext auf 2.000 Zeichen gekürzt.

## 9. Eskalation und Rückfall

**Rückfall-Kette:** Anbieterfehler (Verbindung, 5xx, Zeitgrenze erstes Token) führen zum nächsten Eintrag der Kette.

- Kette: Agentenmodell → `fallbackModels` des Agenten → (bei lokalem Modell) die Cloud-Rückfallstufe, sofern sie über einen API-Schlüssel erreichbar ist.
- Der Schritt wird mit demselben Verlauf wiederholt.
- Das Modell, das wirklich antwortete, geht als `model` an `model_check`.

**Eskalation:** Übergabe an ein großes Modell mit dem bisherigen Verlauf. Die Auslöser sind in Helena einstellbar (`runtimePolicy.helena.escalation`):

| Auslöser | Regel |
|---|---|
| Aufgabenart | Labels oder Klassen des Tickets (`programmierung-gross`, `architektur`, `sicherheit`, `recht`, `aussenkommunikation`) bzw. eine Liste im Agenten. Führt zur Eskalation vor dem ersten Schritt |
| Unsicherheit | Der Entscheider (`decide`, Klasse `router`) liefert „schwer“ oder eine Sicherheit unter der Schwelle (Standard 0,8), einmal vor dem Start |
| Fehlschlag | Schleife, Laufbudget zu 80 % verbraucht ohne Antwort, zwei rote Testläufe hintereinander (Shell-Befehl mit `test`, Exit ≠ 0), Modell liefert zweimal ungültige Tool-Calls |
| Festlegung | pro Agent (`always`/`never`), pro Projekt, pro Aufgabe (Label `grosses-modell`) |

**Ziel:**
- Ein API-Modell (z. B. Anthropic-Schlüssel) wird direkt in der Schleife gewechselt.
- Für Claude Code oder Codex (Abos) endet die Schleife mit dem Event `escalate {target, reason, handover}`, Exit-Code 3.
- Der Runner meldet das mit dem Ergebnis. Die API legt einen **Folge-Lauf** für das Ziel an: denselben Agenten mit Laufzeit-Überschreibung, oder den im Projekt festgelegten Eskalations-Agenten.
  - Der Folge-Lauf trägt `trigger: 'escalation'` und `parentRunId`.
  - Sein Prompt ist die ursprüngliche Aufgabe plus Übergabe: Zusammenfassung, geänderte Dateien, letzter Testbefehl mit Ausgabe, Grund.

**Messen:** Eskalationsquote, Erfolgsquote und Abo-Verbrauch je Woche aus `agent_run` und `agent_usage` für das Dashboard (Phase 2). Die Owner-Entscheidung „Opus oder gpt-6-sol wofür“ bleibt offen und ist nur eine Einstellung.

## 10. Freigaben, Sicherheit, Isolation

- **Policy:**
  - Vor jedem Aufruf der Kategorien write, delete, execute, send, pay usw. fragt die Schleife `decide()`.
  - Ergebnis `needs-approval`: Das Werkzeug liefert „BLOCKIERT: wartet auf Freigabe #id“, das Modell beendet den Zug. Die vorhandene Freigabe-Karte und der Folge-Lauf nach Freigabe (`actionApproved`) greifen wie bei Hermes.
  - Ist Helena nicht erreichbar, wird **abgelehnt**, nicht durchgewunken.
- **Harte Sperren** (Zahlung, Zugangsdaten, externes Löschen) bleiben in `decide()`. Die Laufzeit hat keinen Weg daran vorbei.
- **Geheimnisse:**
  - Schlüssel kommen nur als Umgebungsvariablen (API-Schlüssel, `ITSAPLAN_API_KEY`, `keyEnv` der lokalen Server).
  - Tool-Ausgaben und Events maskiert der Runner wie bisher (`SecretMask`).
  - Die Laufzeit schreibt keine Werte in Sitzungen, die in der Maske stehen.
- **Isolation:**
  - Launcher-Eintrag `helena` mit `exec /usr/local/bin/node`, `fixedArgs [dist/cli.js, helena-agent]`, `readOnly [dist]`.
  - Der Netzweg zu Halogen läuft über den Weiterleiter aus `hub/halogen-integration`, die Adresse steht in `localAi.servers[].baseUrl` des Snapshots. Der Weg zur API läuft über `plan.sock`, zum Internet über Egress.

## 11. Migrationspfad, Feature-Flag, Rückweg

1. `HELENA_NATIVE_RUNTIME=on` in der API setzen. Ohne diesen Wert kennt die API `helena` nicht: Die Einstellung wird verworfen, der Agent bleibt auf Hermes.
2. Runner-Bundle und Launcher-Eintrag ausrollen (normales `deploy.sh`, Launcher-Konfiguration über `isolation.sh sync`). Katalog-Skript: `helena` in `CLI_RUNTIMES`.
3. **Pro Agent:**
   - `runtimePolicy.runtime = 'helena'` setzen, Modell `helena-halogen/halogen-qwen3.8-flash-next`, Werkzeug-Profil und Eskalationsziel wählen.
   - Reihenfolge wie im Plan, Phase 2: Hintergrund- und Test-Agent zuerst, dann Koordinatoren, dann Home, dann Fach-Agenten.
   - Jeweils Eval bestanden und eine Woche Beobachtung.
4. **Rückweg:**
   - Laufzeit des Agenten zurück auf Hermes: Die Sitzungen der nativen Laufzeit bleiben in Helena. Hermes startet eine neue Sitzung, Gedächtnis und Fakten bleiben erhalten.
   - Oder das Flag global aus.
5. **Hermes fällt weg**, wenn kein Agent mehr darauf läuft (Phase 3, Schritt 6). Dann entfallen:
   - Katalog-Skript, `hermes-profile.ts`, `hermes-settings.ts`;
   - der Approval-Guard;
   - der Anthropic-OAuth-Pool;
   - der Hermes-Update-Helfer und die `volition-hermes`-Symlinks.

## 12. Tests und Abnahme

- **Einheit (`packages/agent-runtime`, `bun test`)**, mit einem Fake-Modell aus AI SDK `MockLanguageModel` bzw. einem eigenen Test-Provider. Abgedeckt:
  - Schleife, Streaming-Events, Abbruch, Laufbudget, Schritt-Zeitgrenze;
  - Schleifenerkennung, Rückfall-Kette, Eskalationsauslöser, `clarify`, Werkzeugpfad-Grenzen;
  - Policy-Ablehnung, Kompression, Resume aus gespeicherter Sitzung.
- **Runner:** Parser `helena-jsonl`, Preset-argv, Adapter-Konfigurationsdatei, Session- und Spend-Weg.
- **API (privates Postgres):** Sitzungs-Routen (Append idempotent, Resume, ACL), Faktenspeicher (add, search, probe, related, reason, contradict, feedback, Vertrauen, Verfall, Secret-Ablehnung, Projekt-ACL), Gedächtnis-Notizen und Vorschläge.
- **Faktenspeicher rein:** HRR-Eigenschaften (lösen(binden(a, b), a) ≈ b, Quasi-Orthogonalität, deterministische Atome).
- **Abnahme mit echtem Halogen** (höchstens eine Anfrage gleichzeitig):
  - Coding-Eval `apps/api/src/scripts/agentic-coding` mit `--runtime helena`: dieselben 12 Aufgaben, Maßstab Hermes + Flash 12/12 in ~54 s. **Ziel ≥ 11/12**, weniger Tokens pro Aufgabe.
  - Browser-Eval `apps/api/src/scripts/agentic-browser` (aus `hub/agentic-browser-eval`) mit `--runtime helena`: 20 Aufgaben, Maßstab Hermes + Flash 17/20 streng. **Ziel ≥ 18/20 und 0 gescheiterte Aufrufe durch die Tool-Brücke.**
- **Liveabnahme (Orchestrator, später):** ein Test-Agent auf `helena` bearbeitet ein Ticket mit Kommentar und Browser. Runner-Neustart mitten im Lauf, dann Resume. Freigabe-Karte bei `delete`. Verbrauch erscheint im Ledger. Rückweg auf Hermes.

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Qualität der eigenen Schleife bei Randfällen (parallele Tool-Calls, kaputtes JSON) | AI SDK repariert Tool-Calls. Parallele Aufrufe laufen der Reihe nach, eine Evals-Abnahme vor jeder Umstellung |
| Halogen ist geschlossen und hat eine einzige Instanz mit 4 Plätzen | Rückfall-Kette, Eskalation, Version gepinnt (`hub/halogen-integration`) |
| Kontextwachstum lange Chats | eigene Kompression und Tool-Ergebnis-Kürzung, Kontextgröße in der UI |
| Sitzungsdaten in Postgres wachsen | Aufbewahrung je Agent, Items komprimierter Abschnitte bleiben aber zählen |
| Shell im Nicht-Isolationsbetrieb (Eval, Operator-Runner) | Pfadgrenze plus Policy; ohne Isolation ist `shell` nur im Eval-Modus erlaubt (`--allow-unsandboxed-shell`) |
| Faktenspeicher wird Müllhalde | Aufnahme-Regeln, Vertrauen und Verfall, Owner-Korrektur im Editor |
| Doppelte Arbeit mit parallelen Zweigen | Schnittstellen §14 |

## 14. Schnittstellen zu parallelen Zweigen

- **`hub/halogen-integration`:**
  - Braucht einen Server-Eintrag Halogen (OpenAI-kompatibel) im Local-AI-Snapshot mit `provider` (z. B. `helena-halogen`), `baseUrl` (für Isolierte: der Weiterleiter) und Modellen mit `capabilities: ['chat','tools','reasoning']` und `contextLength`.
  - Die Laufzeit liest nur `snapshot.localAi.servers`, sie baut keinen eigenen Weiterleiter.
  - Den Entscheider (`logit_bias`) nutzt sie über den vorhandenen `decide`-MCP.
- **`hub/phase0-stabil`:** Runner-Drain und Gate. Die Laufzeit hält SIGINT sauber ein, damit der Drain nicht SIGKILLen muss. Neue Test-Suite `packages/agent-runtime` und `packages/facts` gehört ins Gate.
- **`hub/agentic-browser-eval`:** wird in diesen Zweig gemergt, die Eval bekommt `--runtime helena`.

## 15. Umsetzungsreihenfolge

1. Kernschleife mit Tool-Calls, Streaming, Abbruch, Zeitgrenzen, Ausgabeformat, CLI.
2. Helena-MCP und Browser direkt, Datei- und Shell-Werkzeuge, Policy.
3. Sitzungen persistiert (API und Tabellen), Resume nach Runner-Neustart.
4. Gedächtnis (Markdown, Tagesnotizen), Skills bei Bedarf.
5. **Faktenspeicher** (Holographic-Prinzip, Helena-MCP, Editor-Routen).
6. Eskalation und Rückfall.
7. Usage und Kosten ins Ledger.
8. Runner-Integration (Preset, Adapter, Parser, Launcher, Katalog), Feature-Flag.
9. Abnahme-Suite (Coding und Browser über die neue Laufzeit).

Stand der Umsetzung: siehe Abschnitt „Umsetzungsstand“ am Ende (wird mit jedem Commit fortgeschrieben).
