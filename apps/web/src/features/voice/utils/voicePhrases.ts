export const BRIDGES = {
  de: ['Ich schau kurz nach.', 'Einen Augenblick, ich prüfe das.', 'Gute Frage, ich sehe nach.'],
  en: ["I'll check that for you.", 'Let me take a look.', 'Good question, I will check.'],
  ar: ['سأتحقق من ذلك.', 'لحظة، سأراجع ذلك.', 'سؤال جيد، سأبحث عن الإجابة.'],
  es: ['Voy a comprobarlo.', 'Un momento, lo reviso.', 'Buena pregunta, voy a mirarlo.'],
  fr: ['Je vais vérifier.', 'Un instant, je regarde.', 'Bonne question, je vais regarder.'],
  it: ['Controllo subito.', 'Un momento, verifico.', 'Bella domanda, controllo.'],
  ja: ['少し確認します。', '少々お待ちください。確認します。', 'いい質問ですね。調べてみます。'],
  pt: ['Vou verificar.', 'Um momento, vou conferir.', 'Boa pergunta, vou dar uma olhada.'],
  ru: ['Сейчас проверю.', 'Одну минуту, я проверю.', 'Хороший вопрос, сейчас посмотрю.'],
  zh: ['我查一下。', '稍等，我确认一下。', '问得好，我查查看。'],
} as const;

type SpokenLanguage = keyof typeof BRIDGES;

export const TOOL_UPDATES: ({ matches: RegExp } & Record<SpokenLanguage, string>)[] = [
  {
    matches: /mail|email|inbox|outlook|gmail/i,
    de: 'Ich lese deine Mails.',
    en: "I'm checking your emails.",
    ar: 'أراجع رسائلك الإلكترونية.',
    es: 'Estoy revisando tus correos.',
    fr: 'Je consulte tes e-mails.',
    it: 'Sto controllando le tue email.',
    ja: 'メールを確認しています。',
    pt: 'Estou verificando seus e-mails.',
    ru: 'Я проверяю твою почту.',
    zh: '我正在查看你的邮件。',
  },
  {
    matches: /browser|web|search|fetch|url|page/i,
    de: 'Ich öffne den Browser.',
    en: "I'm opening the browser.",
    ar: 'أفتح المتصفح.',
    es: 'Estoy abriendo el navegador.',
    fr: "J'ouvre le navigateur.",
    it: 'Sto aprendo il browser.',
    ja: 'ブラウザーを開いています。',
    pt: 'Estou abrindo o navegador.',
    ru: 'Я открываю браузер.',
    zh: '我正在打开浏览器。',
  },
  {
    matches: /task|todo|issue|linear|ticket/i,
    de: 'Ich lege die Aufgabe an.',
    en: "I'm creating the task.",
    ar: 'أنشئ المهمة.',
    es: 'Estoy creando la tarea.',
    fr: 'Je crée la tâche.',
    it: 'Sto creando l’attività.',
    ja: 'タスクを作成しています。',
    pt: 'Estou criando a tarefa.',
    ru: 'Я создаю задачу.',
    zh: '我正在创建任务。',
  },
  {
    matches: /calendar|event|schedule/i,
    de: 'Ich prüfe deinen Kalender.',
    en: "I'm checking your calendar.",
    ar: 'أراجع تقويمك.',
    es: 'Estoy revisando tu calendario.',
    fr: 'Je consulte ton agenda.',
    it: 'Sto controllando il tuo calendario.',
    ja: 'カレンダーを確認しています。',
    pt: 'Estou verificando seu calendário.',
    ru: 'Я проверяю твой календарь.',
    zh: '我正在查看你的日历。',
  },
  {
    matches: /file|document|drive|dropbox|box|sharepoint/i,
    de: 'Ich lese das Dokument.',
    en: "I'm reading the document.",
    ar: 'أقرأ المستند.',
    es: 'Estoy leyendo el documento.',
    fr: 'Je lis le document.',
    it: 'Sto leggendo il documento.',
    ja: '文書を読んでいます。',
    pt: 'Estou lendo o documento.',
    ru: 'Я читаю документ.',
    zh: '我正在阅读文档。',
  },
  {
    matches: /terminal|shell|exec|code/i,
    de: 'Ich prüfe das gerade.',
    en: "I'm checking that now.",
    ar: 'أتحقق من ذلك الآن.',
    es: 'Lo estoy comprobando ahora.',
    fr: 'Je vérifie cela en ce moment.',
    it: 'Lo sto verificando.',
    ja: 'ただいま確認しています。',
    pt: 'Estou verificando isso agora.',
    ru: 'Я сейчас это проверяю.',
    zh: '我正在确认这件事。',
  },
  {
    matches: /.*/,
    de: 'Ich arbeite noch daran.',
    en: "I'm still working on it.",
    ar: 'ما زلت أعمل على ذلك.',
    es: 'Sigo trabajando en ello.',
    fr: 'Je travaille encore dessus.',
    it: 'Ci sto ancora lavorando.',
    ja: '引き続き作業しています。',
    pt: 'Ainda estou trabalhando nisso.',
    ru: 'Я ещё работаю над этим.',
    zh: '我还在处理。',
  },
];

export function spokenLanguage(language: string): SpokenLanguage {
  const code = language.slice(0, 2).toLowerCase();
  return Object.hasOwn(BRIDGES, code) ? (code as SpokenLanguage) : 'en';
}

export function toolUpdate(tool: string, language: string): string {
  const phrase = TOOL_UPDATES.find((row) => row.matches.test(tool))!;
  return phrase[spokenLanguage(language)];
}

export function preloadedPhrases(language: string): string[] {
  const lang = spokenLanguage(language);
  return [...BRIDGES[lang], ...new Set(TOOL_UPDATES.map((row) => row[lang]))];
}
