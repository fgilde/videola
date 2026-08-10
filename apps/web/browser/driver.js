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
let FIXTURE = { name: "fixture.mp4", type: "video/mp4", width: 640, height: 360 };

// The two numbers the keyframe lane's geometry is read against, spelled the way the core and the
// timeline spell them: a flick per second, and the timeline's own default zoom.
const SECOND = 705600000;
const DEFAULT_FLICKS_PER_PIXEL = SECOND / 100;

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
  FIXTURE = { name: "fixture.webm", type: "video/webm", width: 640, height: 360 };
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
  // The effect library needs the same two halves the template run does: real decoding time for the
  // frame the tiles are drawn from, and a drawing buffer nobody has taken away to draw them out of.
  const shelves = location.search.includes("effects");
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

  // Every zone's height, as a passing note. Three layout checks read differently on a CI runner than
  // on a desktop, and a failure that says "216 px" without saying which row took the rest is a
  // failure nobody can act on. Called where a claim is made, not only at the end -- the panels come
  // and go during a run, so the end says nothing about the moment a check looked.
  const noteZones = (when) => {
    const zone = (selector) => {
      const node = document.querySelector(selector);
      return node === null ? "-" : String(Math.round(node.getBoundingClientRect().height));
    };
    // Every child of the grid and not a roster of the ones this file happens to know about: on a CI
    // runner the rows the checks read added up to two hundred and thirty-two pixels less than the
    // editor, and a list can only ever be missing exactly the row that took them.
    const children = [...(q(".v-editor")?.children ?? [])]
      .map((node) => {
        const name = node.className.split(" ")[0] || node.tagName.toLowerCase();
        return `${name}:${Math.round(node.getBoundingClientRect().height)}`;
      })
      .join(" ");
    results.push({
      name:
        `ZONES ${when} viewport ${innerWidth}x${innerHeight} editor ${zone(".v-editor")}` +
        ` canvas ${zone(".v-preview__canvas")} strip ${zone(".v-mixer__strip")}` +
        ` strips ${zone(".v-mixer__strips")} | ${children}`,
      ok: true,
      got: "noted",
      want: "noted",
    });
  };

  const q = (selector) => document.querySelector(selector);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const button = (label) => document.querySelector('button[aria-label="' + label + '"]');
  const labelled = (text) => all("button").find((node) => node.textContent.trim() === text);
  // The way into the effect library. The mixer still has a picker, because an audio effect has no
  // picture; a video effect is chosen by looking at one.
  const browseFor = (label) =>
    [...(q(".v-inspector") || document).querySelectorAll("button")]
      .find((node) => node.textContent === label) ?? null;
  const effectPicker = () => browseFor("Effekte durchsuchen");
  const shelf = () => q('[data-testid="effect-browser"]');
  const tileOf = (id) => q(`[data-effect-id="${id}"] img`);

  async function openShelf(label) {
    browseFor(label).click();
    await until("the effect browser", () => shelf());
    // The tiles are drawn one after another off a shared context; the last one to arrive is what
    // says the grid is finished.
    return until("every tile to be drawn",
      () => (all(".v-fx__tile").every((node) => node.querySelector("img")) ? shelf() : null), 60000);
  }

  async function addEffect(id) {
    await openShelf("Effekte durchsuchen");
    q(`[data-effect-id="${id}"] button`).click();
    return until("the browser to close", () => (shelf() === null ? true : null));
  }
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
  // The size goes with it: headless Chrome lays the page out inside a window taller than the page,
  // and a shot of the window carries a band of black under the editor that reads as a layout which
  // ran out of room. The page is the only thing that knows how tall it really is.
  const photograph = (name) =>
    fetch(`/shot?name=${name}&w=${innerWidth}&h=${innerHeight}`).then(() => undefined);

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
    await until("the inspector", () => effectPicker());
    check("selecting a clip opens its properties", q(".v-inspector") !== null, true);

    await addEffect("brightness");
    const row = await until("the brightness row", () => amountSlider());
    check("the parameter is named from the manifest, not from its key",
      row.labels[0].textContent, "Stärke");

    // The static parameter first. If a plain gain does not reach the picture there is no point in
    // asking what a keyframed one does, and the two failures look identical from the outside.
    dragSlider(amountSlider(), [0.6, 0.3, 0]);
    checkAtMost("a static brightness of zero blacks the clip out", Math.round(await repainted()), 1);
    dragSlider(amountSlider(), [0.5, 1]);
    checkNear("and back at one the picture is the one that was there",
      (await repainted()) / base0, 1, 0.02);

    button("Keyframe für Stärke am Playhead").click();
    await sleep(200);
    check("the switch reports the keyframe it just set",
      button("Keyframe für Stärke am Playhead").getAttribute("aria-pressed"), "true");

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
      button("Keyframe für Stärke am Playhead").getAttribute("aria-pressed"), "true");

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
      button("Rückgängig").click();
      steps += 1;
      await sleep(150);
    }
    check("the whole session is six undo steps, not eighteen", steps, 6);
    checkNear("and undoing it puts the picture back where it started",
      (await pictureAfter(0)) / base0, 1, 0.02);
    return { base0: base0, base15: base15, base30: base30 };
  }

  const laneRow = (name) =>
    all(".v-keylane__header").findIndex(
      (node) => node.querySelector(".v-keylane__headerName").textContent === name);
  const laneKeys = () => all(".v-keylane__key");
  // A transform row carries no aria-label -- it is a <label for>, like every native pairing. Found
  // through the label so the check goes the way a screen reader and a click both go.
  const rowSlider = (text) =>
    all(".v-inspector .v-param").find(
      (row) => row.querySelector(".v-param__label").textContent.startsWith(text))
      ?.querySelector('input[type="range"]');

  /**
   * The lane, end to end and through nothing but the surface: a transform field put on the clock
   * from the properties panel, its keys drawn on the timeline's own axis, and one of them dragged
   * -- with the picture read back out of the drawing buffer before and after, because a lane that
   * moves a dot but not a pixel is a lane that does nothing.
   *
   * It runs last and leaves its work standing, so the screenshot at the end of the budget is a
   * picture of the thing this milestone is about.
   */
  async function keyframeLane(base) {
    pointer("pointerdown", q("[data-clip-id]"));
    pointer("pointerup", q("[data-clip-id]"));
    await until("the properties panel", () => rowSlider("Deckkraft"));
    check("a transform row says nothing is animated yet",
      q(".v-inspector .v-param[data-animated]"), null);

    // Not at the very start: a keyframe drawn at time zero sits half under the sticky header
    // column, which is a poor thing to look at and a poor thing to aim at.
    toStart();
    forward(15);
    await repainted();
    button("Keyframe für Deckkraft am Playhead").click();
    await sleep(200);
    check("a transform field can be put on the clock at all",
      button("Keyframe für Deckkraft am Playhead").getAttribute("aria-pressed"), "true");
    check("and the row now says it is animated",
      q(".v-inspector .v-param[data-animated]") !== null, true);

    forward(30);
    await repainted();
    dragSlider(rowSlider("Deckkraft"), [0.9, 0.7, 0.5, 0.4]);
    await repainted();

    check("the lane shows the parameter under the name the panel gives it",
      laneRow("Deckkraft") >= 0, true);
    check("with one point per keyframe", laneKeys().length, 2);
    check("nothing was reported for any of it", banner(), "");

    // Halfway between a key at 1 and a key at 0.4 is 0.7 of the picture that would be there.
    toStart();
    await repainted();
    forward(30);
    const before = await repainted();
    // Where the playhead actually stands, said out loud. Without it "0.7 of the picture" is a
    // ratio between two frames of moving material and would sit true at instants nobody aimed at:
    // this fixture's frame 0 happens to be about 0.7 of its frame 30 all on its own.
    check("the playhead really is halfway between the two keys", position(), "00:00:01.00");
    checkNear("the picture halfway between two keys is interpolated, not switched",
      before / base.base30, 0.7, 0.08);

    // Half a second's worth of pixels to the left, which is where the playhead is standing. No
    // rect is read for the target: under a virtual-time budget layout lags the DOM, and the
    // playhead's own box still reports where it was two seeks ago.
    const last = laneKeys()[1];
    check("the key about to be dragged is the later of the two",
      last.dataset.keyframeTime, String(1.5 * SECOND));
    const box = last.getBoundingClientRect();
    const from = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const travel = SECOND / 2 / DEFAULT_FLICKS_PER_PIXEL;
    pointer("pointerdown", last, { clientX: from, clientY: y });
    for (let i = 1; i <= 20; i += 1) {
      pointer("pointermove", q(".v-timeline__scroll"), { clientX: from - (travel * i) / 20, clientY: y });
    }
    pointer("pointerup", q(".v-timeline__scroll"), { clientX: from - travel, clientY: y });

    const after = await repainted();
    check("dragging a keyframe raised nothing", banner(), "");
    check("and did not create or lose one", laneKeys().length, 2);
    check("the key landed on the instant the pointer travelled to",
      laneKeys().map((node) => node.dataset.keyframeTime).join(),
      [SECOND / 2, SECOND].join());
    checkNear("the dragged key's own value is what the picture now shows",
      after / base.base30, 0.4, 0.08);
    check("which is darker than it was before the drag", after < before * 0.85, true);

    // The playhead off both keys and the second one picked, so the screenshot at the end of the
    // budget shows a picked keyframe as something other than "the one under the red line".
    toStart();
    forward(6);
    await sleep(300);
    pointer("pointerdown", laneKeys()[1]);
    pointer("pointerup", laneKeys()[1]);
    check("a picked keyframe brings up what it is set to",
      q('[data-testid="keyframe-bar"]') !== null, true);
    check("and says which one of them is picked",
      laneKeys().map((node) => node.getAttribute("aria-pressed")).join(), "false,true");
    await sleep(300);

    await curveField();
  }

  /**
   * The curve editor, end to end and through nothing but the surface: the earlier of the two keys
   * picked, switched to a curve, its handle dragged, and the picture read out of the drawing
   * buffer before and after -- at an instant neither key sits at, because that is the only place a
   * curve and a straight line differ at all.
   *
   * It runs last and leaves the field open, so the screenshot at the end of the budget is a picture
   * of a bent curve rather than of the panel that could have drawn one.
   */
  async function curveField() {
    // Frame 22 of thirty: past the first key at 0.5 s and short of the second at 1 s. At either
    // key every easing agrees with every other, and a run reading there would pass with no curve.
    toStart();
    forward(22);
    const straight = await repainted();

    pointer("pointerdown", laneKeys()[0]);
    pointer("pointerup", laneKeys()[0]);
    // The pick has to land before the bar is read: React schedules its re-render on a task, and
    // the select still carries the previous key's handler until it has run. Without this wait the
    // curve went onto the key that was picked a moment ago, and every check downstream agreed.
    await sleep(300);
    check("the press moved the pick to the earlier of the two keys",
      laneKeys().map((node) => node.getAttribute("aria-pressed")).join(), "true,false");

    const interp = q('[data-testid="keyframe-bar"] select');
    check("the curve is on offer beside the three presets",
      [...interp.options].map((option) => option.value).join(), "linear,hold,ease,bezier");

    setValue(interp, "bezier");
    await sleep(300);
    const disclosure = q('[data-testid="keyframe-curve-disclosure"]');
    check("a picked key with travel after it offers a curve", disclosure !== null, true);
    // Through the summary, the way a person opens one. Set on the element instead, it would be
    // undone by the next render -- which is every pointer move of the drag below.
    q(".v-keycurve__summary").click();
    await sleep(300);
    check("the disclosure opened on the field", disclosure.open, true);

    check("the key really took the curve", laneKeys()[0].dataset.interp, "bezier");
    const handles = all("[data-curve-handle]");
    check("both ends of the segment can be grabbed", handles.length, 2);

    // The box is measured once and the whole drag is aimed inside it. The field has been on screen
    // for a beat by now, so its rect is settled -- unlike the playhead's, two seeks after a seek.
    const box = q(".v-curve").getBoundingClientRect();
    const out = handles.find((node) => node.dataset.curveHandle === "out");
    const startBox = out.getBoundingClientRect();
    const from = { clientX: startBox.left + startBox.width / 2, clientY: startBox.top + startBox.height / 2 };
    const to = { clientX: box.left + box.width * 0.95, clientY: box.top + box.height * 0.95 };
    pointer("pointerdown", out, from);
    for (let i = 1; i <= 20; i += 1) {
      pointer("pointermove", out, {
        clientX: from.clientX + ((to.clientX - from.clientX) * i) / 20,
        clientY: from.clientY + ((to.clientY - from.clientY) * i) / 20,
      });
    }
    pointer("pointerup", out, to);

    const curved = await repainted();
    check("dragging a handle raised nothing", banner(), "");
    // Opacity runs from 1 down to 0.4 across the segment. A handle pulled to the bottom right
    // holds the travel back, so most of the way through the picture is still near the first key --
    // brighter than the straight ramp put it, at the very same instant.
    check("the curve moved the picture at an instant no keyframe sits at",
      curved > straight * 1.1, true);
    check("and did not disturb the keys themselves", laneKeys().length, 2);
    await sleep(300);
  }


  // ---------------------------------------------------------------- colour and its instruments

  // Ink on one of the instruments. A scope drawn from a real measurement covers pixels; one drawn
  // from nothing covers none, and the two look identical from the DOM.
  function inkOn(canvas) {
    if (canvas === null || canvas.width === 0) return 0;
    const two = document.createElement("canvas");
    two.width = canvas.width;
    two.height = canvas.height;
    two.getContext("2d").drawImage(canvas, 0, 0);
    const data = two.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) count += 1;
    return count;
  }

  function instrument(title) {
    const figure = all(".v-scope").find((node) =>
      node.querySelector(".v-scope__title").textContent === title);
    return figure === undefined ? null : figure.querySelector("canvas");
  }

  function scopeReading() {
    const line = q(".v-scopes__range");
    return line === null ? "" : line.textContent;
  }

  // The whole chain a colourist works in, in the real application: an instrument reading the
  // picture, a grade that moves it, and the instrument following. Nothing below this line is
  // reachable from a unit test -- jsdom has no WebGL2 to read a frame back from and no canvas to
  // draw a trace onto.
  /**
   * The geometry of a shot, on the shot. The corners of the box are computed from the very matrix
   * the compositor is handed -- that agreement is a unit test -- so what a browser has to add is
   * the half that no unit test can reach: that the box lands on the picture at the size the pane
   * happens to have, that a drag across it moves the picture by the project pixels it should, and
   * that the panel beside it reads the same number afterwards.
   */
  async function stage() {
    pointer("pointerdown", q("[data-clip-id]"));
    pointer("pointerup", q("[data-clip-id]"));
    const box = await until("the geometry overlay", () => q(".v-stage__box"));
    const picture = q(".v-preview__canvas").getBoundingClientRect();
    const drawn = box.getBoundingClientRect();

    // The box is the picture, not something near it. The fixture is 640x360 in a 640x360 project,
    // so the untouched clip fills the frame and the two rectangles are the same one.
    checkAtMost("the box sits on the picture and not beside it",
      Math.round(Math.max(
        Math.abs(drawn.left - picture.left), Math.abs(drawn.top - picture.top),
        Math.abs(drawn.right - picture.right), Math.abs(drawn.bottom - picture.bottom))), 2);

    const before = Number(rowSlider("Position X").value);
    // A quarter of the way across the picture, which in project pixels is a quarter of the frame's
    // width whatever the pane was scaled to -- that conversion is the whole of what this drag is
    // asking about.
    const travel = picture.width / 4;
    const middle = { x: picture.left + picture.width / 2, y: picture.top + picture.height / 2 };
    pointer("pointerdown", box, { clientX: middle.x, clientY: middle.y });
    pointer("pointermove", q(".v-stage__svg"), { clientX: middle.x + travel, clientY: middle.y });
    pointer("pointerup", q(".v-stage__svg"), { clientX: middle.x + travel, clientY: middle.y });
    await sleep(300);

    const after = Number(rowSlider("Position X").value);
    checkNear("dragging the picture moves it by the project pixels the pointer covered",
      Math.round(after - before), Math.round(FIXTURE.width / 4), 2);
    check("and the panel beside the picture reads the same number", banner(), "");

    // One drag, one step. The coalescing key is minted on the way down and dropped on the way up,
    // so the picture goes back where it was in a single undo -- not one per pointer move.
    button("Rückgängig").click();
    await sleep(300);
    checkNear("and the whole drag is one step to undo", Number(rowSlider("Position X").value),
      before, 1);

    // And the line the clip travels, once there is one. Two keys on Position X at two instants is
    // a clip that moves, which is the whole condition for a path -- and the path is sampled from
    // the core, so what is drawn is what the export will do.
    check("a clip that stands still has no path drawn on it", q('[data-testid="motion-path"]'), null);
    toStart();
    button("Keyframe für Position X (px) am Playhead").click();
    await sleep(200);
    forward(15);
    dragSlider(rowSlider("Position X"), [40, 90, 140]);
    const path = await until("the motion path", () => q(".v-path__line"));
    checkAtLeast("the line is sampled rather than drawn corner to corner",
      path.getAttribute("points").split(" ").length, 20);
    check("with a handle on every key", all("[data-path-key]").length, 2);

    // Dragging one moves the clip at that instant and nowhere else, which is what makes it a path
    // rather than a second way of setting the transform.
    const held = Number(rowSlider("Position X").value);
    const handle = q('[data-path-key="1"]');
    const spot = handle.getBoundingClientRect();
    const grabbed = { x: spot.left + spot.width / 2, y: spot.top + spot.height / 2 };
    pointer("pointerdown", handle, { clientX: grabbed.x, clientY: grabbed.y });
    pointer("pointermove", q(".v-path__svg"), { clientX: grabbed.x - 60, clientY: grabbed.y });
    pointer("pointerup", q(".v-path__svg"), { clientX: grabbed.x - 60, clientY: grabbed.y });
    await sleep(300);
    check("dragging a path key raised nothing", banner(), "");
    check("and it moved the clip at that instant",
      Number(rowSlider("Position X").value) !== held, true);
    check("without minting a key of its own", all("[data-path-key]").length, 2);

    // Put the timeline back the way the rest of the run expects to find it: no keys, no path, and
    // the playhead at the start. A check that leaves its own state behind is a check that breaks
    // the next one.
    // Two steps, because that is what was made: putting the field on the clock, and the drag that
    // wrote the second key. A third undo would reach back into work this check did not do.
    for (let step = 0; step < 2; step += 1) {
      button("Rückgängig").click();
      await sleep(200);
    }
    check("and undoing takes the path with it", q(".v-path__line"), null);
    toStart();
    await sleep(200);
  }

  async function colour() {
    // Off until asked for: the instruments take a hundred and fifty pixels out of the middle
    // column, and the picture is meant to be the largest thing in the window.
    check("the instruments are out of the way until they are wanted", q(".v-scopes"), null);
    button("Messgeräte zeigen").click();
    await until("the instruments", () => q(".v-scopes"));
    check("and the switch says they are showing",
      button("Messgeräte zeigen").getAttribute("aria-pressed"), "true");

    const drawn = await until("a measurement of the picture",
      () => (inkOn(instrument("Wellenform")) > 50 ? inkOn(instrument("Wellenform")) : 0), 30000);
    checkAtLeast("the waveform is drawn from real pixels", drawn, 50);
    checkAtLeast("and so is the histogram", inkOn(instrument("Histogramm")), 50);
    checkAtLeast("and the vectorscope", inkOn(instrument("Vektorskop")), 50);
    check("the reading says what it measured, in words",
      /^Helligkeit \d+ bis \d+ von 255$/.test(scopeReading()), true);

    const before = scopeReading();
    pointer("pointerdown", q("[data-clip-id]"));
    pointer("pointerup", q("[data-clip-id]"));
    await until("the inspector", () => effectPicker());

    // Colour wheels first: a lift is the one move whose effect on a waveform is a number anybody
    // can name -- the whole trace comes off the floor.
    await addEffect("colorWheels");
    const lift = await until("the shadow strength row", () => rowSlider("Schatten-Stärke"));
    dragSlider(lift, [0.1, 0.2, 0.3]);
    await sleep(400);
    const lifted = await until("the reading to follow the grade",
      () => (scopeReading() !== before && scopeReading() !== "" ? scopeReading() : null), 20000);
    check("lifting the shadows moves the reading", lifted !== before, true);
    const floor = Number(/Helligkeit (\d+)/.exec(lifted)[1]);
    checkAtLeast("and the whole picture stands off the floor", floor, 20);

    // And the curve, which is the control this library grew a parameter kind for. A point dragged
    // upwards is a brighter picture, measured on the canvas rather than asserted on the model.
    await addEffect("curves");
    // Scoped to the inspector: the timeline's keyframe curve field is built out of the very same
    // classes -- deliberately, so the two read as one control -- and it is standing open by now.
    const field = await until("the curve field", () => q(".v-inspector .v-curve"));
    const points = all(".v-inspector .v-curve__point");
    checkAtLeast("the curve opens with the two ends of the range", points.length, 2);
    const box = field.getBoundingClientRect();

    const dim = luma();
    // A point added a quarter of the way across, then dragged up to four fifths of the output.
    pointer("pointerdown", field, { clientX: box.left + box.width * 0.25, clientY: box.top + box.height * 0.75 });
    await sleep(200);
    const added = all(".v-inspector .v-curve__point");
    checkAtLeast("tapping the field adds a point", added.length, points.length + 1);
    const grabbed = added[1];
    pointer("pointerdown", grabbed, { clientX: box.left + box.width * 0.25, clientY: box.top + box.height * 0.75 });
    pointer("pointermove", grabbed, { clientX: box.left + box.width * 0.25, clientY: box.top + box.height * 0.2 });
    pointer("pointerup", grabbed, { clientX: box.left + box.width * 0.25, clientY: box.top + box.height * 0.2 });
    await sleep(500);
    const bright = await until("the picture to follow the curve",
      () => (luma() > dim + 4 ? luma() : 0), 20000);
    checkAtLeast("a curve point dragged upwards brightens the picture", Math.round(bright - dim), 4);

    // One drag, one undo. The whole point of a coalesce key on a field somebody sweeps across.
    button("Rückgängig").click();
    await sleep(400);
    checkAtMost("and one undo takes the whole drag back", Math.round(luma() - dim), 3);
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

    // The fixture is 640x360, which is under the height a proxy is made for. So this run is the
    // whole of "a missing proxy breaks nothing", asked of the running editor rather than of a unit
    // test: none is made, none is promised, and everything works exactly as it did.
    await sleep(300);
    check("material small enough needs no proxy, and is not given one",
      q("[data-media-id]").dataset.proxy, "none");
    check("and claims nothing about one", q(".v-library__proxy").textContent, "");
    check("while the clip it made is on the timeline all the same",
      all("[data-clip-id]").length, 1);
    check("and the queue reported nothing", banner(), "");

    // The switch has to be a switch. Which file the decoders then open is not something a browser
    // check can read -- that is answered in the export harness, at the resolution of a decoded
    // frame -- so what is asked here is that the state really changes and that closing every open
    // decoder underneath a running preview is survivable. The console check at the end of this run
    // is the second half of it, and it is what caught a disposed Input being reported as a decoder
    // failure once per source, every time this button was pressed.
    labelled("Originale benutzen").click();
    await sleep(400);
    check("pressing it puts the preview on the originals",
      labelled("Originale benutzen").getAttribute("aria-pressed"), "true");
    check("switching raised nothing", banner(), "");
    labelled("Originale benutzen").click();
    await sleep(400);
    check("and it goes back to the proxies",
      labelled("Originale benutzen").getAttribute("aria-pressed"), "false");
    check("and the timeline is untouched by any of it", all("[data-clip-id]").length, 1);

    noteZones("layout");
    // The picture is the reason anyone opens the application, and on a desktop it had been squeezed
    // to a stamp between the transport and a mixer strip that grew with every track. Measured on the
    // canvas and not on its pane: a pane can be tall and hold nothing but letterbox.
    checkAtLeast("the picture gets the room a desktop has for it",
      Math.round(q(".v-preview__canvas").getBoundingClientRect().height), 230);
    // The absolute floor above is true of a 744 px viewport and says nothing about a taller one.
    // This is the rule the layout is actually built on, at any height: the picture is the largest
    // zone on the screen. It was the smallest.
    checkAtLeast("and it is the largest zone, not the smallest",
      Math.round(q(".v-preview").getBoundingClientRect().height -
        q(".v-timeline").getBoundingClientRect().height), 1);
    // The same bargain the instruments make. A desk of two labelled faders over mute, solo and a
    // chain picker is a hundred and ninety pixels, and it stood there whether or not anyone was
    // mixing -- with the instruments open as well the picture was left with sixty pixels of a
    // seven-hundred-pixel window and its canvas hung out over the toolbar above.
    check("the mixing desk is out of the way until it is wanted", q('[data-testid="mixer"]'), null);
    button("Mischpult zeigen").click();
    await until("the mixing desk", () => q('[data-testid="mixer"]'));
    check("and the switch says it is showing",
      button("Mischpult zeigen").getAttribute("aria-pressed"), "true");
    checkAtLeast("the mixer costs less of the window than the picture does",
      Math.round(q(".v-preview").getBoundingClientRect().height -
        q('[data-testid="mixer"]').getBoundingClientRect().height), 1);

    // A share of the window is not a size a strip has. 20vh was 180 px against a strip of 342, so
    // the volume fader was the only part of a mixer anybody ever saw -- pan, mute, solo and the
    // whole insert chain were below the cut. Read off the scroll container, which is where being
    // cut off actually shows: a box shorter than what it holds.
    noteZones("desk-open");
    checkAtMost("the mixer shows whole strips and not the tops of them",
      q(".v-mixer__strips").scrollHeight - q(".v-mixer__strips").clientHeight, 0);
    // And the same claim from the other side, on the control that sits last in a strip -- the one
    // a scrollHeight that happened to agree would still leave off the screen.
    check("the last control in a strip is inside the mixer",
      q(".v-mixer__strip .v-mixer__chain").getBoundingClientRect().bottom <=
        Math.round(q('[data-testid="mixer"]').getBoundingClientRect().bottom), true);
    // Away again, and not only to leave the picture the room: an open desk meters every strip ten
    // times a second off the audio graph, and under a virtual clock that is real work Chrome does
    // for every virtual millisecond. With it standing open the effect browser below never finished
    // drawing its tiles inside a minute.
    button("Mischpult zeigen").click();
    check("and it folds away again",
      await until("the desk to fold away", () => (q('[data-testid="mixer"]') === null || null)), true);

    // The timeline row was a fixed 30% of the editor whatever it held, because grid maximizes a
    // minmax track before it feeds the flexible one. Under a single 72 px track that is 140 px of
    // empty rows held open at the picture's expense.
    checkAtMost("no empty rows are held open under the last track",
      Math.round(q(".v-timeline__body").getBoundingClientRect().bottom -
        all(".v-track").at(-1).getBoundingClientRect().bottom), 40);

    // On the wall clock and before anything else has been done to the clip: under a virtual budget
    // layout lags behind the DOM, and every claim the box makes is about a rectangle.
    if (!virtual) await stage();

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
    if (virtual) await keyframeLane(await keyframes());

    await captions();

    // The instruments and the grade, in that order: a scope is only worth anything if it moves
    // when the picture does, and only the built application can show both at once.
    if (virtual) await colour();

    key(" ", document.body);
    await until("the transport to report playing", () => button("Anhalten") !== null, 8000);
    check("the space bar starts playback from outside the transport",
      button("Anhalten") !== null, true);

    // Everything past here needs a frame clock. The screenshot run stops on a decoded picture
    // with the transport reporting that it is running.
    if (virtual) {
      checkAtLeast("the picture is still there once playback has started",
        await until("a frame while playing", () => (litPixels() > 1000 ? litPixels() : 0)), 1000);
      // Stopped again before the run reports back, and that is what makes the screenshot exist:
      // Chrome writes it when the virtual clock has run out its budget, and a running frame clock
      // does real decoding work for every virtual millisecond -- three hundred seconds of it never
      // arrive. Paused, the page has nothing pending and the rest of the budget is consumed at
      // once. The picture is also the better one: a graded clip with its instruments beside it.
      key(" ", document.body);
      // The curve field floats over the instruments, which is right for a panel someone opened and
      // wrong for the one picture the guide leads with: overlapping a scope's own heading, it reads
      // as a layout accident rather than as a disclosure. It has its own place in the tour.
      q(".v-keycurve__summary")?.click();
      await sleep(300);
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
    button("Mischpult zeigen").click();
    await until("the mixing desk", () => q('[data-testid="mixer"]'));
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

    await mixerTools(lufs);
  }

  // The three things a real browser has to say about the new mixer, and the one it cannot: the
  // meters swinging needs an audio device, which a headless Chrome does not have. What is checked
  // here is that they exist, that they cost the layout nothing, and that the two actions that go
  // out to the samples come back with a project that changed.
  async function mixerTools(measured) {
    const meters = all('[data-testid="meter"]');
    // One per strip and one for the master. Counted against the strips that are there, so a
    // meter drawn only on the master could not pass this by arithmetic.
    check("every strip has a meter and so does the master",
      meters.length, all(".v-mixer__strip").length);
    // The mixer row is clamped and checked as a whole above; this is the one control that has
    // twice pushed through that clamp, so it is pinned at its own declared height.
    checkAtMost("a meter is ten pixels tall and not a share of the window",
      Math.round(meters[0].getBoundingClientRect().height), 12);
    check("the meter says what it is measuring", meters[0].getAttribute("role"), "meter");

    // Normalising renders the timeline again. What lands in the readout has to be a reading of
    // the corrected project -- so it has to have moved, and it has to have moved to the target.
    check("the fixture does not start on the streaming target",
      Math.abs(measured + 14) > 1, true);
    labelled("Auf Ziel bringen").click();
    const brought = await until("a reading after normalising", () => {
      const text = q('[data-testid="mixer-loudness"]').textContent;
      const value = Number(text.replace(" LUFS", ""));
      return text.endsWith("LUFS") && Math.abs(value - measured) > 0.05 ? value : null;
    }, 60000);
    checkNear("normalising lands the programme on the target it was given", brought, -14, 0.6);
    check("and it moved the master fader to get there",
      Number(q('[data-testid="mixer-master"] input[type=range]').value) !== 1, true);
    check("normalising raised nothing", banner(), "");

    // Beats onto the ruler. The fixture's sound is a steady tone -- measured, its envelope sits at
    // 0.13 for the whole two seconds -- and a steady tone has no onsets, so what this asks of a
    // real browser is that the button is wired, that it survives being pressed on material with
    // nothing to find, and that it invents nothing. That it *does* find the beats of a metronome,
    // including in the quiet half of a track that gets quieter, is measured in the unit tests where
    // the material can be made to order.
    const marked = () => {
      const button = all("button").find((node) => node.textContent.trim().startsWith("Marker ("));
      return Number(button?.textContent.match(/\d+/)?.[0] ?? -1);
    };
    const markersBefore = marked();
    // On the strip that carries the material, not on the first strip there is: a subtitle track
    // has a fader like any other and no samples at all behind it.
    q('[aria-label^="Beats von V1"]').click();
    await sleep(400);
    check("marking the beats raised nothing", banner(), "");
    check("and a steady tone is not a beat", marked(), markersBefore);

    // Cutting the silence out of a track. The fixture is dense material, so what is asserted is
    // the shape of the result rather than a count: whatever it took out, it left every clip that
    // survived where it stood -- a gap and not a ripple -- and it raised nothing.
    const strip = q(".v-mixer__strip");
    const track = strip.dataset.trackId;
    const before = all("[data-clip-id]").map((clip) => clip.offsetLeft);
    q('[aria-label^="Stille in"]').click();
    await sleep(400);
    check("cutting silence raised nothing", banner(), "");
    check("and it left every clip that survived where it stood",
      all("[data-clip-id]").every((clip) => before.includes(clip.offsetLeft)), true);
    check("the strip that was cut is still there",
      q('[data-track-id="' + track + '"]') !== null, true);

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
      "Messgeräte",
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
      ["Neues Projekt", "Aus Vorlage", "Öffnen", "Medien importieren",
       "Untertitel importieren", "Untertitel exportieren", "Spur hinzufügen",
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

    button("Rückgängig").click();
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

    button("Auf die Zeitleiste").click();
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

    const add = await until("the way into the effect library", () => effectPicker());
    checkAtLeast("reaching the effect library is a thumb-sized target",
      add.getBoundingClientRect().height, 44);
    await openShelf("Effekte durchsuchen");
    check("a phone gets the library too, with a picture per effect",
      tileOf("brightness") !== null && tileOf("vignette") !== null, true);
    checkAtLeast("and every Add in it is a thumb-sized target",
      Math.round(Math.min(...all(".v-fx__add").map((n) => n.getBoundingClientRect().height))), 44);
    checkAtMost("the shelf fits the window rather than running off it",
      Math.round(shelf().getBoundingClientRect().right - innerWidth), 0);
    q('[data-effect-id="brightness"] button').click();
    await until("the browser to close", () => (shelf() === null ? true : null));
    const slider = await until("the parameter row",
      () => q('.v-inspector__effect input[type="range"]'));
    check("a phone can put an effect on a clip and see its parameter",
      slider.labels[0].textContent, "Stärke");
    check("and the keyframe switch is there too",
      button("Keyframe für Stärke am Playhead") !== null, true);
    check("the panel fits the window", inspector.getBoundingClientRect().right <= innerWidth, true);
    check("putting an effect on a clip raised nothing", banner(), "");
    // The picture is meant to show what the four checks above claim, and the effect is the last
    // thing in a panel that scrolls -- unscrolled it would be a photograph of the transform.
    slider.scrollIntoView({ block: "center" });
    await sleep(200);
    await photograph("phone-inspector");

    button("Rückgängig").click();
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
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
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

  // The acceptance point of the effect library: fifteen tiles, each one the effect's own shader over
  // the frame the editor is showing. jsdom proves the grid is built; only a driver proves the tiles
  // are pictures -- and only comparing them proves they are fifteen different ones rather than the
  // same frame reprinted under fifteen names.
  async function runEffects() {
    await until("the editor", () => q(".v-dropzone") && q('[data-testid="timeline"]'));
    await dropFixture();
    // Somewhere with a picture in it: the tiles are drawn from the frame at the playhead, and the
    // first frame of real material is a fade from black about as often as it is a picture.
    forward(20);
    await until("a picture in the preview", () => (luma() > 8 ? true : null), 60000);
    onScreen = luma();

    pointer("pointerdown", q("[data-clip-id]"));
    pointer("pointerup", q("[data-clip-id]"));
    await until("the inspector", () => effectPicker());

    await openShelf("Übergänge durchsuchen");
    check("the transition shelf offers transitions and nothing else",
      all(".v-fx__tile").map((node) => node.dataset.effectId).sort().join(),
      ["blur-dissolve", "crossfade", "dip", "iris", "slide", "wipe", "zoom"].join());
    checkAtLeast("and a dissolve halfway through is a real picture",
      pixelsOf(tileOf("crossfade")).length, 4);
    labelled("Schließen").click();
    await until("the shelf to close", () => (shelf() === null ? true : null));

    await openShelf("Effekte durchsuchen");
    const tiles = all(".v-fx__tile img");
    check("every effect this build can draw has a tile", tiles.length, 13);
    check("and each one is a picture at the size the grid asks for",
      [...new Set(tiles.map((img) => `${img.naturalWidth}x${img.naturalHeight}`))], ["192x108"]);

    // The check the whole feature rests on. Fifteen tiles of the same frame would look like a
    // working library from across the room, and every one of them would be a lie.
    const distinct = tiles.filter((img) => apart(img, tileOf("brightness")) > 6).length;
    checkAtLeast("and the tiles are pictures of different effects, not one frame reprinted",
      distinct, tiles.length - 1);

    // Searching is what makes a shelf a library rather than a longer list.
    setValue(q(".v-fx__search"), "maske");
    await sleep(150);
    check("searching narrows the shelf to what was asked for",
      all(".v-fx__tile").map((node) => node.dataset.effectId).sort().join(),
      ["mask-ellipse", "mask-rect"].join());
    setValue(q(".v-fx__search"), "");
    await sleep(150);

    // The claim the tiles rest on, and the one the pixel checks in the engine cannot make: that the
    // picture a tile is drawn from is *this* frame. An application that quietly fell back to the
    // generated reference would still show fifteen different effects, and every one of them would be
    // about somebody else's footage.
    const before = pixelsOf(tileOf("brightness"));
    labelled("Schließen").click();
    await until("the shelf to close", () => (shelf() === null ? true : null));
    forward(25);
    await repainted();
    await openShelf("Effekte durchsuchen");
    const after = pixelsOf(tileOf("brightness"));
    let moved = 0;
    for (let i = 0; i < before.length; i += 1) moved += Math.abs(before[i] - after[i]);
    checkAtLeast("the tiles are drawn from the frame at the playhead, not from a stand-in",
      Math.round(moved / before.length * 100) / 100, 0.5);

    check("the library raised nothing", banner(), "");
    // Left open on purpose: what the guide's picture of the shelf has to show is this dialog.
    q(".v-fx").scrollTop = 0;
    await sleep(300);
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
    check("the gallery shows every template that ships", cards.length, 9);
    check(
      "and each one under its own name",
      cards.map((entry) => entry.querySelector(".v-template__name").textContent),
      [
        "Kraftvoller Auftakt",
        "Blende auf",
        "Weiche Diaschau",
        "Im Takt",
        "Hochkant-Story",
        "Geteiltes Bild",
        "Bauchbinde",
        "Abspann",
        "Produkt im Blick",
      ],
    );

    // The picture on a card is rendered, not painted: `Template::preview` bakes the template
    // against a stand-in and the ordinary compositor draws it. Nothing here can pass without the
    // WASM bake, the generators and WebGL all working, which is exactly the claim a card makes.
    await until(
      "every card to have its picture",
      () => all(".v-template__still").length === 9,
      120000,
    );
    const stills = all(".v-template__still");
    check("every picture actually loaded",
      stills.every((image) => image.complete && image.naturalWidth > 0), true);
    // A blank card, a black frame and a failed render are all one flat colour. A build is not.
    check("and none of them is a flat rectangle",
      stills.filter((image) => spread(image) < 40).length, 0);

    // The box holds the template's own shape from the first paint, so the grid cannot reflow under
    // the pointer when a picture lands -- and an upright template is visibly an upright template.
    check(
      "an upright template gets an upright card",
      card("story-vertical").querySelector(".v-template__poster").style.aspectRatio,
      "1080 / 1920",
    );

    const chip = (key) => q('[data-category="' + key + '"]');
    check("there is a chip for every category the catalogue carries",
      all("[data-category]").map((entry) => entry.textContent),
      ["Alle", "Auftakt", "Diaschau", "Hochkant", "Titel und Abspann", "Produkte"]);
    chip("titles").click();
    await sleep(100);
    check("choosing one narrows the gallery to it",
      all("[data-template-id]").map((entry) => entry.dataset.templateId),
      ["lower-third", "end-card"]);
    chip("all").click();
    await sleep(100);
    check("and going back brings the rest with it", all("[data-template-id]").length, 9);

    check("an untouched project is not worth saving as a template",
      labelled("Projekt als Vorlage speichern"), undefined);

    // The card is the button. A picture with a control under it makes the largest thing on the
    // screen the one part that does nothing.
    check("the card itself is what is clicked", card("bold-open").tagName, "BUTTON");
    card("bold-open").click();
    const wizard = await until("the wizard", () => q('[data-testid="template-wizard"]'));
    check("the wizard opens on the template's own first step",
      wizard.querySelector('[role="status"]').textContent.includes("Schritt 1 von 3"), true);
    check("and shows the whole path rather than a number to count against",
      [...wizard.querySelector('[data-testid="template-rail"]').children]
        .map((entry) => entry.textContent),
      ["Ihr Material", "Ihre Worte", "Ihre Farbe"]);
    check("the template's own picture stays on the screen while it is filled in",
      wizard.querySelector(".v-templates__poster .v-template__still") !== null, true);
    check("with one field per placeholder of that step",
      [...wizard.querySelectorAll("[data-slot-id]")].map((slot) => slot.dataset.slotId),
      ["shot"]);
    check("it says how much material a placeholder wants",
      wizard.textContent.includes("Braucht mindestens 3,5 s Material."), true);

    const advance = () => labelled("Weiter").closest("button");
    check("and refuses to go on while the placeholder is empty", advance().disabled, true);

    await chooseFile(fileInput("shot"), FIXTURE.name);
    await until("the choice to register", () => q('[data-chosen="shot"]'));
    check("material opens the way on", advance().disabled, false);
    check("choosing material raised nothing", banner(), "");

    advance().click();
    await until("the words step", () => q('[data-slot-id="title"]'));
    // A text slot falls back to the words its own generator ships with, not to the template's
    // name: leaving the field alone has to give the design its author drew, not a hole.
    check("the title field starts on the words the template was designed with",
      q('[data-slot-id="title"] textarea').value, "IHR TITEL\nHIER");
    setValue(q('[data-slot-id="title"] textarea'), "Sommer 2026");
    setValue(q('[data-slot-id="subtitle"] textarea'), "Ein Sommer in acht Bildern");
    advance().click();
    await until("the colour step", () => q('[data-slot-id="brand"]'));
    setValue(q('[data-slot-id="brand"] input[type="color"]'), "#1188ff");
    await sleep(100);

    // The last panel says what is about to be made. A wizard that asks across three panels and
    // then acts on all of them at once is asking for a decision nobody has been shown.
    const summary = q('[data-testid="template-summary"]');
    check("the last panel lists every answer, including those from earlier steps",
      ["shot", "title", "subtitle", "brand"]
        .map((id) => summary.querySelector('[data-answer="' + id + '"]').textContent),
      [
        "Erste Aufnahme" + FIXTURE.name,
        "TitelSommer 2026",
        "UntertitelEin Sommer in acht Bildern",
        "Ihre Farbe#1188ff",
      ]);

    labelled("Projekt erstellen").click();
    await until("the wizard to close", () => q('[data-testid="template-wizard"]') === null);
    check("the gallery closed with it", q('[data-testid="template-gallery"]'), null);
    check("baking raised nothing", banner(), "");

    const clips = all("[data-clip-id]");
    // A colour field, the shot, a title and a subtitle: three of the four carry no material at all.
    check("everything the template builds is on the timeline", clips.length, 4);
    // Three and a half seconds is 350 px at the default zoom, and 2.0 s of material is all the
    // fixture has. A bake that shortened the clip to what the file holds would give 200 px and a
    // hole where the zoom expects a picture; slowing it keeps the rhythm the card promised.
    check("the shot is as long as the template says, not as long as the file",
      Math.round(clipBox("clp_shot").width), 350);
    check("and it starts where the colour field hands over",
      Math.round(clipBox("clp_shot").left - clipBox("clp_bg").left), 300);

    await until("the name to reach the tab", () => document.title !== "Videola", 10000);
    check("the typed name is the project's name", document.title, "Sommer 2026 — Videola");

    // At the start there is no material on the screen at all: a gradient, and shortly a title. If
    // the generators were not drawn the frame would be the flat project background, and `bare`
    // would be the whole of it. This is the one measurement that says a template carrying no
    // footage is still a picture.
    const brand = [0x11, 0x88, 0xff];
    button("An den Anfang").click();
    const opening = await until("the opening frame", () => {
      const measured = measure(brand);
      return measured.lit > 1000 ? measured : null;
    }, 60000);
    checkAtLeast("the colour field is drawn with no material at all", opening.lit, 1000);
    check("and it is a ramp rather than the flat background behind it", opening.bare < 0.2, true);

    // And then the words. White is what a title is drawn in and what nothing else in this opening
    // is, so more of it than a moment ago is the letters someone typed arriving on the screen.
    const white = [0xff, 0xff, 0xff];
    const before = measure(white).bare;
    forward(30);
    const after = await until("the title on the screen", () => {
      const measured = measure(white).bare;
      return measured > before ? measured : null;
    }, 60000);
    check("the words that were typed are on the screen", after > before, true);

    // Past the last clip there is nothing but the background, which is where the colour answer
    // becomes something a person can see. Waited for as "an opaque pixel that is not the one on the
    // clip" rather than as "a blue pixel": a wrong colour has to fail the three checks below, not
    // time the wait out.
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

    // Back onto the title, so there is a build made of nothing but text and colour standing behind
    // what comes next.
    button("An den Anfang").click();
    forward(30);
    await until("the picture again", () => measure(brand).lit > 1000, 20000);

    // And then the gallery again, because that is what the screenshot at the end of the budget has
    // to catch. This whole milestone is a claim about what someone sees before they choose, and the
    // only way to judge it is to look at it. Every picture is rendered by now, so this costs a
    // click.
    openMenu();
    inMenu("Aus Vorlage").click();
    await until("the gallery once more", () => q('[data-testid="template-gallery"]'));
    await until("its pictures still there", () => all(".v-template__still").length === 9, 30000);
    check("nothing was reported by the end", banner(), "");
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

    button("Rückgängig").click();
    await sleep(200);
    check("the whole drag is one step back", all("[data-clip-id]").length, 2);
    button("Wiederholen").click();
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
    const add = await until("the way into the effect library", () => effectPicker());
    checkAtLeast("with a thumb-sized target to reach the effect library",
      add.getBoundingClientRect().height, 44);
    check("the properties panel is beside the picture, not behind a tab",
      box('[data-testid="inspector"]').right <= innerWidth, true);

    // The tablet is where the mixer was cut worst: three strips under a 22vh properties panel and
    // a 26% timeline left it 66 px of the 342 a strip needs.
    check("a tablet keeps the desk out of the way too", q('[data-testid="mixer"]'), null);
    button("Mischpult zeigen").click();
    await until("the mixing desk", () => q('[data-testid="mixer"]'));
    checkAtMost("a tablet shows whole mixer strips too",
      q(".v-mixer__strips").scrollHeight - q(".v-mixer__strips").clientHeight, 0);
    checkAtLeast("and every fader in them is a touch target",
      Math.round(Math.min(...all(".v-mixer .v-param__slider")
        .map((node) => node.getBoundingClientRect().height))), 44);

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
  const clipBox = (id) => q(`[data-clip-id="${id}"]`).getBoundingClientRect();

  // Subtitles, end to end and through the surface: an SRT dropped on the editor, a track of its own,
  // a clip per cue at the cue own instants, and the words reachable in the panel that edits them.
  // Nothing here is reachable from jsdom -- File.text(), a real drop and the layout of the track
  // headers are all the browser own.
  //
  // It undoes itself, so the playback section below still works on the project it was handed.
  async function captions() {
    const srt = [
      "1", "00:00:00,000 --> 00:00:01,000", "Erste Zeile", "",
      "2", "00:00:01,000 --> 00:00:02,000", "Zweite Zeile", "und noch eine", "",
    ].join("\n");
    const transfer = new DataTransfer();
    transfer.items.add(new File([srt], "dialog.srt", { type: "text/plain" }));
    const before = all("[data-clip-id]").length;
    const captionClips = () => all('[data-kind="caption"] [data-clip-id]');
    drag("drop", q(".v-dropzone"), transfer);

    await until("the caption clips", () => all("[data-clip-id]").length === before + 2);
    check("a dropped subtitle file raises nothing", banner(), "");
    const kinds = all(".v-timeline__headerKind").map((node) => node.textContent.trim());
    check("a track of its own, named for what it carries", kinds.includes("Untertitel"), true);

    // One second at the default zoom is a hundred pixels, so a one-second cue is a hundred wide.
    // Measured rather than read out of the model: this is the only run where the model reaching the
    // screen is the thing in question.
    const boxes = captionClips().map((n) => n.getBoundingClientRect());
    check("each cue is as wide as it is long",
      boxes.map((b) => Math.round(b.width)), [100, 100]);

    // The two-line cue, in the field that edits it. A hard line break that reached the model and
    // not the field is the failure a text input produces, and it is invisible until it is read back.
    captionClips().at(-1).click();
    const field = await until("the text field", () => q('[data-testid="text-content"]'));
    check("the words are in the panel that edits them",
      field.value, "Zweite Zeile\nund noch eine");
    check("and it is a textarea, so both lines survived", field.tagName, "TEXTAREA");
    checkAtLeast("with room to show both of them",
      Math.round(field.getBoundingClientRect().height), 44);

    // The track and the two cues, the cues under one coalesce key. Undoing until the clips are gone
    // is what leaves the project below exactly as it was.
    for (let round = 0; round < 6 && all("[data-clip-id]").length > before; round += 1) {
      button("Rückgängig").click();
      await sleep(50);
    }
    check("and it leaves the project as it found it", all("[data-clip-id]").length, before);
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
      shelves
        ? runEffects()
        : templates
          ? runTemplates()
          : phone
            ? runPhone()
            : tablet
              ? runTablet()
              : run(),
    )
    .catch((error) => {
      // The stack, not only the message: a null that could not be clicked names a control, and
      // without the line it came from every one of them is a candidate.
      results.push({
        name: "the run itself",
        ok: false,
        got: String(error?.stack ?? error),
        want: "no throw",
      });
    })
    .then(() => {
      if (noise.length > 0) {
        results.push({ name: "nothing reached the console", ok: false, got: noise, want: [] });
      }
      if (noise.length > 0) {
        results.push({ name: "nothing reached the console", ok: false, got: noise, want: [] });
      }
      // What the page was actually laid out in. Chrome writes --screenshot at the size of the
      // window, and the window is taller than the page by the height of its own furniture; without
      // this the harness has no way to know where the editor stops and the black band starts.
      results.push({ name: `VIEWPORT ${innerWidth}x${innerHeight}`, ok: true, got: "noted", want: "noted" });
      noteZones("end");
      results.push({
        name: `ENV ${window.__videolaEnv ?? "unknown"}`,
        ok: true,
        got: "noted",
        want: "noted",
      });
      return fetch("/results", { method: "POST", body: JSON.stringify(results) });
    });
})();
