import type { ReactNode } from 'react'

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  full = false,
}: {
  label: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
  full?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`${full ? 'flex w-full' : 'inline-flex'} rounded-lg bg-control p-0.5`}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`${full ? 'flex-1' : ''} inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors duration-150 [&>svg]:size-3.5 ${
              selected ? 'bg-surface text-ink shadow-button' : 'text-muted hover:text-ink'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
