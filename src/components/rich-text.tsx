'use client'

import { Fragment, useMemo, type ReactNode } from 'react'

/*
 * WhatsApp-style rich text for chat messages.
 *
 *   *bold*          _italic_          ~strikethrough~
 *   `monospace`     # H1  ## H2  ### H3      (> space required after #)
 *   - dot list      * dot list        1. numbered list   (also 1))
 *   > quoted line
 *
 * Markers are stored verbatim in the database — rendering happens here,
 * so copy/paste and search still see the original characters.
 */

// Order matters: monospace first so its contents never format further.
const INLINE = /`([^`\n]+)`|\*(\S(?:[^*\n]*?\S)?)\*|_(\S(?:[^_\n]*?\S)?)_|~(\S(?:[^~\n]*?\S)?)~/g

function Segments({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0
    if (i > last) parts.push(<Fragment key={k++}>{text.slice(last, i)}</Fragment>)
    if (m[1] !== undefined) parts.push(<code key={k++} className="rounded bg-black/10 px-1 py-px font-mono text-[13px]">{m[1]}</code>)
    else if (m[2] !== undefined) parts.push(<strong key={k++} className="font-bold">{m[2]}</strong>)
    else if (m[3] !== undefined) parts.push(<em key={k++}>{m[3]}</em>)
    else if (m[4] !== undefined) parts.push(<s key={k++}>{m[4]}</s>)
    last = i + m[0].length
  }
  if (last < text.length) parts.push(<Fragment key={k++}>{text.slice(last)}</Fragment>)
  return <>{parts}</>
}

type Block =
  | { t: 'p'; s: string }
  | { t: 'h'; lvl: number; s: string }
  | { t: 'ul'; items: string[] }
  | { t: 'ol'; items: string[] }
  | { t: 'q'; s: string }

const HEADING = /^#{1,3}\s+\S/
const BULLET = /^[-*•]\s+\S/
const NUMBERED = /^\d{1,3}[.)]\s+\S/
const QUOTE = /^>\s?\S/

function parse(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (HEADING.test(line)) {
      const lvl = line.match(/^#+/)?.[0].length ?? 1
      blocks.push({ t: 'h', lvl, s: line.replace(/^#+\s+/, '') })
    } else if (QUOTE.test(line)) {
      blocks.push({ t: 'q', s: line.replace(/^>\s?/, '') })
    } else if (BULLET.test(line)) {
      const s = line.replace(/^[-*•]\s+/, '')
      const prev = blocks[blocks.length - 1]
      if (prev?.t === 'ul') prev.items.push(s)
      else blocks.push({ t: 'ul', items: [s] })
    } else if (NUMBERED.test(line)) {
      const s = line.replace(/^\d{1,3}[.)]\s+/, '')
      const prev = blocks[blocks.length - 1]
      if (prev?.t === 'ol') prev.items.push(s)
      else blocks.push({ t: 'ol', items: [s] })
    } else {
      const prev = blocks[blocks.length - 1]
      if (prev?.t === 'p') prev.s += `\n${line}`
      else blocks.push({ t: 'p', s: line })
    }
  }
  return blocks
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parse(text), [text])
  return (
    <div className={`text-left [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.t === 'h') {
          return (
            <p key={i} className={`mt-1.5 mb-0.5 whitespace-pre-wrap font-extrabold leading-snug ${b.lvl === 1 ? 'text-[19px]' : b.lvl === 2 ? 'text-[17px]' : 'text-[15px]'}`}>
              <Segments text={b.s} />
            </p>
          )
        }
        if (b.t === 'ul') {
          return (
            <div key={i} className="my-0.5">
              {b.items.map((it, j) => (
                <div key={j} className="flex gap-2 pl-0.5">
                  <span aria-hidden className="select-none">•</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap"><Segments text={it} /></span>
                </div>
              ))}
            </div>
          )
        }
        if (b.t === 'ol') {
          return (
            <div key={i} className="my-0.5">
              {b.items.map((it, j) => (
                <div key={j} className="flex gap-2 pl-0.5">
                  <span className="select-none tabular-nums">{j + 1}.</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap"><Segments text={it} /></span>
                </div>
              ))}
            </div>
          )
        }
        if (b.t === 'q') {
          return (
            <div key={i} className="my-0.5 whitespace-pre-wrap border-l-[3px] border-current pl-2 opacity-75"><Segments text={b.s} /></div>
          )
        }
        return <p key={i} className="my-0.5 whitespace-pre-wrap"><Segments text={b.s} /></p>
      })}
    </div>
  )
}
