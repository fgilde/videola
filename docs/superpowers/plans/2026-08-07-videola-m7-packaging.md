# Videola M7 — Packaging: Implementierungsplan

**Goal:** Ein Release, das auf einen Tag `v*` hin sechs Artefakte erzeugt — Windows-Installer, Linux-AppImage und deb, macOS-DMG, Android-APK/AAB, iOS-IPA und ein Docker-Image auf ghcr.io — und dabei ehrlich meldet, welche Ziele wegen fehlender Signaturschlüssel übersprungen wurden.

**Architecture:** Eine einzige Tauri-2-Anwendung bedient alle fünf nativen Plattformen; ihr Frontend ist das bereits gebaute `apps/web/dist`, sodass es keine zweite UI-Codebasis gibt. Das Docker-Image ist ein Multi-Stage-Build, der WASM und Web-Bundle erzeugt und statisch ausliefert. Der Release-Workflow ist von `ci.yml` getrennt: CI beweist, dass der Baum baut, Release erzeugt verteilbare Artefakte.

**Tech Stack:** Tauri 2 (Rust-Shell, `tauri-cli`), `tauri-apps/tauri-action` für Desktop, `tauri android build` / `tauri ios build` für Mobile, Docker Buildx mit ghcr.io, nginx als statischer Server, GitHub Actions

**Spec:** [`docs/superpowers/specs/2026-08-07-videola-design.md`](../specs/2026-08-07-videola-design.md), Abschnitt 11

## Global Constraints

- Code-Konventionen nach Spec Abschnitt 13: CCD (SRP, SoC, DRY, KISS, YAGNI, Information Hiding, PoLA), IOSP — eine Funktion orchestriert **oder** arbeitet, nie beides.
- Kommentare nur für das *Warum*, niemals für das *Was*. Keine Abschnitts-Banner, keine `Schritt 1:`-Blöcke. Kein Text, der nach AI-Generierung liest. `ponytail:`-Marker sind verfolgte Entscheidungen und bleiben.
- Bezeichner, Typnamen und Code-Kommentare auf Englisch. Alle nutzersichtbaren Texte ausschließlich über die i18n-Kataloge in `packages/ui/src/i18n/catalogs/`.
- Commit-Messages auf Deutsch mit transliterierten Umlauten (`ue`, `ae`, `oe`, `ss`) und englischem Conventional-Commits-Präfix. **Niemals** Co-Authored-By-, "Generated with"- oder sonstige Attribution-Zeilen. Git mit `-c user.email=florian.gilde@cargonerds.com` aufrufen.
- Kein `unwrap()` / `expect()` in Produktiv-Rust. Jede Map ist `BTreeMap`. Zeit ist ganzzahlig in Flicks.
- Werkzeuge: Rust stable, Node 22 oder neuer, pnpm 11 oder neuer.
- Actions werden auf einen Major gepinnt. Stand heute aktuell: `actions/checkout@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `pnpm/setup@v2`, `Swatinem/rust-cache@v2`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/build-push-action@v6`, `softprops/action-gh-release@v2`. `upload-artifact@v7` neben `download-artifact@v8` ist **kein** Versionsfehler.
- `packages/core/src/wasm` ist unversioniertes Build-Ergebnis. Jeder Job, der `packages/core` typechecked oder baut, braucht es vorher.

## Was heute noch nicht dazugehört

**FFmpeg wird nicht eingebunden.** Die Render-Backends aus Spec 7.4 existieren nicht (M2+), also gibt es nichts zu encodieren. Ein GPL-FFmpeg-Sidecar jetzt mitzuschleppen wäre toter Ballast von 80 MB pro Installer und würde die Lizenzlage festschreiben, bevor sie gebraucht wird. Die Shell verpackt die Web-App; sobald natives Rendern kommt, ergänzt M2 den Sidecar.

**Das Docker-Image liefert nur statisch aus.** Spec 11 nennt API, MCP und Render-Worker im Image — `videola-server` existiert nicht. Das Image serviert das Web-Bundle, und das Dockerfile sagt das in einem Kommentar, damit niemand mehr darin sucht.

**Kein Auto-Update.** Tauris Updater braucht ein Signaturschlüsselpaar und einen Endpunkt, der Manifeste ausliefert. Beides ist eigene Arbeit ohne Nutzen, solange es keine zweite Version gibt.

## Signaturschlüssel — was der Projektinhaber anlegen muss

Ohne diese Secrets läuft das Release trotzdem durch, überspringt aber Ziele und schreibt in die Zusammenfassung, welche. Jeder Job ist über `if: ${{ secrets.X != '' }}` bedingt.

| Ziel | Secrets | Ohne sie |
|---|---|---|
| Windows, Linux, Docker | keine | vollständig signaturfrei nutzbar |
| macOS | `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (App-spezifisch), `APPLE_TEAM_ID` | DMG entsteht unsigniert, Gatekeeper blockt es beim Nutzer |
| iOS | dieselbe Zertifikatskette plus `IOS_CERTIFICATE` (Distribution) und `IOS_MOBILE_PROVISION` (base64) | **kein verteilbares IPA möglich**, Job wird übersprungen |
| Android | `ANDROID_KEYSTORE` (base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | nur unsignierte APK, nicht Play-Store-fähig |

## Dateistruktur nach M7

```
videola/
├─ apps/
│  ├─ web/                          unverändert, liefert dist/ als Frontend
│  └─ desktop/
│     ├─ package.json               nur Skripte, ruft tauri-cli
│     └─ src-tauri/
│        ├─ Cargo.toml              eigener Workspace, nicht Teil des Root-Workspace
│        ├─ tauri.conf.json         frontendDist zeigt auf ../../web/dist
│        ├─ build.rs
│        ├─ src/main.rs             Shell, keine Logik
│        ├─ capabilities/default.json
│        └─ icons/                  aus einem Quellbild generiert
├─ docker/
│  ├─ Dockerfile                    multi-stage: wasm, web, nginx
│  ├─ nginx.conf                    SPA-Fallback, WASM-MIME, Cache-Header
│  └─ .dockerignore
├─ .github/workflows/
│  ├─ ci.yml                        unverändert
│  └─ release.yml                   neu
├─ Cargo.toml                       exclude für apps/desktop/src-tauri
└─ README.md                        Abschnitt zu Builds und Secrets
```

**Warum ein eigener Cargo-Workspace für `src-tauri`:** Wäre es Mitglied des Root-Workspace, zöge jedes `cargo test --workspace` die komplette Tauri-Abhängigkeitskette mit — auf diesem Rechner mehrere Minuten für Code, der keine Tests hat. `exclude` hält die Kernentwicklung schnell. Kosten: eine zweite `Cargo.lock`, was für Tauri-Monorepos üblich ist.

---

### Task 1: Tauri-Shell für Desktop

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/capabilities/default.json`
- Modify: `Cargo.toml` (exclude), `.gitignore` (Tauri-Ausgaben), `pnpm-workspace.yaml` falls `apps/*` nicht schon gedeckt ist

**Interfaces:**
- Consumes: `apps/web/dist` als Frontend, `pnpm --filter videola-web build`
- Produces: `pnpm --filter videola-desktop tauri build` erzeugt einen Installer für die laufende Plattform; `apps/desktop/src-tauri` als eigener Cargo-Workspace

- [ ] **Step 1: Tauri-CLI ergänzen und Voraussetzungen prüfen**

```bash
pnpm add -D --filter videola-desktop @tauri-apps/cli
```

Vorher `apps/desktop/package.json` schreiben, sonst schlägt der Filter fehl:

```json
{
  "name": "videola-desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build"
  }
}
```

Der `build`-Skriptname ist bewusst gewählt: `pnpm -r build` im Root baut damit auch den Installer mit. Falls das unerwünscht ist, benenne ihn zu `bundle` um und halte `pnpm -r build` frei — entscheide es und schreib den Grund in den Report.

Auf Windows braucht Tauri die WebView2-Runtime (auf Windows 11 vorhanden) und die MSVC-Buildtools (vorhanden, der Kern kompiliert ja). Prüfe mit `pnpm --filter videola-desktop tauri info` und paste die Ausgabe in den Report.

- [ ] **Step 2: Rust-Seite anlegen**

`apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "videola-desktop"
version = "0.0.0"
edition = "2021"
license = "GPL-3.0-or-later"
publish = false

[workspace]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }

[lints.rust]
unsafe_code = "forbid"
```

Das leere `[workspace]` macht die Crate zu ihrem eigenen Workspace-Wurzelpunkt — das ist der Mechanismus, der sie aus dem Root-Workspace löst.

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/desktop/src-tauri/src/main.rs`:

```rust
// The shell owns no editor logic: everything lives in videola-core behind the
// WASM boundary, so desktop and browser cannot drift apart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
```

`expect` ist hier zulässig und die einzige sinnvolle Reaktion: scheitert der Start des Fensters, gibt es keinen Zustand zu retten. Ergänze `#[allow(clippy::expect_used)]` falls die Lint greift, mit genau dieser Begründung als Kommentar.

- [ ] **Step 3: Root-Workspace anpassen**

In `Cargo.toml` ergänzen:

```toml
[workspace]
members = ["crates/*"]
exclude = ["apps/desktop/src-tauri"]
resolver = "2"
```

- [ ] **Step 4: Konfiguration schreiben**

`apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Videola",
  "version": "0.0.0",
  "identifier": "com.cargonerds.videola",
  "build": {
    "frontendDist": "../../web/dist",
    "beforeBuildCommand": "pnpm --filter videola-web build",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "pnpm --filter videola-web dev"
  },
  "app": {
    "windows": [
      {
        "title": "Videola",
        "width": 1440,
        "height": 900,
        "minWidth": 390,
        "minHeight": 600,
        "resizable": true
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "deb", "appimage", "dmg"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "licenseFile": "../../../LICENSE"
  }
}
```

Zur CSP: `wasm-unsafe-eval` ist nötig, weil der Kern als WASM-Modul instanziiert wird — ohne das startet die App nicht. `blob:` bei `img-src` und `media-src` deckt die Object-URLs, mit denen die Web-App Projektdateien zum Download anbietet. `minWidth: 390` ist bewusst so klein: die Shell soll den Phone-Layout-Modus auch auf dem Desktop erreichbar machen, damit man ihn testen kann.

`apps/desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Die App laeuft vollstaendig im Webview; sie braucht heute keine Tauri-Kommandos.",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 5: Icons erzeugen**

Tauri braucht Icons in mehreren Formaten. `pnpm --filter videola-desktop tauri icon <pfad-zum-quellbild>` erzeugt sie alle aus einem 1024×1024-PNG. Es gibt noch kein Logo im Repo — erzeuge ein schlichtes Platzhalter-PNG (einfarbige Fläche in `--v-accent` `#5B8CFF` mit einem weißen `V`), lauf `tauri icon` darauf, und **vermerke im Report deutlich, dass das ein Platzhalter ist**. Ein Release mit einem generischen Icon ist besser als ein Release, das nicht baut; ein Platzhalter, den niemand als solchen erkennt, ist es nicht.

- [ ] **Step 6: `.gitignore` ergänzen**

Der Eintrag `src-tauri/target` deckt nur den Root. Ergänze:

```
apps/desktop/src-tauri/target
apps/desktop/src-tauri/gen
```

`**/gen/android` und `**/gen/apple` stehen schon drin.

- [ ] **Step 7: Bauen und prüfen**

```bash
pnpm wasm
pnpm --filter videola-web build
pnpm --filter videola-desktop tauri build
```

Erwartung: ein NSIS-Installer unter `apps/desktop/src-tauri/target/release/bundle/nsis/`. Starte die installierte oder die entpackte Anwendung und prüfe, dass die Shell erscheint, Theme und Sprache umschaltbar sind und Speichern eine `.videola` erzeugt. **Paste, was du tatsächlich gesehen hast** — falls du das Fenster nicht öffnen kannst, sag das statt es zu behaupten.

- [ ] **Step 8: Committen**

```bash
git add apps/desktop Cargo.toml .gitignore pnpm-lock.yaml
git commit -m "feat(desktop): Tauri-Shell fuer Windows, Linux und macOS

Die Shell haelt keine Editor-Logik: das Frontend ist apps/web/dist, damit
Desktop und Browser nicht auseinanderlaufen. src-tauri ist ein eigener
Cargo-Workspace, sonst zieht jedes cargo test --workspace die komplette
Tauri-Abhaengigkeitskette mit."
```

---

### Task 2: Docker-Image

**Files:**
- Create: `docker/Dockerfile`, `docker/nginx.conf`, `.dockerignore`
- Modify: `README.md` (Self-Hosting-Abschnitt)

**Interfaces:**
- Produces: ein Image, das das Web-Bundle auf Port 80 ausliefert; baubar mit `docker build -f docker/Dockerfile -t videola:dev .` aus dem Repo-Wurzelverzeichnis

- [ ] **Step 1: `.dockerignore` schreiben**

Ohne das schiebt der Build-Kontext hunderte Megabyte `target/` und `node_modules/` an den Daemon.

```
.git
target
**/target
node_modules
**/node_modules
dist
**/dist
packages/core/src/wasm
.superpowers
docs
apps/desktop/src-tauri/gen
```

`packages/core/src/wasm` wird bewusst ausgeschlossen: das Image baut es selbst, und ein lokal erzeugtes Artefakt darf nicht hineinlecken.

- [ ] **Step 2: Dockerfile schreiben**

```dockerfile
# Das Image liefert heute nur die Web-App aus. API, MCP und Render-Worker aus
# Spec 11 brauchen videola-server, das noch nicht existiert -- wer sie hier
# sucht, sucht vergeblich.

FROM rust:1-bookworm AS wasm
WORKDIR /src
RUN cargo install wasm-pack --locked
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN wasm-pack build crates/videola-core-wasm --target web \
      --out-dir ../../packages/core/src/wasm --out-name videola_core

FROM node:22-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY --from=wasm /src/packages/core/src/wasm ./packages/core/src/wasm
RUN pnpm install --frozen-lockfile
RUN pnpm --filter videola-web build

FROM nginx:1-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /src/apps/web/dist /usr/share/nginx/html
EXPOSE 80
```

Die drei Stufen sind nach Werkzeug getrennt, nicht nach Bequemlichkeit: das Rust-Image braucht kein Node, das Node-Image kein Rust, und das Laufzeit-Image keines von beiden. `--frozen-lockfile` sorgt dafür, dass ein Lockfile, der nicht zu den Manifesten passt, den Build bricht statt still zu aktualisieren.

Achte darauf, dass `apps/desktop` **nicht** kopiert wird: es steht in `pnpm-workspace.yaml`, aber `pnpm install --frozen-lockfile` scheitert, wenn ein Workspace-Mitglied fehlt. Prüfe das beim ersten Build und ergänze `COPY apps/desktop/package.json ./apps/desktop/package.json` falls nötig — und schreib in den Report, was du vorgefunden hast.

- [ ] **Step 3: nginx-Konfiguration schreiben**

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;

  # Der Editor ist eine SPA: jeder unbekannte Pfad muss die index.html liefern,
  # sonst bricht ein Reload auf einer Unterseite.
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Ohne den korrekten MIME-Typ verweigert der Browser die WASM-Instanziierung.
  types {
    application/wasm wasm;
  }

  location ~* \.(js|css|wasm)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }
}
```

Die Cache-Strategie folgt daraus, dass Vite Dateinamen mit Inhalts-Hash versieht: die gehashten Assets sind unveränderlich, die `index.html` darf es nie sein.

- [ ] **Step 4: Bauen und starten**

```bash
docker build -f docker/Dockerfile -t videola:dev .
docker run --rm -p 8080:80 videola:dev
```

Öffne `http://localhost:8080` und prüfe: die Shell erscheint, das WASM-Modul lädt (keine Konsolenfehler), Theme und Sprache schalten um, Speichern lädt eine `.videola` herunter. Prüfe zusätzlich mit `curl -I http://localhost:8080/nicht/vorhanden`, dass ein unbekannter Pfad `200` mit der `index.html` liefert statt `404`. Paste die Ausgaben.

Falls Docker auf diesem Rechner nicht läuft, sag das klar und baue nicht weiter auf der Annahme, dass es tut.

- [ ] **Step 5: README ergänzen**

Ein Abschnitt „Self-Hosting" mit dem `docker run`-Befehl und dem Hinweis, dass das Image heute nur die Web-App ausliefert.

- [ ] **Step 6: Committen**

```bash
git add docker .dockerignore README.md
git commit -m "feat(docker): Image fuer Self-Hosting der Web-App

Drei Stufen nach Werkzeug getrennt, damit das Laufzeit-Image weder Rust noch
Node enthaelt. Gehashte Assets werden unveraenderlich gecacht, die index.html
nie -- Vite vergibt die Hashes, die Strategie folgt daraus."
```

---

### Task 3: Release-Workflow für Docker und Desktop

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `docker/Dockerfile` (Task 2), `apps/desktop/src-tauri` (Task 1)
- Produces: ein GitHub Release auf Tag `v*` mit Desktop-Installern als Assets, und ein Image auf `ghcr.io/fgilde/videola`

- [ ] **Step 1: Workflow-Grundgerüst und Docker-Job**

```yaml
name: release

on:
  push:
    tags: ["v*"]
  workflow_dispatch:

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write
  packages: write

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ghcr.io/fgilde/videola:${{ github.ref_name }}
            ghcr.io/fgilde/videola:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

`cancel-in-progress: false` ist hier richtig, anders als in `ci.yml`: ein halb abgebrochenes Release hinterlässt ein Image ohne passende Installer.

- [ ] **Step 2: Desktop-Job über eine Plattform-Matrix**

```yaml
  desktop:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            target: linux
          - os: windows-latest
            target: windows
          - os: macos-latest
            target: macos
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: |
            .
            apps/desktop/src-tauri
      - uses: pnpm/setup@v2
        with:
          runtime: node@22
          cache: true
      - name: Linux-Systemabhaengigkeiten
        if: matrix.target == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - uses: jetli/wasm-pack-action@v0.4.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm wasm
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        with:
          projectPath: apps/desktop
          tagName: ${{ github.ref_name }}
          releaseName: Videola ${{ github.ref_name }}
          releaseDraft: true
          prerelease: false
```

`fail-fast: false` sorgt dafür, dass ein gescheiterter macOS-Build die fertigen Windows- und Linux-Installer nicht mitnimmt. Die Apple-Variablen sind leer, wenn die Secrets fehlen — `tauri-action` signiert dann nicht und baut trotzdem. `releaseDraft: true` heißt: du siehst das Release, bevor die Welt es sieht.

`rust-cache` bekommt beide Workspaces genannt, weil `src-tauri` ein eigener ist und sonst uncached bleibt.

- [ ] **Step 3: Lokal prüfen, was prüfbar ist**

Den Workflow kann man ohne Tag nicht laufen lassen, aber das YAML muss parsen. Prüfe mit einem Parser, nicht mit dem Auge:

```bash
node -e "const y=require('fs').readFileSync('.github/workflows/release.yml','utf8'); require('js-yaml') " 2>/dev/null || python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML ok')"
```

Falls kein YAML-Parser verfügbar ist, sag das und nutze `gh workflow view` nach dem Push oder `actionlint`, falls installierbar.

- [ ] **Step 4: Committen**

```bash
git add .github/workflows/release.yml
git commit -m "ci: Release-Workflow fuer Docker und Desktop

cancel-in-progress ist hier aus, anders als in der CI: ein abgebrochenes
Release hinterlaesst ein Image ohne passende Installer. fail-fast ebenfalls,
damit ein fehlendes Apple-Zertifikat nicht die fertigen Windows- und
Linux-Installer mitnimmt."
```

---

### Task 4: Android-Build

**Files:**
- Modify: `.github/workflows/release.yml`, `apps/desktop/src-tauri/tauri.conf.json` falls Mobile-Konfiguration nötig
- Create: `apps/desktop/src-tauri/gen/android` entsteht generiert und bleibt unversioniert

**Interfaces:**
- Consumes: die Tauri-Shell aus Task 1
- Produces: ein Job `android`, der eine APK und ein AAB erzeugt und ans Release hängt; übersprungen wenn `ANDROID_KEYSTORE` fehlt

- [ ] **Step 1: Lokal initialisieren und einmal bauen**

```bash
pnpm --filter videola-desktop tauri android init
```

Das braucht das Android SDK und NDK sowie ein JDK. Prüfe zuerst, ob `ANDROID_HOME` gesetzt ist und `sdkmanager` erreichbar ist. **Falls die Android-Toolchain auf diesem Rechner fehlt, installiere sie nicht** — melde es, überspringe den lokalen Bauversuch und schreib den CI-Job trotzdem, klar gekennzeichnet als in CI unerprobt. Eine halbe Stunde SDK-Installation auf einem Entwicklungsrechner ist kein Fortschritt für dieses Task.

Wenn die Toolchain da ist:

```bash
pnpm --filter videola-desktop tauri android build --apk
```

und paste, was entsteht.

- [ ] **Step 2: CI-Job ergänzen**

```yaml
  android:
    if: ${{ secrets.ANDROID_KEYSTORE != '' }}
    runs-on: ubuntu-latest
    needs: desktop
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
      - uses: android-actions/setup-android@v3
      - name: NDK installieren
        run: sdkmanager "ndk;27.0.12077973"
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: |
            .
            apps/desktop/src-tauri
      - uses: pnpm/setup@v2
        with:
          runtime: node@22
          cache: true
      - uses: jetli/wasm-pack-action@v0.4.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm wasm
      - name: Keystore entpacken
        env:
          ANDROID_KEYSTORE: ${{ secrets.ANDROID_KEYSTORE }}
        run: echo "$ANDROID_KEYSTORE" | base64 -d > "$RUNNER_TEMP/release.keystore"
      - name: Signiert bauen
        env:
          ANDROID_HOME: ${{ env.ANDROID_HOME }}
          NDK_HOME: ${{ env.ANDROID_HOME }}/ndk/27.0.12077973
          TAURI_ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/release.keystore
          TAURI_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          TAURI_ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          TAURI_ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          pnpm --filter videola-desktop tauri android init --ci
          pnpm --filter videola-desktop tauri android build --apk --aab
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          draft: true
          files: |
            apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk
            apps/desktop/src-tauri/gen/android/app/build/outputs/bundle/universalRelease/*.aab
```

Die genauen Ausgabepfade und die Namen der Signatur-Umgebungsvariablen können sich zwischen Tauri-Versionen unterscheiden. **Prüfe sie gegen die Tauri-2-Dokumentation der installierten CLI-Version** und korrigiere sie, statt diesen Block blind zu übernehmen — schreib in den Report, was du nachgeschlagen und was du geändert hast.

`needs: desktop` ist bewusst: erst wenn die Desktop-Builds stehen, lohnt der teure Mobile-Job.

- [ ] **Step 3: Committen**

```bash
git add .github/workflows/release.yml apps/desktop
git commit -m "ci: Android-Build im Release

Der Job ist an ANDROID_KEYSTORE gebunden: ohne Keystore entstuende nur eine
unsignierte APK, die kein Nutzer installieren kann -- dann besser sichtbar
ueberspringen als ein unbrauchbares Artefakt anhaengen."
```

---

### Task 5: iOS-Build

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: die Tauri-Shell aus Task 1
- Produces: ein Job `ios`, der ein IPA erzeugt und ans Release hängt; übersprungen wenn `IOS_CERTIFICATE` oder `IOS_MOBILE_PROVISION` fehlt

- [ ] **Step 1: Klarstellen, was lokal nicht prüfbar ist**

iOS lässt sich nur auf macOS mit Xcode bauen. Dieser Rechner läuft Windows. Der Job wird also geschrieben, ohne dass ein einziger Schritt lokal erprobt werden kann — **schreib das genau so in den Report**, statt zu suggerieren, er sei getestet. Der erste echte Lauf ist der erste Test.

- [ ] **Step 2: Job ergänzen**

```yaml
  ios:
    if: ${{ secrets.IOS_CERTIFICATE != '' && secrets.IOS_MOBILE_PROVISION != '' }}
    runs-on: macos-latest
    needs: desktop
    steps:
      - uses: actions/checkout@v7
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-ios,aarch64-apple-ios-sim
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: |
            .
            apps/desktop/src-tauri
      - uses: pnpm/setup@v2
        with:
          runtime: node@22
          cache: true
      - uses: jetli/wasm-pack-action@v0.4.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm wasm
      - name: Signatur einrichten
        env:
          IOS_CERTIFICATE: ${{ secrets.IOS_CERTIFICATE }}
          IOS_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          IOS_MOBILE_PROVISION: ${{ secrets.IOS_MOBILE_PROVISION }}
        run: |
          KEYCHAIN="$RUNNER_TEMP/build.keychain"
          security create-keychain -p "" "$KEYCHAIN"
          security set-keychain-settings -lut 21600 "$KEYCHAIN"
          security unlock-keychain -p "" "$KEYCHAIN"
          echo "$IOS_CERTIFICATE" | base64 -d > "$RUNNER_TEMP/cert.p12"
          security import "$RUNNER_TEMP/cert.p12" -k "$KEYCHAIN" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "" "$KEYCHAIN"
          security list-keychains -d user -s "$KEYCHAIN" login.keychain
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          echo "$IOS_MOBILE_PROVISION" | base64 -d > ~/Library/MobileDevice/Provisioning\ Profiles/videola.mobileprovision
      - name: Bauen
        env:
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          pnpm --filter videola-desktop tauri ios init --ci
          pnpm --filter videola-desktop tauri ios build --export-method app-store-connect
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          draft: true
          files: apps/desktop/src-tauri/gen/apple/build/**/*.ipa
```

`--export-method` muss zum Zertifikatstyp passen: `app-store-connect` für ein Distribution-Zertifikat, `debugging` für Development, `ad-hoc` für eine begrenzte Geräteliste. Bei einem Mismatch scheitert der Export mit einer wenig hilfreichen Xcode-Meldung. Prüfe die verfügbaren Werte gegen die Tauri-2-Dokumentation der installierten CLI und nenne im Report, welchen du gewählt hast und warum.

- [ ] **Step 3: Committen**

```bash
git add .github/workflows/release.yml
git commit -m "ci: iOS-Build im Release

An beide iOS-Secrets gebunden, weil ohne Zertifikat und Provisioning-Profil
gar kein verteilbares IPA entstehen kann. Der Job ist ungetestet: iOS baut
nur auf macOS, der Entwicklungsrechner laeuft Windows."
```

---

### Task 6: Übersprungene Ziele sichtbar machen

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: ein Job `summary`, der nach allen anderen läuft und in die GitHub-Zusammenfassung schreibt, welche Ziele gebaut und welche wegen fehlender Secrets übersprungen wurden

- [ ] **Step 1: Zusammenfassungs-Job ergänzen**

Ein Release, das stillschweigend vier von sechs Zielen überspringt, ist eine Falle. Dieser Job macht es sichtbar.

```yaml
  summary:
    if: always()
    runs-on: ubuntu-latest
    needs: [docker, desktop, android, ios]
    steps:
      - name: Ergebnis zusammenfassen
        run: |
          {
            echo "## Release ${{ github.ref_name }}"
            echo
            echo "| Ziel | Ergebnis |"
            echo "|---|---|"
            echo "| Docker | ${{ needs.docker.result }} |"
            echo "| Desktop (Win/Linux/macOS) | ${{ needs.desktop.result }} |"
            echo "| Android | ${{ needs.android.result }} |"
            echo "| iOS | ${{ needs.ios.result }} |"
            echo
            echo "\`skipped\` bedeutet: das Signatur-Secret fehlt. Siehe README, Abschnitt Release."
          } >> "$GITHUB_STEP_SUMMARY"
```

`if: always()` ist nötig, damit der Job auch läuft, wenn ein Ziel gescheitert ist — sonst fehlt die Zusammenfassung genau dann, wenn man sie braucht.

- [ ] **Step 2: README-Abschnitt „Release" schreiben**

Er muss enthalten: dass ein Tag `v*` das Release auslöst, dass es als Draft entsteht, die vollständige Secret-Tabelle aus der Kopfzeile dieses Plans, und den Satz, dass ohne die jeweiligen Secrets Ziele übersprungen und in der Zusammenfassung als `skipped` gemeldet werden. Nenne auch, dass FFmpeg noch nicht eingebunden ist und das Docker-Image heute nur statisch ausliefert — wer ein Release herunterlädt, soll wissen, was er bekommt.

- [ ] **Step 3: Committen**

```bash
git add .github/workflows/release.yml README.md
git commit -m "ci: uebersprungene Release-Ziele sichtbar machen

Ein Release, das vier von sechs Zielen stillschweigend ueberspringt, ist eine
Falle. Der Zusammenfassungs-Job laeuft mit always(), damit die Uebersicht
gerade dann existiert, wenn ein Ziel gescheitert ist."
```

---

## M7 Definition of Done

```
✓ pnpm --filter videola-desktop tauri build erzeugt einen Installer, der startet
✓ docker build erzeugt ein Image, das die App auf Port 80 ausliefert
✓ Ein unbekannter Pfad im Image liefert die index.html, nicht 404
✓ release.yml parst und deckt alle sechs Ziele ab
✓ Jedes signaturabhaengige Ziel ist an sein Secret gebunden und wird sonst uebersprungen
✓ Die Zusammenfassung nennt fuer jedes Ziel Ergebnis oder skipped
✓ README nennt alle Secrets und was ohne sie passiert
✓ cargo test --workspace bleibt schnell, weil src-tauri ausgeschlossen ist
✓ CI (ci.yml) bleibt gruen und unveraendert
```

## Selbstreview gegen die Spec

| Spec-Abschnitt 11 | Abdeckung |
|---|---|
| Web (Vite, PWA, statisch) | bestand schon; Docker liefert es aus (Task 2) |
| Windows MSI/NSIS | Task 1 + 3, `nsis` als Bundle-Target |
| macOS DMG, signiert/notarisiert | Task 1 + 3; Signatur nur mit Secrets, sonst unsigniert |
| Linux AppImage, deb | Task 1 + 3 |
| iOS / Android | Task 4 + 5 |
| Docker-Image mit ENV und Volume | **teilweise** — Image ja, aber ENV für Port/Token/Storage und ein Volume für Projekte brauchen `videola-server`, das nicht existiert. Ehrlich als offen benannt. |
| Auto-Update | **nicht in M7** — braucht Signaturschlüssel und einen Manifest-Endpunkt, ohne zweite Version nutzlos |
| FFmpeg-Sidecar | **nicht in M7** — ohne Render-Backends toter Ballast; kommt mit M2 |

Offene Punkte, die dieser Plan bewusst nicht schließt und die im Report benannt werden müssen: das Platzhalter-Icon, die in CI unerprobten Mobile-Jobs, und dass „CI grün" für `release.yml` erst der erste getaggte Lauf zeigen kann.
