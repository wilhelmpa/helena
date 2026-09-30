import { Info } from 'lucide-react';
import { Notice } from '@/design-system';

export default function UpdateNotice({ children }: { children: React.ReactNode }) {
  return (
    <Notice tone="warning" icon={<Info />}>
      {children}
    </Notice>
  );
}
