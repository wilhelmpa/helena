'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { SettingsNavGroup } from '@/hooks/useSettingsNavGroups';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The project settings navigation on a phone (docs/volition-design-helena-ui.md
// "Mobil: Einstellungen einspaltig, die Unternavigation als Auswahlmenü"): the same
// groups and sections as the rail, as one select that opens the chosen section, so the
// page starts with its own content instead of a screen-long list of links.
export default function ProjectSettingsNavSelect({
  groups,
  label,
}: {
  groups: SettingsNavGroup[];
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = groups.flatMap((group) => group.items);
  const active = items.find((item) => item.href === pathname);

  return (
    <Select value={active?.href} onValueChange={(href) => router.push(href)}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.key}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <SelectItem key={item.key} value={item.href}>
                  <Icon />
                  {item.label}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
