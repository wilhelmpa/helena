// What browser_task sees of a page (docs/helena-decisions/browser-task.md §3.1): the controls a
// person could use, with their labels and state, the text in view, open dialogs and a few numbers
// code can compute better than a model. Fixed functions, evaluated by session.ts in
// patchright's isolated world of every frame — never the page's own world, never written into the
// DOM: element identities live in that world's globalThis (`__helenaTask`), which the page cannot
// see and which a navigation clears (verified 2026-09-24).
//
// Ported from jev-browser src/page-script.mjs (MIT, © Ying-Kai Liao) — the element listing,
// labels, `near` text, covered/overlay detection, sort markers — and jev-ultrafast
// jev_ultrafast/snapshot.js (MIT, © Browser Use) — code-owned node identities, the page key and
// per-element guards for freshness. See packages/browser-gateway/NOTICE.
//
// What differs from both: a password, one-time-code or 2FA field is listed as a credential and its
// value is never read (browser_login fills it); file inputs are listed but not offered (uploads go
// through browser_file_upload); nothing is tagged in the DOM.
//
// Each function must stay self-contained: patchright sends its source into the page.

export interface ObserveArgs {
  // Characters of text in view to return (main frame only).
  textLimit: number;
  // Controls listed per frame at most; the rest are counted in `omitted`.
  maxElements: number;
  // Whether this is the main frame (text, dialogs and metrics come from it only).
  main: boolean;
}

export interface RawElement {
  // The code-owned identity of the node in this frame's isolated world.
  id: number;
  tag: string;
  role: string;
  label?: string;
  text?: string;
  placeholder?: string;
  name?: string;
  value?: string;
  // The displayed value is complete and unchanged by snapshot normalization/redaction.
  valueExact?: boolean;
  options?: string[];
  optionIndices?: number[];
  selectedIndex?: number;
  checked?: boolean;
  expanded?: boolean;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  covered?: boolean;
  offscreen?: boolean;
  near?: string;
  href?: string;
  sorted?: string;
  rowState?: string;
  // Can take typed text / is a <select> / a password or code field / a file input.
  editable?: boolean;
  selectable?: boolean;
  credential?: boolean;
  file?: boolean;
  // A click on it submits a form; Enter in it submits one.
  submits?: boolean;
  enterSubmits?: boolean;
}

export interface RawFrameObservation {
  url: string;
  title: string;
  text: string;
  dialogs: string[];
  metrics: { scrollY: number; pageHeight: number; viewportHeight: number; textLength: number };
  elements: RawElement[];
  omitted: number;
  // The page key: document, address, scroll position, viewport and the state of every
  // non-credential form field. A decision made on one key is thrown away when it changed.
  key: string;
  marker: string;
  guards: Record<number, string | null>;
}

export const OBSERVE = (args: ObserveArgs): RawFrameObservation | null => {
  if (!document.documentElement) return null;
  type Cache = {
    ids: WeakMap<Element, number>;
    nodes: Map<number, Element>;
    next: number;
    guard?: (e: Element | undefined) => string | null;
    pageKey?: () => string;
  };
  const holder = globalThis as unknown as { __helenaTask?: Cache };
  const cache: Cache = (holder.__helenaTask ||= { ids: new WeakMap(), nodes: new Map(), next: 1 });
  for (const [id, node] of cache.nodes) if (!node.isConnected) cache.nodes.delete(id);
  const identity = (node: Element): number => {
    let id = cache.ids.get(node);
    if (!id) {
      id = cache.next++;
      cache.ids.set(node, id);
    }
    cache.nodes.set(id, node);
    return id;
  };
  const clean = (value: unknown, n = 80) =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, n);
  const SEL =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], ' +
    '[role=link], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], ' +
    '[role=checkbox], [role=radio], [role=switch], [role=option], [role=combobox], ' +
    '[role=textbox], [role=searchbox], [role=spinbutton], [role=slider], [role=gridcell], ' +
    '[contenteditable=""], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])';
  const all: Element[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      all.push(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  const heavy = all.length > 6000;

  const style = (el: Element) => getComputedStyle(el);
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = style(el);
    const type = (el as HTMLInputElement).type;
    if (
      typeof el.checkVisibility === 'function' &&
      !el.checkVisibility({
        checkOpacity: !/^(checkbox|radio|file)$/.test(type ?? ''),
        checkVisibilityCSS: true,
      })
    )
      return false;
    return (
      st.visibility !== 'hidden' &&
      st.display !== 'none' &&
      (Number(st.opacity) > 0.05 || /^(checkbox|radio|file)$/.test(type ?? ''))
    );
  };
  const byIds = (ids: string | null) =>
    clean(
      (ids || '')
        .split(/\s+/)
        .map((id) => (document.getElementById(id) as HTMLElement | null)?.innerText)
        .filter(Boolean)
        .join(' '),
    );
  const labelsOf = (el: Element) => [...((el as HTMLInputElement).labels ?? [])] as HTMLElement[];
  // A label's own words: a control nested in it (a <select> inside its <label>) is left out, on a
  // detached copy — the page itself is never changed.
  const ownText = (label: HTMLElement) => {
    if (!label.querySelector('select, textarea, input, button')) return label.innerText;
    const copy = label.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('select, textarea, input, button').forEach((node) => node.remove());
    return copy.textContent ?? '';
  };
  const labelOf = (el: Element) =>
    clean(
      byIds(el.getAttribute('aria-labelledby')) ||
        labelsOf(el).map(ownText).join(' ') ||
        el.getAttribute('aria-label') ||
        '',
    );
  const sibText = (el: Element) => {
    let text = '';
    for (let n = el.nextSibling; n && text.trim().length < 40; n = n.nextSibling) {
      if (
        n.nodeType === 1 &&
        (n as Element).matches('input, select, textarea, button, br, label, div, p, li')
      )
        break;
      text += n.textContent ?? '';
    }
    return clean(text, 60);
  };
  const credentialField = (el: Element) => {
    if (el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
    return (
      type === 'password' ||
      auto.includes('password') ||
      auto === 'one-time-code' ||
      /\b(otp|totp|2fa|mfa|passcode)\b/.test(name.replace(/[-_]/g, ' '))
    );
  };
  const ROLE_OF_TAG: Record<string, string> = {
    a: 'link',
    button: 'button',
    summary: 'button',
    select: 'combobox',
    textarea: 'textbox',
  };
  const roleOf = (el: Element, type: string | null) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (ROLE_OF_TAG[tag]) return ROLE_OF_TAG[tag];
    if ((el as HTMLElement).isContentEditable) return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox' || type === 'radio') return type;
      if (['button', 'submit', 'reset', 'image'].includes(type ?? '')) return 'button';
      if (type === 'search') return 'searchbox';
      if (type === 'number') return 'spinbutton';
      if (type === 'range') return 'slider';
      if (type === 'file') return 'file';
      return 'textbox';
    }
    return tag === 'img' ? 'img' : 'generic';
  };
  const TEXT_TYPES = new Set([
    'text',
    'email',
    'search',
    'tel',
    'url',
    'number',
    'date',
    'datetime-local',
    'month',
    'week',
    'time',
    'password',
  ]);

  const out: RawElement[] = [];
  let omitted = 0;
  const seen = new Set<Element>();
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    let pick = el.matches(SEL);
    if (
      !pick &&
      !heavy &&
      !['html', 'body', 'label', 'svg', 'path', 'script', 'style'].includes(tag) &&
      el.parentElement
    ) {
      // Controls bound in script (a div with a click handler) usually show a pointer cursor.
      // The "not inside a real link or button" check starts at the parent: an <a> without href
      // or a role-less custom button is exactly what this fallback exists to catch.
      pick =
        style(el).cursor === 'pointer' &&
        style(el.parentElement).cursor !== 'pointer' &&
        !el.parentElement.closest('a, button, [role=button]');
    }
    if (
      !pick &&
      ((tag === 'th' && el.closest('thead')) || (tag === 'img' && !el.closest('a, button')))
    ) {
      const r = el.getBoundingClientRect();
      pick = tag === 'th' || (r.width >= 24 && r.height >= 24);
    }
    if (!pick || el.closest('[aria-hidden="true"], [inert]')) continue;
    const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : null;
    let hit: Element = el;
    let hiddenFile = false;
    if (!visible(el)) {
      // A styled checkbox or radio hides the real input behind a visible label; a file input
      // often hides behind a styled button but still takes files.
      const label =
        (type === 'checkbox' || type === 'radio') && labelsOf(el).find((l) => visible(l));
      if (label) hit = label;
      else if (type === 'file') hiddenFile = true;
      else continue;
    }
    if (hit === el && (type === 'checkbox' || type === 'radio')) {
      // The real input often cannot take the click itself (opacity 0 under its label, or the
      // clip-rect "visually hidden" recipe): then the label is the control.
      const st = style(el);
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top =
        cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight
          ? document.elementFromPoint(cx, cy)
          : null;
      const unclickable =
        Number(st.opacity) <= 0.05 ||
        r.width <= 2 ||
        r.height <= 2 ||
        st.clip !== 'auto' ||
        st.clipPath !== 'none' ||
        (top !== null && top !== el && labelsOf(el).some((l) => l === top || l.contains(top)));
      if (unclickable) {
        const label = labelsOf(el).find((l) => visible(l));
        if (label) hit = label;
      }
    }
    if (seen.has(hit)) continue;
    seen.add(hit);
    if (out.length >= args.maxElements) {
      omitted++;
      continue;
    }

    const role = roleOf(el, type);
    const o: RawElement = { id: identity(hit), tag: type ? `input:${type}` : tag, role };
    if (hit !== el) identity(el);
    const credential = credentialField(el);
    const isField =
      ['input', 'select', 'textarea'].includes(tag) ||
      ['textbox', 'searchbox', 'combobox'].includes(el.getAttribute('role') ?? '') ||
      (el as HTMLElement).isContentEditable;
    const readOnly =
      (el as HTMLInputElement).readOnly || el.getAttribute('aria-readonly') === 'true';
    if (isField) {
      const label = labelOf(el);
      if (label) o.label = label;
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) o.placeholder = clean(placeholder, 60);
      const nameAttr = el.getAttribute('name');
      if (!label && !placeholder && nameAttr) o.name = clean(nameAttr, 40);
      if (credential) {
        // Never read what a password or code field holds.
        o.credential = true;
      } else if (tag === 'select') {
        const select = el as HTMLSelectElement;
        o.value = clean(select.selectedOptions?.[0]?.text, 40);
        o.valueExact = o.value === select.selectedOptions?.[0]?.text;
        const options = [...select.options]
          .filter((option) => !option.disabled && !option.closest('optgroup[disabled]'))
          .slice(0, 25);
        o.options = options.map((option) => clean(option.text, 80));
        o.optionIndices = options.map((option) => option.index);
        o.selectedIndex = select.selectedIndex;
        o.selectable = !select.disabled;
      } else if (type === 'checkbox' || type === 'radio') {
        o.checked = (el as HTMLInputElement).checked;
        if (!o.label && hit !== el) o.label = clean((hit as HTMLElement).innerText);
        if (!o.label) {
          const text = sibText(el);
          if (text) o.label = text;
        }
        const value = (el as HTMLInputElement).value;
        if (value && value !== 'on') {
          o.value = clean(value, 30);
          o.valueExact = o.value === value;
        }
      } else if (type === 'file') {
        o.file = true;
      } else if (['submit', 'button', 'reset', 'image'].includes(type ?? '')) {
        o.text = clean((el as HTMLInputElement).value || label);
      } else {
        const value =
          (el as HTMLElement).isContentEditable && tag !== 'input'
            ? (el as HTMLElement).innerText
            : (el as HTMLInputElement).value;
        if (typeof value === 'string') {
          o.value = clean(value, 60);
          o.valueExact = o.value === value;
        }
        const textual =
          tag === 'textarea' ||
          (el as HTMLElement).isContentEditable ||
          (tag === 'input' && TEXT_TYPES.has(type ?? 'text')) ||
          ['textbox', 'searchbox', 'combobox'].includes(el.getAttribute('role') ?? '');
        if (textual && !readOnly) o.editable = true;
      }
      const form = (el as HTMLInputElement).form ?? el.closest('form');
      if (form && tag === 'input' && !['checkbox', 'radio', 'file'].includes(type ?? ''))
        o.enterSubmits = true;
    } else {
      const img = el.querySelector('img[alt], svg title');
      const text =
        (tag === 'img' ? clean(el.getAttribute('alt')) : clean((el as HTMLElement).innerText)) ||
        labelOf(el) ||
        clean(el.getAttribute('title')) ||
        clean(img?.getAttribute('alt') || img?.textContent);
      if (text) o.text = text;
      const label = labelOf(el);
      if (label && label !== text) o.label = label;
    }
    if (
      (tag === 'button' &&
        ['', 'submit'].includes((el.getAttribute('type') || '').toLowerCase())) ||
      (tag === 'input' && (type === 'submit' || type === 'image'))
    ) {
      if ((el as HTMLButtonElement).form ?? el.closest('form')) o.submits = true;
    }
    const href = el.getAttribute('href');
    if (href && !href.startsWith('javascript')) {
      try {
        const u = new URL(href, location.href);
        o.href = clean(
          u.origin === location.origin ? u.pathname + u.search : u.origin + u.pathname,
          80,
        );
      } catch {
        o.href = clean(href, 80);
      }
    }
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')
      o.disabled = true;
    if (el.getAttribute('aria-busy') === 'true') o.busy = true;
    const className = String(
      (el.className as unknown as { baseVal?: string })?.baseVal ?? el.className ?? '',
    );
    const sort =
      el.getAttribute('aria-sort') || className.match(/sort\w*?(asc|desc|up|down)/i)?.[1];
    if (sort && sort !== 'none')
      o.sorted = /asc|up/i.test(sort) ? 'ascending' : /desc|down/i.test(sort) ? 'descending' : sort;
    if (el.hasAttribute('aria-expanded')) o.expanded = el.getAttribute('aria-expanded') === 'true';
    if (el.getAttribute('aria-checked')) o.checked = el.getAttribute('aria-checked') === 'true';
    if (
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-current') ||
      el.getAttribute('aria-pressed') === 'true' ||
      /\b(selected|active)\b/.test(className)
    )
      o.active = true;

    const own = o.text || o.label || o.placeholder || '';
    if (own.length < 16 || isField) {
      let parent = hit.parentElement;
      for (let k = 0; parent && k < 5; k++, parent = parent.parentElement) {
        const text = clean(parent.innerText, 400);
        if (text && text !== own) {
          if (text.length <= 100) o.near = text;
          break;
        }
      }
      const row = hit.closest('li, tr, [role=row], [role=listitem]');
      const m =
        row &&
        String((row.className as unknown as { baseVal?: string })?.baseVal ?? row.className).match(
          /\b(completed|done|selected|active|checked|disabled|error|expanded)\b/i,
        );
      if (m) o.rowState = m[1];
    }
    const rr = hit.getBoundingClientRect();
    const cx = rr.left + rr.width / 2;
    const cy = rr.top + rr.height / 2;
    const inView = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight;
    if (!inView && !hiddenFile) o.offscreen = true;
    if (!hiddenFile && inView) {
      const root = hit.getRootNode() as Document | ShadowRoot;
      const top = ('elementFromPoint' in root ? root : document).elementFromPoint(cx, cy);
      if (
        top &&
        top !== hit &&
        !hit.contains(top) &&
        !top.contains(hit) &&
        !(top.tagName === 'LABEL' && (top as HTMLLabelElement).control === el)
      )
        o.covered = true;
    }
    out.push(o);
  }

  let text = '';
  const dialogs: string[] = [];
  let textLength = 0;
  if (args.main) {
    for (const dialog of document.querySelectorAll(
      'dialog[open], [role=dialog], [role=alertdialog], [aria-modal="true"]',
    )) {
      if (!visible(dialog)) continue;
      const t = clean((dialog as HTMLElement).innerText, 400);
      if (t) dialogs.push(t);
    }
    // Overlays that are not marked up as dialogs: a fixed layer covering most of the viewport.
    for (
      let n = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      n && n !== document.body && n !== document.documentElement;
      n = n.parentElement
    ) {
      const st = style(n);
      const r = n.getBoundingClientRect();
      if (
        (st.position === 'fixed' || st.position === 'sticky') &&
        r.width * r.height >= 0.6 * innerWidth * innerHeight
      ) {
        const t = clean((n as HTMLElement).innerText, 400);
        if (t && !dialogs.includes(t)) dialogs.push(t);
        break;
      }
    }
    // The text a person sees right now, in document order. A text node inside a password or
    // code field cannot exist; a field's value is not text, so it is never read here.
    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n && text.length < args.textLimit; n = walker.nextNode()) {
        const value = n.textContent?.trim();
        const parent = n.parentElement;
        if (
          !value ||
          !parent ||
          parent.closest('script, style, noscript, template, [aria-hidden="true"], [inert]') ||
          !visible(parent)
        )
          continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (
          r.bottom < 0 ||
          r.top > innerHeight ||
          r.width === 0 ||
          r.right < 0 ||
          r.left > innerWidth
        )
          continue;
        text += ` ${value}`;
      }
      text = clean(text, args.textLimit);
      textLength = document.body.textContent?.length ?? 0;
    }
  }

  const safe = (e: Element) =>
    !['password', 'file', 'hidden'].includes((e as HTMLInputElement).type) && !credentialField(e);
  const pageKey = () => {
    const fields: Element[] = [];
    const collect = (root: Document | ShadowRoot) => {
      for (const e of root.querySelectorAll('*')) {
        if (e.matches('input, textarea, select') && safe(e)) fields.push(e);
        if (e.shadowRoot) collect(e.shadowRoot);
      }
    };
    collect(document);
    return JSON.stringify([
      performance.timeOrigin,
      location.href,
      Math.round(scrollX),
      Math.round(scrollY),
      innerWidth,
      innerHeight,
      fields.map((e) => {
        const f = e as HTMLInputElement & HTMLSelectElement;
        return [identity(e), f.value, f.checked, f.selectedIndex, f.disabled, f.readOnly];
      }),
    ]);
  };
  const guard = (e: Element | undefined): string | null => {
    if (!e?.isConnected || !visible(e) || e.closest('[aria-hidden="true"], [inert]')) return null;
    const f = e as HTMLInputElement & HTMLSelectElement;
    const scope =
      e.closest('form, dialog, [role="dialog"], article, li, tr, [role="row"]') || e.parentElement;
    return JSON.stringify([
      identity(e),
      e.tagName,
      e.getAttribute('type'),
      e.getAttribute('name'),
      e.getAttribute('autocomplete'),
      e.getAttribute('contenteditable'),
      e.getAttribute('formaction'),
      e.getAttribute('formmethod'),
      e.getAttribute('formtarget'),
      f.form ? [f.form.action, f.form.method, f.form.enctype, f.form.target] : null,
      e.getAttribute('role'),
      labelOf(e),
      e.getAttribute('title'),
      e.getAttribute('placeholder'),
      (e as HTMLElement).innerText?.slice(0, 200) ?? '',
      credentialField(e) ? null : (f.value ?? null),
      f.checked ?? null,
      f.selectedIndex ?? null,
      f.readOnly ?? null,
      e.getAttribute('aria-readonly'),
      e.matches(':disabled'),
      e.closest('[aria-disabled="true"]') !== null,
      e.getAttribute('aria-expanded'),
      e.getAttribute('aria-checked'),
      e.getAttribute('aria-selected'),
      e.getAttribute('href'),
      e.tagName === 'SELECT'
        ? [...f.options].map((o) => [
            o.index,
            o.text,
            o.value,
            o.disabled,
            !!o.closest('optgroup[disabled]'),
          ])
        : null,
      (scope as HTMLElement | null)?.innerText?.slice(0, 6000) ?? '',
    ]);
  };
  cache.guard = guard;
  cache.pageKey = pageKey;
  const key = pageKey();
  const guards = Object.fromEntries(out.map((e) => [e.id, guard(cache.nodes.get(e.id))]));
  const marker = JSON.stringify([
    key,
    document.title,
    text,
    dialogs,
    out,
    document.documentElement.scrollHeight,
  ]);
  return {
    url: location.href,
    title: document.title,
    text,
    dialogs,
    metrics: {
      scrollY: Math.round(scrollY),
      pageHeight: document.documentElement.scrollHeight,
      viewportHeight: innerHeight,
      textLength,
    },
    elements: out,
    omitted,
    key,
    marker,
    guards,
  };
};

// The state one element is judged by right before input (jev-ultrafast's guard): identity, role,
// name, value, checked/selected state, disabled, the aria states, the link, and the text of its
// form, dialog or row. Null once it is gone or hidden. A credential field's value is left out.
export const GUARD = (id: number): string | null => {
  const cache = (
    globalThis as unknown as {
      __helenaTask?: {
        nodes: Map<number, Element>;
        guard?: (e: Element | undefined) => string | null;
      };
    }
  ).__helenaTask;
  return cache?.guard?.(cache.nodes.get(id)) ?? null;
};

export const CHECK_TARGET = (id: number): { key: string; guard: string | null } | null => {
  const cache = (
    globalThis as unknown as {
      __helenaTask?: {
        nodes: Map<number, Element>;
        guard?: (e: Element | undefined) => string | null;
        pageKey?: () => string;
      };
    }
  ).__helenaTask;
  return cache?.pageKey && cache.guard
    ? { key: cache.pageKey(), guard: cache.guard(cache.nodes.get(id)) }
    : null;
};

// Right before input: the element is still there, enabled and visible, and (after it was scrolled
// into view) the element hit at its centre is it or inside it. `why` names what is wrong.
export const HIT = (
  target: number | { id: number; key: string; guard: string },
): { ok: true } | { ok: false; why: string } => {
  const holder = globalThis as unknown as {
    __helenaTask?: {
      nodes: Map<number, Element>;
      pageKey?: () => string;
      guard?: (e: Element) => string | null;
    };
  };
  const cache = holder.__helenaTask;
  const e = cache?.nodes.get(typeof target === 'number' ? target : target.id);
  if (!e?.isConnected) return { ok: false, why: 'gone' };
  if (
    typeof target !== 'number' &&
    (cache?.pageKey?.() !== target.key || cache?.guard?.(e) !== target.guard)
  )
    return { ok: false, why: 'stale' };
  if (e.matches(':disabled') || e.closest('[aria-disabled="true"], [inert]'))
    return { ok: false, why: 'disabled' };
  const style = getComputedStyle(e);
  if (
    style.visibility !== 'visible' ||
    style.display === 'none' ||
    (Number(style.opacity) === 0 && !e.matches('input[type=checkbox], input[type=radio]')) ||
    e.closest('[aria-hidden="true"]')
  )
    return { ok: false, why: 'hidden' };
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { ok: false, why: 'hidden' };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { ok: false, why: 'offscreen' };
  const root = e.getRootNode() as Document | ShadowRoot;
  const top = ('elementFromPoint' in root ? root : document).elementFromPoint(x, y);
  if (!top) return { ok: false, why: 'covered' };
  if (e === top || e.contains(top)) return { ok: true };
  if (top.tagName === 'LABEL' && (top as HTMLLabelElement).control === e) return { ok: true };
  const labels = [...((e as HTMLInputElement).labels ?? [])];
  if (labels.some((l) => l === top || l.contains(top))) return { ok: true };
  return { ok: false, why: 'covered' };
};

// The element itself, for patchright's element handle (click, type, select).
export const NODE = (id: number): Element | null => {
  const holder = globalThis as unknown as { __helenaTask?: { nodes: Map<number, Element> } };
  const e = holder.__helenaTask?.nodes.get(id);
  return e?.isConnected ? e : null;
};

// The page key alone (OBSERVE's `key`), for the freshness check right before an action.
export const PAGE_KEY = (): string => {
  const cache = (globalThis as unknown as { __helenaTask?: { pageKey?: () => string } })
    .__helenaTask;
  return cache?.pageKey?.() ?? '';
};
