import { Input } from '@/components/ui/input';

// A whole number, or null while the field is empty. A required field keeps the empty
// value too, so the API names it as missing.
export default function PipelineNumberInput({
  id,
  value,
  min,
  max,
  placeholder,
  onChange,
}: {
  id?: string;
  value: number | null;
  min: number;
  max: number;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      dir="ltr"
      placeholder={placeholder}
      value={value === null || Number.isNaN(value) ? '' : value}
      onChange={(event) =>
        onChange(event.target.value === '' ? null : Math.trunc(Number(event.target.value)))
      }
    />
  );
}
