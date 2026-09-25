'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { boundedNumber } from '../../utils/agentLearning';

// A whole number within bounds, typed as text so it can be cleared: empty or out of bounds
// is the default (undefined), marked invalid when something was typed.
export default function BoundedNumberInput({
  bounds,
  value,
  onValue,
  placeholder,
  disabled,
  className = 'h-7 w-20',
  ariaLabel,
}: {
  bounds: { min: number; max: number };
  value: number | undefined;
  onValue: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const parsed = boundedNumber(text, bounds);
  return (
    <Input
      type="number"
      className={className}
      min={bounds.min}
      max={bounds.max}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={text.trim() !== '' && parsed === undefined}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onValue(boundedNumber(event.target.value, bounds));
      }}
    />
  );
}
