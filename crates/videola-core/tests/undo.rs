use videola_core::command::{Command, Dispatch, TrimEdge, ALL_COMMAND_LABELS};
use videola_core::model::{
    ClipId, ClipSource, Generator, MediaAsset, MediaId, MediaKind, ParamValue, Project,
    ProjectSettings, Time, TrackId, TrackKind,
};
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

// A fresh document with a track, a second (empty) track, a clip with an effect on the first
// track, and one imported medium — enough state that every command variant below has something
// real to act on and produces a genuine (non-empty) patch, which a no-op patch would otherwise
// undo the wrong history entry for (see Document::dispatch).
#[allow(clippy::unwrap_used)]
fn undo_coverage_fixture() -> (Document, TrackId, TrackId, ClipId, MediaId) {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    doc.dispatch(add_track("V2")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let other_track = doc.project().timeline.tracks[1].id.clone();

    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Generator {
            generator: Generator::Solid {
                color: "#00ff00".into(),
            },
        },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        clip: clip.clone(),
        effect_type: "brightness".into(),
    }))
    .unwrap();

    let media = MediaId::from_bytes(b"undo coverage fixture medium");
    doc.dispatch(Dispatch::new(Command::MediaImport {
        asset: MediaAsset::new(
            media.clone(),
            "a.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            5,
        ),
    }))
    .unwrap();

    (doc, track, other_track, clip, media)
}

// I8: the M0 DoD claims every command has working undo, but only 4 of 20 command variants ever
// had an undo() call anywhere in the test suite. The inverse mechanism is uniform
// (Document::dispatch's diff/apply_patch), so it likely works everywhere — but `clip.split`
// mints a fresh ClipId and `media.remove` deletes across nested timelines, exactly the cases a
// uniform mechanism could still get subtly wrong. This exercises all 20 and turns the claim into
// a fact instead of an assumption.
#[test]
fn every_command_undoes_to_the_exact_prior_state() {
    type Build = fn(&TrackId, &TrackId, &ClipId, &MediaId) -> Command;
    let commands: &[Build] = &[
        |_, _, _, _| Command::ProjectSetTitle {
            title: "Renamed".into(),
        },
        |_, _, _, _| Command::ProjectSetSettings {
            settings: ProjectSettings {
                width: 1280,
                ..ProjectSettings::default()
            },
        },
        |_, _, _, _| Command::TrackAdd {
            kind: TrackKind::Audio,
            name: "V3".into(),
            index: None,
        },
        |_, other, _, _| Command::TrackRemove {
            track: other.clone(),
        },
        |_, other, _, _| Command::TrackReorder {
            track: other.clone(),
            to_index: 0,
        },
        |track, _, _, _| Command::TrackRename {
            track: track.clone(),
            name: "Renamed".into(),
        },
        |track, _, _, _| Command::TrackSetVolume {
            track: track.clone(),
            volume: 0.5,
        },
        |track, _, _, _| Command::TrackSetPan {
            track: track.clone(),
            pan: 0.5,
        },
        |track, _, _, _| Command::TrackSetFlags {
            track: track.clone(),
            muted: Some(true),
            solo: None,
            locked: None,
            hidden: None,
        },
        |track, _, _, _| Command::ClipAdd {
            track: track.clone(),
            source: ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#ff0000".into(),
                },
            },
            start: Time::from_seconds(5.0),
            duration: Time::from_seconds(1.0),
        },
        |_, _, clip, _| Command::ClipRemove { clip: clip.clone() },
        |_, other, clip, _| Command::ClipMove {
            clip: clip.clone(),
            to_track: other.clone(),
            start: Time::from_seconds(1.0),
        },
        |_, _, clip, _| Command::ClipTrim {
            clip: clip.clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(-0.5),
        },
        |_, _, clip, _| Command::ClipSplit {
            clip: clip.clone(),
            at: Time::from_seconds(1.0),
        },
        |_, _, clip, _| Command::ClipSetSpeed {
            clip: clip.clone(),
            rate: 2.0,
            reverse: false,
            preserve_pitch: true,
        },
        |_, _, clip, _| Command::ClipSetVolume {
            clip: clip.clone(),
            volume: 0.5,
        },
        |_, _, clip, _| Command::EffectAdd {
            clip: clip.clone(),
            effect_type: "contrast".into(),
        },
        |_, _, clip, _| Command::EffectSetParam {
            clip: clip.clone(),
            effect_type: "brightness".into(),
            key: "amount".into(),
            value: ParamValue::Float(0.5),
        },
        |_, _, _, _| Command::MediaImport {
            asset: MediaAsset::new(
                MediaId::from_bytes(b"a second undo coverage medium"),
                "b.mp4".into(),
                "video/mp4".into(),
                MediaKind::Video,
                5,
            ),
        },
        |_, _, _, media| Command::MediaRemove {
            media: media.clone(),
        },
    ];
    // Guards the table itself: a command variant added later without a matching entry here would
    // otherwise silently keep passing.
    assert_eq!(commands.len(), ALL_COMMAND_LABELS.len());

    for build in commands {
        let (mut doc, track, other_track, clip, media) = undo_coverage_fixture();
        let before = serde_json::to_value(doc.project()).unwrap();
        let command = build(&track, &other_track, &clip, &media);
        let label = command.label();

        doc.dispatch(Dispatch::new(command))
            .unwrap_or_else(|error| panic!("{label} failed to dispatch: {error}"));
        doc.undo()
            .unwrap_or_else(|error| panic!("{label} failed to undo: {error}"));

        assert_eq!(
            serde_json::to_value(doc.project()).unwrap(),
            before,
            "undo did not restore the prior state for {label}"
        );
    }
}
