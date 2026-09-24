<!-- Entwurf der öffentlichen README auf Deutsch (Paket G). Wird beim Veröffentlichen zu
     README.de.md im Wurzelverzeichnis. -->

<div align="center">

<img src="apps/web/public/brand/helena-logo.svg" alt="Helena" height="64" />

# Helena

**Die Leitstelle für KI-Agenten.**

Du planst die Arbeit auf einem echten Projekt-Board, gibst Aufgaben an Agenten wie an
Kollegen, siehst jeden Schritt live und behältst die Kontrolle. Angetrieben von Hermes;
arbeitet auch mit Claude Code und Codex.

[Schnellstart](#schnellstart) · [Architektur](ARCHITECTURE.md) · [Sicherheit](SECURITY.md) ·
[Mitmachen](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [English](README.md)

</div>

## Warum Helena

Die meisten Agenten-Werkzeuge stellen einen Chatbot neben die Arbeit. Helena setzt die
Agenten **aufs Board**.

- Ein Agent ist ein **Teammitglied**: Er hat eine Rolle, einen Platz im Organigramm und
  Rechte, und er nimmt Tickets.
- Er **delegiert**: Der Home-Agent gibt Arbeit an die Projekt-Koordinatoren, und die geben
  sie an Spezialisten weiter.
- Er **fragt nach**, wenn er feststeckt, und **lernt** aus dem, was er getan hat.
- Alles, was er tut, ist **nachvollziehbar**: jeder Lauf, jeder Werkzeugaufruf, jede
  Dateiänderung und alle Kosten.

Helena läuft auf deinem eigenen Server, mit deiner Datenbank und deinen Modell-Schlüsseln.
Es gibt keine Lizenzkosten pro Nutzer und keinen Lock-in.

## Funktionen

| | |
|---|---|
| **Crew** | Agenten im Organigramm: Home-Agent → Koordinatoren → Spezialisten. Tickets weist du ihnen zu wie Menschen, und die Delegation bleibt sichtbar. Als Start dient ein Pool von Agenten-Vorlagen mit recherchierten Skills. |
| **Gläserne Läufe** | Jeder Lauf ist eine Zeitleiste aus Gedanken, Werkzeugaufrufen, Browserbildern, Dateiänderungen, Modell und Kosten. Du siehst ihn live, später als Wiedergabe, und kannst „ab hier fortsetzen“. |
| **Autopilot-Regler** | Eine Stufe pro Projekt und Agent: *vorschlagen* · *handeln mit Freigabe* · *handeln und berichten* · *autonom im Budget*. Budgets in Tokens, Euro und Zeit. |
| **Übernehmen überall** | In Browser, Terminal und Chat übernimmst du und gibst zurück; der Agent macht weiter. |
| **Lernen mit Aufsicht** | Was ein Agent an Skills und Memory lernt, kommt als Vorschlag mit Diff. Angenommen gilt es für alle Kopien einer Vorlage. |
| **Wissen gehört dir** | Ein Obsidian-kompatibler Vault, mit Git versioniert und über Syncthing synchronisiert. |
| **Bring your runtime** | Hermes Agent macht die KI-Arbeit (Gedächtnis, Skills, Werkzeuge). Claude Code und Codex laufen mit denselben Anweisungen, Werkzeugen und Regeln. |
| **Keine Geheimnisse im Prompt** | Logins und Schlüssel landen nie im Prompt. Das Browser-Gateway füllt sie ein, TOTP läuft über Helena, und ein Zugänge-Center hält alle Verbindungen. |
| **Routinen in Klartext** | Aus „jeden Montag um 9“ wird ein Zeitplan. Den Rest erledigt ein Workflow-Builder mit Agenten-Schritten, Freigaben, Bedingungen, Wartezeiten und Aktionen. |
| **Ein echtes Projektwerkzeug** | Boards, Zyklen, eigene Felder, Dashboards, Dokumente. Helena geht auch ganz ohne Agenten. |

## Schnellstart

> **Stand:** Helena ist vor 1.0 im Battle-Test. Docker kommt als letzter Schritt vor dem
> Release.

```bash
mkdir helena && cd helena
curl -fsSLO https://raw.githubusercontent.com/<org>/helena/main/compose.yml
curl -fsSLO https://raw.githubusercontent.com/<org>/helena/main/helena-init
sh helena-init            # schreibt .env mit erzeugten Geheimnissen und fragt nach deiner URL
docker compose up -d      # Postgres, Helena, Hermes; die Migrationen laufen beim Start
docker compose logs helena | grep setup   # der einmalige Einrichtungslink
```

Öffne den Einrichtungslink, lege das Admin-Konto an und wähle **Demo laden**. Du bekommst
zwei Beispielprojekte mit einer kleinen Crew, Aufgaben, einer Routine und einem Workflow.
Ohne Modell-Schlüssel antworten die Demo-Agenten aus Aufzeichnungen. Mit einem Schlüssel
unter *Zugänge* arbeiten sie wirklich.

Ziel: ein laufendes Helena mit Demo-Crew in **unter 15 Minuten** auf einem leeren Rechner.

## Aufbau

Siehe [ARCHITECTURE.md](ARCHITECTURE.md). **Helena ist die einzige Wahrheit:** Was dort
eingestellt ist, gilt überall, und eine Abweichung wird erkannt und angezeigt. **Hermes macht
die KI-Arbeit:** Helena selbst ruft kein Modell auf.

## Sicherheit in Kürze

Sicher als Standard:
- Die Registrierung ist geschlossen; der erste Admin entsteht über einen einmaligen
  Einrichtungslink.
- Es gibt kein LAN-Autologin, und das Owner-Terminal öffnet nur mit TOTP.
- Folgenreiche Agenten-Aktionen (senden, veröffentlichen, bezahlen, löschen) warten auf deine
  Freigabe.
- Zugangsdaten liegen verschlüsselt und sind für kein Modell sichtbar.
- **Helena sendet keine Telemetrie.**

Schwachstellen bitte vertraulich melden, siehe [SECURITY.md](SECURITY.md).

## Lizenz

Helena steht unter der **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)),
`packages/runner` unter der Apache License 2.0.

Helena is a fork of It's a Plan (AGPL-3.0) von Andrii Poluosmak
([Upstream](https://github.com/croffasia/itsaplan)). Hermes Agent: © Nous Research,
MIT-Lizenz. Drittkomponenten: [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
