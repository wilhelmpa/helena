import { useEffect, useState } from 'react';
import { Keyboard, RotateCcw, X } from 'lucide-react';
import { comboFromEvent, formatCombo, type HotkeyDef } from '@/utils/hotkeys';
import { useIsMac } from '@/context/useHotkeys';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';

// One shortcut in the editor: what it does, the combination in effect, and the
// controls to rebind or reset it. Pressing "Change" listens for the next key press
// and reports the combination it stands for; Escape cancels. A fixed shortcut (one
// owned by a UI primitive) is shown but cannot be rebound.
export default function HotkeysEditorRow({
  def,
  combo,
  overridden,
  conflictWith,
  onRecord,
  onReset,
}: {
  def: HotkeyDef;
  combo: string;
  // True when this row's binding comes from the layer being edited, not below it.
  overridden: boolean;
  // What the command already using this combination does, if any.
  conflictWith: string | null;
  onRecord: (combo: string) => void;
  onReset: () => void;
}) {
  const tCommon = useTranslations('common');
  const t = useTranslations('common.hotkeys');
  const isMac = useIsMac();
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    function onKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const next = comboFromEvent(e);
      if (!next) return;
      setRecording(false);
      onRecord(next);
    }
    // Capture, so the app's own key layer does not act on the press being recorded.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recording, onRecord]);

  return (
    <div className="flex min-h-11 items-center gap-3 px-4 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{t(`commands.${def.id}`)}</p>
        {conflictWith && (
          <p className="mt-0.5 text-xs text-destructive">
            {t('conflict', { command: conflictWith })}
          </p>
        )}
      </div>
      <kbd
        className={`w-16 shrink-0 rounded-md border border-sidebar-border px-1.5 py-1 text-center font-mono text-xs sm:w-24 ${
          recording ? 'bg-accent text-accent-foreground' : 'bg-background text-foreground'
        }`}
      >
        {recording ? t('pressKeys') : formatCombo(combo, isMac)}
      </kbd>
      {def.fixed ? (
        <span className="shrink-0 text-end text-xs text-muted-foreground sm:w-28">
          {t('fixed')}
        </span>
      ) : (
        <div className="flex shrink-0 justify-end gap-1 sm:w-28">
          {/* On a phone the command name needs the room: the button keeps its icon. */}
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:size-8 max-sm:px-0"
            aria-label={recording ? tCommon('cancel') : tCommon('change')}
            onClick={() => setRecording((r) => !r)}
          >
            {recording ? <X className="sm:hidden" /> : <Keyboard className="sm:hidden" />}
            <span className="max-sm:hidden">
              {recording ? tCommon('cancel') : tCommon('change')}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('resetShortcut')}
            disabled={!overridden}
            onClick={onReset}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
