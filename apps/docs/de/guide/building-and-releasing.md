# Bauen und Ausliefern

::: info Zusammenfassung
Das vollständige Kapitel gibt es nur auf Englisch: [Building and
releasing](/guide/building-and-releasing). Dort steht jeder Job Schritt für Schritt. Diese Seite fasst
es zusammen.
:::

In `.github/workflows` liegen drei Workflows: `ci.yml` bei jedem Push auf `main` und jedem Pull
Request, `release.yml` bei einem `v*`-Tag und `pages.yml` für diese Doku-Seite.

## CI

| Job | Was er tut |
|---|---|
| `rust` | `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` |
| `types` | erzeugt die ts-rs-Typen neu und schlägt an, wenn die eingecheckten Dateien nicht mehr passen |
| `wasm` | `wasm-pack build crates/videola-core-wasm --target web`, lädt das Ergebnis als Artefakt hoch |
| `web` | braucht `wasm`; lädt das Artefakt, dann `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build` |
| `browser` | braucht `wasm`; fährt die vier Browser-Harnessen in echtem Chrome |

Der `types`-Job staged sein Ergebnis mit `git add -A`, bevor er vergleicht: `git diff` ignoriert
unversionierte Dateien, ein neu erzeugter Typ würde sonst unbemerkt durchrutschen. Clippy läuft mit
verbotenem `unsafe_code` und mit `unwrap_used` und `expect_used` auf `deny`.

## Was der Browser-Job prüft

WebGL2, WebCodecs, OPFS und Layout gibt es in jsdom nicht. Vier Harnessen fahren denselben Code in
echtem Chrome — ohne Playwright, ohne jede Browser-Automatisierung: Chrome rendert die Seite und
meldet das Ergebnis zurück, über `--dump-dom` oder per POST an den Server, der ihn gestartet hat.

| Aufruf | Was er prüft |
|---|---|
| `pnpm --filter @videola/engine test:gpu` | 351 Pixelprüfungen gegen ANGLE/SwiftShader: Shader, premultipliziertes Alpha in allen neun Blendmodi, jeder Effekt und Übergang an benannten Pixelwerten, die Tonwertkurven und die Farbräder, was ein Messgerät aus einem verkleinerten Bild liest, Transformationsmatrix, Kontextverlust, geschlossener `VideoFrame` |
| `pnpm --filter @videola/engine test:export` | 27 Prüfungen: ein echter Export, danach lesen `ffprobe` und `ffmpeg` die Datei zurück — Codec, Auflösung, Bildrate, Bildzahl, Länge, und ein Goertzel-Filter bestätigt den Ton in der Datei |
| `pnpm --filter @videola/ui test:browser` | 200 Prüfungen gegen echtes Layout: 44 px als Geometrie, Trefferflächen, Virtualisierungsbudget über Zoomstufen, Scrollbreite, und die drei Messgeräte samt Kurvenfeld auf einer Leinwand, die der Browser wirklich rastert |
| `pnpm --filter videola-web test:browser` | 228 Prüfungen an der **gebauten** Anwendung: eine abgelegte Datei bis ins dekodierte Bild, eine Korrektur mit Kurve und Farbrad, der die Messgeräte folgen, Wiedergabe, Telefon- und Tablet-Viewport über das Devtools-Protokoll |

Alle vier in **einem** Job: zusammen brauchen sie deutlich unter einer Minute, ein zweiter Job
kostete mehr an Checkout, Installation und Bau als die Prüfungen selbst. Nichts davon läuft nur
nachts — jede dieser Harnessen hat einen Fehler gefunden, den kein Unit-Test sehen konnte, und auf
einen nächtlichen Lauf wartet niemand.

Zwei Dinge muss der Job selbst herrichten, beide wegen des Runners und nicht wegen der Tests:
**Chrome** wird geprüft statt angenommen (fehlt es, bricht der Job mit klarer Meldung ab) und über
einen Wrapper mit `--no-sandbox` als `CHROME_PATH` gesetzt, weil Ubuntu ab 24.04 unprivilegierte
User-Namespaces sperren kann; **ffmpeg** und **ffprobe** installiert der Job nach, falls das Image
sie nicht mitbringt — sie sind der unabhängige Leser des Exports. Die drei Screenshots der
Anwendungs-Harness lädt der Job als Artefakt `browser-screenshots` hoch.

## Release

Ein `v*`-Tag löst `release.yml` aus. Das Release wird als **Entwurf** angelegt, damit die Artefakte
geprüft werden können, bevor sie jemand sieht.

| Job | Ergebnis |
|---|---|
| `gate` | vier Ausgaben, ob die Signatur-Secrets für macOS, Android, iOS und den Updater vorhanden sind |
| `docker` | `ghcr.io/fgilde/videola:<tag>` und `:latest` |
| `wasm` | das Artefakt, das die drei App-Jobs verbrauchen |
| `bundle` | `node deploy/bundle.mjs`: die drei Einsprungpunkte, das WASM und der gebaute Editor als ein Tarball, der nur Node 22 braucht |
| `desktop` | Matrix über Ubuntu, Windows und macOS: `.deb` und AppImage, NSIS-Installer, `.dmg` |
| `android` | `.apk` und `.aab`, nur mit hinterlegtem Keystore |
| `ios` | `.ipa` für App Store Connect, nur mit Zertifikat und Provisioning-Profil |
| `summary` | eine Tabelle mit dem Ergebnis jedes Jobs, mit `if: always()` |

Der `bundle`-Job ist, was den Proxmox-Installer möglich macht: der holt
`videola-server-<version>.tar.gz` aus dem letzten Release, das Asset muss also am Release hängen und
nicht an einem Branch. Er lädt mit `gh release upload` auf das Draft, das der `desktop`-Job angelegt hat
— eine Action, die ein Release anlegt, legte ein zweites an — und wartet vorher, bis dieses Draft
existiert, denn die beiden Jobs laufen parallel.

`tauri.conf.json` listet alle vier Desktop-Bundler, die Matrix gibt `--bundles` aber trotzdem pro
Plattform mit: der `nsis`-Bundler ist nicht auf Windows beschränkt, aus der Konfiguration heraus
würden Linux und macOS je einen Windows-Installer bauen. `fail-fast: false` verhindert, dass ein
gescheiterter macOS-Build die fertigen Installer für Windows und Linux mitnimmt.

### Von wem der Installer sagt, dass er kommt

Windows zeigt einen **Hersteller** im Installer, in der Liste der installierten Programme und in den
Eigenschaften der Datei, und nimmt ihn aus dem Bundle-Identifier, wenn nichts anderes dasteht —
`com.cargonerds.videola` hat Windows deshalb eine Firma nennen lassen, die mit diesem Programm nichts
zu tun hat. Der Identifier ist `org.gilde.videola`, und `bundle.publisher` sagt **gilde.org**
ausdrücklich, statt es herleiten zu lassen.

Einen Identifier zu ändern ist nicht kosmetisch: unter diesem Namen führt das Betriebssystem die
Anwendung, es wandern also das Konfigurationsverzeichnis, das Datenverzeichnis und die Vorstellung des
Updaters von „derselben Anwendung" mit. Das macht man vor einer Veröffentlichung und nicht danach.

`bundle.copyright` und `bundle.homepage` stehen daneben, denn derselbe Eigenschaften-Dialog zeigt
beide, und ein leeres Feld dort liest sich wie ein unfertiger Build.

### Warum es einen `gate`-Job gibt

Der `secrets`-Kontext steht in einem Job-`if:` nicht zur Verfügung — nur `github`, `needs`, `vars` und
`inputs`. Ein Job kann also nicht selbst fragen, ob es ein Zertifikat gibt.

`gate` liest die Secrets deshalb in einem normalen Schritt als Umgebungsvariablen und gibt `yes` oder
`no` als Job-Output aus. `android` und `ios` hängen an diesen Outputs und werden von GitHub als
**skipped** markiert statt rot. macOS wird eine Ebene tiefer behandelt: das DMG wird immer gebaut, nur
der Signaturschritt ist bedingt. Die Apple-Variablen entstehen ausschließlich dann, wenn wirklich ein
Zertifikat vorliegt — Tauri prüft nur deren Existenz, ein leeres `APPLE_CERTIFICATE` würde erst nach
zwanzig Minuten Kompilieren beim Import scheitern.

### Signatur-Secrets

| Ziel | Secrets | Ohne sie |
|---|---|---|
| Docker-Image, Windows NSIS, Linux `.deb` und AppImage | keine | gebaut und nutzbar, unsigniert |
| macOS DMG | `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-spezifisch), `APPLE_TEAM_ID` | das DMG wird gebaut, bleibt aber unsigniert, und Gatekeeper blockiert es beim Nutzer |
| Android APK und AAB | `ANDROID_KEYSTORE` (base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | der Job wird übersprungen; ein unsigniertes APK lässt sich nicht installieren |
| iOS IPA | `IOS_CERTIFICATE` (base64 Distribution-`.p12`), `IOS_MOBILE_PROVISION` (base64), dazu `APPLE_CERTIFICATE_PASSWORD` und `APPLE_TEAM_ID` | der Job wird übersprungen; ohne Zertifikat und Profil gibt es kein verteilbares IPA |
| Auto-Update auf dem Desktop | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_UPDATER_PUBKEY`, dazu `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` bei geschütztem Schlüssel | die Installer entstehen wie sonst und tragen gar keinen Updater |

Der iOS-Keychain-Import verwendet `APPLE_CERTIFICATE_PASSWORD` als Passwort für `IOS_CERTIFICATE`,
`ios` kann also offen stehen, während dieses Passwort noch leer ist.

### Auto-Update

`tauri signer generate -w ~/.tauri/videola.key` schreibt einen privaten Schlüssel und gibt seine
öffentliche Hälfte aus. Der private gehört in das Secret `TAURI_SIGNING_PRIVATE_KEY`, der öffentliche
in `TAURI_UPDATER_PUBKEY`; mehr ist nicht einzurichten. Der Endpunkt ist
`https://github.com/<owner>/<repo>/releases/latest/download/latest.json`, den setzt der Workflow aus
`github.repository` ein, und `uploadUpdaterJson` lässt `tauri-action` dieses Manifest neben die
Installer legen.

Weder Endpunkt noch öffentlicher Schlüssel stehen in `tauri.conf.json`. Der Workflow fügt
`plugins.updater` und `bundle.createUpdaterArtifacts` mit `jq` in die Konfiguration ein, und nur wenn
`gate` sagt, dass beide Hälften des Schlüssels da sind. Zwei Gründe, und beide entscheiden zwischen
einem funktionierenden und einem kaputten Release:

- Ein eingecheckter Platzhalter-`pubkey` wäre ein Versprechen ohne Deckung: eine Anwendung, die ein
  Update anbietet, das sie nie prüfen kann.
- `createUpdaterArtifacts: true` **ohne** Signaturschlüssel überspringt das Signieren nicht still,
  sondern bricht das Bundling ab. In der Datei stehen gelassen würde es jedes Release zerlegen, das
  jemand ohne Schlüssel baut.

Ohne die Secrets wird das Plugin gar nicht erst registriert: das Deserialisieren eines fehlenden
`plugins.updater` ist ein harter Fehler, der die Anwendung ihr Fenster nicht öffnen ließe. `main.rs`
sieht darum in der Konfiguration nach, bevor es registriert. Ist der Block da, aber kein Update
erreichbar, behandelt die Anwendung das wie ein Gerät ohne Netz — es sieht niemand einen Fehler.

Das Plugin hängt an den drei Desktop-Zieltripeln statt an der Kiste, und seine Berechtigung liegt in
einer eigenen Capability, beschränkt auf `["linux", "macOS", "windows"]`. `tauri-plugin-updater` hat
keinen Android- und keinen iOS-Build; eine bedingungslose Abhängigkeit oder die Berechtigung in der
Standard-Capability würde die beiden Mobil-Jobs anhalten statt den Desktop-Job — ein Fehler weit weg
von seiner Ursache.

`serde_json` muss die Kiste selbst mitbringen: `generate_context!` bäckt jeden `plugins`-Block als
serde_json-Wert ein. Ohne den Block wird die Abhängigkeit nicht gebraucht, mit ihm bricht der Build
ohne sie ab — also genau in dem Release, das lokal niemand baut.

Eine installierte Anwendung, die eine neuere Version findet, fragt einmal beim Start und installiert
sie, wenn der Nutzer zustimmt. Es gibt kein stilles Update und kein Nachfragen im Hintergrund.

Zwei Dinge muss der Workflow selbst ergänzen, weil die Tauri-Templates sie nicht mitbringen: die
Android-Signatur (`tauri android init` erzeugt keine `signingConfig`, der Workflow hängt einen
Kotlin-DSL-Block an, der Keystore-Pfad und Passwörter aus der Umgebung liest) und die
iOS-Export-Methode (`--export-method app-store-connect`, weil das zum Distribution-Zertifikat passt).

Verpackt wird der Anwendungsrahmen, und die Release-Notes sagen das auch. Ohne mobile
Signaturschlüssel sind vier Artefakte das erwartete Ergebnis, nicht sechs.

## Wie sich welche Ausgabe aktualisiert

**Die Desktop-Ausgaben** fragen beim Start den Endpunkt und bieten an, was sie finden — im eigenen
Dialog des Editors: welche Ausgabe, ein Knopf, und ein Balken, der sagt, wie weit das Laden ist. Oder
er wird unbestimmt, wo der Host Bytes ohne Gesamtgröße meldet: ein Balken, der eine Zahl erfindet,
lügt darüber, wie lange das dauert. Während des Ladens lässt er sich nicht wegklicken — Schließen
ließe das Laden ohne Anzeige weiterlaufen, und die nächste Prüfung fing von vorn an. Ein
fehlgeschlagenes Update sagt, dass die vorhandene Ausgabe weiterläuft, und das stimmt.

Nichts davon passiert ohne Signaturschlüssel. Eine ohne Schlüssel gebaute Ausgabe trägt überhaupt
keinen `plugins.updater`-Block, und ohne Block gibt es nichts zu prüfen — siehe die Tabelle oben.

**Die Browser-Ausgabe** hat einen Service Worker, und dort holt sich ein Editor, der eine Woche in
einem Tab offen war, seine Aktualisierung. Ein neuer Stand installiert einen neuen Worker neben dem
laufenden, und dieser wartende Worker *ist* die neue Ausgabe: der Editor erfährt es, bietet ein
Neuladen an, und der Tausch geschieht beim Neuladen. Unter einer laufenden Sitzung wird nichts
getauscht — ein Worker, der von allein übernimmt, ändert das Bundle unter ungespeicherter Arbeit, und
darum fehlt `clients.claim()` in ihm mit Absicht.

Derselbe Worker macht die Browser-Ausgabe offline-fähig. Zwei Regeln, beide folgen daraus, wie Vite
benennt, was es baut: eine Datei, deren Name einen Inhalts-Hash trägt, kann sich nie ändern und kommt
aus dem Cache; alles andere, das Dokument voran, geht zuerst ins Netz — denn das ist die Anfrage, die
dem Browser sagt, dass es einen neuen Stand gibt.

Gecacht werden **Dateien und nichts sonst**. Eine frühere Fassung cachte jedes GET auf denselben
Ursprung und nahm damit die Steuerungsanfragen des Test-Harness mit — unter einer virtuellen Uhr ist
jede davon eine Pause, und ein Cache-Schreibvorgang an jeder bedeutete, dass der Editor nie zum
Zeichnen kam. Die enge Regel ist ohnehin die richtige: eine API-Antwort aus einem Offline-Cache ist
eine falsche Antwort, überzeugend vorgetragen.

Ein Header entscheidet, ob das alles funktioniert: **`sw.js` darf nicht lange gecacht werden.** Ein
Service Worker, der als unveränderlich ausgeliefert wird, nagelt die Anwendung auf den Stand jenes
Tages fest, und es gibt keinen Weg zurück — der Worker, der einen neueren holen würde, ist der alte.
Der Server sendet `no-cache` für alles außerhalb von `/assets`, und ein Test hält das fest.

## Das Docker-Image

Drei Stufen: `rust:1-bookworm` baut den WASM-Kern, `node:22-bookworm-slim` installiert den Workspace
und baut Web-App und Server-Bündel, `node:22-alpine` behält das Ergebnis. Die letzte Stufe trägt kein
`node_modules` — esbuild bündelt `serve.mjs`, `mcp.mjs` und `cli.mjs` zu reinem ESM ohne offene
Auflösung, ausgeliefert werden also drei JavaScript-Dateien, eine `.wasm` und die gebaute Web-App.

| | |
|---|---|
| Läuft als | `node`, uid 1000, nie als root |
| Port | 7331, ein Prozess |
| Speicher | `/data`, als Volume deklariert und `node` gehörend |
| Health-Check | `node -e "fetch('…/api/health')"` mit dem Token aus der Umgebung |
| Größe | rund 170 MB, davon ist Node das meiste |

### Ein Prozess statt nginx und Node

Das Image davor lieferte statische Dateien mit nginx aus und sonst nichts. Mit der Schnittstelle
dazu blieben zwei Wege: ein zweiter Prozess unter einer Aufsicht, oder der eine Prozess, der ohnehin
HTTP spricht, liefert die Dateien mit. Er liefert sie mit: `VIDEOLA_WEB_ROOT` zeigt auf die gebaute
App, unbekannte Pfade beantwortet `index.html`, weil der Editor eine Single-Page-Anwendung ist, und
`.wasm` bekommt `application/wasm` — den einen Typ, den ein Browser nicht raten will und ohne den der
Editor nie startet. Der angefragte Pfad läuft durch dieselbe Einschlussprüfung wie die
Speicherwurzel, `..` und ein Symlink aus der Web-Wurzel heraus werden also beide abgelehnt.

Statische Dateien gehen **ohne** Token raus. Der Editor hält seine Projekte im Browser des Besuchers
und liest nichts vom Server; alles unter `/api`, und dort liegt die Speicherwurzel, bleibt hinter dem
Bearer-Token.

### Warum der Container ohne Token nicht startet

Ein veröffentlichter Port erreicht nur einen Prozess, der an `0.0.0.0` gebunden ist, und
`configFromEnv` lehnt diese Adresse ohne `VIDEOLA_TOKEN` ab. Das Image setzt darum
`VIDEOLA_HOST=0.0.0.0` und kein Token, und ein `docker run` ohne eines hält sofort mit der Begründung
an. Das ist die beabsichtigte Antwort und kein Versehen: ein Container, der eine erreichbare Adresse
bindet und hofft, verschenkt seine Speicherwurzel an jede Maschine, die ihn sieht.

Der MCP-Server hört auf nichts und liest darum gar keine Bindeadresse — `apiConfigFromEnv` gibt ihm
nur Speicherwurzel, Projektgrenze und Sprache. Sonst hätte das `VIDEOLA_HOST` des Images einen
stdio-Server an einem Socket gehindert, den er nie öffnet.

`serve.mjs` schließt seinen Listener bei `SIGTERM`. Als PID 1 bekommt ein Prozess für dieses Signal
keine Vorgabe, ohne den Handler würde `docker stop` also seine zehn Sekunden abwarten und dann töten.

## Die Kommandozeile

`dist/cli.mjs` — verlinkt `videola` — ist eine dritte Haut über derselben `Api`-Klasse, die HTTP-Routen
und MCP-Werkzeuge benutzen. Sie kann damit nichts, was die beiden nicht können, und überspringt keine
Prüfung, die die beiden machen.

```sh
videola apply [--in <Datei>] [--media <Datei>]... [--commands <Datei>] --out <Datei>
videola describe <Datei>
videola validate <Datei>
videola schema [<Command>]
```

Die Commands-Datei enthält ein Command-Objekt oder ein Array davon, und das Array landet als ein
einziger History-Eintrag: ein Command, den der Kern ablehnt, nimmt den ganzen Stapel mit und
schreibt nichts. Medien-Ids sind `med_` gefolgt vom SHA-256 der Dateibytes — genau das erlaubt einer
Commands-Datei, ein Medium zu nennen, das derselbe Lauf erst einbindet, ohne vorher etwas
nachzuschlagen.

Pfade nimmt sie wie gegeben, ohne die Einschlussprüfung der Speicherwurzel. Diese Prüfung zäunt eine
Schnittstelle ein, die Fremde erreichen; vor einem Terminal steht kein Fremder, und eine CLI, die
`../footage/intro.mp4` ablehnt, wäre falsch statt sicher. An den Schnittstellen, die Fremde wirklich
erreichen, ändert sich nichts.

Einen `export`-Unterbefehl gibt es nicht. Video zu kodieren braucht die Encoder des Browsers, die ein
Kommandozeilenprozess nicht hat; ein `.videola`-Archiv ist das Einzige, was dabei herauskommt.

## Die Doku-Seite

`pages.yml` baut `apps/docs` mit VitePress und liefert es mit `actions/configure-pages`,
`actions/upload-pages-artifact` und `actions/deploy-pages` aus. Ausgelöst wird es von Pushes auf
`main`, die `apps/docs`, den Workflow selbst oder die beiden Workspace-Dateien berühren, ohne die
`pnpm install --frozen-lockfile` scheitert; dazu kommt `workflow_dispatch`.

Der Seitenbau braucht das WASM-Artefakt nicht, weil unter `apps/docs` nichts `@videola/core`
importiert. VitePress ist mit `base: "/videola/"` konfiguriert, was für eine Projekt-Pages-Seite unter
diesem Pfad nötig ist — ohne das löst jede Asset-URL gegen die Wurzel der Nutzerseite auf und
liefert 404.
