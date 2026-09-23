'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { noteTags, noteType, withTags, withType, type Frontmatter } from '../utils/noteFrontmatter';
import DocumentTagsInput from './DocumentTagsInput';

// The frontmatter properties the Docs edit. Every other property is kept as it is.
export default function DocumentProperties({
  frontmatter,
  editable,
  onChange,
}: {
  frontmatter: Frontmatter;
  editable: boolean;
  onChange: (frontmatter: Frontmatter) => void;
}) {
  const t = useTranslations('documents');
  const typeId = useId();
  const type = noteType(frontmatter);
  const [typeDraft, setTypeDraft] = useState(type);

  const commitType = () => {
    if (typeDraft.trim() !== type) onChange(withType(frontmatter, typeDraft));
  };

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('properties')}
      </h3>
      <div className="space-y-1.5">
        <Label>{t('tags')}</Label>
        <DocumentTagsInput
          tags={noteTags(frontmatter)}
          editable={editable}
          onChange={(tags) => onChange(withTags(frontmatter, tags))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={typeId}>{t('type')}</Label>
        {editable ? (
          <Input
            id={typeId}
            value={typeDraft}
            dir="auto"
            className="h-8 text-sm"
            placeholder={t('typePlaceholder')}
            onChange={(event) => setTypeDraft(event.target.value)}
            onBlur={commitType}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitType();
            }}
          />
        ) : (
          <p className="text-sm" dir="auto">
            {type || t('noValue')}
          </p>
        )}
      </div>
    </section>
  );
}
