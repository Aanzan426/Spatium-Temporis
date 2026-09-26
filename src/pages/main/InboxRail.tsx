/**
 * Undated capture. The most important component in the app.
 *
 * One keystroke from anywhere, a text field, enter, done. It lands with span = null.
 * Drag it onto the timeline when it earns a date.
 *
 * IT MUST NEVER ASK FOR A CATEGORY, TYPE, PROJECT OR DATE BEFORE ACCEPTING INPUT (§5.1).
 * The whole project is downstream of how fast a thought gets out of a head and onto a
 * screen. Every field added to this form is a reason to stop using the app.
 *
 * So there is exactly one input and no other control. Not a type picker that defaults
 * to "none", not a collapsed "details" panel — those still cost a glance and a decision.
 * If classification is wanted later it happens later, on a node that already exists.
 *
 * The global hotkey is part of the same requirement: `/` from anywhere focuses the box.
 * A capture that needs a mouse trip has already lost several seconds of the number in
 * §1.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useStore } from '../../store/useStore'
import type { Node } from '../../core/types'

export interface InboxRailProps {
  /** Dropping an inbox item onto the timeline is how it earns a date. */
  onDragNode?: (node: Node) => void
  selectedId?: string | null
  onSelect?: (node: Node) => void
}

export function InboxRail({ onDragNode, selectedId, onSelect }: InboxRailProps) {
  const store = useStore()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const items = useQuery((s) => s.undated())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && /^(INPUT|TEXTAREA)$/.test(target.tagName)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const capture = () => {
    const title = text.trim()
    if (!title) return
    // A title and a timestamp is a valid node. No type, no span, no questions (§5.1).
    store.createNode({ title })
    setText('')
  }

  return (
    <aside className="inbox">
      <header className="inbox-head">
        <h2>Inbox</h2>
        <span className="hint">press /</span>
      </header>

      <input
        ref={inputRef}
        className="inbox-input"
        value={text}
        placeholder="a thought…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') capture()
          if (e.key === 'Escape') {
            setText('')
            inputRef.current?.blur()
          }
        }}
      />

      <ul className="inbox-list">
        {items.map((node) => (
          <li
            key={node.id}
            className={`inbox-item${selectedId === node.id ? ' selected' : ''}`}
            draggable
            onDragStart={(e) => {
              // The payload is the id; the drop target resolves it against the store.
              // Dragging a serialized node would let a stale copy be written back.
              e.dataTransfer.setData('text/plain', node.id)
              e.dataTransfer.effectAllowed = 'move'
              onDragNode?.(node)
            }}
            onClick={() => onSelect?.(node)}
            title={node.title}
          >
            {node.title}
          </li>
        ))}
        {items.length === 0 && <li className="empty">nothing waiting</li>}
      </ul>
    </aside>
  )
}
