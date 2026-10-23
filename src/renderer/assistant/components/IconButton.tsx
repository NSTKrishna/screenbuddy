import type { ComponentPropsWithoutRef, ReactNode } from 'react'

interface IconButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** Accessible name; also shown as the tooltip. */
  label: string
  shortcutHint?: string
  active?: boolean
  tone?: 'default' | 'accent' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

const tones = {
  default: 'text-ink-muted hover:text-ink hover:bg-surface-hover',
  accent: 'text-ink hover:bg-surface-hover',
  danger: 'text-ink-muted hover:text-danger hover:bg-danger/10',
} as const

export function IconButton({
  label,
  shortcutHint,
  active = false,
  tone = 'default',
  size = 'sm',
  className = '',
  type = 'button',
  children,
  ...rest
}: IconButtonProps) {
  const dimension = size === 'sm' ? 'size-7' : 'size-8'
  return (
    <button
      type={type}
      aria-label={label}
      title={shortcutHint === undefined ? label : `${label} (${shortcutHint})`}
      className={`app-no-drag inline-flex ${dimension} shrink-0 items-center justify-center rounded-lg transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${active ? 'bg-surface-hover text-ink' : tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
