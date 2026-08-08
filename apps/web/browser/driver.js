// Drives the built application in a real browser: drop a video file on it, watch a clip appear,
// step frames, play. jsdom has no OPFS, no WebCodecs, no WebGL and no Web Audio, so nothing below
// the component boundary can be checked anywhere else. Same shape as packages/engine/gpu and
// packages/ui/browser, one level up: this one exercises the whole application.
(function () {
  const results = [];
  const noise = [];
  const realError = console.error.bind(console);
  console.error = function () {
    noise.push([...arguments].map(String).join(" "));
    realError.apply(null, arguments);
  };
  window.addEventListener("error", (e) => noise.push("window error: " + e.message));
  window.addEventListener("unhandledrejection", (e) => noise.push("rejection: " + String(e.reason)));

  // Two runs, two clocks, because no single one can answer both questions. Under
  // --virtual-time-budget a setTimeout fires with no real time passing, so a decoder would get
  // none either -- a pending fetch is what holds virtual time still while the real work happens.
  // But virtual time also stops the frame clock, and without requestAnimationFrame playback
  // cannot tick, so the run that watches playback runs on the wall clock instead. The virtual run
  // is the one that can read pixels back, because a stopped frame clock is also a drawing buffer
  // nobody has taken away yet.
  const virtual = location.search.includes("virtual");
  const sleep = virtual
    ? (ms) => fetch("/wait?ms=" + ms).then(() => undefined)
    : (ms) => new Promise((r) => setTimeout(r, ms));

  function check(name, got, want) {
    results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  }
  function checkAtLeast(name, got, limit) {
    results.push({ name, ok: typeof got === "number" && got >= limit, got, want: ">= " + limit });
  }
  function checkAtMost(name, got, limit) {
    results.push({ name, ok: typeof got === "number" && got <= limit, got, want: "<= " + limit });
  }
  function checkNear(name, got, want, tolerance) {
    const ok = typeof got === "number" && Math.abs(got - want) <= tolerance;
    results.push({ name, ok, got, want: want + " +/- " + tolerance });
  }

  // 100 ms rather than a tighter poll: under virtual time every wait is a held fetch that stops
  // the clock, and polling twice as often halves the stretches in which a decoder gets to run.
  // At 50 ms the first decode of a freshly opened medium never finished inside twenty seconds.
  const POLL_MS = 100;

  async function until(what, fn, budget) {
    for (let round = 0; round * POLL_MS < (budget || 20000); round += 1) {
      let value;
      try {
        value = fn();
      } catch (error) {
        value = undefined;
      }
      if (value) return value;
      await sleep(POLL_MS);
    }
    throw new Error("timed out waiting for " + what);
  }

  const q = (selector) => document.querySelector(selector);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const button = (label) => document.querySelector('button[aria-label="' + label + '"]');
  const labelled = (text) => all("button").find((node) => node.textContent.trim() === text);
  const position = () => q('[aria-label="Position"]').textContent.slice(0, 11);
  const banner = () =>
    [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent).join(" | ");
  const key = (name, target) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );

  function drag(type, zone, transfer) {
    const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
    zone.dispatchEvent(event);
    return event;
  }

  // Read back through the very context the application draws into. Only meaningful while the
  // frame clock is stopped; once the page compositor has taken the buffer it is gone.
  function litPixels() {
    const canvas = q("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl === null) return -1;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 12 || pixels[i + 1] > 12 || pixels[i + 2] > 12) lit += 1;
    }
    return lit;
  }

  // Mean channel value over the whole picture. `litPixels` counts, this weighs -- and a gain on
  // a clip is a change in weight long before it is a change in count.
  function luma() {
    const canvas = q("canvas");
    const gl = canvas.getContext("webgl2");
    if (gl === null) return -1;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    return sum / (pixels.length / 4) / 3;
  }

  function pointer(type, target, extra) {
    target.dispatchEvent(
      new PointerEvent(type, Object.assign({
        bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true,
        button: 0, buttons: type === "pointerup" ? 0 : 1, view: window,
      }, extra)),
    );
  }

  // React tracks the value it last wrote to a controlled input and swallows an `input` event
  // whose value it believes it already knows, so the assignment has to go through the prototype
  // setter rather than through the element.
  const writeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

  // One press, many moves, one release -- the shape a real drag has, and the only shape that can
  // show whether two hundred dispatches collapse into one entry on the undo stack.
  function dragSlider(input, values) {
    pointer("pointerdown", input);
    for (const value of values) {
      writeValue.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    pointer("pointerup", input);
  }

  const amountSlider = () => q('.v-inspector__effect input[type="range"]');
  const toStart = () => button("An den Anfang").click();
  const forward = (frames) => {
    for (let i = 0; i < frames; i += 1) button("Ein Bild vor").click();
  };

  // A decode under virtual time takes far longer than the wall clock suggests, and a redraw that
  // arrives while one is in flight is dropped rather than queued -- so a measurement waits for the
  // picture to actually turn over instead of for a number of milliseconds. Every reading below is
  // taken where the picture is bound to change, which is what makes that wait terminate.
  let onScreen = 0;

  async function repainted() {
    await until("the picture to be redrawn", function () {
      return luma() === onScreen ? undefined : [luma()];
    }, 60000);
    // A late frame can land right behind the first change; the settled value is the one that counts.
    await sleep(300);
    onScreen = luma();
    return onScreen;
  }

  async function pictureAfter(frames) {
    if (frames === 0) toStart();
    else forward(frames);
    return await repainted();
  }

  // The acceptance point of this milestone: brightness on a clip, two keyframes, and a change in
  // the picture over time -- read out of the drawing buffer of the built application, with every
  // step taken through the surface. The baseline is taken first at the very same three moments,
  // because the material is not uniformly bright over time and comparing 0 s against 0.5 s would
  // be reading the video rather than the keyframes.
  async function keyframes() {
    onScreen = luma();
    const base15 = await pictureAfter(15);
    const base30 = await pictureAfter(15);
    const base0 = await pictureAfter(0);
    checkAtLeast("there is a picture to darken in the first place", Math.round(base0), 8);

    pointer("pointerdown", q("[data-clip-id]"));
    pointer("pointerup", q("[data-clip-id]"));
    const add = await until("the inspector", () => labelled("Helligkeit hinzufügen"));
    check("selecting a clip opens its properties", q(".v-inspector") !== null, true);

    add.click();
    const row = await until("the brightness row", () => amountSlider());
    check("the parameter is named from the manifest, not from its key",
      row.labels[0].textContent, "Staerke");

    // The static parameter first. If a plain gain does not reach the picture there is no point in
    // asking what a keyframed one does, and the two failures look identical from the outside.
    dragSlider(amountSlider(), [0.6, 0.3, 0]);
    checkAtMost("a static brightness of zero blacks the clip out", Math.round(await repainted()), 1);
    dragSlider(amountSlider(), [0.5, 1]);
    checkNear("and back at one the picture is the one that was there",
      (await repainted()) / base0, 1, 0.02);

    button("Keyframe für Staerke am Playhead").click();
    await sleep(200);
    check("the switch reports the keyframe it just set",
      button("Keyframe für Staerke am Playhead").getAttribute("aria-pressed"), "true");

    dragSlider(amountSlider(), [0.8, 0.6, 0.4, 0.2, 0.1, 0]);
    await repainted();
    check("a drag over a keyframed parameter leaves the value it ended on",
      Number(amountSlider().value), 0);

    forward(30);
    await sleep(400);
    check("one keyframe alone holds its value across the whole clip",
      Number(amountSlider().value), 0);
    dragSlider(amountSlider(), [0.2, 0.4, 0.6, 0.8, 1]);
    await repainted();
    check("the second keyframe is set where the playhead stands",
      button("Keyframe für Staerke am Playhead").getAttribute("aria-pressed"), "true");

    const dark = await pictureAfter(0);
    const half = await pictureAfter(15);
    const shown = Number(amountSlider().value);
    const full = await pictureAfter(15);

    checkAtMost("at the first keyframe the picture really is black", Math.round(dark), 1);
    checkNear("halfway between them it is half as bright as that same frame was",
      half / base15, 0.5, 0.05);
    checkNear("at the second keyframe it is the picture that was there before",
      full / base30, 1, 0.02);
    checkNear("and the row shows the value the core interpolated, not a static one",
      shown, 0.5, 0.01);

    // Sixteen dispatches went into the four drags. Without coalescing that would be sixteen
    // entries plus two; the count comes out of the real Rust core rather than out of a mock.
    let steps = 0;
    while (amountSlider() !== null && steps < 20) {
      labelled("Rückgängig").click();
      steps += 1;
      await sleep(150);
    }
    check("the whole session is six undo steps, not eighteen", steps, 6);
    checkNear("and undoing it puts the picture back where it started",
      (await pictureAfter(0)) / base0, 1, 0.02);
  }

  async function run() {
    await until("the editor", () => q(".v-dropzone") && q('[data-testid="timeline"]'));
    check("nothing is wrong before anything happened", banner(), "");
    check("WebGL2 is up behind the preview", q("canvas").getContext("webgl2") !== null, true);

    const bytes = await (await fetch("/fixture.mp4")).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "fixture.mp4", { type: "video/mp4" }));
    const zone = q(".v-dropzone");

    drag("dragenter", zone, transfer);
    await sleep(200);
    // React schedules its re-render on a task, and the virtual run holds virtual time still for
    // the length of every wait -- so no task runs and the overlay is not there yet. A harness
    // artefact, not a finding; the wall-clock run is where this is answered.
    if (!virtual) {
      check("the drop hint appears while a file is over the editor",
        q(".v-dropzone__overlay") !== null, true);
    }
    const dropped = drag("drop", zone, transfer);
    check("the drop is taken, not left to the browser", dropped.defaultPrevented, true);

    const clip = await until("a clip on the timeline", () => q("[data-clip-id]"));
    check("the import raised nothing", banner(), "");
    check("the drop hint is gone again", q(".v-dropzone__overlay"), null);
    check("the clip is as wide as two seconds at the default zoom",
      Math.round(clip.getBoundingClientRect().width), 200);
    check("a track was created to hold it",
      document.querySelectorAll(".v-timeline__header").length, 1);

    if (virtual) {
      checkAtLeast("the preview shows a decoded frame",
        await until("a decoded frame", () => (litPixels() > 1000 ? litPixels() : 0)), 1000);
    }

    check("the transport starts at zero", position(), "00:00:00.00");
    button("Ein Bild vor").click();
    await sleep(100);
    check("one frame forward is one frame", position(), "00:00:00.01");
    for (let i = 0; i < 29; i += 1) button("Ein Bild vor").click();
    await sleep(200);
    check("thirty frames make a second", position(), "00:00:01.00");

    if (virtual) {
      checkAtLeast("and the picture a second in is decoded too",
        await until("a frame at one second", () => (litPixels() > 1000 ? litPixels() : 0)), 1000);
    }

    // The keys belong to the editor, and the hands are on the timeline.
    key("ArrowLeft", q(".v-timeline__scroll"));
    await sleep(100);
    check("an arrow key steps from inside the timeline", position(), "00:00:00.29");

    button("An den Anfang").click();
    await sleep(100);
    check("the jump to the start lands on zero", position(), "00:00:00.00");
    button("Ans Ende").click();
    await sleep(100);
    check("the jump to the end lands on the end of the material", position(), "00:00:02.00");
    button("An den Anfang").click();
    await sleep(100);

    // Reading pixels back needs the stopped frame clock, so the keyframe run belongs here -- and
    // it undoes itself at the end, which is what leaves the playback section below an untouched
    // project to work with.
    if (virtual) await keyframes();

    key(" ", document.body);
    await until("the transport to report playing", () => button("Anhalten") !== null, 8000);
    check("the space bar starts playback from outside the transport",
      button("Anhalten") !== null, true);

    // Everything past here needs a frame clock. The screenshot run stops on a decoded picture
    // with the transport reporting that it is running.
    if (virtual) {
      checkAtLeast("the picture is still there once playback has started",
        await until("a frame while playing", () => (litPixels() > 1000 ? litPixels() : 0)), 1000);
      return;
    }

    const before = position();
    await sleep(1200);
    const after = position();
    check("the playhead moves while playing", before !== after, true);
    checkAtLeast("and it covers about a second in a second",
      Number(after.slice(6, 8)) * 30 + Number(after.slice(9, 11)), 20);
    check("playback raises nothing", banner(), "");

    key(" ", document.body);
    await sleep(200);
    check("the space bar pauses again", button("Abspielen") !== null, true);
    const paused = position();
    await sleep(500);
    check("and the playhead stands still once paused", position(), paused);
  }

  run()
    .catch((error) => {
      results.push({ name: "the run itself", ok: false, got: String(error), want: "no throw" });
    })
    .then(() => {
      if (noise.length > 0) {
        results.push({ name: "nothing reached the console", ok: false, got: noise, want: [] });
      }
      return fetch("/results", { method: "POST", body: JSON.stringify(results) });
    });
})();
