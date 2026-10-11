import React from 'react'
import { parseMarkdownLite, type Inline } from './markdown-lite'

function renderInline(parts: Inline[]) {
  return parts.map((p, i) => {
    if (p.kind === 'bold') return <strong key={i} className="font-semibold">{p.text}</strong>
    if (p.kind === 'code')
      return (
        <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-800">
          {p.text}
        </code>
      )
    return <React.Fragment key={i}>{p.text}</React.Fragment>
  })
}

/** Renders assistant text via typed nodes only — never HTML. */
export default function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdownLite(text)
  return (
    <div className="space-y-2 break-words">
      {blocks.map((b, i) => {
        if (b.kind === 'ul')
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ul>
          )
        if (b.kind === 'ol')
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
            </ol>
          )
        return <p key={i} className="whitespace-pre-wrap">{renderInline(b.inline)}</p>
      })}
    </div>
  )
}
