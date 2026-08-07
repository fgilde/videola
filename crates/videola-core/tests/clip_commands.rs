use videola_core::command::{Command, Dispatch, TrimEdge};
use videola_core::model::{Clip, ClipSource, MediaId, ParamValue, Time, TrackKind};
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
            clip: clip.clone(),
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
            clip,
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
        clip: clip.clone(),
        effect_type: "brightness".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        clip: clip.clone(),
        effect_type: "contrast".into(),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::EffectSetParam {
        clip,
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
