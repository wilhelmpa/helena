'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

export interface NameOption {
  value: string;
  label: string;
}

// Several names: checked from the options when there are any, typed as a comma-separated
// list otherwise.
export default function PipelineNamesInput({
  id,
  value,
  options,
  onChange,
}: {
  id?: string;
  value: string[];
  options?: NameOption[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations('pipelines.inspector.condition');
  const [text, setText] = useState(value.join(', '));

  if (!options?.length)
    return (
      <Input
        id={id}
        value={text}
        dir="auto"
        placeholder={t('namesHint')}
        onChange={(event) => {
          setText(event.target.value);
          onChange(
            event.target.value
              .split(',')
              .map((name) => name.trim())
              .filter(Boolean),
          );
        }}
      />
    );
  const labelOf = (name: string) => options.find((option) => option.value === name)?.label ?? name;
  const all = [
    ...value
      .filter((name) => !options.some((option) => option.value === name))
      .map((name) => ({ value: name, label: name })),
    ...options,
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={id} variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">
            {value.length ? value.map(labelOf).join(', ') : t('choose')}
          </span>
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {all.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={value.includes(option.value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) =>
              onChange(
                checked ? [...value, option.value] : value.filter((name) => name !== option.value),
              )
            }
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
