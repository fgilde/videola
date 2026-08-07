use std::path::Path;

use ts_rs::{Config, TS};
use videola_core::command::{Command, Dispatch};
use videola_core::format::{LoadWarning, Manifest};
use videola_core::model::{Clip, Effect, Keyframe, ParamValue, Project};
use videola_core::DispatchResult;

// ts-rs 12's `export_all` takes a `&Config` (older versions took none), and this version reads no
// Cargo.toml metadata for the export directory at all, so it is set here instead.
//
// The completeness check below used to be a separate `#[test]` that read this same directory.
// `cargo test` runs tests in a binary in parallel by default, so that second test had no
// guarantee it ran after this one wrote the files — harmless only because the files are already
// committed from a prior run. Folding both into one test removes that race and makes the name
// "exactly the files ts-rs emits" actually true of what this run produced, not of leftovers.
#[test]
fn generated_bindings_are_complete_and_the_barrel_matches() {
    let generated = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/core/src/generated");
    let cfg = Config::default().with_out_dir(generated.clone());

    Project::export_all(&cfg).expect("project types");
    Clip::export_all(&cfg).expect("clip types");
    Effect::export_all(&cfg).expect("effect types");
    Keyframe::export_all(&cfg).expect("keyframe types");
    ParamValue::export_all(&cfg).expect("param types");
    Command::export_all(&cfg).expect("command types");
    Dispatch::export_all(&cfg).expect("dispatch types");
    Manifest::export_all(&cfg).expect("manifest types");
    LoadWarning::export_all(&cfg).expect("warning types");
    DispatchResult::export_all(&cfg).expect("dispatch result types");

    for name in ["Project.ts", "Clip.ts", "Command.ts", "ParamValue.ts"] {
        assert!(generated.join(name).exists(), "missing binding: {name}");
    }

    // `git diff` alone misses a type that was added (new untracked file, diff is silent) or
    // removed/renamed (ts-rs never deletes, so the old file just sits there, unreferenced but
    // still tracked). This closes the half of that gap that lives in Rust: the barrel must name
    // exactly the files ts-rs just emitted, no more, no less. `serde_json/` holds only the shared
    // `JsonValue` helper type and is exempt by design (see the brief).
    let mut emitted: Vec<String> = std::fs::read_dir(&generated)
        .expect("read generated dir")
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name != "index.ts")
        .filter_map(|name| name.strip_suffix(".ts").map(str::to_string))
        .collect();
    emitted.sort();

    let barrel = std::fs::read_to_string(generated.join("index.ts")).expect("read barrel");
    let mut reexported: Vec<String> = barrel
        .lines()
        .filter_map(|line| line.split_once("from \"./"))
        .map(|(_, rest)| rest.trim_end_matches(['"', ';']).to_string())
        .filter(|name| !name.starts_with("serde_json/"))
        .collect();
    reexported.sort();

    assert_eq!(
        emitted, reexported,
        "packages/core/src/generated/index.ts must re-export exactly the top-level *.ts files ts-rs emits"
    );
}
