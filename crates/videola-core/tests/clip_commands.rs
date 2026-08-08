use videola_core::command::{Command, Dispatch, EffectTarget, TrimEdge};
use videola_core::model::{
    Clip, ClipSource, Generator, MediaId, ParamValue, Time, Timeline, Track, TrackKind, Transition,
};
use videola_core::Document;

#[allow(clippy::unwrap_used)]
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
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(dur_s),
    }))
    .unwrap();
    (doc, track)
}

// The contract a trim or split must never break: every timeline instant a surviving clip still
// covers must keep reading the same instant of source material it read before the edit.
#[allow(clippy::unwrap_used)]
fn assert_same_source_mapping(original: &Clip, part: &Clip, from: Time, to: Time) {
    let step = Time::from_seconds(0.25);
    let mut t = from;
    while t < to {
        assert_eq!(
            part.source_time_at(t),
            original.source_time_at(t),
            "source mapping diverged at t={:?}s (rate={}, reverse={})",
            t.as_seconds(),
            part.speed.rate,
            part.speed.reverse
        );
        t = t + step;
    }
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
            source: ClipSource::Media {
                media: MediaId::from("med_a".to_string())
            },
            start: Time::ZERO,
            duration: Time::ZERO,
        }))
        .is_err());
}

#[test]
fn a_negative_duration_clip_is_rejected() {
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
            source: ClipSource::Media {
                media: MediaId::from("med_a".to_string())
            },
            start: Time::ZERO,
            duration: Time::from_seconds(-1.0),
        }))
        .is_err());
}

#[test]
fn an_absurdly_large_clip_is_rejected() {
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
            source: ClipSource::Media {
                media: MediaId::from("med_a".to_string())
            },
            start: Time::from_flicks(i64::MAX),
            duration: Time::from_flicks(i64::MAX),
        }))
        .is_err());
}

// N3 (2nd round): a compound clip's nested timeline is not exempt from the same bound — an
// out-of-range Time buried inside it must fail here, on the command that stores it, not only on
// the next load.
#[test]
fn a_compound_clip_with_an_absurd_nested_start_is_rejected() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();

    let mut nested_clip = Clip::new_media(
        MediaId::from("med_a".to_string()),
        Time::ZERO,
        Time::from_seconds(1.0),
    );
    nested_clip.start = Time::from_flicks(i64::MAX);
    let mut nested_track = Track::new(TrackKind::Video, "nested".into());
    nested_track.clips.push(nested_clip);
    let mut nested_timeline = Timeline::default();
    nested_timeline.tracks.push(nested_track);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipAdd {
            track,
            source: ClipSource::Compound {
                timeline: Box::new(nested_timeline)
            },
            start: Time::ZERO,
            duration: Time::from_seconds(1.0),
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
    assert_eq!(
        doc.project().timeline.tracks[1].clips[0].start.as_seconds(),
        5.0
    );
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
fn removing_a_clip_deletes_it() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipRemove { clip }))
        .unwrap();
    assert!(doc.project().timeline.tracks[0].clips.is_empty());
}

#[test]
fn clip_volume_is_clamped_and_rejects_non_finite_values() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipSetVolume {
        clip: clip.clone(),
        volume: 9.0,
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].clips[0].volume, 4.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetVolume {
            clip,
            volume: f32::NAN
        }))
        .is_err());
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
fn a_trim_delta_that_would_overflow_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipTrim {
            clip,
            edge: TrimEdge::End,
            delta: Time::from_flicks(i64::MAX),
        }))
        .is_err());
}

// C1/F4: a reversed clip maps timeline-start to the *end* of its consumed source range, so the
// edge that owns in_point flips between forward and reverse. This matrix is the regression test
// for that: an implementation that ignores speed.rate or speed.reverse fails somewhere in it.
#[test]
fn trim_preserves_source_mapping_across_rate_and_reverse() {
    for rate in [0.5f32, 1.0, 2.0] {
        for reverse in [false, true] {
            for edge in [TrimEdge::Start, TrimEdge::End] {
                let (mut doc, _) = doc_with_clip(0.0, 4.0);
                let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
                doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
                    clip: clip.clone(),
                    rate,
                    reverse,
                    preserve_pitch: false,
                }))
                .unwrap();
                let original = doc.project().timeline.tracks[0].clips[0].clone();

                let delta = match edge {
                    TrimEdge::Start => Time::from_seconds(1.0),
                    TrimEdge::End => Time::from_seconds(-1.0),
                };
                doc.dispatch(Dispatch::new(Command::ClipTrim {
                    clip: clip.clone(),
                    edge,
                    delta,
                }))
                .unwrap();

                let trimmed = doc.project().timeline.tracks[0].clips[0].clone();
                assert_same_source_mapping(&original, &trimmed, trimmed.start, trimmed.end());
            }
        }
    }
}

#[test]
fn split_produces_two_adjacent_clips_with_continuous_source_range() {
    let (mut doc, _) = doc_with_clip(0.0, 4.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipSplit {
        clip: clip.clone(),
        at: Time::from_seconds(1.5),
    }))
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
        .dispatch(Dispatch::new(Command::ClipSplit {
            clip,
            at: Time::from_seconds(9.0)
        }))
        .is_err());
}

#[test]
fn split_on_the_exact_start_boundary_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSplit {
            clip,
            at: Time::ZERO
        }))
        .is_err());
}

#[test]
fn split_on_the_exact_end_boundary_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSplit {
            clip,
            at: Time::from_seconds(2.0)
        }))
        .is_err());
}

// C1: an implementation that drops the `* rate` scaling, or does not swap roles for `reverse`,
// passes the single-rate/forward-only test above but fails this matrix.
#[test]
fn split_preserves_source_mapping_across_rate_and_reverse() {
    for rate in [0.5f32, 1.0, 2.0] {
        for reverse in [false, true] {
            let (mut doc, _) = doc_with_clip(0.0, 4.0);
            let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
            doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
                clip: clip.clone(),
                rate,
                reverse,
                preserve_pitch: false,
            }))
            .unwrap();
            let original = doc.project().timeline.tracks[0].clips[0].clone();

            doc.dispatch(Dispatch::new(Command::ClipSplit {
                clip: clip.clone(),
                at: Time::from_seconds(1.5),
            }))
            .unwrap();

            let clips = doc.project().timeline.tracks[0].clips.clone();
            assert_eq!(clips.len(), 2);
            assert_same_source_mapping(&original, &clips[0], clips[0].start, clips[0].end());
            assert_same_source_mapping(&original, &clips[1], clips[1].start, clips[1].end());
        }
    }
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
fn an_absurd_speed_rate_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetSpeed {
            clip,
            rate: 1e30,
            reverse: false,
            preserve_pitch: false,
        }))
        .is_err());
}

#[test]
fn non_finite_speed_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetSpeed {
            clip,
            rate: f32::NAN,
            reverse: false,
            preserve_pitch: false,
        }))
        .is_err());
}

#[test]
fn adding_an_effect_twice_reuses_the_existing_one() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    for _ in 0..2 {
        doc.dispatch(Dispatch::new(Command::EffectAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
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
            target: EffectTarget::Clip { clip },
            effect_type: "brightness".into(),
            key: "amount".into(),
            value: ParamValue::Float(0.5),
        }))
        .is_err());
}

#[test]
fn setting_an_effect_param_updates_the_matching_effect_only() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "contrast".into(),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::EffectSetParam {
        target: EffectTarget::Clip { clip },
        effect_type: "contrast".into(),
        key: "amount".into(),
        value: ParamValue::Float(0.5),
    }))
    .unwrap();

    let clip = &doc.project().timeline.tracks[0].clips[0];
    let brightness = clip
        .effects
        .iter()
        .find(|e| e.effect_type == "brightness")
        .unwrap();
    let contrast = clip
        .effects
        .iter()
        .find(|e| e.effect_type == "contrast")
        .unwrap();
    assert_eq!(brightness.static_param("amount"), None);
    assert_eq!(
        contrast.static_param("amount"),
        Some(&ParamValue::Float(0.5))
    );
}

// C2 follow-up: a `1e300` param value dispatches fine, serialises to `null` in Rust's own
// `serde_json::to_string` (JS never enters into it), and the resulting `.videola` then fails to
// reopen with "invalid type: null, expected f32" — a dispatch that succeeds must not produce a
// file that can never be loaded again. Covers every float-carrying `ParamValue` variant, not
// just `Float`.
#[test]
fn setting_a_non_finite_effect_param_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
    }))
    .unwrap();

    for value in [
        ParamValue::Float(f32::INFINITY),
        ParamValue::Color([f32::INFINITY, 0.0, 0.0, 1.0]),
        ParamValue::Vec2([f32::INFINITY, 0.0]),
    ] {
        assert!(
            doc.dispatch(Dispatch::new(Command::EffectSetParam {
                target: EffectTarget::Clip { clip: clip.clone() },
                effect_type: "brightness".into(),
                key: "amount".into(),
                value: value.clone(),
            }))
            .is_err(),
            "{value:?} should have been rejected"
        );
    }
}

#[test]
fn setting_a_legitimate_effect_param_still_works() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip { clip: clip.clone() },
        effect_type: "brightness".into(),
    }))
    .unwrap();

    for value in [
        ParamValue::Float(0.5),
        ParamValue::Color([0.2, 0.4, 0.6, 1.0]),
        ParamValue::Vec2([1.0, -1.0]),
    ] {
        doc.dispatch(Dispatch::new(Command::EffectSetParam {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "brightness".into(),
            key: "amount".into(),
            value: value.clone(),
        }))
        .unwrap_or_else(|error| panic!("{value:?} should have been accepted: {error}"));
    }
}

// Same failure mode, different entry point: `clip.add`'s `ClipSource::Generator` carries a
// `Generator::Gradient` whose `angle` is exactly as reachable from a dispatch as an effect param.
#[test]
fn adding_a_gradient_clip_with_a_non_finite_angle_is_rejected() {
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
            source: ClipSource::Generator {
                generator: Generator::Gradient {
                    from: "#000000".into(),
                    to: "#ffffff".into(),
                    angle: f32::INFINITY,
                },
            },
            start: Time::ZERO,
            duration: Time::from_seconds(1.0),
        }))
        .is_err());
}

#[test]
fn adding_a_gradient_clip_with_a_legitimate_angle_still_works() {
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
        source: ClipSource::Generator {
            generator: Generator::Gradient {
                from: "#000000".into(),
                to: "#ffffff".into(),
                angle: 45.0,
            },
        },
        start: Time::ZERO,
        duration: Time::from_seconds(1.0),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].clips.len(), 1);
}

#[allow(clippy::unwrap_used)]
fn clip_id(doc: &Document) -> videola_core::model::ClipId {
    doc.project().timeline.tracks[0].clips[0].id.clone()
}

// Without this command a 640x360 clip sits as a small rectangle in a 1080p frame: the draw list
// maps one source pixel onto one project pixel, and nothing could ever say otherwise.
#[test]
fn setting_a_transform_scales_a_clip_to_fill_the_frame() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let mut transform = doc.project().timeline.tracks[0].clips[0].transform.clone();
    transform.scale_x = 3.0;
    transform.scale_y = 3.0;
    transform.crop.left = 0.1;

    doc.dispatch(Dispatch::new(Command::ClipSetTransform {
        clip,
        transform: transform.clone(),
    }))
    .unwrap();

    assert_eq!(
        doc.project().timeline.tracks[0].clips[0].transform,
        transform
    );
}

#[test]
fn a_non_finite_transform_is_rejected_and_would_not_load_either() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let command: Command = serde_json::from_value(serde_json::json!({
        "type": "clip.setTransform",
        "clip": clip.as_str(),
        "transform": {
            "x": 0.0, "y": 0.0, "scaleX": 1e300, "scaleY": 1.0, "rotation": 0.0,
            "anchorX": 0.5, "anchorY": 0.5, "opacity": 1.0,
            "crop": { "left": 0.0, "top": 0.0, "right": 0.0, "bottom": 0.0 },
        },
    }))
    .unwrap();
    assert!(doc.dispatch(Dispatch::new(command)).is_err());

    let mut json = serde_json::to_value(doc.project()).unwrap();
    json["timeline"]["tracks"][0]["clips"][0]["transform"]["scaleX"] = serde_json::json!(1e300);
    let project: videola_core::model::Project = serde_json::from_value(json).unwrap();
    assert!(Document::from_project(project).is_err());
}

#[test]
fn undoing_a_transform_restores_the_previous_one() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let before = doc.project().timeline.tracks[0].clips[0].transform.clone();
    let mut transform = before.clone();
    transform.rotation = 90.0;

    doc.dispatch(Dispatch::new(Command::ClipSetTransform { clip, transform }))
        .unwrap();
    doc.undo().unwrap();

    assert_eq!(doc.project().timeline.tracks[0].clips[0].transform, before);
}

#[test]
fn a_transition_is_set_on_the_incoming_edge_and_cleared_by_null() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let transition = Transition::new("crossfade", Time::from_seconds(1.0));

    doc.dispatch(Dispatch::new(Command::ClipSetTransition {
        clip: clip.clone(),
        transition: Some(transition.clone()),
    }))
    .unwrap();
    let placed = &doc.project().timeline.tracks[0].clips[0];
    assert_eq!(placed.transition_in.as_ref(), Some(&transition));
    assert!(placed.transition_out.is_none());

    doc.dispatch(Dispatch::new(Command::ClipSetTransition {
        clip,
        transition: None,
    }))
    .unwrap();
    assert!(doc.project().timeline.tracks[0].clips[0]
        .transition_in
        .is_none());
}

#[test]
fn a_negative_transition_duration_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let mut transition = Transition::new("crossfade", Time::from_flicks(-1));
    transition.alignment = videola_core::model::TransitionAlignment::In;

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetTransition {
            clip,
            transition: Some(transition),
        }))
        .is_err());
}

#[test]
fn a_non_finite_transition_param_is_rejected_and_would_not_load_either() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    let clip = clip_id(&doc);
    let command: Command = serde_json::from_value(serde_json::json!({
        "type": "clip.setTransition",
        "clip": clip.as_str(),
        "transition": {
            "transitionType": "crossfade",
            "duration": 705_600_000,
            "alignment": "in",
            "params": { "softness": { "kind": "float", "value": 1e300 } },
        },
    }))
    .unwrap();
    assert!(doc.dispatch(Dispatch::new(command)).is_err());

    doc.dispatch(Dispatch::new(Command::ClipSetTransition {
        clip,
        transition: Some(Transition::new("crossfade", Time::from_seconds(1.0))),
    }))
    .unwrap();
    let mut json = serde_json::to_value(doc.project()).unwrap();
    json["timeline"]["tracks"][0]["clips"][0]["transitionIn"]["params"] =
        serde_json::json!({ "softness": { "kind": "float", "value": 1e300 } });
    let project: videola_core::model::Project = serde_json::from_value(json).unwrap();
    assert!(Document::from_project(project).is_err());
}

#[test]
fn a_transition_on_a_clip_that_is_not_there_is_rejected() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetTransition {
            clip: videola_core::model::ClipId::from("clp_nope".to_string()),
            transition: Some(Transition::new("crossfade", Time::from_seconds(1.0))),
        }))
        .is_err());
}

// The two chains that have been in the model since M0 with no command able to reach them. An
// equaliser on a track and a mastering chain on the project are the same three commands a clip
// effect already uses, pointed somewhere else.
#[test]
#[allow(clippy::unwrap_used)]
fn an_effect_can_be_added_to_a_track_and_to_the_project() {
    let (mut doc, track) = doc_with_clip(0.0, 2.0);
    for (target, effect_type) in [
        (
            EffectTarget::Track {
                track: track.clone(),
            },
            "eq",
        ),
        (EffectTarget::Project, "limiter"),
    ] {
        doc.dispatch(Dispatch::new(Command::EffectAdd {
            target: target.clone(),
            effect_type: effect_type.into(),
        }))
        .unwrap();
        doc.dispatch(Dispatch::new(Command::EffectSetParam {
            target,
            effect_type: effect_type.into(),
            key: "gain".into(),
            value: ParamValue::Float(0.5),
        }))
        .unwrap();
    }

    assert_eq!(
        doc.project().timeline.tracks[0].effects[0].static_param("gain"),
        Some(&ParamValue::Float(0.5))
    );
    assert_eq!(
        doc.project().master.effects[0].static_param("gain"),
        Some(&ParamValue::Float(0.5))
    );
    // The clip's own chain is a third place, and none of this went anywhere near it.
    assert!(doc.project().timeline.tracks[0].clips[0].effects.is_empty());
}

#[test]
fn an_effect_on_a_track_that_is_not_there_is_refused() {
    let (mut doc, _) = doc_with_clip(0.0, 2.0);
    assert!(doc
        .dispatch(Dispatch::new(Command::EffectAdd {
            target: EffectTarget::Track {
                track: videola_core::model::TrackId::from("trk_nope".to_string()),
            },
            effect_type: "eq".into(),
        }))
        .is_err());
}

// The same `finite` rule the load path applies to `master.volume`, and the clamp a fader needs.
#[test]
#[allow(clippy::unwrap_used)]
fn the_master_fader_is_clamped_and_refuses_a_non_finite_gain() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::ProjectSetMasterVolume {
        volume: 0.25,
    }))
    .unwrap();
    assert_eq!(doc.project().master.volume, 0.25);

    doc.dispatch(Dispatch::new(Command::ProjectSetMasterVolume {
        volume: 900.0,
    }))
    .unwrap();
    assert_eq!(doc.project().master.volume, 4.0);

    doc.dispatch(Dispatch::new(Command::ProjectSetMasterVolume {
        volume: -3.0,
    }))
    .unwrap();
    assert_eq!(doc.project().master.volume, 0.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ProjectSetMasterVolume {
            volume: f32::INFINITY,
        }))
        .is_err());
}
