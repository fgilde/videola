import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import {
  builtinTemplates,
  captionClips,
  captionCues,
  cmd,
  createProjectBackend,
  createTemplateBackend,
  createWasmBackend,
  on,
  FLICKS_PER_SECOND,
  parseCaptions,
  readTemplateFile,
  toSrt,
  ASPECTS,
  markerTimes,
  reframe,
  splitAtTimes,
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
  beatMarkers,
  clipQuad,
  cutSilence,
  duckCommands,
  effectManifests,
  EXPORT_FORMATS,
  carriesSubtitles,
  formatSupport,
  measure as measureScopes,
  measureLoudness,
  movedBy,
  normalizeToTarget,
  Playback,
  probe,
  ProxyQueue,
  quadCentre,
  rotatedTo,
  scaledBy,
  silentSpans,
  speechSpans,
  startExport,
  VECTOR_TARGETS,
  WAVEFORM_BUCKETS,
  type ExportHandle,
  type ExportRange,
  type Level,
  type ProxyState,
  type ScopeReading,
} from "@videola/engine";
import {
  clearSession,
  importFile,
  importLut,
  mediaForProject,
  mediaHash,
  missingMedia,
  readSession,
  proxiesInUse,
  relinkMedia,
  // Not a React hook, whatever the name reads like on this side: the one switch that tells the
  // decoders whether the preview may read proxies. Aliased so nothing here looks like one.
  useProxies as setProxyUse,
  worthSaving,
  writeSession,
} from "@videola/media";
import type { Peaks, Session } from "@videola/media";
import {
  About,
  AppShell,
  chosenTransition,
  DropZone,
  EffectBrowser,
  ExportDialog,
  Inspector,
  Shortcuts,
  MediaLibrary,
  Mixer,
  markerAfter,
  PanelTabs,
  pickFiles,
  Preview,
  projectEnd,
  MotionPath,
  Scopes,
  SourceBar,
  Stage,
  TemplateGallery,
  TemplateWizard,
  Timeline,
  Transport,
  UpdateOffer,
  useI18n,
  useLayoutMode,
  type EditMode,
  type EditorPanel,
  type ExportFormatChoice,
  type ExportProgress,
  type ExportSelection,
  type MediaDrop,
  type MediaGrab,
  type SourceRange,
  type StageGrab,
  type StagePoint,
} from "@videola/ui";

import { effectTiles, revokeTiles } from "./effectTiles";
import { useTemplatePosters } from "./posters";
import { useThumbnails } from "./thumbnails";
import { findDesktopUpdate, insideTauri, revealWindow, watchForWebUpdate } from "./updates";
import type { DesktopUpdate } from "./updates";

// Two of these are not failures of the program but of the file, and they read that way: a subtitle
// file with nothing legible in it, and a project with no subtitles to write.
type ErrorKey =
  | "error.openFailed"
  | "error.saveFailed"
  | "error.actionFailed"
  | "error.importFailed"
  | "caption.none"
  | "caption.nothingToWrite";

interface ShellError {
  key: ErrorKey;
  reason: string;
  id: number;
}

const MEDIA_ACCEPT = "video/*,audio/*,.cube";

// Both extensions and both media types: a browser that knows neither still offers the file, and a
// browser that knows one of them stops offering everything else.
const CAPTION_ACCEPT = ".srt,.vtt,text/vtt,application/x-subrip";

// By the name, because the type is what a browser guesses and it guesses `text/plain` for an SRT as
// often as not. The name is what the person who saved the file chose.
function isCaptionFile(file: File): boolean {
  return /\.(?:srt|vtt)$/i.test(file.name);
}

// By the name for the same reason, and with less choice: a browser guesses nothing at all for a
// `.cube` and hands it over with an empty type.
function isLutFile(file: File): boolean {
  return /\.cube$/i.test(file.name);
}

// Often enough that a crash costs a minute of work at most, rarely enough that it never competes
// with a drag for the main thread. It is only the project state -- the media are in OPFS already.
const AUTOSAVE_MS = 30_000;

// Stamped into every .videola this build writes.
const APP_VERSION = "0.5.0";
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

const NO_PROXIES: ReadonlyMap<string, ProxyState> = new Map();

// Held down, a rotation goes in whole steps. Fifteen degrees is the step every editor uses, and it
// is what makes an upright picture reachable by hand.
const ROTATE_STEP = 15;

// Where the documentation and the builds live. One constant, because the about dialogue and the
// offer in the menu must not disagree about it.
const SITE = "https://fgilde.github.io/videola/";

// The keyframe track that carries a motion path, spelled the way the core spells it.
const POSITION_TRACK = "position";

// Enough for a smooth curve at any pane size, and few enough that a drag over the picture costs
// less than a frame of playback.
const PATH_SAMPLES = 48;

// The ceiling on how finely a track is scanned for a duck or for its pauses. Twenty milliseconds a
// bucket is what the detector wants; over a long timeline that is more buckets than a peak reader
// should be asked for, and past this the analysis is coarser than ideal rather than slow.
const MAX_ANALYSIS_BUCKETS = 60_000;

// Distinguishes one multi-command action from the next under the coalescing key, so two ducks in a
// row are two entries on the undo stack rather than one. The timeline keeps its own for the same
// reason.
let actionSequence = 0;

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
  const [rate, setRate] = useState(0);
  const [resolution, setResolution] = useState(1);
  // The medium a range is being marked in. One at a time: the source bar shows one, and a second
  // set of in and out points would belong to nothing on screen.
  const [armed, setArmed] = useState<MediaId>();
  const [missing, setMissing] = useState(NOTHING_MISSING);
  // Keyed by content hash, which is what the queue works in. The library shows media ids, and the
  // translation happens where it is drawn rather than being kept twice.
  const [proxies, setProxies] = useState<ReadonlyMap<string, ProxyState>>(NO_PROXIES);
  // A counter and not a copy of the setting. What the button shows is read back out of the one
  // flag the decoders consult, so a wiring that changed the button without changing the decoding
  // would leave the button stuck -- which is a check that fails, rather than a switch that lies.
  const [proxySwitches, setProxySwitches] = useState(0);
  const useOriginals = !proxiesInUse();
  const proxyQueue = useRef<ProxyQueue>(undefined);
  const [waveforms, setWaveforms] = useState<ReadonlyMap<string, Peaks>>();
  // A reading carries the project it was taken from, so "is this still about this timeline"
  // is answered by comparing rather than by a second effect racing to clear it. It used to be
  // a bare number wiped whenever the project changed -- which worked until a reading arrived
  // *because* of an edit, and normalising is exactly that: the correction is dispatched and
  // the number that follows it was about the corrected state all along.
  const [reading, setReading] = useState<{ lufs: number; of: Project }>();
  const [measuring, setMeasuring] = useState(false);
  const [panel, setPanel] = useState<EditorPanel>("timeline");
  const [scopeReading, setScopeReading] = useState<ScopeReading>();
  // On a phone the tab bar already says which panel is showing, so the switch on the
  // transport is for the layouts that have no tabs.
  const [scopesOpen, setScopesOpen] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const [keys, setKeys] = useState(false);
  // A browser tab left open for a week runs whatever was current when it was opened. The service
  // worker notices a new build and waits; nothing is swapped under a session with work in it, so
  // this is an offer and the reload is the answer to it.
  const [takeUpdate, setTakeUpdate] = useState<(() => void) | undefined>(undefined);
  useEffect(() => {
    watchForWebUpdate((take) => setTakeUpdate(() => take));
  }, []);
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

  // One queue for the whole session rather than one per document. Proxies belong to this disk and
  // not to a project: a medium used in two projects is transcoded once, and opening another
  // project must not throw away work that is already half done.
  useEffect(() => {
    const queue = new ProxyQueue({
      onChange: () => setProxies(new Map(queue.states)),
    });
    proxyQueue.current = queue;
    return () => {
      queue.dispose();
      proxyQueue.current = undefined;
      setProxies(NO_PROXIES);
    };
  }, []);

  // Asked for on the same key the missing check uses, so an import is what starts a transcode and
  // a drag across the timeline is not.
  useEffect(() => {
    const hashes = (libraryIds === "" ? [] : libraryIds.split(" "))
      .map((id) => mediaHash(id))
      .filter((hash): hash is string => hash !== undefined);
    void proxyQueue.current?.want(hashes);
  }, [libraryIds]);

  // A source that is already open holds a handle on the file it chose, and a proxy arriving does
  // not reach back into it. Keyed on which media are ready rather than on the whole map, or every
  // "building" would reopen every decoder for nothing.
  const proxiesReady = [...proxies]
    .filter(([, state]) => state === "ready")
    .map(([hash]) => hash)
    .sort()
    .join(" ");

  useEffect(() => {
    playback?.reopen();
  }, [playback, proxiesReady, proxySwitches]);

  // The library speaks media ids and the queue speaks content hashes. Translated here, where both
  // are already to hand, rather than kept as a second map that can fall out of step.
  const proxiesByMedia = useMemo(() => {
    const byMedia = new Map<MediaId, ProxyState>();
    for (const asset of project?.library ?? []) {
      const hash = mediaHash(asset.id);
      const state = hash === undefined ? undefined : proxies.get(hash);
      if (state !== undefined) byMedia.set(asset.id, state);
    }
    return byMedia;
  }, [project?.library, proxies]);

  // The switch has to change what is decoded, not what is displayed. It sets the one flag the
  // decoders read; the effect above then reopens every source, because one already open is holding
  // the file it chose when it opened.
  const switchToOriginals = useCallback((wanted: boolean) => {
    setProxyUse(!wanted);
    setProxySwitches((count) => count + 1);
  }, []);

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
      setRate(playback.rate);
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
      setScopeReading(
        pixels.length === 0 ? undefined : measureScopes(pixels, SCOPE_WIDTH, SCOPE_HEIGHT),
      );
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
  // The desktop build opens hidden behind a splash screen: a window showing an empty grey editor
  // while a WASM module compiles looks like a program that has crashed. The core being up is the
  // first moment there is anything worth looking at, and it is a moment only this side knows.
  const shown = useRef(false);
  useEffect(() => {
    if (doc === undefined || shown.current) return;
    shown.current = true;
    void revealWindow();
  }, [doc]);

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
      setReading({ lufs: Number.NEGATIVE_INFINITY, of: project });
      return;
    }
    setMeasuring(true);
    const rate = project.settings.sampleRate;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    // The core's resolver goes in for the same reason the export gets it: a reading taken without
    // the mastering chain would report a loudness no listener and no file ever has.
    measureLoudness(ctx, project, new AudioSource(), doc.effectParamsAt)
      .then(
        (lufs) => setReading({ lufs, of: project }),
        (err: unknown) => reportError("error.actionFailed", err),
      )
      .finally(() => setMeasuring(false));
  }, [doc, project, reportError]);

  // Rendering the timeline once per correction, which is why this shares `measuring` with the
  // reading above: both are the same slow thing and neither may run twice at once.
  //
  // What lands in the readout afterwards is what the second render measured, not the target that
  // was asked for. A programme that cannot reach its target -- one already at the fader's ceiling,
  // or a silent one -- then says so with a number instead of claiming success.
  const normalize = useCallback(
    (targetLufs: number) => {
      if (project === undefined || doc === undefined) return;
      const seconds = timeToSeconds(projectEnd(project));
      if (seconds <= 0) return;
      setMeasuring(true);
      const rate = project.settings.sampleRate;
      const source = new AudioSource();
      const measureOnce = (candidate: Project): Promise<number> =>
        measureLoudness(
          new OfflineAudioContext(2, Math.ceil(seconds * rate), rate),
          candidate,
          source,
          doc.effectParamsAt,
        );
      normalizeToTarget(project, targetLufs, measureOnce)
        .then(
          (result) => {
            // Dispatched only when it moved: a project already on target must not land an
            // undo step that changes nothing.
            if (result.volume !== project.master.volume) {
              doc.dispatch(cmd.projectSetMasterVolume(result.volume));
            }
            // Against `doc.state` and not against `project`: the dispatch above has just
            // replaced it, and the reading is about what the fader now is.
            setReading({ lufs: result.loudness, of: doc.state });
          },
          (err: unknown) => reportError("error.actionFailed", err),
        )
        .finally(() => setMeasuring(false));
    },
    [doc, project, reportError],
  );

  // The strips are read from the peaks the graph already holds, at a resolution fine enough for a
  // duck rather than the one the timeline draws with: 600 buckets over a ten-minute clip is a
  // second apiece, and a bed that came down a second late would have swallowed the first sentence.
  const analysisPeaks = useCallback((): ReadonlyMap<string, Peaks> => {
    if (playback === undefined || project === undefined) return new Map();
    const seconds = Math.max(1, timeToSeconds(projectEnd(project)));
    return playback.waveforms(
      Math.min(MAX_ANALYSIS_BUCKETS, Math.max(WAVEFORM_BUCKETS, Math.ceil(seconds / 0.02))),
    );
  }, [playback, project]);

  const duck = useCallback(
    (music: string, speech: string) => {
      if (doc === undefined || project === undefined) return;
      const peaks = analysisPeaks();
      const musicTrack = project.timeline.tracks.find((track) => track.id === music);
      const speechTrack = project.timeline.tracks.find((track) => track.id === speech);
      if (musicTrack === undefined || speechTrack === undefined) return;
      try {
        // One coalesce key for the lot, so a duck comes back off the timeline in a single undo
        // however many corners it wrote.
        const key = `mixer-duck-${music}-${(actionSequence += 1)}`;
        for (const command of duckCommands(musicTrack, speechSpans(speechTrack, peaks))) {
          doc.dispatch(command, key);
        }
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [analysisPeaks, doc, project, reportError],
  );

  const cutQuiet = useCallback(
    (trackId: string) => {
      if (doc === undefined || project === undefined) return;
      const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
      if (track === undefined) return;
      try {
        const key = `mixer-cut-silence-${trackId}-${(actionSequence += 1)}`;
        cutSilence(doc, trackId, silentSpans(track, analysisPeaks()), key);
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [analysisPeaks, doc, project, reportError],
  );

  // The same edit in a frame of another shape -- a widescreen cut as a portrait one, which is the
  // single most asked-for thing a modern editor does. Every clip is scaled to cover the new frame in
  // the same step, because a reframe that left black bars down both sides would be a reframe nobody
  // wanted.
  const reframeInto = useCallback(
    (id: string) => {
      const into = ASPECTS.find((aspect) => aspect.id === id);
      if (doc === undefined || into === undefined) return;
      try {
        const key = `reframe-${id}-${(actionSequence += 1)}`;
        for (const command of reframe(doc.state, into)) doc.dispatch(command, key);
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [doc, reportError],
  );

  // Where the markers become an edit. Every clip a marker passes through is cut, on every track
  // that is not locked, in one step of the history -- which is what makes cutting to a beat one
  // press rather than one press per bar.
  const splitAtMarkers = useCallback(() => {
    if (doc === undefined) return;
    try {
      splitAtTimes(doc, markerTimes(doc.state), `markers-split-${(actionSequence += 1)}`);
      setError(undefined);
    } catch (err) {
      reportError("error.actionFailed", err);
    }
  }, [doc, reportError]);

  // Every beat on a track becomes a marker, in one step of the history: a beat is a suggestion to
  // cut against, and a hundred cuts nobody asked for would be a hundred clips to take back one at
  // a time. The same coalescing key across all of them, so one press is one undo.
  const markBeats = useCallback(
    (trackId: string) => {
      if (doc === undefined || project === undefined) return;
      const track = project.timeline.tracks.find((candidate) => candidate.id === trackId);
      if (track === undefined) return;
      try {
        const key = `mixer-beats-${trackId}-${(actionSequence += 1)}`;
        for (const command of beatMarkers(track, analysisPeaks())) doc.dispatch(command, key);
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [analysisPeaks, doc, project, reportError],
  );

  // One reading of the whole desk per animation frame, shared by every strip that asks inside it.
  // The frame's own timestamp is what tells "the same frame" from "the next one" -- every meter is
  // asked with the number requestAnimationFrame handed it, so the first ask does the reading and
  // the rest are answered out of it.
  const readLevel = useMemo(() => {
    let taken = 0;
    let levels: ReadonlyMap<string, Level> = new Map();
    return (bus: string, nowMs: number): Level | undefined => {
      if (playback === undefined) return undefined;
      if (nowMs !== taken) {
        levels = playback.levels(taken === 0 ? 0 : (nowMs - taken) / 1000);
        taken = nowMs;
      }
      return levels.get(bus);
    };
  }, [playback]);

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
      setFormats(
        support.map((entry) => ({
          id: entry.format.id,
          ...entry,
          subtitles: carriesSubtitles(entry.format),
        })),
      );
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
          captions: options.captions,
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

  // The geometry of the selected clip, on the picture. The corners come out of the engine, where
  // the very matrix the compositor is handed is built, so the box is on the picture rather than
  // near it. Resolved at the playhead like everything else the preview shows: a keyframed scale
  // means the box is the size the frame on screen actually is.
  const staged = useMemo(() => {
    if (selectedClip === undefined || project === undefined || doc === undefined) return undefined;
    const transform = doc.transformsAt(playhead).get(selectedClip.id);
    if (transform === undefined) return undefined;
    // What the compositor draws the clip at: a medium's own resolution, and the frame for anything
    // that has no picture of its own to be sized by.
    const source_ = selectedClip.source;
    const asset =
      source_.kind === "media"
        ? project.library.find((entry) => entry.id === source_.media)
        : undefined;
    const source =
      asset?.width == null || asset.height == null
        ? { width: project.settings.width, height: project.settings.height }
        : { width: asset.width, height: asset.height };
    return {
      clip: selectedClip,
      name: asset?.originalName ?? selectedClip.id,
      transform,
      source,
      quad: clipQuad(transform, source),
    };
  }, [doc, project, playhead, selectedClip]);

  // The line the clip travels, sampled rather than drawn from the keys: what a segment does
  // between two of them is the core's answer -- an ease, a bezier's handles, a hold -- and a line
  // through the keys alone would be a second, prettier claim about where the clip goes.
  //
  // Three tracks can move a clip and any of them counts: the `position` track a template authors as
  // a shape, and the `x` and `y` tracks the properties panel writes when either field is put on the
  // clock. Drawing only the first would mean a path nobody can make from inside the editor.
  //
  // Keyed on the clip and not on `staged`: `staged` is resolved at the playhead and so changes with
  // every frame of playback, and forty-eight lookups a frame is the main thread. The path is the
  // whole journey, not a moment of it.
  const motion = useMemo(() => {
    if (doc === undefined || selectedClip === undefined) return undefined;
    const tracks = selectedClip.keyframes;
    const times = [
      ...new Set(
        [POSITION_TRACK, "x", "y"].flatMap((name) => (tracks[name] ?? []).map((key) => key.time)),
      ),
    ].sort((left, right) => left - right);
    if (times.length < 2) return undefined;

    const from = selectedClip.start;
    const span = selectedClip.duration;
    const path: StagePoint[] = [];
    for (let step = 0; step <= PATH_SAMPLES; step += 1) {
      const at = from + Math.round((span * step) / PATH_SAMPLES);
      const resolved = doc.transformsAt(at).get(selectedClip.id);
      if (resolved !== undefined) path.push({ x: resolved.x, y: resolved.y });
    }
    // A key's place on the picture is where the clip stands at its instant, the same question the
    // path is sampled from -- so a handle sits on the line rather than beside it.
    const keys = times.map((time) => {
      const resolved = doc.transformsAt(time).get(selectedClip.id);
      const authored = tracks[POSITION_TRACK]?.find((key) => key.time === time);
      return {
        time,
        at: { x: resolved?.x ?? 0, y: resolved?.y ?? 0 },
        interp: authored?.interp ?? tracks.x?.find((key) => key.time === time)?.interp ?? "linear",
        asPath: authored !== undefined,
      };
    });
    return { path, keys };
  }, [doc, selectedClip]);

  const pathKey = useRef<string | undefined>(undefined);
  const onPathDrag = useCallback(
    (index: number, at: StagePoint) => {
      if (selectedClip === undefined || motion === undefined) return;
      const key = motion.keys[index];
      if (key === undefined) return;
      pathKey.current ??= `path-${selectedClip.id}-${index}-${(actionSequence += 1)}`;
      const target = { kind: "clip" as const, clip: selectedClip.id };
      // Written back into the track it came from. A key on the `position` track is one vec2; a key
      // the properties panel wrote is an `x` and a `y`, and moving only one of them would drag the
      // clip sideways when the pointer went diagonally. `keyframe.add` at an instant a key already
      // sits at takes its place, so neither route can leave two keys at one time.
      if (key.asPath) {
        edit(
          cmd.keyframeAdd(
            target,
            null,
            POSITION_TRACK,
            key.time,
            { kind: "vec2", value: [at.x, at.y] },
            key.interp,
          ),
          pathKey.current,
        );
        return;
      }
      edit(
        cmd.keyframeAdd(target, null, "x", key.time, { kind: "float", value: at.x }, key.interp),
        pathKey.current,
      );
      edit(
        cmd.keyframeAdd(target, null, "y", key.time, { kind: "float", value: at.y }, key.interp),
        pathKey.current,
      );
    },
    [edit, motion, selectedClip],
  );

  // One drag is one step. The key is minted when the drag begins and dropped when it ends, so a
  // hundred pointer moves coalesce into a single entry in the history -- the same bargain the
  // timeline's own drags make.
  const stageKey = useRef<string | undefined>(undefined);
  const onStageDrag = useCallback(
    (grab: StageGrab, drag: { at: StagePoint; pointer: StagePoint; delta: StagePoint; even: boolean }) => {
      if (staged === undefined) return;
      stageKey.current ??= `stage-${staged.clip.id}-${grab}-${playhead}`;
      const { transform, source } = staged;
      const centre = quadCentre(staged.quad);
      const next =
        grab === "move"
          ? movedBy(transform, drag.delta)
          : grab === "rotate"
            ? rotatedTo(
                transform,
                { x: drag.at.x - centre.x, y: drag.at.y - centre.y },
                { x: drag.pointer.x - centre.x, y: drag.pointer.y - centre.y },
                drag.even ? ROTATE_STEP : 0,
              )
            : scaledBy(transform, grab, drag.delta, source, !drag.even);
      edit(cmd.clipSetTransform(staged.clip.id, next), stageKey.current);
    },
    [edit, playhead, staged],
  );

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

  // A caption file becomes a track of its own, through the same `clip.add` every other clip goes
  // through -- so an SRT someone was handed passes the loader's own gate rather than a second one
  // written for it. Under one coalesce key, so an import of two thousand cues is one undo step.
  const importCaptions = useCallback(
    async (files: readonly File[]) => {
      if (doc === undefined) return;
      for (const file of files) {
        try {
          const cues = parseCaptions(await file.text());
          if (cues.length === 0) {
            reportError("caption.none", new Error(file.name));
            continue;
          }
          // A short code like every other track this file creates, not a translated phrase: `App`
          // renders the shell that carries the i18n provider, so it stands above it and has no `t`
          // -- and the header beside the name already says "Untertitel" in the reader's language.
          const track = added(doc, "caption", `C${doc.state.timeline.tracks.length + 1}`);
          if (track === undefined) continue;
          const key = `captions-${file.name}-${Date.now()}`;
          for (const command of captionClips(track.id, cues)) doc.dispatch(command, key);
          setError(undefined);
        } catch (err) {
          reportError("error.importFailed", err);
        }
      }
    },
    [doc, reportError],
  );

  // A colour table joins the library like every other medium -- hashed, into OPFS, packed into the
  // .videola by the writer that walks the library -- and never joins the timeline: it has no
  // picture. No track, no clip, which is the whole difference from `importMedia` above.
  const importLuts = useCallback(
    async (files: readonly File[]) => {
      if (doc === undefined) return;
      for (const file of files) {
        try {
          await importLut(file, doc);
          setError(undefined);
        } catch (err) {
          reportError("error.importFailed", err);
        }
      }
    },
    [doc, reportError],
  );

  // A file that is dropped is a file someone meant to bring in, whatever it is. Sorting the caption
  // and table files out here rather than at each call site is what stops a dropped .srt or .cube
  // from reaching the media importer, which would have refused both as an unsupported medium.
  const importFiles = useCallback(
    async (files: File[]) => {
      const captions = files.filter(isCaptionFile);
      const tables = files.filter(isLutFile);
      const media = files.filter((file) => !isCaptionFile(file) && !isLutFile(file));
      if (captions.length > 0) await importCaptions(captions);
      if (tables.length > 0) await importLuts(tables);
      if (media.length > 0) await importMedia(media);
    },
    [importCaptions, importLuts, importMedia],
  );

  const exportCaptions = useCallback(() => {
    if (project === undefined) return;
    const cues = captionCues(project);
    if (cues.length === 0) {
      reportError("caption.nothingToWrite", new Error("caption.nothingToWrite"));
      return;
    }
    const name = project.meta.title || project.meta.id;
    downloadBlob(new TextEncoder().encode(toSrt(cues)), `${name}.srt`, "application/x-subrip");
    setError(undefined);
  }, [project, reportError]);

  const playPause = useCallback(() => {
    if (playback === undefined) return;
    if (playback.isPlaying) playback.pause();
    else playback.play();
  }, [playback]);

  const seek = useCallback((time: Time) => playback?.seek(time), [playback]);
  const step = useCallback((direction: 1 | -1) => playback?.stepFrame(direction), [playback]);
  const repaint = useCallback(() => playback?.refresh(), [playback]);

  // J and L. The rate is read back off the transport rather than kept here as well: the clock is
  // the one that knows how fast it is running, and a second copy could disagree with it.
  const shuttle = useCallback(
    (direction: 1 | -1) => {
      playback?.shuttle(direction);
      setRate(playback?.rate ?? 0);
      setPlaying(playback?.isPlaying === true);
    },
    [playback],
  );

  const jumpMarker = useCallback(
    (direction: 1 | -1) => {
      const marker = markerAfter(project?.markers ?? [], playhead, direction);
      if (marker !== undefined) seek(marker.time);
    },
    [project?.markers, playhead, seek],
  );

  // The three-point edit, from the side that knows where it lands: the source bar marked the
  // range, the playhead says where, and the track is the one the selection is on -- or the first
  // one the material belongs on, the same rule an import follows.
  const threePoint = useCallback(
    (mode: EditMode, range: SourceRange) => {
      if (doc === undefined || armed === undefined) return;
      const track = editTarget(doc, armed, selection[0]);
      if (track === undefined) return;
      const source = { kind: "media", media: armed } as const;
      try {
        doc.dispatch(
          mode === "insert"
            ? cmd.clipInsert(track, source, playhead, range.duration, range.inPoint)
            : cmd.clipOverwrite(track, source, playhead, range.duration, range.inPoint),
        );
        // The playhead lands behind what was just placed, so a run of edits stacks up rather than
        // laying every take over the one before it.
        seek(playhead + range.duration);
        setError(undefined);
      } catch (err) {
        reportError("error.actionFailed", err);
      }
    },
    [doc, armed, playhead, selection, seek, reportError],
  );

  const armedAsset = project?.library.find((entry) => entry.id === armed);

  return (
    <AppShell
      onAbout={() => setAbout(true)}
      onKeys={() => setKeys(true)}
      // Only in a browser: in the desktop build this would offer to install what is already
      // running. `insideTauri` is the same question the updater asks, and asked the same way.
      getAppHref={insideTauri() ? undefined : `${SITE}download`}
      onReframe={doc === undefined ? undefined : reframeInto}
      onNew={() => window.location.reload()}
      onTemplates={openGallery}
      onOpen={() => void open()}
      onImportMedia={
        doc === undefined ? undefined : () => void pickFiles(MEDIA_ACCEPT).then(importMedia)
      }
      onAddTrack={doc === undefined ? undefined : addTrack}
      onImportCaptions={
        doc === undefined
          ? undefined
          : () => void pickFiles(CAPTION_ACCEPT).then(importCaptions)
      }
      onExportCaptions={doc === undefined ? undefined : exportCaptions}
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
      <DropZone onFiles={(files) => void importFiles(files)}>
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
            {takeUpdate !== undefined && <UpdateBanner onReload={takeUpdate} />}
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
                resolution={resolution}
                onCanvas={setCanvas}
                onResize={repaint}
                overlay={
                  staged === undefined ? undefined : (
                    <>
                      {motion !== undefined && (
                        <MotionPath
                          frame={{ width: project.settings.width, height: project.settings.height }}
                          path={motion.path}
                          keys={motion.keys.map((key) => key.at)}
                          onDragKey={onPathDrag}
                          onDrop={() => {
                            pathKey.current = undefined;
                          }}
                        />
                      )}
                      <Stage
                        frame={{ width: project.settings.width, height: project.settings.height }}
                        quad={staged.quad}
                        label={staged.name}
                        onDrag={onStageDrag}
                        onDrop={() => {
                          stageKey.current = undefined;
                        }}
                      />
                    </>
                  )
                }
              />
              <Transport
                playing={playing}
                time={playhead}
                duration={projectEnd(project)}
                fps={project.settings.fps}
                rate={rate}
                onPlayPause={playPause}
                onSeek={seek}
                onStep={step}
                onShuttle={shuttle}
                onMarkerJump={jumpMarker}
                resolution={resolution}
                onResolution={setResolution}
                scopes={layout === "phone" ? undefined : scopesOpen}
                onToggleScopes={layout === "phone" ? undefined : () => setScopesOpen((on) => !on)}
                mixer={layout === "phone" ? undefined : mixerOpen}
                onToggleMixer={layout === "phone" ? undefined : () => setMixerOpen((on) => !on)}
              />
              {/* Between the picture and the panels, because that is where the work is: the range
                  is marked here and lands on the timeline below. */}
              <SourceBar
                asset={armedAsset}
                fps={project.settings.fps}
                onEdit={threePoint}
                onClose={() => setArmed(undefined)}
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
                  proxies={proxiesByMedia}
                  useOriginals={useOriginals}
                  onUseOriginals={switchToOriginals}
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
                  armed={armed}
                  onArm={(media) => setArmed((current) => (current === media ? undefined : media))}
                />
              )}
              {(layout === "phone" ? panel === "scopes" : scopesOpen) && (
                <Scopes reading={scopeReading} targets={VECTOR_TARGETS} />
              )}
              {(layout === "phone" ? panel === "mixer" : mixerOpen) && (
                <Mixer
                  project={project}
                  loudness={reading?.of === project ? reading.lufs : undefined}
                  measuring={measuring}
                  readLevel={readLevel}
                  metering={playing}
                  playhead={playhead}
                  effects={audioEffectManifests()}
                  effectParamsAt={doc?.effectParamsAt}
                  dispatch={edit}
                  onMeasure={measure}
                  onNormalize={normalize}
                  normalizing={measuring}
                  onDuck={duck}
                  onCutSilence={cutQuiet}
                  onMarkBeats={markBeats}
                  onSeek={seek}
                />
              )}
              {(layout !== "phone" || panel === "timeline") && (
                <Timeline
                  project={project}
                  playhead={playhead}
                  waveforms={waveforms}
                  effects={effectManifests()}
                  curveShape={doc?.curveShape}
                  dispatch={edit}
                  onSeek={seek}
                  onSplitAtMarkers={splitAtMarkers}
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
          hasCaptions={project !== undefined && captionCues(project).length > 0}
          progress={progress}
          error={exportError}
          onExport={beginExport}
          onCancel={cancelExport}
          onClose={() => setExporting(false)}
        />
      )}
      {about && (
        <About version={APP_VERSION} desktop={insideTauri()} onClose={() => setAbout(false)} />
      )}
      {keys && <Shortcuts onClose={() => setKeys(false)} />}
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

// Where a three-point edit lands. The track a selected clip is on is the one the editor is
// working on and says so without a second control; failing that it is the first track the material
// belongs on, which is the rule an import already follows -- and if there is none, one is made.
function editTarget(
  doc: VideolaDocument,
  media: MediaId,
  selected: ClipId | undefined,
): string | undefined {
  const onSelection = doc.state.timeline.tracks.find((track) =>
    track.clips.some((clip) => clip.id === selected),
  );
  if (onSelection !== undefined) return onSelection.id;
  const asset = doc.state.library.find((entry) => entry.id === media);
  const kind: TrackKind = asset?.kind === "audio" ? "audio" : "video";
  const existing = doc.state.timeline.tracks.find((track) => track.kind === kind);
  if (existing !== undefined) return existing.id;
  return added(doc, kind, `${kind === "audio" ? "A" : "V"}1`)?.id;
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

// The desktop updater, asked once. The ref is what keeps a change of locale from asking again -- the
// dialogue reads the catalogue itself, so nothing here depends on `t`.
function UpdateCheck(): ReactElement | null {
  const [found, setFound] = useState<DesktopUpdate>();
  const [dismissed, setDismissed] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void findDesktopUpdate().then(setFound);
  }, []);

  if (found === undefined || dismissed) return null;
  return (
    <UpdateOffer
      version={found.version}
      install={found.install}
      onClose={() => setDismissed(true)}
    />
  );
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

// The same shape as the restore offer below, and for the same reason: nothing has gone wrong, a new
// version is simply there. It says what the reload is for, because "reload" on its own reads as
// "something is stuck".
function UpdateBanner({ onReload }: { onReload: () => void }): ReactElement {
  const { t } = useI18n();
  return (
    <p role="status" className="v-banner v-banner--offer" data-testid="update-banner">
      <span>{t("update.web")}</span>
      <button type="button" className="v-button" onClick={onReload}>
        {t("update.reload")}
      </button>
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
