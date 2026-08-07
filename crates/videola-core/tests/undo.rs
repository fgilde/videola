use videola_core::command::{Command, Dispatch};
use videola_core::model::{ClipSource, MediaId, Project, Time, TrackKind};
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

// Every handler validates its arguments before touching the model, so there is currently no
// command that mutates and then fails partway through (see the comment on Document::dispatch).
// This asserts the observable contract that matters regardless: a failed dispatch changes
// neither the project nor the history.
#[test]
fn a_failing_dispatch_leaves_project_and_history_untouched() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    let before = serde_json::to_value(doc.project()).unwrap();
    let history_len_before = doc.history().labels().len();

    let result = doc.dispatch(Dispatch::new(Command::ClipMove {
        clip,
        to_track: "trk_missing".to_string().into(),
        start: Time::from_seconds(5.0),
    }));

    assert!(result.is_err());
    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
    assert_eq!(doc.history().labels().len(), history_len_before);
}

#[test]
fn commands_sharing_a_coalesce_key_collapse_into_one_undo_step() {
    let mut doc = Document::from_project(Project::default()).unwrap();
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

// C2: coalescing must clear the redo stack exactly like a plain push does, or an undo followed
// by a coalesced edit resurrects a redo entry whose patch no longer matches the project it would
// be applied to.
#[test]
fn coalescing_after_an_undo_does_not_resurrect_stale_redo() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();

    doc.dispatch(
        Dispatch::new(Command::TrackRename {
            track: track.clone(),
            name: "A".into(),
        })
        .coalesce("k"),
    )
    .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackRename {
        track: track.clone(),
        name: "B".into(),
    }))
    .unwrap();
    doc.undo().unwrap();
    doc.dispatch(
        Dispatch::new(Command::TrackRename {
            track,
            name: "C".into(),
        })
        .coalesce("k"),
    )
    .unwrap();

    assert!(!doc.history().can_redo());
    assert!(doc.redo().is_err());
}

// F7: a command whose effect is a no-op (renaming a track to the name it already has, here)
// must not push a dead undo step the user then has to click through.
#[test]
fn a_no_op_command_does_not_grow_the_history() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let name = doc.project().timeline.tracks[0].name.clone();

    doc.dispatch(Dispatch::new(Command::TrackRename { track, name }))
        .unwrap();

    // still true because of the earlier add_track, not because the no-op pushed anything
    assert!(doc.history().can_undo());
    assert_eq!(doc.history().labels().len(), 1);
}

#[test]
fn dispatch_reports_the_patch_it_produced() {
    let mut doc = Document::new();
    let result = doc.dispatch(add_track("V1")).unwrap();
    assert!(result.can_undo);
    assert!(!result.can_redo);
    let ops = result.patch.as_array().unwrap();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["op"], "add");
    assert_eq!(ops[0]["path"], "/timeline/tracks/0");
}
