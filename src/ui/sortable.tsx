import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  defaultDropAnimationSideEffects, type DragEndEvent, type DragStartEvent, type DropAnimation, type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** Lists only move up and down. */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(.2,.8,.2,1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
};

/**
 * Drag-to-reorder area (dnd-kit). Mouse: drag after a 5px move. Touch: press and hold briefly, so a
 * swipe still scrolls. Keyboard: focus the grip, Space to pick up, arrows to move, Space to drop.
 * The lifted item is drawn by `overlay`; its slot stays in the list as a gap.
 */
export function SortableArea<T>({ items, idOf, onReorder, layout, overlay, children }: {
  items: T[];
  idOf: (it: T) => string;
  onReorder: (next: T[]) => void;
  layout: 'grid' | 'list';
  overlay: (it: T) => React.ReactNode;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(idOf);
  const start = (e: DragStartEvent) => {
    setActive(String(e.active.id));
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
  };
  const end = (e: DragEndEvent) => {
    setActive(null);
    const from = ids.indexOf(String(e.active.id));
    const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
    if (from >= 0 && to >= 0 && from !== to) onReorder(arrayMove(items, from, to));
  };
  const lifted = active ? items.find((it) => idOf(it) === active) : undefined;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={start} onDragEnd={end} onDragCancel={() => setActive(null)}
      modifiers={layout === 'list' ? [vertical] : undefined}>
      <SortableContext items={ids} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
        {children}
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={dropAnimation} zIndex={60}>
          {lifted !== undefined ? <div className="dnd-lift">{overlay(lifted)}</div> : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

/**
 * One sortable item. `pointer` goes on the element you can grab (mouse / touch);
 * `grip` on the focusable handle (keyboard + screen-reader description).
 * Presses that start in a text field never start a drag.
 */
export function useSortableItem(id: string) {
  const s = useSortable({ id });
  const { onKeyDown, ...rest } = (s.listeners ?? {}) as Record<string, (e: any) => void>;
  const pointer: Record<string, (e: any) => void> = {};
  for (const [k, fn] of Object.entries(rest)) {
    pointer[k] = (e: any) => { if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return; fn(e); };
  }
  return {
    ref: s.setNodeRef,
    style: { transform: CSS.Translate.toString(s.transform), transition: s.transition } as React.CSSProperties,
    dragging: s.isDragging,
    pointer,
    grip: { ...s.attributes, onKeyDown, ref: s.setActivatorNodeRef },
  };
}
