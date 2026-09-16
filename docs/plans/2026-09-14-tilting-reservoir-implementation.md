# Tilting reservoirs implementation plan

**Goal:** Implement the approved tilting apparatus, a monostable/bistable switch in panel B, and an English Notes sidebar with references and author credits.

**Status:** Completed on 2026-09-15. All 50 tests, TypeScript/build checks and 24 production Chrome checks pass. Desktop, mobile, held bistable and SVG scenes have been visually inspected. The final scene implementation uses `src/scene/tank.ts` with the shared `tiltingGeometry.ts`; the Notes drawer is implemented in `src/ui/sidebar.ts`.

**Architecture:** One pure fixed-step engine owns water volume, angle, opening and phase. The Three.js scene, SVG fallback and history charts consume this same state. Parameter changes preserve the current trajectory; experiment loading explicitly resets it.

**Tech stack:** Existing Vite, TypeScript, Three.js, Vitest and Playwright/Chrome. All runtime assets remain local.

## 1. Coupled dynamics

Files: `src/simulation/types.ts`, `engine.ts`, `presets.ts`, and simulation tests.

- Retain internal `h` as normalized stored volume; expose V in all user-facing labels.
- Add angle, actual outlet opening and RETURN phase. Filling/pouring stationary states use analytic flow; rotation couples angle and flow on the simulation clock with a convergent integrator.
- Use A r=.144/H=.75 and B r=.144/H=1. Both receive the existing seeded OU process, with amplitudes 0/.9 by default.
- Mode switch sets B r=.144/H=1 and κ=8/.8, cancels its background ramp and preserves water, angle, phase, time, noise and events.
- Validate .90/.15 bistability, pulses, bidirectional transitions, boundaries, water balance, numerical convergence and frame-rate independence.

## 2. Apparatus and water geometry

Files: `src/scene/tiltingGeometry.ts`, `tiltingReservoir.ts`, `createScene.ts`, `fallback.ts`, `scene.css`, geometry tests.

- Large side view of a pivoted transparent storage chamber, counterweight, visible leak and controlled outlet.
- Solve a clipped prism for world-horizontal water at every volume and angle.
- Keep inlet capture continuous through a pivot hose and direct every outlet into a catch basin.
- Use calibrated threshold/counterweight mapping and a visible hysteretic latch; no unrelated decorative tipping.
- Match all physics in the SVG fallback and verify desktop/mobile label placement.

## 3. Interface and Notes drawer

Files: `src/main.ts`, `src/styles.css`, `src/ui/copy.ts`, `index.html`.

- Keep the existing restrained English layout, add Monostable/Bistable buttons within panel B.
- Main scene and diagrams use stored water V, tipping/returning and outlet terminology.
- Add a top-corner Notes button and accessible modal sidebar: close button, Escape, backdrop close, focus restoration, scroll and keyboard containment.
- Put equations, model boundaries, random seed, event log and references in the sidebar.
- Credit Peisong Zheng, University Of Cambridge; `pz285@cam.ac.uk`, `zheng_peisong@foxmail.com`; “Built with ChatGPT6 Astra.”

## 4. History, integration and delivery

Files: `src/ui/charts.ts`, `tests/history.test.ts`, `scripts/browser-check.mjs`, `README.md`.

- Preserve historical receiving/pouring equilibria and actual tilted phases across parameter and mode changes.
- Verify real UI clicks on mode controls and drawer, defaults, replay, freeze, sliders, noise off, mobile and fallback. Check English text and author/contact attribution.
- Run `npm test`, `npm run build`, and production browser checks; inspect screenshots in receiving, tipping, and bistable held states.
- Update README to describe implemented physics and actual verification. Keep deployment with the project owner as previously requested.

This plan implements the previously approved [design](2026-09-14-tilting-reservoir-redesign.md); no further design approval is required.
