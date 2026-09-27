// A tiny site in memory for the loop's tests and the eval harness's dry run: pages with links,
// fields, a dropdown and a submit button, and a TaskPage over it. No browser.

import { repeatedLabels } from './policy-common.ts';
import { TaskActError, type TaskActInput, type TaskPage } from './loop.ts';
import type { PageElement, PageObservation } from './types.ts';

export interface FakeControl {
  role: string;
  label: string;
  href?: string;
  editable?: boolean;
  selectable?: boolean;
  options?: string[];
  submits?: boolean;
  enterSubmits?: boolean;
  credential?: boolean;
  checked?: boolean;
  // Where a click goes (a link, a submit), or what it toggles.
  to?: string;
}

export interface FakePage {
  title: string;
  text: string;
  controls: FakeControl[];
  // For a form page: the page a submit leads to once all its fields are filled, and otherwise.
  onSubmit?: { ok: string; missing: string };
}

export class FakeSite implements TaskPage {
  pages: Record<string, FakePage>;
  url: string;
  values = new Map<string, string>();
  checked = new Map<string, boolean>();
  actions: TaskActInput[] = [];
  dialog: string | null = null;
  // Makes the next fresh() fail once (the page changed under a decision).
  staleOnce = false;

  constructor(pages: Record<string, FakePage>, start: string) {
    this.pages = pages;
    this.url = start;
  }

  #page(): FakePage {
    const page = this.pages[this.url];
    if (!page) throw new Error(`no page ${this.url}`);
    return page;
  }

  #key(): string {
    return JSON.stringify([this.url, [...this.values], [...this.checked]]);
  }

  async observe(): Promise<PageObservation> {
    const page = this.#page();
    const elements: PageElement[] = page.controls.map((control, index) => {
      const key = `${this.url}#${index}`;
      const element: PageElement = {
        i: index + 1,
        frame: 0,
        id: index + 1,
        tag: control.editable
          ? 'input:text'
          : control.selectable
            ? 'select'
            : control.href
              ? 'a'
              : 'button',
        role: control.role,
        ...(control.editable || control.selectable
          ? { label: control.label }
          : { text: control.label }),
      };
      if (control.href) element.href = control.href;
      if (control.editable) element.editable = true;
      if (control.selectable) {
        element.selectable = true;
        element.options = control.options;
        element.optionIndices = control.options?.map((_, i) => i);
        element.value = this.values.get(key) ?? control.options?.[0];
        element.selectedIndex = control.options?.indexOf(element.value ?? '');
      } else if (control.editable) {
        element.value = this.values.get(key) ?? '';
      }
      if (control.submits) element.submits = true;
      if (control.enterSubmits) element.enterSubmits = true;
      if (control.credential) element.credential = true;
      if (control.checked !== undefined) element.checked = this.checked.get(key) ?? control.checked;
      return element;
    });
    return {
      url: `https://site.test${this.url}`,
      title: page.title,
      text: page.text,
      dialogs: [],
      metrics: {
        scrollY: 0,
        pageHeight: 800,
        viewportHeight: 800,
        textLength: page.text.length,
        elements: elements.length,
      },
      elements,
      omitted: 0,
      keys: [this.#key()],
      repeated: repeatedLabels(elements),
      jsDialog: this.dialog,
    };
  }

  async fresh(observation: PageObservation): Promise<boolean> {
    if (this.staleOnce) {
      this.staleOnce = false;
      return false;
    }
    return observation.keys[0] === this.#key();
  }

  async act(input: TaskActInput): Promise<void> {
    this.actions.push(input);
    const page = this.#page();
    if (
      input.operation === 'SCROLL_DOWN' ||
      input.operation === 'SCROLL_UP' ||
      input.operation === 'WAIT'
    )
      return;
    const element = input.element;
    if (!element) throw new TaskActError('failed', 'no element');
    const control = page.controls[element.i - 1];
    if (!control) throw new TaskActError('gone', 'gone');
    const key = `${this.url}#${element.i - 1}`;
    if (input.operation === 'TYPE_TEXT') {
      if (control.credential) throw new TaskActError('refused', 'credential field');
      this.values.set(key, input.text ?? '');
      return;
    }
    if (input.operation === 'SELECT') {
      this.values.set(key, input.option ?? '');
      return;
    }
    if (control.checked !== undefined) {
      this.checked.set(key, !(this.checked.get(key) ?? control.checked));
      return;
    }
    if (control.submits || input.operation === 'PRESS_ENTER') {
      const form = page.onSubmit;
      if (!form) return;
      const filled = page.controls.every(
        (c, index) => !c.editable || (this.values.get(`${this.url}#${index}`) ?? '') !== '',
      );
      this.url = filled ? form.ok : form.missing;
      this.values = new Map([...this.values].filter(([k]) => !k.startsWith(this.url)));
      return;
    }
    if (control.to) this.url = control.to;
    else if (control.href) this.url = control.href;
  }
}

// The site the loop tests and the eval's dry run use.
export function contactSite(): FakeSite {
  return new FakeSite(
    {
      '/': {
        title: 'Start',
        text: 'Willkommen bei Beispiel. Über uns. Kontakt.',
        controls: [
          { role: 'link', label: 'Über uns', href: '/about' },
          { role: 'link', label: 'Kontakt', href: '/kontakt' },
        ],
      },
      '/about': {
        title: 'Über uns',
        text: 'Wir sind ein Beispiel.',
        controls: [{ role: 'link', label: 'Start', href: '/' }],
      },
      '/kontakt': {
        title: 'Kontakt',
        text: 'Kontaktformular: Name, E-Mail, Thema, Nachricht.',
        controls: [
          { role: 'textbox', label: 'Name', editable: true, enterSubmits: true },
          { role: 'textbox', label: 'E-Mail', editable: true, enterSubmits: true },
          {
            role: 'combobox',
            label: 'Thema',
            selectable: true,
            options: ['Bitte wählen', 'Frage', 'Angebot'],
          },
          { role: 'button', label: 'Senden', submits: true },
        ],
        onSubmit: { ok: '/danke', missing: '/fehler' },
      },
      '/danke': {
        title: 'Danke',
        text: 'Danke! Ihre Nachricht wurde gesendet.',
        controls: [{ role: 'link', label: 'Start', href: '/' }],
      },
      '/fehler': {
        title: 'Fehler',
        text: 'Fehler: Bitte alle Felder ausfüllen.',
        controls: [{ role: 'link', label: 'Zurück', href: '/kontakt' }],
      },
    },
    '/',
  );
}
