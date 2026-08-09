use videola_core::command::{Command, Dispatch, EffectTarget};
use videola_core::model::{
    ClipId, ClipSource, Interp, MediaId, ParamValue, Project, Time, TrackKind,
};
use videola_core::Document;

#[allow(clippy::unwrap_used)]
fn doc_with_effect() -> (Document, ClipId) {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_seconds(4.0),
    }))
    .unwrap();
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
    }))
    .unwrap();
    (doc, clip)
}

fn add(clip: &ClipId, seconds: f64, value: f32, interp: Interp) -> Command {
    Command::KeyframeAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        time: Time::from_seconds(seconds),
        value: ParamValue::Float(value),
        interp,
    }
}

fn amount_at(project: &Project, seconds: f64) -> Option<ParamValue> {
    project.timeline.tracks[0].clips[0].effects[0].param_at("amount", Time::from_seconds(seconds))
}

fn keyframe_times(project: &Project) -> Vec<f64> {
    project.timeline.tracks[0].clips[0].effects[0].keyframes["amount"]
        .iter()
        .map(|keyframe| keyframe.time.as_seconds())
        .collect()
}

// The acceptance point of Task 19 expressed in the core: two keyframes, and a value that really
// changes between them.
#[test]
#[allow(clippy::unwrap_used)]
fn two_keyframes_make_a_parameter_change_over_time() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();

    assert_eq!(amount_at(doc.project(), 0.0), Some(ParamValue::Float(0.0)));
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.5)));
    assert_eq!(amount_at(doc.project(), 2.0), Some(ParamValue::Float(1.0)));
}

// `keyframe::evaluate` binary-searches and therefore assumes sorted-by-time; `Project::normalize`
// only sorts on load. A command that appended would leave the project reading wrong values until
// the next save-and-reopen — the seam between the two layers, hit deliberately.
#[test]
#[allow(clippy::unwrap_used)]
fn keyframes_added_out_of_order_are_sorted_immediately() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();

    assert_eq!(keyframe_times(doc.project()), vec![0.0, 2.0]);
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.5)));
}

#[test]
#[allow(clippy::unwrap_used)]
fn adding_at_an_occupied_time_replaces_that_keyframe() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.25, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.75, Interp::Hold)))
        .unwrap();

    let track = &doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"];
    assert_eq!(track.len(), 1);
    assert_eq!(track[0].value, ParamValue::Float(0.75));
    assert_eq!(track[0].interp, Interp::Hold);
}

// No command carries bezier handles, so the only thing an upsert can do with the pair a project
// arrived with is destroy it. One drag of a slider over a keyframed parameter would then flatten a
// curve nobody can put back -- the surface that would have to offer the undo cannot author handles
// either, and `keyframe.setInterp` beside it changes the interpolation without touching them.
#[test]
#[allow(clippy::unwrap_used)]
fn replacing_a_keyframe_keeps_the_curve_shape_it_was_authored_with() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.0, Interp::Bezier)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 3.0, 1.0, Interp::Linear)))
        .unwrap();
    bend(&mut doc);
    let bent = amount_at(doc.project(), 2.0);
    assert_ne!(bent, Some(ParamValue::Float(0.5)), "the handles have to bend it at all");

    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.0, Interp::Bezier)))
        .unwrap();

    let track = &doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"];
    assert_eq!(track[0].handle_out, Some([0.9, 0.05]));
    assert_eq!(amount_at(doc.project(), 2.0), bent);
}

// And the other half of the rule: a keyframe written where none stood has no shape to keep.
#[test]
#[allow(clippy::unwrap_used)]
fn a_keyframe_written_on_empty_ground_carries_no_handles() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.25, Interp::Bezier)))
        .unwrap();

    let track = &doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"];
    assert_eq!(track[0].handle_in, None);
    assert_eq!(track[0].handle_out, None);
}

// Handles can only arrive by loading a project: no command takes them.
#[allow(clippy::unwrap_used)]
fn bend(doc: &mut Document) {
    let mut project = doc.project().clone();
    let track = project.timeline.tracks[0].clips[0].effects[0]
        .keyframes
        .get_mut("amount")
        .unwrap();
    track[0].handle_out = Some([0.9, 0.05]);
    track[1].handle_in = Some([0.95, 0.1]);
    *doc = Document::from_project(project).unwrap();
}

// A slider dragged over a keyframed parameter is the Inspector's own version of the timeline
// drag: two hundred dispatches under one key, one entry on the undo stack.
#[test]
#[allow(clippy::unwrap_used)]
fn a_drag_over_a_keyframed_parameter_is_one_undo_step() {
    let (mut doc, clip) = doc_with_effect();
    let before = doc.history().labels().len();
    for step in 0..200 {
        doc.dispatch(
            Dispatch::new(add(&clip, 1.0, step as f32 / 200.0, Interp::Linear))
                .coalesce("kf:amount:1.0"),
        )
        .unwrap();
    }
    assert_eq!(doc.history().labels().len(), before + 1);

    doc.undo().unwrap();
    assert!(!doc.project().timeline.tracks[0].clips[0].effects[0]
        .keyframes
        .contains_key("amount"));
}

#[test]
#[allow(clippy::unwrap_used)]
fn removing_the_last_keyframe_takes_the_parameter_back_off_the_clock() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(Command::EffectSetParam {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
        key: "amount".into(),
        value: ParamValue::Float(0.5),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.9, Interp::Linear)))
        .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.9)));

    doc.dispatch(Dispatch::new(Command::KeyframeRemove {
        target: EffectTarget::Clip { clip },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        time: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert!(!doc.project().timeline.tracks[0].clips[0].effects[0]
        .keyframes
        .contains_key("amount"));
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.5)));
}

#[test]
#[allow(clippy::unwrap_used)]
fn removing_a_keyframe_that_is_not_there_is_rejected() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.9, Interp::Linear)))
        .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeRemove {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(2.0),
        }))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeRemove {
            target: EffectTarget::Clip { clip },
            effect_type: Some("brightness".into()),
            key: "contrast".into(),
            time: Time::from_seconds(1.0),
        }))
        .is_err());
}

#[test]
#[allow(clippy::unwrap_used)]
fn moving_a_keyframe_retimes_it_and_keeps_the_track_sorted() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 1.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::KeyframeMove {
        target: EffectTarget::Clip { clip },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        from: Time::from_seconds(0.0),
        to: Time::from_seconds(3.0),
    }))
    .unwrap();

    assert_eq!(keyframe_times(doc.project()), vec![1.0, 3.0]);
    assert_eq!(amount_at(doc.project(), 2.0), Some(ParamValue::Float(0.5)));
}

// A drag that ends where it began must not raise: the gesture cannot know in advance that it
// went nowhere, and a handler that throws looks in jsdom exactly like one that worked.
#[test]
#[allow(clippy::unwrap_used)]
fn moving_a_keyframe_onto_itself_is_accepted() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.5, Interp::Linear)))
        .unwrap();

    doc.dispatch(Dispatch::new(Command::KeyframeMove {
        target: EffectTarget::Clip { clip },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        from: Time::from_seconds(1.0),
        to: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(keyframe_times(doc.project()), vec![1.0]);
}

#[test]
#[allow(clippy::unwrap_used)]
fn moving_a_keyframe_onto_another_is_rejected() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 1.0, Interp::Linear)))
        .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeMove {
            target: EffectTarget::Clip { clip },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            from: Time::from_seconds(0.0),
            to: Time::from_seconds(1.0),
        }))
        .is_err());
    assert_eq!(keyframe_times(doc.project()), vec![0.0, 1.0]);
}

#[test]
#[allow(clippy::unwrap_used)]
fn switching_a_keyframe_to_hold_changes_what_the_parameter_reads() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.5)));

    doc.dispatch(Dispatch::new(Command::KeyframeSetInterp {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        time: Time::ZERO,
        interp: Interp::Hold,
    }))
    .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.0)));

    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeSetInterp {
            target: EffectTarget::Clip { clip },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: Time::from_seconds(1.5),
            interp: Interp::Ease,
        }))
        .is_err());
}

#[test]
#[allow(clippy::unwrap_used)]
fn keyframing_an_effect_the_clip_does_not_carry_is_rejected() {
    let (mut doc, clip) = doc_with_effect();
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeAdd {
            target: EffectTarget::Clip { clip },
            effect_type: Some("blur".into()),
            key: "amount".into(),
            time: Time::ZERO,
            value: ParamValue::Float(0.5),
            interp: Interp::Linear,
        }))
        .is_err());
}

// The pair the load path and the command layer have to agree on: a keyframe time this command
// accepts must be one `Project::normalize` would accept back, and vice versa.
#[test]
#[allow(clippy::unwrap_used)]
fn a_keyframe_time_outside_the_bound_is_rejected_and_would_not_load_either() {
    let (mut doc, clip) = doc_with_effect();
    let absurd = Time::from_flicks(i64::MAX);
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            time: absurd,
            value: ParamValue::Float(0.5),
            interp: Interp::Linear,
        }))
        .is_err());

    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Linear)))
        .unwrap();
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeMove {
            target: EffectTarget::Clip { clip },
            effect_type: Some("brightness".into()),
            key: "amount".into(),
            from: Time::ZERO,
            to: absurd,
        }))
        .is_err());

    let mut smuggled = doc.project().clone();
    smuggled.timeline.tracks[0].clips[0].effects[0]
        .keyframes
        .get_mut("amount")
        .unwrap()[0]
        .time = absurd;
    assert!(Document::from_project(smuggled).is_err());
}

#[test]
#[allow(clippy::unwrap_used)]
fn a_non_finite_keyframe_value_is_rejected() {
    let (mut doc, clip) = doc_with_effect();
    let command: Command = serde_json::from_value(serde_json::json!({
        "type": "keyframe.add",
        "target": { "kind": "clip", "clip": clip.as_str() },
        "effectType": "brightness",
        "key": "amount",
        "time": 0,
        "value": { "kind": "float", "value": 1e300 },
        "interp": "linear",
    }))
    .unwrap();
    assert!(doc.dispatch(Dispatch::new(command)).is_err());
}

// Bezier handles are the one part of a keyframe `normalize` used to wave through: a non-finite
// handle turns into a NaN inside `cubic_bezier_y_at`, and NaN reaches JS as `null`.
#[test]
#[allow(clippy::unwrap_used)]
fn a_non_finite_bezier_handle_fails_to_load() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();

    let mut json = serde_json::to_value(doc.project()).unwrap();
    json["timeline"]["tracks"][0]["clips"][0]["effects"][0]["keyframes"]["amount"][0]
        ["handleOut"] = serde_json::json!([1e300, 0.0]);
    let project: Project = serde_json::from_value(json).unwrap();
    assert!(Document::from_project(project).is_err());
}

// The other keyframe track a clip carries: its own transform, addressed by leaving `effectType`
// out. Until this existed, `Clip::keyframes` was a field nothing in the repository ever evaluated.
fn transform_key(clip: &ClipId, key: &str, seconds: f64, value: f32) -> Command {
    Command::KeyframeAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: None,
        key: key.into(),
        time: Time::from_seconds(seconds),
        value: ParamValue::Float(value),
        interp: Interp::Linear,
    }
}

#[test]
#[allow(clippy::unwrap_used)]
fn a_keyframed_transform_is_resolved_at_the_moment_asked_for() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(transform_key(&clip, "x", 0.0, 0.0)))
        .unwrap();
    doc.dispatch(Dispatch::new(transform_key(&clip, "x", 2.0, 100.0)))
        .unwrap();

    let clip_ref = &doc.project().timeline.tracks[0].clips[0];
    assert_eq!(clip_ref.transform_at(Time::from_seconds(1.0)).x, 50.0);
    assert_eq!(clip_ref.transform_at(Time::from_seconds(0.5)).x, 25.0);
}

// A motion path is authored with the same command, one point per key. The claim is the round trip
// an editor actually makes: the command accepts the track, and what comes back out of
// `transform_at` is the curve rather than the points as they were stored.
#[test]
#[allow(clippy::unwrap_used)]
fn a_motion_path_is_authored_with_the_ordinary_keyframe_command() {
    let (mut doc, clip) = doc_with_effect();
    for (seconds, x, y) in [(0.0, 0.0, 0.0), (2.0, 100.0, 0.0), (4.0, 100.0, 100.0)] {
        doc.dispatch(Dispatch::new(Command::KeyframeAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: None,
            key: "position".into(),
            time: Time::from_seconds(seconds),
            value: ParamValue::Vec2([x, y]),
            interp: Interp::Linear,
        }))
        .unwrap();
    }

    let clip_ref = &doc.project().timeline.tracks[0].clips[0];
    let on_key = clip_ref.transform_at(Time::from_seconds(2.0));
    assert_eq!((on_key.x, on_key.y), (100.0, 0.0));
    // Between the keys the clip is off the leg it would sit on if the three points were merely
    // joined up -- the curve is what the core resolves, not what the command stored.
    let bent = clip_ref.transform_at(Time::from_seconds(1.0));
    assert!(bent.y.abs() > 1.0, "the path did not bend, y={}", bent.y);
}

// The whole reason the command refuses a name it does not know: a keyframe written under one is
// saved, reloaded and never read, and the editor that wrote it has no way to tell.
#[test]
fn keyframing_a_transform_field_that_does_not_exist_is_refused() {
    let (mut doc, clip) = doc_with_effect();
    assert!(doc
        .dispatch(Dispatch::new(transform_key(&clip, "scale", 0.0, 2.0)))
        .is_err());
    assert!(doc.project().timeline.tracks[0].clips[0]
        .keyframes
        .is_empty());
}

// The one combination the address can express and the model cannot hold. A track and the project
// have effect chains but no geometry of their own.
#[test]
fn only_a_clip_has_a_transform_to_keyframe() {
    let (mut doc, _) = doc_with_effect();
    let track = doc.project().timeline.tracks[0].id.clone();
    for target in [EffectTarget::Track { track }, EffectTarget::Project] {
        assert!(doc
            .dispatch(Dispatch::new(Command::KeyframeAdd {
                target,
                effect_type: None,
                key: "x".into(),
                time: Time::ZERO,
                value: ParamValue::Float(1.0),
                interp: Interp::Linear,
            }))
            .is_err());
    }
}

// A transform track and an effect track of the same name are two different tracks, and the four
// keyframe commands have to keep reaching the one they were addressed to.
#[test]
#[allow(clippy::unwrap_used)]
fn a_transform_track_and_an_effect_track_do_not_share_a_name() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(transform_key(&clip, "opacity", 1.0, 0.25)))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::KeyframeAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: Some("brightness".into()),
        key: "opacity".into(),
        time: Time::from_seconds(1.0),
        value: ParamValue::Float(0.9),
        interp: Interp::Linear,
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::KeyframeRemove {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: None,
        key: "opacity".into(),
        time: Time::from_seconds(1.0),
    }))
    .unwrap();

    let clip_ref = &doc.project().timeline.tracks[0].clips[0];
    assert!(clip_ref.keyframes.is_empty());
    assert_eq!(clip_ref.effects[0].keyframes["opacity"].len(), 1);
}

#[test]
#[allow(clippy::unwrap_used)]
fn undoing_a_transform_keyframe_puts_the_clip_back_the_way_it_was() {
    let (mut doc, clip) = doc_with_effect();
    let before = serde_json::to_value(doc.project()).unwrap();

    doc.dispatch(Dispatch::new(transform_key(&clip, "rotation", 1.0, 45.0)))
        .unwrap();
    doc.undo().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
}
