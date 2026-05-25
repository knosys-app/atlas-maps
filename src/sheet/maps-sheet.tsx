/**
 * Bottom sheet — peek / half / full detents with draggable handle.
 *
 * Ported verbatim from `/tmp/flight-planner/src/components/sheet/
 * flight-sheet.tsx` with the `.kfp-` → `.kmaps-` scope rename and the
 * aviation tab set replaced with maps tabs (Steps + Profile, the
 * latter a placeholder for v3.1+ elevation chart). The detent state
 * machine, pointer-drag math, keyboard shortcuts, and tap-to-cycle
 * behaviour are unchanged — the kmaps stylesheet's `[data-detent]`
 * + `[data-dragging]` selectors expect the same attribute contract.
 *
 * The sheet is a controlled component: `detent` and `tab` live in the
 * caller (MapsPage) so the same instance can be programmatically
 * opened (e.g. on route preview → expand to half to show Steps). The
 * caller renders each tab's body as a slot prop.
 */

import { useEffect, useRef, useState } from 'react'
import type { FC, PointerEvent as ReactPointerEvent, ReactNode } from 'react'

export type SheetDetent = 'peek' | 'half' | 'full'

/** Tab identifiers. The string values match the `<button data-active>`
 *  contract in the rendered output; rename with care. */
export type SheetTab = 'steps' | 'profile'

export interface MapsSheetProps {
  detent: SheetDetent
  onDetentChange: (next: SheetDetent) => void
  tab: SheetTab
  onTabChange: (next: SheetTab) => void
  /** Steps tab body — list of turn-by-turn maneuvers. */
  steps: ReactNode
  /** Profile tab body — elevation chart placeholder for v3.0. */
  profile: ReactNode
}

const CYCLE: SheetDetent[] = ['peek', 'half', 'full']

/** Pixel height for a detent given current viewport. Matches the CSS
 *  rule (`height: 28px / 45vh / 90vh`) — kept here in JS so the
 *  pointer-drag snap logic can compare against actual pixel heights. */
function detentPx(d: SheetDetent): number {
  switch (d) {
    case 'peek':
      return 28
    case 'half':
      return Math.round(window.innerHeight * 0.45)
    case 'full':
      return Math.round(window.innerHeight * 0.9)
  }
}

/** Snap a free-dragged pixel height to the nearest detent. */
function snap(px: number): SheetDetent {
  const peek = detentPx('peek')
  const half = detentPx('half')
  const full = detentPx('full')
  const dPeek = Math.abs(px - peek)
  const dHalf = Math.abs(px - half)
  const dFull = Math.abs(px - full)
  const min = Math.min(dPeek, dHalf, dFull)
  if (min === dPeek) return 'peek'
  if (min === dFull) return 'full'
  return 'half'
}

function nextDetent(d: SheetDetent, dir: 1 | -1): SheetDetent {
  const i = CYCLE.indexOf(d)
  const n = Math.max(0, Math.min(CYCLE.length - 1, i + dir))
  return CYCLE[n]
}

interface DragState {
  startY: number
  startHeight: number
  currentHeight: number
}

/** Pixels of movement below which a pointer-up is treated as a tap
 *  rather than a snap-to-nearest-detent. */
const TAP_THRESHOLD = 6

export const MapsSheet: FC<MapsSheetProps> = ({
  detent,
  onDetentChange,
  tab,
  onTabChange,
  steps,
  profile,
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  // Cmd/Ctrl + Arrow Up/Down cycles detents without grabbing the handle.
  // Same shortcut flight-planner uses; consistent across the apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        onDetentChange(nextDetent(detent, 1))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        onDetentChange(nextDetent(detent, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detent, onDetentChange])

  const cycleUp = () => {
    const idx = CYCLE.indexOf(detent)
    onDetentChange(CYCLE[(idx + 1) % CYCLE.length])
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = sheetRef.current
    if (!sheet) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startHeight = sheet.getBoundingClientRect().height
    dragRef.current = {
      startY: e.clientY,
      startHeight,
      currentHeight: startHeight,
    }
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (!st) return
    // Up-drag shrinks distance to top → grows sheet height.
    const delta = st.startY - e.clientY
    const min = detentPx('peek')
    const max = Math.round(window.innerHeight * 0.95)
    const next = Math.max(min, Math.min(max, st.startHeight + delta))
    st.currentHeight = next
    setDragHeight(next)
  }

  const finishDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (!st) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Pointer may have already been released (cancellation path).
    }
    const moved = Math.abs(st.startY - e.clientY)
    dragRef.current = null
    setDragging(false)
    setDragHeight(null)
    if (moved < TAP_THRESHOLD) {
      cycleUp()
    } else {
      onDetentChange(snap(st.currentHeight))
    }
  }

  const tabs: Array<{ id: SheetTab; label: string }> = [
    { id: 'steps', label: 'Steps' },
    { id: 'profile', label: 'Profile' },
  ]

  const sheetStyle =
    dragHeight != null ? { height: `${dragHeight}px` } : undefined

  // Hide the tab bar + body when collapsed to peek — except during a
  // drag past ~80 px height where we want the user to see the body
  // sliding into view in real time. Matches FlightSheet's behaviour.
  const bodyVisible = detent !== 'peek' || (dragHeight ?? 0) > 80

  return (
    <div
      ref={sheetRef}
      className="kmaps-sheet kmaps-surface-thick"
      data-detent={detent}
      data-dragging={dragging ? 'true' : 'false'}
      style={sheetStyle}
    >
      <div
        className="kmaps-sheet-handle"
        role="button"
        tabIndex={0}
        aria-label={`Sheet detent ${detent}. Drag or click to resize.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            cycleUp()
          }
        }}
      />
      {bodyVisible ? (
        <>
          <div className="kmaps-sheet-tabs" role="tablist" aria-label="Sheet tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className="kmaps-sheet-tab"
                data-active={tab === t.id ? 'true' : 'false'}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="kmaps-sheet-body">
            {tab === 'steps' ? steps : null}
            {tab === 'profile' ? profile : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
