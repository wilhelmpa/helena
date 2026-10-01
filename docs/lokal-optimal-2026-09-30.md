# Lokale KI: Auftrag 188, Stand 01.10.2026

Auftrag 188 ist technisch angehalten; die zentrale Vorschau für „Lokal 27B + NPU“ liefert weiterhin Status 400.
Es gibt keine neue Tempo-/Qualitätsmessung, keine gemessene optimale 27B-Konfiguration und keine neue Standardprofil-Empfehlung.

Der Release-Marker `~/agent-work/release/12.11-deployed` wurde alle zwei Minuten geprüft und nach zehn Minuten um 05:44:41 Europe/Berlin erkannt; seine tatsächliche Änderungszeit ist 05:43:18.
Der Arbeitsbranch `hub/lokal-188` basiert auf dem deployed Commit `45398cc35`.
Die Prüfung verwendet die deployed API-Servicefunktionen `listModelServers`, `globalModelStatus` und `previewGlobalModel` als `volition-plan`, ohne Owner-Login oder Owner-HTTP-Sitzung; Status 400 ist der `HttpError.status` des identischen Vorschauhandlers, kein neu ausgeführter authentifizierter HTTP-Request.

| Prüfung / Maßnahme | Ergebnis |
|---|---|
| Katalog nach Release 12.11 | Embedding (`local`), STT, TTS und Halogen vorhanden; Lemonade und NPU fehlen |
| Offizieller NPU-Registrierungs-CLI | Erfolgreich ausgeführt; `volition-npu`, `fastflowlm`, `http://127.0.0.1:13309/v1`, deaktiviert, Modellliste leer |
| Offizieller Lemonade-CLI vor Fix | Prüft den vorhandenen Embedding-Server unter `local` und registriert keinen Lemonade-Server |
| CLI-Fix | Bestehendes Lemonade unter `local` bleibt erhalten; wenn `local` einen anderen Servertyp hat, wird Lemonade separat als `volition-lemonade` registriert; ein kollidierender Ziel-Servertyp wird abgewiesen |
| Ausführung des korrigierten offiziellen CLI | Als `volition-plan` über `systemd-run --pipe` und stdin ausgeführt, da dessen UID das private Home nicht betreten kann; nur Importpfade angepasst und die getestete Slug-Funktion unverändert eingebettet; kein Deploy |
| Lemonade-Registrierung danach | `volition-lemonade`, `lemonade`, `http://127.0.0.1:13305/api/v1`, aktiviert; nicht erreichbar, Modellliste leer |
| Vorschau danach | Status 400: `Choose a downloaded local chat model` |
| Installierter NPU-Gateway / Worker | `GATEWAY_PORT = 13309`, `WORKER_PORT = 13310`; 13306/13307 stehen nur im Sprach-Port-Kommentar |
| Installierter Hostd | Reserve 12 GiB; TTS ist Bestandteil der normalen GPU-Begleitprozessgruppe |
| Gemma | Gateway und Hostd erlauben weiterhin nur Qwen 2b/4b; Gemma-Auswahl ist nicht freigegeben und nicht gemessen |
| Endzustand | Halogen, STT und TTS aktiv; Lemonade und NPU aus; keine laufende Wartungsoperation, keine GPU-Umschaltung |

**Bootstrap-Blockade:** Der ausgeschaltete Lemonade-Daemon liefert keinen Modellkatalog; die API verlangt das katalogisierte, heruntergeladene 27B-Modell bereits vor der zentralen Umschaltung, die Lemonade starten würde.
Der Registrierungs-CLI allein kann diesen Kreis nicht lösen.
Es wurde weder ein Modell-Datensatz erfunden noch die zentrale GPU-Steuerung durch direkte Dienststarts umgangen.
Claude muss den zentralen Bootstrap ermöglichen und den Modellkatalog anschließend über den korrigierten offiziellen CLI aktualisieren; die folgenden Registrierungsbefehle allein beheben den Bootstrap nicht.

Nach Übernahme des CLI-Fixes und bei erreichbarem Lemonade, als Root:

```bash
systemd-run --wait --pipe --collect --uid=volition-plan \
  -p EnvironmentFile=/etc/volition/plan.env \
  -p WorkingDirectory=/srv/volition/source/plan \
  /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts

systemd-run --wait --pipe --collect --uid=volition-plan \
  -p EnvironmentFile=/etc/volition/plan.env \
  -p WorkingDirectory=/srv/volition/source/plan \
  /usr/local/bin/bun apps/api/src/scripts/register-npu.ts
```

Validierung: Der konkrete Embedding-/Lemonade-Regressionsfall war rot; nach dem Fix bestehen alle vier gezielten Tests für Slug-Auswahl und Erhalt vorhandener Registrierungen.
Der korrigierte CLI wurde tatsächlich gegen die bestehende API-Datenbank ausgeführt und registrierte Lemonade separat, während der Embedding-Eintrag erhalten blieb.
Prettier besteht für die drei geänderten Code-/Testdateien; der volle Web-Lint besteht mit 0 Fehlern und 5 Warnungen.
Kein Full-Gate, Deploy, Download, Login oder Eingriff in das Live-Checkout; ausschließlich die im Auftrag erlaubten API-Skripte liefen über sudo als `volition-plan`.

Offen bleiben sämtliche 27B-Varianten (MTP, Slots, ubatch, KV, Flash-Attention, hipBLASLt), der Nachweis deutlich über 25 Tokens/s bei gleicher Qualität, NPU-Klassen-Evals, Coding 12, Browser 20, Sprach-E2E, Jev 48, die dauerhafte optimale Profilkonfiguration und die echten Einzelantworten aller 40 Agenten.
Flash blieb aktiv; eine Rückumschaltung war nicht erforderlich und wird nicht als neu gemessene Empfehlung ausgegeben.
Es wurden keine `[Test-188]`-Objekte angelegt; es ist keine Testobjekt-Löschung offen.

Belege: [vor Registrierung](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/readiness188.json), [alter Lemonade-CLI](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/register-lemonade188.log), [korrigierter CLI](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/register-lemonade-fixed188.log), [abschließende Vorschau](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/readiness-final188.json), [installierte Vorgaben](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/installed188.json), [Test rot](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/registration-red188.log), [Test grün](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/registration-green188.log), [Web-Lint](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/web-lint188.log), [Dienst-Endzustand](/home/wilhelmpa/agent-work/codex-tasks/188-evidence/final-services188.txt).

---

# Lokale KI: Auftrag 186, Stand 01.10.2026

Auftrag 186 ist technisch angehalten; es gibt keine neue 27B-Einstellung und keine vollständige 100-%-Freigabe.
Das ruhige Fenster begann nach dem tatsächlichen Abschluss von 181b um 03:08; dessen Bericht heißt `181-bericht.md`, deshalb wurde `181b-bericht.md` als unverändernder Symlink darauf angelegt.
Die Startvoraussetzungen wurden seit 23:25 alle zwei Minuten anhand von Prozessen und Auftragslogs geprüft; `max.txt` stand während des Fensters auf 1 und ist wieder auf 9 gesetzt.
Während des W4B-Versuchs lief kein Full-Test; der Messwächter prüfte zusätzlich alle fünf Sekunden Full-Test-Prozesse, Speicher, Swap und full-PSI und hielt die exklusive Bench-Sperre.

| W4B, tatsächlich gemessen | Ergebnis |
|---|---|
| Installierte Halogen-Version | 0.14.2; vorhandenes Image verwendet, keine Installation oder Downloads |
| Checkpoint / Overlay | HGN1 Version 2; 124.068.083.904 / 2.572.466.560 Bytes |
| CPU-Headerprüfung mit `flash_serve --resident-gib`, alle ROCm-Dienste gestoppt | `68.0 1 0`: Resident-Unterstützung vorhanden, 68 GiB laut Header |
| MemAvailable unmittelbar vor Start | 103,61 GiB; NPU und TTS aus, keine aktiven Projektbrowser-Instanzen |
| Laufzeit bis Abbruch | 49,86 s; noch keine abgeschlossene Resident-Ladung, kein antwortender W4B-Endpunkt |
| full-PSI avg10 | 11,06 %; vorgeschriebene Grenze 5 % überschritten |
| Swap während des Versuchs | 2,16 → 3,73 GiB, Wachstum 1,57 GiB; Swap-Grenze nicht erreicht |
| Folge | Alle ROCm-Dienste gestoppt, W4B-Drop-in zurück nach `.off`, daemon-reload, IQ4 wieder geladen |

Damit sind W4B-Tempo 1/2/4, erster Token, Klassen, Coding 12, Browser 20, deutsche Texte und 30-Minuten-Stabilität **nicht gemessen**; eine Geschwindigkeits- oder Qualitätsaussage wäre unbelegt.
Die Headerprüfung bestätigt Unterstützung, keine Tragfähigkeit auf diesem belegten Host; die [Halogen-Dokumentation](https://github.com/peonist-ai/halogen-flash-server/blob/main/README.md) beschreibt zusätzlich zum Resident-Speicher den Lookup-Dateicache und Arbeits-/KV-Speicher.
Der Abbruch ist in [abort-w4b.json](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/abort-w4b.json) festgehalten, die Fünf-Sekunden-Reihe in [memory186.jsonl](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/memory186.jsonl), der Header in [w4b-resident.log](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/w4b-resident.log).

Vor dem W4B-Start wurde die ausdrücklich erlaubte Swap-Bereinigung bei 103,01 GiB MemAvailable und 16,21 GiB belegtem Swap versucht; die Bedingung „MemAvailable > Swap + 12 GiB“ war erfüllt.
`swapoff -a` scheiterte trotzdem mit `Cannot allocate memory`: Um 03:23:41 beendete ein **cgroup-OOM im Embedding-Dienst** dessen llama-server, obwohl global genügend Speicher verfügbar war.
`swapon -a` wurde anschließend ausgeführt, alle 32 GiB Swap sind wieder aktiv und Embedding startete automatisch wieder; es gab keinen weiteren Swap-Bereinigungsversuch.
Das ist ein Betriebszwischenfall dieser Arbeit, kein W4B-Qualitätsfehler; im geprüften Kerneljournal erschien kein GPU-Reset.

| 27B: installierte Konfiguration, keine neue Messung | Wert |
|---|---|
| Server / Backend | Lemonade, llama.cpp b11166, ROCm; kein Halogen-27B |
| Lokal vorhandene 27B-Quantisierung | `Qwen3.8-27B-UD-Q4_K_XL.gguf`, 17.559.178.144 Bytes; keine weitere lokale 27B-Quantisierung gefunden |
| Gespeicherte Spekulation | `draft-mtp`, 2 Draft-Tokens, kein separates Draft-Modell |
| Slots / Kontext | 2 Slots, 65.536 Token je Slot, 131.072 gesamt |
| hipBLASLt | `ROCBLAS_USE_HIPBLASLT=1` in der offiziellen Lemonade-Unit |
| Batch / ubatch / Flash-Attention / KV-Typ | Keine expliziten gespeicherten Modellparameter festgestellt; aktive 27B-Startargumente und Vergleichswerte fehlen, weil der Server nicht gestartet wurde |
| Separater lokaler Draft-Kandidat | Qwen3-0.6B Q4_0 vorhanden; Kompatibilität und Qualitätswirkung nicht geprüft |
| Offizielle Profilvorschau `local-27b-npu` | HTTP 400: `Choose a downloaded local chat model` trotz vorhandener GGUF-Datei; API-Katalogregistrierung fehlt |

Die installierte NPU-Portkollision aus 181b besteht weiterhin; die dafür notwendige gemeinsame Übernahme von API/hostd/Gateway/Firewall ist ein Deploy und diesem Auftrag untersagt.
Die ältere [27B-Messung vom 29.09.](/home/wilhelmpa/volition/docs/benchmark-27b-npu-2026-09-29.md) enthält etwa 17 Tokens/s mit MTP und 11,5 ohne MTP; diese historischen Werte sind **keine Messung aus Auftrag 186** und belegen kein neues Optimum.
MTP an/aus, Draft, Slots 1–4, KV q8/f16, ubatch und hipBLASLt wurden in 186 nicht verglichen; das Ziel deutlich über 25 Tokens/s ist nicht nachgewiesen und das Profil wurde nicht geändert.
Die offenen Qualitätsfälle aus 181b bleiben Browser `local-product-info` (19/20 insgesamt) und deutsche 2FA-Wiederherstellung (9/10 insgesamt); keine Assertions wurden abgeschwächt, keine Prompts oder Laufzeitänderungen als erfolgreich ausgegeben.

IQ4 ist wieder mit den Ausgangswerten aktiv: 4 Slots, KV-Pool 262.144, MAX_TOK 16.384, Reasoning medium, WEIGHTS_LOCK 1.
Ein Wiederherstellungsversuch mit Pool 131.072 / MAX_TOK 4.096 scheiterte vor Modellladung, weil die installierte Unit `HALOGEN_CTX` nicht weiterreicht und Halogen einen Pool mindestens so groß wie den Kontext 262.144 verlangt; die Originalkonfiguration wurde danach vollständig zurückkopiert.
Der [Flash-Test](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/recovery-smoke.log) erhält HTTP 200 für Health und Chat sowie „IQ4 bereit“ nach 4,47 s.
Der [Agentenstatus](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/recovery-agent-summary.json) meldet alle 40 Native-Agenten online mit Flash, sechs sind pausiert; **echte Einzelantworten aller 40 wurden nicht getestet**.
NPU und Lemonade bleiben aus, Embedding und Projektbrowser-Router sind aktiv; keine vorher aktiven Projektbrowser-Instanzen mussten wieder gestartet werden.
TTS und sein Proxy/Socket bleiben vorerst aus: Nach IQ4 schwankt MemAvailable zwischen etwa 7 und 10 GiB, während Auftrag 168 vor jedem Start mindestens 20 GiB verlangt; für den Rückstart wurde eine ausdrückliche Ausnahme angefragt, aber nicht erteilt.
181b nennt keine abschließende Standardprofil-Empfehlung; deshalb bleibt die bisherige Flash-Konfiguration aktiv, ohne sie als neues gemessenes Optimum auszugeben.
Der volle [Web-Lint](/home/wilhelmpa/agent-work/codex-tasks/186-evidence/web-lint186.log) besteht mit 0 Fehlern und 5 Warnungen; kein Full-Gate, Deploy oder Eingriff in das Live-Checkout.
Ergebnisbranch `hub/lokal-100` enthält ausschließlich diese Messdokumentation einschließlich der unveränderten historischen 181b-Ergebnisse unten; es wurden keine erfolgreichen Backend-Fixes erfunden.

---

# Historischer Stand: Messungen 181b vom 30.09.–01.10.2026

Stand 01.10.2026, 03:08 Europe/Berlin: Die aufgeführten Flash-Reihen sind abgeschlossen; der Gesamtauftrag ist wegen der Voraussetzungen für 27B/NPU angehalten.
Bench-Sperren wurden blockierend abgewartet, fremde Full-Tests alle zwei Minuten geprüft, unterbrochene Messungen verworfen und vollständig wiederholt; zwischen Messgruppen wurde die Sperre freigegeben.
Owner-Nutzung wurde anhand unmarkierter laufender Chats geprüft und nicht festgestellt; andere Test-Agentenläufe wurden gemäß 181b nicht als Owner-Nutzung gewertet.

Aktiv blieb Flash IQ4 mit 4 Slots, 262.144 KV-Pool-Positionen und System-Reasoning medium; Konfiguration und GPU-Dienste wurden nicht umgestellt.
Alle Native-Reihen für Coding, Skills und den reparierten Browseradapter starteten auf Quellstand 9df9c5c94; die erste traditionelle Klassenreihe begann unter Release 12.9 (ae8305a7f).
Die Quellenänderung durch andere Arbeiten wurde erst später bemerkt; die [Startprotokolle](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/measurement-starts181b.json) bestätigen denselben Stand für die Native-Vergleiche.

| Klasse | Reasoning | Bestehen | p50 vollständige Antwort | Tokens/s |
|---|---|---:|---:|---:|
| hermes-helpers | off | 30/30 | 32,203 s | 13,5 |
| summaries | low | 4/4 | 11,608 s | 19,2 |
| triage | low | 16/16 | 2,321 s | 14,7 |
| voice-reply | off | 15/15 | 1,739 s | 14,8 |
| routines | low | 8/8 | 4,434 s | 13,5 |
| reflection | off | 30/30 | 14,537 s | 16,9 |
| coordinator-triage | low | 5/5 | 33,821 s | 15,3 |
| decisions | off | 27/27 | 1,001 s | 4,4 |
| Native skill-usage | off | 46/47 | 8,745 s | 29,4 |
| Native skill-usage | low | 47/47 | 13,084 s | 31,8 |
| Native skill-learning | off | 30/30 | 3,149 s | 32,4 |

Die acht traditionellen Klassen bestehen 135/135 Fälle; zeitweise liefen 1–3 andere Agentenläufe, deshalb sind deren Latenzen als Messung mit Begleitlast zu lesen.
Der off-Skill-Fall coder-test-driven-development-distractors lädt einen zusätzlichen Skill trotz korrekter Arbeitsschritte und verfehlt die Klassenschwelle von 100 %; low besteht alle 47 Fälle.
Die Skill-Reihen liefen über den korrigierten Eval-Client ohne obligatorische API-Key-Variable gegen die bestehende Native-Laufzeit; der Clientfix wurde nicht deployed.
Der Ergebnisbranch setzt die Skill-Nutzungs-Vorgabe auf low und Eval-Version 2; der gemessene low-Beleg wurde zusätzlich über storeCliEval unter Version 2 gespeichert.
Die Live-Klasse bleibt experimentell und ohne automatische Weiterleitung; die historischen off/low-Vergleiche bleiben erhalten.
Auch die übrigen Klassenresultate wurden über den offiziellen Eval-Speicher abgelegt.

| Reasoning | Parallel | Antworten ohne Warm-up | Gesamtdurchsatz p50 | Sichtbarer Durchsatz p50 | Erster sichtbarer Text p50 |
|---|---:|---:|---:|---:|---:|
| low | 1 | 3 | 46,6 Tokens/s | 9,0 Tokens/s | 17,157 s |
| low | 2 | 6 | 38,2 Tokens/s | 7,3 Tokens/s | 41,156 s |
| low | 4 | 12 | 65,4 Tokens/s | 12,6 Tokens/s | 46,804 s |
| medium | 1 | 3 | 47,6 Tokens/s | 7,3 Tokens/s | 22,722 s |
| medium | 2 | 6 | 43,6 Tokens/s | 6,7 Tokens/s | 48,151 s |
| medium | 4 | 12 | 66,2 Tokens/s | 10,2 Tokens/s | 63,466 s |
| off | 1 | 3 | 37,8 Tokens/s | 37,8 Tokens/s | 0,006 s |
| off | 2 | 6 | 44,3 Tokens/s | 44,3 Tokens/s | 0,067 s |
| off | 4 | 12 | 67,9 Tokens/s | 67,9 Tokens/s | 0,155 s |

Tempo: direkter Halogen-Port 8731, fester deutscher Prompt, Temperatur 0, maximal 2.048 Ausgabetokens, ein Warm-up-Batch und drei Messbatches je Parallelität und Stufe.
Alle 84 Antworten einschließlich Warm-up enden regulär und erfüllen zehn nummerierte Sätze mit mindestens acht Wörtern je Satz; dies ist keine unabhängige Bewertung komplexer Chat-Aufgaben.
Die Werte gelten für warme kurze Prompts und enthalten keine STT-/TTS- oder Anwendungslatenz; Thinking-Tokens werden separat vom sichtbaren Text ausgewiesen.
Klassen, Skills und Deutsch nutzten den SDK-Hintergrundweg über den Prioritätsproxy; Coding und Browser liefen mit Native-Standard low gegen den angegebenen Port 8731.

| Zusätzlicher Umfang | Ergebnis | Latenz und Werkzeugbefund |
|---|---|---|
| Coding 12 | 12/12 | p50 16,631 s; insgesamt 200,207 s; 52 Werkzeugaufrufe, 48 erfolgreiche Werkzeugresultate; keine Schleifen oder Abbrüche |
| Browser 20, korrigierter Adapter | 19/20 | p50 16,148 s; insgesamt 469,121 s; 105 Werkzeugaufrufe, 103 erfolgreiche Resultate, 1 Gateway-Fehler; keine Schleifen, Abbrüche oder Timeouts |
| Deutsche Texte, off | 9/10 Fälle; mittlere Wertung 87/100 über Klassenschwelle 80 % | Lokale Erzeugung p50 2,902 s; inklusive Judge p50 7,932 s |

Der Browser-Produktfall nennt korrekt 49 €, bleibt jedoch auf der Suchseite, deren Endzustand die strenge Prüfung „Preis: 49 €“ nicht erfüllt; er bleibt als nicht bestanden gezählt.
Im Login-Fall sind zwei Werkzeugresultate fehlerhaft, das erwartete Endverhalten besteht aber nach 144 s; fehlerhafte Werkzeugresultate sind nicht pauschal ungültige JSON-Argumente.
Die Deutschwertung nutzt den vorhandenen CLI-Judge mit Alias sonnet, dessen konkrete Modellversion nicht festgehalten wurde; der Codex-Judge scheiterte beim Start, und die Owner-API bietet derzeit keinen geeigneten Judge-Agenten an.
Der schwache Deutschfall ist 2FA-Wiederherstellung mit 60/100: Flash nennt konkrete UI-Wege, obwohl das Produkt im Fixture nicht festgelegt ist.

Nicht als Modellqualität gewertet: beim Full-Test unterbrochene Tempo-Reihen, technische Import-/Argumentfehler vor Modellaufrufen, Coding-Diagnosen mit meiner zusätzlichen und anschließend entfernten Netzwerkbeschränkung sowie die ersten Browserläufe mit fehlender previews-Methode.
Die ursprünglichen Browserwerte 9/20 sind wegen dieses Adapterfehlers keine belastbare Qualitätsmessung; die reparierte Wiederholung ergibt 19/20.

Das zweite Profil bleibt technisch blockiert: Der installierte NPU-Gateway/Worker verwendet 13306/13307 und kollidiert mit den Sprach-Sockets; im API-Katalog fehlen 27B und NPU, die zentrale 27B-Vorschau antwortet HTTP 400.
Gemma e2b/e4b und Qwen 2b/4b sind installiert, der verwaltete Gateway akzeptiert jedoch nur Qwen 2b/4b; Gemma braucht einen freigegebenen Betriebsweg, und e4bs Katalog-Footprint 9,1 GB muss gegen das Dienstlimit von 8 GiB geprüft werden.
Vor Fortsetzung müssen API/hostd/NPU-Gateway/Proxy und Worker-Firewall gemeinsam auf 13309/13310 übernommen, Modellserver offiziell registriert und Gemma-Auswahl sowie Speichergrenzen geklärt werden; ein Deploy ist diesem Auftrag ausdrücklich untersagt.

Auf hub/lokal-battle sind sieben Änderungen nach /srv/volition/source/plan gepusht, zuletzt 219b4c5c0: NPU-Porttrennung, Worker-UID-Sperre, CLI-Poolfreigabe, Native-Fehlerausgabe, keylose Skill-Evals, Browser-Previewadapter sowie low/Eval-Version 2 für Skill-Nutzung.
Validierung: 40 gezielte Tests (10 Python, 7 private API-Integration, 3 CLI, 17 Native-Harness, 2 keylose Skill-Regressionen, 1 Versionsprüfung), privater Firewall-Namespace-Test, der reproduzierte Browserfall und die vollständigen Messreihen.
Der volle Web-Lint am letzten Commit besteht mit 0 Fehlern und 5 Warnungen; kein eigener Full-Gate, kein Deploy, keine UI- oder Host-Firewalländerung und keine Änderung am Live-Checkout durch Codex.

Teil-Empfehlung: off ist für die gemessenen einfachen Schnellantworten ein Kandidat; Skill-Nutzung braucht im gemessenen Flash-Setup low für die vollständige Freigabe.
Eine allgemeine Chat-Vorgabe oder ein Standardprofil Flash versus 27B/NPU ist noch nicht abschließend empfohlen.
Flash bleibt im stabilen bisherigen Zustand aktiv, TTS und Sprach-Sockets sind aktiv, NPU ist aus und eigene Test-Postgres/Browser sind beendet.
W4B bleibt gemäß Owner ausgeschlossen: etwa 68 GiB resident plus große Lookup-Tabelle im Dateicache bei rund 18 GiB bereits belegtem Swap sind neben dem Rest nicht tragfähig.

Offen: Slots-/Kontextvarianten, kontrollierter Chat-/Hintergrundvergleich, das gesamte 27B/NPU-Profil einschließlich Gemma/Qwen-Vergleich, Sprach-E2E/WER/Robustheit, Jev 48, beide Agenten-/Last-/Ausfall-Battles mit Cloud-Rückfall, die zwei Schemata, Profilvergleich und tatsächliche Antworten aller 40 Agenten.
Es wurden keine [Battle-181]-Chats, Aufgaben oder Schemata angelegt; temporäre Coding-/Browser-/Skill-Fixtures wurden vom Harness aufgeräumt, Eval-Belege bleiben erhalten.

Belege: [Klassen](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-classes-baseline.json), [Skill off](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-skill-usage-keyless-v3-summary181b.json), [Skill low](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-skill-usage-low-summary181b.json), [Skill-Lernen](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-skill-learning-keyless-v3-summary181b.json), [Coding](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-coding12-v2.json), [Browser](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-browser20-summary181b.json), [Deutsch](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/flash-german-summary181b.json), [API-Blocker](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/readiness-final-summary181b.json), [Validierung](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/validation181b.json), [voller Web-Lint](/home/wilhelmpa/agent-work/codex-tasks/181-evidence/web-lint181b-final.log).
