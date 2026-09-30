import type { ReactNode } from 'react';
import { Notice } from '@/design-system';

// A hint of the device page: the design system's notice (warning tone).
export default function DevicesNotice({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <Notice tone="warning" title={title}>
      {children}
    </Notice>
  );
}
