# Videola

Vollständiger, webbasierter Video-Editor — Multi-Track-Timeline, Effekte, Übergänge, Keyframes,
Audio-Studio, Template-Modus und eine MCP-/REST-Schnittstelle für AI-Agents.

Läuft im Browser, als Desktop-App (Windows/macOS/Linux), als Mobile-App (iOS/Android) und als
selbst gehostetes Docker-Image. Projekte sind `.videola`-Dateien: ein ZIP-Container mit allen
referenzierten Medien und Metadaten, plattformübergreifend austauschbar.

> **Status:** Design abgeschlossen, Implementierung beginnt.
> Siehe [`docs/superpowers/specs/2026-08-07-videola-design.md`](docs/superpowers/specs/2026-08-07-videola-design.md).

## Sprachen

Deutsch und Englisch, im UI umschaltbar. Dark- und Light-Theme.

## Entwicklung

`packages/core/src/wasm` ist nicht eingecheckt. Vor dem ersten `pnpm --filter videola-web dev`
**und vor dem ersten `pnpm test`** einmal `pnpm wasm` laufen lassen — ohne den Build bricht
`packages/core/src/roundtrip.test.ts` mit einem rohen `ENOENT` ab. Stuerzt `wasm-opt.exe` auf
dem eigenen Rechner ab, den Befehl aus `package.json`s `wasm`-Skript direkt mit `--no-opt`
aufrufen — das betrifft nur die Artefaktgroesse, nicht die Funktion. CI baut ohne das Flag.

## Lizenz

Noch nicht festgelegt. Die Desktop- und Docker-Builds binden einen GPL-FFmpeg-Build ein
(siehe Spec, Abschnitt 11.1).
