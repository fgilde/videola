# Architektur

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [Architecture](/guide/architecture). Diese Seite
fasst es zusammen und nennt dieselben Entscheidungen, aber ohne die ausführliche Begründung.
:::

## Das Risiko, um das herum gebaut ist

Ein Video-Editor soll auf mehr als einer Maschine rendern: Vorschau im Browser, Export durch den
Desktop-Build, später headless auf einem Server. Was so ein Werkzeug ruiniert, ist Divergenz —
dasselbe Projekt sieht je nach Ausführungsort anders aus. Divergenz hat eine Ursache, und das ist
Duplikation. Sie entsteht überall dort, wo Modell oder Effekt zweimal implementiert werden.

Fast alles an der Architektur ist eine Maßnahme, die Zahl der Implementierungen bei eins zu halten.

## Das Modell lebt in Rust

**Gebaut.** `crates/videola-core` enthält Datenmodell, Command-Bus, Undo und Redo sowie das Lesen
und Schreiben von `.videola`. `crates/videola-core-wasm` kapselt das mit `wasm_bindgen`, damit der
Browser dieselbe Crate antreibt.

Die Alternative — Modell und Logik in TypeScript, Rust nur zum Encodieren — spart die
Rust-Implementierung nicht ein: ein nativer oder serverseitiger Compositor muss das Projekt ohnehin
vollständig lesen und auswerten. Das Modell existiert in Rust also zwingend, und eine zweite Fassung
in TypeScript wäre genau die Kopie, die per Hand synchron gehalten werden müsste.

Zwei Kosten sind bewusst in Kauf genommen: die Entwicklungsschleife enthält einen Build-Schritt
(`pnpm wasm` muss vorher laufen), und die Grenze zwischen TypeScript und WASM serialisiert. Deshalb
ist sie grob geschnitten — ein `dispatch(command)`, das einen Patch zurückgibt.

### Die drei Stapelabfragen

Gelesen wird aus demselben Grund grob wie geschrieben. Die Wiedergabe fragt mit Anzeigerate, also
tritt alles, was die Darstellung pro Bild braucht, einmal fürs ganze Bild über die Grenze statt
einmal pro Element:

| Abfrage | Antwortet mit | Gelesen von |
|---|---|---|
| `sourceTimesAt(at)` | jedem Clip, den der Moment berührt → die Stelle im eigenen Medium | dem Dekoder |
| `effectParamsAt(at)` | jedem Effekt auf diesen Clips, dazu jede Spurkette und die des Projekts → jeder Parameter, den er beantworten kann | der Zeichenliste, dem Inspector |
| `transformsAt(at)` | jedem Clip, den der Moment berührt → seiner Geometrie | der Zeichenliste |

Alle drei lösen dabei Keyframes auf, und genau dafür sitzen sie im Kern und nicht in der
Darstellung. `Clip.transform` und `Effect.params` sind die Werte *in Ruhe*; der Wert zu einem
Moment ist das, was diese Abfragen liefern, und nichts, was zeichnet, darf ihn selbst ausrechnen —
eine zweite Interpolation neben der ersten ist genau der Weg, auf dem Vorschau und Export sich über
ein Bild uneinig werden. Eine Spurkette und die Mastering-Kette des Projekts haben kein Clipfenster,
aus dem sie fallen könnten, also beantwortet `effectParamsAt` sie zu jedem Moment.

`transformsAt` antwortet für jeden berührten Clip, ob animiert oder nicht, damit die Zeichenliste
eine Regel hat statt eines Rückfalls.

Geplant, aber nicht erreicht: die Crate soll auch nativ in die Tauri-Hülle und in einen Server
gelinkt werden. Heute existiert nur der WASM-Pfad; `apps/desktop` hängt gar nicht von
`videola-core` ab, sondern hostet das Web-Bundle.

## Undo ist ein Diff, keine Umkehroperation

**Gebaut.** `Document::dispatch` serialisiert das Projekt, wendet den Command auf einen Klon an,
serialisiert das Ergebnis und bildet die Differenz in beide Richtungen. Vorwärts-Patch und
Umkehr-Patch landen als Paar auf dem Undo-Stack.

Der Grund: ein handgeschriebenes Gegenstück pro Command ist der am seltensten ausgeführte Code im
Editor und veraltet, sobald die Vorwärtsoperation geändert wird. Siebenunddreißig Commands wären
achtunddreißig Umkehrungen, die gepflegt werden müssten. Ein Diff ist einmal geschrieben und für den
nächsten Command schon richtig, bevor er existiert.

## Zeit ist eine Ganzzahl

**Gebaut.** `Time` ist ein Wrapper um `i64` und zählt *Flicks*; eine Sekunde sind 705.600.000
Flicks. Fließkomma-Sekunden wären die naheliegende und falsche Wahl, weil `1/30` binär nicht exakt
darstellbar ist und ein Schnitt dann neben dem Bild landet.

705.600.000 zerlegt sich in 2⁹ · 3² · 5⁵ · 7² und teilt sich damit ohne Rest durch die Bildraten 24,
25, 30, 48, 50, 60, 90, 100 und 120 sowie durch die Abtastraten 8000 bis 192000 Hz. Auch die
NTSC-Raten gehen exakt auf: eine Bildlänge bei 30000/1001 sind genau 23.543.520 Flicks.

## Der `.videola`-Container

**Teilweise gebaut.** Geschrieben werden heute `videola.json` (Manifest), `project.json` (das
Modell) und `media/<sha256>.<ext>`. Für Fonts, Vorschaubilder und die regenerierbaren Caches
(Proxies, Thumbnails, Waveforms, Historie) sind Einträge vorgesehen, aber nichts liest oder schreibt
sie. Details im Kapitel [Das .videola-Format](/de/guide/videola-format).

Medien sind **inhaltsadressiert**: der Eintragsname ist der SHA-256-Hash der eigenen Bytes. Damit
wird dieselbe Datei nur einmal gespeichert, Medien-IDs bleiben über Speichervorgänge stabil, und der
Leser kann prüfen, was er geladen hat — hasht ein Eintrag nicht auf seinen eigenen Namen, ist er
manipuliert oder beschädigt.

## Effekte: ein Shader, mehrere Ausführungsorte

**Gebaut für WebGL2, mit zwei Effekten.** Es gibt eine Effekt-Registry, einen GLSL-Shader je Effekt
und einen Compositor, der die Kette fährt und einen Übergang mischt — wie einer geschrieben wird und
worauf er sich verlassen darf, steht in [Effekte und
Übergänge](/de/guide/effects-and-transitions). Was folgt, ist die Form, die die Shader annehmen,
sobald es einen zweiten Compositor gibt.

Der Entwurf sieht pro Effekt zwei Dateien vor: `effect.json` mit Parametern und Labels und
`shader.wgsl` mit dem Pass. WGSL läuft unverändert in Browser-WebGPU **und** in Rust-`wgpu`; für den
WebGL2-Fallback übersetzt ein Build-Schritt mit `naga` nach GLSL. Der Fallback ist nicht optional,
weil WKWebView auf macOS und iOS WebGPU nicht zuverlässig unterstützt. Übergänge sind Effekte mit
zwei Eingängen und einem `progress`-Parameter, kein zweites Subsystem.

## Was gebaut ist und was geplant

| Teil | Stand |
|---|---|
| Datenmodell, 20 Commands, Undo/Redo | gebaut |
| `.videola`-Manifest, `project.json`, inhaltsadressierte Medien | gebaut |
| Regenerierbare Cache-Einträge (Proxies, Thumbnails, Peaks, Historie) | geplant |
| WASM-Bindings, ts-rs-Typen, TypeScript-Fassade | gebaut |
| Theme, deutsche und englische Kataloge, Layout-Erkennung, Anwendungsrahmen | gebaut |
| Nativer Link des Kerns in die Tauri-Hülle und in einen Server | geplant |
| Timeline, Vorschau, Wiedergabe, Audio-Graph | geplant |
| Effekt-Registry, GLSL-Shader, WebGL2-Compositor, Helligkeit und Überblendung | gebaut |
| Export nach MP4/WebM über WebCodecs in einem Worker | gebaut |
| Geteilte WGSL-Quellen, WebGPU- und `wgpu`-Compositor | geplant |
| FFmpeg, natives Rendern, Server-Rendern | geplant |
| HTTP-API, MCP-Server, generierter Command-Katalog | gebaut, auf dem WASM-Kern — siehe [Die API und der MCP-Server](/de/guide/api-and-mcp) |
| Einzelbild- und Peak-Werkzeuge für Agenten, Rendern über die API | geplant |
| Template-Modus (`.videolat`, Galerie, Wizard) | geplant |

Die ursprüngliche Begründung steht auf Deutsch in der
[Design-Spec](https://github.com/fgilde/videola/blob/main/docs/superpowers/specs/2026-08-07-videola-design.md).
Sie beschreibt den angestrebten Gesamtumfang, nicht den heutigen Stand.
