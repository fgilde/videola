# Einstieg

## Voraussetzungen

| Werkzeug | Version | Wofür |
|---|---|---|
| Rust | stable, wie in `rust-toolchain.toml` festgelegt | der Kern, der WASM-Build, die Tauri-Hülle |
| `wasm-pack` | ein aktuelles Release | den Kern nach WASM übersetzen |
| Node.js | 22 oder neuer | die Web-App und die Doku-Seite |
| pnpm | 11 oder neuer | den Workspace; die Wurzel-`package.json` pinnt `pnpm@11.20.0` |

Die Tauri-Hülle braucht zusätzlich die WebView und die Toolchain der Plattform. Unter Linux sind das
`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` und `patchelf`; Windows und macOS
nutzen die WebView des Systems.

## Installieren

```sh
pnpm install
pnpm wasm
```

## Warum `pnpm wasm` zuerst läuft

`pnpm wasm` führt `wasm-pack build crates/videola-core-wasm --target web` aus und schreibt das
Ergebnis nach `packages/core/src/wasm`. Dieses Verzeichnis wird erzeugt und ist nicht eingecheckt,
und `packages/core/src/index.ts` importiert daraus. Solange es fehlt, hat `@videola/core` einen
unauflösbaren Import, und `dev`, `typecheck`, `test` und `build` scheitern alle — auch für die
Web-App, weil sie von der Fassade abhängt.

Die CI behandelt das Artefakt genauso: ein eigener `wasm`-Job baut es und lädt es hoch, und jeder
Job, der es braucht, lädt es herunter und prüft vor `pnpm install`, dass
`packages/core/src/wasm/videola_core.js` vorhanden ist.

Wenn `wasm-opt` auf deinem Rechner abstürzt, ruf das `wasm`-Skript aus der `package.json` von Hand
mit angehängtem `--no-opt` auf. Das ändert nur die Größe des Ergebnisses; die CI baut ohne das Flag.

## Die Web-App starten

```sh
pnpm --filter videola-web dev
```

Vite liefert auf `http://localhost:5173` aus. Die App lädt den WASM-Kern und bietet dann Neues
Projekt, Öffnen, Spur hinzufügen, Speichern, Rückgängig und Wiederholen, dazu die Umschalter für
Theme und Sprache.

Die Prüfungen, die das Repository fährt:

```sh
pnpm typecheck
pnpm test
pnpm build
cargo test --workspace
```

## Die Desktop-App starten

```sh
pnpm --filter videola-desktop dev
```

Die Tauri-Konfiguration zeigt mit `beforeDevCommand` auf den Dev-Server der Web-App und mit `devUrl`
auf `http://localhost:5173`, die Hülle umschließt also dasselbe Frontend. Für einen Installer
stattdessen:

```sh
pnpm --filter videola-desktop bundle
```

`beforeBuildCommand` baut zuerst die Web-App, und Tauri bündelt `apps/web/dist`. Konfiguriert sind
die Bundle-Ziele `nsis`, `deb`, `appimage` und `dmg`; ein lokaler Build erzeugt nur die, die deine
Plattform bauen kann, also gib `--bundles` mit, wenn du es genau wissen willst. Verpackt wird die
Web-App, unverändert.

## Das Docker-Image starten

```sh
docker build -f docker/Dockerfile -t videola:dev .
docker run --rm -p 8080:80 videola:dev
```

Das Image entsteht in drei Stufen: eine Rust-Stufe übersetzt den Kern nach WASM, eine Node-Stufe
installiert den Workspace und baut die Web-App, und die letzte Stufe kopiert `apps/web/dist` in
`nginx:alpine`. `docker/nginx.conf` liefert `.wasm` mit dem richtigen MIME-Typ aus, markiert das
inhaltsgehashte JavaScript und CSS als unveränderlich, hält `index.html` uncached und fällt für
unbekannte Pfade auf `index.html` zurück.

Das Image liefert ausschließlich statische Dateien aus. Eine API, ein MCP-Endpunkt und ein
Render-Worker bräuchten `videola-server`, das nicht Teil des Workspace ist.
