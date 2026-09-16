export const notesMarkup = `
<dialog id="notes-dialog" class="notes-dialog" aria-labelledby="notes-title">
  <header class="notes-header"><div><p class="notes-eyebrow">The tipping point</p><h2 id="notes-title">Notes</h2></div><button id="close-notes" aria-label="Close notes" autofocus><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
  <div class="notes-content">
    <section class="note-section"><h3>Same apparatus, different dynamics</h3><p>Water falls from a fixed spout into each beveled bamboo reservoir: A is the steady-inflow reference, B receives random inflow fluctuations. A small outlet leaks continuously, and a movable counterweight sets the tipping threshold. Once tipped, a controlled lower outlet opens.</p><p><strong>A cycle</strong> crosses both thresholds unaided. In a <strong>monostable, excitable regime</strong>, a sufficient fluctuation triggers one brief excursion before the water returns toward the same resting state. In a <strong>bistable regime</strong>, receiving and pouring each have a stable equilibrium at the same parameters. Receiving, pouring and returning are movement stages, not three stable states; a single tip does not prove bistability.</p></section>
    <section class="note-section"><h3>Try one or two resting states</h3><p>The Monostable and Bistable buttons set B’s mean inflow to 0.144 and its threshold to 1.00, and its outlet coefficient κ to 8.00 or 0.80. Current water, tilt, noise, time and history are preserved.</p><p>With B’s noise off, the receiving equilibrium is 0.90 either way. Monostable would balance tilted at about 0.018, below the return threshold 0.12, so it returns first; the bistable pouring equilibrium is 0.15, so it can stay tilted. In Bistable, let B approach 0.90, add 0.15 units of water, and it settles on the other branch; briefly reduce inflow past 0.12 to come back. The buttons choose the outlet fitting: adjusting the inflow or the threshold keeps the fitting selected and the baffle in place, while changing the outlet coefficient clears it, and the regime label always reports the actual dynamics.</p></section>
    <details class="note-section"><summary>Equations &amp; mechanics</summary><div class="note-detail"><p>V is normalized stored water, not the height of the tilted surface; all values are relative units and simulation seconds are not climate years.</p><div class="formula">q(t) = r [1 + a tanh(z(t))]<br/>g(θ) = clamp[(θ − 0.40)/0.25, 0, 1]<br/>dV/dt = q(t) − kV − κg(θ)V − Q<sub>spill</sub><br/>V*<sub>receiving</sub> = r/k<br/>V*<sub>pouring</sub> = min[r/(k + κ), V<sub>rim</sub>]</div><p>The outlet opens only as the reservoir tips downward, so the tip and the return each take 0.15 s while inflow, slow leak and drainage continue. Water above the retaining rim leaves as Qspill and is counted. Two stable branches need r/k &lt; H and a pouring equilibrium above 0.12, limited by the rim’s retained volume. Threshold equalities are critical cases, not automatic crossings.</p><dl class="model-constants"><div><dt>Slow leak k</dt><dd>0.16</dd></div><div><dt>Return threshold</dt><dd>0.12</dd></div><div><dt>Noise correlation τ</dt><dd>1.2 s</dd></div><div><dt>Physics time step</dt><dd>1/120 s</dd></div><div><dt>Initial stored water</dt><dd>0.70</dd></div><div><dt>Initial mean inflow</dt><dd>0.144</dd></div></dl><p>The vessel and its counterweight are a simplified teaching model inspired by a shishi-odoshi, not a rigid-body or fluid simulation. A transparent baffle rises into the lower mouth whenever the outlet is throttled, so the tilted branch can hold water. Every inflow, leak, pour, spill and added pulse enters the volume balance.</p></div></details>
    <details class="note-section"><summary>Reading the plots</summary><div class="note-detail"><p>The tipping threshold is marked on the vessel itself as a dashed oxide-red band; the return threshold and the noise-free equilibria stay in the plots. Hover or touch a plot for the stored water, threshold and time at that moment.</p><p>In the plots the solid trace is stored water, shaded bands mark the real tilted or returning stages, a dot marks each tip and a plus marks added water. The two plots share their time window and vertical scale, and reference lines keep their historical values.</p></div></details>
    <details class="note-section"><summary>Randomness &amp; replay</summary><div class="note-detail"><p>Both reservoirs read the same OU colored-noise signal z, so equal noise strengths give matching relative fluctuations while different mean inflows give different absolute ones. Pause stops the simulation clock and the random process; disabling one reservoir’s noise keeps its water, tilt and history.</p><div class="seed-controls"><span>Seed <code id="seed"></code></span><button id="new-seed">New random sequence</button></div><p>Reset &amp; replay restarts this comparison with the current seed at 0.70 in the receiving pose; a new sequence restarts it with a different seed. Identical seeds, states, parameters and operation times reproduce the same trajectory, and no event is ever placed on a timer.</p><p id="event-log">No tipping events yet.</p></div></details>
    <details class="note-section"><summary>Context &amp; references</summary><div class="note-detail"><p>Slow accumulation followed by sudden change does not by itself distinguish self-sustained oscillation from noise-triggered dynamics; ask whether the system crosses the threshold unaided, returns to one state, or can remain in either of two. This analogy does not establish one mechanism for all Dansgaard–Oeschger events, and stored water is not a temperature proxy. “Noise” here means rapid inflow fluctuations.</p><div class="references"><a href="https://www.bambooaccents.com/products/12-rocking-fountain" target="_blank" rel="noopener noreferrer">Bamboo Accents — Rocking bamboo fountain ↗</a><a href="https://najga.org/japanese-garden-basins/" target="_blank" rel="noopener noreferrer">North American Japanese Garden Association — Garden basins ↗</a><a href="https://fcit.usf.edu/florida/photos/recreate/tour/morik/morik2/morik201.htm" target="_blank" rel="noopener noreferrer">University of South Florida — Shish Odoshi ↗</a><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC3047297/" target="_blank" rel="noopener noreferrer">Helias et al. (2011) — A leaky shishi-odoshi analogy ↗</a><a href="https://doi.org/10.1175/JCLI-D-17-0559.1" target="_blank" rel="noopener noreferrer">Vettoretti &amp; Peltier (2018) — Self-sustained oscillations ↗</a><a href="https://doi.org/10.1175/JCLI-D-23-0308.1" target="_blank" rel="noopener noreferrer">Riechers, Gottwald &amp; Boers (2024) — Excitable dynamics ↗</a><a href="https://arxiv.org/abs/2303.04063" target="_blank" rel="noopener noreferrer">Riechers et al. — Open manuscript ↗</a><a href="https://doi.org/10.1038/s41561-022-00920-7" target="_blank" rel="noopener noreferrer">Vettoretti et al. (2022) — CO₂ modulation ↗</a></div><p>The fountain references support the traditional form and tipping action; Helias et al. supports adding a leak as a loss mechanism. The counterweight, outlet, finite rotation and parameter choices are specific to this teaching model.</p></div></details>
    <footer class="notes-author"><p>Peisong Zheng</p><p>University Of Cambridge</p><a href="mailto:pz285@cam.ac.uk">pz285@cam.ac.uk</a><a href="mailto:zheng_peisong@foxmail.com">zheng_peisong@foxmail.com</a><p class="built-with">Built with ChatGPT6 Astra</p></footer>
  </div>
</dialog>`;

export function wireNotes() {
  const dialog = document.getElementById("notes-dialog") as HTMLDialogElement;
  const open = document.getElementById("open-notes") as HTMLButtonElement;
  const close = document.getElementById("close-notes") as HTMLButtonElement;
  let returnFocus: HTMLElement | null = null;
  const openNotes = () => {
    returnFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    document.documentElement.classList.add("notes-open");
  };
  const closeNotes = () => dialog.close();
  const onClose = () => {
    document.documentElement.classList.remove("notes-open");
    (returnFocus?.isConnected ? returnFocus : open).focus();
  };
  const onBackdropClick = (event: MouseEvent) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
      dialog.close();
  };
  const containFocus = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const stops = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.matches(":disabled") && element.getClientRects().length > 0);
    const first = stops[0];
    const last = stops.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  open.addEventListener("click", openNotes);
  close.addEventListener("click", closeNotes);
  dialog.addEventListener("close", onClose);
  dialog.addEventListener("click", onBackdropClick);
  dialog.addEventListener("keydown", containFocus);
  return {
    dispose() {
      if (dialog.open) dialog.close();
      document.documentElement.classList.remove("notes-open");
      open.removeEventListener("click", openNotes);
      close.removeEventListener("click", closeNotes);
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("click", onBackdropClick);
      dialog.removeEventListener("keydown", containFocus);
    },
  };
}
