/**
 * Saved card — pinned destinations with drag-to-reorder.
 *
 * Renders the rows held in `saved-store.ts`. Reordering uses
 * `@dnd-kit/core` + `@dnd-kit/sortable` (already a v3.0 dep). The
 * pointer sensor's `activationConstraint.distance: 6` prevents tap-
 * to-select from being interpreted as a drag — same threshold the
 * sheet's pointer-drag uses for tap-vs-drag.
 *
 * Empty state nudges the user to search + save once region + geocoder
 * land. The "Save" CTA itself lives in the Briefing card (slice 3
 * already wires the chip) and in future search-result rows
 * (slice 3d).
 */

import type { FC } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { SharedDependencies, Destination } from '@/types'

export interface SavedCardProps {
  destinations: Destination[]
  /** Fly the map to the saved destination + open Briefing. */
  onSelect?: (dest: Destination) => void
  /** Remove a saved destination by id. */
  onRemove?: (id: string) => void
  /** Persist a reorder. The implementation in `saved-store` does the
   *  index-based array-move + vault write. */
  onReorder: (fromIndex: number, toIndex: number) => void
}

export function createSavedCard(Shared: SharedDependencies) {
  const icons = Shared.lucideIcons as Record<string, FC<{ className?: string; style?: object }>>
  const { Star, GripVertical, X } = icons

  const SavedCard: FC<SavedCardProps> = ({ destinations, onSelect, onRemove, onReorder }) => {
    const sensors = useSensors(
      // 6 px pointer threshold matches the sheet's tap-vs-drag rule.
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )

    if (destinations.length === 0) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            color: 'rgb(var(--kmaps-fg-muted))',
            fontSize: 13,
          }}
        >
          {Star ? <Star className="w-4 h-4" /> : null}
          <span>No saved destinations yet</span>
        </div>
      )
    }

    const handleDragEnd = (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const fromIndex = destinations.findIndex((d) => d.id === active.id)
      const toIndex = destinations.findIndex((d) => d.id === over.id)
      if (fromIndex < 0 || toIndex < 0) return
      onReorder(fromIndex, toIndex)
    }

    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={destinations.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {destinations.map((dest) => (
              <SavedRow
                key={dest.id}
                dest={dest}
                Grip={GripVertical}
                Remove={X}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    )
  }

  return SavedCard
}

interface SavedRowProps {
  dest: Destination
  Grip?: FC<{ className?: string; style?: object }>
  Remove?: FC<{ className?: string; style?: object }>
  onSelect?: (dest: Destination) => void
  onRemove?: (id: string) => void
}

const SavedRow: FC<SavedRowProps> = ({ dest, Grip, Remove, onSelect, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dest.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: '18px 1fr 28px',
        alignItems: 'center',
        gap: 8,
        padding: '8px 6px 8px 8px',
        borderRadius: 'var(--kmaps-r-sm)',
        background: isDragging ? 'rgb(var(--kmaps-fg) / 0.05)' : 'transparent',
        // Use the `transition` shorthand (`property duration timing`),
        // NOT the `transition-property` longhand which accepts names
        // only. Concatenating with dnd-kit's own transition string;
        // skip its half (and the leading comma) when dnd-kit didn't
        // supply one — happens on rows that aren't being dragged.
        transition: style.transition
          ? `${style.transition}, background var(--kmaps-dur-base) ease`
          : 'background var(--kmaps-dur-base) ease',
      }}
    >
      <button
        type="button"
        aria-label={`Reorder ${dest.name}`}
        {...attributes}
        {...listeners}
        style={{
          width: 18,
          height: 24,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'rgb(var(--kmaps-fg-muted))',
          cursor: 'grab',
          display: 'grid',
          placeItems: 'center',
          touchAction: 'none',
        }}
      >
        {Grip ? <Grip className="w-4 h-4" /> : null}
      </button>
      <button
        type="button"
        onClick={() => onSelect?.(dest)}
        style={{
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          fontSize: 13,
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {dest.name}
      </button>
      <button
        type="button"
        onClick={() => onRemove?.(dest.id)}
        aria-label={`Remove ${dest.name}`}
        style={{
          width: 24,
          height: 24,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'rgb(var(--kmaps-fg-muted))',
          cursor: 'pointer',
          borderRadius: 'var(--kmaps-r-sm)',
          display: 'grid',
          placeItems: 'center',
          opacity: 0.7,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.7'
        }}
        onFocus={(e) => {
          e.currentTarget.style.opacity = '1'
        }}
        onBlur={(e) => {
          e.currentTarget.style.opacity = '0.7'
        }}
      >
        {Remove ? <Remove className="w-4 h-4" /> : null}
      </button>
    </li>
  )
}
