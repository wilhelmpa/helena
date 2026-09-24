import type { Locale } from '@helena/locales';
import type { ProjectPresetKey } from '@helena/locales/defaults';
import type { CopyProjectIncludeKey } from '@/lib/api/endpoints/teams';

export interface NewProjectInput {
  key: string;
  name: string;
  description: string;
  // The language the new project's default states, issue types and views are named in.
  locale: Locale;
  preset?: ProjectPresetKey;
  include?: Partial<Record<CopyProjectIncludeKey, boolean>>;
}

// The body of the create or copy request of the new-project dialog. It carries the
// language the dialog was shown in, so the project gets exactly the type names its
// preview listed. A copy takes its types from the source project, so the preset goes
// with a create only, and the selection of sections with a copy only.
export function newProjectInput(fields: {
  key: string;
  name: string;
  description: string;
  locale: Locale;
  preset: ProjectPresetKey;
  include: Record<CopyProjectIncludeKey, boolean> | null;
}): NewProjectInput {
  const base = {
    key: fields.key.trim().toUpperCase(),
    name: fields.name.trim(),
    description: fields.description.trim(),
    locale: fields.locale,
  };
  return fields.include ? { ...base, include: fields.include } : { ...base, preset: fields.preset };
}
