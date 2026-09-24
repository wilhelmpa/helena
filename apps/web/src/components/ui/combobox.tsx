import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// The app's one combobox pattern (shadcn's): a Popover whose trigger is this button and
// whose content is a Command (cmdk) with its search input and list. The trigger shows
// the picked value, or the placeholder in muted text when nothing is picked yet.
export function ComboboxTrigger({
  value,
  placeholder,
  open,
  disabled,
  className,
}: {
  value: string;
  placeholder: string;
  open: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className={cn('w-full justify-between font-normal', className)}
      >
        <span className={value ? 'truncate' : 'truncate text-muted-foreground'}>
          {value || placeholder}
        </span>
        <ChevronsUpDown className="ms-2 size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
  );
}
