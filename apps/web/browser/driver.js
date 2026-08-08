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
  // The phone run is its own script: what it has to answer is about boxes in a 390 px viewport,
  // and jsdom computes no boxes at all. It runs on the virtual clock so the picture survives to
  // be read back and photographed.
  const phone = location.search.includes("phone");
  const sleep = virtual
    ? (ms) => fetch("/wait?ms=" + ms).then(() => undefined)
    : (ms) => new Promise((r) => setTimeout(r, ms));

  function check(name, got, want) {
    results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  }
  function checkAtLeast(name, got, limit) {
    results.push({ name, ok: typeof got === "number" && got >= limit, got, want: ">= " + limit });
  }
  function checkNear(name, got, want, tolerance) {
    const ok = typeof got === "number" && Math.abs(got - want) <= tolerance;
    results.push({ name, ok, got, want: want + " ± " + tolerance });
  }

  async function until(what, fn, budget) {
    for (let round = 0; round * 50 < (budget || 20000); round += 1) {
      let value;
      try {
        value = fn();
      } catch (error) {
        value = undefined;
      }
      if (value) return value;
      await sleep(50);
    }
    throw new Error("timed out waiting for " + what);
  }

  const q = (selector) => document.querySelector(selector);
  const button = (label) => document.querySelector('button[aria-label="' + label + '"]');
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

  // Only the page knows when a moment is worth photographing; Node holds the devtools connection
  // and takes the picture when asked.
  const photograph = (name) => fetch("/shot?name=" + name).then(() => undefined);

  const labelled = (label) =>
    [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === label);

  // A finger, not a mouse: pointerType decides the size of the trim zones, so a drag that claims
  // to be touch is the only one that proves the phone path.
  function finger(type, target, x, y) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );
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

  // Everything a phone has to be able to do: bring material in, arrange it with a finger, and
  // play it -- on a viewport where the preview, the library and the timeline cannot all fit.
  // Wall clock, because every claim here is about a box, and layout under --virtual-time-budget
  // lags behind the DOM: the clip's inline style says it moved while its rect still says it did
  // not. Harness artefact, not a finding -- the run below reads the picture instead.
  async function runPhone() {
    await until("the editor", () => q(".v-dropzone") && q('[data-testid="timeline"]'));
    const box = (selector) => q(selector).getBoundingClientRect();
    const tabs = () => [...document.querySelectorAll(".v-panels__tab")];

    check("a 390 px viewport is a phone", q('[data-testid="app-shell"]').dataset.layout, "phone");
    check("both panels are one tap away", tabs().map((tab) => tab.textContent), [
      "Medien",
      "Zeitleiste",
    ]);
    checkAtLeast(
      "and a tab is tall enough for a thumb",
      Math.min(...tabs().map((tab) => tab.getBoundingClientRect().height)),
      44,
    );
    check("the timeline is what the editor opens on", q('[data-testid="library"]'), null);
    check("the editor fits the window instead of overflowing it", box(".v-editor").width, innerWidth);

    const clip = await dropFixture();
    check("the import raised nothing", banner(), "");

    // The picture stays put while the panels take turns under it -- that is the whole reason
    // the phone layout is a tab bar and not a third pane.
    check(
      "the picture sits above the panels and inside the window",
      box(".v-preview").bottom <= box(".v-panels").top &&
        box(".v-transport").bottom <= innerHeight &&
        box(".v-panels").bottom <= innerHeight,
      true,
    );
    checkAtLeast("and the panel below it is worth showing", box(".v-timeline").height, 200);

    // Cutting with a finger: grab the clip in its middle, well inside the 44 px trim zones at
    // either end, and carry it a second and a bit to the right across empty timeline.
    const before = clip.getBoundingClientRect();
    const x = before.left + before.width / 2;
    const y = before.top + before.height / 2;
    // Where the clip sits on the timeline, not where it sits on the screen: the scroll container
    // travels with the dragged clip, so a viewport measurement would report one that never moved.
    const alongTheTimeline = () => q("[data-clip-id]").offsetLeft;
    const startedAt = alongTheTimeline();

    finger("pointerdown", clip, x, y);
    finger("pointermove", clip, x + 120, y);
    finger("pointerup", clip, x + 120, y);
    await sleep(200);

    checkNear("a finger drags the clip along the timeline", alongTheTimeline() - startedAt, 120, 6);
    check("dragging raised nothing", banner(), "");

    labelled("Rückgängig").click();
    await sleep(200);
    check("and the whole drag is one step back", alongTheTimeline(), startedAt);

    labelled("Medien").click();
    await until("the library", () => q('[data-testid="library"]'));
    check("switching panels puts the timeline away", q('[data-testid="timeline"]'), null);
    check("the picture is still there", box(".v-preview").bottom <= box(".v-panels").top, true);
    const entry = q("[data-media-id]").textContent;
    check(
      "the library says what it holds",
      ["fixture.mp4", "00:00:02.00", "640 × 360"].every((part) => entry.includes(part)),
      true,
    );
    await photograph("phone-library");

    labelled("Auf die Zeitleiste").click();
    await until("the timeline again", () => q('[data-testid="timeline"]'));
    check(
      "placing a medium shows where it landed",
      document.querySelectorAll("[data-clip-id]").length,
      2,
    );
    check("placing it raised nothing", banner(), "");

    button("Abspielen").click();
    await until("the transport to report playing", () => button("Anhalten") !== null, 8000);
    const standing = position();
    await sleep(1000);
    check("the playhead moves while a phone plays", position() !== standing, true);
    check("playing raised nothing", banner(), "");
    await photograph("phone");
  }

  async function dropFixture() {
    const bytes = await (await fetch("/fixture.mp4")).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "fixture.mp4", { type: "video/mp4" }));
    drag("drop", q(".v-dropzone"), transfer);
    return until("a clip on the timeline", () => q("[data-clip-id]"));
  }

  (phone ? runPhone() : run())
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
