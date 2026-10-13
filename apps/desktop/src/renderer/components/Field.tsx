import type { InputHTMLAttributes } from 'react'

export function Field({ id, label, ...props }: { id: string; label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label htmlFor={id} className="block text-sm text-ink">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        id={id}
        {...props}
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-ink disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  )
}
