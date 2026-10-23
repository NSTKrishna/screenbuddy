import { motion } from 'motion/react'
import type { AssistantStatus } from '../lib/useAssistantStatus'

interface OrbGlyphProps {
  status: AssistantStatus
  /** Diameter in px. */
  size: number
  /** Adds the outer glow; off for small inline uses. */
  glow?: boolean
}

const spinSeconds: Record<AssistantStatus, number> = {
  idle: 14,
  listening: 6,
  transcribing: 2.4,
  thinking: 2.4,
  responding: 5,
  speaking: 4,
  error: 30,
}

/**
 * The ScreenBuddy mark: a dark glass sphere inside a slowly turning aurora
 * rim. Its motion reflects what the assistant is doing.
 */
export function OrbGlyph({ status, size, glow = false }: OrbGlyphProps) {
  const isError = status === 'error'
  const rim = Math.max(1.5, size / 26)
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {glow && (
        <motion.span
          aria-hidden
          className={`absolute -inset-1.5 rounded-full blur-md ${isError ? 'bg-danger/50' : 'aurora-conic'}`}
          animate={{
            rotate: 360,
            opacity:
              status === 'listening' || status === 'speaking'
                ? [0.55, 0.9, 0.55]
                : status === 'idle'
                  ? 0.38
                  : 0.6,
          }}
          transition={{
            rotate: { duration: spinSeconds[status], repeat: Infinity, ease: 'linear' },
            opacity: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
          }}
        />
      )}
      <motion.span
        aria-hidden
        className={`absolute inset-0 rounded-full ${isError ? 'bg-danger' : 'aurora-conic'}`}
        animate={{ rotate: 360 }}
        transition={{ duration: spinSeconds[status], repeat: Infinity, ease: 'linear' }}
      />
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{
          inset: rim,
          background:
            'radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.18), transparent 42%), radial-gradient(circle at 50% 60%, #1c1d26, #0c0d12 78%)',
          boxShadow: 'inset 0 1px 1px rgb(255 255 255 / 0.12)',
        }}
      />
      <motion.span
        aria-hidden
        className={`absolute top-1/2 left-1/2 rounded-full ${isError ? 'bg-danger' : 'aurora-linear'}`}
        style={{ width: size * 0.26, height: size * 0.26, x: '-50%', y: '-50%' }}
        animate={
          status === 'thinking' || status === 'transcribing'
            ? { scale: [0.75, 1.15, 0.75], opacity: [0.7, 1, 0.7] }
            : status === 'listening' || status === 'speaking'
              ? { scale: [0.9, 1.35, 0.9], opacity: 1 }
              : { scale: [0.92, 1.04, 0.92], opacity: 0.95 }
        }
        transition={{
          duration:
            status === 'thinking' || status === 'transcribing'
              ? 0.9
              : status === 'listening' || status === 'speaking'
                ? 1.1
                : 3.2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </span>
  )
}
