/**
 * Markdown-lite for assistant replies: paragraphs, bullet / numbered lists,
 * **bold** and `inline code`. Returns a typed tree (never HTML) so the
 * renderer can only emit React text nodes — no injection surface.
 */

export type Inline = { kind: 'text' | 'bold' | 'code'; text: string }
export type Block =
  | { kind: 'p'; inline: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'ol'; items: Inline[][] }

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) })
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] })
    else out.push({ kind: 'code', text: m[2] ?? '' })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
  return out
}

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

export function parseMarkdownLite(src: string): Block[] {
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', inline: parseInline(para.join('\n')) })
    para = []
  }

  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      flushPara()
      const kind = bullet ? 'ul' : 'ol'
      const item = parseInline((bullet ?? numbered)![1] ?? '')
      const prev = blocks[blocks.length - 1]
      if (prev && prev.kind === kind) prev.items.push(item)
      else blocks.push({ kind, items: [item] })
    } else if (line.trim() === '') {
      flushPara()
    } else {
      para.push(line)
    }
  }
  flushPara()
  return blocks
}
