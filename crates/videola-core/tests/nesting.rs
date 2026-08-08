use videola_core::command::{Command, Dispatch};
use videola_core::model::{
    Clip, ClipSource, MediaId, Time, Timeline, Track, TrackKind, Transition, TransitionAlignment,
    MAX_COMPOUND_DEPTH,
};
use videola_core::{CoreError, Document};

#[allow(clippy::unwrap_used)]
fn doc_with_tracks(count: usize) -> Document {
    let mut doc = Document::new();
    for index in 0..count {
        doc.dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Video,
            name: format!("V{}", index + 1),
            index: None,
        }))
        .unwrap();
    }
    doc
}

#[allow(clippy::unwrap_used)]
fn add_clip(doc: &mut Document, track: usize, start_s: f64, dur_s: f64) -> videola_core::model::ClipId {
    let track = doc.project().timeline.tracks[track].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(dur_s),
    }))
    .unwrap();
    doc.project()
        .timeline
        .tracks
        .iter()
        .find(|candidate| candidate.id == track)
        .and_then(|candidate| candidate.clips.last())
        .map(|clip| clip.id.clone())
        .unwrap()
}

fn compound_of(clip: &Clip) -> &Timeline {
    match &clip.source {
        ClipSource::Compound { timeline } => timeline,
        other => panic!("expected a compound clip, found {other:?}"),
    }
}

// What nesting has to preserve, and the only thing that makes the picture identical: every project
// instant the clip still covers must reach the same instant of the same medium it reached before.
// Reading it back out means composing the compound's own mapping with the nested clip's, which is
// exactly the chain the renderer and `source_times_at` walk.
fn source_time_through(compound: &Clip, nested: &Clip, at: Time) -> Option<Time> {
    nested.source_time_at(compound.readable_source_time_at(at)?)
}

#[test]
#[allow(clippy::unwrap_used)]
fn nesting_two_clips_replaces_them_with_one_compound_over_their_span() {
    let mut doc = doc_with_tracks(1);
    let first = add_clip(&mut doc, 0, 1.0, 2.0);
    let second = add_clip(&mut doc, 0, 4.0, 3.0);

    doc.dispatch(Dispatch::new(Command::ClipNest {
        clips: vec![first, second],
    }))
    .unwrap();

    let clips = &doc.project().timeline.tracks[0].clips;
    assert_eq!(clips.len(), 1);
    assert_eq!(clips[0].start.as_seconds(), 1.0);
    assert_eq!(clips[0].duration.as_seconds(), 6.0);
    let nested = &compound_of(&clips[0]).tracks[0].clips;
    assert_eq!(nested.len(), 2);
    assert_eq!(nested[0].start.as_seconds(), 0.0);
    assert_eq!(nested[1].start.as_seconds(), 3.0);
}

// The claim the pixel harness proves on a screen, made here on the model: nesting changes where a
// clip is written down and not what it reads at any instant.
#[test]
#[allow(clippy::unwrap_used)]
fn every_instant_reads_the_same_source_after_nesting() {
    let mut doc = doc_with_tracks(1);
    let first = add_clip(&mut doc, 0, 1.0, 2.0);
    let second = add_clip(&mut doc, 0, 4.0, 3.0);
    let before: Vec<Clip> = doc.project().timeline.tracks[0].clips.clone();

    doc.dispatch(Dispatch::new(Command::ClipNest {
        clips: vec![first, second],
    }))
    .unwrap();

    let compound = doc.project().timeline.tracks[0].clips[0].clone();
    let nested = compound_of(&compound).tracks[0].clips.clone();
    let step = Time::from_seconds(1.0 / 60.0);
    let mut at = Time::ZERO;
    while at < Time::from_seconds(8.0) {
        for (original, inside) in before.iter().zip(nested.iter()) {
            assert_eq!(
                source_time_through(&compound, inside, at),
                original.source_time_at(at),
                "diverged at {}s",
                at.as_seconds()
            );
        }
        at = at + step;
    }
}

#[test]
#[allow(clippy::unwrap_used)]
fn a_nested_clip_keeps_its_speed_and_direction() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 2.0, 4.0);
    doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
        clip: clip.clone(),
        rate: 2.0,
        reverse: true,
        preserve_pitch: true,
    }))
    .unwrap();
    let before = doc.project().timeline.tracks[0].clips[0].clone();

    doc.dispatch(Dispatch::new(Command::ClipNest { clips: vec![clip] }))
        .unwrap();

    let compound = doc.project().timeline.tracks[0].clips[0].clone();
    let inside = compound_of(&compound).tracks[0].clips[0].clone();
    for tenth in 0..60 {
        let at = Time::from_seconds(f64::from(tenth) / 10.0);
        assert_eq!(
            source_time_through(&compound, &inside, at),
            before.source_time_at(at),
            "diverged at {}s",
            at.as_seconds()
        );
    }
}

// tracks[0] is the bottom of the stack, inside a compound as much as outside one -- a nested
// timeline that reversed the order would put the title under the picture it labels.
#[test]
#[allow(clippy::unwrap_used)]
fn nesting_across_tracks_keeps_the_stacking_order() {
    let mut doc = doc_with_tracks(2);
    let lower = add_clip(&mut doc, 0, 0.0, 2.0);
    let upper = add_clip(&mut doc, 1, 0.0, 2.0);
    let lower_media = doc.project().timeline.tracks[0].clips[0].id.clone();

    doc.dispatch(Dispatch::new(Command::ClipNest {
        clips: vec![upper, lower],
    }))
    .unwrap();

    let tracks = &doc.project().timeline.tracks;
    assert_eq!(tracks[0].clips.len(), 1, "the compound lands on the lowest track");
    assert!(tracks[1].clips.is_empty());
    let nested = compound_of(&tracks[0].clips[0]);
    assert_eq!(nested.tracks.len(), 2);
    assert_eq!(nested.tracks[0].clips[0].id, lower_media);
}

#[test]
#[allow(clippy::unwrap_used)]
fn a_nested_track_gets_an_id_of_its_own() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 0.0, 2.0);
    let outer = doc.project().timeline.tracks[0].id.clone();

    doc.dispatch(Dispatch::new(Command::ClipNest { clips: vec![clip] }))
        .unwrap();

    let nested = compound_of(&doc.project().timeline.tracks[0].clips[0]);
    assert_ne!(nested.tracks[0].id, outer);
}

#[test]
#[allow(clippy::unwrap_used)]
fn naming_the_same_clip_twice_nests_it_once() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 0.0, 2.0);

    doc.dispatch(Dispatch::new(Command::ClipNest {
        clips: vec![clip.clone(), clip],
    }))
    .unwrap();

    let nested = compound_of(&doc.project().timeline.tracks[0].clips[0]);
    assert_eq!(nested.tracks[0].clips.len(), 1);
}

#[test]
#[allow(clippy::unwrap_used)]
fn nesting_nothing_is_refused() {
    let mut doc = doc_with_tracks(1);
    assert!(matches!(
        doc.dispatch(Dispatch::new(Command::ClipNest { clips: Vec::new() })),
        Err(CoreError::InvalidArgument(_))
    ));
}

// One unknown id must cost the whole command, not the clips named before it.
#[test]
#[allow(clippy::unwrap_used)]
fn an_unknown_clip_leaves_the_timeline_untouched() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 0.0, 2.0);
    let before = doc.project().clone();

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipNest {
            clips: vec![clip, videola_core::model::ClipId::from("clp_nope".to_string())],
        }))
        .is_err());
    assert_eq!(doc.project(), &before);
}

// The depth cap is the one guard nesting has, and it has to fire before anything is moved --
// a refusal that has already emptied the tracks is not a refusal.
#[test]
#[allow(clippy::unwrap_used)]
fn nesting_past_the_depth_cap_leaves_the_timeline_untouched() {
    let mut doc = doc_with_tracks(1);
    let mut clip = add_clip(&mut doc, 0, 0.0, 2.0);
    for _ in 0..MAX_COMPOUND_DEPTH {
        doc.dispatch(Dispatch::new(Command::ClipNest {
            clips: vec![clip.clone()],
        }))
        .unwrap();
        clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    }
    let before = doc.project().clone();

    assert!(matches!(
        doc.dispatch(Dispatch::new(Command::ClipNest { clips: vec![clip] })),
        Err(CoreError::InvalidArgument(_))
    ));
    assert_eq!(doc.project(), &before);
}

fn a_transition() -> Transition {
    Transition {
        transition_type: "crossfade".into(),
        duration: Time::from_seconds(0.5),
        alignment: TransitionAlignment::In,
        params: Default::default(),
    }
}

// A transition mixes its clip with the picture underneath, and a compound arrives at the
// compositor as several clips -- the mix would count that picture once per nested clip.
#[test]
#[allow(clippy::unwrap_used)]
fn a_transition_on_a_compound_clip_is_refused() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipNest {
        clips: vec![clip.clone()],
    }))
    .unwrap();
    let compound = doc.project().timeline.tracks[0].clips[0].id.clone();

    assert!(matches!(
        doc.dispatch(Dispatch::new(Command::ClipSetTransition {
            clip: compound,
            transition: Some(a_transition()),
        })),
        Err(CoreError::InvalidArgument(_))
    ));
}

#[test]
#[allow(clippy::unwrap_used)]
fn a_transition_on_an_ordinary_clip_is_still_accepted() {
    let mut doc = doc_with_tracks(1);
    let clip = add_clip(&mut doc, 0, 0.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSetTransition {
            clip,
            transition: Some(a_transition()),
        }))
        .is_ok());
}

// The load path and the command handler share the check, so a project file cannot smuggle in what
// the command refuses.
#[test]
#[allow(clippy::unwrap_used)]
fn a_stored_transition_on_a_compound_clip_fails_to_load() {
    let mut project = videola_core::model::Project::default();
    let mut track = Track::new(TrackKind::Video, "V1".into());
    let mut inner = Track::new(TrackKind::Video, "nested".into());
    inner.clips.push(Clip::new_media(
        MediaId::from("med_a".to_string()),
        Time::ZERO,
        Time::from_seconds(1.0),
    ));
    let mut timeline = Timeline::default();
    timeline.tracks.push(inner);
    let mut compound = Clip::new_media(MediaId::from(String::new()), Time::ZERO, Time::from_seconds(1.0));
    compound.source = ClipSource::Compound {
        timeline: Box::new(timeline),
    };
    compound.transition_in = Some(a_transition());
    track.clips.push(compound);
    project.timeline.tracks.push(track);

    assert!(matches!(
        Document::from_project(project),
        Err(CoreError::InvalidArgument(_))
    ));
}
