import { motion } from 'motion/react'

const BAR_COUNT = 36

// Fixed pseudo-random profile so the waveform looks organic but renders the same every time.
const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
  const wave = Math.sin(i * 0.55) * 0.5 + 0.5
  const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1
  return {
    peak: 0.35 + wave * 0.55 + Math.abs(jitter) * 0.1,
    duration: 0.7 + Math.abs(jitter) * 0.6,
    delay: (i % 7) * 0.06,
  }
})

const barColour = (i: number): string =>
  // Sweep the bars across the aurora, cyan on the left to pink on the right.
  `color-mix(in oklab, var(--color-aurora-1) ${Math.round(100 - (i / (BAR_COUNT - 1)) * 100)}%, var(--color-aurora-3))`

/**
 * Microphone levels as bars, newest on the right. Without `levels` the bars
 * animate on their own (used while ScreenBuddy is speaking).
 */
export function Waveform({ levels, compact = false }: { levels?: number[]; compact?: boolean }) {
  const count = compact ? 14 : BAR_COUNT
  const padded =
    levels === undefined
      ? undefined
      : [...Array<number>(Math.max(0, count - levels.length)).fill(0), ...levels.slice(-count)]
  return (
    <div
      className={`flex flex-1 items-center justify-between ${compact ? 'h-5 max-w-16 gap-0.5' : 'h-8 px-2'}`}
      aria-hidden
    >
      {bars.slice(0, count).map((bar, i) => (
        <motion.span
          key={i}
          className="h-full w-0.75 origin-center rounded-full"
          style={{ background: barColour(i) }}
          initial={{ scaleY: 0.15 }}
          animate={
            padded === undefined
              ? { scaleY: [0.15, bar.peak, 0.25, bar.peak * 0.7, 0.15] }
              : { scaleY: Math.max(0.08, Math.min(1, padded[i] ?? 0)) }
          }
          transition={
            padded === undefined
              ? { duration: bar.duration, delay: bar.delay, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.08, ease: 'linear' }
          }
        />
      ))}
    </div>
  )
}

/** Three softly bouncing dots shown while the assistant is thinking. */
export function ThinkingIndicator({ label = 'Thinking' }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-2.5 py-1 text-[12.5px] text-ink-muted"
      role="status"
      aria-label={label}
    >
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="aurora-linear size-1.5 rounded-full"
            animate={{ y: [0, -4, 0], opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 0.9, delay: i * 0.14, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </span>
      <motion.span
        aria-hidden
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {label}
      </motion.span>
    </div>
  )
}
