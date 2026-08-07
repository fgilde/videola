use videola_core::command::{Command, Dispatch, TrimEdge};
use videola_core::model::{ClipSource, MediaId, ParamValue, Time, TrackKind};
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
fn split_on_the_exact_boundary_is_rejected() {
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
