/** A labelled input with an optional hint and error, both linked to it with aria-describedby. */
export function FormField({
  id,
  label,
  hint,
  error,
  ...inputProps
}: { id: string; label: string; hint?: string; error?: string } & React.ComponentProps<'input'>) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 aria-invalid:border-red-500"
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="text-xs text-red-400">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A form-level error (e.g. wrong password), announced to screen readers when it appears. */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-800/50 bg-red-950/40 p-3 text-sm text-red-300"
    >
      {children}
    </div>
  );
}
