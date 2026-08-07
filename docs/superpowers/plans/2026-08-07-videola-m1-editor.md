# Videola M1 — Editor: Implementierungsplan

**Goal:** Aus dem Skelett wird ein Schnittprogramm: Medien importieren, auf mehreren Spuren anordnen, trimmen, teilen und verschieben, das Ergebnis mit synchronem Ton abspielen, einen Effekt und einen Übergang keyframen, und nach MP4 exportieren — mit Maus und mit Finger.

**Architecture:** Ein neues Paket `@videola/engine` hält alles, was Frames und Töne bewegt: Dekodierung über WebCodecs, ein WebGL2-Compositor, ein Audiograph und eine Uhr. Die Timeline in `@videola/ui` liest den Projektzustand aus dem bestehenden Rust-Kern und schickt ausschließlich Commands zurück — sie hält keinen eigenen Zustand über Selektion und Zoom hinaus. Der Export läuft in einem Worker über dieselbe Compositor-Klasse wie die Vorschau, damit Vorschau und Ergebnis nicht auseinanderlaufen können.

**Tech Stack:** WebCodecs (`VideoDecoder`, `VideoEncoder`, `AudioEncoder`), `mediabunny` für Demux und Mux, WebGL2, WebAudio mit `AudioWorklet`, OPFS für Medien, Pointer Events für Maus und Touch in einem Pfad

**Spec:** [`docs/superpowers/specs/2026-08-07-videola-design.md`](../specs/2026-08-07-videola-design.md), Abschnitte 5, 7 und 8

## Global Constraints

- Code-Konventionen nach Spec Abschnitt 13: CCD (SRP, SoC, DRY, KISS, YAGNI, Information Hiding, PoLA), IOSP — eine Funktion orchestriert **oder** arbeitet, nie beides.
- Kommentare nur für das *Warum*, niemals für das *Was*. Keine Abschnitts-Banner, keine `Schritt 1:`-Blöcke, keine Doc-Kommentare für triviale Zugriffsmethoden. Kein Text, der nach AI-Generierung liest. `ponytail:`-Marker sind verfolgte Entscheidungen und bleiben.
- Bezeichner, Typnamen und Code-Kommentare auf Englisch. **Jeder nutzersichtbare Text liegt in den i18n-Katalogen**, und ein neuer Schlüssel muss in `de.json` **und** `en.json` — ein Test vergleicht Schlüsselmengen, Platzhaltermengen und Pluralformen.
- Zeit ist ganzzahlig in Flicks (705.600.000 pro Sekunde). Sekunden als `f64` existieren nur als Anzeigeformat und nie als gespeicherter Wert.
- Der Rust-Kern ist die einzige Wahrheit über den Projektzustand. Die UI leitet nichts ab, was sie auch erfragen kann, und schreibt ausschließlich über Commands.
- Kein `unwrap()` / `expect()` in Produktiv-Rust. Jede Map ist `BTreeMap`.
- Werkzeuge: Rust stable, Node 22 oder neuer, pnpm 11 oder neuer. `pnpm wasm` muss einmal laufen, bevor irgendetwas `packages/core` typechecked oder baut.
- Commit-Messages auf Deutsch mit transliterierten Umlauten (`ue`, `ae`, `oe`, `ss`) und englischem Conventional-Commits-Präfix. **Niemals** Co-Authored-By-, "Generated with"- oder sonstige Attribution-Zeilen.
- Action-Majors vor dem Übernehmen gegen `gh api repos/<owner>/<repo>/releases/latest` prüfen. `actionlint` validiert Ausdrücke und den `needs`-Graphen, aber seine Action-Datenbank ist älter als die verwendeten Majors und akzeptiert erfundene Eingabenamen.

## Drei Abweichungen von der Spec, mit Begründung

**WebGL2 zuerst, WebGPU später.** Die Spec nennt WebGPU als Hauptpfad und WebGL2 als Fallback. Für M1 ist das umgekehrt richtig: die Tauri-Shell nutzt auf macOS und iOS WKWebView, dessen WebGPU-Unterstützung nicht verlässlich ist. WebGL2 läuft in jedem Ziel dieses Projekts. Zwei Compositor-Pfade zu bauen, bevor einer nachweislich funktioniert, wäre die Duplikation, die die Spec selbst vermeiden will. Der Compositor bekommt eine Schnittstelle, hinter die WebGPU später tritt — und der erste Effekt-Shader wird in GLSL geschrieben, nicht in WGSL.

**Medien liegen in OPFS, nicht im Speicher.** M0 hält alle Mediendaten im WASM-Speicher; ein `ponytail:`-Marker in `format/reader.rs` nennt das als Schuld. Bei echtem Videomaterial ist das nicht tragbar — eine halbe Stunde 1080p sprengt jeden 32-Bit-Adressraum. M1 schreibt importierte Dateien inhaltsadressiert in OPFS, und der Kern kennt nur noch Metadaten. Das ist die Voraussetzung dafür, dass Import überhaupt funktioniert, also gehört es hierher und nicht in einen späteren Meilenstein.

**Kein Golden-Frame-Test.** Die Spec nennt ihn als wichtigsten Test von M1: dasselbe Bild im Browser und in Rust gerendert, pixelweise verglichen. Er braucht einen Rust-`wgpu`-Compositor, und den gibt es nicht — `videola-compositor` existiert nicht, und die Tauri-Shell linkt den Kern nicht einmal nativ. Der Test kommt, wenn der zweite Compositor kommt. Bis dahin sichern Frame-Hash-Tests gegen sich selbst ab: derselbe Zeitpunkt zweimal gerendert muss identisch sein, und ein bekanntes Testmuster muss einen festgehaltenen Hash ergeben.

## Was M1 nicht enthält

**Keine MCP- oder REST-Schnittstelle.** Sie braucht `videola-server`, den es nicht gibt. Der Command-Katalog ist die Vorarbeit und existiert; die Schnittstelle ist M8.

**Kein natives Rendern.** Die Tauri-Shell hostet die Web-App und linkt den Kern nicht. Export läuft in M1 ausschließlich über WebCodecs im Browser beziehungsweise im Webview. Das ist ehrlich genug für einen Editor, der 1080p kann, und es hält FFmpeg weiter draußen.

**Nur ein Effekt und ein Übergang.** Helligkeit und Crossfade. Sie beweisen die Kette Effekt-Registry, Shader, Keyframe-Auswertung, Compositor. Die Bibliothek ist M3.

**Keine Kurven-Bearbeitung.** Keyframes lassen sich setzen, löschen, verschieben und zwischen linear, halten und ease umschalten. Ein Bezier-Editor mit Anfassern ist M3.

## Codec-Wirklichkeit, die den Plan begrenzt

`VideoEncoder` mit `avc1` ist in Chromium vollständig, in Firefox und Safari teilweise vorhanden. Der Export prüft `VideoEncoder.isConfigSupported` und meldet in der Oberfläche, was das laufende Gerät kann, statt anzunehmen. Fällt H.264 aus, ist VP9 in WebM der Rückfall. Das ist kein Mangel der Umsetzung, sondern der Zustand der Browser — und die Oberfläche muss es sagen, nicht verschweigen.

`AudioEncoder` mit `mp4a.40.2` ist ähnlich verteilt. Derselbe Prüfweg.

## Dateistruktur nach M1

```
packages/
├─ engine/                          @videola/engine — neu
│  ├─ src/clock.ts                  Master-Uhr auf AudioContext.currentTime
│  ├─ src/decode/demuxer.ts         mediabunny-Wrapper, Track-Metadaten
│  ├─ src/decode/video-source.ts    VideoDecoder pro Medium, Frame-Fenster
│  ├─ src/decode/audio-source.ts    AudioDecoder, dekodierte Puffer
│  ├─ src/decode/frame-cache.ts     LRU mit Speicherbudget
│  ├─ src/gl/context.ts             WebGL2-Kontext, Fähigkeiten, Verlust-Behandlung
│  ├─ src/gl/program.ts             Shader-Kompilierung, Uniform-Bindung
│  ├─ src/gl/compositor.ts          Frame-Graph: Clips, Transform, Blend, Effekte
│  ├─ src/effects/registry.ts       Effekt-Manifeste plus GLSL
│  ├─ src/effects/brightness.ts     der erste Effekt
│  ├─ src/effects/crossfade.ts      der erste Übergang, zwei Eingänge plus progress
│  ├─ src/audio/graph.ts            WebAudio-Graph, Clip-Gain, Fades, Master
│  ├─ src/playback.ts              Orchestriert Uhr, Decode, Compositor, Audio
│  ├─ src/export/worker.ts          Export im Worker, dieselbe Compositor-Klasse
│  └─ src/export/muxer.ts           mediabunny-Mux, Codec-Prüfung
├─ media/                           @videola/media — neu
│  ├─ src/opfs.ts                   inhaltsadressierte Ablage, Quota-Behandlung
│  ├─ src/import.ts                 Datei zu MediaAsset plus OPFS-Eintrag
│  ├─ src/thumbnails.ts             Timeline-Vorschaubilder
│  └─ src/waveform.ts               Peak-Berechnung, Cache
└─ ui/                              erweitert
   ├─ src/timeline/Timeline.tsx     Spuren, Clips, Playhead, Zoom
   ├─ src/timeline/Track.tsx
   ├─ src/timeline/Clip.tsx
   ├─ src/timeline/Playhead.tsx
   ├─ src/timeline/Ruler.tsx        Zeitskala mit Timecode
   ├─ src/timeline/useTimelineGestures.ts   Pointer Events: Drag, Trim, Pinch, Scrub
   ├─ src/timeline/snapping.ts      Playhead, Clipkanten, Marker, Raster
   ├─ src/preview/Preview.tsx       Canvas plus Transport
   ├─ src/preview/Transport.tsx     Play, Pause, Frame vor und zurück, Zeitanzeige
   ├─ src/inspector/Inspector.tsx   Clip-Eigenschaften, Effektliste
   ├─ src/inspector/ParamRow.tsx    ein Parameter plus Keyframe-Schalter
   ├─ src/library/MediaLibrary.tsx  Import, Liste, Drag zur Timeline
   └─ src/export/ExportDialog.tsx   Presets, Fortschritt, Codec-Meldung
```

Grundsatz: eine Datei hat eine Aufgabe. Über ~400 Zeilen ist ein Signal zum Teilen.

## Zur Form dieses Plans

Die Code-Blöcke unten stehen für die Stellen, an denen ein Fehler Tage kostet: die Uhr, die Dekodier-Kette, der Compositor-Kern, der Export-Worker und die Zeigergesten. Dort ist der Code vollständig und wörtlich zu übernehmen.

Für die Oberflächenkomponenten nennt der Plan die Schnittstelle, das Verhalten und die zu schreibenden Tests, nicht jede Zeile JSX. Das ist Absicht: bei M0 haben meine wörtlichen Transkriptionen sieben Fehler enthalten, die erst ein Review gefunden hat, und JSX aus einem Plan abzuschreiben trägt weniger als eine klare Schnittstelle mit Tests, gegen die man baut. Wo ein Test im Plan steht, ist er wörtlich zu übernehmen — er ist der Vertrag.

---

## Ausführungsgruppen

| Gruppe | Tasks | Grund |
|---|---|---|
| A | 1, 2 | OPFS und Import — alles andere braucht Medien |
| B | 3, 4, 5 | Dekodierung: Demuxer, Video-Quelle, Frame-Cache |
| C | 6, 7 | WebGL2-Kontext und Compositor |
| D | 8, 9 | Audiograph und Master-Uhr |
| E | 10 | Playback, das die Gruppen B bis D verbindet |
| F | 11, 12, 13 | Timeline: Darstellung, Gesten, Snapping |
| G | 14, 15 | Vorschau-Komponente und Transport |
| H | 16, 17 | Effekt-Registry, Helligkeit und Crossfade |
| I | 18, 19 | Inspector und Keyframe-Bedienung |
| J | 20, 21 | Export-Worker und Dialog |
| K | 22, 23 | Medienbibliothek und Phone-Layout über alles |
| L | 24 | CI-Erweiterung und Definition of Done |

---

### Task 1: OPFS-Ablage

**Files:** `packages/media/package.json`, `packages/media/src/opfs.ts`, `packages/media/src/opfs.test.ts`

**Interfaces:**
- Produces: `putMedia(hash: string, bytes: Uint8Array): Promise<void>`, `getMedia(hash: string): Promise<Uint8Array | undefined>`, **`mediaBlob(hash: string): Promise<File | undefined>`**, `hasMedia(hash: string): Promise<boolean>`, `deleteMedia(hash: string)`, `mediaSize(hash: string): Promise<number | undefined>`, `storageEstimate(): Promise<{usage: number, quota: number}>`

`mediaBlob` ist der Weg, den alle späteren Tasks nehmen: ein `File` ist ein Griff auf die Datei, kein Abzug im Speicher. `getMedia` existiert für kleine Dateien und Tests — wer es auf Videomaterial anwendet, hat die OPFS-Abweichung wieder aufgehoben.

**Folge, die dieser Plan zunächst übersehen hat:** M0 hielt in `packages/core/src/commands.test.ts` fest, dass `media.import` von JS aus unerreichbar sei, weil die WASM-Schicht die Bytes selbst hasht. Mit OPFS stimmt das nicht mehr — der Import läuft jetzt über `cmd.mediaImport`, und `mediaKind` muss aus `@videola/core` exportiert sein. Die Ausnahme in jenem Test entfällt.

Die Ablage ist inhaltsadressiert und benutzt denselben Hash, den `MediaId` im Kern trägt — `med_` gefolgt von 64 Hex-Zeichen, wobei hier nur der Hex-Teil als Dateiname dient. Damit ist ein Medium in OPFS und im Projekt dieselbe Sache, und ein zweimal importiertes Video liegt einmal auf der Platte.

Wichtig und leicht zu übersehen: OPFS ist pro Origin, nicht pro Projekt. Zwei Projekte, die dasselbe Video benutzen, teilen den Eintrag — das ist gewollt, aber es heißt, dass Löschen beim Entfernen aus einem Projekt **nicht** erlaubt ist, solange ein anderes es referenzieren könnte. M1 löscht deshalb nie automatisch; `deleteMedia` existiert für einen späteren Aufräumbefehl und wird von keinem Command aufgerufen. Schreib das als *Warum*-Kommentar hin.

Tests: schreiben und wieder lesen ergibt identische Bytes; zweimal dasselbe schreiben ist idempotent; `hasMedia` auf einen unbekannten Hash ist `false`; ein Quota-Fehler kommt als abgewiesenes Promise mit erkennbarem Grund heraus, nicht als stiller Verlust. Für den Quota-Fall reicht ein Mock, der `QuotaExceededError` wirft — vitest läuft in jsdom ohne echtes OPFS, also braucht dieses Paket eine kleine Fake-Implementierung der `navigator.storage.getDirectory`-Kette, und die gehört in die Testdatei, nicht in die Produktion.

### Task 2: Import

**Files:** `packages/media/src/import.ts`, `packages/media/src/thumbnails.ts`, `packages/media/src/waveform.ts`, plus Tests

**Interfaces:**
- Consumes: Task 1, `@videola/core`'s `VideolaDocument` und `cmd`
- Produces: `importFile(file: File, doc: VideolaDocument): Promise<MediaId>`, `thumbnailStrip(hash: string, count: number): Promise<ImageBitmap[]>`, `waveformPeaks(hash: string, buckets: number): Promise<Float32Array>`

`importFile` liest die Datei, berechnet den SHA-256 über `crypto.subtle.digest`, legt die Bytes in OPFS ab, ermittelt die technischen Daten über den Demuxer aus Task 3, und schickt `media.import` mit einem vollständigen `MediaAsset` an den Kern. Der Kern validiert Form der Id, Dauer und Framerate — die Werte müssen also stimmen, und ein `fps` von `30/0` aus einer kaputten Datei muss vor dem Dispatch abgefangen werden, nicht danach.

Die Reihenfolge ist bindend: erst OPFS, dann Dispatch. Andernfalls kennt der Kern ein Medium, dessen Bytes fehlen, und beim Speichern scheitert der Writer.

`crypto.subtle.digest` über eine 2-GB-Datei auf einmal ist nicht tragbar. Lies in Blöcken und hashe inkrementell — die WebCrypto-API kann das nicht, also nimm einen kleinen SHA-256 in TypeScript oder hashe über `crypto.subtle` in Blöcken zu einem Merkle-Wurzelwert. **Entscheide bewusst und dokumentiere es:** wenn du einen anderen Hash als reines SHA-256 über den Gesamtinhalt wählst, stimmt die Id nicht mehr mit dem überein, was `MediaId::from_bytes` in Rust berechnet, und der Roundtrip bricht. Der einfachste tragfähige Weg ist ein inkrementelles SHA-256 in TypeScript über Blöcke, das exakt dasselbe Ergebnis liefert.

Tests: eine kleine Datei ergibt dieselbe Id wie `MediaId::from_bytes` in Rust über dieselben Bytes — dieser Test ist der wichtigste des Tasks und muss die Rust-Seite tatsächlich befragen, nicht einen erwarteten Wert festhalten; Import derselben Datei zweimal ergibt eine Bibliothek mit einem Eintrag; eine Datei ohne Videospur wird abgewiesen, bevor ein Command fliegt.

### Task 2b: Speichern mit Medien aus OPFS

**Nachträglich ergänzt.** Die OPFS-Abweichung hat die Medien aus dem WASM-Speicher geholt, aber der `.videola`-Writer holt sie weiter von dort: `inner.rs::save` reicht `&self.media` an `writer::write`, und `format/writer.rs` ruft für jeden Bibliothekseintrag `media.read(&asset.id)?`. Nach einem Import über OPFS ist dieser Speicher leer, und `save` wirft `media not available`. Ein Meilenstein, der importieren aber nicht speichern kann, ist kaputt — und kein anderer Task deckte das ab.

**Files:** `crates/videola-core-wasm/src/inner.rs`, `crates/videola-core-wasm/src/lib.rs`, `packages/core/src/document.ts`, `packages/core/src/backend.ts`, `packages/media/src/index.ts`, plus Tests

**Interfaces:**
- Produces: `WasmDocument.save` nimmt zusätzlich eine Abbildung von Medien-Id auf Bytes; `VideolaDocument.save(options, media: Map<string, Uint8Array>)`; eine Hilfsfunktion in `@videola/media`, die für ein Projekt die benötigten Einträge aus OPFS sammelt

Der einfache Weg, der für M1 trägt: JS sammelt vor dem Speichern die Bytes der Bibliothekseinträge aus OPFS und übergibt sie. Der Kern bleibt unverändert, der Writer bekommt einen gefüllten Store.

**Das hebt die OPFS-Ersparnis beim Speichern wieder auf** — für die Dauer des Schreibens liegt das gesamte Projektmaterial im Speicher. Setz dafür einen `ponytail:`-Marker, der das benennt und den Ausweg nennt: ein streamender Writer, der Medieneinträge einzeln aus einem `Blob` in das ZIP schiebt, statt sie als `Vec<u8>` entgegenzunehmen. Und setz eine Obergrenze, die laut scheitert statt den Speicher zu sprengen — `MAX_TOTAL_MEDIA_BYTES` aus dem Reader ist die passende Zahl.

Tests: importieren, speichern, wieder öffnen, und der Clip zeigt weiter auf dasselbe Medium — der Roundtrip über OPFS, der heute bricht. Ein Projekt, dessen Medien die Obergrenze überschreiten, scheitert mit einem erkennbaren Fehler statt mit einem Absturz.

### Task 3: Demuxer

**Files:** `packages/engine/package.json`, `packages/engine/src/decode/demuxer.ts`, Tests

**Interfaces:**
- Produces: `probe(source: Blob): Promise<MediaInfo>` mit `MediaInfo { duration: Time, video?: VideoTrackInfo, audio?: AudioTrackInfo }`, `VideoTrackInfo { codec: string, width: number, height: number, fps: Rate, description?: Uint8Array }`, `AudioTrackInfo { codec: string, sampleRate: number, channels: number }`, und `readChunks(source: Blob, trackId, from: Time, to: Time): AsyncIterable<EncodedVideoChunk | EncodedAudioChunk>`

**Korrektur nach Gruppe A:** Diese Signaturen hießen ursprünglich `probe(bytes: Uint8Array)`. Das war falsch und hätte die ganze Datei in den Speicher zurückgeholt — also genau das, wogegen die OPFS-Abweichung dieses Plans existiert. `Blob` ist auch das, was mediabunny über `BlobSource` ohnehin erwartet. Task 1 liefert dafür `mediaBlob(hash): Promise<File | undefined>` neben `getMedia`; benutze das und nicht `getMedia`.

`mediabunny` ist die eine Abhängigkeit für Demux und später Mux. Prüfe die aktuelle API gegen ihre Dokumentation, bevor du schreibst — sie ist jung und der Plan darf hier nicht raten.

Die `fps` kommt als Rational heraus, nicht als Float. Eine NTSC-Datei ist 30000/1001 und muss so durchgereicht werden, weil der Kern eine `Rate` erwartet und `formatTimecode` sie braucht. Wer hier auf 29,97 rundet, verliert die Bildgenauigkeit im ganzen Programm.

`description` ist der Codec-Konfigurationsblock — `avcC` bei H.264. `VideoDecoder.configure` braucht ihn, sonst dekodiert nichts. Das ist der häufigste Grund, warum eine WebCodecs-Kette schwarz bleibt.

Tests: eine eingebettete kleine MP4-Datei ergibt die erwarteten Maße, Dauer und eine Rational-Framerate; eine Datei ohne Audiospur ergibt `audio: undefined` statt zu werfen; abgeschnittene Bytes ergeben einen erkennbaren Fehler.

### Task 4: Video-Quelle

**Files:** `packages/engine/src/decode/video-source.ts`, Tests

**Interfaces:**
- Consumes: Tasks 1 und 3
- Produces: eine Klasse `VideoSource` mit `open(hash: string): Promise<void>`, `frameAt(t: Time): Promise<VideoFrame | undefined>`, `seek(t: Time): Promise<void>`, `close()`

Hier steckt die Arbeit von M1. Drei Dinge machen es schwer, und alle drei müssen im Code stehen:

**Rückwärts abspielen** geht nicht mit Rückwärts-Dekodieren. Ein Clip mit `speed.reverse` wird vorwärts vom vorangehenden Keyframe dekodiert und die Frames werden gepuffert, dann rückwärts ausgegeben. Das Fenster ist begrenzt; `Clip::source_time_at` gibt bereits den richtigen Quellzeitpunkt für jede Timeline-Position, auch rückwärts und mit Geschwindigkeit — benutze es und rechne nicht selbst.

**`VideoFrame` muss geschlossen werden.** Es hält GPU- oder Systemspeicher, und der Garbage Collector räumt es nicht auf. Ein vergessenes `close()` bringt die Wiedergabe nach wenigen Sekunden zum Stehen. Jeder Pfad, der einen Frame verwirft, schließt ihn — und der Frame-Cache aus Task 5 ist der einzige Ort, der Frames besitzt.

**Suchen heißt beim Keyframe anfangen.** `VideoDecoder` kann nicht an eine beliebige Stelle springen. `seek` sucht den vorangehenden Keyframe, konfiguriert neu falls nötig, und dekodiert bis zum Ziel. Beim Scrubbing über die Timeline passiert das oft, also muss die letzte Konfiguration wiederverwendet werden, wenn das Ziel nach der aktuellen Position liegt.

Tests gegen eine eingebettete Testdatei: `frameAt` an einem bekannten Zeitpunkt liefert einen Frame mit den erwarteten Maßen; zweimal derselbe Zeitpunkt liefert dasselbe Bild (Hash vergleichen); ein Zeitpunkt hinter dem Ende liefert `undefined` statt zu werfen; nach `close()` sind alle Frames geschlossen — prüfbar, indem der Test die Zahl der erzeugten gegen die Zahl der geschlossenen Frames zählt, wofür `VideoSource` einen Zähler nur für Tests exponieren darf.

### Task 5: Frame-Cache

**Files:** `packages/engine/src/decode/frame-cache.ts`, Tests

**Interfaces:**
- Produces: `FrameCache` mit `get(key: string): VideoFrame | undefined`, `put(key: string, frame: VideoFrame): void`, `clear()`, `bytesHeld(): number`

LRU mit Speicherbudget, nicht mit Elementzahl: ein 4K-Frame ist sechzehnmal so groß wie ein 540p-Frame, und ein Cache über Elemente gerechnet sprengt bei hoher Auflösung den Speicher. Schätze die Größe aus `frame.codedWidth * frame.codedHeight * 4`.

Der Cache **besitzt** die Frames und schließt jeden, den er verdrängt. Das ist der einzige Ort im Programm mit dieser Verantwortung — schreib das als *Warum* hin, sonst schließt später jemand einen Frame doppelt.

Tests: Verdrängung schließt den verdrängten Frame; `bytesHeld` bleibt unter dem Budget; ein erneutes `put` auf denselben Schlüssel schließt den alten Frame; `clear` schließt alle.

### Task 6: WebGL2-Kontext

**Files:** `packages/engine/src/gl/context.ts`, `packages/engine/src/gl/program.ts`, Tests

**Interfaces:**
- Produces: `createContext(canvas: HTMLCanvasElement | OffscreenCanvas): GlContext`, `GlContext { gl, maxTextureSize, onLost(cb), dispose() }`, `compileProgram(gl, vertexSrc, fragmentSrc): WebGLProgram`, `setUniforms(gl, program, values: Record<string, number | number[]>)`

`OffscreenCanvas` muss funktionieren, weil der Export-Worker denselben Compositor benutzt. Der Kontext wird mit `premultipliedAlpha: false` und `preserveDrawingBuffer: false` angelegt, und `alpha: true`, weil Clips mit Deckkraft übereinander liegen.

Kontextverlust ist kein Randfall: Windows verliert den Kontext beim Treiberwechsel und Mobilgeräte beim Wegschalten der App. `onLost` muss existieren und die Wiedergabe muss danach neu aufbauen können, statt schwarz zu bleiben.

Tests laufen in jsdom ohne echtes WebGL — also testet dieser Task die reinen Teile: Shader-Kompilierfehler kommen mit der Fehlermeldung des Treibers heraus statt als `null`; `setUniforms` bildet die Typen richtig ab. Der Rest ist im Browser-Test in Task 24 abgedeckt, und dieser Task sagt das offen, statt Abdeckung zu behaupten.

### Task 7: Compositor

**Files:** `packages/engine/src/gl/compositor.ts`, Tests

**Interfaces:**
- Consumes: Tasks 5 und 6, `Project` aus `@videola/core`
- Produces: `Compositor` mit `render(project: Project, t: Time, frames: Map<ClipId, VideoFrame>): void`, `resize(w, h)`, `readPixels(): Uint8Array`, `dispose()`

Der Frame-Graph für einen Zeitpunkt, in dieser Reihenfolge, weil sie das Ergebnis bestimmt:

```
sichtbare Clips je Spur, untere Spur zuerst
   → Quelltextur
   → Clip-Effektkette, jeder Effekt ein Pass in ein Zwischenziel
   → Masken (M3, hier nur die Naht)
   → Transform: Position, Skalierung, Rotation, Anker, Crop
   → Deckkraft und Blend auf das Zwischenziel der Spur
   → Spur-Effekte
   → Adjustment-Spuren auf alles darunter
   → Master-Effekte
   → Ausgabe
```

Der Compositor entscheidet **nicht**, welche Frames er braucht — er bekommt sie fertig übergeben. Das trennt Dekodierung von Darstellung und macht ihn im Export identisch verwendbar, wo die Frames aus einem anderen Takt kommen. Das ist die wichtigste Grenze in diesem Paket.

Keyframe-Werte kommen aus `Effect::param_at(key, t)` im Kern über die WASM-Grenze, nicht aus einer TypeScript-Auswertung. Sonst gibt es zwei Interpolationen, die auseinanderlaufen — genau der Fehler, den die Spec mit dem Rust-Kern vermeiden will.

Tests: derselbe Zeitpunkt zweimal gerendert ergibt identische Pixel; ein bekanntes Testmuster ergibt einen festgehaltenen Hash; ein Clip mit Deckkraft 0 verändert das Ergebnis nicht; zwei Spuren übereinander ergeben die obere, wenn deren Deckkraft 1 ist. Diese Tests brauchen echtes WebGL, laufen also im Browser-Test aus Task 24.

### Task 8: Audiograph

**Files:** `packages/engine/src/audio/graph.ts`, `packages/engine/src/decode/audio-source.ts`, Tests

**Interfaces:**
- Produces: `AudioGraph` mit `prepare(project: Project): Promise<void>`, `startAt(contextTime: number, projectTime: Time)`, `stop()`, `setMasterVolume(v)`, und `AudioSource` mit `bufferFor(hash, from: Time, to: Time): Promise<AudioBuffer>`

Kette pro Clip: Quelle → Gain für Clip-Lautstärke → Fade-in und Fade-out über `linearRampToValueAtTime` → Spur-Bus mit Lautstärke und Panorama → Master → Ausgang. Stumm- und Solo-Schaltung wirken auf den Spur-Bus.

Fades werden **nicht** pro Frame berechnet, sondern als Automation im Voraus gesetzt. Das ist der Unterschied zwischen sauberem und knackendem Ton.

Tests: ein Clip mit Fade-in beginnt bei Stille und erreicht die Zielverstärkung am Ende der Fade-Dauer, geprüft über einen `OfflineAudioContext`; eine stummgeschaltete Spur liefert Stille; Solo auf einer Spur stummt die anderen.

### Task 9: Master-Uhr

**Files:** `packages/engine/src/clock.ts`, `packages/engine/src/clock.test.ts`

**Interfaces:**
- Produces: `Clock` mit `play()`, `pause()`, `seek(t: Time)`, `now(): Time`, `isPlaying: boolean`, `onTick(cb: (t: Time) => void): () => void`

Der Ton führt, das Bild folgt. `AudioContext.currentTime` ist die Referenz, weil Audio-Drift hörbar ist und ein ausgelassener Frame nicht.

```ts
const FLICKS_PER_SECOND = 705_600_000;

export class Clock {
  #ctx: AudioContext;
  #startContextTime = 0;
  #startProjectTime = 0;
  #playing = false;
  #listeners = new Set<(t: number) => void>();
  #raf = 0;

  constructor(ctx: AudioContext) {
    this.#ctx = ctx;
  }

  get isPlaying(): boolean {
    return this.#playing;
  }

  now(): number {
    if (!this.#playing) return this.#startProjectTime;
    const elapsed = this.#ctx.currentTime - this.#startContextTime;
    return this.#startProjectTime + Math.round(elapsed * FLICKS_PER_SECOND);
  }

  play(): void {
    if (this.#playing) return;
    this.#startContextTime = this.#ctx.currentTime;
    this.#playing = true;
    this.#tick();
  }

  pause(): void {
    if (!this.#playing) return;
    this.#startProjectTime = this.now();
    this.#playing = false;
    cancelAnimationFrame(this.#raf);
  }

  seek(t: number): void {
    this.#startProjectTime = t;
    this.#startContextTime = this.#ctx.currentTime;
    this.#emit(t);
  }

  onTick(cb: (t: number) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  #tick(): void {
    if (!this.#playing) return;
    this.#emit(this.now());
    this.#raf = requestAnimationFrame(() => this.#tick());
  }

  // A listener that throws must not stop the clock, or one buggy consumer
  // freezes playback for every other one.
  #emit(t: number): void {
    for (const cb of this.#listeners) {
      try {
        cb(t);
      } catch (error) {
        console.error(error);
      }
    }
  }
}
```

Tests mit einem gefälschten `AudioContext`, dessen `currentTime` der Test steuert: `now()` steht bei Pause; nach `play()` und einem Zeitschritt ist `now()` um die erwarteten Flicks weiter; `seek` während der Wiedergabe verschiebt die Basis, ohne zu stoppen; ein werfender Listener bringt die Uhr nicht zum Stehen; `now()` liefert immer ganze Flicks.

### Task 10: Playback

**Files:** `packages/engine/src/playback.ts`, Tests

**Interfaces:**
- Consumes: Tasks 4, 5, 7, 8, 9
- Produces: `Playback` mit `attach(canvas)`, `load(project: Project)`, `play()`, `pause()`, `seek(t)`, `stepFrame(dir: 1 | -1)`, `onTime(cb)`, `dispose()`

Orchestriert und arbeitet nicht: pro Tick fragt es für jeden sichtbaren Clip den Quellzeitpunkt beim Kern ab, holt Frames aus Cache oder Quelle, und ruft `Compositor.render`. Fehlt ein Frame noch, wird der letzte gezeigte behalten, statt schwarz zu blitzen.

**Zwei Dinge, die Gruppe B aufgedeckt hat und die dieser Task erledigen muss:**

`Clip::source_time_at` ist zwar im Rust-Kern richtig, aber **von JavaScript aus nicht erreichbar** — `crates/videola-core-wasm/src/lib.rs` exportiert es nicht. Dieser Task erweitert die WASM-Grenze. Die richtige Form ist eine Stapelabfrage: alle sichtbaren Clips für einen Zeitpunkt in einem Aufruf, nicht einer pro Clip, weil pro Frame sonst ein Dutzend Grenzübertritte anfallen. `VideoSource` arbeitet bewusst in Quellzeit und kennt keine `ClipId` — die Abbildung Timeline nach Quelle gehört hierher.

**Chunk-Zeitstempel sind keine Projektzeit.** `EncodedPacket.microsecondTimestamp` in mediabunny ist `Math.trunc`, nicht `Math.round` — Frame 10 einer NTSC-Datei liegt bei 333.666,67 µs und reist als 333.666. Das ist die Genauigkeitsgrenze von WebCodecs, nicht unsere. Nichts darf eine Projektzeit aus einem Chunk-Zeitstempel ableiten; Projektzeit kommt aus dem Modell und wird zur Quelle hin umgerechnet, nie zurück. Gilt genauso für Task 20.

**Rückwärts laufende Clips brauchen eine Klemmung.** Bei `t == clip.start` gibt `source_time_at` das *exklusive* Ende des verbrauchten Quellbereichs zurück, also einen Flick hinter dem letzten gültigen Sample. Wer das ungeprüft an den Dekoder gibt, bekommt für das erste Bild eines rückwärts laufenden Clips nichts oder Schwarz. Klemme in `[in_point, in_point + consumed_source)`. Das steht als Kommentar in `model/clip.rs` und war in keinem Plan — es stammt aus einer Review-Runde in M0.

`stepFrame` rechnet über die Projekt-Framerate als Rational, nicht über eine Sekundenzahl.

Tests mit gefälschtem Compositor und gefälschten Quellen: ein Tick fragt genau die Clips ab, die den Zeitpunkt überdecken; ein fehlender Frame führt nicht zu einem Render-Aufruf mit `undefined`; `dispose` schließt alle Quellen und leert den Cache.

### Task 11 bis 13: Timeline, Gesten, Snapping

**Files:** die `src/timeline/`-Dateien aus der Struktur oben, plus Tests

Die Timeline stellt den Projektzustand dar und schickt Commands. Sie hält nur Zoom und Selektion selbst — alles andere kommt aus `doc.state`.

**Task 11, Darstellung:** Spuren übereinander, Clips als Rechtecke mit Titel, Thumbnails bei genug Breite und Waveform bei Audiospuren. Zoom als Flicks pro Pixel. Ruler mit Timecode über `formatTimecode(seconds, project.settings.fps)`. Virtualisierung ist nötig — bei einer Stunde Material und Frame-Zoom entstehen sonst Hunderttausende DOM-Knoten; zeichne nur, was im Sichtfenster liegt.

**Task 12, Gesten — ein Pfad für Maus und Finger.** Pointer Events, nicht Mouse- und Touch-Events getrennt. Das ist die Entscheidung, die Handy-Bedienung billig macht statt teuer:

```ts
// One pointer path for mouse, pen and touch. Two separate handlers would drift,
// and the phone layout is not an afterthought here -- it is the same code.
export interface TimelineGestures {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
}
```

Was erkannt werden muss: Klick auf einen Clip selektiert; Ziehen in der Mitte verschiebt (`clip.move` mit Coalesce-Key, damit der ganze Zug ein Undo-Schritt ist); Ziehen an einer Kante trimmt (`clip.trim`, ebenfalls coalesced); Ziehen im Ruler scrubbt; zwei Zeiger gleichzeitig zoomen über die Distanzänderung; langes Drücken öffnet das Kontextmenü, weil es auf dem Handy keinen Rechtsklick gibt.

Der Coalesce-Key ist der Grund, warum M0 ihn vom Aufrufer nimmt statt aus einer Uhr: `pointerdown` setzt ihn, `pointerup` lässt ihn weg. Ein Zug über zweihundert Bewegungen wird ein Undo-Schritt.

Trefferflächen sind mindestens 44 px, wenn `pointerType !== 'mouse'` — die Trimm-Zone am Clipende darf am Finger nicht 4 px breit sein.

**Task 13, Snapping:** Playhead, Clipkanten aller Spuren, Marker, und ein Raster. Der Fangradius wird in Pixel gerechnet und in Flicks umgerechnet, nicht umgekehrt — sonst fängt es bei starkem Zoom über Sekunden hinweg. Abschaltbar, und beim Ziehen mit gedrückter Modifikatortaste aus.

Tests: die Snap-Berechnung ist eine reine Funktion und wird direkt getestet — Kandidatenliste hinein, gefangener Wert und Anzeige-Information heraus; ein Zug ohne nahen Kandidaten fängt nicht; der Radius bleibt in Pixeln konstant über Zoomstufen. Die Gesten werden mit synthetischen `PointerEvent`s getestet, inklusive `pointerType: 'touch'` für die Trefferflächen und zwei Zeigern für den Pinch.

### Task 14 und 15: Vorschau und Transport

**Files:** `src/preview/Preview.tsx`, `src/preview/Transport.tsx`, Tests

Canvas, an das `Playback` sich hängt, mit korrektem Seitenverhältnis und `devicePixelRatio`. Transport mit Play und Pause, Frame vorwärts und rückwärts, Sprung zum Anfang und Ende, und der Zeitanzeige als Timecode. Leertaste spielt und pausiert, Pfeiltasten gehen einen Frame — und beides muss auch gehen, wenn der Fokus in der Timeline liegt, nicht nur im Transport.

Auf dem Handy sitzt die Vorschau oben fest und die Timeline scrollt darunter. Das ist im `phone`-Layout-Modus schon vorgesehen.

Tests: Play ruft `Playback.play`; die Zeitanzeige folgt `onTime`; Frame-Schritt bei 30000/1001 verschiebt um exakt einen Frame und nicht um 1/29,97 Sekunden.

### Task 16 und 17: Effekt-Registry, Helligkeit, Crossfade

**Files:** `src/effects/registry.ts`, `src/effects/brightness.ts`, `src/effects/crossfade.ts`, Tests

Ein Effekt ist Manifest plus GLSL-Fragment: `{ id, name: {de, en}, category, params: [{key, type, default, min, max, ui}], fragmentSource, passes }`. Die Registry bildet `effectType` aus dem Modell auf die Implementierung ab und liefert die Parameter-Beschreibung für den Inspector, damit die Oberfläche nichts über einzelne Effekte weiß.

Helligkeit: ein Parameter `amount`, ein Pass. Crossfade: zwei Eingänge und `progress`, gemischt — ein Übergang ist ein Effekt mit zwei Eingängen, kein zweites Subsystem.

Die Manifeste tragen ihre Namen zweisprachig, damit der Inspector keine Effektnamen im Katalog braucht.

Tests: die Registry liefert für einen unbekannten `effectType` `undefined` statt zu werfen; jedes Manifest hat für jeden Parameter einen Default innerhalb von min und max; die Namen existieren in beiden Sprachen.

### Task 18 und 19: Inspector und Keyframes

**Files:** `src/inspector/Inspector.tsx`, `src/inspector/ParamRow.tsx`, Tests

Der Inspector zeigt für den selektierten Clip Transform, Lautstärke, Geschwindigkeit mit Rückwärts-Schalter, Fades, und die Effektliste mit ihren Parametern. Jede Änderung ist ein Command; ein Zug am Schieber ist coalesced.

Eine Parameterzeile hat einen Wert, einen Keyframe-Schalter und — wenn Keyframes existieren — Pfeile zum vorherigen und nächsten. Der Schalter setzt am Playhead einen Keyframe oder löscht den dortigen. Die Interpolationsart wird pro Keyframe zwischen linear, halten und ease umgeschaltet.

Der angezeigte Wert bei gesetzten Keyframes kommt aus `Effect::param_at` am Playhead, nicht aus einer eigenen Rechnung.

Tests: der Keyframe-Schalter am Playhead schickt `keyframe.add` mit der Playhead-Zeit; ein Zug am Schieber ergibt einen Undo-Schritt, nicht zweihundert; bei gesetzten Keyframes zeigt die Zeile den interpolierten Wert und nicht den statischen.

### Task 20 und 21: Export

**Files:** `src/export/worker.ts`, `src/export/muxer.ts`, `src/export/ExportDialog.tsx`, Tests

Der Worker rendert offline: für jeden Ausgabeframe die Quellzeitpunkte holen, dekodieren, komponieren mit **derselben** `Compositor`-Klasse wie die Vorschau, in `VideoEncoder` geben. Ton über `OfflineAudioContext` mit demselben Graphen. Beides in `mediabunny` muxen.

Codec-Prüfung zuerst, mit `VideoEncoder.isConfigSupported`. Ist H.264 nicht verfügbar, VP9 in WebM anbieten und **in der Oberfläche sagen, warum** — über einen i18n-Schlüssel, nicht über eine Fehlermeldung aus dem Browser.

Der Dialog hat Auflösung, Framerate, Codec, Bitrate, Bereich (ganzes Projekt oder Auswahl), Fortschritt und Abbrechen. Abbrechen muss den Worker wirklich beenden und die halbe Datei verwerfen.

Tests: die Codec-Prüfung wird mit einem Mock beider Ausgänge getestet; der Fortschritt erreicht 100 und nicht 99; Abbrechen mitten im Lauf lässt keine Datei zurück; ein Ein-Sekunden-Testprojekt ergibt eine Datei, die der Demuxer aus Task 3 wieder öffnen kann und deren Dauer stimmt — das ist der Roundtrip-Test des Exports und der wichtigste dieses Tasks.

### Task 22 und 23: Medienbibliothek und Phone-Layout

**Files:** `src/library/MediaLibrary.tsx`, Layout-Anpassungen in `src/shell/`, Tests

Bibliothek mit Import per Knopf und per Drag & Drop auf das Fenster, Liste mit Vorschaubild, Dauer und Auflösung, und Ziehen auf die Timeline. Ein Medium, dessen Bytes fehlen, wird als solches markiert und lässt sich neu verknüpfen — der Kern liefert die Warnung schon.

Das Phone-Layout bekommt die Tab-Bar aus der Spec: Medien, Timeline, Effekte, Text, Audio, Export. Die Vorschau bleibt oben fest. Jede Funktion muss erreichbar sein, auch wenn es mehr Schritte braucht.

Tests: Drop einer Datei ruft den Import; ein Medium ohne Bytes wird markiert; im `phone`-Modus sind alle sechs Tabs vorhanden und die Vorschau bleibt sichtbar.

### Task 24: CI, Browser-Tests, Definition of Done

**Files:** `.github/workflows/ci.yml`, Playwright-Konfiguration, Browser-Tests

WebGL, WebCodecs und OPFS gibt es in jsdom nicht. Alles, was sie braucht, wird in Playwright gegen Chromium getestet, und dieser Task richtet das ein — als eigenen CI-Job, damit die schnellen Unit-Tests schnell bleiben.

Die Browser-Tests deckt ab, was jsdom nicht kann: der Compositor rendert ein Testmuster mit festgehaltenem Hash; derselbe Zeitpunkt zweimal ergibt identische Pixel; ein Ein-Sekunden-Export lässt sich wieder öffnen; Import schreibt nach OPFS und liest zurück; die Wiedergabe läuft eine Sekunde mit mindestens 24 Bildern.

## M1 Definition of Done

```
✓ Eine Datei per Drag & Drop importieren, sie erscheint in der Bibliothek mit Vorschaubild
✓ Sie auf eine Videospur ziehen, ein zweites Medium auf eine zweite Spur
✓ Trimmen, Teilen, Verschieben, Ripple-Delete -- mit Maus und mit Finger
✓ Wiedergabe 1080p mit mindestens 24 fps, Ton synchron zum Bild
✓ Rueckwaerts abspielen eines Bereichs funktioniert
✓ Helligkeit auf einen Clip, zwei Keyframes, sichtbare Aenderung ueber die Zeit
✓ Crossfade zwischen zwei Clips
✓ Export nach MP4 mit H.264 und AAC, oder WebM mit VP9 plus Meldung warum
✓ Die exportierte Datei laesst sich wieder importieren
✓ Alles davon im phone-Layout erreichbar
✓ cargo test --workspace, pnpm typecheck, pnpm test, pnpm build und der Browser-Job gruen
✓ Kein nutzersichtbarer Text ausserhalb der Kataloge, beide Sprachen vollstaendig
```

## Selbstreview gegen die Spec

| Spec | Abdeckung in M1 |
|---|---|
| 5 Datenmodell — Clips, Keyframes, Effekte | vorhanden aus M0; M1 benutzt es und ergänzt keine Felder |
| 7.1 Frame-Graph | Task 7, in der Reihenfolge der Spec |
| 7.2 Preview, Master-Clock auf Audio, Reverse, Proxies | Tasks 4, 9, 10 — **Proxies fehlen**, bewusst: sie lohnen erst bei 4K und sind M2 |
| 7.3 Audiograph mit DSP-Bausteinen | Task 8 in Grundform — EQ, Kompressor und Mastering sind M4 |
| 7.4 Export-Backends | nur `WebCodecs`. `NativeFfmpeg` und `ServerFfmpeg` brauchen nativen Kern beziehungsweise Server |
| 8.1 Layout-Modi | vorhanden aus M0; Task 23 füllt den `phone`-Modus mit Inhalt |
| 8.3 Bedienung, Snapping, Tastenkürzel | Tasks 12, 13, 15 |
| 8.4 Offline, OPFS | Tasks 1, 2 — PWA-Service-Worker bleibt offen, weil er ohne Editor nichts zu cachen hatte |
| 10 Effekt-System, WGSL geteilt | Task 16 in GLSL. Die geteilte WGSL-Quelle setzt den Rust-Compositor voraus |
| 12 Golden-Frame-Test | **nicht in M1**, siehe oben — Frame-Hash gegen sich selbst statt Browser gegen Rust |

Offen und beim Namen genannt: Proxies, PWA-Offline, der zweite Compositor mit geteilten Shadern, und damit der Golden-Frame-Test. Jeder dieser Punkte hat einen Grund, der in diesem Plan steht, und keiner ist vergessen.
