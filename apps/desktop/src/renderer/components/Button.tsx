import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const styles: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary shadow-button hover:bg-primary-hover',
  secondary: 'border border-line bg-surface text-ink shadow-button hover:border-line-strong hover:bg-hover',
  ghost: 'text-primary hover:bg-primary-subtle',
  danger: 'text-danger hover:bg-danger-subtle',
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1',
  md: 'h-8 px-3.5 text-[13px] gap-1.5',
  lg: 'h-10 px-5 text-sm gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ${sizes[size]} ${styles[variant]} ${className}`}
      {...props}
    >
      {icon ? <span className="-ml-0.5 flex size-4 items-center justify-center [&>svg]:size-4">{icon}</span> : null}
      {children}
    </button>
  )
}
