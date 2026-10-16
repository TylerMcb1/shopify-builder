import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

export const inputClass =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink shadow-button outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-primary focus:ring-[3px] focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'

export const Field = forwardRef<
  HTMLInputElement,
  { id: string; label: string; hint?: ReactNode; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>
>(function Field({ id, label, hint, trailing, className = '', ...props }, ref) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input ref={ref} id={id} {...props} className={`${inputClass} ${trailing ? 'pr-10' : ''} ${className}`} />
        {trailing ? <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div> : null}
      </div>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
})
