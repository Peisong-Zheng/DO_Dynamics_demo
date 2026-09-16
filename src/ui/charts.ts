import type {
  DrainEvent,
  PulseEvent,
  Phase,
  SimulationView,
} from "../simulation/types";
import { TILT_ANGLE } from "../simulation/types";
import { rimCapacity } from "../simulation/chamber";

interface Sample {
  t: number;
  h: [number, number];
  H: [number, number];
  eq: [number, number];
  drainEq: [number, number];
  reset: [number, number];
  phase: [Phase, Phase];
}

// Fixed-capacity history. Recording is driven by physics, never by display FPS.
export class History {
  private readonly buffer: (Sample | undefined)[] = new Array(1800);
  private cursor = 0;
  private size = 0;
  private ticks = 0;
  private phases = "";
  private manual = 0;
  clear(view: SimulationView) {
    this.cursor = this.size = this.ticks = 0;
    this.phases = "";
    this.manual = 0;
    this.record(view, true);
  }
  record(view: SimulationView, force = false) {
    const phase = view.tanks.map((t) => t.phase).join();
    const manual = view.tanks.reduce((s, t) => s + t.ledger.manual, 0);
    if (
      !force &&
      ++this.ticks % 10 !== 0 &&
      phase === this.phases &&
      manual === this.manual
    )
      return;
    this.phases = phase;
    this.manual = manual;
    const pair = (fn: (i: 0 | 1) => number): [number, number] => [fn(0), fn(1)];
    this.buffer[this.cursor] = {
      t: view.time,
      h: pair((i) => view.tanks[i].h),
      H: pair((i) => view.tanks[i].params.H),
      eq: pair((i) => view.tanks[i].params.r / view.tanks[i].params.k),
      drainEq: pair((i) => {
        const p = view.tanks[i].params;
        return Math.min(p.r / (p.k + p.kappa), rimCapacity(TILT_ANGLE));
      }),
      reset: pair((i) => view.tanks[i].params.hReset),
      phase: [view.tanks[0].phase, view.tanks[1].phase],
    };
    this.cursor = (this.cursor + 1) % this.buffer.length;
    this.size = Math.min(this.size + 1, this.buffer.length);
  }
  values(): Sample[] {
    const values: Sample[] = [];
    for (let i = 0; i < this.size; i++)
      values.push(
        this.buffer[
          (this.cursor - this.size + i + this.buffer.length) %
            this.buffer.length
        ]!,
      );
    return values;
  }
}

const TICK_SECONDS = 15;
const COLORS = {
  water: ["#1f7a76", "#4a7fa5"],
  threshold: "#a15446",
  equilibrium: "#8a9185",
  event: "#2f3438",
  pulse: "#6b5bb0",
  grid: "#e7e8ea",
  minorGrid: "#f0f1f2",
  label: "#6b7076",
  shade: "#9aa1a826",
  shadeEdge: "#9aa1a866",
};

/** A tidy axis step: at most five divisions, from a short list of round values. */
function niceStep(largest: number): number {
  return [0.1, 0.2, 0.25, 0.5, 1].find((step) => largest / step <= 5) ?? 1;
}
const compact = (value: number) => String(Number(value.toFixed(3)));

export function createCharts(
  canvases: [HTMLCanvasElement, HTMLCanvasElement],
  history: History,
) {
  const contexts = canvases.map((c) => c.getContext("2d")!);
  const hover: Array<number | null> = [null, null];
  const areas: Array<{ minT: number; maxT: number; left: number; right: number } | undefined> = [];
  const cleanups: Array<() => void> = [];
  let latest = { time: 0, events: [] as DrainEvent[], pulses: [] as PulseEvent[] };
  const observer = new ResizeObserver(() =>
    canvases.forEach((c) => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    }),
  );
  canvases.forEach((c) => observer.observe(c));
  canvases.forEach((canvas, index) => {
    canvas.style.cursor = "crosshair";
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = (event.clientX - rect.left) * (canvas.clientWidth / Math.max(1, rect.width));
      const area = areas[index];
      hover[index] = area
        ? Math.max(0, Math.min(1, (px - area.left) / Math.max(1, area.right - area.left)))
        : null;
      render();
    };
    const onLeave = (event: PointerEvent) => {
      if (event.type !== "pointerleave" && event.pointerType === "mouse") return;
      hover[index] = null;
      render();
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", onLeave);
    cleanups.push(() => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup", onLeave);
    });
  });

  function render() {
    const { time, events, pulses } = latest;
    const minT = Math.max(0, time - 60);
    const maxT = Math.max(60, time);
    const all = history.values();
    const first = Math.max(0, all.findIndex((s) => s.t >= minT) - 1);
    const samples = all.slice(first);
    // Both plots share one scale, fitted to their historical parameters as well
    // as water, so the two resting branches remain readable by default.
    const largest = samples.reduce((maximum, sample) =>
      Math.max(maximum, ...sample.h, ...sample.H, ...sample.eq, ...sample.drainEq), 1);
    const step = niceStep(largest);
    const upper = Math.max(step, Math.ceil((largest + .01) / step) * step);
    contexts.forEach((ctx, index) => {
      if (!ctx) return;
      const canvas = canvases[index];
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h) return;
      ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const left = 33,
        right = w - 12,
        top = 17,
        bottom = h - 30;
      const x = (t: number) =>
        left + ((t - minT) / (maxT - minT)) * (right - left);
      const y = (v: number) => bottom - (v / upper) * (bottom - top);
      areas[index] = { minT, maxT, left, right };
      ctx.font = "10px ui-monospace, monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "right";
      for (let i = 0; i * step <= upper + 1e-9; i++) {
        const level = i * step;
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(left, y(level));
        ctx.lineTo(right, y(level));
        ctx.stroke();
        ctx.fillStyle = COLORS.label;
        ctx.fillText(compact(level), left - 7, y(level));
      }
      ctx.textAlign = "center";
      for (let t = Math.ceil(minT / TICK_SECONDS) * TICK_SECONDS; t <= maxT + 1e-9; t += TICK_SECONDS) {
        ctx.strokeStyle = COLORS.minorGrid;
        ctx.beginPath();
        ctx.moveTo(x(t), top);
        ctx.lineTo(x(t), bottom);
        ctx.stroke();
        ctx.fillStyle = COLORS.label;
        ctx.fillText(t.toFixed(0), x(t), bottom + 14);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, right - left, bottom - top);
      ctx.clip();
      const line = (
        key: "h" | "H" | "eq" | "drainEq" | "reset",
        color: string,
        dash: number[],
        width: number,
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let connected = false;
        samples.forEach((s) => {
          // A pouring equilibrium is only a resting state when it lies above the
          // return threshold. Preserve validity at each old time.
          if (key === "drainEq" && s.drainEq[index] <= s.reset[index]) {
            connected = false;
            return;
          }
          if (connected) ctx.lineTo(x(s.t), y(s[key][index]));
          else ctx.moveTo(x(s.t), y(s[key][index]));
          connected = true;
        });
        ctx.stroke();
      };
      if (samples.length) {
        ctx.fillStyle = COLORS.shade;
        samples.forEach((sample, j) => {
          if (sample.phase[index] === "FILL") return;
          const end = samples[j + 1]?.t ?? time;
          ctx.fillRect(x(sample.t), top, Math.max(1, x(end) - x(sample.t)), bottom - top);
        });
        ctx.strokeStyle = COLORS.shadeEdge;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        samples.forEach((sample, j) => {
          if (sample.phase[index] === "FILL" || samples[j - 1]?.phase[index] === "FILL") return;
          ctx.beginPath();
          ctx.moveTo(x(sample.t), top);
          ctx.lineTo(x(sample.t), bottom);
          ctx.stroke();
        });
        ctx.beginPath();
        ctx.moveTo(x(samples[0].t), bottom);
        samples.forEach((s) => ctx.lineTo(x(s.t), y(s.h[index])));
        ctx.lineTo(x(samples[samples.length - 1].t), bottom);
        ctx.closePath();
        ctx.fillStyle = index === 0 ? "#1f7a760c" : "#4a7fa50d";
        ctx.fill();
      }
      line("eq", COLORS.equilibrium, [1.5, 3.5], 1.25);
      line("drainEq", COLORS.equilibrium, [6, 3.5], 1.25);
      line("H", COLORS.threshold, [6, 4], 1.4);
      line("reset", COLORS.threshold, [3, 4], .85);
      line("h", COLORS.water[index], [], 2);
      ctx.setLineDash([]);
      events
        .filter((e) => e.tank === index && e.time >= minT)
        .forEach((e) => {
          ctx.strokeStyle = COLORS.event;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x(e.time), y(e.h));
          ctx.lineTo(x(e.time), y(e.h) - 9);
          ctx.stroke();
          ctx.fillStyle = COLORS.event;
          ctx.beginPath();
          ctx.arc(x(e.time), y(e.h), 3, 0, 2 * Math.PI);
          ctx.fill();
        });
      pulses
        .filter((p) => p.tank === index && p.time >= minT)
        .forEach((p) => {
          ctx.strokeStyle = COLORS.pulse;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(x(p.time), top);
          ctx.lineTo(x(p.time), bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS.pulse;
          ctx.fillText("+", x(p.time), top + 7);
        });
      ctx.restore();
      // Readout: the water level, threshold and time under the pointer.
      const fraction = hover[index];
      const last = samples[samples.length - 1];
      if (fraction !== null && last) {
        const target = minT + fraction * (maxT - minT);
        let nearest = last;
        for (const sample of samples)
          if (Math.abs(sample.t - target) < Math.abs(nearest.t - target)) nearest = sample;
        const cx = x(nearest.t);
        ctx.strokeStyle = "#8f9c92";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLORS.event;
        ctx.beginPath();
        ctx.arc(cx, y(nearest.h[index]), 3.2, 0, 2 * Math.PI);
        ctx.fill();
        const label = `V ${nearest.h[index].toFixed(3)} · tip ${nearest.H[index].toFixed(2)} · ${nearest.t.toFixed(1)} s`;
        const textWidth = ctx.measureText(label).width;
        const boxLeft = Math.min(Math.max(left, cx - textWidth / 2 - 6), right - textWidth - 12);
        ctx.fillStyle = "#ffffffee";
        ctx.fillRect(boxLeft, top + 1, textWidth + 12, 16);
        ctx.strokeStyle = "#e7e8ea";
        ctx.strokeRect(boxLeft, top + 1, textWidth + 12, 16);
        ctx.fillStyle = "#17191c";
        ctx.textAlign = "left";
        ctx.fillText(label, boxLeft + 6, top + 9);
        ctx.textAlign = "center";
      }
    });
  }

  return {
    draw(time: number, events: DrainEvent[], pulses: PulseEvent[]) {
      latest = { time, events, pulses };
      render();
    },
    dispose() {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
    },
  };
}
