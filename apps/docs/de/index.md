---
layout: home
hero:
  text: Ein Video-Editor auf einem Rust-Kern
  tagline: >
    Importieren, schneiden, keyframen, mischen und exportieren — im Browser, am Schreibtisch, auf
    Tablet und Telefon. Mit HTTP-Schnittstelle und MCP-Server für Agenten.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Downloads
      link: https://github.com/fgilde/videola/releases
    - theme: alt
      text: Was es kann
      link: /de/guide/features
    - theme: alt
      text: Quellcode
      link: https://github.com/fgilde/videola
features:
  - title: Importieren, schneiden, abspielen
    details: >
      Ein Video auf das Fenster ziehen oder über den Knopf auswählen. Es landet in OPFS unter dem
      Hash seiner eigenen Bytes, wird zum Clip und läuft über WebCodecs und einen
      WebGL2-Compositor, wobei die Audio-Uhr führt.
    link: /de/guide/editing
    linkText: Schneiden
  - title: Ein Zeigerpfad für Maus und Finger
    details: >
      Verschieben, Trimmen, Scrubben, Pinch-Zoom und langes Drücken laufen alle über Pointer
      Events, das Handy ist also keine zweite Umsetzung. Trefferflächen wachsen auf 44 px, sobald
      der Zeiger keine Maus ist.
    link: /de/guide/editing#die-timeline
    linkText: Gesten
  - title: Ein Modell, einmal geschrieben
    details: >
      Datenmodell, Command-Bus und die .videola-Ein- und Ausgabe liegen in videola-core, einer
      Rust-Crate. Der Browser treibt dieselbe Crate über WASM an, also gibt es kein zweites Modell
      in TypeScript, das nachgepflegt werden müsste.
    link: /de/guide/architecture
    linkText: Wie es zusammenhängt
  - title: Undo aus Diffs
    details: >
      Ein angewendeter Command liefert einen JSON-Patch und dessen Umkehrung. Undo spielt die
      Umkehrung ab, also trägt kein Command ein handgeschriebenes Gegenstück, das aus dem Tritt
      geraten kann.
    link: /de/guide/commands-and-undo
    linkText: Commands und Undo
  - title: Zeit als Ganzzahl
    details: >
      Positionen und Dauern sind Flicks, keine Fließkomma-Sekunden. Eine Sekunde sind 705.600.000
      Flicks, und das teilt sich ohne Rest durch jede Bildrate und jede Audio-Abtastrate, die dem
      Editor begegnen wird.
    link: /de/guide/architecture
    linkText: Warum Flicks
  - title: Eine Projektdatei, die unzip öffnet
    details: >
      .videola ist ein ZIP mit einem Manifest, project.json und den Mediendateien, jede benannt
      nach dem SHA-256-Hash ihrer eigenen Bytes. Lesen und Schreiben sind verlustfrei.
    link: /de/guide/videola-format
    linkText: Der Aufbau des Containers
  - title: Typen generiert, nicht abgeschrieben
    details: >
      ts-rs leitet die TypeScript-Typen aus den Rust-Typen ab, und die CI schlägt an, sobald das
      eingecheckte Ergebnis nicht mehr zur Quelle passt.
    link: /de/guide/architecture#das-modell-lebt-in-rust
    linkText: Das Modell lebt in Rust
  - title: Web, Desktop und Docker
    details: >
      Eine Codebasis liefert die Vite-Web-App, eine Tauri-Hülle mit Installern für Windows, Linux
      und macOS und ein Image, das die Web-App über nginx ausliefert.
    link: /de/guide/building-and-releasing
    linkText: Bauen und Ausliefern
---

## Was heute funktioniert

- **Schneiden** — Ripple-Löschen und -Trimmen, Roll, Slip, Slide, Mehrfachauswahl, Gruppen,
  Zwischenablage, Marker, Einrasten und Zoom, mit einem Zeigerpfad für Maus, Stift und Finger.
  Sperrbare Spuren, durchgesetzt von einer einzigen Schranke vor der ganzen Kommandoverteilung.
- **Verschachtelte Clips** — eine Auswahl zu einem Clip zusammenfassen; dass das Bild sich dabei
  nicht ändert, ist nachgewiesen. Blenden, überlagern, graden, zuschneiden oder überblenden isoliert
  den Compound zuerst auf eine eigene Fläche, damit alle fünf die fertige Gruppe treffen und nicht
  jeden Clip darin.
- **Wiedergabe** — WebCodecs in einen WebGL2-Compositor, die Audio-Uhr führt, bildgenauer Transport.
- **Geometrie auf dem Bild** — ein Rahmen mit Ecken- und Drehgriffen, dessen Ecken aus genau der
  Matrix stammen, die der Compositor der GPU übergibt, und die Bahn, die Positions-Keys beschreiben:
  aus dem Kern abgetastet statt von Ecke zu Ecke gezeichnet.
- **Effekte und Übergänge** — acht Effekte, sieben Übergänge, Masken, ein Textgenerator,
  Farbkurven und Lift/Gamma/Gain-Räder, ausgewählt in einem Browser, dessen jede Kachel der Shader
  des Effekts über dem aktuellen Bild ist. Jeder Parameter keyframebar, auch Position, Skalierung
  und Drehung, alles im Rust-Kern aufgelöst.
- **Farb- und Ton-Feinschliff** — Wellenform, Vektorskop und Histogramm; Kurven, Lift/Gamma/Gain und
  `.cube`-Lookup-Tabellen, die in der Projektdatei mitreisen; Mischpult mit
  Pegelanzeige, EQ, Tiefen- und Höhensperre, Kompressor und Limiter, Lautheits-Normalisierung, Ducking, Stille-Erkennung und
  einen Marker auf jedem Schlag.
- **Untertitel** — SRT und WebVTT hinein und heraus, auf einer eigenen Untertitelspur.
- **Klassischer Schnitt** — In- und Out-Punkte, Einfügen und Überschreiben, J/K/L,
  Anpassungsebenen, Geschwindigkeitsrampen mit Integral statt Multiplikation.
- **Proxies** — alles, was höher als 720 Pixel ist, wird einmal in eine 720p-Kopie umgewandelt, die
  die Vorschau dekodiert; der Export nimmt immer das Original, an der geschriebenen Datei mit
  ffprobe und ffmpeg nachgewiesen.
- **Ton** — Mischpult mit Lautstärke, Panorama, Stumm und Solo, Fades als Automation, Waveforms,
  EBU-R128-Lautheit gegen die Tech-3341-Fälle geprüft.
- **Export** — MP4 oder WebM in einem Worker, mit Fortschritt und einem Abbruch, der wirklich stoppt.
- **Vorlagen** — Galerie, Assistent, und ein Backen, das ein ganz normales Projekt hinterlässt.
- **Schnittstelle, MCP-Server und CLI** — der ganze Command-Katalog, aus dem Rust-Enum generiert,
  dazu Standbilder und Tonspitzen, damit ein Agent sehen kann, was er gerade getan hat.
- **Selbst hosten** — ein Node-Prozess liefert Editor, Schnittstelle, MCP und CLI.
- **Telefon, Tablet und Schreibtisch** — derselbe Code, die Bereiche wechseln sich ab.

## Was noch fehlt

Kein Motion-Blur. Keine Rauschunterdrückung: Tiefen- und Höhensperre nehmen ein Band weg, was
nicht dasselbe ist, wie eine Stimme von einem Geräusch in ihrem Band zu trennen. Die Keyframe-Glättung hat ein
Kurvenfeld mit ziehbaren Anfassern, aber ein Anfasser außerhalb des Einheitsquadrats — das
Überschwingen, aus dem ein Abprall gemacht ist — wird an dessen Rand geklemmt, und eine Kurve lässt
sich nicht von einem Parameter auf einen anderen übertragen. Die Magnetic-Timeline fehlt bewusst,
und das
[Kapitel zum Schneiden](/de/guide/editing) begründet warum. FFmpeg ist nicht eingebunden; der Export
nutzt die Encoder des Browsers.

Das [Architektur-Kapitel](/de/guide/architecture) hält Entscheidung für Entscheidung fest, welche
Teile des Entwurfs gebaut und welche geplant sind.

## Der Editor

<figure class="shot">
  <img src="/editor-desktop.webp" alt="Der Videola-Editor: ein dekodiertes Videobild in der Vorschau, ein Transport mit 00:00:00.00 von 00:00:02.00 und aktivem Pause-Knopf, und ein Clip namens fixture.mp4 auf Spur V1">
  <figcaption>Ein echtes Bild, im Browser dekodiert und komponiert. Der Screenshot stammt aus einem Test, der die Anwendung baut, sie in headless Chrome fährt und eine Videodatei hineinzieht — derselbe Lauf, der eine Vorschau-Canvas gefunden hat, die nie über ihre Ausgangsgröße hinauswuchs.</figcaption>
</figure>

Theme und Sprache wechseln ohne Neuladen. Jeder sichtbare Text kommt aus einem Katalog,
einschließlich der Fehler, die der Rust-Kern als Codes meldet.

<section class="sibling">
  <a class="sibling-card" href="https://www.audiola.de" target="_blank" rel="noreferrer">
    <img src="/audiola-logo.webp" alt="Audiola" width="180" height="180" loading="lazy">
    <div class="sibling-copy">
      <p class="sibling-kicker">Aus derselben Werkstatt</p>
      <h2>Audiola</h2>
      <p>Das Audio-Werkzeug nebenan — und die Herkunft von Videolas eigener Tonarbeit.</p>
      <span class="sibling-cta">audiola.de &rarr;</span>
    </div>
  </a>
</section>

