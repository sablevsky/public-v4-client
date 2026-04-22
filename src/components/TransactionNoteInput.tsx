import { cn } from '@/lib/utils';

type TransactionNoteInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  description?: string;
  label?: string;
  placeholder?: string;
};

const textareaClassName =
  'flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const TransactionNoteInput = ({
  id,
  value,
  onChange,
  className,
  description = 'Optional note/memo to include when proposing this transaction.',
  label = 'Note',
  placeholder = 'Add an optional note',
}: TransactionNoteInputProps) => {
  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={textareaClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
};

export default TransactionNoteInput;
