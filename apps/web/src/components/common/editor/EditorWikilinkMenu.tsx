import { useImperativeHandle, useState, type Ref } from 'react';

export type WikilinkCandidate = { path: string; title: string };
export type WikilinkMenuRef = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

export default function EditorWikilinkMenu({
  items,
  command,
  ref,
}: {
  items: WikilinkCandidate[];
  command: (item: WikilinkCandidate) => void;
  ref?: Ref<WikilinkMenuRef>;
}) {
  const [active, setActive] = useState(0);
  const selected = Math.min(active, items.length - 1);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown') {
        setActive((value) => (value + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setActive((value) => (value - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[selected]!);
        return true;
      }
      return false;
    },
  }));
  if (!items.length) return null;
  return (
    <div
      className="z-50 max-h-64 w-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg"
      role="listbox"
      aria-label="Wiki-Links"
    >
      {items.map((item, index) => (
        <button
          key={item.path}
          type="button"
          role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command(item)}
          onMouseEnter={() => setActive(index)}
          className={`block w-full rounded-lg px-2 py-1.5 text-start text-sm ${index === selected ? 'bg-accent' : ''}`}
        >
          <span className="block truncate">{item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.path}</span>
        </button>
      ))}
    </div>
  );
}
