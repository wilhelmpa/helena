'use client';

import { useFormatter, useTranslations } from 'next-intl';

// How much of a size limit a text uses (owner 30.09.: limits like Hermes' made visible): the
// count "1.840 / 2.200 Zeichen" under an editor, a thin bar, the colour of a warning above 90 %
// and of a full field at the limit, and — when the model only sees a shortened text — a line
// that says so. `used` is the length of the text as it stands in the editor; `limit` is null
// where the server sends none, and then nothing is shown.
export function LimitMeter({
  used,
  limit,
  truncated = false,
  className,
}: {
  used: number;
  limit: number | null | undefined;
  truncated?: boolean;
  className?: string;
}) {
  const t = useTranslations('common.limit');
  const format = useFormatter();
  if (limit == null || limit <= 0) return null;
  const state = used > limit ? 'full' : used / limit > 0.9 ? 'warning' : 'ok';
  return (
    <div className={`ds-limit ${className ?? ''}`} data-state={state}>
      <div className="ds-limit-line">
        <span className="ds-limit-count">
          {t('count', { used: format.number(used), limit: format.number(limit) })}
        </span>
        <span className="ds-limit-bar" aria-hidden="true">
          <span style={{ inlineSize: `${Math.min(100, (used / limit) * 100)}%` }} />
        </span>
      </div>
      {state === 'full' && (
        <p className="ds-limit-note" role="alert">
          {t('tooLong')}
        </p>
      )}
      {state === 'warning' && (
        <p className="ds-limit-note">{t('nearlyFull', { left: format.number(limit - used) })}</p>
      )}
      {truncated && state !== 'full' && <p className="ds-limit-note">{t('truncated')}</p>}
    </div>
  );
}
