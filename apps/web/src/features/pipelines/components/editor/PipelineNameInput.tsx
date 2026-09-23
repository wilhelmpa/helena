'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const EMPTY = '__empty';

// One status or label, by name: picked from the project's own when there are any to
// pick from, typed otherwise (a template names them for every project). A name the
// project does not have stays listed, so the reader sees what is set.
export default function PipelineNameInput({
  id,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  id?: string;
  value: string;
  options?: string[];
  emptyLabel?: string;
  onChange: (value: string) => void;
}) {
  if (!options?.length)
    return (
      <Input
        id={id}
        value={value}
        maxLength={120}
        dir="auto"
        placeholder={emptyLabel}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  const names = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select
      value={value || (emptyLabel ? EMPTY : undefined)}
      onValueChange={(next) => onChange(next === EMPTY ? '' : next)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel && <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>}
        {names.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
