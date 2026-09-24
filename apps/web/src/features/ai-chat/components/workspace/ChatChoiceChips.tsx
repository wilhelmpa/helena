'use client';

import type { PendingChoices } from '../../utils/composerActivity';

// The answers an agent offered for its question (Hermes' `clarify` with `choices`), as
// chips over the input: one press sends that answer. Typing something else in the field
// works as always.
export default function ChatChoiceChips({
  choices,
  onPick,
}: {
  choices: PendingChoices;
  onPick: (choice: string) => void;
}) {
  return (
    <div className="px-3 pt-2.5">
      {choices.question ? (
        <p dir="auto" className="mb-1.5 text-xs text-muted-foreground">
          {choices.question}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {choices.choices.map((choice) => (
          <button
            key={choice}
            type="button"
            dir="auto"
            onClick={() => onPick(choice)}
            className="rounded-full border border-border bg-background px-3 py-1 text-sm transition-colors hover:border-foreground/30 hover:bg-accent"
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
