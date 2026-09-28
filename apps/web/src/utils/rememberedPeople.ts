export type RememberedPerson = { name: string; email: string };
const KEY = 'helena.remembered-people';
const EVENT = 'helena.people-changed';

export function parsePeople(raw: string): RememberedPerson[] {
  try {
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values
      .filter(
        (value): value is RememberedPerson =>
          value &&
          typeof value.name === 'string' &&
          value.name.length <= 120 &&
          typeof value.email === 'string' &&
          value.email.length <= 254 &&
          value.email.includes('@'),
      )
      .slice(0, 4)
      .map(({ name, email }) => ({ name, email }));
  } catch {
    return [];
  }
}

export function readPeople(): string {
  try {
    return window.localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}
export const serverPeople = () => '[]';
export function subscribePeople(changed: () => void) {
  window.addEventListener('storage', changed);
  window.addEventListener(EVENT, changed);
  return () => {
    window.removeEventListener('storage', changed);
    window.removeEventListener(EVENT, changed);
  };
}
function storePeople(people: RememberedPerson[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(people));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* Storage may be disabled. */
  }
}
export function forgetPeople() {
  storePeople([]);
}
// Names only assist selection. A selected or edited value never establishes a session.
export function rememberPerson(person: RememberedPerson) {
  const next = parsePeople(JSON.stringify([person]))[0];
  if (!next) return;
  const people = [next, ...parsePeople(readPeople()).filter((p) => p.email !== next.email)].slice(
    0,
    4,
  );
  if (JSON.stringify(people) !== readPeople()) storePeople(people);
}
