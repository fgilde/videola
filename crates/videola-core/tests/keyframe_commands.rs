use videola_core::command::{Command, Dispatch};
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
        clip: clip.clone(),
        effect_type: "brightness".into(),
    }))
    .unwrap();
    (doc, clip)
}

fn add(clip: &ClipId, seconds: f64, value: f32, interp: Interp) -> Command {
    Command::KeyframeAdd {
        clip: clip.clone(),
        effect_type: "brightness".into(),
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
        clip: clip.clone(),
        effect_type: "brightness".into(),
        key: "amount".into(),
        value: ParamValue::Float(0.5),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(add(&clip, 1.0, 0.9, Interp::Linear)))
        .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.9)));

    doc.dispatch(Dispatch::new(Command::KeyframeRemove {
        clip,
        effect_type: "brightness".into(),
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
            clip: clip.clone(),
            effect_type: "brightness".into(),
            key: "amount".into(),
            time: Time::from_seconds(2.0),
        }))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeRemove {
            clip,
            effect_type: "brightness".into(),
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
        clip,
        effect_type: "brightness".into(),
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
        clip,
        effect_type: "brightness".into(),
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
            clip,
            effect_type: "brightness".into(),
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
        clip: clip.clone(),
        effect_type: "brightness".into(),
        key: "amount".into(),
        time: Time::ZERO,
        interp: Interp::Hold,
    }))
    .unwrap();
    assert_eq!(amount_at(doc.project(), 1.0), Some(ParamValue::Float(0.0)));

    assert!(doc
        .dispatch(Dispatch::new(Command::KeyframeSetInterp {
            clip,
            effect_type: "brightness".into(),
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
            clip,
            effect_type: "blur".into(),
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
            clip: clip.clone(),
            effect_type: "brightness".into(),
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
            clip,
            effect_type: "brightness".into(),
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
        "clip": clip.as_str(),
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
