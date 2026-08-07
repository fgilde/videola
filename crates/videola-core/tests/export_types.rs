use std::path::Path;

use ts_rs::{Config, TS};
use videola_core::command::{Command, Dispatch};
use videola_core::format::{LoadWarning, Manifest};
use videola_core::model::{Clip, Effect, Keyframe, ParamValue, Project};

// ts-rs 12's `export_all` takes a `&Config` (older versions took none); the export directory has
// to be set here rather than via the `[package.metadata.ts-rs]` Cargo.toml table, which this
// version does not read.
#[test]
fn generated_bindings_land_in_the_core_package() {
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

    for name in ["Project.ts", "Clip.ts", "Command.ts", "ParamValue.ts"] {
        assert!(generated.join(name).exists(), "missing binding: {name}");
    }
}
