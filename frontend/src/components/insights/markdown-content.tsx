"use client"

import type { Components } from "react-markdown"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

const components: Components = {
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="my-1 pl-5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 pl-5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => <h3 className="font-semibold mt-2 mb-1">{children}</h3>,
  h2: ({ children }) => <h4 className="font-semibold mt-2 mb-1">{children}</h4>,
  h3: ({ children }) => <h5 className="font-semibold mt-1.5 mb-0.5">{children}</h5>,
  code: ({ children }) => (
    <code className="rounded bg-[rgba(128,128,128,0.15)] px-1 py-0.5 text-[0.85em]">
      {children}
    </code>
  ),
  hr: () => <hr className="my-2 border-[var(--border)]" />,
  a: ({ children }) => <span className="underline">{children}</span>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--muted)]">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-[var(--border)]">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="transition-colors hover:bg-[var(--muted)]/50">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium text-[var(--muted-foreground)] whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 whitespace-nowrap">{children}</td>
  ),
}

export function MarkdownContent({
  children,
  className = "",
}: {
  children: string
  className?: string
}) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  )
}
