import { motion } from 'motion/react'
import { MOCK_FAIL_COMMAND } from '@shared/mock'
import { useChatStore } from '../stores/useChatStore'
import { useSettingsStore } from '../stores/useSettingsStore'
import { OrbGlyph } from './OrbGlyph'

const suggestions = [
  { label: "What's on my screen?", prompt: "What's on my screen?" },
  { label: 'What can you do?', prompt: 'What can you do?' },
  { label: 'How do I open you?', prompt: 'What is your keyboard shortcut?' },
]
/** Only meaningful with the mock provider, which fails on purpose for this prompt. */
const MOCK_ONLY = { label: 'Preview the error state', prompt: MOCK_FAIL_COMMAND }

export function EmptyState() {
  const send = useChatStore((s) => s.send)
  const setDraft = useChatStore((s) => s.setDraft)
  const status = useChatStore((s) => s.status)
  const mock = useSettingsStore((s) => s.settings?.ai.provider !== 'openai-compatible')
  const chips = mock ? [...suggestions, MOCK_ONLY] : suggestions

  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center px-6 pb-4 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <OrbGlyph status={status} size={44} glow />
      <h2 className="mt-5 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        How can I help?
      </h2>
      <p className="mt-1.5 max-w-[260px] text-[12.5px] leading-relaxed text-balance text-ink-muted">
        Ask me anything. Ask about your screen and I&apos;ll attach a screenshot for you to check
        first.
      </p>
      <ul className="mt-5 flex flex-wrap justify-center gap-1.5">
        {chips.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              onClick={() => {
                // Fill the draft first: a screen question keeps it while the screenshot is reviewed.
                setDraft(s.prompt)
                send(s.prompt)
              }}
              className="rounded-full border border-line bg-surface-raised px-3 py-1.5 text-[12px] text-ink-muted transition-colors duration-150 hover:border-line-strong hover:text-ink"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}
