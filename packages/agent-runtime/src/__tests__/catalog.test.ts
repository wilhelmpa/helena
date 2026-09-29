import { expect, test } from 'bun:test';
import { searchCatalog } from '../tools/builtin';

const catalog = [
  { name: 'create_issue', description: 'Create a project issue' },
  { name: 'google_tasks_create', description: 'Create a Google task' },
  { name: 'google_calendar_create_event', description: 'Create a calendar event' },
  { name: 'draft_reply', description: 'Save a draft mail reply' },
  { name: 'request_mail_send', description: 'Send a mail reply' },
  { name: 'search_knowledge', description: 'Search project knowledge' },
  { name: 'list_decisions', description: 'List logged decisions' },
  { name: 'list_invites', description: 'List invitations and their decision status' },
];

test('finds project and calendar tools from German requests', () => {
  expect(searchCatalog(catalog, 'Erstelle eine Aufgabe')[0]?.name).toBe('create_issue');
  expect(searchCatalog(catalog, 'Kalendereintrag anlegen')[0]?.name).toBe(
    'google_calendar_create_event',
  );
  expect(searchCatalog(catalog, 'Suche im Wissen')[0]?.name).toBe('search_knowledge');
  expect(searchCatalog(catalog, 'Welche Entscheidung wurde dokumentiert?')[0]?.name).toBe(
    'list_decisions',
  );
});

test('distinguishes a mail draft from sending mail', () => {
  expect(searchCatalog(catalog, 'Mail Entwurf erstellen')[0]?.name).toBe('draft_reply');
});

test('prefers an explicitly named tool over similar names with longer descriptions', () => {
  const entries = [
    {
      name: 'create_issue_template',
      description: 'Create an issue template with title and description',
    },
    { name: 'create_issue', description: 'Create an issue' },
  ];
  expect(searchCatalog(entries, 'create_issue title description')[0]?.name).toBe('create_issue');
});

test('finds an external lookup tool from a German catalog request', () => {
  const entries = [
    { name: 'fixture__lookup', description: 'Look up an item by id in the local fixture catalog' },
    { name: 'search_knowledge', description: 'Search project knowledge' },
  ];
  expect(searchCatalog(entries, 'Suche im lokalen Testkatalog den Datensatz B18')[0]?.name).toBe(
    'fixture__lookup',
  );
});

test('matches external tool names that contain regular-expression punctuation', () => {
  const entries = [{ name: 'catalog.lookup[1]', description: 'Look up a catalog item' }];
  expect(searchCatalog(entries, 'catalog.lookup[1] B18')[0]?.name).toBe('catalog.lookup[1]');
});
