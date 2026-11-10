export type HoldGesture = 'pointerdown' | 'pointerup' | 'pointercancel' | 'pointerleave' | 'touchend' | 'contextmenu'

/** A long-press callout cancels the pointer. That is not the finger lifting. */
export function shouldEndHold(kind: HoldGesture): boolean {
  return kind === 'pointerup' || kind === 'touchend'
}

export function reduceHold(holding: boolean, kind: HoldGesture): boolean {
  if (kind === 'pointerdown') return true
  if (shouldEndHold(kind)) return false
  return holding
}
