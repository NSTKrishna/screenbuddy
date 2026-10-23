import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-raised">
      <h3 className="px-3.5 pt-3 pb-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
        {title}
      </h3>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-ink">{label}</p>
        {hint !== undefined && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-faint">{hint}</p>
        )}
      </div>
      {children}
    </div>
  )
}

export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-aurora-2' : 'bg-white/15'}`}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 34 }}
      />
    </button>
  )
}

export const inputClass =
  'w-full rounded-lg border border-line bg-black/20 px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-strong'
export const smallButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 text-[12px] text-ink transition-colors duration-150 hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-40'

export function Field({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string
  id: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="px-3.5 py-2.5">
      <label htmlFor={id} className="mb-1 block text-[12px] text-ink-muted">
        {label}
      </label>
      {children}
      {error !== undefined && error !== null ? (
        <p className="mt-1 text-[11.5px] text-danger">{error}</p>
      ) : (
        hint !== undefined && <p className="mt-1 text-[11.5px] text-ink-faint">{hint}</p>
      )}
    </div>
  )
}
