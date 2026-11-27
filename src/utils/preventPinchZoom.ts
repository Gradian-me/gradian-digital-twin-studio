/**
 * Guards a 3D canvas or overlay container against browser-level trackpad pinch-to-zoom
 * (which fires `wheel` with `ctrlKey: true` on macOS/Windows Chromium/Firefox, and
 * `gesturestart`/`gesturechange` on WebKit/Safari) so two-finger trackpad gestures
 * zoom ONLY the 3D scene/object instead of scaling the entire web application.
 */
export function attachCanvasPinchGuard(
  el: HTMLElement | null,
  onPinchZoom?: (deltaY: number) => void
): () => void {
  if (!el) return () => {};

  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      onPinchZoom?.(e.deltaY);
    }
  };

  let lastScale = 1;
  const onGestureStart = (e: Event) => {
    e.preventDefault();
    lastScale = (e as unknown as { scale?: number }).scale ?? 1;
  };
  const onGestureChange = (e: Event) => {
    e.preventDefault();
    const scale = (e as unknown as { scale?: number }).scale ?? 1;
    const delta = (lastScale - scale) * 140;
    lastScale = scale;
    if (Math.abs(delta) > 0.01) {
      onPinchZoom?.(delta);
    }
  };
  const onGestureEnd = (e: Event) => {
    e.preventDefault();
  };

  // Use capture phase so we prevent page zoom even if OrbitControls or a nested element receives the event first
  el.addEventListener('wheel', onWheel, { passive: false, capture: true });
  el.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
  el.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions);
  el.addEventListener('gestureend', onGestureEnd, { passive: false } as AddEventListenerOptions);

  return () => {
    el.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
    el.removeEventListener('gesturestart', onGestureStart);
    el.removeEventListener('gesturechange', onGestureChange);
    el.removeEventListener('gestureend', onGestureEnd);
  };
}
