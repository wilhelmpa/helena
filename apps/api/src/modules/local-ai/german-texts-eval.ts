import {
  median,
  type LocalAiEvalCaseResult,
  type LocalAiEvalContext,
  type LocalAiEvalResult,
} from '@helena/sdk';
import { firstJson, withoutThinking } from './evals';

export const GERMAN_TEXT_CASES = [
  {
    id: 'support-1',
    kind: 'Support-Antwort',
    source:
      'Kundin: Bestellung #4182 kam beschädigt an. Foto ist angehängt. Ersatz ist lieferbar; Versand dauert 2 Werktage. Entschuldige dich, biete Ersatz oder Erstattung an und frage nach der Wahl.',
  },
  {
    id: 'support-2',
    kind: 'Support-Antwort',
    source:
      'Kunde: Ich habe am 20. September gekündigt, aber am 27. September wurden 29 € abgebucht. Die Kündigung gilt erst zum 30. September. Antworte sachlich, erkläre den Zeitraum und verspreche keine Erstattung ohne Prüfung.',
  },
  {
    id: 'support-3',
    kind: 'Support-Antwort',
    source:
      'Kundin: Paket #775 ist laut Sendungsverfolgung zugestellt, fehlt aber. Zusteller: DHL, Zustellung am 25.09. um 14:32. Bitte um Prüfung bei Nachbarn und kündige eine Nachforschung an.',
  },
  {
    id: 'support-4',
    kind: 'Support-Antwort',
    source:
      'Kunde: Login mit 2FA klappt nach Handywechsel nicht. Wiederherstellungscode liegt nicht vor. Bitte keine Sicherheitsprüfung umgehen; nenne den offiziellen Identitätsprüfungsweg.',
  },
  {
    id: 'briefing-1',
    kind: 'Tagesbriefing',
    source:
      'Heute: 09:00 Teamrunde, 11:30 Kundentermin mit Weber, 16:00 Freigabe Release 2.4. Offene Aufgabe: VERVE-17 bis 15:00. Wetter: Regen. Priorisiere den Termin und die Freigabe.',
  },
  {
    id: 'briefing-2',
    kind: 'Tagesbriefing',
    source:
      'Heute: Backup um 02:00 fehlgeschlagen, Speicher bei 98 %. Um 10:00 Wartungsfenster, um 14:00 Budgetgespräch. Kritisch: Backup vor dem Gespräch prüfen; keine erfolgreiche Wiederherstellung behaupten.',
  },
  {
    id: 'briefing-3',
    kind: 'Tagesbriefing',
    source:
      'Heute: drei neue Supporttickets (zwei hoch, eines niedrig), Versandstopp für Charge B-19, Lieferantenantwort bis 12:00 erwartet. Um 17:00 Tagesabschluss. Nenne Unsicherheit der Lieferantenantwort.',
  },
  {
    id: 'mail-1',
    kind: 'Mail-Zusammenfassung',
    source:
      'Von: Einkauf. Betreff: Monitore. Angebot über 12 Geräte zu je 289 € netto ist bis 30.09. gültig. Lieferzeit 8 Werktage. Eine Freigabe liegt noch nicht vor. Fasse die Mail für den Inhaber zusammen.',
  },
  {
    id: 'mail-2',
    kind: 'Mail-Zusammenfassung',
    source:
      'Von: Hosting. Betreff: Wartung. Geplante Unterbrechung am 02.10. von 01:00 bis 03:00 Uhr. Betroffen ist nur die Staging-Umgebung; Produktion bleibt online. Rückfragen bis 29.09. Fasse zusammen.',
  },
  {
    id: 'mail-3',
    kind: 'Mail-Zusammenfassung',
    source:
      'Von: Kundin Maier. Betreff: Rechnung #R-882. Sie bemängelt 19 % statt 7 % Umsatzsteuer und bittet bis Freitag um eine korrigierte Rechnung. Es ist noch ungeprüft, welcher Satz zutrifft. Fasse zusammen, ohne den Satz festzulegen.',
  },
] as const;

export async function evaluateGermanTexts(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  if (!context.judge) throw new Error('German text eval needs a configured judge model');
  const cases: LocalAiEvalCaseResult[] = [];
  let score = 0;
  let tokens = 0;
  let seconds = 0;
  for (const item of GERMAN_TEXT_CASES) {
    const answer = await context.chat({
      system:
        'Schreibe auf Deutsch. Behalte alle relevanten Fakten bei, erfinde nichts und formuliere klar und knapp.',
      prompt: `${item.kind}:\n${item.source}`,
      maxTokens: 1200,
    });
    const judged = await context.judge({
      system:
        'Bewerte den Text nur anhand der Aufgabe. Antworte ausschließlich als JSON {"score": Zahl von 0 bis 100, "reason": kurze Begründung}. Bewerte Faktenkorrektheit (50 Punkte), Vollständigkeit (25), hilfreiches Deutsch (25). Erfundene Zusagen, falsche Daten oder fehlende Sicherheitsprüfung führen zu höchstens 40 Punkten.',
      prompt: `Aufgabe: ${item.kind}\nQuelle: ${item.source}\nAntwort: ${withoutThinking(answer.text)}`,
      json: true,
      maxTokens: 350,
    });
    const verdict = firstJson(withoutThinking(judged.text));
    const points = verdict?.score;
    if (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > 100)
      throw new Error(`Judge returned an invalid score for ${item.id}`);
    score += points;
    tokens += (answer.outputTokens ?? 0) + (judged.outputTokens ?? 0);
    seconds += (answer.latencyMs + judged.latencyMs) / 1000;
    cases.push({
      id: item.id,
      passed: points >= 70,
      detail: `${points}/100: ${String(verdict?.reason ?? '').slice(0, 140)}`,
      latencyMs: answer.latencyMs + judged.latencyMs,
    });
  }
  return {
    score: score / (100 * GERMAN_TEXT_CASES.length),
    cases,
    latencyMsP50: median(cases.map((item) => item.latencyMs ?? NaN)),
    tokensPerSecond: seconds > 0 && tokens > 0 ? tokens / seconds : null,
  };
}
