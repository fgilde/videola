---
layout: home
hero:
  text: Ein Video-Editor auf einem Rust-Kern
  tagline: >
    Datenmodell, Command-Bus und Anwendungsrahmen stehen. Die Editor-Oberfläche nicht: es gibt
    bisher keine Timeline, keine Wiedergabe, keine Effekte und keinen Export.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Downloads
      link: https://github.com/fgilde/videola/releases
    - theme: alt
      text: Dokumentation
      link: /de/guide/getting-started
    - theme: alt
      text: Quellcode
      link: https://github.com/fgilde/videola
features:
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
    link: /de/guide/architecture
    linkText: Die Fassade
  - title: Web, Desktop und Docker
    details: >
      Eine Codebasis liefert die Vite-Web-App, eine Tauri-Hülle mit Installern für Windows, Linux
      und macOS und ein Image, das die Web-App über nginx ausliefert.
    link: /de/guide/building-and-releasing
    linkText: Bauen und Ausliefern
---

## Was heute funktioniert

- **Der Rust-Kern.** `videola-core` enthält das Datenmodell, einen Bus aus 20 Commands, Undo und
  Redo sowie das Lesen und Schreiben von `.videola`.
- **WASM-Bindings.** `videola-core-wasm` kapselt den Kern für den Browser; `@videola/core` ist die
  TypeScript-Fassade darüber, deren Modelltypen ts-rs erzeugt.
- **Der Anwendungsrahmen.** `@videola/ui` bringt ein Theme für dunkel, hell und Systemvorgabe,
  deutsche und englische Kataloge und die Layout-Erkennung für Telefon, Tablet und Desktop.
- **Die Web-App.** Sie öffnet ein Projekt, schaltet Theme und Sprache um, fügt eine Spur hinzu,
  macht rückgängig und wieder her, schreibt eine `.videola`-Datei und liest sie zurück.
- **Packaging.** Eine Tauri-Hülle, die Installer für Windows, Linux und macOS baut, und ein
  Docker-Image, das die Web-App als statische Dateien ausliefert.

## Was noch fehlt

Keine Timeline, keine Wiedergabe, keine Vorschau, kein Effekt-Rendering, keine Oberfläche für
Keyframes, keine Audio-Verarbeitung, kein Medienimport im Interface, kein Video-Export. FFmpeg ist
nicht eingebunden, es gibt keine REST-API und keinen MCP-Endpunkt, und die Release-Jobs für Android
und iOS werden übersprungen, solange keine Signaturschlüssel hinterlegt sind. Ein heute gebauter
Installer liefert einen funktionierenden Anwendungsrahmen, in dem es nichts zu schneiden gibt.

Das [Architektur-Kapitel](/de/guide/architecture) hält Entscheidung für Entscheidung fest, welche
Teile des Entwurfs gebaut und welche geplant sind.

## Der Anwendungsrahmen

<figure class="shot">
  <img src="/shell-dark.png" alt="Der Videola-Rahmen im dunklen Theme: eine Kopfzeile mit der Wortmarke, dann Neues Projekt, Öffnen, Spur hinzufügen, Rückgängig und Wiederholen, Umschaltern für Sprache und Theme und einer Speichern-Schaltfläche, darunter der Projektstatus">
  <figcaption>Der Anwendungsrahmen im dunklen Theme mit aktivem deutschen Katalog. Rückgängig und Wiederholen sind deaktiviert, weil noch nichts bearbeitet wurde.</figcaption>
</figure>

<figure class="shot">
  <img src="/shell-light.png" alt="Derselbe Videola-Rahmen im hellen Theme mit denselben Bedienelementen auf hellem Grund">
  <figcaption>Derselbe Rahmen im hellen Theme. Beide Themes hängen an CSS-Variablen und folgen <code>prefers-color-scheme</code>, bis der Nutzer es überschreibt; die Wahl wird gespeichert.</figcaption>
</figure>

<figure class="shot">
  <img src="/shell-english.png" alt="Der Videola-Rahmen im hellen Theme mit aktivem englischem Katalog: dieselben Bedienelemente mit englischen Beschriftungen">
  <figcaption>Der Wechsel auf Englisch tauscht den Katalog ohne Neuladen. Jeder sichtbare Text kommt aus einem Katalog, auch die Fehler, die der Rust-Kern als Codes meldet.</figcaption>
</figure>

<figure class="shot">
  <img src="/shell-track-added.png" alt="Der Videola-Rahmen nach dem Hinzufügen einer Spur: eine Spur, aktives Rückgängig, weiterhin deaktiviertes Wiederholen">
  <figcaption>Nach dem Hinzufügen einer Spur meldet das Projekt eine Spur und Rückgängig wird aktiv; Wiederholen bleibt deaktiviert, bis etwas zurückgenommen wurde. Beide lesen die JSON-Patch-Historie aus dem Kapitel Commands und Undo.</figcaption>
</figure>
