import { useTranslations } from 'next-intl';
import type { RoutineGateMode, RoutineGateSource } from '@/lib/api/endpoints/routines';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RoutineField } from './RoutineField';

export function RoutineGateField({
  mode,
  source,
  onModeChange,
  onSourceChange,
}: {
  mode: RoutineGateMode;
  source: RoutineGateSource;
  onModeChange: (mode: RoutineGateMode) => void;
  onSourceChange: (source: RoutineGateSource) => void;
}) {
  const t = useTranslations('routines');
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RoutineField htmlFor="routine-gate-source" label={t('gateSource')}>
        <Select
          value={source}
          onValueChange={(value) => onSourceChange(value as RoutineGateSource)}
        >
          <SelectTrigger id="routine-gate-source" className="w-full">
            <SelectValue>
              {t(
                source === 'none'
                  ? 'gateSourceNone'
                  : source === 'mail'
                    ? 'gateSourceMail'
                    : 'gateSourceAudit',
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('gateSourceNone')}</SelectItem>
            <SelectItem value="mail">{t('gateSourceMail')}</SelectItem>
            <SelectItem value="audit">{t('gateSourceAudit')}</SelectItem>
          </SelectContent>
        </Select>
      </RoutineField>
      <RoutineField htmlFor="routine-gate-mode" label={t('gateMode')}>
        <Select value={mode} onValueChange={(value) => onModeChange(value as RoutineGateMode)}>
          <SelectTrigger id="routine-gate-mode" className="w-full">
            <SelectValue>
              {t(mode === 'off' ? 'gateOff' : mode === 'shadow' ? 'gateShadow' : 'gateActive')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">{t('gateOff')}</SelectItem>
            <SelectItem value="shadow">{t('gateShadow')}</SelectItem>
            <SelectItem value="active" disabled={source === 'none'}>
              {t('gateActive')}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('gateHint')}</p>
      </RoutineField>
    </div>
  );
}
