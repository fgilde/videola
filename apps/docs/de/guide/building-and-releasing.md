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
| `pnpm --filter @videola/engine test:gpu` | 89 Pixelprüfungen gegen ANGLE/SwiftShader: Shader, premultipliziertes Alpha in allen neun Blendmodi, Transformationsmatrix, Kontextverlust, geschlossener `VideoFrame` |
| `pnpm --filter @videola/engine test:export` | 27 Prüfungen: ein echter Export, danach lesen `ffprobe` und `ffmpeg` die Datei zurück — Codec, Auflösung, Bildrate, Bildzahl, Länge, und ein Goertzel-Filter bestätigt den Ton in der Datei |
| `pnpm --filter @videola/ui test:browser` | 29 Prüfungen gegen echtes Layout: 44 px als Geometrie, Trefferflächen, Virtualisierungsbudget über Zoomstufen, Scrollbreite |
| `pnpm --filter videola-web test:browser` | 56 Prüfungen an der **gebauten** Anwendung: eine abgelegte Datei bis ins dekodierte Bild, Wiedergabe, Telefon-Viewport über das Devtools-Protokoll |

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
| `gate` | drei Ausgaben, ob die Signatur-Secrets für macOS, Android und iOS vorhanden sind |
| `docker` | `ghcr.io/fgilde/videola:<tag>` und `:latest` |
| `wasm` | das Artefakt, das die drei App-Jobs verbrauchen |
| `desktop` | Matrix über Ubuntu, Windows und macOS: `.deb` und AppImage, NSIS-Installer, `.dmg` |
| `android` | `.apk` und `.aab`, nur mit hinterlegtem Keystore |
| `ios` | `.ipa` für App Store Connect, nur mit Zertifikat und Provisioning-Profil |
| `summary` | eine Tabelle mit dem Ergebnis jedes Jobs, mit `if: always()` |

`tauri.conf.json` listet alle vier Desktop-Bundler, die Matrix gibt `--bundles` aber trotzdem pro
Plattform mit: der `nsis`-Bundler ist nicht auf Windows beschränkt, aus der Konfiguration heraus
würden Linux und macOS je einen Windows-Installer bauen. `fail-fast: false` verhindert, dass ein
gescheiterter macOS-Build die fertigen Installer für Windows und Linux mitnimmt.

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

Der iOS-Keychain-Import verwendet `APPLE_CERTIFICATE_PASSWORD` als Passwort für `IOS_CERTIFICATE`,
`ios` kann also offen stehen, während dieses Passwort noch leer ist.

Zwei Dinge muss der Workflow selbst ergänzen, weil die Tauri-Templates sie nicht mitbringen: die
Android-Signatur (`tauri android init` erzeugt keine `signingConfig`, der Workflow hängt einen
Kotlin-DSL-Block an, der Keystore-Pfad und Passwörter aus der Umgebung liest) und die
iOS-Export-Methode (`--export-method app-store-connect`, weil das zum Distribution-Zertifikat passt).

Verpackt wird der Anwendungsrahmen, und die Release-Notes sagen das auch. Ohne mobile
Signaturschlüssel sind vier Artefakte das erwartete Ergebnis, nicht sechs.

## Die Doku-Seite

`pages.yml` baut `apps/docs` mit VitePress und liefert es mit `actions/configure-pages`,
`actions/upload-pages-artifact` und `actions/deploy-pages` aus. Ausgelöst wird es von Pushes auf
`main`, die `apps/docs`, den Workflow selbst oder die beiden Workspace-Dateien berühren, ohne die
`pnpm install --frozen-lockfile` scheitert; dazu kommt `workflow_dispatch`.

Der Seitenbau braucht das WASM-Artefakt nicht, weil unter `apps/docs` nichts `@videola/core`
importiert. VitePress ist mit `base: "/videola/"` konfiguriert, was für eine Projekt-Pages-Seite unter
diesem Pfad nötig ist — ohne das löst jede Asset-URL gegen die Wurzel der Nutzerseite auf und
liefert 404.
