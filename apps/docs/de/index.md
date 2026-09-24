---
layout: home
hero:
  text: Videos schneiden, direkt im Browser
  tagline: >
    Eigene Clips reinziehen — oder einen YouTube-Link einfügen und das Video direkt laden.
    Schneiden, Farbe machen, Ton mischen, als MP4 exportieren. Nichts wird hochgeladen: Dein
    Material bleibt auf deinem Rechner.
  image:
    src: /videola-logo.webp
    alt: Videola
  actions:
    - theme: brand
      text: Jetzt ausprobieren
      link: https://video.nksoft.de/
    - theme: alt
      text: Downloads
      link: /de/download
    - theme: alt
      text: Was es kann
      link: /de/guide/features
    - theme: alt
      text: Quellcode
      link: https://github.com/fgilde/videola
features:
  - title: Import von YouTube und tausend anderen Seiten
    details: >
      Eigene Dateien aufs Fenster ziehen, einen Link einfügen oder einfach suchen. Videola lädt das
      Video herunter, Format und Qualität wählst du vorher. Funktioniert mit YouTube, Vimeo, TikTok
      und den meisten Seiten, die yt-dlp kennt — dafür läuft der Videola-Server mit.
    link: /de/guide/editing#medien-hineinbekommen
    linkText: Importieren
  - title: Dein Material bleibt bei dir
    details: >
      Kein Upload, kein Konto, kein Projekt auf einem fremden Server. Die Dateien liegen im
      Speicher deines Browsers und bleiben dort, bis du selbst etwas veröffentlichst.
    link: /de/guide/editing
    linkText: Wie das läuft
  - title: Schneiden mit allem, was dazugehört
    details: >
      Ripple, Roll, Slip, Slide, Gruppen, Marker, Einrasten, Attribute kopieren — und dieselben
      Gesten funktionieren mit dem Finger auf dem Telefon.
    link: /de/guide/editing#die-timeline
    linkText: Die Timeline
  - title: Keyframes ohne Fummelei
    details: >
      Aufnahme einschalten, Playhead setzen, etwas ändern. Videola schreibt die Keyframes und lässt
      alles vor deiner Änderung genau so, wie es war.
    link: /de/guide/editing#keyframes-aufzeichnen
    linkText: Keyframes
  - title: Farbe und Ton fertig im Editor
    details: >
      Messgeräte, Kurven, Farbräder und eigene LUTs. Ein Mischpult mit EQ, Kompressor, Limiter,
      Lautheit auf Sendenorm, Ducking und einer Rauschunterdrückung, die aus den Pausen deiner
      eigenen Aufnahme lernt.
    link: /de/guide/audio
    linkText: Ton
  - title: Effekte, die man vor der Wahl sieht
    details: >
      Sechzehn Effekte und sieben Übergänge, und jede Kachel zeigt dein eigenes Bild mit dem Effekt
      darauf. Alles, was sich einstellen lässt, lässt sich auch animieren.
    link: /de/guide/effects-and-transitions
    linkText: Effekte
  - title: Veröffentlichen ohne Umweg
    details: >
      Das fertige Video geht direkt zu YouTube, Vimeo, PeerTube, Mastodon, Bluesky, Telegram, auf
      eine Facebook-Seite oder an eine eigene Adresse. Bluesky braucht nur ein App-Passwort.
    link: /de/guide/self-hosting#veroffentlichungsziele
    linkText: Ziele
  - title: Browser, Rechner, Telefon, eigener Server
    details: >
      Ein Code: eine Web-App zum Installieren, Builds für Windows, macOS und Linux, und ein
      Docker-Image fürs NAS. Für Unraid, Umbrel und Proxmox gibt es fertige Installationen.
    link: /de/guide/self-hosting
    linkText: Selbst betreiben
---

## Was heute damit geht

### Schneiden

Alles, was man von einer Timeline erwartet: Ripple-Löschen, Trimmen, Roll, Slip und Slide,
Mehrfachauswahl, Gruppen, Zwischenablage, Marker, Einrasten und Zoom. Eine gesperrte Spur bewegt
sich nicht. Eine Auswahl lässt sich zu einem Clip zusammenfalten und dann als Ganzes gradieren oder
ausblenden.

Rückgängig gilt für alles, auch für einen Zug über hundert Schritte — der zählt als einer.

### Das Bild

Bildweise abspielen, scrubben oder mit J/K/L durchfahren. Den Clip direkt auf dem Bild verschieben —
der Rahmen dort ist die echte Geometrie und kein danebengezeichneter Griff. Standbilder,
Geschwindigkeitsrampen, Bewegungsunschärfe, die der tatsächlichen Bewegung folgt.

Eine Kamerakarte mit einem Dutzend Takes in einer Datei? Videola findet die Schnitte und trennt sie
in einem Schritt.

### Der Ton

Ein Mischpult mit Lautstärke, Panorama, Stumm und Solo, Pegelanzeigen, Blenden, EQ und Dynamik.
Stereo oder 5.1 mit echter Position pro Spur. Lautheit nach EBU R128, Ducking unter einer Stimme,
Stille herausschneiden, ein Marker auf jedem Beat — und eine spektrale Rauschunterdrückung, die aus
den leisen Stellen deiner eigenen Aufnahme lernt.

### Rein und wieder raus

- **Rein:** eigene Dateien, ein YouTube-Link oder eine Suche, Bilder, Untertitel als SRT oder WebVTT,
  LUTs als `.cube` und Mischungen aus [Audiola](https://www.audiola.de).
- **Raus:** MP4 oder WebM mit Fortschritt und einem Abbruch, der wirklich abbricht. Oder den Schnitt
  weitergeben als EDL, FCPXML für Resolve und Final Cut oder als XML, das Premiere Pro als echte
  Sequenz importiert.
- **Anderes Format in einem Druck:** hochkant, quadratisch oder 4:5, jeder Clip passend skaliert.
- **Fünfzehn Vorlagen** — Bauchbinden, Countdowns, Bild-im-Bild und der Rest. Sie zeichnen sich
  selbst, hier liegt also kein fremdes Material mit einer Lizenz daran.

### Wo es läuft

Im Browser, installierbar als App und auch ohne Netz zu öffnen. Als Programm für Windows, macOS und
Linux. Als Docker-Image auf dem eigenen Rechner, mit fertigen Installationen für Unraid, Umbrel und
Proxmox. Auf Telefon und Tablet, wo sich die Bereiche abwechseln, weil der Platz nicht für alle
reicht.

Dazu gibt es eine HTTP-Schnittstelle, einen MCP-Server und ein CLI — ein Agent kann also schneiden
und exportieren, ganz ohne Browser.

## Was fehlt

Keine Magnetic-Timeline; das ist eine Entscheidung, und das [Kapitel zum
Schneiden](/de/guide/editing) erklärt sie. FFmpeg ist auch nicht eingebaut — exportiert wird mit den
Encodern des Browsers.

Das [Architektur-Kapitel](/de/guide/architecture) sagt Entscheidung für Entscheidung, was gebaut ist
und was geplant.

## Offen entwickelt

Videola steht unter GPL-3.0, der ganze Quellcode liegt auf
[GitHub](https://github.com/fgilde/videola). Das Datenmodell ist eine Rust-Crate, die der Browser
über WebAssembly benutzt — Vorschau und Export rechnen damit garantiert mit denselben Zahlen. Jeder
Screenshot auf dieser Seite stammt aus einem Test, der die Anwendung baut, sie in einem echten
Browser bedient und nachmisst, was dabei herauskommt.

<figure class="shot">
  <img src="/editor-desktop.webp" alt="Der Videola-Editor: ein dekodiertes Videobild in der Vorschau, ein Transport mit 00:00:00.00 von 00:00:02.00 und aktivem Pause-Knopf, und ein Clip namens fixture.mp4 auf Spur V1">
  <figcaption>Ein echtes Bild, im Browser dekodiert und komponiert — aus dem Lauf, der die Anwendung baut, ein Video hineinzieht und das Ergebnis von der Canvas zurückliest.</figcaption>
</figure>

Theme und Sprache wechseln ohne Neuladen, und jedes Wort auf dem Schirm — Fehlermeldungen
eingeschlossen — kommt aus einem Katalog statt aus dem Code.

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

<Connect inline />
