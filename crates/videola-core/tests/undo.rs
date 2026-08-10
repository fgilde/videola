use videola_core::command::{Command, Dispatch, EffectTarget, TrimEdge, ALL_COMMAND_LABELS};
use videola_core::model::{
    Clip, ClipId, ClipSource, Generator, Interp, MarkerId, MediaAsset, MediaId, MediaKind,
    ParamValue, Project, ProjectSettings, Time, TrackId, TrackKind, Transform, Transition,
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

// What the API's atomic batch rests on: the commands that did land under one coalesce key come
// back off in a single step, and — unlike `undo` — nothing is left on the redo stack for a later
// `redo` to reapply half a rejected batch from.
#[test]
fn rollback_removes_a_partial_batch_without_leaving_it_on_redo() {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let before = serde_json::to_value(doc.project()).unwrap();
    let history_before = doc.history().labels().len();

    for name in ["A", "B"] {
        doc.dispatch(
            Dispatch::new(Command::TrackRename {
                track: track.clone(),
                name: name.into(),
            })
            .coalesce("batch-1"),
        )
        .unwrap();
    }

    doc.rollback().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
    assert_eq!(doc.history().labels().len(), history_before);
    assert!(!doc.history().can_redo());
    assert!(doc.redo().is_err());
}

#[test]
fn rollback_with_nothing_to_undo_reports_it_instead_of_panicking() {
    let mut doc = Document::new();
    assert!(doc.rollback().is_err());
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
// Named rather than a tuple because the table below destructures only the fields each command
// needs; a growing tuple made every entry carry a placeholder for every argument.
struct Fixture {
    track: TrackId,
    other: TrackId,
    clip: ClipId,
    neighbour: ClipId,
    media: MediaId,
    marker: MarkerId,
}

impl Fixture {
    fn dummy() -> Self {
        Self {
            track: TrackId::from("trk_dummy".to_string()),
            other: TrackId::from("trk_dummy".to_string()),
            clip: ClipId::from("clp_dummy".to_string()),
            neighbour: ClipId::from("clp_dummy".to_string()),
            media: MediaId::from("med_dummy".to_string()),
            marker: MarkerId::from("mrk_dummy".to_string()),
        }
    }
}

#[allow(clippy::unwrap_used)]
fn undo_coverage_fixture() -> (Document, Fixture) {
    let mut doc = Document::new();
    doc.dispatch(add_track("V1")).unwrap();
    doc.dispatch(add_track("V2")).unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let other_track = doc.project().timeline.tracks[1].id.clone();

    // Two clips butted together, because roll and slide are about the cut between a pair, and a
    // fixture with one clip would have let them report "no neighbour" instead of undoing anything.
    for start in [Time::ZERO, Time::from_seconds(2.0)] {
        doc.dispatch(Dispatch::new(Command::ClipAdd {
            track: track.clone(),
            source: ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#00ff00".into(),
                },
            },
            start,
            duration: Time::from_seconds(2.0),
        }))
        .unwrap();
    }
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    let neighbour = doc.project().timeline.tracks[0].clips[1].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::KeyframeAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        time: Time::from_seconds(0.5),
        value: ParamValue::Float(0.25),
        interp: Interp::Linear,
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

    // A group and a marker to dissolve and to rename, so `clip.ungroup`, `marker.remove` and
    // `marker.rename` act on something instead of reporting an empty project.
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![neighbour.clone(), clip.clone()],
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::MarkerAdd {
        time: Time::from_seconds(3.0),
        label: "fixture".into(),
    }))
    .unwrap();
    let marker = doc.project().markers[0].id.clone();

    (
        doc,
        Fixture {
            track,
            other: other_track,
            clip,
            neighbour,
            media,
            marker,
        },
    )
}

// I8: the M0 DoD claims every command has working undo, but only 4 of 20 command variants ever
// had an undo() call anywhere in the test suite. The inverse mechanism is uniform
// (Document::dispatch's diff/apply_patch), so it likely works everywhere — but `clip.split`
// mints a fresh ClipId and `media.remove` deletes across nested timelines, exactly the cases a
// uniform mechanism could still get subtly wrong. This exercises all 20 and turns the claim into
// a fact instead of an assumption.
#[test]
fn every_command_undoes_to_the_exact_prior_state() {
    type Build = fn(&Fixture) -> Command;
    let commands: &[Build] = &[
        |_| Command::ProjectSetTitle {
            title: "Renamed".into(),
        },
        |_| Command::ProjectSetMasterVolume { volume: 0.4 },
        |_| Command::ProjectSetSettings {
            settings: ProjectSettings {
                width: 1280,
                ..ProjectSettings::default()
            },
        },
        |_| Command::TrackAdd {
            kind: TrackKind::Audio,
            name: "V3".into(),
            index: None,
        },
        |Fixture { other, .. }| Command::TrackRemove {
            track: other.clone(),
        },
        |Fixture { other, .. }| Command::TrackReorder {
            track: other.clone(),
            to_index: 0,
        },
        |Fixture { track, .. }| Command::TrackRename {
            track: track.clone(),
            name: "Renamed".into(),
        },
        |Fixture { track, .. }| Command::TrackSetVolume {
            track: track.clone(),
            volume: 0.5,
        },
        |Fixture { track, .. }| Command::TrackSetPan {
            track: track.clone(),
            pan: 0.5,
        },
        |Fixture { track, .. }| Command::TrackSetFlags {
            track: track.clone(),
            muted: Some(true),
            solo: None,
            locked: None,
            hidden: None,
        },
        |Fixture { track, .. }| Command::ClipAdd {
            track: track.clone(),
            source: ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#ff0000".into(),
                },
            },
            start: Time::from_seconds(5.0),
            duration: Time::from_seconds(1.0),
        },
        |Fixture { track, .. }| Command::ClipInsert {
            track: track.clone(),
            source: ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#00ff00".into(),
                },
            },
            start: Time::from_seconds(1.0),
            duration: Time::from_seconds(1.0),
            in_point: Time::from_seconds(0.5),
        },
        |Fixture { track, .. }| Command::ClipOverwrite {
            track: track.clone(),
            source: ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#00ff00".into(),
                },
            },
            start: Time::from_seconds(1.0),
            duration: Time::from_seconds(1.0),
            in_point: Time::from_seconds(0.5),
        },
        |Fixture { clip, .. }| Command::ClipRemove { clip: clip.clone() },
        |Fixture { other, clip, .. }| Command::ClipMove {
            clip: clip.clone(),
            to_track: other.clone(),
            start: Time::from_seconds(1.0),
        },
        |Fixture { clip, .. }| Command::ClipTrim {
            clip: clip.clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(-0.5),
        },
        |Fixture { clip, .. }| Command::ClipSplit {
            clip: clip.clone(),
            at: Time::from_seconds(1.0),
        },
        |Fixture { clip, .. }| Command::ClipSetSpeed {
            clip: clip.clone(),
            rate: 2.0,
            reverse: false,
            preserve_pitch: true,
        },
        |Fixture { clip, .. }| Command::ClipSetVolume {
            clip: clip.clone(),
            volume: 0.5,
        },
        |Fixture { track, .. }| Command::TrackSetSurround {
            track: track.clone(),
            rear: 0.75,
            lfe: 0.5,
        },
        |Fixture { clip, .. }| Command::ClipSetEnabled {
            clip: clip.clone(),
            enabled: false,
        },
        |Fixture { clip, .. }| Command::ClipSetMotionBlur {
            clip: clip.clone(),
            amount: 0.5,
        },
        |Fixture { clip, .. }| Command::EffectAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "contrast".into(),
        },
        // Against the effect the fixture brings, not the one `effect.add` above puts there: every
        // command in this table runs against a fresh fixture, so one aimed at contrast would be
        // asking a chain that has none.
        |Fixture { clip, .. }| Command::EffectSetEnabled {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "brightness".into(),
            enabled: false,
        },
        |Fixture { clip, .. }| Command::EffectRemove {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "brightness".into(),
        },
        |Fixture { clip, .. }| Command::EffectSetParam {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "brightness".into(),
            key: "amount".into(),
            value: ParamValue::Float(0.5),
        },
        |Fixture { clip, .. }| Command::ClipSetTransform {
            clip: clip.clone(),
            transform: Transform {
                scale_x: 3.0,
                ..Transform::default()
            },
        },
        |Fixture { clip, .. }| Command::ClipSetTransition {
            clip: clip.clone(),
            transition: Some(Transition::new("crossfade", Time::from_seconds(0.5))),
        },
        |Fixture { clip, .. }| Command::KeyframeAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(1.0),
            value: ParamValue::Float(0.75),
            interp: Interp::Ease,
        },
        |Fixture { clip, .. }| Command::KeyframeRemove {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(0.5),
        },
        |Fixture { clip, .. }| Command::KeyframeMove {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            from: Time::from_seconds(0.5),
            to: Time::from_seconds(1.5),
        },
        |Fixture { clip, .. }| Command::KeyframeSetInterp {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(0.5),
            interp: Interp::Hold,
        },
        |Fixture { clip, .. }| Command::KeyframeSetHandles {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(0.5),
            handle_in: None,
            handle_out: Some([0.9, 0.05]),
        },
        |_| Command::MediaImport {
            asset: MediaAsset::new(
                MediaId::from_bytes(b"a second undo coverage medium"),
                "b.mp4".into(),
                "video/mp4".into(),
                MediaKind::Video,
                5,
            ),
        },
        |Fixture { media, .. }| Command::MediaRemove {
            media: media.clone(),
        },
        |Fixture { clip, .. }| Command::ClipRippleDelete { clip: clip.clone() },
        |Fixture { clip, .. }| Command::ClipRippleTrim {
            clip: clip.clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(-0.5),
        },
        // Rolling this cut to the left would ask the second clip for material in front of its in
        // point, which it has none of; to the right is the direction this fixture can serve.
        |Fixture { clip, .. }| Command::ClipRoll {
            clip: clip.clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(0.5),
        },
        |Fixture { clip, .. }| Command::ClipSlip {
            clip: clip.clone(),
            delta: Time::from_seconds(0.5),
        },
        |Fixture { clip, .. }| Command::ClipSlide {
            clip: clip.clone(),
            delta: Time::from_seconds(0.5),
        },
        |Fixture { track, .. }| Command::ClipPaste {
            track: track.clone(),
            clip: Box::new(Clip::new_generator(
                Generator::Solid {
                    color: "#0000ff".into(),
                },
                Time::ZERO,
                Time::from_seconds(1.0),
            )),
            start: Time::from_seconds(8.0),
        },
        |Fixture {
             clip, neighbour, ..
         }| Command::ClipGroup {
            clips: vec![clip.clone(), neighbour.clone()],
        },
        // The fixture already puts the neighbour in a group, so this one has something to dissolve.
        |Fixture { neighbour, .. }| Command::ClipUngroup {
            clip: neighbour.clone(),
        },
        |Fixture {
             clip, neighbour, ..
         }| Command::ClipNest {
            clips: vec![clip.clone(), neighbour.clone()],
        },
        // The fixture's clips are generators, so this one has something to rewrite. Undoing it has
        // to put the whole generator back, style map and all, not merely the words.
        |Fixture { clip, .. }| Command::ClipSetGenerator {
            clip: clip.clone(),
            generator: Generator::Text {
                content: "a caption".into(),
                style: std::collections::BTreeMap::new(),
            },
        },
        |_| Command::MarkerAdd {
            time: Time::from_seconds(1.0),
            label: "chapter".into(),
        },
        |Fixture { marker, .. }| Command::MarkerRemove {
            marker: marker.clone(),
        },
        |Fixture { marker, .. }| Command::MarkerRename {
            marker: marker.clone(),
            label: "renamed".into(),
        },
        |Fixture { marker, .. }| Command::MarkerSetColor {
            marker: marker.clone(),
            color_hex: "#2EA043".into(),
        },
        |Fixture { marker, .. }| Command::MarkerSetNote {
            marker: marker.clone(),
            note: "the take we kept".into(),
        },
    ];
    // Guards the table itself: comparing lengths alone would still pass if a duplicate entry
    // stood in for a missing variant, so this compares the actual label *sets* — a dummy fixture
    // is enough since `.label()` never looks at the payload.
    let mut produced: Vec<&str> = commands
        .iter()
        .map(|build| build(&Fixture::dummy()).label())
        .collect();
    produced.sort_unstable();
    let mut expected: Vec<&str> = ALL_COMMAND_LABELS.to_vec();
    expected.sort_unstable();
    assert_eq!(produced, expected);

    for build in commands {
        let (mut doc, fixture) = undo_coverage_fixture();
        let before = serde_json::to_value(doc.project()).unwrap();
        let command = build(&fixture);
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
