import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import {
  builtinTemplates,
  cmd,
  createProjectBackend,
  createTemplateBackend,
  createWasmBackend,
  on,
  FLICKS_PER_SECOND,
  readTemplateFile,
  timeToSeconds,
  VideolaDocument,
  type ClipId,
  type Command,
  type Frame,
  type LoadWarning,
  type MediaAsset,
  type MediaId,
  type Project,
  type SlotAnswer,
  type Template,
  type Time,
  type Track,
  type TrackKind,
} from "@videola/core";
import {
  audioEffectManifests,
  AudioGraph,
  AudioSource,
  effectManifests,
  EXPORT_FORMATS,
  formatSupport,
  measure as measureScopes,
  measureLoudness,
  Playback,
  probe,
  startExport,
  VECTOR_TARGETS,
  type ExportHandle,
  type ExportRange,
  type ScopeReading,
} from "@videola/engine";
import {
  clearSession,
  importFile,
  mediaForProject,
  mediaHash,
  missingMedia,
  readSession,
  relinkMedia,
  worthSaving,
  writeSession,
} from "@videola/media";
import type { Peaks, Session } from "@videola/media";
import {
  AppShell,
  chosenTransition,
  DropZone,
  EffectBrowser,
  ExportDialog,
  Inspector,
  MediaLibrary,
  Mixer,
  PanelTabs,
  pickFiles,
  Preview,
  projectEnd,
  Scopes,
  TemplateGallery,
  TemplateWizard,
  Timeline,
  Transport,
  useI18n,
  useLayoutMode,
  type EditorPanel,
  type ExportFormatChoice,
  type ExportProgress,
  type ExportSelection,
  type MediaDrop,
  type MediaGrab,
} from "@videola/ui";

import { effectTiles, revokeTiles } from "./effectTiles";
import { useTemplatePosters } from "./posters";
import { useThumbnails } from "./thumbnails";
import { offerUpdate } from "./updates";

type ErrorKey = "error.openFailed" | "error.saveFailed" | "error.actionFailed" | "error.importFailed";

interface ShellError {
  key: ErrorKey;
  reason: string;
  id: number;
}

const MEDIA_ACCEPT = "video/*,audio/*";

// Often enough that a crash costs a minute of work at most, rarely enough that it never competes
// with a drag for the main thread. It is only the project state -- the media are in OPFS already.
const AUTOSAVE_MS = 30_000;

// Stamped into every .videola this build writes.
const APP_VERSION = "0.3.0";
// The size the preview is shrunk to before it is counted. Sixteen by nine, so the waveform's
// columns line up with the picture's, and small enough that the read is 147 kB rather than eight
// megabytes -- see the note on the timer below.
const SCOPE_WIDTH = 256;
const SCOPE_HEIGHT = 144;
const SCOPE_INTERVAL_MS = 100;
const STILL_DURATION = 5 * FLICKS_PER_SECOND;
const NOTHING_MISSING: ReadonlySet<MediaId> = new Set();
// A stable empty array, so the poster hook is not handed a fresh one on every render.
const NO_TEMPLATES: readonly Template[] = [];

export function App(): ReactElement {
  const [doc, setDoc] = useState<VideolaDocument>();
  const [project, setProject] = useState<Project>();
  const [warnings, setWarnings] = useState<LoadWarning[]>([]);
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });
  const [error, setError] = useState<ShellError>();
  const [playback, setPlayback] = useState<Playback>();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [playhead, setPlayhead] = useState<Time>(0);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(NOTHING_MISSING);
  const [waveforms, setWaveforms] = useState<ReadonlyMap<string, Peaks>>();
  const [loudness, setLoudness] = useState<number>();
  const [measuring, setMeasuring] = useState(false);
  const [panel, setPanel] = useState<EditorPanel>("timeline");
  const [reading, setReading] = useState<ScopeReading>();
  // On a phone the tab bar already says which panel is showing, so the switch on the
  // transport is for the layouts that have no tabs.
  const [scopesOpen, setScopesOpen] = useState(false);
  const [grab, setGrab] = useState<MediaGrab>();
  // The timeline owns the selection and reports it; keeping a second one here would be a
  // second answer to the same question. The export dialogue reads it too.
  const [selection, setSelection] = useState<readonly ClipId[]>([]);
  const [exporting, setExporting] = useState(false);
  const [formats, setFormats] = useState<ExportFormatChoice[]>([]);
  const [progress, setProgress] = useState<ExportProgress>();
  const [exportError, setExportError] = useState<string>();
  const [browsing, setBrowsing] = useState<1 | 2>();
  const [tiles, setTiles] = useState<ReadonlyMap<string, string>>();
  const [gallery, setGallery] = useState(false);
  const [catalogue, setCatalogue] = useState<Template[]>([]);
  const [template, setTemplate] = useState<Template>();
  const [slotMedia, setSlotMedia] = useState<Record<string, MediaAsset>>({});
  const [templateError, setTemplateError] = useState<string>();
  const [baking, setBaking] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [recovered, setRecovered] = useState<Session>();
  const runningExport = useRef<ExportHandle>(undefined);
  // The autosave timer reads the project from here rather than being rebuilt around it: keyed on
  // `project` the interval would restart on every keystroke and a continuous edit would never
  // reach the thirty seconds.
  const latest = useRef<Project>(undefined);
  const nextErrorId = useRef(0);
  // The same pure function of the same window the shell reads, so the two cannot disagree. Passing
  // it down would mean turning AppShell's children into a render prop for one boolean.
  const layout = useLayoutMode("auto");
  const thumbnails = useThumbnails(project?.library ?? []);
  // Only while the gallery is up. Rendering a still for every template in a dialog nobody has
  // opened is work the editor would be doing instead of drawing the timeline.
  const posters = useTemplatePosters(gallery ? catalogue : NO_TEMPLATES);

  // A stable identity per report, so an identical repeat error still replaces the DOM node
  // and gets re-announced by assistive tech instead of sitting there as unchanged content.
  const reportError = useCallback((key: ErrorKey, cause: unknown) => {
    setError({ key, reason: reasonOf(cause), id: ++nextErrorId.current });
  }, []);

  // The one way a document is taken over, whether it came from an empty start, from a file or from
  // a template. `epoch` is what makes the preview a fresh element each time: `Playback.dispose()`
  // takes the WebGL context of the canvas it was attached to down with it, on purpose (see
  // context.ts), so handing the next Playback the same element would hand it a lost context and a
  // preview that never draws again.
  const adopt = useCallback((next: VideolaDocument) => {
    setDoc(next);
    setProject(next.state);
    setWarnings(next.warnings);
    setFlags({ canUndo: next.canUndo, canRedo: next.canRedo });
    setSelection([]);
    setError(undefined);
    setEpoch((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The snapshot is only offered, never taken: restoring over a tab someone opened on purpose
    // is the same surprise as losing the work, from the other side.
    void readSession().then((session) => {
      if (!cancelled) setRecovered(session);
    });
    createWasmBackend()
      .then((backend) => {
        if (cancelled) return;
        adopt(new VideolaDocument(backend));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportError("error.openFailed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [adopt, reportError]);

  useEffect(() => {
    latest.current = project;
  }, [project]);

  // An empty project is never written: it is what a fresh tab holds, and writing it is exactly how
  // the snapshot this tab is still offering to restore would be destroyed. A failed write is a
  // console line and nothing more -- an autosave nobody asked for must not raise a banner over the
  // work it was meant to protect.
  useEffect(() => {
    const timer = setInterval(() => {
      const current = latest.current;
      if (current === undefined || !worthSaving(current)) return;
      void writeSession(current).catch((err: unknown) => console.error(err));
    }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);

  const restore = useCallback(
    async (session: Session) => {
      try {
        adopt(new VideolaDocument(await createProjectBackend(session.project)));
        setRecovered(undefined);
      } catch (err) {
        reportError("error.openFailed", err);
        setRecovered(undefined);
      }
    },
    [adopt, reportError],
  );

  const discard = useCallback(() => {
    setRecovered(undefined);
    void clearSession().catch((err: unknown) => console.error(err));
  }, []);

  useEffect(() => {
    if (doc === undefined) return;
    return doc.subscribe((next) => {
      setProject(next);
      // doc.warnings only ever narrows (media.remove is the one command that can clear a
      // "missing" entry) or stays put after load - but it does change, and #notify() in
      // document.ts already refreshes it before listeners run, so read it fresh here too instead
      // of leaving the banner stuck on whatever was true at load time.
      setWarnings(doc.warnings);
      setFlags({ canUndo: doc.canUndo, canRedo: doc.canRedo });
    });
  }, [doc]);

  // The one place a project's name is visible in this version. Without it a title -- typed in the
  // wizard or not -- would only ever show up in the name of a downloaded file.
  useEffect(() => {
    const title = project?.meta.title.trim() ?? "";
    window.document.title = title === "" ? "Videola" : `${title} — Videola`;
  }, [project?.meta.title]);

  // Keyed on the ids and not on the library object: the core hands back a fresh project on every
  // dispatch, and a drag across the timeline would otherwise stat OPFS once per pointer movement.
  const libraryIds = (project?.library ?? []).map((asset) => asset.id).join(" ");

  useEffect(() => {
    let cancelled = false;
    void missingMedia(libraryIds === "" ? [] : libraryIds.split(" ")).then((next) => {
      if (!cancelled) setMissing(next);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryIds]);

  // One transport per document: the batch queries are bound to the document they came from, and
  // opening another project has to leave the old audio context behind rather than steer two.
  useEffect(() => {
    if (doc === undefined) return;
    const audio = new AudioContext();
    const next = new Playback({
      audio,
      graph: new AudioGraph(audio, new AudioSource(), doc.effectParamsAt),
      sourceTimes: doc.sourceTimesAt,
      effectParams: doc.effectParamsAt,
      transforms: doc.transformsAt,
    });
    setPlayback(next);
    return () => {
      next.dispose();
      void audio.close();
      setPlayback(undefined);
    };
  }, [doc]);

  // The playhead comes from the clock and from nowhere else. Reading isPlaying in the same
  // callback is what makes the play button follow a context that only woke up a turn later.
  useEffect(() => {
    if (playback === undefined) return;
    return playback.onTime((at) => {
      setPlayhead(at);
      setPlaying(playback.isPlaying);
    });
  }, [playback]);

  // What the scopes read, and how often.
  //
  // Measured before it was chosen. On the software rasteriser the harness runs, reading the whole
  // 1080p drawing buffer back and counting all two million pixels costs 33 ms -- longer than a
  // frame, every frame, for a panel nobody is dragging. Shrinking on the GPU first and counting
  // 256 by 144 costs 0.9 ms, and a person reading a scope cannot see it change faster than about
  // ten times a second. Ten hertz of 0.9 ms is under one percent of one core.
  //
  // On a timer rather than on the clock's tick, because that is what makes the rate the rate: a
  // tick fires at whatever the display does and would need a counter of its own to be capped. And
  // the effect only exists while the panel is on screen, so an editor nobody is grading in pays
  // nothing at all.
  useEffect(() => {
    if (playback === undefined || canvas === null) return;
    if (!(layout === "phone" ? panel === "scopes" : scopesOpen)) return;
    const take = (): void => {
      const pixels = playback.sample(SCOPE_WIDTH, SCOPE_HEIGHT);
      setReading(pixels.length === 0 ? undefined : measureScopes(pixels, SCOPE_WIDTH, SCOPE_HEIGHT));
    };
    take();
    const timer = window.setInterval(take, SCOPE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playback, canvas, layout, panel, scopesOpen]);

  useEffect(() => {
    if (playback === undefined || canvas === null) return;
    try {
      playback.attach(canvas);
      playback.refresh();
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [playback, canvas, reportError]);

  // load() takes the project synchronously and only the audio decoding is awaited, so the
  // refresh right after it already draws the edit that caused this.
  useEffect(() => {
    if (playback === undefined || project === undefined) return;
    let cancelled = false;
    // The strips come from the buffers `load` decoded, so they can only be read once it resolves.
    // Dropping a superseded result is what keeps a drag from painting the strips of a project state
    // that two pointer movements have already replaced.
    // A reading belongs to the project it was taken from. Any edit can change it, so it goes rather
    // than standing there as a number about a timeline that no longer exists.
    setLoudness(undefined);
    void playback.load(project).then(() => {
      if (!cancelled) setWaveforms(playback.waveforms());
    });
    playback.refresh();
    return () => {
      cancelled = true;
    };
  }, [playback, project]);

  // Deliberately not wrapped in try/catch: the timeline decides which refusals are ordinary,
  // and it can only do that if they reach it. Catching here turned a trim held against its
  // limit into nine error banners in a single drag.
  const edit = useCallback(
    (command: Command, coalesceKey?: string) => {
      doc?.dispatch(command, coalesceKey);
    },
    [doc],
  );

  // Measuring means rendering the whole timeline offline, so it happens when it is asked for and
  // never per frame. Its own context, because the one driving playback is running and rendering into
  // it would fight the transport for the same graph.
  const measure = useCallback(() => {
    if (project === undefined || doc === undefined) return;
    const seconds = timeToSeconds(projectEnd(project));
    if (seconds <= 0) {
      setLoudness(Number.NEGATIVE_INFINITY);
      return;
    }
    setMeasuring(true);
    const rate = project.settings.sampleRate;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    // The core's resolver goes in for the same reason the export gets it: a reading taken without
    // the mastering chain would report a loudness no listener and no file ever has.
    measureLoudness(ctx, project, new AudioSource(), doc.effectParamsAt)
      .then(setLoudness, (err: unknown) => reportError("error.actionFailed", err))
      .finally(() => setMeasuring(false));
  }, [doc, project, reportError]);

  const addTrack = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.dispatch(cmd.trackAdd("video", `V${doc.state.timeline.tracks.length + 1}`));
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const undo = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.undo();
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const redo = useCallback(() => {
    if (doc === undefined) return;
    try {
      doc.redo();
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  const save = useCallback(async () => {
    if (doc === undefined || project === undefined) return;
    try {
      const now = new Date().toISOString();
      // The bytes live in OPFS since M1, so they have to be gathered before the write - the core
      // only holds media a .videola brought with it, and falls back to those on its own.
      const media = await mediaForProject(project);
      const bytes = doc.save(
        {
          appVersion: APP_VERSION,
          created: now,
          modified: now,
          locale: navigator.language,
        },
        media,
      );
      downloadBlob(bytes, `${project.meta.title || project.meta.id}.videola`);
      setError(undefined);
    } catch (err) {
      reportError("error.saveFailed", err);
    }
  }, [doc, project, reportError]);

  // Asked once the dialog opens and once per project size, because the answer depends on both the
  // machine and the resolution -- a 4K H.264 encode can be refused where 1080p is fine.
  useEffect(() => {
    if (!exporting || project === undefined) return;
    let stale = false;
    void formatSupport({
      width: project.settings.width,
      height: project.settings.height,
      sampleRate: project.settings.sampleRate,
      channels: 2,
    }).then((support) => {
      if (stale) return;
      setFormats(support.map((entry) => ({ id: entry.format.id, ...entry })));
    });
    return () => {
      stale = true;
    };
  }, [exporting, project]);

  const beginExport = useCallback(
    (options: ExportSelection) => {
      const format = EXPORT_FORMATS.find((entry) => entry.id === options.formatId);
      if (doc === undefined || project === undefined || format === undefined) return;
      setExportError(undefined);
      setProgress({ done: 0, total: 1 });
      const handle = startExport({
        project,
        sourceTimes: doc.sourceTimesAt,
        effectParams: doc.effectParamsAt,
        transforms: doc.transformsAt,
        options: {
          format,
          width: options.width,
          height: options.height,
          fps: options.fps,
          videoBitrate: options.videoBitrate,
          audioBitrate: options.audioBitrate,
          range: rangeOf(project, options.range === "selection" ? selection : []),
        },
        onProgress: (done, total) => {
          if (runningExport.current === handle) setProgress({ done, total });
        },
      });
      runningExport.current = handle;
      const name = project.meta.title || project.meta.id;
      handle.result.then(
        (result) => {
          // A cancelled run's rejection and a finished run's file can both be in flight while the
          // next one is already going. Whichever handle is current owns the screen.
          if (runningExport.current !== handle) return;
          runningExport.current = undefined;
          downloadBlob(result.bytes, `${name}.${result.extension}`, result.mimeType);
          setProgress(undefined);
          setExporting(false);
        },
        (err: unknown) => {
          if (runningExport.current !== handle) return;
          runningExport.current = undefined;
          setProgress(undefined);
          setExportError(exportReason(err));
        },
      );
    },
    [doc, project, selection],
  );

  const cancelExport = useCallback(() => {
    runningExport.current?.cancel();
  }, []);

  const open = useCallback(async () => {
    const file = (await pickFiles(".videola"))[0];
    if (file === undefined) return;
    try {
      adopt(new VideolaDocument(await createWasmBackend(new Uint8Array(await file.arrayBuffer()))));
    } catch (err) {
      reportError("error.openFailed", err);
    }
  }, [adopt, reportError]);

  // One file at a time and in order, because each one decides where it lands from the state the
  // one before it left behind. A rejected file costs itself and not the rest of the drop.
  const importMedia = useCallback(
    async (files: File[]) => {
      if (doc === undefined) return;
      for (const file of files) {
        try {
          appendClip(doc, await importFile(file, doc, probe));
          setError(undefined);
        } catch (err) {
          reportError("error.importFailed", err);
        }
      }
    },
    [doc, reportError],
  );

  // On a phone the timeline is behind a tab, so the clip has to be shown as well as placed --
  // otherwise the button looks like it did nothing.
  const addToTimeline = useCallback(
    (media: MediaId) => {
      if (doc === undefined) return;
      try {
        appendClip(doc, media);
        setPanel("timeline");
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [doc, reportError],
  );

  // A medium carried out of the library and let go over a track. One command, so one undo step --
  // and the track and the instant are the timeline's own, not a guess made here.
  const dropMedia = useCallback(
    ({ media, track, at }: MediaDrop) => {
      if (doc === undefined) return;
      try {
        const asset = doc.state.library.find((entry) => entry.id === media);
        if (asset === undefined) return;
        doc.dispatch(
          cmd.clipAdd(track, { kind: "media", media }, at, asset.duration ?? STILL_DURATION),
        );
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [doc, reportError],
  );

  const relink = useCallback(
    async (media: MediaId) => {
      const file = (await pickFiles(MEDIA_ACCEPT))[0];
      if (file === undefined) return;
      try {
        await relinkMedia(media, file);
        setMissing((current) => new Set([...current].filter((id) => id !== media)));
        // The project did not change, so nothing else would ever ask this medium again: playback
        // remembers a failed open until it is told to drop it.
        const hash = mediaHash(media);
        if (hash !== undefined) playback?.forget(hash);
        playback?.refresh();
        setError(undefined);
      } catch (err) {
        reportError("error.importFailed", err);
      }
    },
    [playback, reportError],
  );

  // The catalogue comes out of the core once per session; nothing in it changes while the
  // application runs, and it carries no media to pay for.
  const openGallery = useCallback(() => {
    setTemplateError(undefined);
    setGallery(true);
    if (catalogue.length > 0) return;
    void builtinTemplates().then(setCatalogue, () =>
      setTemplateError("error.templateOpenFailed"),
    );
  }, [catalogue.length]);

  const closeTemplates = useCallback(() => {
    setGallery(false);
    setTemplate(undefined);
    setSlotMedia({});
    setTemplateError(undefined);
  }, []);

  // The clip the shelf is being opened for. Read from the project rather than kept beside the
  // selection, so that adding an effect and reopening shows the chain as it now stands.
  const selectedClip =
    selection[0] === undefined || project === undefined
      ? undefined
      : project.timeline.tracks.flatMap((track) => track.clips).find((c) => c.id === selection[0]);

  // The tiles are drawn when the shelf opens and thrown away when it closes. Nothing is kept: the
  // frame they are drawn from is the one at the playhead, so a cache would be showing the picture
  // from wherever the playhead used to be -- and the whole grid costs less than one frame of
  // playback to make. See `effectTiles` for what the passes actually cost.
  useEffect(() => {
    if (browsing === undefined) return;
    let dropped = false;
    let made: ReadonlyMap<string, string> | undefined;
    effectTiles(canvas).then(
      (tiles) => {
        made = tiles;
        if (dropped) return revokeTiles(tiles);
        setTiles(tiles);
      },
      (err: unknown) => reportError("error.actionFailed", err),
    );
    return () => {
      dropped = true;
      setTiles(undefined);
      if (made !== undefined) revokeTiles(made);
    };
  }, [browsing, canvas, reportError]);

  // A one-input effect joins the clip's chain; a two-input one is its transition, and replaces
  // whatever was there. Which of the two is not the browser's business -- it offers what the
  // registry declared and hands back a name.
  const addFromBrowser = useCallback(
    (id: string) => {
      const chosen = selectedClip;
      const manifest = effectManifests().find((candidate) => candidate.id === id);
      if (chosen === undefined || manifest === undefined) return;
      edit(
        manifest.inputs === 2
          ? cmd.clipSetTransition(chosen.id, chosenTransition(id, chosen.transitionIn ?? undefined))
          : cmd.effectAdd(on.clip(chosen.id), id),
      );
      setBrowsing(undefined);
    },
    [edit, selectedClip],
  );

  // The ordinary import: hashed, into storage, probed. A slot answer is the asset that comes out of
  // it, so material chosen in the wizard is in no way different from material dropped on the editor.
  const pickSlotMedia = useCallback(
    async (slot: string, file: File) => {
      if (doc === undefined) return;
      try {
        const id = await importFile(file, doc, probe);
        const asset = doc.state.library.find((entry) => entry.id === id);
        if (asset !== undefined) setSlotMedia((current) => ({ ...current, [slot]: asset }));
        setTemplateError(undefined);
      } catch (err) {
        setTemplateError(templateReason(err, "error.importFailed"));
      }
    },
    [doc],
  );

  const openTemplateFile = useCallback(async (file: File) => {
    try {
      const opened = await readTemplateFile(new Uint8Array(await file.arrayBuffer()));
      setSlotMedia({});
      setTemplateError(undefined);
      setTemplate(opened);
    } catch {
      setTemplateError("error.templateOpenFailed");
    }
  }, []);

  // Bake-to-project, and that is the end of the template: what comes back is a document like any
  // other, so everything below simply swaps the one it was holding.
  const bake = useCallback(
    (answers: Readonly<Record<string, SlotAnswer>>, frame: Frame) => {
      if (template === undefined) return;
      setBaking(true);
      void createTemplateBackend(template, answers, {
        ...template.project.settings,
        width: frame.width,
        height: frame.height,
      })
        .then(
          (backend) => {
            adopt(new VideolaDocument(backend));
            closeTemplates();
          },
          (err: unknown) => setTemplateError(templateReason(err, "error.templateBakeFailed")),
        )
        .finally(() => setBaking(false));
    },
    [adopt, template, closeTemplates],
  );

  const saveAsTemplate = useCallback(() => {
    if (doc === undefined || project === undefined) return;
    try {
      const now = new Date().toISOString();
      const bytes = doc.saveAsTemplate(
        {
          appVersion: APP_VERSION,
          created: now,
          modified: now,
          locale: navigator.language,
        },
        project.meta.id,
        // The selection is the marking. Selecting clips in the timeline is already how someone
        // says "these ones", and a second way to mark a clip would be a second thing to explain.
        // Nothing selected means "decide for me", which is what the button said before this.
        selection.length > 0 ? selection : undefined,
      );
      downloadBlob(bytes, `${project.meta.title || project.meta.id}.videolat`);
      setTemplateError(undefined);
    } catch (err) {
      setTemplateError(templateReason(err, "error.templateSaveFailed"));
    }
  }, [doc, project, selection]);

  const playPause = useCallback(() => {
    if (playback === undefined) return;
    if (playback.isPlaying) playback.pause();
    else playback.play();
  }, [playback]);

  const seek = useCallback((time: Time) => playback?.seek(time), [playback]);
  const step = useCallback((direction: 1 | -1) => playback?.stepFrame(direction), [playback]);
  const repaint = useCallback(() => playback?.refresh(), [playback]);

  return (
    <AppShell
      onNew={() => window.location.reload()}
      onTemplates={openGallery}
      onOpen={() => void open()}
      onImportMedia={
        doc === undefined ? undefined : () => void pickFiles(MEDIA_ACCEPT).then(importMedia)
      }
      onAddTrack={doc === undefined ? undefined : addTrack}
      onExport={
        doc === undefined
          ? undefined
          : () => {
              // A failure from the last attempt would otherwise greet the next one.
              setExportError(undefined);
              setExporting(true);
            }
      }
      onSave={doc === undefined ? undefined : save}
      onUndo={undo}
      onRedo={redo}
      canUndo={flags.canUndo}
      canRedo={flags.canRedo}
    >
      <DropZone onFiles={(files) => void importMedia(files)}>
        <div className="v-editor">
          <div className="v-banners">
            <ErrorBanner error={error} />
            <WarningBanner warnings={warnings} />
            {recovered !== undefined && (
              <RestoreBanner
                session={recovered}
                onRestore={() => void restore(recovered)}
                onDiscard={discard}
              />
            )}
          </div>
          <UpdateCheck />
          {project === undefined || doc === undefined ? (
            <p style={{ padding: "var(--v-space-6)" }}>…</p>
          ) : (
            <>
              <Preview
                key={epoch}
                width={project.settings.width}
                height={project.settings.height}
                onCanvas={setCanvas}
                onResize={repaint}
              />
              <Transport
                playing={playing}
                time={playhead}
                duration={projectEnd(project)}
                fps={project.settings.fps}
                onPlayPause={playPause}
                onSeek={seek}
                onStep={step}
                scopes={layout === "phone" ? undefined : scopesOpen}
                onToggleScopes={layout === "phone" ? undefined : () => setScopesOpen((on) => !on)}
              />
              {layout === "phone" && <PanelTabs panel={panel} onSelect={setPanel} />}
              {/* Unmounted rather than hidden while another panel shows: the timeline windows
                  its clips by the width it measures, and a display:none container measures zero.
                  It would come back empty. */}
              {(layout !== "phone" || panel === "library") && (
                <MediaLibrary
                  library={project.library}
                  missing={missing}
                  fps={project.settings.fps}
                  thumbnails={thumbnails}
                  // Only where the timeline is on screen at the same time. On a phone the two take
                  // turns behind the tab bar, so there is nowhere to drag to.
                  draggable={layout !== "phone"}
                  onImport={() => void pickFiles(MEDIA_ACCEPT).then(importMedia)}
                  // The camera and the gallery are what a touch device has instead of a file
                  // system, and `capture` only means anything to one.
                  onCapture={layout === "desktop" ? undefined : (files) => void importMedia(files)}
                  onAdd={addToTimeline}
                  onRelink={(media) => void relink(media)}
                  onGrab={setGrab}
                />
              )}
              {(layout === "phone" ? panel === "scopes" : scopesOpen) && (
                <Scopes reading={reading} targets={VECTOR_TARGETS} />
              )}
              {(layout !== "phone" || panel === "mixer") && (
                <Mixer
                  project={project}
                  loudness={loudness}
                  measuring={measuring}
                  playhead={playhead}
                  effects={audioEffectManifests()}
                  effectParamsAt={doc?.effectParamsAt}
                  dispatch={edit}
                  onMeasure={measure}
                  onSeek={seek}
                />
              )}
              {(layout !== "phone" || panel === "timeline") && (
                <Timeline
                  project={project}
                  playhead={playhead}
                  waveforms={waveforms}
                  effects={effectManifests()}
                  dispatch={edit}
                  onSeek={seek}
                  onSelectionChange={setSelection}
                  grab={grab}
                  onDropMedia={dropMedia}
                  onGrabEnd={() => setGrab(undefined)}
                />
              )}
              {(layout !== "phone" || panel === "inspector") && doc !== undefined && (
                <Inspector
                  project={project}
                  clip={selection[0]}
                  playhead={playhead}
                  effects={effectManifests()}
                  effectParamsAt={doc.effectParamsAt}
                  transformsAt={doc.transformsAt}
                  dispatch={edit}
                  onSeek={seek}
                  onBrowse={setBrowsing}
                />
              )}
            </>
          )}
        </div>
      </DropZone>
      {browsing !== undefined && selectedClip !== undefined && (
        <EffectBrowser
          offers={effectManifests()}
          only={browsing}
          // Both kinds refuse a second of the same: `effect.add` treats a repeated type as a no-op,
          // and a clip has one transition. A button that would do nothing says so instead.
          taken={
            browsing === 2
              ? selectedClip.transitionIn == null
                ? []
                : [selectedClip.transitionIn.transitionType]
              : selectedClip.effects.map((authored) => authored.effectType)
          }
          tiles={tiles}
          onAdd={addFromBrowser}
          onClose={() => setBrowsing(undefined)}
        />
      )}
      {gallery && template === undefined && (
        <TemplateGallery
          templates={catalogue}
          posters={posters}
          error={templateError}
          onChoose={(entry) => {
            setSlotMedia({});
            setTemplateError(undefined);
            setTemplate(entry);
          }}
          onOpenTemplate={(file) => void openTemplateFile(file)}
          // Only offered once there is something worth turning into a recipe.
          onSaveCurrent={hasClips(project) ? saveAsTemplate : undefined}
          onClose={closeTemplates}
        />
      )}
      {template !== undefined && (
        <TemplateWizard
          template={template}
          media={slotMedia}
          thumbnails={thumbnails}
          poster={posters[template.manifest.id]}
          error={templateError}
          busy={baking}
          onPickMedia={(slot, file) => void pickSlotMedia(slot, file)}
          onFinish={bake}
          onBack={() => {
            setTemplate(undefined);
            setTemplateError(undefined);
          }}
          onClose={closeTemplates}
        />
      )}
      {exporting && project !== undefined && (
        <ExportDialog
          formats={formats}
          settings={project.settings}
          hasSelection={selection.length > 0}
          progress={progress}
          error={exportError}
          onExport={beginExport}
          onCancel={cancelExport}
          onClose={() => setExporting(false)}
        />
      )}
    </AppShell>
  );
}

// An imported medium that is not on the timeline is an entry in a list nobody built yet, so it
// goes straight behind whatever is already on the first track of its kind.
function appendClip(doc: VideolaDocument, media: MediaId): void {
  const asset = doc.state.library.find((entry) => entry.id === media);
  if (asset === undefined) return;
  adoptFormat(doc, asset);
  const kind: TrackKind = asset.kind === "audio" ? "audio" : "video";
  const track =
    doc.state.timeline.tracks.find((candidate) => candidate.kind === kind) ??
    added(doc, kind, `${kind === "audio" ? "A" : "V"}${doc.state.timeline.tracks.length + 1}`);
  if (track === undefined) return;
  const start = track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
  // A medium the core could not time - a still, or a container without a duration - still has to
  // occupy something on the timeline, and five seconds is the length every editor gives a still.
  const duration = asset.duration ?? STILL_DURATION;
  doc.dispatch(cmd.clipAdd(track.id, { kind: "media", media }, start, duration));
}

// The first medium of an untouched project decides its format, which is what every editor does
// and what keeps a 720p clip from sitting as a small rectangle in the middle of a 1080p frame:
// the draw list maps one source pixel to one project pixel, and there is no command yet to scale
// a clip. Only while nothing has been imported and no track exists -- past that point the format
// is a decision somebody made.
function adoptFormat(doc: VideolaDocument, asset: MediaAsset): void {
  const untouched =
    doc.state.library.length === 1 && doc.state.timeline.tracks.length === 0;
  if (!untouched || asset.width == null || asset.height == null || asset.fps == null) return;
  doc.dispatch(
    cmd.projectSetSettings({
      ...doc.state.settings,
      width: asset.width,
      height: asset.height,
      fps: asset.fps,
    }),
  );
}

function added(doc: VideolaDocument, kind: TrackKind, name: string): Track | undefined {
  doc.dispatch(cmd.trackAdd(kind, name));
  return doc.state.timeline.tracks.find((candidate) => candidate.kind === kind);
}

// It renders nothing and exists only to sit inside the I18nProvider, which is where `t` lives.
// The ref is what keeps a change of locale from asking a second time.
function UpdateCheck(): null {
  const { t } = useI18n();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void offerUpdate(t);
  }, [t]);
  return null;
}

function ErrorBanner({ error }: { error?: ShellError }): ReactElement | null {
  const { t } = useI18n();
  if (error === undefined) return null;
  return (
    <p key={error.id} role="alert" className="v-banner v-banner--alert">
      {/* The reason is a catalogue key wherever the core or the importer raised it, and a
          browser's own words otherwise; translate() hands an unknown key straight back. */}
      {t(error.key, { reason: t(error.reason) })}
    </p>
  );
}

function WarningBanner({ warnings }: { warnings: LoadWarning[] }): ReactElement | null {
  const { t } = useI18n();
  const missingMedia = warnings.filter((warning) => warning.kind === "missingMedia").length;
  if (missingMedia === 0) return null;
  // Same severity tier as ErrorBanner (role="alert" + --v-danger): the theme has no separate
  // "warning" token, and a missing medium is exactly as actionable as the errors above it, not
  // a passive status update - role="status" is announced politely and easy to miss, which
  // contradicted the danger colour right next to it.
  return (
    <p role="alert" className="v-banner v-banner--alert">
      {t("warning.missingMedia", { count: missingMedia })}
    </p>
  );
}

// An offer, not a verdict: `role="status"` rather than the `role="alert"` the two banners above
// use, because nothing has gone wrong on this screen -- something is available.
function RestoreBanner({
  session,
  onRestore,
  onDiscard,
}: {
  session: Session;
  onRestore: () => void;
  onDiscard: () => void;
}): ReactElement {
  const { t } = useI18n();
  const when = new Date(session.savedAt);
  return (
    <p role="status" className="v-banner v-banner--offer">
      <span>
        {t("session.found", {
          when: Number.isNaN(when.getTime()) ? session.savedAt : when.toLocaleString(),
        })}
      </span>
      <button type="button" className="v-button" onClick={onRestore}>
        {t("session.restore")}
      </button>
      <button type="button" className="v-button v-button--quiet" onClick={onDiscard}>
        {t("session.discard")}
      </button>
    </p>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasClips(project: Project | undefined): boolean {
  return project?.timeline.tracks.some((track) => track.clips.length > 0) === true;
}

// The template dialogs translate whatever they are handed, so only a catalogue key may reach them.
// The core's own refusals are English prose meant for a log, not for a panel.
function templateReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.startsWith("error.")) return error.message;
  console.error(error);
  return fallback;
}

// The whole project, or everything the selection spans -- from the earliest selected clip to the
// last one that ends. A range is a pair of instants either way, so the export never learns that a
// selection was involved.
function rangeOf(project: Project, clips: readonly ClipId[]): ExportRange {
  const selected = project.timeline.tracks
    .flatMap((track) => track.clips)
    .filter((entry) => clips.includes(entry.id));
  if (selected.length === 0) return { from: 0, to: projectEnd(project) };
  return {
    from: Math.min(...selected.map((clip) => clip.start)),
    to: Math.max(...selected.map((clip) => clip.start + clip.duration)),
  };
}

// Everything the export throws is a catalogue key. Anything else came from the browser and is of
// no use on screen, so it keeps its place in the console and the user is told what is true.
function exportReason(error: unknown): string {
  if (!(error instanceof Error)) return "error.exportFailed";
  if (/^(error|export)\./.test(error.message)) return error.message;
  console.error(error);
  return "error.exportFailed";
}

function downloadBlob(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  type = "application/zip",
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in Safari/Firefox before it has
  // actually started reading the blob; give the browser a tick to pick it up first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
