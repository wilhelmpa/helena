import {
  forwardRef,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

// Fields (docs/design-system.md §4): a quiet surface, no border, no focus ring. An error
// is a short line of text under the field, never a coloured frame (owner, 28.09.).

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ className, ...props }, ref) {
    return <input ref={ref} className={`ds-field ${className ?? ''}`} {...props} />;
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...props }, ref) {
  return <textarea ref={ref} className={`ds-field ds-field-area ${className ?? ''}`} {...props} />;
});

// The frame of a field that holds more than one input: tags, recipients, a rich-text editor.
// The same surface, radius and focus as a TextField; `area` is the block of an editor (padding
// on all sides, no row layout).
export function FieldFrame({
  area = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { area?: boolean }) {
  return (
    <div
      className={`ds-field-frame ${className ?? ''}`}
      data-area={area ? '' : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

// A labelled field with its hint and its error text.
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  const fallback = useId();
  return (
    <div className="ds-field-group">
      <label className="ds-field-label" htmlFor={htmlFor ?? fallback}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="ds-field-hint">{hint}</p>}
      {error && (
        <p className="ds-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// The search field of a page toolbar or a list.
export const SearchField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }
>(function SearchField({ className, icon, ...props }, ref) {
  return (
    <label className={`ds-search ${className ?? ''}`}>
      {icon}
      <input ref={ref} type="search" {...props} />
    </label>
  );
});
