'use client';

import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

// The search box above a list that is paged on the server: typing here refetches a
// page rather than filtering what is on screen.
export default function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 ps-8"
      />
    </div>
  );
}
