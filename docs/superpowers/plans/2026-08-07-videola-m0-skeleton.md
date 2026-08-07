# Videola M0 — Skelett: Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Monorepo, in dem `videola-core` (Rust) das Projektmodell, den Command-Bus, Undo/Redo und das `.videola`-Format vollständig beherrscht, per WASM aus TypeScript nutzbar ist, und eine React-App-Shell mit Theme, Zweisprachigkeit und Layout-Erkennung ein Projekt laden und speichern kann.

**Architecture:** Alle Zustandslogik liegt in Rust (`videola-core`) und wird nach WASM kompiliert; TypeScript ist reiner Konsument mit generierten Typen. Commands mutieren eine Kopie des Projekts; aus dem Vorher/Nachher-Vergleich entstehen JSON-Patch und Inverse-Patch, die den Undo-Stack bilden. Zeit ist ganzzahlig in Flicks, nicht in Sekunden-Floats.

**Tech Stack:** Rust (edition 2021, Cargo-Workspace), serde/serde_json, json-patch, thiserror, zip, sha2, uuid, ts-rs, wasm-bindgen + serde-wasm-bindgen, wasm-pack · TypeScript, React 19, Vite, vitest, pnpm-Workspace · GitHub Actions

**Spec:** [`docs/superpowers/specs/2026-08-07-videola-design.md`](../specs/2026-08-07-videola-design.md)

## Global Constraints

- Code-Konventionen nach Spec Abschnitt 13: CCD (SRP, SoC, DRY, KISS, YAGNI, Information Hiding, PoLA), IOSP — eine Funktion orchestriert **oder** arbeitet, nie beides.
- Kommentare nur für das *Warum*, niemals für das *Was*. Keine Abschnitts-Banner, keine `Schritt 1:`-Blöcke, keine Doc-Kommentare für triviale Zugriffsmethoden.
- Bezeichner, Typnamen und Code-Kommentare auf Englisch. Alle nutzersichtbaren Texte ausschließlich über die i18n-Kataloge — kein String im Code.
- Commit-Messages auf Deutsch mit englischem Conventional-Commits-Präfix. **Niemals** Co-Authored-By-, "Generated with"- oder sonstige Attribution-Zeilen.
- Kein `unwrap()` / `expect()` in Produktivcode. Fehler als `Result<_, CoreError>` mit `thiserror`.
- Eine Datei hat einen Zweck; über ~400 Zeilen ist ein Signal zum Teilen.
- **Alle Maps im Modell sind `BTreeMap`, niemals `HashMap`.** Der Undo-Mechanismus vergleicht serialisiertes JSON; nichtdeterministische Schlüsselreihenfolge würde Phantom-Patches erzeugen.
- **Zeit ist `Time` in Flicks (`705_600_000` pro Sekunde), niemals `f64`-Sekunden.** 705600000 ist durch 24, 25, 30, 48, 50, 60, 90, 100, 120 fps und durch 8/16/22.05/24/32/44.1/48/88.2/96/192 kHz teilbar, also frame- und sample-genau ohne Rundungsdrift. Innerhalb der JS-Sicherheitsgrenze (2^53) reicht das für ~147 Tage Material.
- Dependency-Versionen werden mit `cargo add` bzw. `pnpm add` aufgelöst, nicht von Hand in Manifeste geschrieben.
- Zielversionen: Rust stable, Node 22, pnpm 10. **Installiert in dieser Umgebung:** rustc/cargo 1.97.1, Node 24.13.1, pnpm 11.20.0, MSVC-Linker vorhanden.
- **`cargo` liegt nicht im PATH der Tool-Shells.** Jede Rust-Kommandozeile in PowerShell mit dem Prefix ausführen:
  ```powershell
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"; cargo test -p videola-core
  ```
  In Bash entsprechend `export PATH="$HOME/.cargo/bin:$PATH"` als erstes Kommando derselben Zeile. `pnpm` und `node` sind normal erreichbar.
- Arbeitsbranch ist `m0-skeleton`, nicht `main`.
- React 19 hat den globalen `JSX`-Namespace entfernt. Komponenten geben `ReactElement` zurück (`import type { ReactElement } from "react"`), nicht `JSX.Element`. Wo in diesem Plan `JSX.Element` steht, ist `ReactElement` gemeint — ersetze es beim Schreiben.
- Reihenfolge bei neuen Paketen: **zuerst** `package.json` anlegen, **dann** `pnpm add --filter <name> …`. Ein `--filter` auf ein Paket, das pnpm noch nicht kennt, schlägt fehl.
- `ts-rs` ab Version 10 bietet `TS::export_all()`. Bei einer älteren Version heißt die Methode `export()` und exportiert nur den eigenen Typ — dann alle Typen einzeln aufrufen.

## Ausführungsgruppen

Mehrere Tasks bilden eine Kompiliereinheit: `model/mod.rs` re-exportiert alle Modelldateien, und `command/mod.rs` verweist auf beide Handler-Module. Diese Tasks werden gemeinsam umgesetzt und gemeinsam getestet, jede Gruppe mit eigenem Review:

| Gruppe | Tasks | Grund |
|---|---|---|
| A | 1 | eigenständig — **erledigt**, Commit `2d8da9b` |
| B | 2, 3, 4, 5, 9 | `model/mod.rs` kompiliert erst, wenn alle Modelldateien existieren — **erledigt**, Commits `915b5ce..928baa4`, 57 Tests |
| C | 6, 7, 8 | `command/mod.rs` routet an die Handler — **erledigt**, Commits `8b5a42b..911ecb1`, 111 Tests |
| D | 10 | eigenständig |
| E | 11, 12 | Reader ruft `migrate::load` |
| F–N | 13, 14, 15, 16, 17, 18, 19, 20, 21 | jeweils eigenständig |

Innerhalb einer Gruppe bleibt der TDD-Zyklus pro Task erhalten: Tests zuerst, dann Implementierung. Nur der Commit rutscht ans Gruppenende, wenn ein Task für sich nicht kompilieren kann.

## Dateistruktur nach M0

```
videola/
├─ Cargo.toml                      Cargo-Workspace
├─ rust-toolchain.toml
├─ package.json                    pnpm-Root, Skripte
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .editorconfig
├─ crates/
│  ├─ videola-core/
│  │  ├─ Cargo.toml
│  │  ├─ src/lib.rs                öffentliche Oberfläche
│  │  ├─ src/error.rs              CoreError
│  │  ├─ src/model/ids.rs          typisierte IDs
│  │  ├─ src/model/time.rs         Time (Flicks), Rate
│  │  ├─ src/model/project.rs      Project, ProjectMeta, ProjectSettings
│  │  ├─ src/model/timeline.rs     Timeline, Track, TrackKind, Marker
│  │  ├─ src/model/clip.rs         Clip, ClipSource, Speed, Transform, Fades
│  │  ├─ src/model/param.rs        ParamValue
│  │  ├─ src/model/keyframe.rs     Keyframe, Interp, Auswertung
│  │  ├─ src/model/effect.rs       Effect, Transition
│  │  ├─ src/model/media.rs        MediaAsset, MediaKind
│  │  ├─ src/model/mod.rs
│  │  ├─ src/command/mod.rs        Command, apply, label, Dispatch-Ergebnis
│  │  ├─ src/command/project.rs    Projekt- und Track-Commands
│  │  ├─ src/command/clip.rs       Clip-Commands
│  │  ├─ src/history.rs            History, Entry, Coalescing
│  │  ├─ src/document.rs           Document (Project + History)
│  │  ├─ src/format/mod.rs         MediaStore, SaveOptions, LoadedProject
│  │  ├─ src/format/hash.rs        Content-Adressierung
│  │  ├─ src/format/writer.rs      .videola schreiben
│  │  ├─ src/format/reader.rs      .videola lesen
│  │  ├─ src/format/migrate.rs     schemaVersion-Migration
│  │  └─ tests/                    Integrationstests
│  └─ videola-core-wasm/
│     ├─ Cargo.toml
│     └─ src/lib.rs                WasmDocument
├─ packages/
│  ├─ core/                        @videola/core — WASM-Wrapper + generierte Typen
│  └─ ui/                          @videola/ui — Theme, i18n, Layout, AppShell
├─ apps/web/                       Vite-App
└─ .github/workflows/ci.yml
```

---

### Task 1: Workspace und Kern-Grundtypen

**Status: erledigt** — Commit `2d8da9b`, 7/7 Tests grün, clippy und fmt clean, Review ✅.

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `.editorconfig`
- Create: `crates/videola-core/Cargo.toml`, `crates/videola-core/src/lib.rs`
- Create: `crates/videola-core/src/error.rs`
- Create: `crates/videola-core/src/model/mod.rs`, `crates/videola-core/src/model/ids.rs`, `crates/videola-core/src/model/time.rs`

**Interfaces:**
- Produces: `CoreError` (thiserror-Enum), `Result<T>` Alias, `Time` (Flicks, `from_seconds`, `as_seconds`, `from_frames`, `to_frame`, `ZERO`, `+`/`-`/`Ord`), `Rate` (fps als Rational), `ProjectId`/`TrackId`/`ClipId`/`EffectId`/`MarkerId`/`MediaId` mit `new()` und `as_str()`.

- [ ] **Step 1: Workspace anlegen**

`Cargo.toml`:
```toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.package]
edition = "2021"
license = "GPL-3.0-or-later"
repository = "https://github.com/fgilde/videola"

[workspace.lints.rust]
unsafe_code = "forbid"

[workspace.lints.clippy]
unwrap_used = "deny"
expect_used = "deny"
```

`rust-toolchain.toml`:
```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
```

`.editorconfig`:
```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.rs]
indent_size = 4
```

- [ ] **Step 2: Crate anlegen und Dependencies auflösen**

```bash
mkdir -p crates/videola-core/src/model
cargo new --lib crates/videola-core --name videola-core --vcs none
cd crates/videola-core
cargo add serde --features derive
cargo add serde_json thiserror
cargo add uuid --features v4,js
cargo add ts-rs
cd ../..
```

In `crates/videola-core/Cargo.toml` ergänzen:
```toml
[lints]
workspace = true
```

- [ ] **Step 3: Failing tests für Time und IDs schreiben**

`crates/videola-core/src/model/time.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_is_exact_for_common_rates() {
        for fps in [24u32, 25, 30, 48, 50, 60, 90, 100, 120] {
            let rate = Rate::from_fps(fps);
            for frame in [0i64, 1, 7, 1000, 123_456] {
                let t = Time::from_frames(frame, rate);
                assert_eq!(t.to_frame(rate), frame, "fps={fps} frame={frame}");
            }
        }
    }

    #[test]
    fn ntsc_rate_stays_exact() {
        let rate = Rate::new(30_000, 1001);
        let t = Time::from_frames(90_000, rate);
        assert_eq!(t.to_frame(rate), 90_000);
    }

    #[test]
    fn seconds_conversion_is_lossless_for_whole_seconds() {
        assert_eq!(Time::from_seconds(2.5).as_seconds(), 2.5);
        assert_eq!(Time::from_seconds(0.0), Time::ZERO);
    }

    #[test]
    fn serialises_as_plain_integer() {
        let json = serde_json::to_string(&Time::from_seconds(1.0)).unwrap();
        assert_eq!(json, "705600000");
    }

    #[test]
    fn arithmetic_and_ordering_work() {
        let a = Time::from_seconds(1.0);
        let b = Time::from_seconds(0.25);
        assert_eq!((a + b).as_seconds(), 1.25);
        assert_eq!((a - b).as_seconds(), 0.75);
        assert!(b < a);
    }
}
```

`crates/videola-core/src/model/ids.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_ids_are_unique_and_prefixed() {
        let a = TrackId::new();
        let b = TrackId::new();
        assert_ne!(a, b);
        assert!(a.as_str().starts_with("trk_"));
    }

    #[test]
    fn ids_serialise_as_bare_strings() {
        let id = ClipId::from("clp_abc".to_string());
        assert_eq!(serde_json::to_string(&id).unwrap(), "\"clp_abc\"");
    }
}
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core`
Expected: FAIL — `cannot find type Time`, `cannot find type TrackId`

- [ ] **Step 5: `time.rs` implementieren**

Oberhalb des `mod tests`-Blocks:
```rust
use std::ops::{Add, Sub};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const FLICKS_PER_SECOND: i64 = 705_600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct Time(i64);

impl Time {
    pub const ZERO: Time = Time(0);

    pub const fn from_flicks(flicks: i64) -> Self {
        Self(flicks)
    }

    pub const fn as_flicks(self) -> i64 {
        self.0
    }

    pub fn from_seconds(seconds: f64) -> Self {
        Self((seconds * FLICKS_PER_SECOND as f64).round() as i64)
    }

    pub fn as_seconds(self) -> f64 {
        self.0 as f64 / FLICKS_PER_SECOND as f64
    }

    pub fn from_frames(frame: i64, rate: Rate) -> Self {
        Self(frame * FLICKS_PER_SECOND * rate.denominator as i64 / rate.numerator as i64)
    }

    pub fn to_frame(self, rate: Rate) -> i64 {
        self.0 * rate.numerator as i64 / (FLICKS_PER_SECOND * rate.denominator as i64)
    }

    pub fn max(self, other: Time) -> Time {
        if self.0 >= other.0 { self } else { other }
    }

    pub fn clamp_min_zero(self) -> Time {
        Time(self.0.max(0))
    }
}

impl Add for Time {
    type Output = Time;
    fn add(self, rhs: Time) -> Time {
        Time(self.0 + rhs.0)
    }
}

impl Sub for Time {
    type Output = Time;
    fn sub(self, rhs: Time) -> Time {
        Time(self.0 - rhs.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Rate {
    pub numerator: u32,
    pub denominator: u32,
}

impl Rate {
    pub const fn new(numerator: u32, denominator: u32) -> Self {
        Self { numerator, denominator }
    }

    pub const fn from_fps(fps: u32) -> Self {
        Self::new(fps, 1)
    }

    pub fn as_f64(self) -> f64 {
        self.numerator as f64 / self.denominator as f64
    }
}

impl Default for Rate {
    fn default() -> Self {
        Self::from_fps(30)
    }
}
```

- [ ] **Step 6: `ids.rs` implementieren**

Oberhalb des `mod tests`-Blocks:
```rust
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident, $prefix:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
        #[serde(transparent)]
        #[ts(type = "string")]
        pub struct $name(String);

        impl $name {
            pub fn new() -> Self {
                Self(format!("{}_{}", $prefix, Uuid::new_v4().simple()))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(ProjectId, "prj");
id_type!(TrackId, "trk");
id_type!(ClipId, "clp");
id_type!(EffectId, "eff");
id_type!(MarkerId, "mrk");
```

`MediaId` fehlt hier absichtlich — sie ist ein Inhalts-Hash, keine Zufallszahl, und entsteht in Task 9.

- [ ] **Step 7: `error.rs` implementieren**

```rust
use thiserror::Error;

use crate::model::{ClipId, TrackId};

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("track not found: {0}")]
    TrackNotFound(TrackId),

    #[error("clip not found: {0}")]
    ClipNotFound(ClipId),

    #[error("index {index} out of range (len {len})")]
    IndexOutOfRange { index: usize, len: usize },

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("nothing to undo")]
    NothingToUndo,

    #[error("nothing to redo")]
    NothingToRedo,

    #[error("serialisation failed: {0}")]
    Serde(#[from] serde_json::Error),
}
```

- [ ] **Step 8: Module verdrahten**

`crates/videola-core/src/model/mod.rs`:
```rust
pub mod ids;
pub mod time;

pub use ids::{ClipId, EffectId, MarkerId, ProjectId, TrackId};
pub use time::{Rate, Time, FLICKS_PER_SECOND};
```

`crates/videola-core/src/lib.rs`:
```rust
pub mod error;
pub mod model;

pub use error::{CoreError, Result};
```

- [ ] **Step 9: Tests laufen lassen**

Run: `cargo test -p videola-core && cargo clippy -p videola-core -- -D warnings && cargo fmt --check`
Expected: alle Tests PASS, keine Clippy-Warnungen

- [ ] **Step 10: Committen**

```bash
git add Cargo.toml rust-toolchain.toml .editorconfig crates/videola-core
git commit -m "feat(core): Workspace und Grundtypen fuer Zeit und IDs

Zeit als ganzzahlige Flicks (705600000/s) statt Sekunden-Floats, damit
Frame- und Sample-Rechnung ohne Rundungsdrift bleibt."
```

---

### Task 2: Projekt-, Timeline- und Track-Modell

**Files:**
- Create: `crates/videola-core/src/model/project.rs`, `crates/videola-core/src/model/timeline.rs`
- Modify: `crates/videola-core/src/model/mod.rs`

**Interfaces:**
- Consumes: `Time`, `Rate`, `ProjectId`, `TrackId`, `MarkerId` (Task 1)
- Produces: `Project { schema_version, meta, settings, timeline, markers, master, extra }`, `ProjectMeta`, `ProjectSettings`, `Timeline { tracks }`, `Track { id, kind, name, color_hex, height, locked, hidden, muted, solo, volume, pan, clips, effects, extra }`, `TrackKind`, `Marker`, `MasterSettings`. `Project::default()`, `Project::track(&TrackId)`, `Project::track_mut(&TrackId)`, `Project::track_index(&TrackId)`, `Project::normalize()`, `Timeline::duration()`.

- [ ] **Step 1: Failing tests schreiben**

`crates/videola-core/src/model/project.rs`, am Dateiende:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_project_has_no_tracks_and_sane_settings() {
        let p = Project::default();
        assert_eq!(p.schema_version, SCHEMA_VERSION);
        assert!(p.timeline.tracks.is_empty());
        assert_eq!(p.settings.width, 1920);
        assert_eq!(p.settings.height, 1080);
        assert_eq!(p.settings.fps, Rate::from_fps(30));
        assert_eq!(p.settings.sample_rate, 48_000);
    }

    #[test]
    fn json_roundtrip_preserves_everything() {
        let mut p = Project::default();
        p.timeline.tracks.push(Track::new(TrackKind::Video, "V1".into()));
        let json = serde_json::to_string(&p).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let json = r#"{
            "schemaVersion": 1,
            "meta": {"id":"prj_1","title":"T","tags":[]},
            "settings": {"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1},
                         "sampleRate":48000,"colorSpace":"srgb","background":"#000000"},
            "timeline": {"tracks":[]},
            "markers": [],
            "master": {"volume":1.0,"effects":[]},
            "futureField": {"keep":"me"}
        }"#;
        let p: Project = serde_json::from_str(json).unwrap();
        let out = serde_json::to_value(&p).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }

    #[test]
    fn track_lookup_reports_missing_ids() {
        let p = Project::default();
        let missing = TrackId::from("trk_nope".to_string());
        assert!(p.track(&missing).is_none());
        assert!(p.track_index(&missing).is_none());
    }
}
```

`crates/videola-core/src/model/timeline.rs`, am Dateiende:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_timeline_has_zero_duration() {
        assert_eq!(Timeline::default().duration(), Time::ZERO);
    }

    #[test]
    fn new_track_is_audible_and_unlocked() {
        let t = Track::new(TrackKind::Audio, "A1".into());
        assert!(!t.muted);
        assert!(!t.locked);
        assert_eq!(t.volume, 1.0);
        assert_eq!(t.pan, 0.0);
    }

    #[test]
    fn track_kind_serialises_in_kebab_case() {
        let json = serde_json::to_string(&TrackKind::Adjustment).unwrap();
        assert_eq!(json, "\"adjustment\"");
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core`
Expected: FAIL — `cannot find type Project`, `cannot find type Timeline`

- [ ] **Step 3: `timeline.rs` implementieren**

```rust
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::Clip;
use super::effect::Effect;
use super::{MarkerId, Time, TrackId};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub tracks: Vec<Track>,
}

impl Timeline {
    pub fn duration(&self) -> Time {
        self.tracks
            .iter()
            .flat_map(|track| track.clips.iter())
            .map(Clip::end)
            .fold(Time::ZERO, Time::max)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TrackKind {
    Video,
    Audio,
    Text,
    Overlay,
    Adjustment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: TrackId,
    pub kind: TrackKind,
    pub name: String,
    pub color_hex: String,
    pub height: u32,
    pub locked: bool,
    pub hidden: bool,
    pub muted: bool,
    pub solo: bool,
    pub volume: f32,
    pub pan: f32,
    pub clips: Vec<Clip>,
    pub effects: Vec<Effect>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Track {
    pub fn new(kind: TrackKind, name: String) -> Self {
        Self {
            id: TrackId::new(),
            kind,
            name,
            color_hex: default_color(kind).to_string(),
            height: 72,
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            volume: 1.0,
            pan: 0.0,
            clips: Vec::new(),
            effects: Vec::new(),
            extra: Map::new(),
        }
    }

    pub fn clip_index(&self, id: &crate::model::ClipId) -> Option<usize> {
        self.clips.iter().position(|clip| &clip.id == id)
    }
}

fn default_color(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "#5B8CFF",
        TrackKind::Audio => "#2EA043",
        TrackKind::Text => "#F0A030",
        TrackKind::Overlay => "#B06BD6",
        TrackKind::Adjustment => "#6BD6FF",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: MarkerId,
    pub time: Time,
    pub label: String,
    pub color_hex: String,
}
```

- [ ] **Step 4: `project.rs` implementieren**

```rust
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::Effect;
use super::media::MediaAsset;
use super::timeline::{Marker, Timeline, Track};
use super::{ProjectId, Rate, TrackId};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub meta: ProjectMeta,
    pub settings: ProjectSettings,
    #[serde(default)]
    pub library: Vec<MediaAsset>,
    pub timeline: Timeline,
    #[serde(default)]
    pub markers: Vec<Marker>,
    pub master: MasterSettings,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            meta: ProjectMeta::default(),
            settings: ProjectSettings::default(),
            library: Vec::new(),
            timeline: Timeline::default(),
            markers: Vec::new(),
            master: MasterSettings::default(),
            extra: Map::new(),
        }
    }
}

impl Project {
    pub fn track_index(&self, id: &TrackId) -> Option<usize> {
        self.timeline.tracks.iter().position(|track| &track.id == id)
    }

    pub fn track(&self, id: &TrackId) -> Option<&Track> {
        self.timeline.tracks.iter().find(|track| &track.id == id)
    }

    pub fn track_mut(&mut self, id: &TrackId) -> Option<&mut Track> {
        self.timeline.tracks.iter_mut().find(|track| &track.id == id)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

impl Default for ProjectMeta {
    fn default() -> Self {
        Self {
            id: ProjectId::new(),
            title: String::new(),
            description: None,
            author: None,
            tags: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub width: u32,
    pub height: u32,
    pub fps: Rate,
    pub sample_rate: u32,
    pub color_space: String,
    pub background: String,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: Rate::from_fps(30),
            sample_rate: 48_000,
            color_space: "srgb".to_string(),
            background: "#000000".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MasterSettings {
    pub volume: f32,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl Default for MasterSettings {
    fn default() -> Self {
        Self { volume: 1.0, effects: Vec::new() }
    }
}
```

`ProjectMeta` trägt bewusst keine Zeitstempel: `created`/`modified` gehören ins `videola.json`-Manifest (Task 10), weil sie beim Speichern gesetzt werden und sonst jeden Undo-Diff verschmutzen würden.

- [ ] **Step 5: Module verdrahten**

`crates/videola-core/src/model/mod.rs` ersetzen:
```rust
pub mod clip;
pub mod effect;
pub mod ids;
pub mod keyframe;
pub mod media;
pub mod param;
pub mod project;
pub mod time;
pub mod timeline;

pub use clip::{Clip, ClipSource, Fades, Speed, Transform};
pub use effect::{Effect, Transition};
pub use ids::{ClipId, EffectId, MarkerId, ProjectId, TrackId};
pub use keyframe::{Interp, Keyframe};
pub use media::{MediaAsset, MediaId, MediaKind};
pub use param::ParamValue;
pub use project::{MasterSettings, Project, ProjectMeta, ProjectSettings, SCHEMA_VERSION};
pub use time::{Rate, Time, FLICKS_PER_SECOND};
pub use timeline::{Marker, Timeline, Track, TrackKind};
```

Die Module `clip`, `effect`, `keyframe`, `media`, `param` entstehen in Tasks 3–5 und 9. Damit dieser Task kompiliert, legst du sie jetzt als leere Dateien an und füllst sie in den folgenden Tasks — die Re-Exports oben bleiben dann unverändert.

- [ ] **Step 6: Tests laufen lassen**

Run: `cargo test -p videola-core`
Expected: PASS, sobald Tasks 3–5 und 9 die leeren Module gefüllt haben. Arbeite Tasks 3, 4, 5 und 9 direkt im Anschluss ab, bevor du hier committest.

- [ ] **Step 7: Committen (nach Tasks 3, 4, 5 und 9)**

```bash
git add crates/videola-core/src/model
git commit -m "feat(core): Projekt-, Timeline- und Track-Modell"
```

---

### Task 3: Clip-Modell

**Files:**
- Create: `crates/videola-core/src/model/clip.rs`

**Interfaces:**
- Consumes: `Time`, `Rate`, `ClipId`, `MediaId`, `Effect`, `Transition`, `Keyframe`
- Produces: `Clip { id, label, group_id, source, start, duration, in_point, speed, transform, blend, fades, volume, pan, effects, transition_in, transition_out, keyframes, extra }`, `ClipSource` (Media/Generator/Compound), `Generator`, `Speed`, `Transform`, `Fades`, `BlendMode`. `Clip::end()`, `Clip::contains(Time)`, `Clip::source_time_at(Time)`, `Clip::consumed_source()`, `Clip::out_point()`, `Clip::new_media(MediaId, Time, Time)`, `Clip::new_generator(Generator, Time, Time)`.

**Korrektur nach Review:** `out_point` ist **kein Feld**, sondern die abgeleitete Methode `out_point() = in_point + consumed_source()`. Als Feld war es redundanter Zustand, den `source_time_at` gar nicht liest — bei einer Geschwindigkeit ungleich 1.0 laufen Feld und tatsächlich verbrauchter Quellbereich nach dem ersten Trim auseinander, und der Renderer folgt dem einen, das Feld behauptet das andere. Abgeleitet kann es nicht driften.

- [ ] **Step 1: Failing tests schreiben**

Am Dateiende von `clip.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MediaId;

    fn media_clip(start_s: f64, dur_s: f64) -> Clip {
        Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::from_seconds(start_s),
            Time::from_seconds(dur_s),
        )
    }

    #[test]
    fn end_is_start_plus_duration() {
        let clip = media_clip(2.0, 3.0);
        assert_eq!(clip.end().as_seconds(), 5.0);
    }

    #[test]
    fn contains_is_start_inclusive_and_end_exclusive() {
        let clip = media_clip(2.0, 3.0);
        assert!(clip.contains(Time::from_seconds(2.0)));
        assert!(clip.contains(Time::from_seconds(4.999)));
        assert!(!clip.contains(Time::from_seconds(5.0)));
        assert!(!clip.contains(Time::from_seconds(1.999)));
    }

    #[test]
    fn source_time_follows_in_point_at_normal_speed() {
        let mut clip = media_clip(10.0, 4.0);
        clip.in_point = Time::from_seconds(7.0);
        let at = clip.source_time_at(Time::from_seconds(11.0)).unwrap();
        assert_eq!(at.as_seconds(), 8.0);
    }

    #[test]
    fn source_time_reads_backwards_when_reversed() {
        let mut clip = media_clip(0.0, 4.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.reverse = true;
        assert_eq!(clip.source_time_at(Time::from_seconds(0.0)).unwrap().as_seconds(), 14.0);
        assert_eq!(clip.source_time_at(Time::from_seconds(3.0)).unwrap().as_seconds(), 11.0);
    }

    #[test]
    fn source_time_scales_with_rate() {
        let mut clip = media_clip(0.0, 2.0);
        clip.speed.rate = 2.0;
        assert_eq!(clip.source_time_at(Time::from_seconds(1.0)).unwrap().as_seconds(), 2.0);
    }

    #[test]
    fn source_time_outside_the_clip_is_none() {
        let clip = media_clip(2.0, 1.0);
        assert!(clip.source_time_at(Time::from_seconds(5.0)).is_none());
    }

    #[test]
    fn generator_clips_need_no_media() {
        let clip = Clip::new_generator(
            Generator::Solid { color: "#ff0000".into() },
            Time::ZERO,
            Time::from_seconds(3.0),
        );
        assert!(matches!(clip.source, ClipSource::Generator { .. }));
        assert_eq!(clip.end().as_seconds(), 3.0);
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core clip::`
Expected: FAIL — `cannot find type Clip`

- [ ] **Step 3: Implementieren**

```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::{Effect, Transition};
use super::keyframe::Keyframe;
use super::{ClipId, MediaId, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: ClipId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub source: ClipSource,
    pub start: Time,
    pub duration: Time,
    pub in_point: Time,
    pub speed: Speed,
    pub transform: Transform,
    pub blend: BlendMode,
    pub fades: Fades,
    pub volume: f32,
    pub pan: f32,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_in: Option<Transition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_out: Option<Transition>,
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Clip {
    pub fn new_media(media: MediaId, start: Time, duration: Time) -> Self {
        Self::new(ClipSource::Media { media }, start, duration)
    }

    pub fn new_generator(generator: Generator, start: Time, duration: Time) -> Self {
        Self::new(ClipSource::Generator { generator }, start, duration)
    }

    fn new(source: ClipSource, start: Time, duration: Time) -> Self {
        Self {
            id: ClipId::new(),
            label: None,
            group_id: None,
            source,
            start,
            duration,
            in_point: Time::ZERO,
            speed: Speed::default(),
            transform: Transform::default(),
            blend: BlendMode::Normal,
            fades: Fades::default(),
            volume: 1.0,
            pan: 0.0,
            effects: Vec::new(),
            transition_in: None,
            transition_out: None,
            keyframes: BTreeMap::new(),
            extra: Map::new(),
        }
    }

    pub fn end(&self) -> Time {
        self.start + self.duration
    }

    pub fn contains(&self, t: Time) -> bool {
        t >= self.start && t < self.end()
    }

    pub fn source_time_at(&self, t: Time) -> Option<Time> {
        if !self.contains(t) {
            return None;
        }
        let offset = Time::from_seconds((t - self.start).as_seconds() * self.speed.rate as f64);
        Some(if self.speed.reverse {
            self.in_point + self.consumed_source() - offset
        } else {
            self.in_point + offset
        })
    }

    pub fn consumed_source(&self) -> Time {
        Time::from_flicks(
            (self.duration.as_flicks() as f64 * self.speed.rate as f64).round() as i64,
        )
    }

    pub fn out_point(&self) -> Time {
        self.in_point + self.consumed_source()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClipSource {
    Media { media: MediaId },
    Generator { generator: Generator },
    Compound { timeline: Box<super::timeline::Timeline> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Generator {
    Text { content: String, style: BTreeMap<String, Value> },
    Solid { color: String },
    Shape { shape: String, color: String },
    Gradient { from: String, to: String, angle: f32 },
    Countdown { from_seconds: u32 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Speed {
    pub rate: f32,
    pub reverse: bool,
    pub preserve_pitch: bool,
}

impl Default for Speed {
    fn default() -> Self {
        Self { rate: 1.0, reverse: false, preserve_pitch: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
    pub opacity: f32,
    pub crop: Crop,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
            opacity: 1.0,
            crop: Crop::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Add,
    Subtract,
    Difference,
    Lighten,
    Darken,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Fades {
    pub in_duration: Time,
    pub out_duration: Time,
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test -p videola-core clip::`
Expected: PASS

- [ ] **Step 5: Committen**

```bash
git add crates/videola-core/src/model/clip.rs
git commit -m "feat(core): Clip-Modell mit Speed, Transform und Rueckwaertslauf

Rueckwaertslauf ist ein Flag am Clip, kein eigener Clip-Typ: source_time_at
liest den Quellzeitpunkt vom Ende des verbrauchten Bereichs zurueck."
```

---

### Task 4: Parameterwerte, Keyframes und deren Auswertung

**Files:**
- Create: `crates/videola-core/src/model/param.rs`, `crates/videola-core/src/model/keyframe.rs`

**Interfaces:**
- Consumes: `Time`
- Produces: `ParamValue` (Float/Int/Bool/Color/Vec2/Choice), `ParamValue::lerp(&self, &Self, f32) -> Option<ParamValue>`, `Keyframe { time, value, interp, handle_in, handle_out }`, `Interp` (Linear/Hold/Ease/Bezier), `evaluate(&[Keyframe], Time) -> Option<ParamValue>`, `sort_track(&mut Vec<Keyframe>)`.

**Ergänzung nach Review:** `evaluate` sucht binär und setzt eine nach `time` sortierte Spur voraus. Keyframe-Spuren kommen aus deserialisiertem Projekt-JSON, also von einer Vertrauensgrenze — eine unsortierte Spur liefert sonst lautlos falsche Werte für jeden Frame. Deshalb `sort_track` plus `Project::normalize()` (Task 2), das beim Laden aufgerufen wird (Task 11).

- [ ] **Step 1: Failing tests schreiben**

`param.rs`, am Dateiende:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_interpolate() {
        let a = ParamValue::Float(0.0);
        let b = ParamValue::Float(10.0);
        assert_eq!(a.lerp(&b, 0.25), Some(ParamValue::Float(2.5)));
    }

    #[test]
    fn colors_interpolate_per_channel() {
        let a = ParamValue::Color([0.0, 0.0, 0.0, 1.0]);
        let b = ParamValue::Color([1.0, 0.5, 0.0, 1.0]);
        assert_eq!(a.lerp(&b, 0.5), Some(ParamValue::Color([0.5, 0.25, 0.0, 1.0])));
    }

    #[test]
    fn discrete_values_do_not_interpolate() {
        let a = ParamValue::Bool(false);
        let b = ParamValue::Bool(true);
        assert_eq!(a.lerp(&b, 0.5), None);

        let c = ParamValue::Choice("linear".into());
        let d = ParamValue::Choice("radial".into());
        assert_eq!(c.lerp(&d, 0.5), None);
    }

    #[test]
    fn mismatched_kinds_do_not_interpolate() {
        assert_eq!(ParamValue::Float(1.0).lerp(&ParamValue::Int(2), 0.5), None);
    }
}
```

`keyframe.rs`, am Dateiende:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ParamValue;

    fn kf(seconds: f64, value: f32, interp: Interp) -> Keyframe {
        Keyframe {
            time: Time::from_seconds(seconds),
            value: ParamValue::Float(value),
            interp,
            handle_in: None,
            handle_out: None,
        }
    }

    #[test]
    fn empty_track_evaluates_to_nothing() {
        assert_eq!(evaluate(&[], Time::ZERO), None);
    }

    #[test]
    fn before_first_and_after_last_are_clamped() {
        let track = vec![kf(1.0, 10.0, Interp::Linear), kf(3.0, 30.0, Interp::Linear)];
        assert_eq!(evaluate(&track, Time::ZERO), Some(ParamValue::Float(10.0)));
        assert_eq!(evaluate(&track, Time::from_seconds(9.0)), Some(ParamValue::Float(30.0)));
    }

    #[test]
    fn linear_interpolates_between_neighbours() {
        let track = vec![kf(0.0, 0.0, Interp::Linear), kf(2.0, 100.0, Interp::Linear)];
        assert_eq!(evaluate(&track, Time::from_seconds(1.0)), Some(ParamValue::Float(50.0)));
    }

    #[test]
    fn hold_keeps_the_left_value_until_the_next_key() {
        let track = vec![kf(0.0, 0.0, Interp::Hold), kf(2.0, 100.0, Interp::Linear)];
        assert_eq!(evaluate(&track, Time::from_seconds(1.9)), Some(ParamValue::Float(0.0)));
        assert_eq!(evaluate(&track, Time::from_seconds(2.0)), Some(ParamValue::Float(100.0)));
    }

    #[test]
    fn ease_is_slower_at_the_start_than_linear() {
        let track = vec![kf(0.0, 0.0, Interp::Ease), kf(2.0, 100.0, Interp::Linear)];
        let Some(ParamValue::Float(v)) = evaluate(&track, Time::from_seconds(0.5)) else {
            panic!("expected a float");
        };
        assert!(v < 25.0, "ease should lag linear at t=0.25, got {v}");
    }

    #[test]
    fn bezier_hits_both_endpoints_exactly() {
        let mut a = kf(0.0, 0.0, Interp::Bezier);
        a.handle_out = Some([0.42, 0.0]);
        let mut b = kf(2.0, 100.0, Interp::Linear);
        b.handle_in = Some([0.58, 1.0]);
        let track = vec![a, b];
        assert_eq!(evaluate(&track, Time::ZERO), Some(ParamValue::Float(0.0)));
        assert_eq!(evaluate(&track, Time::from_seconds(2.0)), Some(ParamValue::Float(100.0)));
    }

    #[test]
    fn discrete_values_hold_even_on_linear_keys() {
        let track = vec![
            Keyframe {
                time: Time::ZERO,
                value: ParamValue::Bool(false),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
            Keyframe {
                time: Time::from_seconds(2.0),
                value: ParamValue::Bool(true),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
        ];
        assert_eq!(evaluate(&track, Time::from_seconds(1.0)), Some(ParamValue::Bool(false)));
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core -- param:: keyframe::`
Expected: FAIL — `cannot find type ParamValue`

- [ ] **Step 3: `param.rs` implementieren**

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ParamValue {
    Float(f32),
    Int(i64),
    Bool(bool),
    Color([f32; 4]),
    Vec2([f32; 2]),
    Choice(String),
}

impl ParamValue {
    pub fn lerp(&self, other: &Self, t: f32) -> Option<Self> {
        match (self, other) {
            (Self::Float(a), Self::Float(b)) => Some(Self::Float(mix(*a, *b, t))),
            (Self::Vec2(a), Self::Vec2(b)) => Some(Self::Vec2([
                mix(a[0], b[0], t),
                mix(a[1], b[1], t),
            ])),
            (Self::Color(a), Self::Color(b)) => Some(Self::Color([
                mix(a[0], b[0], t),
                mix(a[1], b[1], t),
                mix(a[2], b[2], t),
                mix(a[3], b[3], t),
            ])),
            _ => None,
        }
    }
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
```

`Int` interpoliert absichtlich nicht: eine halbe Wiederholungszahl oder ein halber Blur-Radius in Pixeln ist kein sinnvoller Zwischenwert. Wer weiche Übergänge braucht, nimmt `Float`.

- [ ] **Step 4: `keyframe.rs` implementieren**

```rust
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: Time,
    pub value: ParamValue,
    pub interp: Interp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_in: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_out: Option<[f32; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum Interp {
    Linear,
    Hold,
    Ease,
    Bezier,
}

pub fn evaluate(track: &[Keyframe], at: Time) -> Option<ParamValue> {
    let first = track.first()?;
    let last = track.last()?;
    if at <= first.time {
        return Some(first.value.clone());
    }
    if at >= last.time {
        return Some(last.value.clone());
    }
    let right_index = track.partition_point(|kf| kf.time <= at);
    let left = &track[right_index - 1];
    let right = &track[right_index];
    Some(interpolate(left, right, at))
}

fn interpolate(left: &Keyframe, right: &Keyframe, at: Time) -> ParamValue {
    if left.interp == Interp::Hold {
        return left.value.clone();
    }
    let span = (right.time - left.time).as_flicks();
    if span <= 0 {
        return right.value.clone();
    }
    let linear = (at - left.time).as_flicks() as f32 / span as f32;
    let eased = ease(left, right, linear);
    left.value
        .lerp(&right.value, eased)
        .unwrap_or_else(|| left.value.clone())
}

fn ease(left: &Keyframe, right: &Keyframe, t: f32) -> f32 {
    match left.interp {
        Interp::Hold | Interp::Linear => t,
        Interp::Ease => t * t * (3.0 - 2.0 * t),
        Interp::Bezier => {
            let out = left.handle_out.unwrap_or([0.42, 0.0]);
            let in_ = right.handle_in.unwrap_or([0.58, 1.0]);
            cubic_bezier_y_at(out, in_, t)
        }
    }
}

fn cubic_bezier_y_at(p1: [f32; 2], p2: [f32; 2], x: f32) -> f32 {
    let mut low = 0.0f32;
    let mut high = 1.0f32;
    let mut t = x;
    for _ in 0..24 {
        let current = bezier_component(p1[0], p2[0], t);
        if current < x {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) * 0.5;
    }
    bezier_component(p1[1], p2[1], t)
}

fn bezier_component(c1: f32, c2: f32, t: f32) -> f32 {
    let u = 1.0 - t;
    3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t
}
```

`cubic_bezier_y_at` löst die x-Komponente per Bisektion. `ponytail: 24 Bisektionsschritte statt Newton-Iteration — reicht für Sub-Pixel-Genauigkeit; auf Newton wechseln, falls Keyframe-Auswertung je im Profil auffällt.`

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test -p videola-core -- param:: keyframe::`
Expected: PASS

- [ ] **Step 6: Committen**

```bash
git add crates/videola-core/src/model/param.rs crates/videola-core/src/model/keyframe.rs
git commit -m "feat(core): Parameterwerte und Keyframe-Auswertung

Diskrete Werte (Bool, Choice, Int) halten statt zu interpolieren; Bezier
loest die x-Komponente per Bisektion."
```

---

### Task 5: Effekt- und Übergangsmodell

**Files:**
- Create: `crates/videola-core/src/model/effect.rs`

**Interfaces:**
- Consumes: `Time`, `EffectId`, `ParamValue`, `Keyframe`
- Produces: `Effect { id, effect_type, enabled, params: BTreeMap<String, ParamValue>, keyframes: BTreeMap<String, Vec<Keyframe>>, extra }`, `Effect::new(&str)`, `Effect::param(&str)`, `Effect::param_at(&str, Time)`, `Transition { transition_type, duration, alignment, params }`, `TransitionAlignment`.

- [ ] **Step 1: Failing tests schreiben**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Interp, ParamValue};

    #[test]
    fn a_new_effect_is_enabled_and_empty() {
        let effect = Effect::new("brightness");
        assert!(effect.enabled);
        assert!(effect.params.is_empty());
        assert!(effect.id.as_str().starts_with("eff_"));
    }

    #[test]
    fn static_params_are_returned_as_is() {
        let mut effect = Effect::new("brightness");
        effect.params.insert("amount".into(), ParamValue::Float(0.5));
        assert_eq!(effect.param_at("amount", Time::ZERO), Some(ParamValue::Float(0.5)));
    }

    #[test]
    fn keyframed_params_win_over_static_ones() {
        let mut effect = Effect::new("brightness");
        effect.params.insert("amount".into(), ParamValue::Float(0.5));
        effect.keyframes.insert(
            "amount".into(),
            vec![
                Keyframe {
                    time: Time::ZERO,
                    value: ParamValue::Float(0.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
                Keyframe {
                    time: Time::from_seconds(2.0),
                    value: ParamValue::Float(1.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
            ],
        );
        assert_eq!(
            effect.param_at("amount", Time::from_seconds(1.0)),
            Some(ParamValue::Float(0.5))
        );
    }

    #[test]
    fn unknown_params_are_none() {
        assert_eq!(Effect::new("brightness").param_at("nope", Time::ZERO), None);
    }

    #[test]
    fn transitions_default_to_centre_alignment() {
        let t = Transition::new("crossfade", Time::from_seconds(1.0));
        assert_eq!(t.alignment, TransitionAlignment::Center);
    }
}
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core effect::`
Expected: FAIL — `cannot find type Effect`

- [ ] **Step 3: Implementieren**

```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::keyframe::{evaluate, Keyframe};
use super::{EffectId, ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: EffectId,
    pub effect_type: String,
    pub enabled: bool,
    #[serde(default)]
    pub params: BTreeMap<String, ParamValue>,
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Effect {
    pub fn new(effect_type: &str) -> Self {
        Self {
            id: EffectId::new(),
            effect_type: effect_type.to_string(),
            enabled: true,
            params: BTreeMap::new(),
            keyframes: BTreeMap::new(),
            extra: Map::new(),
        }
    }

    pub fn param(&self, key: &str) -> Option<&ParamValue> {
        self.params.get(key)
    }

    pub fn param_at(&self, key: &str, at: Time) -> Option<ParamValue> {
        match self.keyframes.get(key) {
            Some(track) if !track.is_empty() => evaluate(track, at),
            _ => self.params.get(key).cloned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub transition_type: String,
    pub duration: Time,
    pub alignment: TransitionAlignment,
    #[serde(default)]
    pub params: BTreeMap<String, ParamValue>,
}

impl Transition {
    pub fn new(transition_type: &str, duration: Time) -> Self {
        Self {
            transition_type: transition_type.to_string(),
            duration,
            alignment: TransitionAlignment::Center,
            params: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionAlignment {
    Center,
    In,
    Out,
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test -p videola-core effect::`
Expected: PASS

- [ ] **Step 5: Committen**

```bash
git add crates/videola-core/src/model/effect.rs
git commit -m "feat(core): Effekt- und Uebergangsmodell

Uebergaenge sind Effekte mit zwei Eingaengen, kein zweites Subsystem;
keyframete Parameter schlagen statische."
```

---

### Task 6: Document, Command-Bus und Patch-basiertes Undo

**Status: erledigt** (mit Tasks 7 und 8), Commits `8b5a42b..911ecb1`. Drei Review-Runden haben folgende Fehler im Plan-Code selbst korrigiert — der umgesetzte Stand weicht hier bewusst ab:

| Korrektur | Grund |
|---|---|
| `#[serde(rename_all_fields = "camelCase")]` am `Command`-Enum | `rename_all` benennt nur Varianten um, nicht deren Felder. Ohne das gingen `toTrack`, `preservePitch`, `effectType` als snake_case über die Leitung, während der TypeScript-Client camelCase sendet — drei von achtzehn Commands hätten sich nicht deserialisieren lassen. |
| `dispatch` löscht den Redo-Stack in **beiden** Zweigen | `push` löschte ihn, `replace_last` nicht. Nach einem Undo hinterließ ein Coalescing-Dispatch einen Redo-Eintrag, dessen Patch gegen einen verlassenen Zustand berechnet war — genau auf dem Drag-Pfad. |
| `undo`/`redo` wenden den Patch **vor** der Stack-Mutation an | Vorher wanderte der Eintrag zwischen den Stapeln, bevor die fehlbare Patch-Anwendung lief; ein Fehlschlag verlor ihn dauerhaft. |
| Leerer Patch erzeugt keinen History-Eintrag | Ein No-op-Command (Effekt doppelt hinzufügen, Titel auf denselben Wert setzen) hinterließ sonst einen Undo-Schritt, der nichts tut. |
| `Time::checked_add`/`checked_sub` plus `Time::MAX_REASONABLE` (24 h) | `Time` wickelt `i64` mit ungeprüften `+`/`-`. Ein `delta` von `i64::MAX` aus einem API-Request paniced im Debug-Build und wickelt im Release auf eine negative Dauer. |
| Nicht-endliche `f32`-Werte werden abgewiesen | `f32::clamp` gibt NaN unverändert zurück; `serde_json` schreibt NaN als `null`, und das nächste `undo` scheitert dann in `from_value`. |
| `Project::normalize()` ist fallibel und prüft alle `Time`-Felder, rekursiv in `ClipSource::Compound` mit `MAX_COMPOUND_DEPTH = 8` | Handler prüfen ihre Eingaben, aber ein deserialisiertes Projekt bringt ungeprüfte Zeiten direkt in `Clip::end()`. Eine Prüfung an der einen Stelle, durch die jedes geladene Projekt läuft. |
| `History`-Interna sind `pub(crate)` | Die Invariante „`inverse` ist die exakte Umkehrung von `patch` zur selben Basis" ist nur in `Document` durchsetzbar. |
| `Command::apply` routet exhaustiv, ohne Catch-all-Arm | Ein Catch-all hätte die später ergänzten `media.*`-Varianten stillschweigend an den Clip-Handler geschickt. |

**Files:**
- Create: `crates/videola-core/src/command/mod.rs`, `crates/videola-core/src/history.rs`, `crates/videola-core/src/document.rs`
- Modify: `crates/videola-core/src/lib.rs`
- Create: `crates/videola-core/tests/undo.rs`

**Interfaces:**
- Consumes: `Project`, `CoreError`, `Result`
- Produces: `Command` (Enum, serde-tag `type` mit Punktnamen wie `"track.add"`), `Command::apply(&self, &mut Project) -> Result<()>`, `Command::label(&self) -> &'static str`, `Dispatch { command, coalesce_key: Option<String> }`, `DispatchResult { patch: Value, label: &'static str, can_undo: bool, can_redo: bool }`, `Document::new()`, `Document::from_project(Project)`, `Document::project()`, `Document::dispatch(Dispatch)`, `Document::undo()`, `Document::redo()`, `History::labels()`.

- [ ] **Step 1: Dependency ergänzen**

```bash
cd crates/videola-core && cargo add json-patch && cd ../..
```

- [ ] **Step 2: Failing test schreiben**

`crates/videola-core/tests/undo.rs`:
```rust
use videola_core::command::{Command, Dispatch};
use videola_core::model::{Project, TrackKind};
use videola_core::Document;

fn add_track(name: &str) -> Dispatch {
    Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: name.to_string(),
        index: None,
    })
}

#[test]
fn dispatch_then_undo_restores_the_exact_original() {
    let mut doc = Document::new();
    let before = serde_json::to_value(doc.project()).unwrap();

    doc.dispatch(add_track("V1")).unwrap();
    assert_eq!(doc.project().timeline.tracks.len(), 1);

    doc.undo().unwrap();
    let after = serde_json::to_value(doc.project()).unwrap();
    assert_eq!(before, after);
}

#[test]
fn redo_reapplies_what_undo_removed() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    let with_track = serde_json::to_value(doc.project()).unwrap();

    doc.undo().unwrap();
    doc.redo().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), with_track);
}

#[test]
fn a_new_dispatch_clears_the_redo_stack() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    doc.undo().unwrap();
    doc.dispatch(add_track("V2")).unwrap();

    assert!(doc.redo().is_err());
    assert_eq!(doc.project().timeline.tracks.len(), 1);
    assert_eq!(doc.project().timeline.tracks[0].name, "V2");
}

#[test]
fn undo_on_an_empty_history_fails_cleanly() {
    let mut doc = Document::new();
    assert!(doc.undo().is_err());
}

#[test]
fn a_failing_command_leaves_the_project_untouched() {
    let mut doc = Document::new();
    let before = serde_json::to_value(doc.project()).unwrap();

    let result = doc.dispatch(Dispatch::new(Command::TrackRemove {
        track: "trk_missing".to_string().into(),
    }));

    assert!(result.is_err());
    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
    assert!(doc.undo().is_err());
}

#[test]
fn commands_sharing_a_coalesce_key_collapse_into_one_undo_step() {
    let mut doc = Document::from_project(Project::default());
    doc.dispatch(add_track("V1")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let baseline = serde_json::to_value(doc.project()).unwrap();

    for volume in [0.9f32, 0.8, 0.7] {
        doc.dispatch(
            Dispatch::new(Command::TrackSetVolume { track: track.clone(), volume })
                .coalesce("drag-volume"),
        )
        .unwrap();
    }

    assert_eq!(doc.history().labels().len(), 2);
    doc.undo().unwrap();
    assert_eq!(serde_json::to_value(doc.project()).unwrap(), baseline);
}

#[test]
fn dispatch_reports_the_patch_it_produced() {
    let mut doc = Document::new();
    let result = doc.dispatch(add_track("V1")).unwrap();
    assert!(result.can_undo);
    assert!(!result.can_redo);
    assert_ne!(result.patch, serde_json::json!([]));
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test undo`
Expected: FAIL — `unresolved import videola_core::Document`

- [ ] **Step 4: `command/mod.rs` implementieren (Rumpf mit Track-Volume)**

```rust
mod clip;
mod project;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{
    ClipId, ClipSource, Effect, ParamValue, Project, ProjectSettings, Time, TrackId, TrackKind,
};
use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    #[serde(rename = "project.setSettings")]
    ProjectSetSettings { settings: ProjectSettings },
    #[serde(rename = "project.setTitle")]
    ProjectSetTitle { title: String },

    #[serde(rename = "track.add")]
    TrackAdd { kind: TrackKind, name: String, index: Option<usize> },
    #[serde(rename = "track.remove")]
    TrackRemove { track: TrackId },
    #[serde(rename = "track.reorder")]
    TrackReorder { track: TrackId, to_index: usize },
    #[serde(rename = "track.rename")]
    TrackRename { track: TrackId, name: String },
    #[serde(rename = "track.setVolume")]
    TrackSetVolume { track: TrackId, volume: f32 },
    #[serde(rename = "track.setPan")]
    TrackSetPan { track: TrackId, pan: f32 },
    #[serde(rename = "track.setFlags")]
    TrackSetFlags {
        track: TrackId,
        muted: Option<bool>,
        solo: Option<bool>,
        locked: Option<bool>,
        hidden: Option<bool>,
    },

    #[serde(rename = "clip.add")]
    ClipAdd { track: TrackId, source: ClipSource, start: Time, duration: Time },
    #[serde(rename = "clip.remove")]
    ClipRemove { clip: ClipId },
    #[serde(rename = "clip.move")]
    ClipMove { clip: ClipId, to_track: TrackId, start: Time },
    #[serde(rename = "clip.trim")]
    ClipTrim { clip: ClipId, edge: TrimEdge, delta: Time },
    #[serde(rename = "clip.split")]
    ClipSplit { clip: ClipId, at: Time },
    #[serde(rename = "clip.setSpeed")]
    ClipSetSpeed { clip: ClipId, rate: f32, reverse: bool, preserve_pitch: bool },
    #[serde(rename = "clip.setVolume")]
    ClipSetVolume { clip: ClipId, volume: f32 },

    #[serde(rename = "effect.add")]
    EffectAdd { clip: ClipId, effect_type: String },
    #[serde(rename = "effect.setParam")]
    EffectSetParam { clip: ClipId, effect_type: String, key: String, value: ParamValue },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TrimEdge {
    Start,
    End,
}

impl Command {
    pub fn apply(&self, target: &mut Project) -> Result<()> {
        match self {
            Self::ProjectSetSettings { .. }
            | Self::ProjectSetTitle { .. }
            | Self::TrackAdd { .. }
            | Self::TrackRemove { .. }
            | Self::TrackReorder { .. }
            | Self::TrackRename { .. }
            | Self::TrackSetVolume { .. }
            | Self::TrackSetPan { .. }
            | Self::TrackSetFlags { .. } => project::apply(self, target),
            _ => clip::apply(self, target),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::ProjectSetSettings { .. } => "cmd.project.setSettings",
            Self::ProjectSetTitle { .. } => "cmd.project.setTitle",
            Self::TrackAdd { .. } => "cmd.track.add",
            Self::TrackRemove { .. } => "cmd.track.remove",
            Self::TrackReorder { .. } => "cmd.track.reorder",
            Self::TrackRename { .. } => "cmd.track.rename",
            Self::TrackSetVolume { .. } => "cmd.track.setVolume",
            Self::TrackSetPan { .. } => "cmd.track.setPan",
            Self::TrackSetFlags { .. } => "cmd.track.setFlags",
            Self::ClipAdd { .. } => "cmd.clip.add",
            Self::ClipRemove { .. } => "cmd.clip.remove",
            Self::ClipMove { .. } => "cmd.clip.move",
            Self::ClipTrim { .. } => "cmd.clip.trim",
            Self::ClipSplit { .. } => "cmd.clip.split",
            Self::ClipSetSpeed { .. } => "cmd.clip.setSpeed",
            Self::ClipSetVolume { .. } => "cmd.clip.setVolume",
            Self::EffectAdd { .. } => "cmd.effect.add",
            Self::EffectSetParam { .. } => "cmd.effect.setParam",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub command: Command,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coalesce_key: Option<String>,
}

impl Dispatch {
    pub fn new(command: Command) -> Self {
        Self { command, coalesce_key: None }
    }

    pub fn coalesce(mut self, key: &str) -> Self {
        self.coalesce_key = Some(key.to_string());
        self
    }
}

pub(crate) fn find_clip_mut<'p>(
    target: &'p mut Project,
    clip: &ClipId,
) -> Result<(&'p mut crate::model::Track, usize)> {
    for track in target.timeline.tracks.iter_mut() {
        if let Some(index) = track.clip_index(clip) {
            return Ok((track, index));
        }
    }
    Err(crate::CoreError::ClipNotFound(clip.clone()))
}

pub(crate) fn unused_effect(effect_type: &str) -> Effect {
    Effect::new(effect_type)
}
```

`unused_effect` fliegt am Ende von Task 8 wieder raus — es hält nur `Effect` im Import, bis `effect.add` implementiert ist. Wenn du Task 8 direkt anschließt, lass es weg.

- [ ] **Step 5: `history.rs` implementieren**

```rust
use json_patch::Patch;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Entry {
    pub label: &'static str,
    pub patch: Patch,
    pub inverse: Patch,
    pub coalesce_key: Option<String>,
}

#[derive(Debug, Default)]
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryLabel {
    pub label: &'static str,
}

impl History {
    pub fn new(limit: usize) -> Self {
        Self { undo: Vec::new(), redo: Vec::new(), limit }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn labels(&self) -> Vec<&'static str> {
        self.undo.iter().map(|entry| entry.label).collect()
    }

    pub fn coalesces_with(&self, key: &Option<String>) -> bool {
        match (key, self.undo.last()) {
            (Some(key), Some(last)) => last.coalesce_key.as_deref() == Some(key.as_str()),
            _ => false,
        }
    }

    pub fn push(&mut self, entry: Entry) {
        self.redo.clear();
        self.undo.push(entry);
        if self.undo.len() > self.limit {
            self.undo.remove(0);
        }
    }

    pub fn replace_last(&mut self, patch: Patch, inverse: Patch) {
        if let Some(last) = self.undo.last_mut() {
            last.patch = patch;
            last.inverse = inverse;
        }
    }

    pub fn last_inverse(&self) -> Option<&Patch> {
        self.undo.last().map(|entry| &entry.inverse)
    }

    pub fn pop_undo(&mut self) -> Option<Entry> {
        let entry = self.undo.pop()?;
        self.redo.push(entry.clone());
        Some(entry)
    }

    pub fn pop_redo(&mut self) -> Option<Entry> {
        let entry = self.redo.pop()?;
        self.undo.push(entry.clone());
        Some(entry)
    }
}

pub fn empty_patch() -> Patch {
    Patch(Vec::new())
}

pub fn diff(from: &Value, to: &Value) -> Patch {
    json_patch::diff(from, to)
}
```

- [ ] **Step 6: `document.rs` implementieren**

```rust
use json_patch::Patch;
use serde::Serialize;
use serde_json::Value;

use crate::command::Dispatch;
use crate::history::{diff, Entry, History};
use crate::model::Project;
use crate::{CoreError, Result};

const HISTORY_LIMIT: usize = 500;

pub struct Document {
    project: Project,
    history: History,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub patch: Value,
    pub label: &'static str,
    pub can_undo: bool,
    pub can_redo: bool,
}

impl Default for Document {
    fn default() -> Self {
        Self::from_project(Project::default())
    }
}

impl Document {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_project(project: Project) -> Self {
        Self { project, history: History::new(HISTORY_LIMIT) }
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        let before = serde_json::to_value(&self.project)?;
        let mut candidate = self.project.clone();
        dispatch.command.apply(&mut candidate)?;
        let after = serde_json::to_value(&candidate)?;

        let patch = diff(&before, &after);
        if self.history.coalesces_with(&dispatch.coalesce_key) {
            self.coalesce_into_last(&before, &after)?;
        } else {
            self.history.push(Entry {
                label: dispatch.command.label(),
                patch: patch.clone(),
                inverse: diff(&after, &before),
                coalesce_key: dispatch.coalesce_key,
            });
        }
        self.project = candidate;
        Ok(self.result(patch, dispatch.command.label()))
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.pop_undo().ok_or(CoreError::NothingToUndo)?;
        let patch = entry.inverse.clone();
        self.apply_patch(&patch)?;
        Ok(self.result(patch, entry.label))
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.pop_redo().ok_or(CoreError::NothingToRedo)?;
        let patch = entry.patch.clone();
        self.apply_patch(&patch)?;
        Ok(self.result(patch, entry.label))
    }

    fn coalesce_into_last(&mut self, before: &Value, after: &Value) -> Result<()> {
        let Some(inverse) = self.history.last_inverse().cloned() else {
            return Ok(());
        };
        let mut group_start = before.clone();
        json_patch::patch(&mut group_start, &inverse)
            .map_err(|error| CoreError::InvalidArgument(error.to_string()))?;
        self.history
            .replace_last(diff(&group_start, after), diff(after, &group_start));
        Ok(())
    }

    fn apply_patch(&mut self, patch: &Patch) -> Result<()> {
        let mut state = serde_json::to_value(&self.project)?;
        json_patch::patch(&mut state, patch)
            .map_err(|error| CoreError::InvalidArgument(error.to_string()))?;
        self.project = serde_json::from_value(state)?;
        Ok(())
    }

    fn result(&self, patch: Patch, label: &'static str) -> DispatchResult {
        DispatchResult {
            patch: serde_json::to_value(&patch).unwrap_or(Value::Null),
            label,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
        }
    }
}
```

Der Umweg über eine Kopie (`candidate`) ist die Sicherheitsgarantie: ein Command, der auf halber Strecke scheitert, kann das Projekt nicht halb mutiert hinterlassen — und Commands kommen aus API und MCP, also von außen.

`ponytail: pro Dispatch wird das Projekt geklont und zweimal serialisiert. Bei grossen Projekten und Drag-Frequenz kann das auffallen; dann Patches pro Command von Hand erzeugen statt zu diffen — die Entry-Struktur bleibt dabei gleich.`

- [ ] **Step 7: `lib.rs` erweitern**

```rust
pub mod command;
pub mod document;
pub mod error;
pub mod history;
pub mod model;

pub use command::{Command, Dispatch};
pub use document::{DispatchResult, Document};
pub use error::{CoreError, Result};
```

- [ ] **Step 8: Test laufen lassen**

Run: `cargo test -p videola-core --test undo`
Expected: PASS, nachdem Task 7 die Projekt- und Track-Handler geliefert hat. Arbeite Task 7 direkt im Anschluss ab.

- [ ] **Step 9: Committen (nach Task 7)**

```bash
git add crates/videola-core/src/command crates/videola-core/src/history.rs \
        crates/videola-core/src/document.rs crates/videola-core/src/lib.rs \
        crates/videola-core/tests/undo.rs
git commit -m "feat(core): Command-Bus mit patchbasiertem Undo

Commands laufen gegen eine Kopie; aus Vorher/Nachher entstehen Patch und
Inverse, damit kein Command ein eigenes Undo braucht. Coalescing ueber einen
vom Aufrufer gesetzten Schluessel statt ueber eine Uhr, damit der Kern
deterministisch bleibt."
```

---

### Task 7: Projekt- und Track-Commands

**Files:**
- Create: `crates/videola-core/src/command/project.rs`
- Create: `crates/videola-core/tests/track_commands.rs`

**Interfaces:**
- Consumes: `Command`, `Project`, `Track`, `TrackKind`, `CoreError`
- Produces: `command::project::apply(&Command, &mut Project) -> Result<()>`

- [ ] **Step 1: Failing test schreiben**

`crates/videola-core/tests/track_commands.rs`:
```rust
use videola_core::command::{Command, Dispatch};
use videola_core::model::TrackKind;
use videola_core::Document;

fn doc_with_tracks(names: &[&str]) -> Document {
    let mut doc = Document::new();
    for name in names {
        doc.dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Video,
            name: (*name).to_string(),
            index: None,
        }))
        .unwrap();
    }
    doc
}

#[test]
fn tracks_append_in_order_and_get_a_kind_specific_colour() {
    let doc = doc_with_tracks(&["V1", "V2"]);
    let tracks = &doc.project().timeline.tracks;
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0].name, "V1");
    assert_eq!(tracks[1].name, "V2");
    assert_eq!(tracks[0].color_hex, "#5B8CFF");
}

#[test]
fn an_explicit_index_inserts_instead_of_appending() {
    let mut doc = doc_with_tracks(&["V1", "V2"]);
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: Some(0),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].name, "A1");
}

#[test]
fn an_out_of_range_index_is_rejected() {
    let mut doc = doc_with_tracks(&["V1"]);
    assert!(doc
        .dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Audio,
            name: "A1".into(),
            index: Some(9),
        }))
        .is_err());
}

#[test]
fn removing_a_track_takes_its_clips_with_it() {
    let mut doc = doc_with_tracks(&["V1", "V2"]);
    let first = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackRemove { track: first })).unwrap();
    assert_eq!(doc.project().timeline.tracks.len(), 1);
    assert_eq!(doc.project().timeline.tracks[0].name, "V2");
}

#[test]
fn reorder_moves_a_track_to_the_target_index() {
    let mut doc = doc_with_tracks(&["V1", "V2", "V3"]);
    let third = doc.project().timeline.tracks[2].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackReorder { track: third, to_index: 0 })).unwrap();
    let names: Vec<_> = doc.project().timeline.tracks.iter().map(|t| t.name.clone()).collect();
    assert_eq!(names, vec!["V3", "V1", "V2"]);
}

#[test]
fn volume_and_pan_are_clamped_to_valid_ranges() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();

    doc.dispatch(Dispatch::new(Command::TrackSetVolume { track: track.clone(), volume: 9.0 }))
        .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].volume, 4.0);

    doc.dispatch(Dispatch::new(Command::TrackSetPan { track, pan: -3.0 })).unwrap();
    assert_eq!(doc.project().timeline.tracks[0].pan, -1.0);
}

#[test]
fn set_flags_only_touches_the_flags_it_is_given() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track: track.clone(),
        muted: Some(true),
        solo: None,
        locked: None,
        hidden: None,
    }))
    .unwrap();
    let t = &doc.project().timeline.tracks[0];
    assert!(t.muted);
    assert!(!t.solo);
    assert!(!t.locked);
}

#[test]
fn setting_the_title_leaves_the_project_id_alone() {
    let mut doc = Document::new();
    let id = doc.project().meta.id.clone();
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle { title: "Urlaub".into() })).unwrap();
    assert_eq!(doc.project().meta.title, "Urlaub");
    assert_eq!(doc.project().meta.id, id);
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test track_commands`
Expected: FAIL — `module project is private` bzw. `apply` nicht gefunden

- [ ] **Step 3: Implementieren**

`crates/videola-core/src/command/project.rs`:
```rust
use super::Command;
use crate::model::{Project, Track, TrackId};
use crate::{CoreError, Result};

const MAX_TRACK_VOLUME: f32 = 4.0;

pub(super) fn apply(command: &Command, target: &mut Project) -> Result<()> {
    match command {
        Command::ProjectSetSettings { settings } => {
            target.settings = settings.clone();
            Ok(())
        }
        Command::ProjectSetTitle { title } => {
            target.meta.title = title.clone();
            Ok(())
        }
        Command::TrackAdd { kind, name, index } => add_track(target, *kind, name, *index),
        Command::TrackRemove { track } => remove_track(target, track),
        Command::TrackReorder { track, to_index } => reorder_track(target, track, *to_index),
        Command::TrackRename { track, name } => {
            track_mut(target, track)?.name = name.clone();
            Ok(())
        }
        Command::TrackSetVolume { track, volume } => {
            track_mut(target, track)?.volume = volume.clamp(0.0, MAX_TRACK_VOLUME);
            Ok(())
        }
        Command::TrackSetPan { track, pan } => {
            track_mut(target, track)?.pan = pan.clamp(-1.0, 1.0);
            Ok(())
        }
        Command::TrackSetFlags { track, muted, solo, locked, hidden } => {
            let target_track = track_mut(target, track)?;
            if let Some(value) = muted {
                target_track.muted = *value;
            }
            if let Some(value) = solo {
                target_track.solo = *value;
            }
            if let Some(value) = locked {
                target_track.locked = *value;
            }
            if let Some(value) = hidden {
                target_track.hidden = *value;
            }
            Ok(())
        }
        other => Err(CoreError::InvalidArgument(other.label().to_string())),
    }
}

fn add_track(
    target: &mut Project,
    kind: crate::model::TrackKind,
    name: &str,
    index: Option<usize>,
) -> Result<()> {
    let track = Track::new(kind, name.to_string());
    let len = target.timeline.tracks.len();
    match index {
        None => target.timeline.tracks.push(track),
        Some(at) if at <= len => target.timeline.tracks.insert(at, track),
        Some(at) => return Err(CoreError::IndexOutOfRange { index: at, len }),
    }
    Ok(())
}

fn remove_track(target: &mut Project, track: &TrackId) -> Result<()> {
    let index = target
        .track_index(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target.timeline.tracks.remove(index);
    Ok(())
}

fn reorder_track(target: &mut Project, track: &TrackId, to_index: usize) -> Result<()> {
    let from = target
        .track_index(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    let len = target.timeline.tracks.len();
    if to_index >= len {
        return Err(CoreError::IndexOutOfRange { index: to_index, len });
    }
    let moved = target.timeline.tracks.remove(from);
    target.timeline.tracks.insert(to_index, moved);
    Ok(())
}

fn track_mut<'p>(target: &'p mut Project, track: &TrackId) -> Result<&'p mut Track> {
    target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test -p videola-core && cargo clippy -p videola-core -- -D warnings`
Expected: PASS — auch `tests/undo.rs` aus Task 6 ist jetzt grün

- [ ] **Step 5: Committen**

```bash
git add crates/videola-core/src/command/project.rs crates/videola-core/tests/track_commands.rs
git commit -m "feat(core): Projekt- und Track-Commands"
```

---

### Task 8: Clip-Commands inklusive Split

**Status: erledigt** (mit Tasks 6 und 7). Zwei inhaltliche Korrekturen gegenüber dem Code unten:

**`split` und `trim` müssen `speed.reverse` und `speed.rate` berücksichtigen.** `source_time_at` bildet bei einem rückwärts laufenden Clip den Timeline-*Anfang* auf das Quell-*Ende* ab. Die linke Timeline-Hälfte verbraucht also den oberen Teil des Quellbereichs. Der Code unten lässt `in_point` unbesehen links und schiebt ihn rechts weiter — bei `reverse` tauschen die beiden Hälften dadurch ihren Inhalt, ein Schnitt schneidet also um. Richtig: bei `reverse` behält die **rechte** Hälfte `in_point`, die **linke** bekommt `in_point + (consumed_total − consumed_left)`. Bei `trim` invertieren sich Kopf und Fuß entsprechend: `TrimEdge::Start` lässt `in_point` unangetastet, `TrimEdge::End` schiebt ihn.

Die Invariante, gegen die zu testen ist: **für jedes `t` im überlebenden Timeline-Bereich gilt `neu.source_time_at(t) == alt.source_time_at(t)`.** Getestet über eine Matrix aus `rate ∈ {0.5, 1.0, 2.0} × reverse ∈ {false, true}`.

**Der Split-Grenzwert wird strukturell abgeleitet, nicht neu gerechnet.** Erst `left.duration = consumed` setzen, dann `right.in_point = left.out_point()`. Der Code unten rechnet den Offset über `f64`-Sekunden, während `consumed_source()` in Flicks multipliziert — zwei Rundungen desselben Wertes, die um einen Flick auseinanderliegen können.

**Files:**
- Create: `crates/videola-core/src/command/clip.rs`
- Create: `crates/videola-core/tests/clip_commands.rs`
- Modify: `crates/videola-core/src/command/mod.rs` (Hilfsfunktion `unused_effect` entfernen)

**Interfaces:**
- Consumes: `Command`, `TrimEdge`, `Clip`, `ClipSource`, `Project`, `find_clip_mut`
- Produces: `command::clip::apply(&Command, &mut Project) -> Result<()>`

- [ ] **Step 1: Failing test schreiben**

`crates/videola-core/tests/clip_commands.rs`:
```rust
use videola_core::command::{Command, Dispatch, TrimEdge};
use videola_core::model::{ClipSource, MediaId, ParamValue, Time, TrackKind};
use videola_core::Document;

fn doc_with_clip(start_s: f64, dur_s: f64) -> (Document, videola_core::model::TrackId) {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Media { media: MediaId::from("med_a".to_string()) },
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(dur_s),
    }))
    .unwrap();
    (doc, track)
}

#[test]
fn adding_a_clip_places_it_on_the_track() {
    let (doc, _) = doc_with_clip(1.0, 4.0);
    let clips = &doc.project().timeline.tracks[0].clips;
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].start.as_seconds(), 1.0);
    assert_eq!(clips[0].duration.as_seconds(), 4.0);
    assert_eq!(clips[0].out_point().as_seconds(), 4.0);
}

#[test]
fn a_zero_length_clip_is_rejected() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipAdd {
            track,
            source: ClipSource::Media { media: MediaId::from("med_a".to_string()) },
            start: Time::ZERO,
            duration: Time::ZERO,
        }))
        .is_err());
}

#[test]
fn moving_a_clip_to_another_track_removes_it_from_the_first() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V2".into(),
        index: None,
    }))
    .unwrap();
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    let second = doc.project().timeline.tracks[1].id.clone();

    doc.dispatch(Dispatch::new(Command::ClipMove {
        clip,
        to_track: second,
        start: Time::from_seconds(5.0),
    }))
    .unwrap();

    assert!(doc.project().timeline.tracks[0].clips.is_empty());
    assert_eq!(doc.project().timeline.tracks[1].clips[0].start.as_seconds(), 5.0);
}

#[test]
fn a_negative_start_is_clamped_to_zero() {
    let (mut doc, track) = doc_with_clip(1.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipMove {
        clip,
        to_track: track,
        start: Time::from_seconds(-5.0),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].clips[0].start, Time::ZERO);
}

#[test]
fn trimming_the_start_moves_start_and_in_point_together() {
    let (mut doc, _) = doc_with_clip(2.0, 4.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipTrim {
        clip,
        edge: TrimEdge::Start,
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();
    let c = &doc.project().timeline.tracks[0].clips[0];
    assert_eq!(c.start.as_seconds(), 3.0);
    assert_eq!(c.duration.as_seconds(), 3.0);
    assert_eq!(c.in_point.as_seconds(), 1.0);
}

#[test]
fn trimming_the_end_only_changes_duration_and_out_point() {
    let (mut doc, _) = doc_with_clip(2.0, 4.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipTrim {
        clip,
        edge: TrimEdge::End,
        delta: Time::from_seconds(-1.0),
    }))
    .unwrap();
    let c = &doc.project().timeline.tracks[0].clips[0];
    assert_eq!(c.start.as_seconds(), 2.0);
    assert_eq!(c.duration.as_seconds(), 3.0);
    assert_eq!(c.out_point().as_seconds(), 3.0);
}

#[test]
fn a_trim_that_would_empty_the_clip_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipTrim {
            clip,
            edge: TrimEdge::End,
            delta: Time::from_seconds(-2.0),
        }))
        .is_err());
}

#[test]
fn split_produces_two_adjacent_clips_with_continuous_source_range() {
    let (mut doc, _) = doc_with_clip(0.0, 4.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipSplit { clip: clip.clone(), at: Time::from_seconds(1.5) }))
        .unwrap();

    let clips = &doc.project().timeline.tracks[0].clips;
    assert_eq!(clips.len(), 2);
    assert_eq!(clips[0].id, clip);
    assert_eq!(clips[0].duration.as_seconds(), 1.5);
    assert_eq!(clips[0].out_point().as_seconds(), 1.5);
    assert_eq!(clips[1].start.as_seconds(), 1.5);
    assert_eq!(clips[1].duration.as_seconds(), 2.5);
    assert_eq!(clips[1].in_point.as_seconds(), 1.5);
    assert_ne!(clips[1].id, clip);
}

#[test]
fn split_outside_the_clip_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSplit { clip, at: Time::from_seconds(9.0) }))
        .is_err());
}

#[test]
fn split_on_the_exact_boundary_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSplit { clip, at: Time::ZERO }))
        .is_err());
}

#[test]
fn reverse_is_a_flag_and_speed_must_be_positive() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();

    doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
        clip: clip.clone(),
        rate: 2.0,
        reverse: true,
        preserve_pitch: false,
    }))
    .unwrap();
    let c = &doc.project().timeline.tracks[0].clips[0];
    assert!(c.speed.reverse);
    assert_eq!(c.speed.rate, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetSpeed {
            clip,
            rate: 0.0,
            reverse: false,
            preserve_pitch: true,
        }))
        .is_err());
}

#[test]
fn adding_an_effect_twice_reuses_the_existing_one() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    for _ in 0..2 {
        doc.dispatch(Dispatch::new(Command::EffectAdd {
            clip: clip.clone(),
            effect_type: "brightness".into(),
        }))
        .unwrap();
    }
    assert_eq!(doc.project().timeline.tracks[0].clips[0].effects.len(), 1);
}

#[test]
fn setting_an_effect_param_on_a_missing_effect_fails() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::EffectSetParam {
            clip,
            effect_type: "brightness".into(),
            key: "amount".into(),
            value: ParamValue::Float(0.5),
        }))
        .is_err());
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test clip_commands`
Expected: FAIL — `apply` in `command::clip` nicht gefunden

- [ ] **Step 3: Implementieren**

`crates/videola-core/src/command/clip.rs`:
```rust
use super::{find_clip_mut, Command, TrimEdge};
use crate::model::{Clip, ClipId, ClipSource, Effect, ParamValue, Project, Time, TrackId};
use crate::{CoreError, Result};

pub(super) fn apply(command: &Command, target: &mut Project) -> Result<()> {
    match command {
        Command::ClipAdd { track, source, start, duration } => {
            add(target, track, source.clone(), *start, *duration)
        }
        Command::ClipRemove { clip } => remove(target, clip),
        Command::ClipMove { clip, to_track, start } => move_clip(target, clip, to_track, *start),
        Command::ClipTrim { clip, edge, delta } => trim(target, clip, *edge, *delta),
        Command::ClipSplit { clip, at } => split(target, clip, *at),
        Command::ClipSetSpeed { clip, rate, reverse, preserve_pitch } => {
            set_speed(target, clip, *rate, *reverse, *preserve_pitch)
        }
        Command::ClipSetVolume { clip, volume } => {
            let (track, index) = find_clip_mut(target, clip)?;
            track.clips[index].volume = volume.clamp(0.0, 4.0);
            Ok(())
        }
        Command::EffectAdd { clip, effect_type } => add_effect(target, clip, effect_type),
        Command::EffectSetParam { clip, effect_type, key, value } => {
            set_effect_param(target, clip, effect_type, key, value.clone())
        }
        other => Err(CoreError::InvalidArgument(other.label().to_string())),
    }
}

fn add(
    target: &mut Project,
    track: &TrackId,
    source: ClipSource,
    start: Time,
    duration: Time,
) -> Result<()> {
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument("duration must be positive".into()));
    }
    let mut clip = Clip::new_media(crate::model::MediaId::from(String::new()), start, duration);
    clip.source = source;
    clip.start = start.clamp_min_zero();
    let target_track = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target_track.clips.push(clip);
    sort_clips(target_track);
    Ok(())
}

fn remove(target: &mut Project, clip: &ClipId) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips.remove(index);
    Ok(())
}

fn move_clip(
    target: &mut Project,
    clip: &ClipId,
    to_track: &TrackId,
    start: Time,
) -> Result<()> {
    if target.track_index(to_track).is_none() {
        return Err(CoreError::TrackNotFound(to_track.clone()));
    }
    let (source_track, index) = find_clip_mut(target, clip)?;
    let mut moved = source_track.clips.remove(index);
    moved.start = start.clamp_min_zero();
    let destination = target
        .track_mut(to_track)
        .ok_or_else(|| CoreError::TrackNotFound(to_track.clone()))?;
    destination.clips.push(moved);
    sort_clips(destination);
    Ok(())
}

fn trim(target: &mut Project, clip: &ClipId, edge: TrimEdge, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = &track.clips[index];
    let (start, duration, in_point) = match edge {
        TrimEdge::Start => (
            current.start + delta,
            current.duration - delta,
            current.in_point + delta,
        ),
        TrimEdge::End => (current.start, current.duration + delta, current.in_point),
    };
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument("trim would empty the clip".into()));
    }
    if start.as_flicks() < 0 || in_point.as_flicks() < 0 {
        return Err(CoreError::InvalidArgument("trim would move before zero".into()));
    }
    let clip = &mut track.clips[index];
    clip.start = start;
    clip.duration = duration;
    clip.in_point = in_point;
    Ok(())
}

fn split(target: &mut Project, clip: &ClipId, at: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let left = &track.clips[index];
    if at <= left.start || at >= left.end() {
        return Err(CoreError::InvalidArgument("split point outside the clip".into()));
    }
    let consumed = at - left.start;
    let source_offset = Time::from_seconds(consumed.as_seconds() * left.speed.rate as f64);

    let mut right = left.clone();
    right.id = ClipId::new();
    right.start = at;
    right.duration = left.duration - consumed;
    right.in_point = left.in_point + source_offset;
    right.transition_in = None;

    let left = &mut track.clips[index];
    left.duration = consumed;
    left.transition_out = None;

    track.clips.insert(index + 1, right);
    Ok(())
}

fn set_speed(
    target: &mut Project,
    clip: &ClipId,
    rate: f32,
    reverse: bool,
    preserve_pitch: bool,
) -> Result<()> {
    if !(rate.is_finite() && rate > 0.0) {
        return Err(CoreError::InvalidArgument("rate must be positive".into()));
    }
    let (track, index) = find_clip_mut(target, clip)?;
    let clip = &mut track.clips[index];
    clip.speed.rate = rate;
    clip.speed.reverse = reverse;
    clip.speed.preserve_pitch = preserve_pitch;
    Ok(())
}

fn add_effect(target: &mut Project, clip: &ClipId, effect_type: &str) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let effects = &mut track.clips[index].effects;
    if effects.iter().any(|effect| effect.effect_type == effect_type) {
        return Ok(());
    }
    effects.push(Effect::new(effect_type));
    Ok(())
}

fn set_effect_param(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    value: ParamValue,
) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let effect = track.clips[index]
        .effects
        .iter_mut()
        .find(|effect| effect.effect_type == effect_type)
        .ok_or_else(|| CoreError::InvalidArgument(format!("effect not on clip: {effect_type}")))?;
    effect.params.insert(key.to_string(), value);
    Ok(())
}

fn sort_clips(track: &mut crate::model::Track) {
    track.clips.sort_by_key(|clip| clip.start.as_flicks());
}
```

`add` legt zuerst einen Media-Clip mit leerer `MediaId` an und ersetzt `source` sofort — das vermeidet einen zweiten Konstruktor, der dasselbe tut. Wenn `Clip::new` in Task 3 als `pub(crate)` sichtbar gemacht wird, ist die direkte Variante sauberer; ändere das dann hier mit.

- [ ] **Step 4: `unused_effect` aus `command/mod.rs` entfernen**

Lösche die Funktion und passe den `use`-Block an, sodass `Effect` nicht mehr importiert wird.

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test -p videola-core && cargo clippy -p videola-core -- -D warnings && cargo fmt --check`
Expected: PASS

- [ ] **Step 6: Committen**

```bash
git add crates/videola-core/src/command crates/videola-core/tests/clip_commands.rs
git commit -m "feat(core): Clip-Commands mit Trim, Split und Geschwindigkeit

Split haelt den Quellbereich kontinuierlich: der Offset im Quellmaterial
skaliert mit der Clip-Geschwindigkeit, damit ein geteilter Zeitlupen-Clip
nicht springt."
```

---

### Task 9: Medien-Registry und Inhaltsadressierung

**Files:**
- Create: `crates/videola-core/src/model/media.rs`, `crates/videola-core/src/format/hash.rs`
- Create: `crates/videola-core/src/format/mod.rs` (nur `pub mod hash;` in diesem Task)
- Modify: `crates/videola-core/src/lib.rs`

**Interfaces:**
- Consumes: `Time`, `Rate`
- Produces: `MediaId` (aus Inhalts-Hash, `MediaId::from_bytes(&[u8])`, `MediaId::from(String)`, `as_str`), `MediaKind` (Video/Audio/Image/Font), `MediaAsset { id, original_name, mime, kind, size_bytes, duration, width, height, fps, sample_rate, channels }`, `MediaAsset::extension()`, `format::hash::sha256_hex(&[u8]) -> String`.

- [ ] **Step 1: Dependency ergänzen**

```bash
cd crates/videola-core && cargo add sha2 && cd ../..
```

- [ ] **Step 2: Failing tests schreiben**

`crates/videola-core/src/format/hash.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_the_empty_input_to_the_known_sha256() {
        assert_eq!(
            sha256_hex(&[]),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn identical_bytes_hash_identically() {
        assert_eq!(sha256_hex(b"abc"), sha256_hex(b"abc"));
        assert_ne!(sha256_hex(b"abc"), sha256_hex(b"abd"));
    }
}
```

`crates/videola-core/src/model/media.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_ids_come_from_content_not_chance() {
        let a = MediaId::from_bytes(b"same bytes");
        let b = MediaId::from_bytes(b"same bytes");
        assert_eq!(a, b);
        assert!(a.as_str().starts_with("med_"));
    }

    #[test]
    fn different_content_yields_different_ids() {
        assert_ne!(MediaId::from_bytes(b"a"), MediaId::from_bytes(b"b"));
    }

    #[test]
    fn extension_comes_from_the_original_name() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "Urlaub Clip.MP4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            123,
        );
        assert_eq!(asset.extension(), "mp4");
    }

    #[test]
    fn a_name_without_a_dot_falls_back_to_bin() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "clip".into(),
            "application/octet-stream".into(),
            MediaKind::Video,
            1,
        );
        assert_eq!(asset.extension(), "bin");
    }

    #[test]
    fn optional_technical_metadata_is_omitted_from_json_when_absent() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "a.wav".into(),
            "audio/wav".into(),
            MediaKind::Audio,
            10,
        );
        let json = serde_json::to_value(&asset).unwrap();
        assert!(json.get("width").is_none());
        assert!(json.get("fps").is_none());
    }
}
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core -- media:: hash::`
Expected: FAIL — `cannot find function sha256_hex`

- [ ] **Step 4: `format/hash.rs` implementieren**

```rust
use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().fold(String::with_capacity(64), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    })
}
```

- [ ] **Step 5: `model/media.rs` implementieren**

```rust
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Rate, Time};
use crate::format::hash::sha256_hex;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "string")]
pub struct MediaId(String);

impl MediaId {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self(format!("med_{}", sha256_hex(bytes)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn hash(&self) -> &str {
        self.0.strip_prefix("med_").unwrap_or(&self.0)
    }
}

impl From<String> for MediaId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for MediaId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
    Font,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: MediaId,
    pub original_name: String,
    pub mime: String,
    pub kind: MediaKind,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<Time>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<Rate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<u16>,
}

impl MediaAsset {
    pub fn new(
        id: MediaId,
        original_name: String,
        mime: String,
        kind: MediaKind,
        size_bytes: u64,
    ) -> Self {
        Self {
            id,
            original_name,
            mime,
            kind,
            size_bytes,
            duration: None,
            width: None,
            height: None,
            fps: None,
            sample_rate: None,
            channels: None,
        }
    }

    pub fn extension(&self) -> String {
        self.original_name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .unwrap_or_else(|| "bin".to_string())
    }
}
```

- [ ] **Step 6: Module verdrahten**

`crates/videola-core/src/format/mod.rs`:
```rust
pub mod hash;
```

In `crates/videola-core/src/lib.rs` `pub mod format;` ergänzen.

- [ ] **Step 7: Tests laufen lassen**

Run: `cargo test -p videola-core`
Expected: PASS

- [ ] **Step 8: Committen**

```bash
git add crates/videola-core/src/model/media.rs crates/videola-core/src/format \
        crates/videola-core/src/lib.rs
git commit -m "feat(core): Medien-Registry mit Inhaltsadressierung

MediaId ist der sha256 des Inhalts, nicht eine Zufallszahl: dieselbe Datei
zweimal importiert landet einmal im Projekt."
```

---

### Task 10: `.videola` schreiben

**Files:**
- Create: `crates/videola-core/src/format/writer.rs`
- Modify: `crates/videola-core/src/format/mod.rs`, `crates/videola-core/src/error.rs`

**Interfaces:**
- Consumes: `Project`, `MediaId`, `MediaAsset`, `CoreError`
- Produces: `Manifest { schema_version, app_version, project_id, title, created, modified, locale }`, `MediaStore` (Trait mit `read(&MediaId) -> Result<Vec<u8>>`), `MemoryMediaStore`, `SaveOptions { app_version, created, modified, locale, slim }`, `format::writer::write<W: Write + Seek>(W, &Project, &dyn MediaStore, &SaveOptions) -> Result<()>`, Konstanten `MANIFEST_ENTRY`, `PROJECT_ENTRY`, `MEDIA_PREFIX`.

- [ ] **Step 1: Dependency und Fehlervarianten ergänzen**

```bash
cd crates/videola-core && cargo add zip --no-default-features --features deflate && cd ../..
```

In `crates/videola-core/src/error.rs` ergänzen:
```rust
    #[error("archive error: {0}")]
    Archive(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("media not available: {0}")]
    MediaNotAvailable(crate::model::MediaId),

    #[error("not a videola project: {0}")]
    NotAProject(String),

    #[error("unsupported schema version {0}")]
    UnsupportedSchema(u32),
```

- [ ] **Step 2: Failing test schreiben**

`crates/videola-core/src/format/writer.rs`, am Dateiende:
```rust
#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::model::{MediaAsset, MediaKind, Project, Time, Track, TrackKind};

    fn project_with_media(store: &mut MemoryMediaStore) -> Project {
        let bytes = b"fake mp4 bytes".to_vec();
        let id = MediaId::from_bytes(&bytes);
        store.insert(id.clone(), bytes.clone());

        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            id.clone(),
            "clip.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            bytes.len() as u64,
        ));
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track
            .clips
            .push(crate::model::Clip::new_media(id, Time::ZERO, Time::from_seconds(2.0)));
        project.timeline.tracks.push(track);
        project
    }

    fn entry_names(bytes: &[u8]) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn writes_manifest_project_and_media_entries() {
        let mut store = MemoryMediaStore::default();
        let project = project_with_media(&mut store);
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        let names = entry_names(sink.get_ref());
        assert!(names.contains(&MANIFEST_ENTRY.to_string()));
        assert!(names.contains(&PROJECT_ENTRY.to_string()));
        assert_eq!(names.iter().filter(|n| n.starts_with(MEDIA_PREFIX)).count(), 2);
    }

    #[test]
    fn media_entries_are_named_after_the_content_hash() {
        let mut store = MemoryMediaStore::default();
        let project = project_with_media(&mut store);
        let expected = format!(
            "{MEDIA_PREFIX}{}.mp4",
            project.library[0].id.hash()
        );
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        assert!(entry_names(sink.get_ref()).contains(&expected));
    }

    #[test]
    fn the_manifest_carries_the_supplied_timestamps_and_locale() {
        let store = MemoryMediaStore::default();
        let mut sink = Cursor::new(Vec::new());
        write(&mut sink, &Project::default(), &store, &SaveOptions::for_test()).unwrap();

        let mut archive = zip::ZipArchive::new(sink).unwrap();
        let manifest: Manifest =
            serde_json::from_reader(archive.by_name(MANIFEST_ENTRY).unwrap()).unwrap();
        assert_eq!(manifest.created, "2026-08-07T10:00:00Z");
        assert_eq!(manifest.locale, "de");
        assert_eq!(manifest.schema_version, crate::model::SCHEMA_VERSION);
    }

    #[test]
    fn missing_media_is_reported_instead_of_silently_skipped() {
        let store = MemoryMediaStore::default();
        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            MediaId::from("med_ghost".to_string()),
            "gone.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            1,
        ));
        let mut sink = Cursor::new(Vec::new());

        let result = write(&mut sink, &project, &store, &SaveOptions::for_test());
        assert!(matches!(result, Err(crate::CoreError::MediaNotAvailable(_))));
    }
}
```

Ergänze in `SaveOptions` einen Testhelfer:
```rust
#[cfg(test)]
impl SaveOptions {
    fn for_test() -> Self {
        Self {
            app_version: "0.0.0".into(),
            created: "2026-08-07T10:00:00Z".into(),
            modified: "2026-08-07T10:00:00Z".into(),
            locale: "de".into(),
            slim: true,
        }
    }
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core writer::`
Expected: FAIL — `cannot find function write`

- [ ] **Step 4: `format/mod.rs` erweitern**

```rust
pub mod hash;
pub mod reader;
pub mod writer;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::MediaId;
use crate::{CoreError, Result};

pub const MANIFEST_ENTRY: &str = "videola.json";
pub const PROJECT_ENTRY: &str = "project.json";
pub const MEDIA_PREFIX: &str = "media/";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub app_version: String,
    pub project_id: String,
    pub title: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
}

#[derive(Debug, Clone)]
pub struct SaveOptions {
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
    pub slim: bool,
}

pub trait MediaStore {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>>;
}

#[derive(Debug, Default)]
pub struct MemoryMediaStore {
    entries: BTreeMap<MediaId, Vec<u8>>,
}

impl MemoryMediaStore {
    pub fn insert(&mut self, id: MediaId, bytes: Vec<u8>) {
        self.entries.insert(id, bytes);
    }

    pub fn take(self) -> BTreeMap<MediaId, Vec<u8>> {
        self.entries
    }
}

impl MediaStore for MemoryMediaStore {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>> {
        self.entries
            .get(id)
            .cloned()
            .ok_or_else(|| CoreError::MediaNotAvailable(id.clone()))
    }
}
```

Der Zeitstempel kommt von außen: `videola-core` läuft auch in WASM und soll deterministisch testbar bleiben, also hat es keine Uhr.

- [ ] **Step 5: `format/writer.rs` implementieren**

```rust
use std::io::{Seek, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{Manifest, MediaStore, SaveOptions, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project, SCHEMA_VERSION};
use crate::{CoreError, Result};

pub fn write<W: Write + Seek>(
    sink: W,
    project: &Project,
    media: &dyn MediaStore,
    options: &SaveOptions,
) -> Result<()> {
    let mut archive = ZipWriter::new(sink);
    write_json(&mut archive, MANIFEST_ENTRY, &manifest(project, options))?;
    write_json(&mut archive, PROJECT_ENTRY, project)?;
    write_media(&mut archive, project, media)?;
    archive.finish().map_err(archive_error)?;
    Ok(())
}

fn manifest(project: &Project, options: &SaveOptions) -> Manifest {
    Manifest {
        schema_version: SCHEMA_VERSION,
        app_version: options.app_version.clone(),
        project_id: project.meta.id.to_string(),
        title: project.meta.title.clone(),
        created: options.created.clone(),
        modified: options.modified.clone(),
        locale: options.locale.clone(),
    }
}

fn write_json<W: Write + Seek, T: serde::Serialize>(
    archive: &mut ZipWriter<W>,
    name: &str,
    value: &T,
) -> Result<()> {
    archive
        .start_file(name, deflated())
        .map_err(archive_error)?;
    archive.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
    Ok(())
}

fn write_media<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    project: &Project,
    media: &dyn MediaStore,
) -> Result<()> {
    for asset in &project.library {
        let bytes = media.read(&asset.id)?;
        let name = media_entry_name(&asset.id, &asset.extension());
        archive.start_file(name, stored()).map_err(archive_error)?;
        archive.write_all(&bytes)?;
    }
    Ok(())
}

pub fn media_entry_name(id: &MediaId, extension: &str) -> String {
    format!("{MEDIA_PREFIX}{}.{extension}", id.hash())
}

fn deflated() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

fn stored() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

fn archive_error(error: zip::result::ZipError) -> CoreError {
    CoreError::Archive(error.to_string())
}
```

Medien werden ohne Kompression abgelegt: H.264, AAC und JPEG sind bereits komprimiert, ein Deflate-Durchlauf kostet nur Zeit. Nur Manifest und Modell werden gedeflatet.

Sollte die installierte `zip`-Version `SimpleFileOptions` anders benennen (`FileOptions` in 1.x), passe die zwei Hilfsfunktionen an — der Rest bleibt gleich.

- [ ] **Step 6: Test laufen lassen**

Run: `cargo test -p videola-core writer::`
Expected: PASS, sobald `format/reader.rs` als leeres Modul existiert. Lege die Datei jetzt mit `pub` -Rumpf an und fülle sie in Task 11.

- [ ] **Step 7: Committen**

```bash
git add crates/videola-core/src/format crates/videola-core/src/error.rs
git commit -m "feat(core): .videola schreiben

Medien liegen unkomprimiert im ZIP, weil sie es schon sind; Zeitstempel
kommen vom Aufrufer, damit der Kern ohne Uhr und deterministisch testbar
bleibt."
```

---

### Task 11: `.videola` lesen, Roundtrip und fehlende Medien

**Files:**
- Create: `crates/videola-core/src/format/reader.rs`
- Create: `crates/videola-core/tests/format_roundtrip.rs`

**Interfaces:**
- Consumes: `Manifest`, `MEDIA_PREFIX`, `PROJECT_ENTRY`, `MANIFEST_ENTRY`, `Project`, `MediaId`
- Produces: `LoadedProject { manifest, project, media: BTreeMap<MediaId, Vec<u8>>, warnings: Vec<LoadWarning> }`, `LoadWarning` (MissingMedia/UnreadableEntry/Migrated), `format::reader::read<R: Read + Seek>(R) -> Result<LoadedProject>`

- [ ] **Step 1: Failing test schreiben**

`crates/videola-core/tests/format_roundtrip.rs`:
```rust
use std::io::Cursor;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{reader, writer, LoadWarning, MediaStore, MemoryMediaStore, SaveOptions};
use videola_core::model::{
    ClipSource, MediaAsset, MediaId, MediaKind, Project, Time, TrackKind,
};
use videola_core::Document;

fn save_options() -> SaveOptions {
    SaveOptions {
        app_version: "0.1.0".into(),
        created: "2026-08-07T10:00:00Z".into(),
        modified: "2026-08-07T11:00:00Z".into(),
        locale: "de".into(),
        slim: true,
    }
}

fn built_project() -> (Project, MemoryMediaStore) {
    let bytes = b"pretend this is an mp4".to_vec();
    let id = MediaId::from_bytes(&bytes);
    let mut store = MemoryMediaStore::default();
    store.insert(id.clone(), bytes.clone());

    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle { title: "Urlaub 2026".into() }))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_seconds(3.0),
    }))
    .unwrap();

    let mut project = doc.project().clone();
    project.library.push(MediaAsset::new(
        id,
        "urlaub.mp4".into(),
        "video/mp4".into(),
        MediaKind::Video,
        bytes.len() as u64,
    ));
    (project, store)
}

#[test]
fn a_saved_project_loads_back_identically() {
    let (project, store) = built_project();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();

    let loaded = reader::read(Cursor::new(sink.into_inner())).unwrap();

    assert_eq!(loaded.project, project);
    assert!(loaded.warnings.is_empty());
    assert_eq!(loaded.manifest.title, "Urlaub 2026");
    assert_eq!(loaded.manifest.modified, "2026-08-07T11:00:00Z");
}

#[test]
fn media_bytes_survive_the_roundtrip() {
    let (project, store) = built_project();
    let id = project.library[0].id.clone();
    let original = store.read(&id).unwrap();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();

    let loaded = reader::read(Cursor::new(sink.into_inner())).unwrap();

    assert_eq!(loaded.media.get(&id), Some(&original));
}

#[test]
fn a_project_whose_media_entry_is_gone_still_opens_with_a_warning() {
    let (project, store) = built_project();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();
    let stripped = strip_media_entries(sink.into_inner());

    let loaded = reader::read(Cursor::new(stripped)).unwrap();

    assert_eq!(loaded.project.timeline.tracks[0].clips.len(), 1);
    assert!(loaded
        .warnings
        .iter()
        .any(|warning| matches!(warning, LoadWarning::MissingMedia { .. })));
}

#[test]
fn an_archive_without_a_project_entry_is_rejected() {
    let mut sink = Cursor::new(Vec::new());
    {
        let mut archive = zip::ZipWriter::new(&mut sink);
        archive
            .start_file("readme.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut archive, b"nope").unwrap();
        archive.finish().unwrap();
    }
    assert!(reader::read(Cursor::new(sink.into_inner())).is_err());
}

fn strip_media_entries(bytes: Vec<u8>) -> Vec<u8> {
    let mut source = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut sink = Cursor::new(Vec::new());
    {
        let mut out = zip::ZipWriter::new(&mut sink);
        for index in 0..source.len() {
            let mut entry = source.by_index(index).unwrap();
            let name = entry.name().to_string();
            if name.starts_with("media/") {
                continue;
            }
            out.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            std::io::copy(&mut entry, &mut out).unwrap();
        }
        out.finish().unwrap();
    }
    sink.into_inner()
}
```

Der Test braucht `zip` als Dev-Dependency des Integrationstests:
```bash
cd crates/videola-core && cargo add zip --dev --no-default-features --features deflate && cd ../..
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test format_roundtrip`
Expected: FAIL — `cannot find function read`

- [ ] **Step 3: Implementieren**

`crates/videola-core/src/format/reader.rs`:
```rust
use std::collections::BTreeMap;
use std::io::{Read, Seek};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::ZipArchive;

use super::{Manifest, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project};
use crate::{CoreError, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoadWarning {
    MissingMedia { media: MediaId },
    UnreadableEntry { name: String },
    Migrated { from: u32, to: u32 },
}

#[derive(Debug)]
pub struct LoadedProject {
    pub manifest: Manifest,
    pub project: Project,
    pub media: BTreeMap<MediaId, Vec<u8>>,
    pub warnings: Vec<LoadWarning>,
}

pub fn read<R: Read + Seek>(source: R) -> Result<LoadedProject> {
    let mut archive = ZipArchive::new(source).map_err(|error| {
        CoreError::NotAProject(error.to_string())
    })?;

    let raw_project = read_entry_to_string(&mut archive, PROJECT_ENTRY)?;
    let manifest = read_manifest(&mut archive)?;
    let (project, mut warnings) = super::migrate::load(&raw_project)?;
    let media = read_media(&mut archive);

    warnings.extend(missing_media(&project, &media));
    Ok(LoadedProject { manifest, project, media, warnings })
}

fn read_manifest<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Manifest> {
    let raw = read_entry_to_string(archive, MANIFEST_ENTRY)?;
    Ok(serde_json::from_str(&raw)?)
}

fn read_entry_to_string<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| CoreError::NotAProject(format!("missing entry: {name}")))?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw)?;
    Ok(raw)
}

fn read_media<R: Read + Seek>(archive: &mut ZipArchive<R>) -> BTreeMap<MediaId, Vec<u8>> {
    let names: Vec<String> = (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|e| e.name().to_string()))
        .filter(|name| name.starts_with(MEDIA_PREFIX) && !name.ends_with('/'))
        .collect();

    names
        .into_iter()
        .filter_map(|name| {
            let id = media_id_from_entry(&name)?;
            let mut bytes = Vec::new();
            archive.by_name(&name).ok()?.read_to_end(&mut bytes).ok()?;
            Some((id, bytes))
        })
        .collect()
}

fn media_id_from_entry(name: &str) -> Option<MediaId> {
    let file = name.strip_prefix(MEDIA_PREFIX)?;
    let stem = file.split('.').next()?;
    if stem.is_empty() {
        return None;
    }
    Some(MediaId::from(format!("med_{stem}")))
}

fn missing_media(project: &Project, media: &BTreeMap<MediaId, Vec<u8>>) -> Vec<LoadWarning> {
    project
        .library
        .iter()
        .filter(|asset| !media.contains_key(&asset.id))
        .map(|asset| LoadWarning::MissingMedia { media: asset.id.clone() })
        .collect()
}
```

Ein fehlendes Medium ist bewusst kein Fehler: der Nutzer soll sein Projekt öffnen, die markierten Clips sehen und neu verknüpfen können, statt vor einer Fehlermeldung zu stehen.

`ponytail: der Reader hält alle Mediendaten im Speicher. Fuer M0 und Projekte in Testgroesse in Ordnung; ab M1 auf streamende Extraktion in den Host-Storage (OPFS bzw. Dateisystem) umstellen, LoadedProject.media wird dann zu einem Iterator.`

- [ ] **Step 4: `format/mod.rs` um Re-Exports ergänzen**

```rust
pub mod hash;
pub mod migrate;
pub mod reader;
pub mod writer;

pub use reader::{LoadWarning, LoadedProject};
```

- [ ] **Step 5: Test laufen lassen**

Run: `cargo test -p videola-core --test format_roundtrip`
Expected: PASS, sobald Task 12 `format/migrate.rs` geliefert hat. Arbeite Task 12 direkt im Anschluss ab.

- [ ] **Step 6: Committen (nach Task 12)**

```bash
git add crates/videola-core/src/format crates/videola-core/tests/format_roundtrip.rs
git commit -m "feat(core): .videola lesen mit Warnungen statt Abbruch

Fehlende Medien machen ein Projekt nicht unlesbar: es oeffnet, die
betroffenen Clips behalten ihre Parameter und werden als Warnung gemeldet."
```

---

### Task 12: Schema-Migration

**Files:**
- Create: `crates/videola-core/src/format/migrate.rs`
- Create: `crates/videola-core/tests/migration.rs`

**Interfaces:**
- Consumes: `Project`, `SCHEMA_VERSION`, `LoadWarning`
- Produces: `format::migrate::load(&str) -> Result<(Project, Vec<LoadWarning>)>`

- [ ] **Step 1: Failing test schreiben**

`crates/videola-core/tests/migration.rs`:
```rust
use videola_core::format::migrate;
use videola_core::format::LoadWarning;

const MINIMAL_V1: &str = r#"{
  "schemaVersion": 1,
  "meta": {"id":"prj_1","title":"T","tags":[]},
  "settings": {"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1},
               "sampleRate":48000,"colorSpace":"srgb","background":"#000000"},
  "library": [],
  "timeline": {"tracks":[]},
  "markers": [],
  "master": {"volume":1.0,"effects":[]}
}"#;

#[test]
fn a_current_version_loads_without_warnings() {
    let (project, warnings) = migrate::load(MINIMAL_V1).unwrap();
    assert_eq!(project.meta.title, "T");
    assert!(warnings.is_empty());
}

#[test]
fn a_missing_schema_version_is_treated_as_version_one() {
    let without = MINIMAL_V1.replace("\"schemaVersion\": 1,", "");
    let (project, _) = migrate::load(&without).unwrap();
    assert_eq!(project.schema_version, videola_core::model::SCHEMA_VERSION);
}

#[test]
fn a_newer_schema_version_is_refused() {
    let newer = MINIMAL_V1.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99");
    assert!(matches!(
        migrate::load(&newer),
        Err(videola_core::CoreError::UnsupportedSchema(99))
    ));
}

#[test]
fn unknown_fields_are_preserved_and_do_not_warn() {
    let extended = MINIMAL_V1.replace(
        "\"markers\": [],",
        "\"markers\": [], \"futureThing\": {\"a\":1},",
    );
    let (project, warnings) = migrate::load(&extended).unwrap();
    let out = serde_json::to_value(&project).unwrap();
    assert_eq!(out["futureThing"]["a"], 1);
    assert!(!warnings.iter().any(|w| matches!(w, LoadWarning::Migrated { .. })));
}

#[test]
fn malformed_json_fails_loudly() {
    assert!(migrate::load("{ not json").is_err());
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test migration`
Expected: FAIL — `cannot find function load`

- [ ] **Step 3: Implementieren**

```rust
use serde_json::Value;

use super::LoadWarning;
use crate::model::{Project, SCHEMA_VERSION};
use crate::{CoreError, Result};

pub fn load(raw: &str) -> Result<(Project, Vec<LoadWarning>)> {
    let mut document: Value = serde_json::from_str(raw)?;
    let found = detect_version(&document);
    if found > SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchema(found));
    }
    let warnings = upgrade(&mut document, found);
    let mut project: Project = serde_json::from_value(document)?;
    project.normalize()?;
    Ok((project, warnings))
}

fn detect_version(document: &Value) -> u32 {
    document
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .map(|version| version as u32)
        .unwrap_or(1)
}

fn upgrade(document: &mut Value, from: u32) -> Vec<LoadWarning> {
    if let Some(object) = document.as_object_mut() {
        object.insert("schemaVersion".into(), Value::from(SCHEMA_VERSION));
    }
    if from == SCHEMA_VERSION {
        return Vec::new();
    }
    vec![LoadWarning::Migrated { from, to: SCHEMA_VERSION }]
}
```

`load` ist die Deserialisierungsgrenze und ruft deshalb `Project::normalize()`. Danach sind alle Keyframe-Spuren nach Zeit sortiert (was `evaluate` voraussetzt) und alle `Time`-Felder liegen innerhalb `Time::MAX_REASONABLE` — auch in verschachtelten Compound-Timelines, bis `MAX_COMPOUND_DEPTH = 8`. `normalize` ist fallibel, der Aufruf braucht also `?`: ein Projekt mit unmöglichen Zeiten scheitert laut beim Laden statt still zu kippen.

Zwei Tests dafür: ein Projekt-JSON mit absichtlich verdrehter Keyframe-Spur wird geladen und die Spur ist danach sortiert; ein Projekt-JSON mit `start = i64::MAX` scheitert mit `InvalidArgument`.

`upgrade` hat mit `SCHEMA_VERSION == 1` noch keine Schritte zu tun. Ab Version 2 kommt pro Sprung eine Funktion `fn v1_to_v2(document: &mut Value)` hinzu, die `upgrade` in Reihenfolge aufruft — die Signatur steht deshalb jetzt schon.

- [ ] **Step 4: Tests laufen lassen**

Run: `cargo test -p videola-core && cargo clippy -p videola-core -- -D warnings`
Expected: PASS — auch `tests/format_roundtrip.rs` aus Task 11 ist jetzt grün

- [ ] **Step 5: Committen**

```bash
git add crates/videola-core/src/format/migrate.rs crates/videola-core/tests/migration.rs
git commit -m "feat(core): Schema-Migration beim Laden

Migration laeuft auf dem JSON-Baum vor der Deserialisierung, damit
Feldumbauten moeglich sind, ohne alte Struct-Versionen im Code zu halten."
```

---

### Task 13: TypeScript-Typen generieren

**Files:**
- Create: `crates/videola-core/tests/export_types.rs`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Modify: `crates/videola-core/Cargo.toml` (ts-rs `export_to`)

**Interfaces:**
- Produces: `packages/core/src/generated/*.ts` mit TS-Typen für `Project`, `Track`, `Clip`, `Effect`, `Keyframe`, `ParamValue`, `Command`, `Dispatch`, `Manifest`, `LoadWarning`; pnpm-Workspace mit `@videola/core`.

- [ ] **Step 1: pnpm-Workspace anlegen**

`package.json`:
```json
{
  "name": "videola",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "gen:types": "cargo test -p videola-core --test export_types"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
  - apps/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "jsx": "react-jsx"
  }
}
```

`packages/core/package.json`:
```json
{
  "name": "@videola/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsc -p tsconfig.json --emitDeclarationOnly false --outDir dist"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 2: Export-Ziel in `Cargo.toml` setzen**

```toml
[package.metadata.ts-rs]
export_to = "../../packages/core/src/generated/"
```

Zusätzlich an jedem `#[derive(TS)]`-Typ, dessen Datei nicht direkt exportiert wird, `#[ts(export)]` ergänzen — konkret an `Project`, `ProjectMeta`, `ProjectSettings`, `MasterSettings`, `Timeline`, `Track`, `TrackKind`, `Marker`, `Clip`, `ClipSource`, `Generator`, `Speed`, `Transform`, `Crop`, `BlendMode`, `Fades`, `Effect`, `Transition`, `TransitionAlignment`, `Keyframe`, `Interp`, `ParamValue`, `MediaAsset`, `MediaKind`, `Command`, `TrimEdge`, `Dispatch`, `Manifest`, `LoadWarning`, `Rate`, `Time`.

- [ ] **Step 3: Failing test schreiben**

`crates/videola-core/tests/export_types.rs`:
```rust
use std::path::Path;

use ts_rs::TS;
use videola_core::command::{Command, Dispatch};
use videola_core::format::{LoadWarning, Manifest};
use videola_core::model::{Clip, Effect, Keyframe, ParamValue, Project};

#[test]
fn generated_bindings_land_in_the_core_package() {
    Project::export_all().expect("project types");
    Clip::export_all().expect("clip types");
    Effect::export_all().expect("effect types");
    Keyframe::export_all().expect("keyframe types");
    ParamValue::export_all().expect("param types");
    Command::export_all().expect("command types");
    Dispatch::export_all().expect("dispatch types");
    Manifest::export_all().expect("manifest types");
    LoadWarning::export_all().expect("warning types");

    let generated = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/core/src/generated");
    for name in ["Project.ts", "Clip.ts", "Command.ts", "ParamValue.ts"] {
        assert!(generated.join(name).exists(), "missing binding: {name}");
    }
}
```

`expect` ist hier zulässig: die Datei liegt unter `tests/`, wo die Clippy-Lints aus dem Workspace nicht als Produktivcode zählen. Falls Clippy trotzdem meckert, setze `#![allow(clippy::expect_used)]` an den Dateianfang.

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test export_types`
Expected: FAIL — die Dateien unter `packages/core/src/generated/` existieren noch nicht

- [ ] **Step 5: Generieren und Barrel-Datei anlegen**

```bash
cargo test -p videola-core --test export_types
ls packages/core/src/generated
```

`packages/core/src/generated/index.ts` von Hand anlegen und alle erzeugten Typen re-exportieren:
```ts
export type { Project } from "./Project";
export type { ProjectMeta } from "./ProjectMeta";
export type { ProjectSettings } from "./ProjectSettings";
export type { MasterSettings } from "./MasterSettings";
export type { Timeline } from "./Timeline";
export type { Track } from "./Track";
export type { TrackKind } from "./TrackKind";
export type { Marker } from "./Marker";
export type { Clip } from "./Clip";
export type { ClipSource } from "./ClipSource";
export type { Generator } from "./Generator";
export type { Speed } from "./Speed";
export type { Transform } from "./Transform";
export type { Crop } from "./Crop";
export type { BlendMode } from "./BlendMode";
export type { Fades } from "./Fades";
export type { Effect } from "./Effect";
export type { Transition } from "./Transition";
export type { TransitionAlignment } from "./TransitionAlignment";
export type { Keyframe } from "./Keyframe";
export type { Interp } from "./Interp";
export type { ParamValue } from "./ParamValue";
export type { MediaAsset } from "./MediaAsset";
export type { MediaKind } from "./MediaKind";
export type { Command } from "./Command";
export type { TrimEdge } from "./TrimEdge";
export type { Dispatch } from "./Dispatch";
export type { Manifest } from "./Manifest";
export type { LoadWarning } from "./LoadWarning";
export type { Rate } from "./Rate";
```

`Time` erscheint als `number` inline und braucht keinen Export.

Ergänze `packages/core/src/generated/` in `.gitignore` **nicht** — generierte Typen werden eingecheckt, damit `pnpm typecheck` ohne Rust-Toolchain läuft. Ein CI-Schritt prüft, dass sie aktuell sind (Task 20).

- [ ] **Step 6: Test laufen lassen**

Run: `cargo test -p videola-core --test export_types`
Expected: PASS

- [ ] **Step 7: Committen**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json packages/core \
        crates/videola-core/Cargo.toml crates/videola-core/tests/export_types.rs
git commit -m "feat(core): TypeScript-Typen aus dem Rust-Modell generieren

Generierte Typen sind eingecheckt, damit der Frontend-Typecheck ohne
Rust-Toolchain laeuft; CI prueft ihre Aktualitaet."
```

---

### Task 14: Medien-Commands

**Files:**
- Modify: `crates/videola-core/src/command/mod.rs`, `crates/videola-core/src/command/project.rs`
- Create: `crates/videola-core/tests/media_commands.rs`

**Interfaces:**
- Produces: `Command::MediaImport { asset: MediaAsset }` (serde `"media.import"`), `Command::MediaRemove { media: MediaId }` (serde `"media.remove"`). `MediaRemove` entfernt das Asset **und** alle Clips, die es referenzieren.

- [ ] **Step 1: Failing test schreiben**

`crates/videola-core/tests/media_commands.rs`:
```rust
use videola_core::command::{Command, Dispatch};
use videola_core::model::{ClipSource, MediaAsset, MediaId, MediaKind, Time, TrackKind};
use videola_core::Document;

fn asset(bytes: &[u8], name: &str) -> MediaAsset {
    MediaAsset::new(
        MediaId::from_bytes(bytes),
        name.to_string(),
        "video/mp4".into(),
        MediaKind::Video,
        bytes.len() as u64,
    )
}

#[test]
fn importing_registers_the_asset_in_the_library() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: asset(b"a", "a.mp4") })).unwrap();
    assert_eq!(doc.project().library.len(), 1);
    assert_eq!(doc.project().library[0].original_name, "a.mp4");
}

#[test]
fn importing_the_same_content_twice_keeps_one_entry() {
    let mut doc = Document::new();
    for name in ["a.mp4", "kopie.mp4"] {
        doc.dispatch(Dispatch::new(Command::MediaImport { asset: asset(b"a", name) })).unwrap();
    }
    assert_eq!(doc.project().library.len(), 1);
}

#[test]
fn removing_a_medium_also_removes_the_clips_that_use_it() {
    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media })).unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id })).unwrap();

    assert!(doc.project().library.is_empty());
    assert!(doc.project().timeline.tracks[0].clips.is_empty());
}

#[test]
fn removing_an_unknown_medium_fails() {
    let mut doc = Document::new();
    assert!(doc
        .dispatch(Dispatch::new(Command::MediaRemove {
            media: MediaId::from("med_ghost".to_string()),
        }))
        .is_err());
}

#[test]
fn undo_restores_both_library_and_clips() {
    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media })).unwrap();
    let before = serde_json::to_value(doc.project()).unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id })).unwrap();
    doc.undo().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core --test media_commands`
Expected: FAIL — `no variant MediaImport`

- [ ] **Step 3: Command-Varianten ergänzen**

In `crates/videola-core/src/command/mod.rs` in das `Command`-Enum:
```rust
    #[serde(rename = "media.import")]
    MediaImport { asset: MediaAsset },
    #[serde(rename = "media.remove")]
    MediaRemove { media: MediaId },
```

In `label()`:
```rust
            Self::MediaImport { .. } => "cmd.media.import",
            Self::MediaRemove { .. } => "cmd.media.remove",
```

In `apply()` die Weiche erweitern, sodass beide Varianten an `project::apply` gehen. Ergänze `MediaAsset` und `MediaId` im `use`-Block.

- [ ] **Step 4: Handler implementieren**

In `crates/videola-core/src/command/project.rs` in `apply` ergänzen:
```rust
        Command::MediaImport { asset } => {
            if !target.library.iter().any(|existing| existing.id == asset.id) {
                target.library.push(asset.clone());
            }
            Ok(())
        }
        Command::MediaRemove { media } => remove_media(target, media),
```

Und am Dateiende:
```rust
fn remove_media(target: &mut Project, media: &crate::model::MediaId) -> Result<()> {
    let before = target.library.len();
    target.library.retain(|asset| &asset.id != media);
    if target.library.len() == before {
        return Err(CoreError::MediaNotAvailable(media.clone()));
    }
    for track in target.timeline.tracks.iter_mut() {
        track.clips.retain(|clip| !uses_media(clip, media));
    }
    Ok(())
}

fn uses_media(clip: &crate::model::Clip, media: &crate::model::MediaId) -> bool {
    matches!(&clip.source, crate::model::ClipSource::Media { media: used } if used == media)
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `cargo test -p videola-core && cargo clippy -p videola-core -- -D warnings`
Expected: PASS

- [ ] **Step 6: Typen neu generieren und committen**

```bash
cargo test -p videola-core --test export_types
git add crates/videola-core packages/core/src/generated
git commit -m "feat(core): Medien-Commands

Import ist idempotent, weil MediaId der Inhalts-Hash ist; Entfernen nimmt
die referenzierenden Clips mit, damit kein Clip auf ein weggeraeumtes
Medium zeigt."
```

---

### Task 15: WASM-Bindings

**Files:**
- Create: `crates/videola-core-wasm/Cargo.toml`, `crates/videola-core-wasm/src/lib.rs`
- Create: `crates/videola-core-wasm/tests/api.rs`

**Interfaces:**
- Consumes: `Document`, `Dispatch`, `Project`, `MediaAsset`, `MediaId`, `format::{reader, writer, SaveOptions, MemoryMediaStore}`
- Produces: JS-Klasse `WasmDocument` mit `new()`, `static open(bytes: Uint8Array)`, `state(): Project`, `dispatch(dispatch: Dispatch): DispatchResult`, `undo()`, `redo()`, `save(options): Uint8Array`, `importMedia(name, mime, kind, bytes): string`, `mediaBytes(id): Uint8Array | undefined`, `warnings(): LoadWarning[]`, `historyLabels(): string[]`

- [ ] **Step 1: Crate anlegen**

```bash
cargo new --lib crates/videola-core-wasm --name videola-core-wasm --vcs none
cd crates/videola-core-wasm
cargo add videola-core --path ../videola-core
cargo add wasm-bindgen serde-wasm-bindgen serde_json
cargo add serde --features derive
cd ../..
```

`crates/videola-core-wasm/Cargo.toml` ergänzen:
```toml
[lib]
crate-type = ["cdylib", "rlib"]

[lints]
workspace = true
```

- [ ] **Step 2: Failing test schreiben**

`crates/videola-core-wasm/tests/api.rs` — getestet wird die plattformunabhängige Innenschicht, nicht die JS-Grenze:
```rust
use videola_core_wasm::inner::{DocumentHost, SaveRequest};

#[test]
fn a_fresh_host_has_an_empty_project_and_no_history() {
    let host = DocumentHost::new();
    assert!(host.project().timeline.tracks.is_empty());
    assert!(host.history_labels().is_empty());
}

#[test]
fn imported_media_is_addressable_by_its_returned_id() {
    let mut host = DocumentHost::new();
    let id = host
        .import_media("a.mp4".into(), "video/mp4".into(), "video".into(), b"bytes".to_vec())
        .unwrap();
    assert_eq!(host.project().library.len(), 1);
    assert_eq!(host.media_bytes(&id).as_deref(), Some(&b"bytes"[..]));
}

#[test]
fn save_then_open_restores_project_and_media() {
    let mut host = DocumentHost::new();
    let id = host
        .import_media("a.mp4".into(), "video/mp4".into(), "video".into(), b"bytes".to_vec())
        .unwrap();
    let bytes = host
        .save(SaveRequest {
            app_version: "0.0.0".into(),
            created: "2026-08-07T10:00:00Z".into(),
            modified: "2026-08-07T10:00:00Z".into(),
            locale: "de".into(),
            slim: true,
        })
        .unwrap();

    let reopened = DocumentHost::open(&bytes).unwrap();

    assert_eq!(reopened.project().library.len(), 1);
    assert_eq!(reopened.media_bytes(&id).as_deref(), Some(&b"bytes"[..]));
    assert!(reopened.warnings().is_empty());
}

#[test]
fn an_unknown_media_kind_is_rejected() {
    let mut host = DocumentHost::new();
    assert!(host
        .import_media("a.xyz".into(), "application/x".into(), "hologram".into(), vec![1])
        .is_err());
}

#[test]
fn opening_rubbish_fails_instead_of_panicking() {
    assert!(DocumentHost::open(b"not a zip").is_err());
}
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test -p videola-core-wasm`
Expected: FAIL — `unresolved import videola_core_wasm::inner`

- [ ] **Step 4: Innenschicht implementieren**

`crates/videola-core-wasm/src/inner.rs`:
```rust
use std::collections::BTreeMap;
use std::io::Cursor;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{reader, writer, LoadWarning, MediaStore, SaveOptions};
use videola_core::model::{MediaAsset, MediaId, MediaKind, Project};
use videola_core::{CoreError, DispatchResult, Document, Result};

pub struct SaveRequest {
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
    pub slim: bool,
}

#[derive(Default)]
struct Media(BTreeMap<MediaId, Vec<u8>>);

impl MediaStore for Media {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>> {
        self.0
            .get(id)
            .cloned()
            .ok_or_else(|| CoreError::MediaNotAvailable(id.clone()))
    }
}

pub struct DocumentHost {
    document: Document,
    media: Media,
    warnings: Vec<LoadWarning>,
}

impl Default for DocumentHost {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentHost {
    pub fn new() -> Self {
        Self { document: Document::new(), media: Media::default(), warnings: Vec::new() }
    }

    pub fn open(bytes: &[u8]) -> Result<Self> {
        let loaded = reader::read(Cursor::new(bytes.to_vec()))?;
        Ok(Self {
            document: Document::from_project(loaded.project),
            media: Media(loaded.media),
            warnings: loaded.warnings,
        })
    }

    pub fn project(&self) -> &Project {
        self.document.project()
    }

    pub fn warnings(&self) -> &[LoadWarning] {
        &self.warnings
    }

    pub fn history_labels(&self) -> Vec<&'static str> {
        self.document.history().labels()
    }

    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        self.document.dispatch(dispatch)
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        self.document.undo()
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        self.document.redo()
    }

    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> Result<MediaId> {
        let id = MediaId::from_bytes(&bytes);
        let asset = MediaAsset::new(
            id.clone(),
            original_name,
            mime,
            parse_kind(&kind)?,
            bytes.len() as u64,
        );
        self.media.0.insert(id.clone(), bytes);
        self.document.dispatch(Dispatch::new(Command::MediaImport { asset }))?;
        Ok(id)
    }

    pub fn media_bytes(&self, id: &MediaId) -> Option<Vec<u8>> {
        self.media.0.get(id).cloned()
    }

    pub fn save(&self, request: SaveRequest) -> Result<Vec<u8>> {
        let mut sink = Cursor::new(Vec::new());
        writer::write(
            &mut sink,
            self.document.project(),
            &self.media,
            &SaveOptions {
                app_version: request.app_version,
                created: request.created,
                modified: request.modified,
                locale: request.locale,
                slim: request.slim,
            },
        )?;
        Ok(sink.into_inner())
    }
}

fn parse_kind(kind: &str) -> Result<MediaKind> {
    match kind {
        "video" => Ok(MediaKind::Video),
        "audio" => Ok(MediaKind::Audio),
        "image" => Ok(MediaKind::Image),
        "font" => Ok(MediaKind::Font),
        other => Err(CoreError::InvalidArgument(format!("unknown media kind: {other}"))),
    }
}
```

- [ ] **Step 5: JS-Grenze implementieren**

`crates/videola-core-wasm/src/lib.rs`:
```rust
pub mod inner;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

use inner::{DocumentHost, SaveRequest};
use videola_core::command::Dispatch;
use videola_core::model::MediaId;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsSaveOptions {
    app_version: String,
    created: String,
    modified: String,
    locale: String,
    #[serde(default)]
    slim: bool,
}

#[wasm_bindgen]
pub struct WasmDocument {
    host: DocumentHost,
}

#[wasm_bindgen]
impl WasmDocument {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmDocument {
        WasmDocument { host: DocumentHost::new() }
    }

    pub fn open(bytes: &[u8]) -> std::result::Result<WasmDocument, JsError> {
        Ok(WasmDocument { host: DocumentHost::open(bytes).map_err(to_js)? })
    }

    pub fn state(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(self.host.project()).map_err(JsError::from)
    }

    pub fn warnings(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(self.host.warnings()).map_err(JsError::from)
    }

    #[wasm_bindgen(js_name = historyLabels)]
    pub fn history_labels(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.host.history_labels()).map_err(JsError::from)
    }

    pub fn dispatch(&mut self, dispatch: JsValue) -> std::result::Result<JsValue, JsError> {
        let parsed: Dispatch = serde_wasm_bindgen::from_value(dispatch)?;
        let result = self.host.dispatch(parsed).map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
    }

    pub fn undo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.undo().map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
    }

    pub fn redo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.redo().map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
    }

    #[wasm_bindgen(js_name = importMedia)]
    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> std::result::Result<String, JsError> {
        Ok(self
            .host
            .import_media(original_name, mime, kind, bytes)
            .map_err(to_js)?
            .to_string())
    }

    #[wasm_bindgen(js_name = mediaBytes)]
    pub fn media_bytes(&self, id: String) -> Option<Vec<u8>> {
        self.host.media_bytes(&MediaId::from(id))
    }

    pub fn save(&self, options: JsValue) -> std::result::Result<Vec<u8>, JsError> {
        let parsed: JsSaveOptions = serde_wasm_bindgen::from_value(options)?;
        self.host
            .save(SaveRequest {
                app_version: parsed.app_version,
                created: parsed.created,
                modified: parsed.modified,
                locale: parsed.locale,
                slim: parsed.slim,
            })
            .map_err(to_js)
    }
}

impl Default for WasmDocument {
    fn default() -> Self {
        Self::new()
    }
}

fn to_js(error: videola_core::CoreError) -> JsError {
    JsError::new(&error.to_string())
}
```

Die JS-Grenze übersetzt nur — alle Regeln liegen in `inner`, damit sie ohne Browser testbar bleiben.

- [ ] **Step 6: Tests laufen lassen und WASM bauen**

```bash
cargo test -p videola-core-wasm
cargo install wasm-pack --locked
wasm-pack build crates/videola-core-wasm --target web --out-dir ../../packages/core/src/wasm --out-name videola_core
```
Expected: Tests PASS, `packages/core/src/wasm/videola_core.js` und `.wasm` entstehen

- [ ] **Step 7: WASM-Ausgabe ignorieren und committen**

In `.gitignore` ergänzen:
```
packages/core/src/wasm
```

```bash
git add crates/videola-core-wasm .gitignore Cargo.toml
git commit -m "feat(core): WASM-Bindings fuer den Kern

Regeln liegen in inner und sind ohne Browser testbar; die
wasm-bindgen-Schicht uebersetzt nur zwischen JS und Rust."
```

---

### Task 16: `@videola/core` — TypeScript-Fassade

**Files:**
- Create: `packages/core/src/index.ts`, `packages/core/src/commands.ts`, `packages/core/src/document.ts`, `packages/core/src/backend.ts`, `packages/core/src/wasm-backend.ts`
- Create: `packages/core/src/document.test.ts`, `packages/core/src/commands.test.ts`
- Create: `packages/core/vitest.config.ts`

**Interfaces:**
- Consumes: generierte Typen aus `./generated`
- Produces: `cmd` (typisierte Command-Fabriken), `DocumentBackend` (Interface), `VideolaDocument` (`state`, `dispatch`, `undo`, `redo`, `save`, `importMedia`, `subscribe`, `canUndo`, `canRedo`), `createWasmBackend()`

- [ ] **Step 1: Test-Werkzeuge installieren**

```bash
pnpm add -D -w typescript vitest
pnpm add -D --filter @videola/core typescript vitest
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Failing tests schreiben**

`packages/core/src/commands.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { cmd, secondsToTime, timeToSeconds } from "./index";

describe("command factories", () => {
  it("emits the wire format the Rust core expects", () => {
    expect(cmd.trackAdd("video", "V1")).toEqual({
      type: "track.add",
      kind: "video",
      name: "V1",
      index: null,
    });
  });

  it("passes an explicit index through", () => {
    expect(cmd.trackAdd("audio", "A1", 0).index).toBe(0);
  });

  it("builds clip splits with integer flick times", () => {
    const command = cmd.clipSplit("clp_1", secondsToTime(1.5));
    expect(command).toEqual({ type: "clip.split", clip: "clp_1", at: 1058400000 });
    expect(Number.isInteger(command.at)).toBe(true);
  });
});

describe("time conversion", () => {
  it("round-trips whole and fractional seconds", () => {
    for (const seconds of [0, 1, 2.5, 0.04166666]) {
      expect(timeToSeconds(secondsToTime(seconds))).toBeCloseTo(seconds, 6);
    }
  });

  it("stays inside the safe integer range for a four hour timeline", () => {
    expect(secondsToTime(4 * 3600)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
```

`packages/core/src/document.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentBackend } from "./backend";
import { cmd, VideolaDocument } from "./index";
import type { Project } from "./generated";

function emptyProject(): Project {
  return {
    schemaVersion: 1,
    meta: { id: "prj_1", title: "", tags: [] },
    settings: {
      width: 1920,
      height: 1080,
      fps: { numerator: 30, denominator: 1 },
      sampleRate: 48000,
      colorSpace: "srgb",
      background: "#000000",
    },
    library: [],
    timeline: { tracks: [] },
    markers: [],
    master: { volume: 1, effects: [] },
  } as Project;
}

function fakeBackend(): DocumentBackend {
  let project = emptyProject();
  return {
    state: () => project,
    dispatch: vi.fn((dispatch) => {
      if (dispatch.command.type === "track.add") {
        project = {
          ...project,
          timeline: { tracks: [...project.timeline.tracks, { name: "V1" } as never] },
        };
        return { patch: [], label: "cmd.track.add", canUndo: true, canRedo: false };
      }
      throw new Error("boom");
    }),
    undo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: false, canRedo: true })),
    redo: vi.fn(() => ({ patch: [], label: "cmd.track.add", canUndo: true, canRedo: false })),
    save: vi.fn(() => new Uint8Array([1, 2, 3])),
    importMedia: vi.fn(() => "med_abc"),
    warnings: () => [],
  };
}

describe("VideolaDocument", () => {
  let doc: VideolaDocument;

  beforeEach(() => {
    doc = new VideolaDocument(fakeBackend());
  });

  it("notifies subscribers after a successful dispatch", () => {
    const seen: number[] = [];
    doc.subscribe((project) => seen.push(project.timeline.tracks.length));
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(seen).toEqual([1]);
  });

  it("tracks undo and redo availability from the backend result", () => {
    expect(doc.canUndo).toBe(false);
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);
  });

  it("does not notify subscribers when a dispatch throws", () => {
    const listener = vi.fn();
    doc.subscribe(listener);
    expect(() => doc.dispatch(cmd.clipRemove("clp_missing"))).toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it("forwards a coalesce key so drags collapse into one undo step", () => {
    const backend = fakeBackend();
    const document = new VideolaDocument(backend);
    document.dispatch(cmd.trackAdd("video", "V1"), "drag");
    expect(backend.dispatch).toHaveBeenCalledWith({
      command: { type: "track.add", kind: "video", name: "V1", index: null },
      coalesceKey: "drag",
    });
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = doc.subscribe(listener);
    off();
    doc.dispatch(cmd.trackAdd("video", "V1"));
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --filter @videola/core test`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 4: `backend.ts` implementieren**

```ts
import type { Command, Dispatch, LoadWarning, Project } from "./generated";

export interface DispatchResult {
  patch: unknown;
  label: string;
  canUndo: boolean;
  canRedo: boolean;
}

export interface SaveOptions {
  appVersion: string;
  created: string;
  modified: string;
  locale: string;
  slim: boolean;
}

export type MediaKindName = "video" | "audio" | "image" | "font";

export interface DocumentBackend {
  state(): Project;
  dispatch(dispatch: Dispatch): DispatchResult;
  undo(): DispatchResult;
  redo(): DispatchResult;
  save(options: SaveOptions): Uint8Array;
  importMedia(name: string, mime: string, kind: MediaKindName, bytes: Uint8Array): string;
  warnings(): LoadWarning[];
}
```

`backend.ts` re-exportiert **keine** generierten Typen: `index.ts` gibt `./generated` schon mit `export *` weiter, und ein zweiter Pfad für denselben Namen bricht den Typecheck.

- [ ] **Step 5: `commands.ts` implementieren**

```ts
import type { BlendMode, ClipSource, Command, ParamValue, TrackKind } from "./generated";

export const FLICKS_PER_SECOND = 705_600_000;

export function secondsToTime(seconds: number): number {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

export function timeToSeconds(time: number): number {
  return time / FLICKS_PER_SECOND;
}

export function framesToTime(frame: number, fps: number): number {
  return Math.round((frame * FLICKS_PER_SECOND) / fps);
}

export const cmd = {
  projectSetTitle: (title: string): Command => ({ type: "project.setTitle", title }),

  trackAdd: (kind: TrackKind, name: string, index: number | null = null): Command => ({
    type: "track.add",
    kind,
    name,
    index,
  }),
  trackRemove: (track: string): Command => ({ type: "track.remove", track }),
  trackRename: (track: string, name: string): Command => ({ type: "track.rename", track, name }),
  trackSetVolume: (track: string, volume: number): Command => ({
    type: "track.setVolume",
    track,
    volume,
  }),

  clipAdd: (track: string, source: ClipSource, start: number, duration: number): Command => ({
    type: "clip.add",
    track,
    source,
    start,
    duration,
  }),
  clipRemove: (clip: string): Command => ({ type: "clip.remove", clip }),
  clipMove: (clip: string, toTrack: string, start: number): Command => ({
    type: "clip.move",
    clip,
    toTrack,
    start,
  }),
  clipTrim: (clip: string, edge: "start" | "end", delta: number): Command => ({
    type: "clip.trim",
    clip,
    edge,
    delta,
  }),
  clipSplit: (clip: string, at: number): Command => ({ type: "clip.split", clip, at }),
  clipSetSpeed: (
    clip: string,
    rate: number,
    reverse: boolean,
    preservePitch = true,
  ): Command => ({ type: "clip.setSpeed", clip, rate, reverse, preservePitch }),

  effectAdd: (clip: string, effectType: string): Command => ({
    type: "effect.add",
    clip,
    effectType,
  }),
  effectSetParam: (
    clip: string,
    effectType: string,
    key: string,
    value: ParamValue,
  ): Command => ({ type: "effect.setParam", clip, effectType, key, value }),

  mediaRemove: (media: string): Command => ({ type: "media.remove", media }),
} satisfies Record<string, (...args: never[]) => Command>;
```

`BlendMode` wird hier nicht re-exportiert — der Typ kommt aus `./generated` und darf nur einen Exportpfad haben.

Die Fabriken sind der einzige Ort, an dem Command-Namen als Zeichenkette auftauchen. `satisfies` erzwingt, dass jede Fabrik ein `Command` liefert — ein Tippfehler im `type` bricht den Typecheck, nicht erst die Laufzeit.

- [ ] **Step 6: `document.ts` implementieren**

```ts
import type { DispatchResult, DocumentBackend, MediaKindName, SaveOptions } from "./backend";
import type { Command, LoadWarning, Project } from "./generated";

type Listener = (project: Project) => void;

export class VideolaDocument {
  #backend: DocumentBackend;
  #listeners = new Set<Listener>();
  #canUndo = false;
  #canRedo = false;

  constructor(backend: DocumentBackend) {
    this.#backend = backend;
  }

  get state(): Project {
    return this.#backend.state();
  }

  get canUndo(): boolean {
    return this.#canUndo;
  }

  get canRedo(): boolean {
    return this.#canRedo;
  }

  get warnings(): LoadWarning[] {
    return this.#backend.warnings();
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispatch(command: Command, coalesceKey?: string): DispatchResult {
    const result = this.#backend.dispatch(
      coalesceKey === undefined ? { command } : { command, coalesceKey },
    );
    this.#absorb(result);
    return result;
  }

  undo(): DispatchResult {
    return this.#absorb(this.#backend.undo());
  }

  redo(): DispatchResult {
    return this.#absorb(this.#backend.redo());
  }

  importMedia(file: { name: string; type: string }, bytes: Uint8Array): string {
    const id = this.#backend.importMedia(file.name, file.type, mediaKind(file.type), bytes);
    this.#notify();
    return id;
  }

  save(options: SaveOptions): Uint8Array {
    return this.#backend.save(options);
  }

  #absorb(result: DispatchResult): DispatchResult {
    this.#canUndo = result.canUndo;
    this.#canRedo = result.canRedo;
    this.#notify();
    return result;
  }

  #notify(): void {
    const project = this.#backend.state();
    for (const listener of this.#listeners) {
      listener(project);
    }
  }
}

function mediaKind(mime: string): MediaKindName {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/")) return "font";
  throw new Error(`unsupported media type: ${mime}`);
}
```

- [ ] **Step 7: `wasm-backend.ts` und `index.ts` implementieren**

`packages/core/src/wasm-backend.ts`:
```ts
import init, { WasmDocument } from "./wasm/videola_core.js";

import type { DispatchResult, DocumentBackend, MediaKindName, SaveOptions } from "./backend";
import type { Dispatch, LoadWarning, Project } from "./generated";

let ready: Promise<unknown> | undefined;

async function ensureReady(): Promise<void> {
  ready ??= init();
  await ready;
}

export async function createWasmBackend(bytes?: Uint8Array): Promise<DocumentBackend> {
  await ensureReady();
  const document = bytes === undefined ? new WasmDocument() : WasmDocument.open(bytes);
  return {
    state: () => document.state() as Project,
    dispatch: (dispatch: Dispatch) => document.dispatch(dispatch) as DispatchResult,
    undo: () => document.undo() as DispatchResult,
    redo: () => document.redo() as DispatchResult,
    save: (options: SaveOptions) => document.save(options),
    importMedia: (name: string, mime: string, kind: MediaKindName, media: Uint8Array) =>
      document.importMedia(name, mime, kind, media),
    warnings: () => document.warnings() as LoadWarning[],
  };
}
```

`packages/core/src/index.ts`:
```ts
export * from "./backend";
export * from "./commands";
export * from "./document";
export * from "./generated";
export { createWasmBackend } from "./wasm-backend";
```

- [ ] **Step 8: Tests laufen lassen**

Run: `pnpm --filter @videola/core test && pnpm --filter @videola/core typecheck`
Expected: PASS. Falls `typecheck` das WASM-Modul nicht findet, baue es vorher (`wasm-pack build …` aus Task 15) — die Datei ist absichtlich nicht eingecheckt.

- [ ] **Step 9: Committen**

```bash
git add packages/core package.json pnpm-lock.yaml
git commit -m "feat(core): TypeScript-Fassade fuer den WASM-Kern

Command-Namen stehen ausschliesslich in den Fabriken; das Backend ist ein
Interface, damit die Fassade ohne WASM testbar bleibt."
```

---

### Task 17: Theme

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/theme/tokens.css`, `packages/ui/src/theme/ThemeProvider.tsx`, `packages/ui/src/theme/useTheme.ts`
- Create: `packages/ui/src/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Produces: `ThemeProvider` (React-Komponente), `useTheme() -> { theme: "dark" | "light", preference: ThemePreference, setPreference }`, `ThemePreference = "system" | "dark" | "light"`, CSS-Variablen-Tokens für beide Themes.

- [ ] **Step 1: Paket und Test-Werkzeuge anlegen**

Zuerst die Manifeste schreiben, dann installieren.

`packages/ui/package.json`:
```json
{
  "name": "@videola/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

`packages/ui/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.{ts,tsx}"] },
});
```

Jetzt installieren:
```bash
mkdir -p packages/ui/src/theme
pnpm add --filter @videola/ui react react-dom
pnpm add -D --filter @videola/ui typescript vitest jsdom @testing-library/react \
  @testing-library/dom @types/react @types/react-dom
```

- [ ] **Step 2: Failing test schreiben**

`packages/ui/src/theme/ThemeProvider.test.tsx`:
```tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "./ThemeProvider";
import { useTheme } from "./useTheme";

function mockSystemPrefersDark(dark: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("dark") ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function Probe(): JSX.Element {
  const { theme, preference, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="preference">{preference}</span>
      <button onClick={() => setPreference("light")}>light</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("follows the system preference when nothing is stored", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("preference").textContent).toBe("system");
  });

  it("falls back to dark when the system prefers light but nothing is stored", () => {
    mockSystemPrefersDark(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("stamps the resolved theme on the root element", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists an explicit choice and wins over the system", () => {
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => screen.getByRole("button", { name: "light" }).click());
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(localStorage.getItem("videola.theme")).toBe("light");
  });

  it("restores a stored choice on mount", () => {
    localStorage.setItem("videola.theme", "light");
    mockSystemPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --filter @videola/ui test`
Expected: FAIL — `Cannot find module './ThemeProvider'`

- [ ] **Step 4: `tokens.css` implementieren**

```css
:root {
  --v-radius-sm: 4px;
  --v-radius-md: 8px;
  --v-radius-lg: 14px;
  --v-space-1: 4px;
  --v-space-2: 8px;
  --v-space-3: 12px;
  --v-space-4: 16px;
  --v-space-6: 24px;
  --v-font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --v-font-mono: ui-monospace, "Cascadia Mono", "Fira Code", monospace;
  --v-touch-target: 44px;
  --v-transition: 140ms cubic-bezier(0.2, 0, 0.2, 1);
}

:root[data-theme="dark"] {
  --v-bg: #101216;
  --v-bg-elevated: #171a20;
  --v-bg-sunken: #0b0d10;
  --v-surface: #1e222a;
  --v-surface-hover: #262b35;
  --v-border: #2c313c;
  --v-border-strong: #3c434f;
  --v-text: #e8ecf2;
  --v-text-muted: #9aa4b2;
  --v-accent: #5b8cff;
  --v-accent-hover: #7aa2ff;
  --v-accent-contrast: #0b0d10;
  --v-danger: #ff6b6b;
  --v-success: #2ea043;
  --v-warning: #f0a030;
  --v-focus: #6bd6ff;
  --v-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}

:root[data-theme="light"] {
  --v-bg: #f6f7f9;
  --v-bg-elevated: #ffffff;
  --v-bg-sunken: #eceef2;
  --v-surface: #ffffff;
  --v-surface-hover: #eef1f6;
  --v-border: #d8dce4;
  --v-border-strong: #b7bec9;
  --v-text: #16191f;
  --v-text-muted: #5c6470;
  --v-accent: #2f6bff;
  --v-accent-hover: #1a55e6;
  --v-accent-contrast: #ffffff;
  --v-danger: #d13438;
  --v-success: #107c10;
  --v-warning: #b4690e;
  --v-focus: #0f6cbd;
  --v-shadow: 0 6px 18px rgb(16 22 32 / 12%);
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--v-bg);
  color: var(--v-text);
  font-family: var(--v-font-ui);
}

:focus-visible {
  outline: 2px solid var(--v-focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 5: `useTheme.ts` und `ThemeProvider.tsx` implementieren**

`packages/ui/src/theme/useTheme.ts`:
```ts
import { createContext, useContext } from "react";

export type Theme = "dark" | "light";
export type ThemePreference = "system" | Theme;

export interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) {
    throw new Error("useTheme requires a ThemeProvider");
  }
  return value;
}
```

`packages/ui/src/theme/ThemeProvider.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { ThemeContext, type Theme, type ThemePreference } from "./useTheme";
import "./tokens.css";

const STORAGE_KEY = "videola.theme";

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [preference, setStoredPreference] = useState<ThemePreference>(readPreference);
  const theme = preference === "system" ? systemTheme() : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(() => ({ theme, preference, setPreference }), [
    theme,
    preference,
    setPreference,
  ]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "system";
}

function systemTheme(): Theme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @videola/ui test`
Expected: PASS

- [ ] **Step 7: Committen**

```bash
git add packages/ui
git commit -m "feat(ui): Theme mit CSS-Variablen fuer Dark und Light

Das aufgeloeste Theme landet als data-theme am Wurzelelement, damit die
Tokens ohne JavaScript im Render-Pfad greifen."
```

---

### Task 18: Zweisprachigkeit

**Files:**
- Create: `packages/ui/src/i18n/catalogs/de.json`, `packages/ui/src/i18n/catalogs/en.json`
- Create: `packages/ui/src/i18n/I18nProvider.tsx`, `packages/ui/src/i18n/useI18n.ts`, `packages/ui/src/i18n/translate.ts`
- Create: `packages/ui/src/i18n/translate.test.ts`, `packages/ui/src/i18n/I18nProvider.test.tsx`

**Interfaces:**
- Produces: `I18nProvider`, `useI18n() -> { t, locale, setLocale, formatNumber, formatTimecode }`, `Locale = "de" | "en"`, `translate(catalog, key, vars?) -> string`

- [ ] **Step 1: Failing tests schreiben**

`packages/ui/src/i18n/translate.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { translate } from "./translate";

const catalog = {
  "app.title": "Videola",
  "track.count": "{count} Spur | {count} Spuren",
  "clip.renamed": "{name} umbenannt",
};

describe("translate", () => {
  it("returns the plain string for a known key", () => {
    expect(translate(catalog, "app.title")).toBe("Videola");
  });

  it("returns the key itself when it is missing so gaps are visible", () => {
    expect(translate(catalog, "nope.missing")).toBe("nope.missing");
  });

  it("interpolates named variables", () => {
    expect(translate(catalog, "clip.renamed", { name: "Intro" })).toBe("Intro umbenannt");
  });

  it("leaves unknown placeholders untouched instead of printing undefined", () => {
    expect(translate(catalog, "clip.renamed", {})).toBe("{name} umbenannt");
  });

  it("picks the singular form for exactly one", () => {
    expect(translate(catalog, "track.count", { count: 1 })).toBe("1 Spur");
  });

  it("picks the plural form for anything else, zero included", () => {
    expect(translate(catalog, "track.count", { count: 0 })).toBe("0 Spuren");
    expect(translate(catalog, "track.count", { count: 5 })).toBe("5 Spuren");
  });
});
```

`packages/ui/src/i18n/I18nProvider.test.tsx`:
```tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "./I18nProvider";
import { useI18n } from "./useI18n";

function Probe(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="label">{t("action.save")}</span>
      <button onClick={() => setLocale(locale === "de" ? "en" : "de")}>toggle</button>
    </div>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => localStorage.clear());

  it("starts in German by default", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("de");
    expect(screen.getByTestId("label").textContent).toBe("Speichern");
  });

  it("switches language without remounting and persists the choice", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("label").textContent).toBe("Save");
    expect(localStorage.getItem("videola.locale")).toBe("en");
  });

  it("restores a stored locale on mount", () => {
    localStorage.setItem("videola.locale", "en");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("sets the document language so screen readers pick it up", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe("de");
  });
});
```

Ergänze zusätzlich einen Vollständigkeitstest, der die beiden Kataloge gegeneinander prüft — er ist der Grund, warum später keine Sprache zurückfällt:

`packages/ui/src/i18n/catalogs.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import de from "./catalogs/de.json";
import en from "./catalogs/en.json";

describe("catalogs", () => {
  it("cover exactly the same keys in both languages", () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty values", () => {
    for (const [key, value] of [...Object.entries(de), ...Object.entries(en)]) {
      expect(value, key).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --filter @videola/ui test`
Expected: FAIL — `Cannot find module './translate'`

- [ ] **Step 3: Kataloge anlegen**

`packages/ui/src/i18n/catalogs/de.json`:
```json
{
  "app.title": "Videola",
  "app.subtitle": "Video-Editor",
  "action.new": "Neues Projekt",
  "action.open": "Öffnen",
  "action.save": "Speichern",
  "action.undo": "Rückgängig",
  "action.redo": "Wiederholen",
  "action.import": "Medien importieren",
  "theme.label": "Erscheinungsbild",
  "theme.system": "System",
  "theme.dark": "Dunkel",
  "theme.light": "Hell",
  "locale.label": "Sprache",
  "layout.desktop": "Desktop",
  "layout.tablet": "Tablet",
  "layout.phone": "Telefon",
  "layout.auto": "Automatisch",
  "project.untitled": "Unbenanntes Projekt",
  "project.trackCount": "{count} Spur | {count} Spuren",
  "cmd.project.setSettings": "Projekteinstellungen geändert",
  "cmd.project.setTitle": "Titel geändert",
  "cmd.track.add": "Spur hinzugefügt",
  "cmd.track.remove": "Spur entfernt",
  "cmd.track.reorder": "Spur verschoben",
  "cmd.track.rename": "Spur umbenannt",
  "cmd.track.setVolume": "Spurlautstärke geändert",
  "cmd.track.setPan": "Panorama geändert",
  "cmd.track.setFlags": "Spureigenschaften geändert",
  "cmd.clip.add": "Clip hinzugefügt",
  "cmd.clip.remove": "Clip entfernt",
  "cmd.clip.move": "Clip verschoben",
  "cmd.clip.trim": "Clip getrimmt",
  "cmd.clip.split": "Clip geteilt",
  "cmd.clip.setSpeed": "Geschwindigkeit geändert",
  "cmd.clip.setVolume": "Clip-Lautstärke geändert",
  "cmd.effect.add": "Effekt hinzugefügt",
  "cmd.effect.setParam": "Effektparameter geändert",
  "cmd.media.import": "Medien importiert",
  "cmd.media.remove": "Medium entfernt",
  "error.openFailed": "Projekt konnte nicht geöffnet werden: {reason}",
  "error.saveFailed": "Projekt konnte nicht gespeichert werden: {reason}",
  "error.unsupportedMedia": "Dieser Dateityp wird nicht unterstützt: {mime}",
  "warning.missingMedia": "{count} Medium fehlt im Projekt | {count} Medien fehlen im Projekt",
  "empty.noTracks": "Noch keine Spuren. Ziehe Medien hierher, um anzufangen."
}
```

`packages/ui/src/i18n/catalogs/en.json`:
```json
{
  "app.title": "Videola",
  "app.subtitle": "Video editor",
  "action.new": "New project",
  "action.open": "Open",
  "action.save": "Save",
  "action.undo": "Undo",
  "action.redo": "Redo",
  "action.import": "Import media",
  "theme.label": "Appearance",
  "theme.system": "System",
  "theme.dark": "Dark",
  "theme.light": "Light",
  "locale.label": "Language",
  "layout.desktop": "Desktop",
  "layout.tablet": "Tablet",
  "layout.phone": "Phone",
  "layout.auto": "Automatic",
  "project.untitled": "Untitled project",
  "project.trackCount": "{count} track | {count} tracks",
  "cmd.project.setSettings": "Project settings changed",
  "cmd.project.setTitle": "Title changed",
  "cmd.track.add": "Track added",
  "cmd.track.remove": "Track removed",
  "cmd.track.reorder": "Track moved",
  "cmd.track.rename": "Track renamed",
  "cmd.track.setVolume": "Track volume changed",
  "cmd.track.setPan": "Pan changed",
  "cmd.track.setFlags": "Track properties changed",
  "cmd.clip.add": "Clip added",
  "cmd.clip.remove": "Clip removed",
  "cmd.clip.move": "Clip moved",
  "cmd.clip.trim": "Clip trimmed",
  "cmd.clip.split": "Clip split",
  "cmd.clip.setSpeed": "Speed changed",
  "cmd.clip.setVolume": "Clip volume changed",
  "cmd.effect.add": "Effect added",
  "cmd.effect.setParam": "Effect parameter changed",
  "cmd.media.import": "Media imported",
  "cmd.media.remove": "Media removed",
  "error.openFailed": "Could not open the project: {reason}",
  "error.saveFailed": "Could not save the project: {reason}",
  "error.unsupportedMedia": "This file type is not supported: {mime}",
  "warning.missingMedia": "{count} medium is missing from the project | {count} media are missing from the project",
  "empty.noTracks": "No tracks yet. Drop media here to get started."
}
```

Die `cmd.*`-Schlüssel entsprechen exakt den `label()`-Rückgaben aus Task 6 — die Undo-Historie ist damit zweisprachig, ohne dass Rust Text kennt.

- [ ] **Step 4: `translate.ts` implementieren**

```ts
export type Catalog = Record<string, string>;
export type Vars = Record<string, string | number>;

export function translate(catalog: Catalog, key: string, vars?: Vars): string {
  const template = catalog[key];
  if (template === undefined) {
    return key;
  }
  return interpolate(selectPlural(template, vars), vars);
}

function selectPlural(template: string, vars?: Vars): string {
  const forms = template.split(" | ");
  if (forms.length < 2) {
    return template;
  }
  const count = vars?.count;
  const singular = forms[0] ?? template;
  const plural = forms[1] ?? singular;
  return typeof count === "number" && count === 1 ? singular : plural;
}

function interpolate(template: string, vars?: Vars): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
```

Ein fehlender Schlüssel gibt den Schlüssel zurück statt leerem Text: eine Lücke fällt so beim Ansehen der Oberfläche auf, statt lautlos zu verschwinden.

`ponytail: Pluralformen sind auf Singular/Plural beschränkt (reicht für de und en). Sobald eine Sprache mit mehr Kategorien dazukommt, auf Intl.PluralRules mit benannten Formen umstellen — die Katalogsyntax bleibt dabei erweiterbar.`

- [ ] **Step 5: `useI18n.ts` und `I18nProvider.tsx` implementieren**

`packages/ui/src/i18n/useI18n.ts`:
```ts
import { createContext, useContext } from "react";

import type { Vars } from "./translate";

export type Locale = "de" | "en";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Vars) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatTimecode: (seconds: number) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (value === undefined) {
    throw new Error("useI18n requires an I18nProvider");
  }
  return value;
}
```

`packages/ui/src/i18n/I18nProvider.tsx`:
```tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import de from "./catalogs/de.json";
import en from "./catalogs/en.json";
import { translate, type Catalog, type Vars } from "./translate";
import { I18nContext, type Locale } from "./useI18n";

const STORAGE_KEY = "videola.locale";
const CATALOGS: Record<Locale, Catalog> = { de, en };

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setStoredLocale] = useState<Locale>(readLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setStoredLocale(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo(() => {
    const catalog = CATALOGS[locale];
    return {
      locale,
      setLocale,
      t: (key: string, vars?: Vars) => translate(catalog, key, vars),
      formatNumber: (input: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options).format(input),
      formatTimecode: (seconds: number) => formatTimecode(seconds),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function readLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "de" || stored === "en") {
    return stored;
  }
  return navigator.language.startsWith("en") ? "en" : "de";
}

function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const frames = Math.floor((seconds - total) * 100);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(rest)}.${pad(frames)}`;
}
```

`readLocale` bevorzugt Deutsch, weil das die Primärsprache des Projekts ist; Englisch greift, wenn der Browser es meldet.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @videola/ui test`
Expected: PASS

- [ ] **Step 7: Committen**

```bash
git add packages/ui/src/i18n
git commit -m "feat(ui): Zweisprachigkeit mit Katalogen fuer de und en

Ein Test vergleicht die Schluesselmengen beider Kataloge, damit keine
Sprache zurueckfaellt; fehlende Schluessel zeigen sich als Schluesselname
statt als Leerstelle."
```

---

### Task 19: Layout-Modus-Erkennung

**Files:**
- Create: `packages/ui/src/layout/useLayoutMode.ts`, `packages/ui/src/layout/detectLayoutMode.ts`
- Create: `packages/ui/src/layout/detectLayoutMode.test.ts`, `packages/ui/src/layout/useLayoutMode.test.tsx`

**Interfaces:**
- Produces: `LayoutMode = "desktop" | "tablet" | "phone"`, `LayoutPreference = "auto" | LayoutMode`, `detectLayoutMode({ width, hasFinePointer }) -> LayoutMode`, `useLayoutMode(preference) -> LayoutMode`, Konstanten `TABLET_MIN_WIDTH = 768`, `DESKTOP_MIN_WIDTH = 1280`

- [ ] **Step 1: Failing tests schreiben**

`packages/ui/src/layout/detectLayoutMode.test.ts`:
```ts
import { describe, expect, it } from "vitest";

import { detectLayoutMode } from "./detectLayoutMode";

describe("detectLayoutMode", () => {
  it("treats narrow viewports as a phone regardless of pointer", () => {
    expect(detectLayoutMode({ width: 390, hasFinePointer: false })).toBe("phone");
    expect(detectLayoutMode({ width: 767, hasFinePointer: true })).toBe("phone");
  });

  it("treats mid widths as a tablet", () => {
    expect(detectLayoutMode({ width: 768, hasFinePointer: true })).toBe("tablet");
    expect(detectLayoutMode({ width: 1279, hasFinePointer: true })).toBe("tablet");
  });

  it("treats wide viewports with a mouse as a desktop", () => {
    expect(detectLayoutMode({ width: 1280, hasFinePointer: true })).toBe("desktop");
    expect(detectLayoutMode({ width: 2560, hasFinePointer: true })).toBe("desktop");
  });

  it("keeps a wide touch-only screen in tablet mode so targets stay large", () => {
    expect(detectLayoutMode({ width: 1920, hasFinePointer: false })).toBe("tablet");
  });
});
```

`packages/ui/src/layout/useLayoutMode.test.tsx`:
```tsx
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLayoutMode } from "./useLayoutMode";

function setViewport(width: number, hasFinePointer: boolean): void {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("any-pointer: fine") ? hasFinePointer : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("useLayoutMode", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("detects the mode from the viewport when set to auto", () => {
    setViewport(1440, true);
    const { result } = renderHook(() => useLayoutMode("auto"));
    expect(result.current).toBe("desktop");
  });

  it("lets an explicit preference win over detection", () => {
    setViewport(390, false);
    const { result } = renderHook(() => useLayoutMode("desktop"));
    expect(result.current).toBe("desktop");
  });

  it("subscribes to resize so a rotated tablet re-evaluates", () => {
    setViewport(1024, true);
    const addEventListener = vi.spyOn(window, "addEventListener");
    renderHook(() => useLayoutMode("auto"));
    expect(addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --filter @videola/ui test`
Expected: FAIL — `Cannot find module './detectLayoutMode'`

- [ ] **Step 3: `detectLayoutMode.ts` implementieren**

```ts
export type LayoutMode = "desktop" | "tablet" | "phone";
export type LayoutPreference = "auto" | LayoutMode;

export const TABLET_MIN_WIDTH = 768;
export const DESKTOP_MIN_WIDTH = 1280;

export interface Viewport {
  width: number;
  hasFinePointer: boolean;
}

export function detectLayoutMode({ width, hasFinePointer }: Viewport): LayoutMode {
  if (width < TABLET_MIN_WIDTH) {
    return "phone";
  }
  if (width < DESKTOP_MIN_WIDTH || !hasFinePointer) {
    return "tablet";
  }
  return "desktop";
}

export function readViewport(): Viewport {
  return {
    width: window.innerWidth,
    hasFinePointer: matchMedia("(any-pointer: fine)").matches,
  };
}
```

Ausschlaggebend ist `any-pointer: fine`, nicht `pointer: coarse`: ein Notebook mit Touchscreen hat beides, soll aber Desktop bleiben. Der User-Agent wird nirgends gelesen.

- [ ] **Step 4: `useLayoutMode.ts` implementieren**

```ts
import { useEffect, useState } from "react";

import {
  detectLayoutMode,
  readViewport,
  type LayoutMode,
  type LayoutPreference,
} from "./detectLayoutMode";

export function useLayoutMode(preference: LayoutPreference): LayoutMode {
  const [detected, setDetected] = useState<LayoutMode>(() => detectLayoutMode(readViewport()));

  useEffect(() => {
    const update = () => setDetected(detectLayoutMode(readViewport()));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return preference === "auto" ? detected : preference;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @videola/ui test && pnpm --filter @videola/ui typecheck`
Expected: PASS

- [ ] **Step 6: Committen**

```bash
git add packages/ui/src/layout
git commit -m "feat(ui): Layout-Modus aus Viewport und Zeigergeraet

Entschieden wird ueber Breite und any-pointer: fine, nie ueber den
User-Agent; ein Notebook mit Touchscreen bleibt damit im Desktop-Modus."
```

---

### Task 20: App-Shell und Web-App

**Files:**
- Create: `packages/ui/src/shell/AppShell.tsx`, `packages/ui/src/shell/AppShell.css`, `packages/ui/src/shell/TopBar.tsx`, `packages/ui/src/shell/SettingsMenu.tsx`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/shell/AppShell.test.tsx`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `ThemeProvider`, `useTheme`, `I18nProvider`, `useI18n`, `useLayoutMode`, `VideolaDocument`, `createWasmBackend`, `cmd`
- Produces: `AppShell` (Provider-Verbund + Topbar + Inhaltsbereich), `TopBar`, `SettingsMenu`, `@videola/ui` Barrel-Export, lauffähige Web-App mit Öffnen/Speichern/Undo/Redo

- [ ] **Step 1: Failing test schreiben**

`packages/ui/src/shell/AppShell.test.tsx`:
```tsx
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

function stubEnvironment(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("any-pointer: fine") || query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    stubEnvironment();
  });

  it("renders the title and the German action labels by default", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByText("Videola")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });

  it("exposes the resolved layout mode on the root element", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByTestId("app-shell").dataset.layout).toBe("desktop");
  });

  it("switches every label when the language changes", () => {
    render(<AppShell>content</AppShell>);
    act(() => screen.getByRole("button", { name: "Deutsch / English" }).click());
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("renders its children in the content area", () => {
    render(
      <AppShell>
        <p>Zeitleiste kommt hier hin</p>
      </AppShell>,
    );
    expect(screen.getByText("Zeitleiste kommt hier hin")).toBeTruthy();
  });

  it("disables undo and redo until an action reports otherwise", () => {
    render(<AppShell>content</AppShell>);
    expect(screen.getByRole("button", { name: "Rückgängig" }).hasAttribute("disabled")).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --filter @videola/ui test`
Expected: FAIL — `Cannot find module './AppShell'`

- [ ] **Step 3: `AppShell.css` implementieren**

```css
.v-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100dvh;
  overflow: hidden;
}

.v-topbar {
  display: flex;
  align-items: center;
  gap: var(--v-space-3);
  padding: var(--v-space-2) var(--v-space-4);
  background: var(--v-bg-elevated);
  border-bottom: 1px solid var(--v-border);
}

.v-topbar__brand {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.v-topbar__spacer {
  flex: 1;
}

.v-button {
  min-height: 32px;
  padding: 0 var(--v-space-3);
  background: var(--v-surface);
  color: var(--v-text);
  border: 1px solid var(--v-border);
  border-radius: var(--v-radius-md);
  font: inherit;
  cursor: pointer;
  transition: background var(--v-transition);
}

.v-button:hover:not(:disabled) {
  background: var(--v-surface-hover);
}

.v-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.v-button--primary {
  background: var(--v-accent);
  color: var(--v-accent-contrast);
  border-color: transparent;
}

.v-shell__content {
  overflow: auto;
  background: var(--v-bg);
}

.v-shell[data-layout="tablet"] .v-button,
.v-shell[data-layout="phone"] .v-button {
  min-height: var(--v-touch-target);
  padding: 0 var(--v-space-4);
}

.v-shell[data-layout="phone"] .v-topbar__brand {
  display: none;
}
```

- [ ] **Step 4: `SettingsMenu.tsx` und `TopBar.tsx` implementieren**

`packages/ui/src/shell/SettingsMenu.tsx`:
```tsx
import { useI18n } from "../i18n/useI18n";
import { useTheme } from "../theme/useTheme";

export function SettingsMenu(): JSX.Element {
  const { locale, setLocale } = useI18n();
  const { theme, setPreference } = useTheme();

  return (
    <>
      <button
        className="v-button"
        aria-label="Deutsch / English"
        onClick={() => setLocale(locale === "de" ? "en" : "de")}
      >
        {locale.toUpperCase()}
      </button>
      <button
        className="v-button"
        aria-label={theme === "dark" ? "Light" : "Dark"}
        onClick={() => setPreference(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☾" : "☀"}
      </button>
    </>
  );
}
```

Die beiden `aria-label` sind bewusst sprachneutral: sie benennen die Umschaltung selbst, nicht ihren Zustand, und funktionieren deshalb in beiden Sprachen ohne Katalogeintrag.

`packages/ui/src/shell/TopBar.tsx`:
```tsx
import { useI18n } from "../i18n/useI18n";
import { SettingsMenu } from "./SettingsMenu";

export interface TopBarActions {
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onImport?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function TopBar(actions: TopBarActions): JSX.Element {
  const { t } = useI18n();

  return (
    <header className="v-topbar">
      <span className="v-topbar__brand">{t("app.title")}</span>
      <button className="v-button" onClick={actions.onNew} disabled={!actions.onNew}>
        {t("action.new")}
      </button>
      <button className="v-button" onClick={actions.onOpen} disabled={!actions.onOpen}>
        {t("action.open")}
      </button>
      <button className="v-button" onClick={actions.onImport} disabled={!actions.onImport}>
        {t("action.import")}
      </button>
      <button className="v-button" onClick={actions.onUndo} disabled={actions.canUndo !== true}>
        {t("action.undo")}
      </button>
      <button className="v-button" onClick={actions.onRedo} disabled={actions.canRedo !== true}>
        {t("action.redo")}
      </button>
      <span className="v-topbar__spacer" />
      <SettingsMenu />
      <button
        className="v-button v-button--primary"
        onClick={actions.onSave}
        disabled={!actions.onSave}
      >
        {t("action.save")}
      </button>
    </header>
  );
}
```

- [ ] **Step 5: `AppShell.tsx` und Barrel implementieren**

`packages/ui/src/shell/AppShell.tsx`:
```tsx
import { useState, type ReactNode } from "react";

import { I18nProvider } from "../i18n/I18nProvider";
import { useLayoutMode } from "../layout/useLayoutMode";
import type { LayoutPreference } from "../layout/detectLayoutMode";
import { ThemeProvider } from "../theme/ThemeProvider";
import { TopBar, type TopBarActions } from "./TopBar";
import "./AppShell.css";

export interface AppShellProps extends TopBarActions {
  children: ReactNode;
  layoutPreference?: LayoutPreference;
}

export function AppShell({ children, layoutPreference, ...actions }: AppShellProps): JSX.Element {
  return (
    <ThemeProvider>
      <I18nProvider>
        <Frame layoutPreference={layoutPreference} actions={actions}>
          {children}
        </Frame>
      </I18nProvider>
    </ThemeProvider>
  );
}

function Frame({
  children,
  layoutPreference,
  actions,
}: {
  children: ReactNode;
  layoutPreference?: LayoutPreference;
  actions: TopBarActions;
}): JSX.Element {
  const [preference] = useState<LayoutPreference>(layoutPreference ?? "auto");
  const layout = useLayoutMode(preference);

  return (
    <div className="v-shell" data-layout={layout} data-testid="app-shell">
      <TopBar {...actions} />
      <main className="v-shell__content">{children}</main>
    </div>
  );
}
```

`packages/ui/src/index.ts`:
```ts
export { I18nProvider } from "./i18n/I18nProvider";
export { useI18n, type Locale } from "./i18n/useI18n";
export { translate, type Catalog, type Vars } from "./i18n/translate";
export {
  detectLayoutMode,
  readViewport,
  type LayoutMode,
  type LayoutPreference,
} from "./layout/detectLayoutMode";
export { useLayoutMode } from "./layout/useLayoutMode";
export { AppShell, type AppShellProps } from "./shell/AppShell";
export { TopBar, type TopBarActions } from "./shell/TopBar";
export { ThemeProvider } from "./theme/ThemeProvider";
export { useTheme, type Theme, type ThemePreference } from "./theme/useTheme";
```

- [ ] **Step 6: Test laufen lassen**

Run: `pnpm --filter @videola/ui test`
Expected: PASS

- [ ] **Step 7: Web-App anlegen**

Erst die vier Manifeste schreiben, dann installieren.

`apps/web/package.json`:
```json
{
  "name": "videola-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "echo \"no app-level tests yet\""
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { target: "es2022" },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Videola</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Jetzt installieren:
```bash
mkdir -p apps/web/src
pnpm add --filter videola-web react react-dom @videola/core @videola/ui
pnpm add -D --filter videola-web vite @vitejs/plugin-react typescript @types/react @types/react-dom
```

- [ ] **Step 8: App implementieren**

`apps/web/src/main.tsx`:
```tsx
import { createRoot } from "react-dom/client";

import { App } from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("missing #root element");
}
createRoot(root).render(<App />);
```

`apps/web/src/App.tsx`:
```tsx
import { useCallback, useEffect, useState } from "react";

import { cmd, createWasmBackend, VideolaDocument, type Project } from "@videola/core";
import { AppShell, useI18n } from "@videola/ui";

export function App(): JSX.Element {
  const [document, setDocument] = useState<VideolaDocument>();
  const [project, setProject] = useState<Project>();
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    let cancelled = false;
    void createWasmBackend().then((backend) => {
      if (cancelled) return;
      const next = new VideolaDocument(backend);
      setDocument(next);
      setProject(next.state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (document === undefined) return;
    return document.subscribe((next) => {
      setProject(next);
      setFlags({ canUndo: document.canUndo, canRedo: document.canRedo });
    });
  }, [document]);

  const addTrack = useCallback(() => {
    document?.dispatch(cmd.trackAdd("video", "V1"));
  }, [document]);

  const save = useCallback(() => {
    if (document === undefined) return;
    const now = new Date().toISOString();
    const bytes = document.save({
      appVersion: "0.1.0",
      created: now,
      modified: now,
      locale: navigator.language,
      slim: true,
    });
    downloadBlob(bytes, `${project?.meta.title || "projekt"}.videola`);
  }, [document, project]);

  const open = useCallback(async () => {
    const file = await pickFile(".videola");
    if (file === undefined) return;
    const backend = await createWasmBackend(new Uint8Array(await file.arrayBuffer()));
    const next = new VideolaDocument(backend);
    setDocument(next);
    setProject(next.state);
  }, []);

  return (
    <AppShell
      onNew={() => window.location.reload()}
      onOpen={() => void open()}
      onImport={addTrack}
      onSave={save}
      onUndo={() => document?.undo()}
      onRedo={() => document?.redo()}
      canUndo={flags.canUndo}
      canRedo={flags.canRedo}
    >
      <Status project={project} />
    </AppShell>
  );
}

function Status({ project }: { project?: Project }): JSX.Element {
  const { t, formatTimecode } = useI18n();
  if (project === undefined) {
    return <p style={{ padding: 24 }}>…</p>;
  }
  const tracks = project.timeline.tracks.length;
  return (
    <div style={{ padding: 24, display: "grid", gap: 8 }}>
      <strong>{project.meta.title || t("project.untitled")}</strong>
      <span>{t("project.trackCount", { count: tracks })}</span>
      <span>
        {project.settings.width}×{project.settings.height} ·{" "}
        {formatTimecode(0)}
      </span>
      {tracks === 0 && <em>{t("empty.noTracks")}</em>}
    </div>
  );
}

function downloadBlob(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}
```

`onImport` legt in M0 nur eine Spur an — echter Medienimport braucht die Media-Library aus M1. Der Button steht schon, weil die Command-Kette dahinter fertig ist.

- [ ] **Step 9: App bauen und starten**

```bash
wasm-pack build crates/videola-core-wasm --target web --out-dir ../../packages/core/src/wasm --out-name videola_core
pnpm --filter videola-web typecheck
pnpm --filter videola-web build
pnpm --filter videola-web dev
```
Expected: Build grün; unter `http://localhost:5173` erscheint die Shell, Sprache und Theme lassen sich umschalten, „Medien importieren" erhöht die Spurzahl, Undo wird aktiv, Speichern lädt eine `.videola` herunter, Öffnen liest sie zurück.

- [ ] **Step 10: Committen**

```bash
git add packages/ui apps/web package.json pnpm-lock.yaml
git commit -m "feat(ui): App-Shell und Web-App

Die Shell haelt Theme, Sprache und Layout-Modus; die Web-App verdrahtet sie
mit dem WASM-Kern und kann .videola speichern und oeffnen."
```

---

### Task 21: CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI mit vier Jobs — `rust` (fmt, clippy, test), `types` (generierte Typen sind aktuell), `wasm` (wasm-pack-Build), `web` (typecheck, test, build)

- [ ] **Step 1: Workflow schreiben**

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace

  types:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test -p videola-core --test export_types
      - name: Generierte Typen sind aktuell
        run: |
          git add -A -- packages/core/src/generated
          git diff --cached --exit-code -- packages/core/src/generated

  wasm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
      - uses: jetli/wasm-pack-action@v0.4.0
      - run: wasm-pack build crates/videola-core-wasm --target web --out-dir ../../packages/core/src/wasm --out-name videola_core
      - uses: actions/upload-artifact@v4
        with:
          name: wasm
          path: packages/core/src/wasm

  web:
    runs-on: ubuntu-latest
    needs: wasm
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: actions/download-artifact@v4
        with:
          name: wasm
          path: packages/core/src/wasm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

Der `types`-Job ist der eigentliche Wächter: er verhindert, dass eine Änderung am Rust-Modell mit veralteten TypeScript-Typen gemerged wird. `git add` vor dem Vergleich ist nötig, weil `git diff` unversionierte Dateien ignoriert — ein neu erzeugter Typ würde sonst durchrutschen. Den umgekehrten Fall (ein entfernter Typ hinterlässt eine veraltete, aber eingecheckte Datei) fängt der Barrel-Vollständigkeitstest in `export_types.rs` ab.

`pnpm/action-setup` bekommt bewusst keine Version: es liest das `packageManager`-Feld aus der Root-`package.json`, sodass CI und Entwicklungsrechner nicht auseinanderlaufen können.

Der `web`-Job zieht das WASM-Artefakt vom `wasm`-Job, damit Node keine Rust-Toolchain braucht.

- [ ] **Step 2: Lokal nachfahren**

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo test -p videola-core --test export_types && git diff --exit-code -- packages/core/src/generated
pnpm install
pnpm typecheck && pnpm test && pnpm build
```
Expected: alles grün

- [ ] **Step 3: Committen und pushen**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: Rust, Typgenerierung, WASM und Web pruefen

Ein eigener Job prueft, dass die eingecheckten TypeScript-Typen zum
Rust-Modell passen."
git push
```

- [ ] **Step 4: CI-Ergebnis prüfen**

```bash
gh run watch
```
Expected: alle vier Jobs grün. Rot heißt: reparieren, nicht zusammenführen.

---

## M0 Definition of Done

```
✓ cargo test --workspace grün, clippy ohne Warnungen, fmt sauber
✓ .videola speichern und laden ist verlustfrei (Roundtrip-Test)
✓ Jeder Command hat ein funktionierendes Undo, ohne handgeschriebene Inverse
✓ Ein fehlgeschlagener Command hinterlässt das Projekt unverändert
✓ Fehlendes Medium öffnet das Projekt mit Warnung statt mit Fehler
✓ Neuere schemaVersion wird abgelehnt, unbekannte Felder überleben einen Roundtrip
✓ TypeScript-Typen werden aus Rust generiert und von CI auf Aktualität geprüft
✓ Web-App läuft: Theme umschaltbar, Sprache umschaltbar, Layout-Modus erkannt
✓ Speichern lädt eine .videola herunter, Öffnen liest sie zurück
✓ CI grün auf main
```

## Selbstreview gegen die Spec

| Spec-Abschnitt | Abdeckung in M0 |
|---|---|
| 2.1 Modell in Rust, TS-Typen generiert | Tasks 1–5, 13 |
| 2.1 Effekte als Daten + WGSL | **nicht in M0** — Effekt-*Modell* steht (Task 5), Shader-Pipeline ist M1 |
| 4 `.videola`-Format | Tasks 9–12; `proxies/`, `thumbs/`, `cache/`, `assets/fonts/`, `preview.*` werden erst geschrieben, wenn es sie gibt (M1+) |
| 5 Datenmodell | Tasks 1–5, 9; Masken und Compound-Rekursionslimit sind M2/M3 |
| 6 Command-Bus, Undo, Coalescing | Tasks 6–8, 14 |
| 6.1 Katalog für API/MCP/SDK | **nicht in M0** — bewusst YAGNI, kommt in M1 mit dem Server |
| 6.3 Self-Hosting-Sicherheit | **nicht in M0** — kein Server in M0 |
| 7 Rendering | **nicht in M0** — vollständig M1 |
| 8.1 Layout-Erkennung | Task 19 |
| 8.2 Theme und Sprache | Tasks 17, 18 |
| 8.3 Barrierefreiheit | Grundlinie in Task 20 (Fokusringe, `prefers-reduced-motion`, ARIA-Labels); Timeline-ARIA und Tastaturkürzel sind M1/M2 |
| 8.4 Offline / PWA / OPFS | **nicht in M0** — M1 |
| 9 Templates | **nicht in M0** — M5 |
| 13 Code-Konventionen | Global Constraints, in jedem Task angewendet |

Bewusst offen gelassen und in M1 fällig: Command-Katalog mit JSON-Schema, REST/WS-Server, MCP, Engine, PWA/OPFS, Medienimport in der Oberfläche, streamende Medienextraktion (siehe `ponytail:`-Marker in Task 11).

## Bekannte Vereinfachungen (`ponytail:`-Marker)

| Ort | Vereinfachung | Wann aufheben |
|---|---|---|
| `document.rs` | Projekt wird je Dispatch geklont und zweimal serialisiert | Wenn Drag-Latenz bei großen Projekten messbar wird |
| `format/reader.rs` | Alle Medien liegen beim Laden im Speicher | M1, mit OPFS- und Dateisystem-Storage |
| `keyframe.rs` | Bezier-x per 24 Bisektionsschritten statt Newton | Nur wenn das Profil es zeigt |
| `i18n/translate.ts` | Plural nur Singular/Plural | Sobald eine Sprache mit mehr Kategorien dazukommt |
