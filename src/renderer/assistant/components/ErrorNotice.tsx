import type { ReactNode } from 'react'
import { ImageOff, RotateCw, Settings, TriangleAlert } from 'lucide-react'
import { motion } from 'motion/react'
import type { ChatErrorCode } from '@shared/schemas/chat'
import type { FailedTurn } from '../stores/useChatStore'

const TITLES: Partial<Record<ChatErrorCode, string>> = {
  NOT_CONFIGURED: 'Set up an AI provider',
  INVALID_API_KEY: 'API key rejected',
  PROVIDER_UNAVAILABLE: 'Can’t reach the provider',
  RATE_LIMITED: 'Rate limited',
  TIMEOUT: 'No answer in time',
  VISION_UNSUPPORTED: 'This model can’t see images',
  IMAGE_EXPIRED: 'Screenshot expired',
  CONTEXT_TOO_LONG: 'Conversation too long',
  MODEL_NOT_FOUND: 'Model not found',
}

/** Codes that are fixed by changing settings rather than by trying again. */
const SETTINGS_CODES = new Set<ChatErrorCode>([
  'NOT_CONFIGURED',
  'INVALID_API_KEY',
  'MODEL_NOT_FOUND',
  'VISION_UNSUPPORTED',
])

interface ErrorNoticeProps {
  error: FailedTurn
  onRetry: () => void
  onRetryWithoutImage: () => void
  onOpenSettings: () => void
}

function Action({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface-raised px-2.5 py-1 text-[12px] font-medium text-ink transition-colors duration-150 hover:bg-surface-hover"
    >
      {children}
    </button>
  )
}

export function ErrorNotice({
  error,
  onRetry,
  onRetryWithoutImage,
  onOpenSettings,
}: ErrorNoticeProps) {
  const imageProblem = error.code === 'VISION_UNSUPPORTED' || error.code === 'IMAGE_EXPIRED'
  return (
    <motion.div
      role="alert"
      className="rounded-xl border border-danger/25 bg-danger/[0.08] p-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-px size-4 shrink-0 text-danger" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-ink">
            {TITLES[error.code] ?? 'That didn’t go through'}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{error.message}</p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6.5">
        {imageProblem && error.hadImage && (
          <Action onClick={onRetryWithoutImage}>
            <ImageOff className="size-3.5" strokeWidth={2.2} aria-hidden />
            Send without screenshot
          </Action>
        )}
        {error.retryable && (
          <Action onClick={onRetry}>
            <RotateCw className="size-3.5" strokeWidth={2.2} aria-hidden />
            Retry
          </Action>
        )}
        {SETTINGS_CODES.has(error.code) && (
          <Action onClick={onOpenSettings}>
            <Settings className="size-3.5" strokeWidth={2.2} aria-hidden />
            Open Settings
          </Action>
        )}
      </div>
    </motion.div>
  )
}
