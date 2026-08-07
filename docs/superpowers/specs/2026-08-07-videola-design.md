# Videola — Design / Spec

**Datum:** 2026-08-07
**Status:** freigegeben (Brainstorming abgeschlossen)
**Repo:** https://github.com/fgilde/videola

---

## 1. Ziel

Videola ist ein vollständiger Video-Editor auf dem Funktionsniveau von Wondershare Filmora,
mit dem Audio-Werkzeugkasten von [Audiola](https://github.com/fgilde/Audiola), einem
Template-Modus im Stil von renderforest.com und einer von Grund auf mitgedachten
Automatisierungs-Schnittstelle (REST/WS + MCP), damit AI-Agents das Tool genauso bedienen
können wie ein Mensch.

Harte Anforderungen aus der Aufgabenstellung:

| # | Anforderung |
|---|---|
| A1 | Webbasierte UI, läuft im Browser |
| A2 | Erkennt Handy / Tablet / Desktop automatisch und ist auf jedem perfekt bedienbar |
| A3 | So viel wie möglich offline nutzbar |
| A4 | Kompilierbar für Linux, macOS, Windows, iOS, Android |
| A5 | Docker-Image für Self-Hosting |
| A6 | Projektformat `.videola` — ZIP-basiert wie `.audiola`, enthält **alle** referenzierten Dateien plus Meta |
| A7 | Template-Modus mit Galerie, Vorschau-Video und Wizard; Ergebnis ist ein normales, weiter editierbares Projekt |
| A8 | Deutsch/Englisch umschaltbar, Dark/Light-Theme, modernes aufgeräumtes UI |
| A9 | Multi-Track, Schnitt, Rückwärts-Abspielen von Bereichen, Effekte, Übergänge, Animationen, Keyframes |
| A10 | MCP-Schnittstellen für alles, was das Tool kann, plus saubere API |

---

## 2. Technische Grundentscheidungen

Bestätigt im Brainstorming:

| Entscheidung | Wahl | Begründung |
|---|---|---|
| Stack | React + TypeScript (UI) über Rust-Kern, Tauri 2 als Shell | Tauri 2 deckt Windows/macOS/Linux/iOS/Android aus einer Codebase (A4). Echte Web-App bleibt erhalten (A1). Beste Video-Performance und größtes Ökosystem für WebCodecs/WebGPU. |
| Render-Pfad | Ein Interface, mehrere Backends: `NativeFfmpeg` (Desktop), `NativePlatform` (Mobile), `ServerFfmpeg`, `WebCodecs` | Erfüllt gleichzeitig A3 (Browser exportiert offline), A5 (Docker rendert headless) und liefert nativ HW-Encoding. |
| Audio | Vollständiger DSP-Ausbau im Umfang (Zeitpunkt: M4), AI-Features (Stems/Whisper/TTS) als späteres Plugin hinter einem Interface | Python-Bootstrap + Modell-Downloads + GPU-Erkennung funktionieren auf iOS/Android praktisch nicht und würden das Packaging (A4) sprengen. |
| Erster Milestone | Vertikaler Durchstich durch alle Schichten | Beweist Format, Command-Bus, Engine und Packaging früh; danach ist Breite additiv. |

### 2.1 Kernentscheidung: eine Wahrheit, drei Hosts

Das größte Architekturrisiko lautet: *derselbe Schnitt sieht im Browser anders aus als im
Server-Export.* Es entsteht immer dann, wenn Modell oder Effekte zweimal implementiert werden.
Videola vermeidet das durch genau zwei geteilte Quellen.

**(1) Modell und Logik leben in Rust, nicht in TypeScript.**

`videola-core` (Rust) enthält Datenmodell, Command-Bus, Undo/Redo, `.videola`-I/O,
Keyframe-Auswertung und Template-Baking. Es wird
* nach WASM kompiliert für die Web-App,
* nativ gelinkt in die Tauri-Apps,
* nativ gelinkt in den Server.

TypeScript-Typen werden aus den Rust-Typen generiert (`ts-rs`), damit es keine handgepflegte
Zweitdefinition gibt.

Begründung: Der Compositor für Native- und Server-Rendering muss das Projekt ohnehin
vollständig lesen und interpretieren (Tracks, Clips, Effektparameter, Keyframe-Kurven). Das
Modell existiert in Rust also zwingend. Es zusätzlich in TypeScript zu führen wäre die
Duplikation, die man später nicht mehr synchron hält.

Kosten dieser Entscheidung, bewusst akzeptiert: die Dev-Schleife enthält einen
wasm-Build-Schritt, und an der TS↔WASM-Grenze wird serialisiert. Deshalb ist die Grenze grob
geschnitten (`dispatch(command) → patch`), nicht feingranular.

**(2) Effekte sind Daten, Shader werden einmal geschrieben.**

Ein Effekt besteht aus `effect.json` (Parameter, Labels de/en, UI-Hints, Kategorie) und
`shader.wgsl`. WGSL läuft unverändert in Browser-WebGPU **und** in Rust-`wgpu`. Für den
WebGL2-Fallback transpiliert ein Build-Step WGSL→GLSL mit `naga` (Teil von wgpu).

```
        effect.json + shader.wgsl
                  │
     ┌────────────┼─────────────┐
 WebGPU        WebGL2         wgpu
(Browser)   (Fallback, GLSL)  (Native + Server)
```

Ein Effekt, vier Ausführungsorte, kein FFmpeg-Filtergraph-Nachbau. Übergänge sind Effekte mit
zwei Eingängen und einem `progress`-Parameter — kein zweites Subsystem.

---

## 3. Repo-Struktur

pnpm-Workspace und Cargo-Workspace im gleichen Repo.

```
videola/
├─ Cargo.toml                 (Cargo workspace)
├─ pnpm-workspace.yaml
├─ crates/
│  ├─ videola-core/           Modell, Commands, Undo, .videola-I/O, Keyframes,
│  │                          Template-Baking, Command-Katalog-Generator   (→ WASM)
│  ├─ videola-audio/          DSP-Port aus Audiola: biquad, compressor,
│  │                          loudness (BS.1770/EBU R128), fft, reverse,
│  │                          normalize, ducking, limiter                  (→ WASM)
│  ├─ videola-compositor/     wgpu-Compositor, Effekt-Registry, Frame-Graph
│  ├─ videola-render/         FFmpeg: Demux/Decode/Encode, HW-Accel,
│  │                          Proxy- und Thumbnail-Erzeugung
│  ├─ videola-server/         axum: REST + WS, Render-Queue, MCP (SSE + stdio)
│  └─ videola-tauri/          Tauri-Commands, Dateisystem, Sidecar-Verwaltung
├─ packages/
│  ├─ core-bindings/   @videola/core      WASM-Wrapper + generierte Typen
│  ├─ engine/          @videola/engine    Preview-Host: WebGPU/WebGL2-Pipelines,
│  │                                      WebCodecs-Decode, Frame-Cache,
│  │                                      WebAudio-Graph, Master-Clock
│  ├─ ui/              @videola/ui        React: Timeline, Preview, Inspector,
│  │                                      Media-Library, Wizard; i18n; Theme-Tokens
│  ├─ media/           @videola/media     Import, Peaks, Thumbnails, OPFS-Storage
│  └─ sdk/             @videola/sdk       API-Client für Agents und Fremdcode
├─ effects/                   Effekt-Pakete (effect.json + shader.wgsl),
│                             extern nachladbar
├─ templates/                 mitgelieferte .videolat-Dateien
├─ apps/
│  ├─ web/                    Vite + PWA
│  ├─ desktop/                Tauri 2 → win/mac/linux
│  ├─ mobile/                 Tauri 2 → ios/android
│  └─ server/                 Self-Hosting-Einstieg (bindet videola-server)
├─ docker/                    Dockerfile (multi-stage, mit ffmpeg), compose
├─ docs/
└─ .github/workflows/
```

Grundsatz für die Dateigröße: eine Datei hat eine Aufgabe. Wächst eine Datei über ~400 Zeilen,
ist das ein Signal, dass sie zwei Dinge tut.

---

## 4. Projektformat `.videola`

ZIP-Container, analog zu `.audiola` (dort: `project.json` + `media/`), aber inhaltsadressiert
und mit strikter Trennung von Vertrag und Cache.

```
projekt.videola  (ZIP)
├─ videola.json              schemaVersion, appVersion, id, title,
│                            created, modified, locale
├─ project.json              das Modell: settings, timeline, tracks, clips,
│                            effects, keyframes, markers, master
├─ media/<sha256>.<ext>      Originaldateien, inhaltsadressiert
├─ media/index.json          hash → { originalName, mime, codec, duration,
│                            width, height, fps, sampleRate, channels, size }
├─ assets/fonts/…            eingebettete Fonts
├─ preview.jpg               Projekt-Thumbnail (Galerie, Datei-Explorer)
├─ preview.mp4               optionales Vorschau-Video
│
└── ab hier regenerierbar, bei "Slim Save" weggelassen ──
   ├─ proxies/<sha256>.mp4         Low-Res-Proxies
   ├─ thumbs/<sha256>/…            Timeline-Thumbnails
   ├─ cache/waveforms/<sha256>.pk  Audio-Peaks
   └─ history.json                 Undo-Historie (opt-in)
```

Design-Punkte:

* **Inhaltsadressierung.** Dieselbe Datei zweimal importiert wird einmal gespeichert. Erleichtert
  Diff und Sync und macht Media-IDs stabil über Speichervorgänge hinweg.
* **Regenerierbares getrennt.** `Slim Save` erzeugt eine kleine, teilbare Datei; `Full Save`
  behält Proxies und Caches, damit das Öffnen sofort schnell ist. Beide öffnen überall.
* **Vorwärtskompatibilität.** `schemaVersion` ist Pflicht. Migrationen laufen in `videola-core`
  beim Laden, einmalig und protokolliert. Unbekannte Felder werden beim Laden bewahrt und beim
  Speichern zurückgeschrieben, damit eine ältere App eine neuere Datei nicht beschädigt.
* **Fehlende Medien.** Fehlt eine Datei (manuell manipuliertes ZIP), lädt das Projekt trotzdem;
  betroffene Clips werden als „Medium fehlt" markiert und behalten alle Parameter, sodass ein
  Relink genügt.

`.videolat` ist derselbe Container plus `template.json` (Abschnitt 9).

---

## 5. Datenmodell

Definiert in `videola-core`, TS-Typen generiert.

```
Project
  meta      { id, title, description, author, created, modified, tags }
  settings  { width, height, fps, sampleRate, colorSpace, background }
  library   MediaAsset[]
  timeline  Timeline
  markers   Marker[]
  master    { volume, effects[], audioChain }

Timeline
  duration, tracks: Track[]

Track
  id, kind: video | audio | text | overlay | adjustment
  name, colorHex, height
  locked, hidden, muted, solo
  volume, pan
  effects: Effect[]
  clips: Clip[]

Clip
  id, label, groupId?
  source: { mediaId } | { generator: TextGen | SolidGen | ShapeGen | GradientGen | CountdownGen }
           | { compound: Timeline }
  start, duration                    Position auf der Timeline
  in, out                            Ausschnitt aus der Quelle
  speed     { rate, reverse, preservePitch, ramp: Keyframe[]? }
  transform { x, y, scaleX, scaleY, rotation, anchor, opacity, crop }
  blend     BlendMode
  masks     Mask[]
  volume, pan, fadeIn, fadeOut, fadeCurve
  effects   Effect[]
  transitionIn?, transitionOut?      Transition
  keyframes Map<paramPath, Keyframe[]>

Effect
  id, effectType, enabled, params: Map<string, Value>

Keyframe
  time, value, interp: linear | hold | bezier | ease, handleIn, handleOut

Transition
  type, duration, alignment: center | in | out, params

Mask
  type: rect | ellipse | polygon | bezier | luma, points, feather, inverted, keyframed
```

Besonderheiten:

* **Generator-Clips** (Text/Titel, Solid, Shape, Gradient, Countdown) brauchen keine
  Mediendatei — Text ist damit ein normaler Clip mit Keyframes und Effekten, kein Sonderfall.
* **Adjustment-Track** wirkt auf alles, was darunter liegt — Color-Grading ohne Clip-Duplikate.
* **Compound-Clip** enthält eine geschachtelte `Timeline`; ein Rekursionslimit verhindert
  Zyklen und Endlos-Rendering.
* **Rückwärts-Abspielen** (A9) ist `speed.reverse` am Clip, kein separater Clip-Typ. Wer nur
  einen Bereich rückwärts will, splittet und setzt das Flag auf dem Mittelstück.
* **Speed-Ramp** ist eine Keyframe-Kurve auf `speed.rate`; Audio folgt mit optionaler
  Pitch-Korrektur.

---

## 6. Command-Bus — Undo und API und MCP in einem

Jede Editor-Aktion ist ein serialisierbarer Command in `videola-core`. Die Anwendung eines
Commands liefert einen Patch und den zugehörigen Inverse-Patch:

```
dispatch(command) → { patch, inverse, events }
```

* **Undo/Redo** ist der Stack aus `(patch, inverse)`-Paaren. Kein handgeschriebenes Undo pro
  Command — das ist die Fehlerquelle, die man sich damit spart.
* **Coalescing:** Commands derselben ID innerhalb eines Zeitfensters (z. B. ein Drag) werden zu
  einem Undo-Schritt zusammengefasst.
* **Visuelle Historie** wie in Audiola: der Stack ist als Liste mit Labels darstellbar und
  anspringbar.

Command-Gruppen (nicht erschöpfend, wächst mit den Milestones):

```
project.*    create, open, save, saveAs, setSettings, setMeta
media.*      import, remove, relink, generateProxy, generateWaveform
track.*      add, remove, reorder, setProps, setVolume, setPan, mute, solo, lock
clip.*       add, move, trim, split, delete, duplicate, setSpeed, reverse,
             setTransform, setVolume, setFades, setBlend, group, ungroup,
             ripple, roll, slip, slide, nest, unnest
effect.*     add, remove, setParam, reorder, toggle
keyframe.*   add, remove, move, setValue, setInterp
transition.* set, remove, setDuration
mask.*       add, remove, setPoints, setFeather
text.*       setContent, setStyle, setAnimation
marker.*     add, remove, rename
audio.*      setEq, setCompressor, setMastering, setDucking, normalize
render.*     start, cancel, status
template.*   list, preview, instantiate
```

### 6.1 Ein Katalog, drei Konsumenten

Aus dem Rust-Command-Enum wird beim Build ein **Command-Katalog** generiert (JSON-Schema pro
Command). Der Katalog speist:

| Konsument | Form |
|---|---|
| **REST/WS-API** | `POST /api/commands` (Batch, atomar), `GET /api/project`, `GET /api/schema` (Katalog), `POST /api/render`, `GET /api/render/:id`, WS `/api/events` (State-Patches, Render-Progress) |
| **MCP-Server** | ein Tool pro Command, direkt aus dem Katalog erzeugt — plus die Werkzeuge aus 6.2 |
| **TS-SDK** | generierte, typisierte Client-Methoden für Fremdcode |

Damit gilt A10 automatisch und dauerhaft: ein neuer Command ist sofort per API und per MCP
verfügbar, ohne dass irgendwo eine Liste nachgepflegt werden muss. Vergessene MCP-Tools sind
strukturell ausgeschlossen.

### 6.2 Zusätzliche MCP-Werkzeuge (nicht aus dem Katalog)

| Tool | Zweck |
|---|---|
| `describe_project` | kompakte, textuelle Projektbeschreibung — was ist auf welcher Spur, wie lang, welche Effekte |
| `get_frame(t, width?)` | rendert einen Einzelframe als PNG |
| `get_audio_peaks(range)` | Peaks eines Zeitbereichs |
| `list_effects(category?)` | verfügbare Effekte samt Parameter-Schemata |
| `list_templates(tags?)` | Template-Katalog |
| `validate_project` | Konsistenzprüfung, fehlende Medien, Überlappungen |

`get_frame` ist der wichtigste davon: ein Agent kann sein Ergebnis **sehen** statt es zu
behaupten. Ohne dieses Werkzeug ist agentenbasiertes Videoschneiden Blindflug.

### 6.3 Self-Hosting-Sicherheit

Der Server ist standardmäßig auf `127.0.0.1` gebunden. Für Netzwerkbetrieb wird ein Token per
Umgebungsvariable (`VIDEOLA_TOKEN`) verlangt; ohne Token verweigert der Server das Binden an
`0.0.0.0` und schreibt eine erklärende Fehlermeldung. Datei-Pfade aus Requests werden gegen ein
konfiguriertes Storage-Root normalisiert und validiert (kein Pfad-Escape). Upload-Größen und
Render-Job-Anzahl sind konfiguriert begrenzt.

---

## 7. Rendering und Wiedergabe

### 7.1 Frame-Graph

Für einen Zeitpunkt *t*:

```
sichtbare Clips je Track (untere Spur zuerst)
   → Decode / Frame-Cache
   → Clip-Effektkette (WGSL-Pässe)
   → Masken
   → Transform
   → Blend auf Zwischenziel
   → Track-Effekte
   → Adjustment-Tracks
   → Master-Effekte
   → Ausgabe
```

Derselbe Graph läuft im Browser über `@videola/engine` (WebGPU/WebGL2) und in
`videola-compositor` über wgpu. Die Effekt-Shader sind bitgleich dieselben Dateien.

### 7.2 Preview

* WebGPU wenn verfügbar, sonst WebGL2. Der Fallback ist nicht optional: WKWebView auf
  macOS/iOS unterstützt WebGPU nicht zuverlässig.
* Decode über WebCodecs `VideoDecoder` plus Demuxer; Frames landen als GPU-Textur.
  LRU-Frame-Cache mit Speicherbudget.
* Codecs, die die Webview nicht kann, dekodiert `videola-render`; die Frames kommen über einen
  lokalen Loopback-Stream in die Engine.
* **Master-Clock ist `AudioContext.currentTime`.** Video-Frames werden dazu geschedult, nicht
  umgekehrt — Audio-Drift ist hörbar, ein ausgelassener Frame nicht.
* **Reverse-Wiedergabe:** Im Browser wird ein Frame-Fenster rückwärts gepuffert (Seek zum
  vorherigen Keyframe, Dekodieren vorwärts, Ausgabe rückwärts). Nativ wird für den Clip ein
  Reverse-Proxy-Segment vorgerendert. Beides ist derselbe Modellzustand, nur unterschiedliche
  Beschaffung.
* **Proxy-Modus:** Bei hochauflösendem Material schaltet die Preview auf Proxies um; der Export
  nutzt immer die Originale.

### 7.3 Audio-Graph

```
Clip → Source → Gain/Pan/Fade → Clip-Effekte (AudioWorklet + WASM-DSP)
     → Track-Bus (EQ, Kompressor, Ducking)
     → Master (Limiter, LUFS-Meter)
     → Destination
```

Die DSP-Bausteine sind der Rust-Port der Audiola-Algorithmen (`Biquad`, `Compressor`,
`LoudnessMeter`, `Fft`), kompiliert nach WASM für den AudioWorklet und nativ für den
Offline-Export. Ein Algorithmus, zwei Ausführungsorte, identisches Ergebnis.

### 7.4 Export-Backends

Ein Interface, mehrere Implementierungen, automatische Auswahl mit manueller Übersteuerung:

| Backend | Wann | Wie |
|---|---|---|
| `NativeFfmpeg` | Desktop | wgpu-Compositor + FFmpeg-Encode, Hardware-Encoder wenn vorhanden, Audio offline über Rust-DSP (schneller als Echtzeit) |
| `NativePlatform` | iOS, Android | wgpu-Compositor + Plattform-Encoder (VideoToolbox / MediaCodec) statt eines vollen FFmpeg-Builds — siehe Abschnitt 11. Gleiches Interface, andere Encoder-Anbindung |
| `ServerFfmpeg` | Browser mit erreichbarem Server, Headless/Agent-Betrieb | `POST /api/render`, Job-Queue, Progress über WS, Ergebnis als Download |
| `WebCodecs` | Browser ohne Server (A3) | `VideoEncoder` + `OfflineAudioContext` + mp4/webm-Muxer im Worker |

Export-Presets: Auflösung, fps, Codec (H.264/H.265/VP9/AV1), Bitrate/CRF, Audio-Codec,
Zielplattform-Presets (YouTube, Instagram Reel/Story, TikTok), Bereichs-Export,
Einzelbild-Export, GIF, nur-Audio.

---

## 8. UI

### 8.1 Layout-Erkennung (A2)

Erkannt wird über Viewport-Breite, `pointer: coarse` und maximale Touch-Punkte —
**nicht** über den User-Agent. Der erkannte Modus ist jederzeit manuell überschreibbar
(Tablet-Nutzer mit Maus wollen oft den Desktop-Modus).

| Modus | Ab | Layout |
|---|---|---|
| `desktop` | ≥1280 px | Media-Library │ Preview │ Inspector oben, Timeline unten, alles frei verschiebbar |
| `tablet` | ≥768 px | kollabierbare Seitenpanels, Timeline unten, Touch-Targets ≥44 px, Stift- und Touch-Scrub |
| `phone` | <768 px | Preview oben fixiert, Tab-Bar unten (Medien · Timeline · Effekte · Text · Audio · Export), Timeline mit Pinch-Zoom und playhead-zentriertem Scrub |

Die Modi teilen dieselben Komponenten und denselben State; sie unterscheiden sich in Anordnung
und Interaktion, nicht in Funktionsumfang. Was auf dem Desktop geht, geht auch am Telefon —
notfalls über mehr Schritte.

### 8.2 Theme und Sprache (A8)

* Design-Tokens als CSS-Variablen; Dark als Standard, Light vollständig gepflegt,
  `prefers-color-scheme` wird respektiert, die Wahl wird persistiert.
* i18n für Deutsch und Englisch, Umschaltung ohne Reload. **Alle** Strings liegen in
  Katalogen; kein Text im Code. Rust liefert Fehler als Codes plus Parameter, die UI übersetzt
  sie — damit sind auch Fehlermeldungen zweisprachig.
* Effekt-, Transition- und Template-Namen tragen ihre Labels in beiden Sprachen im Manifest.
* Zahlen, Zeiten und Timecode-Formate folgen der Locale.

### 8.3 Bedienung

* Tastaturkürzel nah an Premiere/Filmora, vollständig frei belegbar.
* Timeline mit Snapping (Playhead, Clipkanten, Marker, Raster), Magnetic-Mode, Ripple-Delete,
  Track-Höhen, Zoom bis Einzelframe.
* Barrierefreiheit als Grundlinie: sichtbare Fokusringe, ARIA-Rollen auf der Timeline,
  Tastaturnavigation für alle Aktionen, `prefers-reduced-motion` wird beachtet.
* Autosave in den lokalen Storage mit Wiederherstellung nach Abstürzen.

### 8.4 Offline (A3)

* PWA: Service Worker mit Precache der App-Shell, Effekt-Manifeste und mitgelieferten
  Templates; installierbar.
* OPFS (Origin Private File System) für Projekte, importierte Medien, Proxies und Caches;
  IndexedDB für Einstellungen und Recent-Liste.
* Nach dem ersten Laden ist der komplette Editor inklusive Export ohne Netz nutzbar. Was Netz
  braucht, ist im UI markiert und degradiert sauber statt zu blockieren.

---

## 9. Template-Modus (A7)

### 9.1 Format

`.videolat` = `.videola`-Container plus `template.json`:

```
template.json
  id, version
  name        { de, en }
  description { de, en }
  category, tags[], durationSeconds, aspectRatios[]
  slots: [
    { id, kind: image | video | text | color | audio | logo,
      label { de, en }, hint { de, en },
      required,
      constraints { aspect?, maxDurationSeconds?, maxChars?, minResolution? },
      placeholderMediaId,
      bindings: [ { clipId, path } ]     wohin der Wert im Projekt geschrieben wird
    }
  ]
  steps: [ { title { de, en }, slotIds[] } ]     Wizard-Gruppierung
```

Die `bindings` sind der Kern: ein Slot kann auf mehrere Stellen im Projekt zeigen (ein Logo, das
in vier Szenen auftaucht) und schreibt beim Instanziieren überall.

### 9.2 Galerie und Wizard

1. **Galerie** — Grid mit `preview.mp4`, Autoplay beim Hovern (Tap auf Touch), Filter nach
   Kategorie/Dauer/Seitenverhältnis, Suche. Mitgelieferte Templates sind offline verfügbar; ein
   Remote-Katalog (`GET /api/templates`) ist optional und additiv.
2. **Wizard** — ein Schritt pro Slot-Gruppe, mit Live-Mini-Preview, Validierung gegen
   `constraints` und Überspringen optionaler Slots.
3. **`template.instantiate`** — erzeugt ein **normales Projekt**. Der Editor danach ist der
   normale Editor, ohne Sonderpfad.
4. Die Slot-Bindings bleiben als Metadaten im Projekt erhalten. Damit lässt sich später weiter
   „Bild in Slot 3 tauschen" anbieten, ohne dass der Nutzer aus dem Editor heraus muss.

### 9.3 Autoren-Modus

Aus einem bestehenden Projekt Slots markieren und als `.videolat` exportieren. Kommt in M5; das
Format ist von Anfang an darauf ausgelegt, damit später keine Migration nötig ist.

---

## 10. Effekt- und Plugin-System

```
effects/brightness/
  effect.json     { id, name{de,en}, category, params: [
                    { key, type: float|int|bool|color|vec2|enum|curve,
                      default, min, max, step, ui: slider|dial|colorpicker } ],
                    shader: "shader.wgsl", passes: 1 }
  shader.wgsl
```

* Build-Step: WGSL→GLSL über `naga` für WebGL2; Manifest → TS-Typen, Rust-Registry und
  MCP-Parameter-Schemata.
* Kategorien: Color/LUT, Blur/Sharpen, Distort, Stylize, Keying (Chroma/Luma), Time,
  Generatoren, Transitions, Text-Animationen.
* **Übergänge sind Effekte mit zwei Eingängen** plus `progress` — kein zweites Subsystem.
* Externe Effekt-Ordner sind auf Desktop und im Self-Hosting nachladbar. Community-Effekte
  brauchen keinen Rebuild. Shader laufen in der GPU-Sandbox und haben keinen Datei- oder
  Netzzugriff.

---

## 11. Packaging (A4, A5)

| Ziel | Wie |
|---|---|
| Web | Vite-Build, PWA, statisch ausliefertbar (nginx, GitHub Pages) |
| Windows | Tauri 2 → MSI/NSIS, Auto-Update |
| macOS | Tauri 2 → DMG, signiert/notarisiert |
| Linux | Tauri 2 → AppImage, deb, rpm |
| iOS / Android | Tauri 2 Mobile; Export über Plattform-Encoder (VideoToolbox / MediaCodec) bzw. WebCodecs statt vollem FFmpeg-Build |
| Docker | Multi-Stage-Image mit FFmpeg: statische App + REST/WS-API + MCP (SSE) + Render-Worker; ENV für Port, Token, Storage-Root; Volume für Projekte |

CI: GitHub Actions Matrix über alle Ziele, Release mit Artefakten, Image-Push nach
`ghcr.io/fgilde/videola`.

### 11.1 FFmpeg-Build: GPL

Entschieden: **GPL-FFmpeg-Build mit x264/x265.** Funktionale Vollständigkeit hat Vorrang —
volle Codec-Abdeckung auch ohne Hardware-Encoder, kein Software-Fallback zweiter Klasse.

Konsequenz: Desktop-Installer und Docker-Image stehen damit unter GPL. Die Web-App ist
unberührt, weil dort WebCodecs encodiert. Die endgültige Projektlizenz wird gegen Projektende
festgelegt; die Architektur hält den Ausweg offen, weil FFmpeg nur in `videola-render` hinter
dem Render-Interface sitzt und gegen einen LGPL-Build getauscht werden kann, ohne dass anderer
Code sich ändert.

---

## 12. Testing

Die Teststrategie folgt dem Hauptrisiko: Divergenz zwischen den Ausführungsorten.

| Ebene | Inhalt |
|---|---|
| **Golden-Frame-Diff** *(wichtigster Test)* | Referenzprojekte, Frame bei definierten Zeitpunkten, gerendert im Browser (WebGPU **und** WebGL2) und in Rust (wgpu). Pixel-Diff unter Toleranz. Läuft in CI und schlägt an, sobald die Compositor-Hosts auseinanderlaufen. |
| Rust-Unit | Modell-Invarianten, jeder Command samt Inverse (Property-Test: `dispatch` dann `undo` ergibt den Ausgangszustand), `.videola`-Roundtrip, Schema-Migrationen, DSP gegen Referenz-WAVs |
| TS-Unit (vitest) | WASM-Bindings, Engine-Mathematik (Keyframe-Interpolation, Zeit↔Frame), Template-Slot-Resolver, Layout-Modus-Erkennung |
| Audio-Golden | Offline-Mix eines Referenzprojekts gegen Referenz-WAV, plus LUFS-Zielwert-Prüfung |
| E2E (Playwright) | Editor-Flows, Template-Wizard, Export, je in Desktop- und Mobile-Viewport |
| Format-Kompatibilität | Alte `.videola`-Testdateien öffnen weiterhin; unbekannte Felder überleben einen Speicher-Roundtrip |

---

## 13. Code-Konventionen

Verbindlich für alles, was in diesem Repo entsteht.

**Clean Code Developer als Grundlage.** SRP, SoC, DRY, KISS, YAGNI, Information Hiding, PoLA.
Dazu IOSP: eine Funktion *orchestriert* (ruft andere Funktionen) oder sie *arbeitet* (enthält
Logik) — nicht beides. Das hält Logik testbar und Orchestrierung lesbar.

**Kommentare sind die Ausnahme.** Kommentiert wird das *Warum*, wenn es nicht aus dem Code
hervorgeht: eine nicht offensichtliche Reihenfolge, ein Workaround für ein Fremdverhalten, eine
bewusste Abweichung von der naheliegenden Lösung. Nie das *Was*. Kein Abschnitts-Banner, keine
`Schritt 1:` / `Schritt 2:`-Blöcke, keine Doc-Kommentare für triviale Zugriffsmethoden. Namen
tragen die Erklärung, nicht Prosa daneben.

**Struktur.** Kleine Funktionen mit einer Aufgabe. Eine Datei hat einen Zweck; über ~400 Zeilen
ist ein Signal zum Teilen. Öffentliche Oberfläche eines Moduls klein halten, alles andere privat.

**Fehlerbehandlung.** Kein defensives Fangen ohne Behandlung. In Rust `Result` mit sprechenden
Fehlertypen (`thiserror`), keine `unwrap()` außerhalb von Tests. An Vertrauensgrenzen
(API-Requests, Dateiimport, Projektdateien) wird vollständig validiert.

**Sprache.** Bezeichner, Typnamen und Code-Kommentare auf Englisch; alle nutzersichtbaren Texte
ausschließlich über die i18n-Kataloge. Commit-Messages auf Deutsch mit englischem
Conventional-Commits-Präfix (`feat:`, `fix:`, `docs:` …) und ohne Attribution-Zeilen.

---

## 14. Roadmap

### M0 — Skelett
Monorepo (pnpm + Cargo), `videola-core` mit Modell, Commands, Undo und `.videola`-I/O,
WASM-Bindings mit generierten TS-Typen, App-Shell mit Theme und i18n, CI-Grundgerüst.

### M1 — Vertikaler Durchstich (Definition of Done)

```
✓ .videola speichern und laden, verlustfrei (Roundtrip-Test grün)
✓ 2 Video- + 2 Audio-Spuren, Import per Drag & Drop
✓ Trim, Split, Move, Ripple-Delete
✓ 1 Transition (Crossfade) + 1 Effekt (Brightness), beide keyframebar
✓ Preview-Playback 1080p mit ≥24 fps, Audio synchron
✓ Export H.264/AAC über mindestens zwei der drei Backends
✓ MCP-Tools: open, import, split, set_param, render, get_frame
✓ Builds grün: Web, Windows, Docker
✓ Golden-Frame-Test läuft und vergleicht Browser gegen Rust
```

Ab hier ist das Skelett tragend und alles Weitere additiv.

### M2 — Editor-Breite
Ripple/Roll/Slip/Slide, Marker, Gruppen, Compound-Clips/Nesting, Magnetic-Timeline,
Multi-Selektion, erweitertes Snapping, Clipboard, Autosave-Recovery.

### M3 — Effekte, Übergänge, Text
Effekt-Bibliothek nach Kategorien, Übergangs-Bibliothek, Masken, Chroma-Keying, LUT-Import,
Text-Engine mit Rich-Styling und Ein-/Aus-/Loop-Animationen, Bewegungspfade, Motion-Blur.

### M4 — Audio-Vollausbau
Mixer-Ansicht, EQ, Kompressor, Mastering-Kette mit LUFS/EBU R128, Ducking/Auto-Volume,
Rauschreduktion, Waveform-Editing im Detail, Spatial-Panning, Beat-Erkennung für Schnitt auf
Takt.

### M5 — Templates
Template-Format, Galerie, Wizard, Bake-to-Project, Autoren-Modus, mitgelieferter
Template-Satz.

### M6 — Mobile-Ausbau
Phone- und Tablet-Modus vollständig, Gesten, Performance-Budgets, Kamera- und
Galerie-Import.

### M7 — Packaging
macOS, Linux, iOS, Android, Auto-Update, Signierung/Notarisierung, Docker-Härtung.

### M8 — API- und MCP-Vollausbau
Vollständiger Command-Katalog exponiert, Agent-Dokumentation mit Beispiel-Flows,
Plugin-SDK, Batch- und CLI-Betrieb.

Die AI-Audio-Features (Stem-Separation, Whisper-Untertitel, TTS-Voiceover) hängen hinter dem
`AiProvider`-Interface und kommen nach M8 — oder früher, wenn ein Bedarf sie vorzieht.

---

## 15. Erwartungsmanagement

Die Architektur ist darauf ausgelegt, Breite billig zu machen: ein Effekt sind zwei Dateien,
ein Command ist eine Enum-Variante plus Handler, und beides ist automatisch per API und MCP
verfügbar. Filmora-Parität bleibt trotzdem Arbeit über mehrere Monate. Das Design sorgt dafür,
dass diese Arbeit additiv ist statt umbauintensiv — mehr kann Architektur nicht leisten.

---

## 16. Nicht im Umfang

* Cloud-Konten, Abrechnung, geteilte Projekte, Mehrbenutzer-Kollaboration
* Eingebauter Stock-Media-Marktplatz
* Video-Upload direkt zu Social-Plattformen (Export-Presets ja, Upload nein)
* Server-gestützte AI-Dienste ohne explizite Nutzer-Zustimmung
