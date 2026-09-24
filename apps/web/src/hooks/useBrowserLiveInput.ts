import {
  useCallback,
  useEffect,
  useRef,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { useIsMac } from '@/context/useHotkeys';
import {
  clickCount,
  heldButton,
  keyMessage,
  modifiers,
  mouseButton,
  pagePoint,
  textMessages,
  wheelDelta,
  type LiveMessage,
  type Point,
  type Press,
  type Rect,
  type Size,
} from '@/utils/browserLive';

// Where the frame on screen is drawn in the view (rect, CSS pixels from the view's top left
// corner) and its size in the CSS pixels input is given in (page).
export interface LiveGeometry {
  rect: Rect;
  page: Size;
}

// A touch that moves less than this is a tap.
const TAP_DISTANCE = 8;

// Events on a page's dialog shown over the view are for the dialog, not for the page.
function inDialog(target: EventTarget | null) {
  return target instanceof Element && target.closest('[data-live-dialog]') !== null;
}

interface Touch {
  id: number;
  at: Point;
  start: Point;
  last: Point;
  moved: boolean;
}

// The live view's input. The mouse and the wheel act on the page under the pointer; a touch
// scrolls the page, or clicks when it does not move. The keyboard, pastes and IME text come
// from the hidden text field that a press into the view focuses, so they reach the page
// only while the view has the focus.
//
// A point is mapped against the frame actually drawn (its rect, bands beside it ignored) and
// the size of that very frame, not the size the view asked for.
export function useBrowserLiveInput(
  view: RefObject<HTMLDivElement | null>,
  keyboard: RefObject<HTMLTextAreaElement | null>,
  geometry: RefObject<LiveGeometry | null>,
  send: (message: LiveMessage) => void,
) {
  const mac = useIsMac();
  const lastPress = useRef<Press | null>(null);
  const touch = useRef<Touch | null>(null);

  const pointAt = useCallback(
    (event: { clientX: number; clientY: number }): Point | null => {
      const drawn = geometry.current;
      const box = view.current?.getBoundingClientRect();
      if (!drawn?.page.width || !drawn.page.height || !drawn.rect.width || !box) return null;
      return pagePoint(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        drawn.rect,
        drawn.page,
      );
    },
    [geometry, view],
  );

  useEffect(() => {
    const element = view.current;
    if (!element) return;
    // React registers wheel listeners as passive, which cannot keep the panel from scrolling.
    const onWheel = (event: WheelEvent) => {
      if (inDialog(event.target)) return;
      event.preventDefault();
      const at = pointAt(event);
      if (!at) return;
      const delta = wheelDelta(event, geometry.current?.page.height ?? 0);
      send({ type: 'wheel', ...at, ...delta, modifiers: modifiers(event, mac) });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [geometry, mac, pointAt, send, view]);

  const pointer = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      event.preventDefault();
      const at = pointAt(event);
      if (event.pointerType === 'touch') {
        const client = { x: event.clientX, y: event.clientY };
        touch.current = at && {
          id: event.pointerId,
          at,
          start: client,
          last: client,
          moved: false,
        };
        return;
      }
      keyboard.current?.focus({ preventScroll: true });
      if (!at) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const press = { ...at, time: event.timeStamp, button: event.button };
      const count = clickCount(lastPress.current, press);
      lastPress.current = { ...press, count };
      send({
        type: 'mouse',
        event: 'down',
        ...at,
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: count,
        modifiers: modifiers(event, mac),
      });
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = touch.current;
      if (event.pointerType === 'touch') {
        if (current?.id !== event.pointerId) return;
        const client = { x: event.clientX, y: event.clientY };
        const deltaX = current.last.x - client.x;
        const deltaY = current.last.y - client.y;
        current.last = client;
        current.moved ||=
          Math.hypot(client.x - current.start.x, client.y - current.start.y) >= TAP_DISTANCE;
        if (current.moved) send({ type: 'wheel', ...current.at, deltaX, deltaY, modifiers: 0 });
        return;
      }
      const at = pointAt(event);
      if (!at) return;
      send({
        type: 'mouse',
        event: 'move',
        ...at,
        button: heldButton(event.buttons),
        buttons: event.buttons,
        modifiers: modifiers(event, mac),
      });
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (event.pointerType === 'touch') {
        const current = touch.current;
        touch.current = null;
        if (current?.id === event.pointerId && !current.moved) {
          // Focusing on a tap rather than on every touch keeps a phone's keyboard closed
          // while the page is scrolled.
          keyboard.current?.focus({ preventScroll: true });
          send({ type: 'mouse', event: 'click', ...current.at, button: 'left', modifiers: 0 });
        }
        return;
      }
      const at = pointAt(event);
      if (!at) return;
      send({
        type: 'mouse',
        event: 'up',
        ...at,
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: lastPress.current?.count ?? 1,
        modifiers: modifiers(event, mac),
      });
    },
    onPointerCancel() {
      touch.current = null;
    },
    onContextMenu(event: MouseEvent<HTMLDivElement>) {
      if (!inDialog(event.target)) event.preventDefault();
    },
  };

  const onKey = (type: 'down' | 'up') => (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const message = keyMessage(
      {
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        location: event.location,
        repeat: event.repeat,
        isComposing: event.nativeEvent.isComposing,
        altGraph: event.getModifierState('AltGraph'),
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      type,
      mac,
    );
    if (!message) return;
    // Plan's own shortcuts listen on the window; a key meant for the page must not reach them.
    event.preventDefault();
    event.stopPropagation();
    send(message);
  };

  const sendText = (text: string) => textMessages(text).forEach(send);

  const keys = {
    onKeyDown: onKey('down'),
    onKeyUp: onKey('up'),
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      event.preventDefault();
      sendText(event.clipboardData.getData('text/plain'));
    },
    onCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
      sendText(event.data);
      event.currentTarget.value = '';
    },
    // Text a keyboard types without key events of its own, such as a phone's.
    onInput(event: FormEvent<HTMLTextAreaElement>) {
      if ((event.nativeEvent as InputEvent).isComposing) return;
      const text = event.currentTarget.value;
      event.currentTarget.value = '';
      sendText(text);
    },
  };

  return { pointer, keys };
}
