import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { CSSProperties, HTMLAttributes, ReactNode } from "react"

export interface DragProps {
  setRootNode: (el: HTMLElement | null) => void
  rootStyle: CSSProperties
  setHandleNode: (el: HTMLElement | null) => void
  handleProps: HTMLAttributes<HTMLDivElement>
  /** Pointer listeners only, for a second, non-focusable handle. */
  extraHandleProps: HTMLAttributes<HTMLDivElement>
  dragging: boolean
}

interface Props {
  ids: string[]
  onMove: (activeId: string, overId: string) => void
  children: ReactNode
}

/** A vertical list whose items can be dragged by a handle (see useDragHandle). */
export function SortableList({ ids, onMove, children }: Props) {
  const sensors = useSensors(
    // A small distance keeps taps on the handle working as taps.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/** Props for an item inside SortableList: spread setRootNode/rootStyle on the item and handle* on its handle. */
export function useDragHandle(id: string): DragProps {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
  })
  return {
    setRootNode: setNodeRef,
    rootStyle: { transform: CSS.Translate.toString(transform), transition, position: "relative" },
    setHandleNode: setActivatorNodeRef,
    handleProps: { ...attributes, ...listeners },
    extraHandleProps: { ...listeners },
    dragging: isDragging,
  }
}
