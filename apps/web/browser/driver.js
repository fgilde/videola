// Drives the built application in a real browser: drop a video file on it, watch a clip appear,
// step frames, play. jsdom has no OPFS, no WebCodecs, no WebGL and no Web Audio, so nothing below
// the component boundary can be checked anywhere else. Same shape as packages/engine/gpu and
// packages/ui/browser, one level up: this one exercises the whole application.
// Both harnesses look controls up by their German labels, and the language otherwise follows
// the browser: German on this machine, English on a CI runner. Pinning it is what makes the
// two runs the same run.
localStorage.setItem("videola.locale", "de");
// The theme toggle is labelled with the theme it switches *to*, so its text follows
// prefers-color-scheme: "Hell" on a dark runner, "Dunkel" on a light one. Pinned for the same
// reason as the language.
localStorage.setItem("videola.theme", "dark");

// Chrome ships without proprietary codecs on some builds -- the CI runner decodes no H.264 at all
// -- so the fixture follows what this browser can actually read. Both files hold the same two
// seconds of colour bars; only the container differs.
// Resolved once inside the run: this file is a classic script, so there is no top-level await.
let FIXTURE = { name: "fixture.mp4", type: "video/mp4" };

async function pickFixture() {
  try {
    const support = await VideoDecoder.isConfigSupported({
      codec: "avc1.42001E",
      codedWidth: 640,
      codedHeight: 360,
    });
    if (support.supported === true) return;
  } catch {
    // No decoder at all answers the question the same way a refusal does.
  }
  FIXTURE = { name: "fixture.webm", type: "video/webm" };
}

// Printed on every run, not only a failing one: which container the browser could read, and
// whether WebGL2 came up at all, are the two facts that explain most of what follows.
async function announce() {
  let webgl = "no";
  try {
    webgl = document.createElement("canvas").getContext("webgl2") === null ? "no" : "yes";
  } catch {
    webgl = "threw";
  }
  let decoders = [];
  for (const codec of ["avc1.42001E", "vp09.00.10.08", "vp8"]) {
    try {
      const ok = await VideoDecoder.isConfigSupported({ codec, codedWidth: 640, codedHeight: 360 });
      if (ok.supported) decoders.push(codec);
    } catch {
      // Unsupported and unaskable are the same answer here.
    }
  }
  window.__videolaEnv =
    `fixture=${FIXTURE.name} webgl2=${webgl} decoders=${decoders.join("|") || "none"}`;
}

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
  // The template run is its own script for the same reason the phone run is: what it has to answer
  // is whether a baked template can be *seen*, which means reading the drawing buffer, which means
  // the virtual clock.
  const templates = location.search.includes("templates");
  // The tablet is the only viewport where the library and the timeline are on screen together, so
  // it is the only one where a drag between them can be driven at all -- and it had no run of its
  // own until now, only a layout rule nobody had ever seen.
  const tablet = location.search.includes("tablet");
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

  // Under virtual time every wait is a held fetch that stops the clock, so a tighter poll leaves
  // the decoder shorter stretches to run in, not more of them. At 50 ms a freshly opened medium
  // never finished on this machine; at 100 it still did not on a two-core CI runner.
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
  // The project actions moved behind the topbar's overflow disclosure. A <summary> carries no
  // button role, so it cannot be looked up as one -- and a person has to open it before reaching
  // anything inside, which is exactly what this does.
  const openMenu = () => {
    const menu = q(".v-topbar__more");
    if (menu !== null) menu.open = true;
    return menu;
  };
  const inMenu = (text) =>
    all(".v-topbar__menu button").find((node) => node.textContent.trim() === text);
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
    // The preview by name, not "the first canvas on the page": since the library draws thumbnails
    // there is more than one, and which comes first depends on when a decode finishes. The check
    // then measured a 2D thumbnail, got no WebGL2 context out of it, and waited for a picture that
    // was on screen the whole time.
    const canvas = q(".v-preview__canvas");
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
    const canvas = q(".v-preview__canvas");
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
    check("WebGL2 is up behind the preview", q(".v-preview__canvas").getContext("webgl2") !== null, true);

    const bytes = await (await fetch("/" + FIXTURE.name)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], FIXTURE.name, { type: FIXTURE.type }));
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

    // The autosave in the browser it actually runs in: a real interval, real OPFS, a real
    // project. Virtual time only, because the timer is half a minute out and the wall-clock run
    // is shorter than that on purpose -- an autosave that fired on every edit would be one.
    if (virtual) {
      let snapshot;
      for (let round = 0; round < 150 && snapshot === undefined; round += 1) {
        snapshot = await autosaved();
        if (snapshot === undefined) await sleep(POLL_MS);
      }
      check("the timeline reaches storage without anyone asking for it",
        snapshot?.project?.timeline?.tracks?.[0]?.clips?.length, 1);
      // The whole reason a snapshot can be this frequent: it carries no media. Those are in OPFS
      // under their content hash already, which is where the renderer reads them from.
      check("and the snapshot carries the project alone",
        Object.keys(snapshot ?? {}).sort(), ["project", "savedAt"]);
    }

    if (virtual) {
      checkAtLeast("the preview shows a decoded frame",
        await until("a decoded frame", () => (litPixels() > 1000 ? litPixels() : 0), 90000), 1000);
    }

    // The whole audio chain, end to end and for real: bytes out of OPFS, a decode, peaks off the
    // buffers the graph already holds, and an SVG path. Nothing below this line is reachable from a
    // unit test -- jsdom has no OPFS, no decoder and no audio context.
    const strip = await until("a waveform strip", () => q('[data-testid="clip-waveform"]'));
    const path = strip.querySelector("path").getAttribute("d");
    checkAtLeast("the strip is drawn from real peaks, not a placeholder",
      path.split("L").length, 600);
    check("and it is stretched to the clip rather than measured in pixels",
      strip.getAttribute("preserveAspectRatio"), "none");
    // The y of every corner, which is what carries the signal -- reading the x instead would be
    // true of any path at all and prove nothing. Silence sits on the hairline at 0.99, so a peak
    // reaching well above it is the difference between a decoded signal and an empty strip.
    const peak = Math.min(...[...path.matchAll(/ (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])));
    checkAtMost("the strip carries a signal and not a flat line", peak, 0.9);

    check("the transport starts at zero", position(), "00:00:00.00");
    button("Ein Bild vor").click();
    await sleep(100);
    check("one frame forward is one frame", position(), "00:00:00.01");
    for (let i = 0; i < 29; i += 1) button("Ein Bild vor").click();
    await sleep(200);
    check("thirty frames make a second", position(), "00:00:01.00");

    if (virtual) {
      checkAtLeast("and the picture a second in is decoded too",
        await until("a frame at one second", () => (litPixels() > 1000 ? litPixels() : 0), 90000), 1000);
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

    // R128 against a real OfflineAudioContext, over a real decode. Wall clock only: a measurement
    // renders the whole timeline, and under a virtual-time budget the decoder never gets a turn.
    check("the mixer starts with nothing measured",
      q('[data-testid="mixer-loudness"]').textContent, "Nicht gemessen");
    labelled("Lautheit messen").click();
    const reading = await until("a loudness reading",
      () => (q('[data-testid="mixer-loudness"]').textContent.endsWith("LUFS")
        ? q('[data-testid="mixer-loudness"]').textContent : null));
    // Measured, not assumed: the fixture reads -21.8 LUFS. Its peaks only reach about -15 dBFS, so
    // this is dense material with little crest -- loudness and peak are different questions and the
    // fixture is a good reminder of it. The band is wide enough not to be a golden number and narrow
    // enough that silence, a missing offset or an unweighted mean all fall outside it.
    const lufs = Number(reading.replace(" LUFS", ""));
    checkAtMost("the programme measures in the band the fixture belongs in", lufs, -15);
    checkAtLeast("and not lower than the material can be", lufs, -30);
    check("measuring raised nothing", banner(), "");
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
    check("every panel is one tap away", tabs().map((tab) => tab.textContent), [
      "Medien",
      "Zeitleiste",
      "Eigenschaften",
      "Mischpult",
    ]);
    checkAtLeast(
      "and a tab is tall enough for a thumb",
      Math.min(...tabs().map((tab) => tab.getBoundingClientRect().height)),
      44,
    );

    // The check that was missing while the topbar ran off the right edge. A bar that scrolls
    // sideways has more content than box; one that fits has exactly as much.
    const topbar = q(".v-topbar");
    check("the topbar fits its window instead of running off the right edge",
      [topbar.scrollWidth, topbar.getBoundingClientRect().right <= innerWidth],
      [topbar.clientWidth, true]);
    check("nothing on the page scrolls sideways",
      document.documentElement.scrollWidth <= innerWidth, true);
    // Every control on the bar, measured rather than counted: three of them, each a thumb wide.
    const barControls = [...document.querySelectorAll(".v-topbar > button, .v-topbar > details > summary")];
    check("the bar carries the overflow toggle, undo and redo",
      barControls.map((node) => node.getAttribute("aria-label") ?? node.textContent),
      ["Weitere Aktionen", "Rückgängig", "Wiederholen"]);
    checkAtLeast("each of them a thumb wide",
      Math.min(...barControls.map((node) => node.getBoundingClientRect().width)), 44);

    // Reachable, not merely present: the menu opens and the actions inside it are real buttons
    // with room to hit, all of it inside a 390 px window.
    openMenu();
    const menu = q(".v-topbar__menu");
    check("the menu holds every action the bar gave up",
      [...menu.querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? node.textContent),
      ["Neues Projekt", "Aus Vorlage", "Öffnen", "Medien importieren", "Spur hinzufügen",
       "Exportieren", "Deutsch / English", "Hell", "Speichern"]);
    check("and the open menu stays inside the window",
      menu.getBoundingClientRect().right <= innerWidth && menu.getBoundingClientRect().left >= 0,
      true);
    checkAtLeast("with rows a thumb can hit",
      Math.min(...[...menu.querySelectorAll("button")].map((n) => n.getBoundingClientRect().height)),
      44);
    q(".v-topbar__more").open = false;
    check("the timeline is what the editor opens on", q('[data-testid="library"]'), null);
    check(
      "the editor fits the window, and the picture and the panel get all of it",
      [box(".v-editor").width, box(".v-preview").width, box(".v-timeline").width],
      [innerWidth, innerWidth, innerWidth],
    );

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
    // The preview row is capped rather than flexible for one reason: a 16:9 picture in a 390 px
    // column is 220 px tall, and an even split would hand a third of the screen to letterbox that
    // the timeline needs. Measured as the slack around the picture, not as the cap itself.
    check(
      "the picture pane is not mostly empty space",
      box(".v-preview").height - box(".v-preview__canvas").height <= 90,
      true,
    );

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
      [FIXTURE.name, "00:00:02.00", "640 × 360"].every((part) => entry.includes(part)),
      true,
    );

    // A picture, and one that came out of the file rather than out of the stylesheet. An <img>
    // that failed to load reports naturalWidth 0, so a broken or absent still cannot pass here.
    const thumb = await until("the thumbnail", () => {
      const image = q(".v-library__thumb");
      return image !== null && image.complete && image.naturalWidth > 0 ? image : null;
    }, 90000);
    check("the library entry carries a still decoded from the medium",
      [thumb.naturalWidth, thumb.naturalHeight], [160, 90]);
    check("and it is drawn at a size that leaves room for the list",
      thumb.getBoundingClientRect().width <= 120, true);
    // Not a uniform tile: a still that is one flat colour is what a placeholder would look like.
    checkAtLeast("the still is a frame and not a flat rectangle", spread(thumb), 40);

    // The native picker is the only way to a phone camera, and `capture` is the attribute that
    // asks for it. What the camera then does is outside anything headless can answer.
    const capture = q('.v-library__capture input[capture]');
    check("recording goes through a native capture input",
      capture === null ? null : [capture.accept, capture.getAttribute("capture")],
      ["video/*", "environment"]);
    const gallery = [...all(".v-library__capture input")].find((i) => !i.hasAttribute("capture"));
    check("and the gallery through the same input without it",
      gallery === undefined ? null : [gallery.accept, gallery.multiple], ["video/*", true]);
    checkAtLeast("both a thumb tall",
      Math.min(...all(".v-library__capture").map((n) => n.getBoundingClientRect().height)), 44);

    await photograph("phone-library");

    labelled("Auf die Zeitleiste").click();
    await until("the timeline again", () => q('[data-testid="timeline"]'));
    check(
      "placing a medium shows where it landed",
      document.querySelectorAll("[data-clip-id]").length,
      2,
    );
    check("placing it raised nothing", banner(), "");

    // The point of the third tab. Effects, keyframes and transitions were unreachable on a phone
    // while the properties panel sat squeezed between the transport and the tab bar.
    finger("pointerdown", q("[data-clip-id]"), 0, 0);
    finger("pointerup", q("[data-clip-id]"), 0, 0);
    labelled("Eigenschaften").click();
    const inspector = await until("the properties panel", () => q('[data-testid="inspector"]'));
    check("choosing properties puts the timeline away", q('[data-testid="timeline"]'), null);
    check("the picture is still above it", box(".v-preview").bottom <= box(".v-panels").top, true);

    const add = await until("the brightness button", () => labelled("Helligkeit hinzufügen"));
    checkAtLeast("adding an effect is a thumb-sized target",
      add.getBoundingClientRect().height, 44);
    add.click();
    const slider = await until("the parameter row",
      () => q('.v-inspector__effect input[type="range"]'));
    check("a phone can put an effect on a clip and see its parameter",
      slider.labels[0].textContent, "Staerke");
    check("and the keyframe switch is there too",
      button("Keyframe für Staerke am Playhead") !== null, true);
    check("the panel fits the window", inspector.getBoundingClientRect().right <= innerWidth, true);
    check("putting an effect on a clip raised nothing", banner(), "");
    await photograph("phone-inspector");

    labelled("Rückgängig").click();
    await sleep(200);
    labelled("Zeitleiste").click();
    await until("the timeline again", () => q('[data-testid="timeline"]'));

    button("Abspielen").click();
    await until("the transport to report playing", () => button("Anhalten") !== null, 8000);
    const standing = position();
    await sleep(1000);
    check("the playhead moves while a phone plays", position() !== standing, true);
    check("playing raised nothing", banner(), "");
    await photograph("phone");
  }

  // A controlled React input does not notice `input.value = x`: React remembers the value it wrote
  // last and treats an identical one as no change. Going through the prototype's own setter is what
  // makes the assignment visible to it.
  function setValue(element, value) {
    const prototype =
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // The one way a real browser lets a script hand a file to <input type="file">: assigning a
  // FileList built by a DataTransfer. That is exactly why the wizard uses a native input and not a
  // scripted picker.
  async function chooseFile(input, name) {
    const bytes = await (await fetch("/" + FIXTURE.name)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: "video/mp4" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Two counts out of one read: how much of the frame carries a picture, and how much of it is
  // still the bare background. The second one is what a brightness-based count cannot answer --
  // a dark shot is dark whether it was fitted or not, but background is background.
  function measure(background) {
    const canvas = q(".v-preview__canvas");
    const gl = canvas.getContext("webgl2");
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    let bare = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 12 || pixels[i + 1] > 12 || pixels[i + 2] > 12) lit += 1;
      const off =
        Math.abs(pixels[i] - background[0]) +
        Math.abs(pixels[i + 1] - background[1]) +
        Math.abs(pixels[i + 2] - background[2]);
      if (off <= 9) bare += 1;
    }
    const total = pixels.length / 4;
    return { lit, bare: total === 0 ? 1 : bare / total };
  }

  // How far apart the lightest and darkest pixel of an image are. A placeholder, a black frame or
  // a failed decode drawn as one flat colour all come out near zero; a picture does not.
  function spread(image) {
    const data = pixelsOf(image);
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    return high - low;
  }

  function pixelsOf(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  }

  // Mean absolute difference between two stills of the same size. Two entries showing the same
  // medium's picture come out at zero.
  function apart(a, b) {
    const left = pixelsOf(a);
    const right = pixelsOf(b);
    if (left.length !== right.length) return 255;
    let sum = 0;
    for (let i = 0; i < left.length; i += 4) {
      sum += Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) +
        Math.abs(left[i + 2] - right[i + 2]);
    }
    return sum / (left.length / 4) / 3;
  }

  function centrePixel() {
    const canvas = q(".v-preview__canvas");
    const gl = canvas.getContext("webgl2");
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    return [...pixel];
  }

  // Gallery, wizard, bake, and then the only question that matters: is the result something a
  // person would look at. jsdom answers none of it -- it computes no boxes, has no WebGL, and no
  // FileList can be handed to an input there.
  async function runTemplates() {
    await until("the editor", () => q(".v-dropzone") && q('[data-testid="timeline"]'));
    openMenu();
    check("the project actions are in the overflow menu, not on the bar",
      inMenu("Aus Vorlage") !== undefined, true);
    inMenu("Aus Vorlage").click();
    const gallery = await until("the gallery", () => q('[data-testid="template-gallery"]'));

    const cards = [...gallery.querySelectorAll("[data-template-id]")];
    check("the gallery shows every template that ships", cards.length, 4);
    check(
      "and each one under its own name",
      cards.map((card) => card.querySelector(".v-template__name").textContent),
      ["Drei Aufnahmen", "Auftakt und Abspann", "Hochformat-Story", "Bild im Bild"],
    );
    // The card draws the timeline the template will build, so the count is the template's clip
    // count -- three for the montage, one per track for the picture in picture.
    check(
      "the card draws one block per clip the template will make",
      [
        card("three-shots").querySelectorAll(".v-template__block").length,
        card("picture-in-picture").querySelectorAll(".v-template__block").length,
        card("picture-in-picture").querySelectorAll(".v-template__lane").length,
      ],
      [3, 2, 2],
    );
    check(
      "and marks the one that dissolves",
      card("three-shots").querySelectorAll(".v-template__block[data-dissolve]").length,
      2,
    );
    check("an untouched project is not worth saving as a template",
      labelled("Projekt als Vorlage speichern"), undefined);

    card("three-shots").querySelector("button").click();
    const wizard = await until("the wizard", () => q('[data-testid="template-wizard"]'));
    check("the wizard opens on the template's own first step",
      wizard.querySelector('[role="status"]').textContent.includes("Schritt 1 von 2"), true);
    check("with one field per placeholder of that step",
      [...wizard.querySelectorAll("[data-slot-id]")].map((slot) => slot.dataset.slotId),
      ["shot1", "shot2", "shot3"]);
    check("it says how much material a placeholder wants",
      wizard.textContent.includes("Braucht mindestens 2,5 s Material."), true);

    const advance = () => labelled("Weiter").closest("button");
    check("and refuses to go on while the placeholders are empty", advance().disabled, true);

    await chooseFile(fileInput("shot1"), FIXTURE.name);
    await until("the first choice to register", () => q('[data-chosen="shot1"]'));
    await chooseFile(fileInput("shot2"), FIXTURE.name);
    await until("the second choice to register", () => q('[data-chosen="shot2"]'));
    check("two out of three is still not enough", advance().disabled, true);

    await chooseFile(fileInput("shot3"), FIXTURE.name);
    await until("the third choice to register", () => q('[data-chosen="shot3"]'));
    check("the third one opens the way on", advance().disabled, false);
    check("choosing material raised nothing", banner(), "");

    advance().click();
    await until("the second step", () =>
      q('[data-testid="template-wizard"] [data-slot-id="title"]'));
    check("the name field starts on the template's own name",
      q('[data-slot-id="title"] input[type="text"]').value, "Drei Aufnahmen");
    setValue(q('[data-slot-id="title"] input[type="text"]'), "Sommer 2026");
    setValue(q('[data-slot-id="color"] input[type="color"]'), "#1188ff");
    await sleep(100);
    check("what was typed is what the field holds",
      [
        q('[data-slot-id="title"] input[type="text"]').value,
        q('[data-slot-id="color"] input[type="color"]').value,
      ],
      ["Sommer 2026", "#1188ff"]);

    labelled("Projekt erstellen").click();
    await until("the wizard to close", () => q('[data-testid="template-wizard"]') === null);
    check("the gallery closed with it", q('[data-testid="template-gallery"]'), null);
    check("baking raised nothing", banner(), "");

    const clips = [...document.querySelectorAll("[data-clip-id]")];
    check("the template's three clips are on the timeline", clips.length, 3);
    // Two and a half seconds is 250 px at the default zoom, and 2.0 s of material is all the
    // fixture has. A bake that shortened the clip to what the file holds would give 200 px and a
    // hole where the dissolve expects a picture; slowing it keeps the rhythm the card promised.
    check("each one is as long as the template says, not as long as the file",
      clips.map((clip) => Math.round(clip.getBoundingClientRect().width)), [250, 250, 250]);
    check("and they overlap by the length of the dissolve",
      clips.map((clip) => clip.offsetLeft), [0, 200, 400]);
    check("the same file chosen three times is one medium",
      document.querySelectorAll("[data-media-id]").length, 1);

    // The tab is where a project's name is visible in this version, and a passive effect is what
    // puts it there, so it is waited for rather than read on the same turn.
    await until("the name to reach the tab", () => document.title !== "Videola", 10000);
    check("the typed name is the project's name", document.title, "Sommer 2026 — Videola");

    // A 640x360 clip maps one source pixel to one project pixel unless something fitted it, and in
    // a 1920x1080 frame that leaves eight ninths of the picture showing the bare background.
    // Nothing in this version's interface sets a transform, so a frame with no background left in
    // it can only have come from the bake. Counted against the background rather than against
    // brightness on purpose: a dark shot is dark either way, but background is background.
    const blue = [0x11, 0x88, 0xff];
    // Both counts out of the same read. Two reads would let the second one land after the page
    // compositor has taken the buffer, and an empty buffer holds no background either -- the
    // measurement would pass by being blank rather than by being right.
    const shown = await until("the baked picture", () => {
      const measured = measure(blue);
      return measured.lit > 1000 ? measured : null;
    }, 90000);
    checkAtLeast("the baked project shows a decoded frame", shown.lit, 1000);
    check("and the fitted clip leaves no background showing", shown.bare < 0.2, true);

    // Past the last clip there is nothing but the background, which is where the colour answer
    // becomes something a person can see. Waited for as "an opaque pixel that is not the one on the
    // clip" rather than as "a blue pixel": a wrong colour has to fail the three checks below, not
    // time the wait out. The opacity is what rules out a buffer the page compositor has already
    // taken -- that reads back as four zeroes, which is a change like any other.
    const onTheClip = centrePixel().join();
    button("Ans Ende").click();
    const behind = await until(
      "the picture past the last clip",
      () => {
        const pixel = centrePixel();
        return pixel[3] > 200 && pixel.join() !== onTheClip ? pixel : null;
      },
      20000,
    );
    checkNear("the chosen colour lies behind everything, in red", behind[0], 0x11, 3);
    checkNear("in green", behind[1], 0x88, 3);
    checkNear("and in blue", behind[2], 0xff, 3);
    check("nothing was reported along the way", banner(), "");

    // Back onto the first clip, so the picture the screenshot at the end of the budget catches is
    // the fitted one -- a shot filling the frame is what the whole milestone claims.
    button("An den Anfang").click();
    await until("the picture again", () => measure(blue).lit > 1000, 20000);
  }

  // A tablet: both panels at once, a finger for everything, and the one gesture a phone cannot
  // have -- carrying a medium out of the library and dropping it on a track.
  async function runTablet() {
    await until("the editor", () => q(".v-dropzone") && q('[data-testid="timeline"]'));
    const box = (selector) => q(selector).getBoundingClientRect();

    check("an 834 px touch viewport is a tablet",
      q('[data-testid="app-shell"]').dataset.layout, "tablet");
    check("the library and the timeline are on screen together",
      [q('[data-testid="library"]') !== null, q('[data-testid="timeline"]') !== null], [true, true]);
    check("there is no tab bar, because nothing takes turns", q(".v-panels"), null);
    // Present is not the same as visible. A canvas has no height of its own, so a grid row that
    // does not hand it one leaves it in the document at nought pixels tall -- which is what the
    // first tablet layout did while every other check here still passed.
    checkAtLeast("the picture has real room, not a collapsed row",
      box(".v-preview__canvas").height, 200);
    check("and it sits above the transport, which sits above the timeline",
      box(".v-preview").bottom <= box(".v-transport").top + 1 &&
        box(".v-transport").bottom <= box(".v-timeline").top + 1,
      true);
    check("everything is inside the window",
      [".v-preview", ".v-transport", ".v-timeline", '[data-testid="library"]',
       '[data-testid="inspector"]'].every((s) => box(s).right <= innerWidth && box(s).left >= 0),
      true);

    const topbar = q(".v-topbar");
    check("the topbar fits its window", topbar.scrollWidth, topbar.clientWidth);
    check("nothing on the page scrolls sideways",
      document.documentElement.scrollWidth <= innerWidth, true);
    // A tablet is a finger device, so the same 44 px rule applies as on the phone -- and unlike
    // the phone this was never measured anywhere.
    const controls = [...document.querySelectorAll(".v-topbar > button, .v-topbar > details > summary")];
    checkAtLeast("every control on the bar is a thumb wide",
      Math.min(...controls.map((node) => node.getBoundingClientRect().height)), 44);

    await dropFixture();
    check("the import raised nothing", banner(), "");
    // The timecode had collapsed to "00 / 00" here: the properties column takes what its widest
    // slider asks for and the transport was left with the remainder. Read as text rather than as
    // a width, because a clipped element still reports the width it wanted.
    check("the transport still says the whole time",
      /^\d\d:\d\d:\d\d\.\d\d$/.test(position()), true);
    // The box it was actually given against the box its text needs. scrollWidth against
    // clientWidth does not answer this: a flex item squeezed below its content reports both the
    // same and hands the overflow to whatever clips it further up.
    const time = q(".v-transport__time");
    checkAtLeast("and it is given the width its digits need",
      time.getBoundingClientRect().width - time.scrollWidth, -1);
    const transport = q(".v-transport");
    check("so the transport does not overflow its column",
      transport.scrollWidth <= transport.clientWidth, true);
    check("one medium, one track, one clip",
      [all("[data-media-id]").length, all(".v-timeline__header").length, all("[data-clip-id]").length],
      [1, 1, 1]);

    // A second medium, and a different file rather than the same one twice: two entries carrying
    // one medium's picture would look exactly like a working library.
    await dropSecond();
    check("a second medium joins the library, and lands behind the first one",
      [all("[data-media-id]").length, all(".v-timeline__header").length, all("[data-clip-id]").length],
      [2, 1, 2]);
    check("the second import raised nothing", banner(), "");

    // A second video track to drop onto. tracks[0] is the lower one, so this one draws above it.
    openMenu();
    inMenu("Spur hinzufügen").click();
    await until("the second track", () => all(".v-timeline__header").length === 2);
    check("nothing moved onto it by itself",
      [...all(".v-track")].map((row) => row.querySelectorAll("[data-clip-id]").length), [0, 2]);

    // A plain tap on an entry must place nothing. Found by a counter-check: taking the drag
    // threshold out left every check green, and without it a tap on a library entry drops a clip
    // wherever the finger happened to be.
    const before = all("[data-clip-id]").length;
    const tapped = all("[data-media-id]")[0].getBoundingClientRect();
    finger("pointerdown", all("[data-media-id]")[0], tapped.left + 30, tapped.top + 20);
    await sleep(100);
    finger("pointerup", all("[data-media-id]")[0], tapped.left + 30, tapped.top + 20);
    await sleep(200);
    check("a tap on a library entry places nothing", all("[data-clip-id]").length, before);
    check("and reports nothing", banner(), "");

    // Scrolled, so the drop has to account for the offset. Found by a counter-check as well: with
    // the timeline at zero, reading the scroll offset and ignoring it give the same answer, and
    // dropping onto a scrolled timeline is the ordinary case rather than the exotic one.
    const surface = q(".v-timeline__scroll");
    surface.scrollLeft = 120;
    await sleep(100);
    checkAtLeast("the timeline really is scrolled for the drag", surface.scrollLeft, 120);

    // The drag itself, with a finger. The library entry announces the grab, the timeline judges
    // it, and one command comes out of it -- which is why the undo below is a single step.
    const entry = all("[data-media-id]")[1];
    const from = entry.getBoundingClientRect();
    // Rows are drawn top first and tracks[0] is the bottom one, so the upper row is the new track.
    const target = all(".v-track")[0].getBoundingClientRect();
    const dropX = target.left + 150;
    const dropY = target.top + target.height / 2;

    finger("pointerdown", entry, from.left + 30, from.top + 20);
    // The timeline listens on the window, and it can only start doing so after React has
    // committed the grab. A finger is never this fast; a script is.
    await sleep(100);
    finger("pointermove", document.body, from.left + 60, from.top + 20);
    finger("pointermove", document.body, dropX, dropY);
    await sleep(100);
    check("the track under the finger says it would take the drop",
      q('.v-track[data-drop-target]') === all(".v-track")[0], true);
    check("and a line says where it would land", q('[data-testid="timeline-dropline"]') !== null, true);

    finger("pointerup", document.body, dropX, dropY);
    await until("the dropped clip", () => all("[data-clip-id]").length === 3);
    check("dragging raised nothing", banner(), "");
    check("the marks are gone once the finger is up",
      [q('.v-track[data-drop-target]'), q('[data-testid="timeline-dropline"]')], [null, null]);

    check("the clip landed on the track it was dropped on, and only there",
      [...all(".v-track")].map((row) => row.querySelectorAll("[data-clip-id]").length), [1, 2]);
    const landed = all(".v-track")[0].querySelector("[data-clip-id]");
    // Where the finger let go, not at the end of the track: an appended clip would sit at 0 or
    // behind whatever is already there, and both are far from here.
    checkNear("and it starts where the finger let go",
      landed.getBoundingClientRect().left, dropX, 6);

    labelled("Rückgängig").click();
    await sleep(200);
    check("the whole drag is one step back", all("[data-clip-id]").length, 2);
    labelled("Wiederholen").click();
    await until("the clip again", () => all("[data-clip-id]").length === 3);

    // Both stills, both out of their own file, and visibly not the same picture -- which is what
    // says the library is showing each medium rather than one of them twice.
    const stills = await until("both thumbnails", () => {
      const images = all(".v-library__thumb");
      return images.length === 2 && images.every((i) => i.complete && i.naturalWidth > 0)
        ? images
        : null;
    }, 90000);
    check("every medium carries its own still",
      stills.map((image) => [image.naturalWidth, image.naturalHeight]), [[160, 90], [160, 90]]);
    // Two entries showing one medium's picture twice would look exactly like a working library.
    checkAtLeast("and the two are different pictures", apart(stills[0], stills[1]), 8);

    // A tap on a clip and the properties are right there; a tablet has room for the panel, so
    // unlike the phone there is nothing to switch to.
    finger("pointerdown", q("[data-clip-id]"), 0, 0);
    finger("pointerup", q("[data-clip-id]"), 0, 0);
    const add = await until("the brightness button", () => labelled("Helligkeit hinzufügen"));
    checkAtLeast("with a thumb-sized target to add an effect",
      add.getBoundingClientRect().height, 44);
    check("the properties panel is beside the picture, not behind a tab",
      box('[data-testid="inspector"]').right <= innerWidth, true);

    button("Abspielen").click();
    await until("the transport to report playing", () => button("Anhalten") !== null, 8000);
    const standing = position();
    await sleep(1000);
    check("the playhead moves while a tablet plays", position() !== standing, true);
    check("nothing was reported along the way", banner(), "");
    await photograph("tablet");
  }

  const card = (id) => q(`[data-template-id="${id}"]`);
  const fileInput = (slot) => q(`[data-slot-id="${slot}"] input[type="file"]`);

  // Read straight out of OPFS rather than through the module the application uses: what is being
  // checked is that bytes are on disk, and asking the writer whether it wrote proves nothing.
  async function autosaved() {
    try {
      const root = await navigator.storage.getDirectory();
      const text = await (await (await root.getFileHandle("session.json")).getFile()).text();
      return text === "" ? undefined : JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function dropFixture() {
    const bytes = await (await fetch("/" + FIXTURE.name)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], FIXTURE.name, { type: FIXTURE.type }));
    drag("drop", q(".v-dropzone"), transfer);
    return until("a clip on the timeline", () => q("[data-clip-id]"));
  }

  // A second, different file. Different bytes, so a different hash and a genuinely second entry --
  // the same file under another name would be one medium, which is what the template run proves.
  async function dropSecond() {
    const bytes = await (await fetch("/second.mp4")).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "second.mp4", { type: "video/mp4" }));
    drag("drop", q(".v-dropzone"), transfer);
    return until("the second library entry", () => all("[data-media-id]").length === 2);
  }

  pickFixture()
    .then(announce)
    .then(() =>
      templates ? runTemplates() : phone ? runPhone() : tablet ? runTablet() : run(),
    )
    .catch((error) => {
      results.push({ name: "the run itself", ok: false, got: String(error), want: "no throw" });
    })
    .then(() => {
      if (noise.length > 0) {
        results.push({ name: "nothing reached the console", ok: false, got: noise, want: [] });
      }
      results.push({
        name: `ENV ${window.__videolaEnv ?? "unknown"}`,
        ok: true,
        got: "noted",
        want: "noted",
      });
      return fetch("/results", { method: "POST", body: JSON.stringify(results) });
    });
})();
