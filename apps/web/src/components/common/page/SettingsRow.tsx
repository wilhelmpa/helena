import { cloneElement, Fragment, isValidElement, useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// One row inside a settings group: name and description on the left, the control
// (usually a switch) on the right. `note` is what has to be done before the control
// applies, set apart from the description so the reason a switch cannot be moved is
// not read as more of its explanation. The dividers come from the card. The control
// is named by the row's title and described by its description, so a switch is not
// announced as a bare "switch".
export default function SettingsRow({
  title,
  description,
  note,
  control,
}: {
  title: string;
  description: string;
  note?: string;
  control: ReactNode;
}) {
  const id = useId();
  type Named = { 'aria-label'?: string; 'aria-labelledby'?: string; 'aria-describedby'?: string };
  const named =
    isValidElement<Named>(control) &&
    // A wrapper around several controls is not one control to name.
    control.type !== 'div' &&
    control.type !== 'span' &&
    control.type !== Fragment &&
    control.props['aria-label'] == null &&
    control.props['aria-labelledby'] == null
      ? cloneElement(control, {
          'aria-labelledby': `${id}-title`,
          'aria-describedby': control.props['aria-describedby'] ?? `${id}-description`,
        })
      : control;
  // The same row as the design system's SettingsRow (ds-settings-row), with the wiring that
  // names the control by the title and describes it by the description.
  return (
    <div className="ds-settings-row">
      <div className="ds-settings-row-text">
        <span id={`${id}-title`}>{title}</span>
        <p id={`${id}-description`}>{description}</p>
        {note && (
          <Alert className="mt-2 w-fit bg-status-waiting/10 px-3 py-2 text-status-waiting">
            <Info />
            <AlertDescription className="text-xs text-current">{note}</AlertDescription>
          </Alert>
        )}
      </div>
      <div className="ds-settings-row-control">{named}</div>
    </div>
  );
}
