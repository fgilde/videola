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
            Dispatch::new(Command::TrackSetVolume {
                track: track.clone(),
                volume,
            })
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
