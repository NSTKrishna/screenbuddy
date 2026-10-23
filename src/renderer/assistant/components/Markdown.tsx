import { memo, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({ children, text }: { children: ReactNode; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group/code relative my-2">
      <pre className="thin-scrollbar overflow-x-auto rounded-lg border border-line bg-black/35 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
        {children}
      </pre>
      <button
        type="button"
        aria-label={copied ? 'Copied' : 'Copy code'}
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-md bg-white/5 text-ink-faint opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children)
  }
  return ''
}

/**
 * Model output is untrusted (SECURITY.md §6). Raw HTML is skipped, images are
 * never loaded (they could leak data through their URLs), and links show
 * their real address but don't navigate. Commands appear as inert code
 * blocks with a copy button.
 */
const components: Components = {
  a: ({ children, href }) => (
    <span className="text-aurora-1" title={href}>
      {children}
      {href !== undefined && textOf(children) !== href && (
        <span className="text-ink-faint"> ({href})</span>
      )}
    </span>
  ),
  img: ({ alt }) => <span className="text-ink-faint">[image{alt ? `: ${alt}` : ''}]</span>,
  pre: ({ children }) => <CodeBlock text={textOf(children)}>{children}</CodeBlock>,
  code: ({ children, className }) =>
    className === undefined ? (
      <code className="rounded bg-white/[0.08] px-1 py-px font-mono text-[12px]">{children}</code>
    ) : (
      <code className={className}>{children}</code>
    ),
  p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
  // Keep `start`: a list interrupted by a code block continues at 3, not 1.
  ol: ({ children, start }) => (
    <ol start={start} className="my-1.5 list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold text-ink">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold text-ink">{children}</p>,
  h3: ({ children }) => <p className="mt-2 mb-1 font-semibold text-ink">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-ink-muted">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="thin-scrollbar my-2 overflow-x-auto">
      <table className="text-[12.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-line-strong px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-line px-2 py-1 align-top">{children}</td>,
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
      {text}
    </ReactMarkdown>
  )
})
