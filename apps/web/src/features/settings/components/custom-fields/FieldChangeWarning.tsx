import { TriangleAlert } from 'lucide-react';
import { Inline, Text } from '@/design-system';

// What a pending change will do to the values issues already hold.
export default function FieldChangeWarning({ children }: { children: string }) {
  return (
    <Inline as="p" gap={2} align="start" padX={3} padY={2} className="rounded-md bg-warning/15">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <Text as="span" size="xs">
        {children}
      </Text>
    </Inline>
  );
}
