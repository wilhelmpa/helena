'use client';

import { FieldFrame } from '@/design-system';
import { useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cleanTag } from '../utils/noteFrontmatter';

export default function DocumentTagsInput({
  tags,
  editable,
  onChange,
}: {
  tags: string[];
  editable: boolean;
  onChange: (tags: string[]) => void;
}) {
  const t = useTranslations('documents');
  const [draft, setDraft] = useState('');

  const add = () => {
    const tag = cleanTag(draft);
    setDraft('');
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
  };

  if (!editable && tags.length === 0) return <p className="text-sm">{t('noValue')}</p>;

  return (
    <FieldFrame>
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 rounded-sm bg-muted px-1.5 py-0.5 text-xs"
          dir="auto"
        >
          #{tag}
          {editable && (
            <button
              type="button"
              className="rounded-sm text-muted-foreground hover:text-foreground"
              aria-label={t('removeTag', { tag })}
              onClick={() => onChange(tags.filter((other) => other !== tag))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          value={draft}
          dir="auto"
          className="h-6 min-w-20 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={t('addTag')}
          aria-label={t('addTag')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              add();
            } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
        />
      )}
    </FieldFrame>
  );
}
