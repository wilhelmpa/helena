import { useState, type ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { OverlayControls } from '@/design-system';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// Thin wrapper over shadcn Dialog that keeps the mount/unmount call style used
// across the app: callers render `{show && <Modal .../>}`, so the dialog is
// always open while mounted and onClose fires when Radix requests a close
// (overlay click or Escape).
// Width step (components/ui/dialog.tsx): default small, wide large, "xl" for a
// two-column body.
const SIZE = { false: 'small', true: 'large', xl: 'xlarge' } as const;

// The fullscreen props of a dialog whose body adapts to fullscreen. On a phone
// there is no room for anything else, so it is always fullscreen and the toggle
// is dropped.
export function useModalFullscreen() {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  return {
    fullscreen: isMobile || expanded,
    onToggleFullscreen: isMobile ? undefined : () => setExpanded((v) => !v),
  };
}

export default function Modal({
  title,
  crumb,
  headerAction,
  description,
  scope,
  onClose,
  onOpenAutoFocus,
  children,
  wide = false,
  fullscreen = false,
  onToggleFullscreen,
  className,
  createLayout = false,
}: {
  title: string;
  // Trailing breadcrumb naming what the dialog was opened for.
  crumb?: string;
  // A control shown after the title. It comes before the body in the DOM, so a
  // caller that passes one has to focus its own first field through
  // onOpenAutoFocus.
  headerAction?: ReactNode;
  description?: string;
  // Leading breadcrumb naming what the dialog acts in: a project key, a team.
  scope?: ReactNode;
  onClose: () => void;
  // Radix focuses the first tabbable node when the dialog opens. Prevent it here
  // and focus the field the dialog is really for.
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
  wide?: boolean | 'xl';
  // On the dialog itself, for a caller that has to adjust its padding.
  className?: string;
  createLayout?: boolean;
  // Controlled by the caller: in fullscreen the content is a flex column, so the
  // caller's body has to claim the leftover space itself.
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size={SIZE[`${wide}`]}
        showCloseButton={false}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn(
          // DialogContent sets only transition-duration, so every property
          // transitions (transition-property defaults to `all`). Toggling
          // fullscreen would then slide the dialog, unevenly: height and
          // max-width switch to/from `auto`/`none` and do not interpolate.
          'transition-none',
          fullscreen
            ? 'top-0 left-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0'
            : // A flex column, not the grid DialogContent defaults to: an auto grid
              // row keeps its content height under a capped container, so the body
              // never shrinks and never scrolls.
              'flex max-h-[85vh] flex-col overflow-hidden',
          createLayout && 'ds-create-dialog translate-y-0 gap-0',
          className,
        )}
      >
        <DialogHeader className={createLayout ? 'mb-1.5' : undefined}>
          <DialogTitle
            className={createLayout ? 'ds-create-dialog-eyebrow' : 'flex items-center gap-2'}
          >
            {createLayout ? (
              <>
                <span>
                  {scope} · {title.toUpperCase()}
                </span>
                <button type="button" onClick={onClose} className="ds-create-dialog-esc">
                  {'ESC'}
                </button>
              </>
            ) : (
              <>
                {scope && (
                  <>
                    <span className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground">
                      {scope}
                    </span>
                    <span className="font-normal text-muted-foreground">›</span>
                  </>
                )}
                {title}
                {crumb && (
                  <>
                    <span className="font-normal text-muted-foreground">›</span>
                    <span className="font-normal text-muted-foreground">{crumb}</span>
                  </>
                )}
                {headerAction}
              </>
            )}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* The body scrolls, not the dialog: the dialog stays the positioned
            ancestor a body-wide overlay can cover without scrolling away. A flex
            column either way, so a caller can hand the leftover height to one of
            its parts. */}
        <div
          className={cn(
            'flex min-h-0 flex-col',
            fullscreen ? 'flex-1 overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {children}
        </div>
        {/* After the body: Radix focuses the first tabbable node on open, which
            should be a field of the body, not a control. */}
        {!createLayout && (
          <div className="ds-dialog-tools">
            <OverlayControls
              full={fullscreen}
              onToggleFull={onToggleFullscreen}
              onClose={onClose}
              keepFocus
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
