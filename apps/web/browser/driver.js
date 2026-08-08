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
  // The template run is its own script for the same reason the phone run is: what it has to answer
  // is whether a baked template can be *seen*, which means reading the drawing buffer, which means
  // the virtual clock.
  const templates = location.search.includes("templates");
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
    const bytes = await (await fetch("/fixture.mp4")).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: "video/mp4" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Two counts out of one read: how much of the frame carries a picture, and how much of it is
  // still the bare background. The second one is what a brightness-based count cannot answer --
  // a dark shot is dark whether it was fitted or not, but background is background.
  function measure(background) {
    const canvas = q("canvas");
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

  function centrePixel() {
    const canvas = q("canvas");
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
    labelled("Aus Vorlage").click();
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

    await chooseFile(fileInput("shot1"), "fixture.mp4");
    await until("the first choice to register", () => q('[data-chosen="shot1"]'));
    await chooseFile(fileInput("shot2"), "fixture.mp4");
    await until("the second choice to register", () => q('[data-chosen="shot2"]'));
    check("two out of three is still not enough", advance().disabled, true);

    await chooseFile(fileInput("shot3"), "fixture.mp4");
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
    }, 40000);
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

  const card = (id) => q(`[data-template-id="${id}"]`);
  const fileInput = (slot) => q(`[data-slot-id="${slot}"] input[type="file"]`);

  async function dropFixture() {
    const bytes = await (await fetch("/fixture.mp4")).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "fixture.mp4", { type: "video/mp4" }));
    drag("drop", q(".v-dropzone"), transfer);
    return until("a clip on the timeline", () => q("[data-clip-id]"));
  }

  (templates ? runTemplates() : phone ? runPhone() : run())
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
