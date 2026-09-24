'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { canonicalTimezone } from '@/utils/dates';
import { Check } from 'lucide-react';
import { ComboboxTrigger } from '@/components/ui/combobox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent } from '@/components/ui/popover';

// The regions IANA zone names start with, in the order they are listed. A zone whose
// prefix is not one of these (UTC, GMT, legacy aliases) falls into "Other".
// The region names themselves are messages under `account.preferences.timezoneGroups`.
const REGIONS = [
  'America',
  'Europe',
  'Africa',
  'Asia',
  'Australia',
  'Pacific',
  'Atlantic',
  'Indian',
  'Antarctica',
] as const;

// Every zone the browser's own Intl data knows, so the list matches what the runtime
// can actually format in, with renamed zones under their current name. Engines
// without supportedValuesOf fall back to the detected zone plus UTC.
function zoneList(): string[] {
  const supported = Intl.supportedValuesOf?.('timeZone');
  if (!supported?.length) {
    const detected = canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return detected && detected !== 'UTC' ? [detected, 'UTC'] : ['UTC'];
  }
  return [...new Set(supported.map(canonicalTimezone))].sort();
}

// The zone's current offset, e.g. "GMT+2".
function zoneOffset(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// "Europe/Kyiv" reads as "(GMT+2) Kyiv"; "America/Argentina/Salta" keeps both parts.
// Search matches this label, so typing a city or an offset finds the zone.
function zoneLabel(zone: string): string {
  const parts = zone.split('/');
  const city = (parts.length > 1 ? parts.slice(1) : parts).join(' / ').replace(/_/g, ' ');
  const offset = zoneOffset(zone);
  return offset ? `(${offset}) ${city}` : city;
}

type ZoneRegion = (typeof REGIONS)[number] | 'Other';

function groupZones(zones: string[]): { value: ZoneRegion; items: string[] }[] {
  const groups = REGIONS.map((prefix) => ({
    value: prefix as ZoneRegion,
    items: zones.filter((z) => z.startsWith(`${prefix}/`)),
  }));
  const grouped = new Set(groups.flatMap((g) => g.items));
  const other = zones.filter((z) => !grouped.has(z));
  return [...groups, { value: 'Other' as ZoneRegion, items: other }].filter(
    (g) => g.items.length > 0,
  );
}

// A label costs an Intl.DateTimeFormat, so labels are built on first use and kept: the
// zone list only renders while the picker is open, and building several hundred of them
// up front would block the page opening.
const labels = new Map<string, string>();
function labelOf(zone: string): string {
  let label = labels.get(zone);
  if (label === undefined) {
    label = zoneLabel(zone);
    labels.set(zone, label);
  }
  return label;
}

// Timezone picker: every zone the runtime knows, grouped by region and searchable by
// city or offset (the app's combobox: Popover + Command). The stored value is the IANA
// zone name.
export default function AccountPreferencesTimezone({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (timezone: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('account.preferences');
  const [open, setOpen] = useState(false);
  const selected = canonicalTimezone(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ComboboxTrigger
        value={selected ? labelOf(selected) : ''}
        placeholder={t('timezonePlaceholder')}
        open={open}
        disabled={disabled}
        className="w-full sm:w-56"
      />
      <PopoverContent className="w-72 p-0" align="start">
        <TimezoneList
          selected={selected}
          onSelect={(zone) => {
            onChange(zone);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function TimezoneList({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (zone: string) => void;
}) {
  const t = useTranslations('account.preferences');
  const groups = useMemo(() => groupZones(zoneList()), []);
  return (
    <Command>
      <CommandInput placeholder={t('timezoneSearch')} />
      <CommandList className="max-h-72">
        <CommandEmpty>{t('timezoneEmpty')}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.value} heading={t(`timezoneGroups.${group.value}`)}>
            {group.items.map((zone) => (
              <CommandItem
                key={zone}
                value={zone}
                keywords={[labelOf(zone)]}
                onSelect={() => onSelect(zone)}
              >
                <span className="flex-1 truncate">{labelOf(zone)}</span>
                {zone === selected && <Check className="ms-auto size-4" />}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
