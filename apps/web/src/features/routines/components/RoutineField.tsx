import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Stack } from '@/design-system';

export function RoutineField({
  htmlFor,
  label,
  children,
}: {
  htmlFor?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={2}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </Stack>
  );
}
