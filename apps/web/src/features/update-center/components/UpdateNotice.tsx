import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function UpdateNotice({ children }: { children: React.ReactNode }) {
  return (
    <Alert className="bg-status-waiting/10 px-3 py-2 text-status-waiting">
      <Info />
      <AlertDescription className="text-xs text-current">{children}</AlertDescription>
    </Alert>
  );
}
