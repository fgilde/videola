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

// An upsert carries a value and an interpolation and no handles, so the only thing it could do with
// the pair already on the key is destroy it. One drag of a slider over a keyframed parameter would
// then flatten a curve that took a curve editor to draw -- and `keyframe.setInterp` beside it
// changes the interpolation without touching them for the same reason.
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
    assert_ne!(
        bent,
        Some(ParamValue::Float(0.5)),
        "the handles have to bend it at all"
    );

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

// A pair that arrived by loading a project rather than through `keyframe.setHandles`. Both routes
// have to end at the same shape, and the command's own runs are further down this file.
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

fn set_handles(
    clip: &ClipId,
    seconds: f64,
    handle_in: Option<[f32; 2]>,
    handle_out: Option<[f32; 2]>,
) -> Command {
    Command::KeyframeSetHandles {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: Some("brightness".into()),
        key: "amount".into(),
        time: Time::from_seconds(seconds),
        handle_in,
        handle_out,
    }
}

// A curve editor's whole job, in the core: two keys, a pair of handles dragged onto the left one,
// and a value halfway along that is no longer halfway between them. Read at the middle rather than
// at the ends, where every easing ever written agrees with every other.
#[test]
#[allow(clippy::unwrap_used)]
fn dragged_handles_bend_the_value_between_two_keys() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    // The shape a bezier key opens on is ease-in-out, which is symmetric: it reaches the halfway
    // value at the halfway instant, exactly where a straight line would.
    let Some(ParamValue::Float(default)) = amount_at(doc.project(), 1.0) else {
        panic!("expected a float");
    };
    assert!((default - 0.5).abs() < 1e-3, "opened bent, at {default}");

    doc.dispatch(Dispatch::new(set_handles(
        &clip,
        0.0,
        None,
        Some([0.9, 0.05]),
    )))
    .unwrap();
    doc.dispatch(Dispatch::new(set_handles(
        &clip,
        2.0,
        Some([0.95, 0.1]),
        None,
    )))
    .unwrap();

    let Some(ParamValue::Float(middle)) = amount_at(doc.project(), 1.0) else {
        panic!("expected a float");
    };
    // Pinned rather than merely "below the line": both handles shape one segment, and with the
    // arriving one left at its default this reads 0.200 instead. A loose bound passes either way,
    // which is a run that cannot tell a command writing one handle from one writing the pair.
    assert!(
        (middle - 0.045_455).abs() < 1e-3,
        "the pair has to shape the middle, got {middle}"
    );
    assert_eq!(amount_at(doc.project(), 0.0), Some(ParamValue::Float(0.0)));
    assert_eq!(amount_at(doc.project(), 2.0), Some(ParamValue::Float(1.0)));

    let track = &doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"];
    assert_eq!(track[0].handle_out, Some([0.9, 0.05]));
    assert_eq!(track[1].handle_in, Some([0.95, 0.1]));
}

// The same hole `normalize` closes on the load path, on the route a drag takes. A NaN handle runs
// through `cubic_bezier_y_at` into the interpolated value and reaches JavaScript as `null`.
#[test]
#[allow(clippy::unwrap_used)]
fn a_non_finite_handle_is_refused_and_leaves_the_shape_standing() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(set_handles(
        &clip,
        0.0,
        None,
        Some([0.9, 0.05]),
    )))
    .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(set_handles(
            &clip,
            0.0,
            None,
            Some([f32::NAN, 0.0]),
        )))
        .is_err());
    assert_eq!(
        doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"][0].handle_out,
        Some([0.9, 0.05])
    );
}

// `null` is how the editor takes a curve back off a key without deleting the key.
#[test]
#[allow(clippy::unwrap_used)]
fn clearing_the_handles_puts_the_default_shape_back() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    let plain = amount_at(doc.project(), 1.0);

    doc.dispatch(Dispatch::new(set_handles(
        &clip,
        0.0,
        None,
        Some([0.9, 0.05]),
    )))
    .unwrap();
    assert_ne!(amount_at(doc.project(), 1.0), plain);

    doc.dispatch(Dispatch::new(set_handles(&clip, 0.0, None, None)))
        .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), plain);
    assert_eq!(
        doc.project().timeline.tracks[0].clips[0].effects[0].keyframes["amount"][0].handle_out,
        None
    );
}

// One drag is one undo step, and the step it undoes is the shape the curve had before it -- not the
// shape the last pointer move left behind.
#[test]
#[allow(clippy::unwrap_used)]
fn a_handle_drag_under_one_key_is_one_undo_step() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 2.0, 1.0, Interp::Linear)))
        .unwrap();
    let before = doc.history().labels().len();
    let plain = amount_at(doc.project(), 1.0);

    for step in 0..60 {
        doc.dispatch(
            Dispatch::new(set_handles(
                &clip,
                0.0,
                None,
                Some([0.2 + step as f32 / 100.0, 0.0]),
            ))
            .coalesce("curve-1"),
        )
        .unwrap();
    }

    assert_eq!(doc.history().labels().len(), before + 1);
    doc.undo().unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), plain);
}

// The rule the surface has to show and the core has to enforce: a rate track has no exact area
// under a bezier, so a curve editor standing on one may not offer the shape at all. Handles alone
// are harmless -- nothing reads them while the key is linear -- and the refusal sits where it can
// actually bite.
#[test]
#[allow(clippy::unwrap_used)]
fn a_speed_track_still_refuses_the_interpolation_a_curve_needs() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(speed_key(&clip, 1.0, 2.0, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::KeyframeSetHandles {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: None,
        key: "speed".into(),
        time: Time::from_seconds(1.0),
        handle_in: None,
        handle_out: Some([0.9, 0.05]),
    }))
    .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeSetInterp {
            target: EffectTarget::Clip { clip },
            effect_type: None,
            key: "speed".into(),
            time: Time::from_seconds(1.0),
            interp: Interp::Bezier,
        }))
        .is_err());
}

// A time nothing sits at is the same refusal every other keyframe command gives, and the reason a
// drag on a key that was just deleted cannot write a shape onto a key that never existed.
#[test]
#[allow(clippy::unwrap_used)]
fn handles_on_a_keyframe_that_is_not_there_are_refused() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(add(&clip, 0.0, 0.0, Interp::Bezier)))
        .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(set_handles(
            &clip,
            1.5,
            None,
            Some([0.5, 0.5]),
        )))
        .is_err());
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

fn speed_key(clip: &ClipId, seconds: f64, rate: f32, interp: Interp) -> Command {
    Command::KeyframeAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: None,
        key: "speed".into(),
        time: Time::from_seconds(seconds),
        value: ParamValue::Float(rate),
        interp,
    }
}

// A speed ramp is a keyframe track and nothing else, so the command that authors it is the one that
// authors a motion path. Two dispatches, and the clip reads its source by area from then on.
#[test]
#[allow(clippy::unwrap_used)]
fn two_speed_keyframes_make_a_ramp_the_clip_reads_its_source_by() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(speed_key(&clip, 0.0, 0.5, Interp::Linear)))
        .unwrap();
    doc.dispatch(Dispatch::new(speed_key(&clip, 2.0, 2.0, Interp::Linear)))
        .unwrap();

    let clip_ref = &doc.project().timeline.tracks[0].clips[0];
    let at = clip_ref
        .source_time_at(Time::from_seconds(1.0))
        .unwrap()
        .as_seconds();
    assert!((at - 0.875).abs() < 1e-6, "{at}");
}

// The rate track is the one name outside `Transform`'s roster that `keyframe.add` lets through, so
// the roster still has to turn everything else away.
#[test]
#[allow(clippy::unwrap_used)]
fn the_rate_track_is_the_only_name_outside_the_transform_roster() {
    let (mut doc, clip) = doc_with_effect();
    assert!(doc
        .dispatch(Dispatch::new(transform_key(&clip, "wobble", 1.0, 1.0)))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(speed_key(&clip, 1.0, 1.0, Interp::Linear)))
        .is_ok());
}

// The bounds the load path applies, applied by the command too — otherwise a rate a dispatch wrote
// is a rate the next open refuses, and the project a user saved will not come back.
#[test]
#[allow(clippy::unwrap_used)]
fn a_rate_keyframe_outside_the_bound_is_refused_by_the_command_and_by_the_loader() {
    let (mut doc, clip) = doc_with_effect();
    for rate in [-0.5, 1e30, 101.0] {
        assert!(
            doc.dispatch(Dispatch::new(speed_key(&clip, 1.0, rate, Interp::Linear)))
                .is_err(),
            "{rate} was accepted"
        );
    }
    assert!(doc.project().timeline.tracks[0].clips[0]
        .keyframes
        .is_empty());

    doc.dispatch(Dispatch::new(speed_key(&clip, 1.0, 0.0, Interp::Linear)))
        .unwrap();
    assert!(videola_core::Document::from_project(doc.project().clone()).is_ok());
}

// A bezier rate has no exact area, and an area that is not exactly additive would let a reversed
// clip's head fall past the end of the range a decoder may read. Refused on the way in, both as a
// value and as a later change of mind.
#[test]
#[allow(clippy::unwrap_used)]
fn a_bezier_rate_keyframe_is_refused_going_in_and_coming_back() {
    let (mut doc, clip) = doc_with_effect();
    assert!(doc
        .dispatch(Dispatch::new(speed_key(&clip, 1.0, 2.0, Interp::Bezier)))
        .is_err());

    doc.dispatch(Dispatch::new(speed_key(&clip, 1.0, 2.0, Interp::Linear)))
        .unwrap();
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeSetInterp {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: None,
            key: "speed".into(),
            time: Time::from_seconds(1.0),
            interp: Interp::Bezier,
        }))
        .is_err());
    assert_eq!(
        doc.project().timeline.tracks[0].clips[0].keyframes["speed"][0].interp,
        Interp::Linear
    );
}

// A rate that is not a number would integrate to nothing, and `integrate`'s fallback would quietly
// put the clip back on its static rate instead of reporting that the ramp is unreadable.
#[test]
#[allow(clippy::unwrap_used)]
fn a_rate_keyframe_that_is_not_a_number_is_refused() {
    let (mut doc, clip) = doc_with_effect();
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeAdd {
            target: EffectTarget::Clip { clip },
            effect_type: None,
            key: "speed".into(),
            time: Time::ZERO,
            value: ParamValue::Vec2([1.0, 1.0]),
            interp: Interp::Linear,
        }))
        .is_err());
}

// A compound clip's inner timeline is walked by inverting the outer rate, which is a division and
// only works while that rate is one number. Refusing is the honest answer; drawing the inside at
// the wrong instant is not.
#[test]
#[allow(clippy::unwrap_used)]
fn a_compound_clip_is_refused_a_speed_ramp() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(Command::ClipNest { clips: vec![clip] }))
        .unwrap();
    let compound = doc.project().timeline.tracks[0].clips[0].id.clone();

    assert!(doc
        .dispatch(Dispatch::new(speed_key(
            &compound,
            0.0,
            2.0,
            Interp::Linear
        )))
        .is_err());
    assert!(doc.project().timeline.tracks[0].clips[0]
        .keyframes
        .is_empty());
}

// The whole point of a preset being a command sequence: undo puts the clip back exactly, and the
// patch that does it was never written by hand.
#[test]
#[allow(clippy::unwrap_used)]
fn undoing_a_speed_ramp_puts_the_clip_back_the_way_it_was() {
    let (mut doc, clip) = doc_with_effect();
    let before = serde_json::to_value(doc.project()).unwrap();

    doc.dispatch(Dispatch::new(
        speed_key(&clip, 0.0, 0.5, Interp::Linear).clone(),
    ))
    .unwrap();
    doc.dispatch(Dispatch::new(speed_key(&clip, 2.0, 2.0, Interp::Linear)))
        .unwrap();
    doc.undo().unwrap();
    doc.undo().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
}

// The other half of "ramps and compounds do not mix". Folding a ramped clip into a compound would
// hand the fold a clip whose rate it multiplies and whose in point it trims by that same factor --
// neither of which a rate track is -- and the inside would be drawn at instants nobody authored.
#[test]
#[allow(clippy::unwrap_used)]
fn a_clip_carrying_a_speed_ramp_cannot_be_nested() {
    let (mut doc, clip) = doc_with_effect();
    doc.dispatch(Dispatch::new(speed_key(&clip, 0.0, 2.0, Interp::Linear)))
        .unwrap();

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipNest {
            clips: vec![clip.clone()],
        }))
        .is_err());
    assert!(matches!(
        doc.project().timeline.tracks[0].clips[0].source,
        ClipSource::Media { .. }
    ));
}
