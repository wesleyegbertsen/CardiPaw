export interface TouchPoint {
  clientX: number;
  clientY: number;
}

/**
 * Builds a bubbling touch event with the fields touch handlers read. happy-dom has no
 * Touch constructor and Event.timeStamp is read-only, so they are defined by hand.
 * Every finger in `points` is listed in `changedTouches`; `touches` lists them too,
 * except on touchend and touchcancel, where the fingers have left the screen.
 */
export function touchEvent(type: string, points: TouchPoint[], timeStamp = 0): Event {
  const lifted = type === 'touchend' || type === 'touchcancel';
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    touches: { value: lifted ? [] : points },
    changedTouches: { value: points },
    timeStamp: { value: timeStamp },
  });
  return event;
}
