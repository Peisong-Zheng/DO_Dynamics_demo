import "./styles.css";
import { DynamicsEngine } from "./simulation/engine";
import { SimulationRunner } from "./simulation/runner";
import { DEFAULT_SEED } from "./simulation/types";
import type { AdjustableParam, TankIndex } from "./simulation/types";
import { createScene } from "./scene/createScene";
import { History, createCharts } from "./ui/charts";
import { describePhase, describeRegime } from "./ui/copy";
import { notesMarkup, wireNotes } from "./ui/sidebar";

const icon = (name: "pause" | "play" | "reset" | "drop") =>
  ({
    pause: '<path d="M7 5v14M17 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
    drop: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>',
  })[name];
const svgIcon = (name: "pause" | "play" | "reset" | "drop") =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icon(name)}</svg>`;

function tankControls(index: TankIndex) {
  const label = index === 0 ? "A" : "B";
  return `<section class="parameter-panel tank-${label.toLowerCase()}" aria-labelledby="controls-${index}">
    <h3 id="controls-${index}">Reservoir ${label}</h3>
    <div class="slider-row"><label for="r-${index}">Mean inflow <span class="symbol">r</span></label><output for="r-${index}" id="r-value-${index}"></output><input id="r-${index}" data-tank="${index}" data-param="r" type="range" min="0.06" max="0.30" step="0.001"/></div>
    <div class="slider-row"><label for="a-${index}">Inflow noise <span class="symbol">a</span></label><output for="a-${index}" id="a-value-${index}"></output><input id="a-${index}" data-tank="${index}" data-param="a" type="range" min="0" max="0.95" step="0.01"/></div>
    <label class="noise-toggle" for="noise-${index}"><input type="checkbox" id="noise-${index}"/>Enable noise</label>
    <div class="slider-row drainage-control"><label for="kappa-${index}">Outlet drainage <span class="symbol">κ</span></label><output for="kappa-${index}" id="kappa-value-${index}"></output><input id="kappa-${index}" data-tank="${index}" data-param="kappa" type="range" min="0.4" max="8" step="0.01" aria-describedby="outlet-help-${index}"/><span class="slider-help" id="outlet-help-${index}">Throttled<span>Open</span></span><span class="coefficient-note">Fully open coefficient · s⁻¹</span></div>
    <div class="pulse-row"><button id="pulse-${index}" class="pulse-button">${svgIcon("drop")}Add water <span>+0.15</span></button><span class="pulse-note" id="pulse-note-${index}">One brief perturbation</span></div>
  </section>`;
}

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main>
    <header class="intro"><div><h1 id="page-title">The tipping point<span>.</span></h1><p class="lead">Random inflow. Different responses.</p></div><button id="open-notes" class="notes-trigger" aria-haspopup="dialog" aria-controls="notes-dialog">Notes <span aria-hidden="true">↗</span></button></header>
    <section class="lab" aria-label="Interactive tilting reservoir experiment">
      <div class="lab-toolbar">
        <p class="interaction-hint" id="threshold-hint">Drag the weight or move the threshold slider.</p>
        <div class="transport"><button class="primary" id="pause"></button><span class="clock" aria-label="Elapsed simulation time"><span class="clock-dot" aria-hidden="true"></span><output id="sim-time">0.0</output><span>s</span></span></div>
        <details id="more-controls" class="more-controls"><summary>Controls</summary><div class="controls-menu"><label for="speed">Playback speed</label><select id="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><button id="reset" title="Restore the default experiment and replay the current random seed">${svgIcon("reset")}Reset &amp; replay</button><p>Resets both reservoirs and history.</p></div></details>
      </div>
      <div class="tank-headings">${([0, 1] as const).map((i) => `<section id="reservoir-heading-${i}" class="tank-heading tank-${i === 0 ? "a" : "b"}" aria-labelledby="tank-name-${i}" aria-describedby="regime-detail-${i}"><div class="tank-title"><h2 id="tank-name-${i}"><span class="sr-only">Reservoir </span><span class="tank-letter">${i === 0 ? "A" : "B"}</span></h2><span class="regime-badge" id="regime-${i}"></span></div><p id="regime-detail-${i}" class="sr-only"></p><div class="readings"><span><span class="sr-only">Stored water </span><span class="symbol">V</span> <strong id="height-${i}">0.700</strong></span><span class="phase" id="phase-${i}">Receiving · accumulating</span><span class="sr-only"><strong id="count-${i}">0</strong> tipping events</span></div>${i === 1 ? `<div class="stability-control" role="group" aria-label="Outlet fitting for reservoir B" aria-describedby="stability-description"><button id="mode-monostable" aria-pressed="true" title="Wide outlet, drainage coefficient 8.00">Monostable</button><button id="mode-bistable" aria-pressed="false" title="Throttled outlet with the retaining baffle, drainage coefficient 0.80">Bistable</button></div><p id="stability-description" class="sr-only">Choose reservoir B’s outlet fitting: a wide outlet (κ = 8.00) or a throttled outlet with the retaining baffle (κ = 0.80). Current water, tilt, noise, time and history are preserved. Adjusting the inflow or the tipping threshold keeps the fitting selected and the baffle in place; changing the outlet coefficient itself clears it.</p>` : ""}</section>`).join("")}</div>
      <div id="tank-scene" role="group" aria-label="Live view of two tilting reservoirs, with draggable counterweights, continuous inflow, slow leaks and controlled pouring outlets.">
        <div class="threshold-controls">${([0, 1] as const).map((i) => `<div id="threshold-panel-${i}" class="threshold-control tank-${i === 0 ? "a" : "b"}"><label for="threshold-${i}">Tip<br/>threshold</label><output id="threshold-value-${i}" for="threshold-${i}">${i === 0 ? "0.75" : "1.00"}</output><input id="threshold-${i}" type="range" min="0.55" max="1.65" step="0.01" value="${i === 0 ? "0.75" : "1.00"}" aria-label="Reservoir ${i === 0 ? "A" : "B"} tipping threshold" aria-orientation="vertical" aria-describedby="threshold-help-${i}"/><span id="threshold-help-${i}" class="sr-only">Raise the slider to increase the tipping threshold and move the counterweight outward. Lower it to make tipping easier. Arrow up increases the threshold; arrow down decreases it.</span></div>`).join("")}</div>
      </div>
      <section class="timeline-section" aria-labelledby="timeline-title"><div class="timeline-heading"><h2 id="timeline-title">Stored water over time</h2><p>Last 60 simulation seconds</p></div><div class="chart-legend"><span><i class="line-key water-line"></i>Stored water</span><span><i class="line-key threshold"></i>Tip / return</span><span><i class="line-key equilibrium"></i>Receiving eq.</span><span><i class="line-key pouring"></i>Pouring eq.</span><span><i class="shade-key"></i>Tilted</span><span><i class="event-key"></i>Tip</span><span class="pulse-legend">＋ Added water</span></div><div class="charts-grid">${([0, 1] as const).map((i) => `<figure class="chart-card tank-${i === 0 ? "a" : "b"}"><figcaption><span class="tank-letter">${i === 0 ? "A" : "B"}</span><span id="chart-events-${i}">0 tips</span></figcaption><canvas id="chart-${i}" role="img" aria-label="Reservoir ${i === 0 ? "A" : "B"}: stored water, thresholds, branch equilibria and tipping events over the last 60 simulation seconds"></canvas></figure>`).join("")}</div><p class="chart-axis">Stored water (relative units) · Simulation time (s)</p></section>
      <details id="parameter-settings" class="parameter-settings"><summary>Adjust parameters</summary><p class="parameter-note">Changes take effect immediately and preserve the current water and tilt.</p><div class="parameter-grid">${tankControls(0)}${tankControls(1)}</div></details>
    </section>
  </main>${notesMarkup}<p id="announcement" role="status" class="sr-only"></p>`;

const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const notes = wireNotes();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const engine = new DynamicsEngine("B", DEFAULT_SEED);
const history = new History();
history.clear(engine);
let previousPhases = engine.tanks.map((t) => t.phase).join();
let phaseChanged = false;
const runner = new SimulationRunner(engine, () => {
  history.record(engine);
  const phases = engine.tanks.map((t) => t.phase).join();
  if (phases !== previousPhases) phaseChanged = true;
  previousPhases = phases;
});
runner.setPaused(reducedMotion);
const sceneHost = el("tank-scene");
const headings = document.querySelector<HTMLDivElement>(".tank-headings")!;
const mobileLayout = matchMedia("(max-width: 699px)");
const placeHeadings = () => {
  if (mobileLayout.matches) {
    if (headings.parentElement !== sceneHost) sceneHost.append(headings);
  } else if (headings.parentElement !== sceneHost.parentElement || headings.nextElementSibling !== sceneHost) {
    sceneHost.before(headings);
  }
};
placeHeadings();
mobileLayout.addEventListener("change", placeHeadings);
const scene = createScene(sceneHost, { reducedMotion, onThresholdChange: updateThreshold });
const charts = createCharts(
  [el<HTMLCanvasElement>("chart-0"), el<HTMLCanvasElement>("chart-1")],
  history,
);
let initialPaused = reducedMotion;
let lastUi = 0;

function announce(text: string) {
  el("announcement").textContent = text;
}

function refresh() {
  el("sim-time").textContent = engine.time.toFixed(1);
  el("pause").innerHTML =
    `${svgIcon(runner.paused ? "play" : "pause")}${runner.paused ? (initialPaused ? "Start" : "Resume") : "Pause"}`;
  el("pause").setAttribute("aria-pressed", String(runner.paused));
  document
    .querySelector(".clock")!
    .classList.toggle("is-paused", runner.paused);
  el("seed").textContent = String(engine.seed);
  // The buttons select the outlet fitting, not the resting-branch balance, so a
  // threshold or inflow tweak keeps the fitting selected and the vessel keeps its
  // baffle; only changing the outlet coefficient itself clears the selection. The
  // regime badge is what reports the resulting dynamics.
  const comparison = engine.tanks[1].params;
  for (const [mode, kappa] of [["monostable", 8], ["bistable", 0.8]] as const) {
    const selected = Math.abs(comparison.kappa - kappa) < 1e-10;
    el(`mode-${mode}`).setAttribute("aria-pressed", String(selected));
  }
  engine.tanks.forEach((tank, i) => {
    const regime = describeRegime(tank);
    el(`regime-${i}`).textContent = regime.title;
    el(`regime-detail-${i}`).textContent = regime.detail;
    el(`height-${i}`).textContent = tank.h.toFixed(3);
    el(`phase-${i}`).textContent = describePhase(tank);
    el(`phase-${i}`).dataset.phase = tank.phase;
    el(`count-${i}`).textContent = String(tank.eventCount);
    el(`chart-events-${i}`).textContent = `${tank.eventCount} ${tank.eventCount === 1 ? "tip" : "tips"}`;
    const thresholdSlider = el<HTMLInputElement>(`threshold-${i}`);
    thresholdSlider.value = String(tank.params.H);
    thresholdSlider.setAttribute("aria-valuetext", `${tank.params.H.toFixed(2)} relative water units`);
    thresholdSlider.style.setProperty("--range-progress", `${(tank.params.H - 0.55) / 1.1 * 100}%`);
    el(`threshold-value-${i}`).textContent = tank.params.H.toFixed(2);
    for (const key of ["r", "a", "kappa"] as const) {
      const slider = el<HTMLInputElement>(`${key}-${i}`);
      if (document.activeElement !== slider)
        slider.value = String(tank.params[key]);
      el(`${key}-value-${i}`).textContent = tank.params[key].toFixed(
        key === "r" ? 3 : 2,
      );
      const percent =
        ((tank.params[key] - Number(slider.min)) /
          (Number(slider.max) - Number(slider.min))) *
        100;
      slider.style.setProperty("--range-progress", `${percent}%`);
      slider.setAttribute(
        "aria-valuetext",
        `${tank.params[key].toFixed(key === "r" ? 3 : 2)}${key === "a" && tank.params.a === 0 ? ", off" : ""}`,
      );
    }
    el<HTMLInputElement>(`noise-${i}`).checked = tank.params.a > 0;
    const cannotAdd = !engine.canPulse(i as TankIndex);
    el<HTMLButtonElement>(`pulse-${i}`).disabled = runner.paused || cannotAdd;
    const explanation = runner.paused
      ? "Resume to add water"
      : tank.pulsePending
        ? "Queued for the next step"
        : cannotAdd
          ? "Leave room for water entering during the tip"
          : "One brief perturbation";
    el(`pulse-note-${i}`).textContent = explanation;
    el(`pulse-${i}`).setAttribute("aria-describedby", `pulse-note-${i}`);
  });
  const recent = engine.events.slice(-5).reverse();
  el("event-log").textContent = recent.length
    ? `Last ${recent.length} tipping events: ` +
      recent
        .map(
          (e) =>
            `Reservoir ${e.tank === 0 ? "A" : "B"} at ${e.time.toFixed(3)} s (r=${e.params.r.toFixed(3)}, H=${e.params.H.toFixed(2)}, a=${e.params.a.toFixed(2)})`,
        )
        .join("; ") +
      "."
    : "No tipping events yet.";
  charts.draw(engine.time, engine.events, engine.pulses);
}

function resetTo(seed = engine.seed) {
  engine.reset("B", seed);
  runner.clearAccumulator();
  history.clear(engine);
  refresh();
  scene.update(engine);
  announce(
    "Random inflow restarted. Both reservoirs reset to 0.70 stored water in the receiving pose, and history cleared.",
  );
}

el("pause").addEventListener("click", () => {
  initialPaused = false;
  runner.setPaused(!runner.paused);
  refresh();
  announce(
    runner.paused ? "Paused. Simulation time, stored water, tilt and the random process are stopped." : "Simulation resumed.",
  );
});
for (const mode of ["monostable", "bistable"] as const) {
  el(`mode-${mode}`).addEventListener("click", () => {
    history.record(engine, true);
    engine.setStabilityMode(mode);
    history.record(engine, true);
    refresh();
    scene.update(engine);
    announce(`Reservoir B set to ${mode}: inflow 0.144, tipping threshold 1.00 and outlet coefficient ${mode === "bistable" ? "0.80" : "8.00"}. Current water, tilt, noise, time and history are preserved.`);
  });
}
el("reset").addEventListener("click", () => resetTo());
el("new-seed").addEventListener("click", () => {
  const seeds = new Uint32Array(1);
  crypto.getRandomValues(seeds);
  resetTo(seeds[0] === engine.seed ? (seeds[0] + 1) >>> 0 : seeds[0]);
});
el<HTMLSelectElement>("speed").addEventListener("change", (event) => {
  runner.speed = Number((event.target as HTMLSelectElement).value);
});
function updateThreshold(index: TankIndex, threshold: number) {
  const next = Math.max(0.55, Math.min(1.65, Math.round(threshold * 100) / 100));
  if (Math.abs(engine.tanks[index].params.H - next) < 1e-10) return;
  history.record(engine, true);
  engine.setParam(index, "H", next);
  history.record(engine, true);
  refresh();
  scene.update(engine);
}
for (const index of [0, 1] as const) {
  el<HTMLInputElement>(`threshold-${index}`).addEventListener("input", (event) => {
    updateThreshold(index, Number((event.target as HTMLInputElement).value));
  });
}
document.querySelectorAll<HTMLInputElement>("[data-param]").forEach((input) =>
  input.addEventListener("input", () => {
    history.record(engine, true);
    engine.setParam(
      Number(input.dataset.tank) as TankIndex,
      input.dataset.param as AdjustableParam,
      Number(input.value),
    );
    history.record(engine, true);
    refresh();
    scene.update(engine);
  }),
);
for (const i of [0, 1] as const) {
  el<HTMLInputElement>(`noise-${i}`).addEventListener("change", (event) => {
    engine.setNoiseEnabled(i, (event.target as HTMLInputElement).checked);
    refresh();
  });
  el(`pulse-${i}`).addEventListener("click", () => {
    if (runner.paused) return;
    if (engine.requestPulse(i))
      announce(
        `Reservoir ${i === 0 ? "A" : "B"}: 0.15 units of added water queued for the next physics step.`,
      );
    refresh();
  });
}

let previous = performance.now();
let frameId = 0;
function frame(now: number) {
  placeHeadings();
  if (!document.hidden) {
    runner.advance(Math.max(0, (now - previous) / 1000));
    scene.update(engine);
    if (now - lastUi >= 80 || phaseChanged) {
      refresh();
      lastUi = now;
      phaseChanged = false;
    }
  }
  previous = now;
  frameId = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  previous = performance.now();
  runner.clearAccumulator();
});
refresh();
scene.update(engine);
frameId = requestAnimationFrame(frame);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    cancelAnimationFrame(frameId);
    mobileLayout.removeEventListener("change", placeHeadings);
    notes.dispose();
    scene.dispose();
    charts.dispose();
  });
