'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { DefinitionIssue } from '@/lib/api/endpoints/pipelines';
import PipelineField from './PipelineField';
import PipelineTemplateText from './PipelineTemplateText';

// The settings of a plugin's step or trigger, drawn from the JSON Schema of its `config`
// (@helena/sdk `configSchema`): text (with {{variables}} in a step), numbers, switches and
// choices; anything else as JSON. A field's problems are the API's for `config.<name>`.

interface Property {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
}

function propertiesOf(schema: Record<string, unknown>): [string, Property][] {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object') return [];
  return Object.entries(properties as Record<string, Property>);
}

function typeOf(property: Property): string {
  const type = Array.isArray(property.type)
    ? property.type.find((item) => item !== 'null')
    : property.type;
  return type ?? 'string';
}

// "maxRetries" → "Max retries", for a field without a title.
function labelOf(key: string, property: Property): string {
  if (property.title) return property.title;
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// Anything the form has no control for, edited as JSON; kept as text while it does not parse.
function JsonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  return (
    <Textarea
      id={id}
      rows={4}
      dir="ltr"
      className="font-mono text-xs"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        try {
          onChange(JSON.parse(event.target.value));
        } catch {
          // Kept as text until it is JSON again.
        }
      }}
    />
  );
}

export default function PipelinePluginFields({
  idPrefix,
  schema,
  value,
  stepId,
  issuesOf,
  onChange,
}: {
  idPrefix: string;
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  // The step whose earlier results the texts may use; a trigger has none.
  stepId?: string;
  issuesOf: (field: string) => DefinitionIssue[];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const t = useTranslations('pipelines.inspector.plugin');
  const properties = propertiesOf(schema);
  if (properties.length === 0)
    return <p className="text-sm text-muted-foreground">{t('noSettings')}</p>;
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });

  return (
    <>
      {properties.map(([key, property]) => {
        const id = `${idPrefix}-${key}`;
        const label = labelOf(key, property);
        const issues = issuesOf(`config.${key}`);
        const current = value[key];
        const type = typeOf(property);
        if (Array.isArray(property.enum) && property.enum.length > 0)
          return (
            <PipelineField
              key={key}
              label={label}
              htmlFor={id}
              hint={property.description}
              issues={issues}
            >
              <Select
                value={current === undefined ? '' : String(current)}
                onValueChange={(next) =>
                  set(key, property.enum!.find((option) => String(option) === next) ?? next)
                }
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue placeholder={t('choose')} />
                </SelectTrigger>
                <SelectContent>
                  {property.enum.map((option) => (
                    <SelectItem key={String(option)} value={String(option)}>
                      {String(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </PipelineField>
          );
        if (type === 'boolean')
          return (
            <PipelineField
              key={key}
              label={label}
              htmlFor={id}
              hint={property.description}
              issues={issues}
            >
              <Switch
                id={id}
                checked={current === true}
                onCheckedChange={(checked) => set(key, checked)}
              />
            </PipelineField>
          );
        if (type === 'number' || type === 'integer')
          return (
            <PipelineField
              key={key}
              label={label}
              htmlFor={id}
              hint={property.description}
              issues={issues}
            >
              <Input
                id={id}
                type="number"
                inputMode={type === 'integer' ? 'numeric' : 'decimal'}
                dir="ltr"
                step={type === 'integer' ? 1 : 'any'}
                min={property.minimum}
                max={property.maximum}
                value={typeof current === 'number' ? current : ''}
                onChange={(event) =>
                  set(key, event.target.value === '' ? undefined : Number(event.target.value))
                }
              />
            </PipelineField>
          );
        if (type === 'string') {
          const text = typeof current === 'string' ? current : '';
          const maxLength = property.maxLength ?? 4_000;
          // One line unless the schema allows a long text or asks for a text area.
          const singleLine = (property.maxLength ?? 0) <= 300 && property.format !== 'textarea';
          if (stepId)
            return (
              <PipelineTemplateText
                key={key}
                id={id}
                label={label}
                stepId={stepId}
                value={text}
                maxLength={maxLength}
                singleLine={singleLine}
                rows={3}
                issues={issues}
                onChange={(next) => set(key, next)}
              />
            );
          return (
            <PipelineField
              key={key}
              label={label}
              htmlFor={id}
              hint={property.description}
              issues={issues}
            >
              <Input
                id={id}
                dir="auto"
                maxLength={maxLength}
                value={text}
                onChange={(event) => set(key, event.target.value)}
              />
            </PipelineField>
          );
        }
        return (
          <PipelineField
            key={key}
            label={label}
            htmlFor={id}
            hint={property.description}
            issues={issues}
          >
            <JsonField id={id} value={current} onChange={(next) => set(key, next)} />
          </PipelineField>
        );
      })}
    </>
  );
}
