import type { TankIndex } from "../simulation/types";

export interface ScreenPoint { x: number; y: number }
export interface CounterweightProjection {
  center: ScreenPoint;
  railStart: ScreenPoint;
  railEnd: ScreenPoint;
  threshold: number;
  thresholdAtFraction(fraction: number): number;
}
export type ThresholdChange = (index: TankIndex, threshold: number) => void;

/** Shared pointer/keyboard target for both the WebGL and SVG counterweights. */
export function createCounterweightControls(host: HTMLElement, onChange?: ThresholdChange) {
  const projections: Array<CounterweightProjection | undefined> = [];
  const cleanups: Array<() => void> = [];
  const handles = ([0, 1] as const).map(index => {
    const handle = document.createElement("div");
    handle.id = `counterweight-handle-${index}`;
    handle.className = "counterweight-handle";
    handle.tabIndex = onChange ? 0 : -1;
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", `Reservoir ${index ? "B" : "A"} counterweight`);
    handle.setAttribute("aria-orientation", "horizontal");
    handle.setAttribute("aria-valuemin", "0.55");
    handle.setAttribute("aria-valuemax", "1.65");
    handle.setAttribute("aria-disabled", String(!onChange));
    handle.title = "Drag the counterweight, or use the arrow keys";
    host.append(handle);
    let dragging = false;
    let grabOffset = {x:0,y:0};
    const change = (value: number) => onChange?.(index, Math.round(Math.max(0.55, Math.min(1.65, value)) * 1000) / 1000);
    const pointerdown = (event: PointerEvent) => {
      if (!onChange || (event.pointerType === "mouse" && event.button !== 0)) return;
      const projection = projections[index]; if (!projection) return;
      const hostRect = host.getBoundingClientRect();
      grabOffset = {x:event.clientX - hostRect.left - projection.center.x, y:event.clientY - hostRect.top - projection.center.y};
      dragging = true;
      handle.dataset.dragging = "true";
      handle.setPointerCapture(event.pointerId);
      handle.focus({preventScroll:true});
      event.preventDefault();
    };
    const pointermove = (event: PointerEvent) => {
      if (!dragging) return;
      const projection = projections[index]; if (!projection) return;
      const hostRect = host.getBoundingClientRect();
      const px = event.clientX - hostRect.left - grabOffset.x;
      const py = event.clientY - hostRect.top - grabOffset.y;
      const dx = projection.railEnd.x - projection.railStart.x;
      const dy = projection.railEnd.y - projection.railStart.y;
      const fraction = ((px - projection.railStart.x) * dx + (py - projection.railStart.y) * dy) / (dx * dx + dy * dy);
      change(projection.thresholdAtFraction(Math.max(0, Math.min(1, fraction))));
      event.preventDefault();
    };
    const pointerup = (event: PointerEvent) => {
      dragging = false; delete handle.dataset.dragging;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const keydown = (event: KeyboardEvent) => {
      const value = projections[index]?.threshold; if (value === undefined || !onChange) return;
      const step = event.shiftKey ? 0.1 : 0.01;
      const next = event.key === "Home" ? 0.55 : event.key === "End" ? 1.65
        : ["ArrowRight", "ArrowUp"].includes(event.key) ? value + step
        : ["ArrowLeft", "ArrowDown"].includes(event.key) ? value - step : undefined;
      if (next === undefined) return;
      event.preventDefault(); change(next);
    };
    handle.addEventListener("pointerdown", pointerdown);
    handle.addEventListener("pointermove", pointermove);
    handle.addEventListener("pointerup", pointerup);
    handle.addEventListener("pointercancel", pointerup);
    handle.addEventListener("lostpointercapture", pointerup);
    handle.addEventListener("keydown", keydown);
    cleanups.push(() => {
      handle.removeEventListener("pointerdown", pointerdown); handle.removeEventListener("pointermove", pointermove);
      handle.removeEventListener("pointerup", pointerup); handle.removeEventListener("pointercancel", pointerup);
      handle.removeEventListener("lostpointercapture", pointerup); handle.removeEventListener("keydown", keydown);
      handle.remove();
    });
    return handle;
  });
  return {
    update(index: TankIndex, projection: CounterweightProjection) {
      projections[index] = projection;
      const handle = handles[index];
      handle.style.left = `${projection.center.x}px`; handle.style.top = `${projection.center.y}px`;
      handle.setAttribute("aria-valuenow", projection.threshold.toFixed(3));
      handle.setAttribute("aria-valuetext", `Tipping threshold ${projection.threshold.toFixed(2)}`);
    },
    setHidden(hidden: boolean) { handles.forEach(handle => {handle.hidden = hidden;}); },
    dispose() { cleanups.forEach(cleanup => cleanup()); },
  };
}
