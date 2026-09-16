import { describe, expect, it } from "vitest";
import {
  CHAMBER_CAPACITY, CHAMBER_RADIUS, CHAMBER_BACK, BEVEL_SLOPE, CHAMBER_END,
  COUNTERWEIGHT_MASS, EMPTY_CHAMBER_MOMENT, LIP_HEIGHT, REST_ANGLE,
  OUTLET, SLOW_LEAK_LOCAL, chamberGeometry, counterweightPosition, thresholdFromCounterweight,
  rotatePoint, waterSection, inletCapture, rimCapacity, rimSpillPoint,
  openingForAngle, slowLeakPoint, slowLeakWet, receivingWaterline,
} from "../src/scene/tiltingGeometry";
import { TILT_ANGLE } from "../src/simulation/types";
import type { Point3 } from "../src/scene/tiltingGeometry";

function signedVolume(vertices: Point3[], faces: number[][]) {
  let v = 0;
  for (const f of faces) for (let j = 1; j < f.length - 1; j++) {
    const a = vertices[f[0]], b = vertices[f[j]], c = vertices[f[j + 1]];
    v += (a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x)) / 6;
  }
  return v;
}

describe("Open beveled cylindrical chamber", () => {
  it("has circular sections, an oblique mouth and a genuinely open upper aperture", () => {
    const shell = chamberGeometry();
    expect(shell.mouth.length).toBeGreaterThanOrEqual(32);
    for (const p of shell.vertices) {
      expect(p.y ** 2 + p.z ** 2).toBeCloseTo(CHAMBER_RADIUS ** 2, 12);
      expect(p.x === CHAMBER_BACK || Math.abs(p.x + BEVEL_SLOPE * p.y - CHAMBER_END) < 1e-12).toBe(true);
    }
    expect(shell.faces).toHaveLength(shell.closedFaces.length - 1);
    expect(shell.lip.every(p => p.y <= LIP_HEIGHT + 1e-12)).toBe(true);
    expect(shell.opening.every(p => p.y >= LIP_HEIGHT - 1e-12)).toBe(true);
    const volume = signedVolume(shell.vertices, shell.closedFaces);
    expect(volume).toBeGreaterThan(0);
    // Faceting approaches the analytic cylinder volume, rather than a box volume.
    expect(volume / (Math.PI * CHAMBER_RADIUS ** 2 * (CHAMBER_END - CHAMBER_BACK))).toBeGreaterThan(0.995);
  });

  it("preserves stored volume in the 3D mesh and keeps the free surface horizontal", () => {
    const shell = chamberGeometry();
    const fullVolume = signedVolume(shell.vertices, shell.closedFaces);
    for (const angle of [0, 0.08, 0.3, 0.4, 0.65]) {
      for (const fraction of [0.001, 0.05, 0.5, 0.99]) {
        const target = rimCapacity(angle) * fraction;
        const water = waterSection(target, angle);
        expect(water.volume).toBeCloseTo(target, 9);
        expect(signedVolume(water.vertices, water.faces) / fullVolume * CHAMBER_CAPACITY).toBeCloseTo(target, 9);
        expect(water.surface.length).toBeGreaterThanOrEqual(3);
        for (const p of water.surface) expect(p.y).toBeCloseTo(water.level, 12);
        expect(water.vertices.every(p => p.y <= water.level + 1e-12)).toBe(true);
        expect(water.level).toBeLessThan(rimSpillPoint(angle).y);
      }
    }
  });

  it("retains all receiving thresholds and both resting states while its rim lowers continuously", () => {
    expect(rimCapacity(0)).toBeGreaterThan(2);
    expect(rimCapacity(TILT_ANGLE)).toBeGreaterThan(0.25);
    expect(rimCapacity(TILT_ANGLE)).toBeLessThan(0.35);
    expect(waterSection(0.9, 0).level).toBeLessThan(rimSpillPoint(0).y);
    expect(waterSection(0.15, TILT_ANGLE).level).toBeLessThan(rimSpillPoint(TILT_ANGLE).y);
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const capacity = rimCapacity(TILT_ANGLE * i / 100);
      expect(capacity).toBeLessThanOrEqual(last + 1e-10);
      last = capacity;
    }
  });

  it("captures the fixed vertical jet through the open mouth above the retaining lip at every angle", () => {
    for (let i = 0; i <= 200; i++) {
      const capture = inletCapture(TILT_ANGLE * i / 200);
      expect(capture.captured).toBe(true);
      expect(capture.local.y).toBeGreaterThan(LIP_HEIGHT + 0.1);
      expect(capture.local.y ** 2 + capture.local.z ** 2).toBeLessThan(CHAMBER_RADIUS ** 2);
    }
    expect(inletCapture(0, 8).captured).toBe(false);
    expect(inletCapture(TILT_ANGLE, 1.2, 2).captured).toBe(false);
  });

  it("opens the front outlet only after it is downhill, while the slow leak keeps one fixed base pore", () => {
    for (let i = 0; i <= 40; i++) {
      const angle = TILT_ANGLE * i / 40;
      const water = waterSection(Math.min(0.15, rimCapacity(angle) / 2), angle);
      if (angle <= REST_ANGLE) expect(openingForAngle(angle)).toBe(0);
      else expect(rotatePoint(OUTLET, angle).y).toBeLessThan(water.level);
      // The pore is fixed to the vessel: it never slides along the underside.
      expect(slowLeakPoint(angle)).toEqual(rotatePoint(SLOW_LEAK_LOCAL, angle));
    }
    expect(openingForAngle(TILT_ANGLE)).toBe(1);
    // Receiving pose: the fixed pore is the lowest part of the wetted underside.
    for (const volume of [0.12, 0.4, 0.9, 1.6]) {
      const water = waterSection(volume, 0);
      expect(slowLeakWet(water.level, 0)).toBe(true);
      expect(slowLeakPoint(0).y).toBeLessThan(water.level);
    }
    // Fully tipped, the stored water has moved to the mouth end, so the fixed
    // pore is exposed and no drip is drawn there; the controlled outlet drains.
    for (const volume of [0.15, 0.28]) {
      expect(slowLeakWet(waterSection(volume, TILT_ANGLE).level, TILT_ANGLE)).toBe(false);
    }
  });

  it("marks the vessel waterlines at the level each stored volume actually reaches", () => {
    // hReset < H < r/k for the default vessel, and every mark has to sit exactly
    // on the world-horizontal plane that volume fills in the receiving pose.
    expect(waterSection(0.12, 0).level).toBeLessThan(waterSection(0.75, 0).level);
    expect(waterSection(0.75, 0).level).toBeLessThan(waterSection(0.9, 0).level);
    for (const volume of [0.12, 0.75, 0.9]) {
      const level = waterSection(volume, 0).level;
      const mark = receivingWaterline(volume);
      expect(mark.length).toBeGreaterThanOrEqual(3);
      for (const p of mark) expect(rotatePoint(p, 0).y).toBeCloseTo(level, 10);
    }
  });

  it("maps the real receiving-water torque monotonically to a draggable counterweight and back", () => {
    let last = 0;
    for (const threshold of [0.55, 0.62, 0.75, 0.91, 1, 1.2, 1.4, 1.65]) {
      const x = counterweightPosition(threshold);
      expect(x).toBeLessThan(last);
      expect(x).toBeGreaterThan(-1.1);
      const waterMoment = threshold * waterSection(threshold, 0).centroid.x;
      expect(-x * Math.cos(REST_ANGLE) * COUNTERWEIGHT_MASS).toBeCloseTo(waterMoment + EMPTY_CHAMBER_MOMENT, 9);
      expect(thresholdFromCounterweight(x)).toBeCloseTo(threshold, 7);
      last = x;
    }
    expect(thresholdFromCounterweight(-4)).toBe(1.65);
    expect(thresholdFromCounterweight(0)).toBe(0.55);
  });

  it("handles empty/full geometric chambers without silently truncating a requested volume", () => {
    expect(waterSection(0, 0.65).vertices).toEqual([]);
    expect(waterSection(CHAMBER_CAPACITY, 0.65).volume).toBeCloseTo(CHAMBER_CAPACITY, 9);
    expect(() => waterSection(CHAMBER_CAPACITY + 0.01, 0)).toThrow(RangeError);
    expect(() => waterSection(-0.01, 0)).toThrow(RangeError);
  });
});
