import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Run against an already running production preview. Set CHROME_PATH when using
// an existing browser; otherwise install Chromium with `npx playwright install chromium`.
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const url = process.env.PREVIEW_URL || "http://127.0.0.1:4173/";
fs.mkdirSync("test-results", { recursive: true });
const errors = [];
let checks = 0;
const pass = (message) => {
  checks++;
  console.log(`PASS ${message}`);
};
const makePage = async (options) => {
  const page = await browser.newPage(options);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  return page;
};

try {
  const page = await makePage({
    viewport: { width: 1440, height: 1100 },
    reducedMotion: "reduce",
  });
  await page.clock.install({ time: new Date("2026-09-14T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-09-14T12:00:01Z"));
  await page.goto(url);
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  assert.equal(await page.locator("#parameter-settings").getAttribute("open"), null);
  assert.equal(await page.locator("#more-controls").getAttribute("open"), null);
  assert.equal(await page.locator("#notes-dialog").getAttribute("open"), null);
  const nonEnglish = await page.evaluate(() => /\p{Script=Han}/u.test(document.body.textContent || ""));
  assert.equal(nonEnglish, false);
  assert.equal(await page.locator("#experiment-select, #noise-off, #freeze, #H-0, #H-1").count(), 0);
  assert.equal(await page.locator(".threshold-control input[type=range]").count(), 2);
  pass("English single-case interface removes experiment/global-noise controls and keeps detailed settings collapsed");
  const text = (id) => page.locator(`#${id}`).textContent();
  const click = (id) => page.locator(`#${id}`).dispatchEvent("click");
  const slide = (id, value) =>
    page.locator(`#${id}`).evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  const setNoise = (index, enabled) =>
    page.locator(`#noise-${index}`).evaluate((input, checked) => {
      input.checked = checked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, enabled);
  const run = (milliseconds) => page.clock.runFor(milliseconds);
  assert.match(await text("pause"), /Start/);
  assert.equal(await text("height-0"), "0.700");
  assert.equal(await page.locator("#pulse-0").isDisabled(), true);
  await run(1000);
  assert.equal(await text("sim-time"), "0.0");
  pass("reduced-motion starts paused, with disabled pulse and stopped clock");
  await page.locator("#open-notes").click();
  const notes = page.locator("#notes-dialog");
  assert.equal(await notes.isVisible(), true);
  const notesText = await notes.textContent();
  for (const credit of ["Peisong Zheng", "University Of Cambridge", "ChatGPT6 Astra", "references"])
    assert.ok(notesText.includes(credit), `Missing note: ${credit}`);
  for (const address of ["pz285@cam.ac.uk", "zheng_peisong@foxmail.com"])
    assert.equal(await notes.locator(`a[href="mailto:${address}"]`).count(), 1);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await notes.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("#close-notes").evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await notes.isVisible(), false);
  assert.equal(await page.locator("#open-notes").evaluate(el => el === document.activeElement), true);
  await page.locator("#open-notes").click();
  await page.locator("#close-notes").click();
  // Native dialog close dispatches its focus-restoration event on a later frame.
  // Settle that event before directing keyboard input to another control.
  await run(20);
  assert.equal(await notes.isVisible(), false);
  pass("Notes drawer contains author, contacts, implementation credit and references; Escape and close restore the page");
  assert.equal(await page.locator("#tank-scene > canvas").count(), 1);
  pass("production page creates one WebGL canvas");
  const weight = page.locator("#counterweight-handle-1");
  const threshold = page.locator("#threshold-1");
  assert.equal(await weight.getAttribute("role"), "slider");
  assert.equal(await threshold.getAttribute("aria-orientation"), "vertical");
  const weightBefore = await weight.boundingBox();
  await threshold.focus();
  assert.equal(await threshold.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("ArrowUp");
  assert.equal(await text("threshold-value-1"), "1.01");
  assert.equal(Number(await weight.getAttribute("aria-valuenow")), 1.01);
  await page.keyboard.press("End");
  assert.equal(await threshold.inputValue(), "1.65");
  const weightAfter = await weight.boundingBox();
  assert.ok(Math.hypot(weightAfter.x - weightBefore.x, weightAfter.y - weightBefore.y) > 10);
  assert.equal(await text("height-1"), "0.700");
  await weight.focus();
  await page.keyboard.press("Home");
  assert.equal(await threshold.inputValue(), "0.55");
  await page.keyboard.press("ArrowUp");
  assert.equal(await threshold.inputValue(), "0.56");
  assert.equal(await text("threshold-value-1"), "0.56");
  pass("vertical threshold and visible weight synchronize both ways with keyboard input while preserving paused water");
  await click("reset");
  const dragStart = await weight.boundingBox();
  const dragX = dragStart.x + dragStart.width / 2;
  const dragY = dragStart.y + dragStart.height / 2;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 55, dragY - 16, { steps: 6 });
  const draggedH = Number(await threshold.inputValue());
  assert.ok(Math.abs(draggedH - 1) > .02, `drag changed H to ${draggedH}`);
  assert.equal(Number(await weight.getAttribute("aria-valuenow")), draggedH);
  assert.equal(await text("threshold-value-1"), draggedH.toFixed(2));
  await page.mouse.move(dragX, dragY, { steps: 6 });
  await page.mouse.up();
  assert.ok(Math.abs(Number(await threshold.inputValue()) - 1) <= .01);
  assert.equal(await text("height-1"), "0.700");
  pass("dragging the weight beyond its handle updates the actual threshold and a reverse drag restores it");
  await click("reset");
  await click("pause");
  await run(15100);
  assert.equal(await text("count-1"), "1");
  assert.ok(Number(await text("count-0")) >= 2);
  await click("pause");
  const heights = [await text("height-0"), await text("height-1")];
  const phases = [await text("phase-0"), await text("phase-1")];
  await setNoise(1, false);
  assert.deepEqual([await text("height-0"), await text("height-1")], heights);
  assert.deepEqual([await text("phase-0"), await text("phase-1")], phases);
  assert.equal(await text("a-value-1"), "0.00");
  pass(
    "default seeded B event occurs, pause and noise-off retain physical state",
  );

  await page.locator("#noise-1").evaluate((input) => {
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await text("a-value-1"), "0.90");
  pass("noise switch restores remembered strength");
  await click("reset");
  assert.equal(await text("height-0"), "0.700");
  assert.equal(await text("count-1"), "0");
  assert.equal(await text("sim-time"), "0.0");
  const seed = await text("seed");
  await click("pause");
  await run(16000);
  await click("pause");
  const replayHeights = [await text("height-0"), await text("height-1")];
  await click("reset");
  await click("pause");
  await run(16000);
  await click("pause");
  assert.deepEqual(
    [await text("height-0"), await text("height-1")],
    replayHeights,
  );
  assert.equal(await text("seed"), seed);
  pass("reset at the same seed reproduces both observed trajectories");
  // Matched with a small tolerance so palette tweaks do not invalidate the check.
  const waterPixels = await page.locator("#chart-0").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const near = (value, target) => Math.abs(value - target) < 10;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (near(data[i], 31) && near(data[i + 1], 122) && near(data[i + 2], 118) && data[i + 3] > 200) count++;
    }
    return count;
  });
  assert.ok(waterPixels > 20);
  await page.screenshot({ path: "test-results/trajectory.png", fullPage: true });
  pass("history canvas renders a real water trajectory, captured for visual review");

  await click("reset");
  const beforeMode = [await text("height-0"), await text("height-1"), await text("sim-time"), await text("phase-1"), await text("count-1")];
  await page.locator("#mode-bistable").click();
  assert.equal(await page.locator("#mode-bistable").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#mode-monostable").getAttribute("aria-pressed"), "false");
  assert.equal(await text("kappa-value-1"), "0.80");
  assert.deepEqual([await text("height-0"), await text("height-1"), await text("sim-time"), await text("phase-1"), await text("count-1")], beforeMode);
  await click("pause");
  await run(15000);
  assert.equal(await text("count-1"), "1");
  await setNoise(1, false);
  await run(10000);
  await click("pause");
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "DRAIN");
  assert.ok(Math.abs(Number(await text("height-1")) - .15) < .001);
  assert.match(await text("regime-1"), /Bistable/i);
  await page.screenshot({ path: "test-results/bistable-held.png", fullPage: true });
  pass("Bistable button preserves state and changes actual drainage; after a noise event the tilted reservoir stays at V=.15 with noise off");
  const held = [await text("height-1"), await text("phase-1"), await text("sim-time")];
  await page.locator("#mode-monostable").click();
  assert.deepEqual([await text("height-1"), await text("phase-1"), await text("sim-time")], held);
  assert.equal(await text("kappa-value-1"), "8.00");
  await click("pause");
  await run(1000);
  await click("pause");
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "FILL");
  assert.ok(Number(await text("height-1")) < .3);
  await slide("r-1", .18);
  // Inflow and threshold tweaks keep the fitting selected; only the outlet
  // coefficient clears it, so the vessel never loses its baffle underneath.
  assert.equal(await page.locator("#mode-monostable").getAttribute("aria-pressed"), "true");
  await slide("threshold-1", 1.30);
  assert.equal(await page.locator("#mode-monostable").getAttribute("aria-pressed"), "true");
  await slide("kappa-1", 2.5);
  assert.equal(await page.locator("#mode-monostable").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#mode-bistable").getAttribute("aria-pressed"), "false");
  pass("Monostable restores return dynamics without teleporting water; only the outlet coefficient clears the fitting");

  await click("reset");
  await setNoise(1, false);
  assert.equal(await text("a-value-1"), "0.00");
  await slide("threshold-1", 0.55);
  assert.equal(await text("height-1"), "0.700");
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "FILL");
  assert.match(await text("regime-1"), /Self-sustained cycle/);
  await click("pause");
  await run(40);
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "DRAIN");
  assert.equal(await text("count-1"), "1");
  await slide("threshold-1", 1.65);
  await run(40);
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "DRAIN");
  await run(1000);
  await click("pause");
  assert.equal(await page.locator("#phase-1").getAttribute("data-phase"), "FILL");
  pass(
    "paused parameter edits defer motion; lowering the counterweight threshold triggers tipping and raising it does not abort drainage",
  );

  await click("reset");
  await setNoise(1, false);
  await click("pause");
  await click("pulse-1");
  assert.equal(await page.locator("#pulse-1").isDisabled(), true);
  await run(100);
  await click("pause");
  assert.ok(Number(await text("height-1")) > 0.84);
  assert.equal(await text("count-1"), "0");
  pass(
    "pulse queues once, increases actual water, and does not unconditionally drain",
  );
  await slide("r-0", 0.06);
  await slide("a-0", 0.1);
  await slide("threshold-0", 1.65);
  assert.match(await text("regime-0"), /Monostable/);
  assert.match(await text("regime-detail-0"), /bounded noise cannot reach/);
  pass(
    "dynamic regime label identifies bounded noise unable to reach the threshold",
  );

  await click("new-seed");
  assert.notEqual(await text("seed"), seed);
  assert.equal(await text("height-1"), "0.700");
  assert.equal(await text("count-1"), "0");
  await page.locator("#speed").evaluate((input) => {
    input.value = "2";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("pause");
  await run(1000);
  await click("pause");
  assert.ok(Math.abs(Number(await text("sim-time")) - 2) < 0.1);
  pass("new seed resets history and 2x playback advances only simulation time");
  await click("pause");
  await run(320);
  // Synchronize the throttled DOM readout to the current physical step before
  // hiding; a pause/resume pair advances no simulation time under this clock.
  await click("pause");
  await click("pause");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenTime = await text("sim-time");
  const hiddenHeights = [await text("height-0"), await text("height-1")];
  await run(5000);
  assert.equal(await text("sim-time"), hiddenTime);
  assert.deepEqual([await text("height-0"), await text("height-1")], hiddenHeights);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await run(320);
  await click("pause");
  const visibleAdvance = Number(await text("sim-time")) - Number(hiddenTime);
  assert.ok(Math.abs(visibleAdvance - 0.64) < 0.15, `resumed by ${visibleAdvance} simulated seconds`);
  pass("visibility-change handling stops physics and resumes without hidden-time catch-up");
  await click("reset");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  for (const width of [360, 640, 699, 768, 740, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await run(100);
    // Media-query and ResizeObserver callbacks use native layout scheduling,
    // which is separate from the mocked simulation animation clock.
    await page.waitForFunction(() => {
      const host = document.querySelector("#tank-scene");
      const headings = document.querySelector(".tank-headings");
      const canvas = host.querySelector("canvas");
      const mobile = matchMedia("(max-width: 699px)").matches;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      return (headings.parentElement === host) === mobile &&
        Math.abs(canvas.width - Math.floor(host.clientWidth * dpr)) <= 1 &&
        Math.abs(canvas.height - Math.floor(host.clientHeight * dpr)) <= 1;
    }, undefined, { polling: 100 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const annotations = await page
      .locator(".scene-annotation")
      .evaluateAll((nodes) =>
        nodes.filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
          const r = el.getBoundingClientRect();
          const host = el.closest("#tank-scene");
          const parent = host.getBoundingClientRect();
          const overlapsHeading = [...host.querySelectorAll(".tank-heading")].some(heading => {
            const h = heading.getBoundingClientRect();
            return r.left < h.right && r.right > h.left && r.top < h.bottom && r.bottom > h.top;
          });
          return {
            text: el.textContent,
            fits:
              r.left >= parent.left - 1 &&
              r.right <= parent.right + 1 &&
              r.top >= parent.top - 1 &&
              r.bottom <= parent.bottom + 1 && !overlapsHeading,
          };
        }),
      );
    assert.deepEqual(
      annotations.filter((a) => !a.fits),
      [],
      `scene labels clipped at ${width}`,
    );
    await page.screenshot({
      path: `test-results/viewport-${width}.png`,
      fullPage: true,
    });
  }
  pass(
    "360/640/699/740/768/1440 layouts have no page overflow or clipped apparatus labels",
  );
  await page.setViewportSize({ width: 360, height: 900 });
  await page.locator("#open-notes").click();
  assert.equal(await notes.isVisible(), true);
  assert.equal(await notes.evaluate(el => el.scrollWidth > el.clientWidth), false);
  await page.screenshot({ path: "test-results/notes-mobile.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator("#mode-bistable").click();
  assert.equal(await page.locator("#mode-bistable").getAttribute("aria-pressed"), "true");
  pass("mobile Notes drawer fits the viewport and the B mode control remains operable");
  await page.locator("#tank-scene > canvas").evaluate(canvas =>
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  assert.equal(await page.locator(".scene-fallback svg").count(), 2);
  await page.locator("#mode-monostable").click();
  assert.equal(await page.locator("#mode-monostable").getAttribute("aria-pressed"), "true");
  pass("WebGL context loss switches to SVG while retaining the mobile panel and mode controls");

  const fallback = await makePage({
    viewport: { width: 360, height: 900 },
    reducedMotion: "reduce",
    hasTouch: true,
    isMobile: true,
  });
  await fallback.clock.install({ time: new Date("2026-09-14T14:00:00Z") });
  await fallback.clock.pauseAt(new Date("2026-09-14T14:00:01Z"));
  await fallback.goto(`${url}?webgl=0`);
  assert.equal(await fallback.locator(".scene-fallback svg").count(), 2);
  assert.ok(Number(await fallback.locator(".scene-fallback svg").first().getAttribute("data-body-angle")) > .2);
  const touchWeight = fallback.locator("#counterweight-handle-0");
  await touchWeight.scrollIntoViewIfNeeded();
  const touchRect = await touchWeight.boundingBox();
  const touch = await fallback.context().newCDPSession(fallback);
  const tx = touchRect.x + touchRect.width / 2, ty = touchRect.y + touchRect.height / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tx, y: ty }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tx + 35, y: ty - 12 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const touchH = Number(await fallback.locator("#threshold-0").inputValue());
  assert.ok(Math.abs(touchH - .75) > .02, `touch drag changed H to ${touchH}`);
  assert.equal(Number(await touchWeight.getAttribute("aria-valuenow")), touchH);
  assert.equal(await fallback.locator("#height-0").textContent(), "0.700");
  pass("mobile SVG counterweight accepts a real touch drag and synchronizes its vertical slider");
  await fallback.locator("#reset").dispatchEvent("click");
  await fallback.locator("#parameter-settings > summary").click();
  await fallback.locator("#noise-1").uncheck();
  await fallback.locator("#pause").click();
  await fallback.locator("#pulse-1").click();
  await fallback.clock.runFor(200);
  await fallback.locator("#pause").click();
  assert.ok(Number(await fallback.locator("#height-1").textContent()) > 0.8);
  assert.equal(
    await fallback.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await fallback.screenshot({
    path: "test-results/fallback-mobile.png",
    fullPage: true,
  });
  pass(
    "WebGL fallback displays two working 2D tilting reservoirs and preserves live controls",
  );
  await fallback.locator("#mode-bistable").click();
  assert.equal(await fallback.locator("#kappa-value-1").textContent(), "0.80");
  await fallback.locator("#pause").click();
  await fallback.locator("#pulse-1").click();
  await fallback.clock.runFor(12000);
  await fallback.locator("#pause").click();
  const tippedSvg = fallback.locator(".scene-fallback svg").nth(1);
  assert.ok(Math.abs(Number(await tippedSvg.getAttribute("data-angle")) - .65) < 1e-6);
  assert.ok(Math.abs(Number(await tippedSvg.getAttribute("data-volume")) - .15) < 1e-3);
  assert.equal(await tippedSvg.locator("[data-surface]").getAttribute("y1"), await tippedSvg.locator("[data-surface]").getAttribute("y2"));
  assert.ok(Number(await tippedSvg.getAttribute("data-body-angle")) < 0, "the receiving end points down after tipping");
  await fallback.screenshot({ path: "test-results/fallback-bistable.png", fullPage: true });
  const vessel = fallback.locator(".scene-fallback svg").first();
  assert.ok((await vessel.locator("[data-tip-line]").getAttribute("d")).length > 20);
  // The trough carries the tipping threshold only: the return line and the
  // equilibria live in the plots, so no extra faint level lines remain.
  assert.equal(await vessel.locator("[data-return-line], [data-eq-line]").count(), 0);
  const tipLineBefore = await vessel.locator("[data-tip-line]").getAttribute("d");
  await fallback.locator("#threshold-0").evaluate((input) => {
    input.value = "1.40";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fallback.clock.runFor(60);
  assert.notEqual(await vessel.locator("[data-tip-line]").getAttribute("d"), tipLineBefore);
  pass("the trough marks the tipping threshold only, and that mark follows its parameter");
  // Regression: with the throttled fitting on B, dragging B's threshold used to
  // strip the baffle from the vessel and silently clear the selected button.
  const baffle = fallback.locator(".scene-fallback svg").nth(1).locator("[data-lip]");
  assert.equal(await baffle.getAttribute("data-deployed"), "true");
  await fallback.locator("#threshold-1").evaluate((input) => {
    input.value = "1.25";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await fallback.clock.runFor(60);
  assert.equal(await baffle.getAttribute("data-deployed"), "true");
  assert.equal(await fallback.locator("#mode-bistable").getAttribute("aria-pressed"), "true");
  pass("the retaining baffle and the selected fitting survive a threshold change");
  await fallback.locator("#open-notes").click();
  assert.equal(await fallback.locator("#notes-dialog").isVisible(), true);
  await fallback.keyboard.press("Escape");
  pass("SVG holds a genuinely tilted bistable state with horizontal water, while Notes remains available");
  assert.deepEqual(errors, []);
  pass(
    "no browser console errors, uncaught exceptions, or failed HTTP resources",
  );
  console.log(`Browser acceptance complete: ${checks} checks passed.`);
} finally {
  await browser.close();
}
