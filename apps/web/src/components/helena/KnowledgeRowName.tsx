'use client';

// The name of a row of Wissen while it is renamed in place (Auftrag 117).
export default function KnowledgeRowName({
  initial,
  label,
  onSubmit,
  onCancel,
}: {
  initial: string;
  label: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      // eslint-disable-next-line jsx-a11y/no-autofocus -- renaming starts in the field
      autoFocus
      aria-label={label}
      defaultValue={initial}
      className="ds-field ds-knowledge-rename"
      dir="auto"
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          const value = event.currentTarget.value.trim();
          if (value && value !== initial) onSubmit(value);
          else onCancel();
        } else if (event.key === 'Escape') onCancel();
      }}
      onBlur={(event) => {
        const value = event.currentTarget.value.trim();
        if (value && value !== initial) onSubmit(value);
        else onCancel();
      }}
    />
  );
}
