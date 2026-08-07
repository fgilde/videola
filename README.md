# Videola

Vollständiger, webbasierter Video-Editor — Multi-Track-Timeline, Effekte, Übergänge, Keyframes,
Audio-Studio, Template-Modus und eine MCP-/REST-Schnittstelle für AI-Agents.

Läuft im Browser, als Desktop-App (Windows/macOS/Linux), als Mobile-App (iOS/Android) und als
selbst gehostetes Docker-Image. Projekte sind `.videola`-Dateien: ein ZIP-Container mit allen
referenzierten Medien und Metadaten, plattformübergreifend austauschbar.

> **Status:** M0 abgeschlossen — Rust-Kern mit Command-Bus und `.videola`-Dateiformat, WASM-Bindings,
> TypeScript-Fassade, zweisprachige Shell mit Dark/Light-Theme, Web-App speichert und öffnet ein
> Projekt wieder. Siehe [`docs/superpowers/specs/2026-08-07-videola-design.md`](docs/superpowers/specs/2026-08-07-videola-design.md).

## Sprachen

Deutsch und Englisch, im UI umschaltbar. Dark- und Light-Theme.

## Entwicklung

`packages/core/src/wasm` ist nicht eingecheckt. Vor dem ersten `pnpm --filter videola-web dev`,
**vor `pnpm test` und vor `pnpm typecheck`/`pnpm build`** einmal `pnpm wasm` laufen lassen —
`packages/core/src/index.ts` reexportiert `wasm-backend`, das dieses Verzeichnis importiert, also
schlagen ohne den Build auch Typecheck (Modul nicht gefunden) und Build fehl, nicht nur
`packages/core/src/roundtrip.test.ts` mit einem rohen `ENOENT`. Stuerzt `wasm-opt.exe` auf dem
eigenen Rechner ab, den Befehl aus `package.json`s `wasm`-Skript direkt mit `--no-opt` aufrufen —
das betrifft nur die Artefaktgroesse, nicht die Funktion. CI baut ohne das Flag.

## Lizenz

GPL-3.0-or-later, siehe [`LICENSE`](LICENSE). Die Desktop- und Docker-Builds binden einen
GPL-FFmpeg-Build ein (siehe Spec, Abschnitt 11.1), was diese Wahl erzwingt.
