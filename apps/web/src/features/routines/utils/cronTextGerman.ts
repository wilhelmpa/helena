// German schedules in words ("jeden Werktag um 9 Uhr", "alle 15 Minuten zwischen 9 und
// 17 Uhr", "montags und mittwochs um 8:30", "am 1. jeden Monats um Mitternacht"),
// rewritten into the English grammar parseCronText understands. Only a text that reads
// as German is rewritten; everything else is left as typed.

const GERMAN_MARKERS =
  /\b(jede[nrs]?|alle|täglich|taeglich|stündlich|stuendlich|wöchentlich|woechentlich|monatlich|jährlich|jaehrlich|vierteljährlich|quartalsweise|werktags?|werktage[n]?|wochenende[n]?|uhr|um|zwischen|montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonnabends?|sonntags?|mitternacht|mittags?|minuten|stunden?|monats?|morgen|heute|einmalig)\b/;

const WEEKDAYS: Array<[RegExp, string]> = [
  [/\bmontags?\b|\bmo\b/g, 'monday'],
  [/\bdienstags?\b|\bdi\b/g, 'tuesday'],
  [/\bmittwochs?\b|\bmi\b/g, 'wednesday'],
  [/\bdonnerstags?\b|\bdo\b/g, 'thursday'],
  [/\bfreitags?\b|\bfr\b/g, 'friday'],
  [/\b(?:samstags?|sonnabends?)\b|\bsa\b/g, 'saturday'],
  [/\bsonntags?\b|\bso\b/g, 'sunday'],
];

const MONTHS: Array<[RegExp, string]> = [
  [/\bjanuar\b|\bjänner\b/g, 'january'],
  [/\bfebruar\b/g, 'february'],
  [/\bmärz\b|\bmaerz\b/g, 'march'],
  [/\bapril\b/g, 'april'],
  [/\bmai\b/g, 'may'],
  [/\bjuni\b/g, 'june'],
  [/\bjuli\b/g, 'july'],
  [/\baugust\b/g, 'august'],
  [/\bseptember\b/g, 'september'],
  [/\boktober\b/g, 'october'],
  [/\bnovember\b/g, 'november'],
  [/\bdezember\b/g, 'december'],
];

export function looksGerman(text: string): boolean {
  return GERMAN_MARKERS.test(text.toLowerCase());
}

// "1." → "1st", "2." → "2nd" … the ordinals the English grammar reads as days of month.
function ordinal(day: string): string {
  const n = Number(day);
  const suffix =
    n % 10 === 1 && n !== 11
      ? 'st'
      : n % 10 === 2 && n !== 12
        ? 'nd'
        : n % 10 === 3 && n !== 13
          ? 'rd'
          : 'th';
  return `${n}${suffix}`;
}

export function germanToEnglish(input: string): string {
  let text = ` ${input.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const rules: Array<[RegExp, string | ((...groups: string[]) => string)]> = [
    // One-time dates stay recognisable as such, so the parser refuses them clearly.
    [/\bmorgen\b/g, ' tomorrow '],
    [/\bheute\b/g, ' today '],
    [/\beinmalig\b/g, ' once '],
    // Times: "9 Uhr", "9:30 Uhr", "9.30 Uhr", "halb 10" is out of scope.
    [/\b(\d{1,2})[.:](\d{2})\s*uhr\b/g, (_m, h, m) => ` ${h}:${m} `],
    [/\b(\d{1,2})\s*uhr\b/g, (_m, h) => ` ${h}:00 `],
    [/\b(\d{1,2})\.(\d{2})\b/g, (_m, h, m) => ` ${h}:${m} `],
    [/\bmitternacht\b/g, ' midnight '],
    [/\bmittags?\b/g, ' noon '],
    // "zwischen 9 und 17" before "und" becomes "and" everywhere.
    [/\bzwischen\b/g, ' between '],
    [/\bum\b/g, ' at '],
    [/\bab\b/g, ' at '],
    // Intervals.
    [/\balle\s+(\d+)\s+minuten\b/g, (_m, n) => ` every ${n} minutes `],
    [/\balle\s+(\d+)\s+stunden\b/g, (_m, n) => ` every ${n} hours `],
    [/\b(?:jede|alle)\s+minuten?\b|\bminütlich\b/g, ' every minute '],
    [/\b(?:jede|alle)\s+stunden?\b|\bstündlich\b|\bstuendlich\b/g, ' hourly '],
    [
      /\b(\d+)\s+minuten\s+nach\s+(?:der\s+)?(?:vollen\s+)?stunde\b/g,
      (_m, n) => ` at ${n} minutes past the hour `,
    ],
    // Periods.
    [
      /\b(?:jeden|an\s+jedem)\s+werktag\b|\bwerktags\b|\ban\s+werktagen\b|\bmontag\s+bis\s+freitag\b|\bmo\s*-\s*fr\b/g,
      ' every weekday ',
    ],
    [/\b(?:jedes|am)\s+wochenende\b|\ban\s+wochenenden\b|\bwochenends\b/g, ' every weekend '],
    [/\bjeden\s+tag\b|\btäglich\b|\btaeglich\b/g, ' daily '],
    [/\bjede\s+woche\b|\bwöchentlich\b|\bwoechentlich\b/g, ' weekly '],
    [/\bjeden\s+monats?\b|\bmonatlich\b|\bim\s+monat\b/g, ' monthly '],
    [/\bvierteljährlich\b|\bquartalsweise\b|\bjedes\s+quartal\b/g, ' quarterly '],
    [/\bjedes\s+jahr\b|\bjährlich\b|\bjaehrlich\b/g, ' yearly '],
    // Days of month: "am 1." / "am 1. und 15." / "vom 1. bis 5.".
    [/\b(\d{1,2})\.(?!\d)/g, (_m, d) => ` ${ordinal(d)} `],
    [/\bbis\b/g, ' to '],
    [/\bund\b/g, ' and '],
    [/\bjeden\b|\bjede\b|\bjedes\b/g, ' every '],
    [/\bam\b|\ban\b|\bim\b|\bvom\b/g, ' on '],
  ];
  for (const [pattern, replacement] of rules) {
    text = text.replace(pattern, replacement as never);
  }
  for (const [pattern, name] of [...WEEKDAYS, ...MONTHS]) text = text.replace(pattern, ` ${name} `);
  return text.replace(/\s+/g, ' ').trim();
}
