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
