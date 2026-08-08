#![allow(clippy::unwrap_used)]

use videola_core::command::{Command, Dispatch, EffectTarget, TrimEdge};
use videola_core::model::{
    Clip, ClipId, ClipSource, MediaId, Project, Time, Timeline, Track, TrackId, TrackKind,
};
use videola_core::Document;

fn doc_with_track() -> (Document, TrackId) {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    (doc, track)
}

fn add_clip(doc: &mut Document, track: &TrackId, start_s: f64, duration_s: f64) -> ClipId {
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(duration_s),
    }))
    .unwrap();
    let track = doc.project().track(track).unwrap();
    track
        .clips
        .iter()
        .find(|clip| clip.start == Time::from_seconds(start_s))
        .unwrap()
        .id
        .clone()
}

// Three clips butted end to end, the shape every ripple, roll and slide test needs.
fn doc_with_a_run() -> (Document, TrackId, Vec<ClipId>) {
    let (mut doc, track) = doc_with_track();
    let ids = vec![
        add_clip(&mut doc, &track, 0.0, 2.0),
        add_clip(&mut doc, &track, 2.0, 2.0),
        add_clip(&mut doc, &track, 4.0, 2.0),
    ];
    (doc, track, ids)
}

fn spans(project: &Project, track: usize) -> Vec<(f64, f64)> {
    project.timeline.tracks[track]
        .clips
        .iter()
        .map(|clip| (clip.start.as_seconds(), clip.duration.as_seconds()))
        .collect()
}

fn clip_of<'p>(project: &'p Project, id: &ClipId) -> &'p Clip {
    project
        .timeline
        .tracks
        .iter()
        .flat_map(|track| track.clips.iter())
        .find(|clip| &clip.id == id)
        .unwrap()
}

#[test]
fn ripple_delete_closes_the_gap_it_leaves() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipRippleDelete {
        clip: ids[1].clone(),
    }))
    .unwrap();

    assert_eq!(spans(doc.project(), 0), vec![(0.0, 2.0), (2.0, 2.0)]);
    assert_eq!(clip_of(doc.project(), &ids[2]).start.as_seconds(), 2.0);
}

#[test]
fn ripple_delete_leaves_the_clips_in_front_of_it_alone() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipRippleDelete {
        clip: ids[2].clone(),
    }))
    .unwrap();

    assert_eq!(spans(doc.project(), 0), vec![(0.0, 2.0), (2.0, 2.0)]);
}

#[test]
fn ripple_delete_moves_nothing_on_another_track() {
    let (mut doc, _, ids) = doc_with_a_run();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: None,
    }))
    .unwrap();
    let other = doc.project().timeline.tracks[1].id.clone();
    add_clip(&mut doc, &other, 4.0, 1.0);

    doc.dispatch(Dispatch::new(Command::ClipRippleDelete {
        clip: ids[0].clone(),
    }))
    .unwrap();

    assert_eq!(spans(doc.project(), 1), vec![(4.0, 1.0)]);
}

// The rule the handler documents: only what begins at or after the removed clip's end is part of
// the run being closed up. A clip that reaches across that end would be turned into an overlap.
#[test]
fn ripple_delete_keeps_a_clip_that_overlaps_the_removed_one_where_it_is() {
    let (mut doc, track) = doc_with_track();
    let removed = add_clip(&mut doc, &track, 0.0, 4.0);
    add_clip(&mut doc, &track, 2.0, 4.0);

    doc.dispatch(Dispatch::new(Command::ClipRippleDelete { clip: removed }))
        .unwrap();

    assert_eq!(spans(doc.project(), 0), vec![(2.0, 4.0)]);
}

#[test]
fn ripple_delete_of_an_unknown_clip_is_refused() {
    let (mut doc, _, _) = doc_with_a_run();
    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRippleDelete {
            clip: ClipId::from("clp_nope".to_string()),
        }))
        .is_err());
    assert_eq!(doc.project().timeline.tracks[0].clips.len(), 3);
}

// The gap closing and the removal are one patch, so one undo puts the whole track back.
#[test]
fn a_ripple_delete_is_a_single_undo_step() {
    let (mut doc, _, ids) = doc_with_a_run();
    let before = spans(doc.project(), 0);
    let steps = doc.history().labels().len();

    doc.dispatch(Dispatch::new(Command::ClipRippleDelete {
        clip: ids[1].clone(),
    }))
    .unwrap();
    assert_eq!(doc.history().labels().len(), steps + 1);

    doc.undo().unwrap();

    assert_eq!(spans(doc.project(), 0), before);
    assert_eq!(doc.history().labels().len(), steps);
}

#[test]
fn ripple_trim_of_the_end_carries_the_later_clips_with_it() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipRippleTrim {
        clip: ids[0].clone(),
        edge: TrimEdge::End,
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 3.0), (3.0, 2.0), (5.0, 2.0)]
    );
}

#[test]
fn ripple_trim_of_the_start_keeps_the_clip_in_place_and_pulls_the_rest_left() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipRippleTrim {
        clip: ids[1].clone(),
        edge: TrimEdge::Start,
        delta: Time::from_seconds(0.5),
    }))
    .unwrap();

    let trimmed = clip_of(doc.project(), &ids[1]);
    assert_eq!(trimmed.start.as_seconds(), 2.0);
    assert_eq!(trimmed.duration.as_seconds(), 1.5);
    assert_eq!(trimmed.in_point.as_seconds(), 0.5);
    assert_eq!(clip_of(doc.project(), &ids[2]).start.as_seconds(), 3.5);
}

#[test]
fn a_ripple_trim_that_would_empty_the_clip_moves_nothing() {
    let (mut doc, _, ids) = doc_with_a_run();
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRippleTrim {
            clip: ids[0].clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(-2.0),
        }))
        .is_err());

    assert_eq!(spans(doc.project(), 0), before);
}

// The followers are checked before anything is written, so a step that would push one of them past
// the bound a project can hold leaves the whole track alone.
#[test]
fn a_ripple_trim_that_would_push_a_later_clip_out_of_range_moves_nothing() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    add_clip(&mut doc, &track, 23.0 * 3600.0, 3000.0);
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRippleTrim {
            clip: first,
            edge: TrimEdge::End,
            delta: Time::from_seconds(3600.0),
        }))
        .is_err());

    assert_eq!(spans(doc.project(), 0), before);
}

#[test]
fn ripple_trim_advances_the_material_by_the_clips_own_speed() {
    let (mut doc, _, ids) = doc_with_a_run();
    doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
        clip: ids[1].clone(),
        rate: 2.0,
        reverse: false,
        preserve_pitch: true,
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipRippleTrim {
        clip: ids[1].clone(),
        edge: TrimEdge::Start,
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(clip_of(doc.project(), &ids[1]).in_point.as_seconds(), 2.0);
}

// A plain `clip.trim` refuses this: it would put the clip's start below zero. A ripple never moves
// the start, so the only limit is how much material is left in front of the in point.
#[test]
fn ripple_trim_can_lengthen_the_head_of_a_clip_at_time_zero() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    let follower = add_clip(&mut doc, &track, 2.0, 2.0);
    // Give the clip material in front of its in point to reach back into.
    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: first.clone(),
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipRippleTrim {
        clip: first.clone(),
        edge: TrimEdge::Start,
        delta: Time::from_seconds(-1.0),
    }))
    .unwrap();

    let head = clip_of(doc.project(), &first);
    assert_eq!(head.start.as_seconds(), 0.0);
    assert_eq!(head.duration.as_seconds(), 3.0);
    assert_eq!(head.in_point.as_seconds(), 0.0);
    assert_eq!(clip_of(doc.project(), &follower).start.as_seconds(), 3.0);
}

#[test]
fn a_ripple_trim_of_a_head_below_the_start_of_the_material_is_refused() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRippleTrim {
            clip: first,
            edge: TrimEdge::Start,
            delta: Time::from_seconds(-1.0),
        }))
        .is_err());
}

#[test]
fn roll_moves_the_cut_and_keeps_the_pair_as_long_as_it_was() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipRoll {
        clip: ids[1].clone(),
        edge: TrimEdge::Start,
        delta: Time::from_seconds(0.5),
    }))
    .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 2.5), (2.5, 1.5), (4.0, 2.0)]
    );
    assert_eq!(clip_of(doc.project(), &ids[1]).in_point.as_seconds(), 0.5);
}

// Same cut, named from either side: rolling the left clip's end must land exactly where rolling the
// right clip's start does, or the two menu entries would disagree about which way is positive.
#[test]
fn rolling_from_either_side_of_the_same_cut_agrees() {
    let (mut left, _, left_ids) = doc_with_a_run();
    let (mut right, _, right_ids) = doc_with_a_run();

    left.dispatch(Dispatch::new(Command::ClipRoll {
        clip: left_ids[0].clone(),
        edge: TrimEdge::End,
        delta: Time::from_seconds(0.5),
    }))
    .unwrap();
    right
        .dispatch(Dispatch::new(Command::ClipRoll {
            clip: right_ids[1].clone(),
            edge: TrimEdge::Start,
            delta: Time::from_seconds(0.5),
        }))
        .unwrap();

    assert_eq!(spans(left.project(), 0), spans(right.project(), 0));
}

#[test]
fn a_roll_at_an_edge_no_clip_meets_is_refused() {
    let (mut doc, track) = doc_with_track();
    let lonely = add_clip(&mut doc, &track, 0.0, 2.0);
    add_clip(&mut doc, &track, 3.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRoll {
            clip: lonely,
            edge: TrimEdge::End,
            delta: Time::from_seconds(0.5),
        }))
        .is_err());
}

#[test]
fn a_roll_that_would_empty_the_neighbour_changes_neither_clip() {
    let (mut doc, _, ids) = doc_with_a_run();
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipRoll {
            clip: ids[0].clone(),
            edge: TrimEdge::End,
            delta: Time::from_seconds(2.0),
        }))
        .is_err());

    assert_eq!(spans(doc.project(), 0), before);
}

#[test]
fn slip_moves_the_material_and_leaves_the_clip_where_it_is() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 1.0, 2.0);

    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: clip.clone(),
        delta: Time::from_seconds(0.5),
    }))
    .unwrap();

    let slipped = clip_of(doc.project(), &clip);
    assert_eq!(slipped.start.as_seconds(), 1.0);
    assert_eq!(slipped.duration.as_seconds(), 2.0);
    assert_eq!(slipped.in_point.as_seconds(), 0.5);
    assert_eq!(
        slipped
            .source_time_at(Time::from_seconds(1.0))
            .unwrap()
            .as_seconds(),
        0.5
    );
}

#[test]
fn slip_scales_the_step_with_the_clips_speed() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
        clip: clip.clone(),
        rate: 2.0,
        reverse: false,
        preserve_pitch: true,
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: clip.clone(),
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(clip_of(doc.project(), &clip).in_point.as_seconds(), 2.0);
}

// A reversed clip reads its material backwards, so the same request -- "show me what comes later"
// -- has to move the in point the other way.
#[test]
fn slip_of_a_reversed_clip_reaches_back_instead_of_forward() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: clip.clone(),
        delta: Time::from_seconds(4.0),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipSetSpeed {
        clip: clip.clone(),
        rate: 1.0,
        reverse: true,
        preserve_pitch: true,
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: clip.clone(),
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(clip_of(doc.project(), &clip).in_point.as_seconds(), 3.0);
}

#[test]
fn a_slip_before_the_start_of_the_material_is_refused() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 0.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSlip {
            clip: clip.clone(),
            delta: Time::from_seconds(-1.0),
        }))
        .is_err());
    assert_eq!(clip_of(doc.project(), &clip).in_point, Time::ZERO);
}

#[test]
fn slide_moves_the_clip_and_lets_its_neighbours_absorb_the_step() {
    let (mut doc, _, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(Command::ClipSlide {
        clip: ids[1].clone(),
        delta: Time::from_seconds(0.5),
    }))
    .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 2.5), (2.5, 2.0), (4.5, 1.5)]
    );
    // The slid clip shows the same material it did before; only its neighbours were trimmed.
    assert_eq!(clip_of(doc.project(), &ids[1]).in_point, Time::ZERO);
    assert_eq!(clip_of(doc.project(), &ids[2]).in_point.as_seconds(), 0.5);
}

#[test]
fn a_slide_that_would_empty_a_neighbour_moves_nothing() {
    let (mut doc, _, ids) = doc_with_a_run();
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSlide {
            clip: ids[1].clone(),
            delta: Time::from_seconds(2.0),
        }))
        .is_err());

    assert_eq!(spans(doc.project(), 0), before);
}

#[test]
fn a_slide_with_no_neighbours_just_moves_the_clip() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 2.0, 2.0);

    doc.dispatch(Dispatch::new(Command::ClipSlide {
        clip,
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();

    assert_eq!(spans(doc.project(), 0), vec![(3.0, 2.0)]);
}

#[test]
fn a_slide_before_zero_is_refused() {
    let (mut doc, track) = doc_with_track();
    let clip = add_clip(&mut doc, &track, 1.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipSlide {
            clip,
            delta: Time::from_seconds(-2.0),
        }))
        .is_err());
    assert_eq!(spans(doc.project(), 0), vec![(1.0, 2.0)]);
}

#[test]
fn paste_puts_a_copy_with_its_own_id_on_the_track() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    let copied = clip_of(doc.project(), &original).clone();

    doc.dispatch(Dispatch::new(Command::ClipPaste {
        track: track.clone(),
        clip: Box::new(copied),
        start: Time::from_seconds(5.0),
    }))
    .unwrap();

    let clips = &doc.project().timeline.tracks[0].clips;
    assert_eq!(clips.len(), 2);
    assert_ne!(clips[0].id, clips[1].id);
    assert_eq!(clips[1].start.as_seconds(), 5.0);
    assert_eq!(clips[1].duration.as_seconds(), 2.0);
}

#[test]
fn paste_carries_the_look_of_the_clip_it_copied() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::EffectAdd {
        target: EffectTarget::Clip {
            clip: original.clone(),
        },
        effect_type: "brightness".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipSetVolume {
        clip: original.clone(),
        volume: 0.25,
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipSlip {
        clip: original.clone(),
        delta: Time::from_seconds(1.0),
    }))
    .unwrap();
    let copied = clip_of(doc.project(), &original).clone();

    doc.dispatch(Dispatch::new(Command::ClipPaste {
        track: track.clone(),
        clip: Box::new(copied),
        start: Time::from_seconds(5.0),
    }))
    .unwrap();

    let pasted = &doc.project().timeline.tracks[0].clips[1];
    assert_eq!(pasted.volume, 0.25);
    assert_eq!(pasted.in_point.as_seconds(), 1.0);
    assert_eq!(pasted.effects.len(), 1);
    assert_eq!(pasted.effects[0].effect_type, "brightness");
}

#[test]
fn a_pasted_clip_joins_no_group() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    let second = add_clip(&mut doc, &track, 2.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![first.clone(), second],
    }))
    .unwrap();
    let copied = clip_of(doc.project(), &first).clone();
    assert!(copied.group_id.is_some());

    doc.dispatch(Dispatch::new(Command::ClipPaste {
        track: track.clone(),
        clip: Box::new(copied),
        start: Time::from_seconds(5.0),
    }))
    .unwrap();

    let clips = &doc.project().timeline.tracks[0].clips;
    assert!(clips[2].group_id.is_none());
}

#[test]
fn paste_onto_a_track_that_does_not_exist_is_refused() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    let copied = clip_of(doc.project(), &original).clone();

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipPaste {
            track: TrackId::from("trk_nope".to_string()),
            clip: Box::new(copied),
            start: Time::ZERO,
        }))
        .is_err());
}

#[test]
fn pasting_a_clip_with_no_length_is_refused() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    let mut copied = clip_of(doc.project(), &original).clone();
    copied.duration = Time::ZERO;

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipPaste {
            track,
            clip: Box::new(copied),
            start: Time::ZERO,
        }))
        .is_err());
}

// The paste payload comes off the wire like any other command argument, so it goes through the
// same gate a loaded project does.
#[test]
fn pasting_a_clip_with_an_absurd_in_point_is_refused() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    let mut copied = clip_of(doc.project(), &original).clone();
    copied.in_point = Time::from_flicks(i64::MAX);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipPaste {
            track,
            clip: Box::new(copied),
            start: Time::ZERO,
        }))
        .is_err());
}

#[test]
fn pasting_past_the_end_of_what_a_project_can_hold_is_refused() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 0.0, 2.0);
    let copied = clip_of(doc.project(), &original).clone();

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipPaste {
            track,
            clip: Box::new(copied),
            start: Time::MAX_REASONABLE,
        }))
        .is_err());
}

#[test]
fn paste_keeps_the_track_sorted_by_start() {
    let (mut doc, track) = doc_with_track();
    let original = add_clip(&mut doc, &track, 4.0, 2.0);
    let copied = clip_of(doc.project(), &original).clone();

    doc.dispatch(Dispatch::new(Command::ClipPaste {
        track: track.clone(),
        clip: Box::new(copied),
        start: Time::ZERO,
    }))
    .unwrap();

    assert_eq!(spans(doc.project(), 0), vec![(0.0, 2.0), (4.0, 2.0)]);
}

fn compound_clip() -> Clip {
    let mut nested_track = Track::new(TrackKind::Video, "nested".into());
    nested_track.clips.push(Clip::new_media(
        MediaId::from("med_a".to_string()),
        Time::ZERO,
        Time::from_seconds(1.0),
    ));
    let mut timeline = Timeline::default();
    timeline.tracks.push(nested_track);
    let mut clip = Clip::new_media(
        MediaId::from(String::new()),
        Time::ZERO,
        Time::from_seconds(1.0),
    );
    clip.source = ClipSource::Compound {
        timeline: Box::new(timeline),
    };
    clip
}

// Nesting is not drawn in this version, but a paste must not be the thing that puts two clips with
// the same id in one project -- ids are how every other command addresses a clip.
#[test]
fn pasting_a_compound_clip_gives_its_nested_clips_new_ids() {
    let (mut doc, track) = doc_with_track();
    let source = compound_clip();

    for _ in 0..2 {
        doc.dispatch(Dispatch::new(Command::ClipPaste {
            track: track.clone(),
            clip: Box::new(source.clone()),
            start: Time::ZERO,
        }))
        .unwrap();
    }

    let clips = &doc.project().timeline.tracks[0].clips;
    assert_ne!(clips[0].id, clips[1].id);
    assert_ne!(nested_id(&clips[0]), nested_id(&clips[1]));
}

fn nested_id(clip: &Clip) -> ClipId {
    match &clip.source {
        ClipSource::Compound { timeline } => timeline.tracks[0].clips[0].id.clone(),
        other => panic!("expected a compound clip, got {other:?}"),
    }
}

#[test]
fn group_ties_the_named_clips_together() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    let second = add_clip(&mut doc, &track, 2.0, 2.0);
    let third = add_clip(&mut doc, &track, 4.0, 2.0);

    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![first.clone(), second.clone()],
    }))
    .unwrap();

    let group = clip_of(doc.project(), &first).group_id.clone().unwrap();
    assert_eq!(
        clip_of(doc.project(), &second).group_id.as_ref(),
        Some(&group)
    );
    assert!(clip_of(doc.project(), &third).group_id.is_none());
    assert!(group.as_str().starts_with("grp_"));
}

#[test]
fn a_group_of_one_clip_is_refused() {
    let (mut doc, track) = doc_with_track();
    let only = add_clip(&mut doc, &track, 0.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipGroup {
            clips: vec![only.clone()],
        }))
        .is_err());
    assert!(clip_of(doc.project(), &only).group_id.is_none());
}

#[test]
fn a_group_naming_a_clip_that_does_not_exist_groups_nothing() {
    let (mut doc, track) = doc_with_track();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    let second = add_clip(&mut doc, &track, 2.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipGroup {
            clips: vec![
                first.clone(),
                second.clone(),
                ClipId::from("clp_nope".to_string()),
            ],
        }))
        .is_err());

    assert!(clip_of(doc.project(), &first).group_id.is_none());
    assert!(clip_of(doc.project(), &second).group_id.is_none());
}

// `Document::dispatch` applies to a clone and throws it away on error, so through that path a
// half-written group would never be visible. `Command::apply` is public too, and a caller holding a
// `Project` directly has no such rollback -- which is what the lookup pass in `group` is for, and
// this is the only place it can be seen.
#[test]
fn a_group_applied_straight_to_a_project_writes_nothing_when_one_id_is_unknown() {
    let (doc, _, ids) = doc_with_a_run();
    let mut project = doc.project().clone();

    let refused = Command::ClipGroup {
        clips: vec![
            ids[0].clone(),
            ids[1].clone(),
            ClipId::from("clp_nope".to_string()),
        ],
    }
    .apply(&mut project);

    assert!(refused.is_err());
    assert!(project.timeline.tracks[0]
        .clips
        .iter()
        .all(|clip| clip.group_id.is_none()));
}

#[test]
fn two_groups_get_two_different_ids() {
    let (mut doc, track) = doc_with_track();
    let a = add_clip(&mut doc, &track, 0.0, 1.0);
    let b = add_clip(&mut doc, &track, 1.0, 1.0);
    let c = add_clip(&mut doc, &track, 2.0, 1.0);
    let d = add_clip(&mut doc, &track, 3.0, 1.0);

    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![a.clone(), b],
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![c.clone(), d],
    }))
    .unwrap();

    assert_ne!(
        clip_of(doc.project(), &a).group_id,
        clip_of(doc.project(), &c).group_id
    );
}

#[test]
fn ungroup_dissolves_the_group_across_every_track() {
    let (mut doc, track) = doc_with_track();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: None,
    }))
    .unwrap();
    let other = doc.project().timeline.tracks[1].id.clone();
    let first = add_clip(&mut doc, &track, 0.0, 2.0);
    let second = add_clip(&mut doc, &other, 0.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![first.clone(), second.clone()],
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipUngroup {
        clip: first.clone(),
    }))
    .unwrap();

    assert!(clip_of(doc.project(), &first).group_id.is_none());
    assert!(clip_of(doc.project(), &second).group_id.is_none());
}

#[test]
fn ungrouping_a_clip_that_is_in_no_group_is_refused() {
    let (mut doc, track) = doc_with_track();
    let lonely = add_clip(&mut doc, &track, 0.0, 2.0);

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipUngroup { clip: lonely }))
        .is_err());
}

#[test]
fn ungroup_leaves_another_group_alone() {
    let (mut doc, track) = doc_with_track();
    let a = add_clip(&mut doc, &track, 0.0, 1.0);
    let b = add_clip(&mut doc, &track, 1.0, 1.0);
    let c = add_clip(&mut doc, &track, 2.0, 1.0);
    let d = add_clip(&mut doc, &track, 3.0, 1.0);
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![a.clone(), b],
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![c.clone(), d],
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::ClipUngroup { clip: a }))
        .unwrap();

    assert!(clip_of(doc.project(), &c).group_id.is_some());
}

#[test]
fn a_marker_lands_where_it_was_put() {
    let mut doc = Document::new();

    doc.dispatch(Dispatch::new(Command::MarkerAdd {
        time: Time::from_seconds(3.0),
        label: "cut here".into(),
    }))
    .unwrap();

    let markers = &doc.project().markers;
    assert_eq!(markers.len(), 1);
    assert_eq!(markers[0].time.as_seconds(), 3.0);
    assert_eq!(markers[0].label, "cut here");
    assert!(markers[0].id.as_str().starts_with("mrk_"));
}

#[test]
fn markers_are_kept_in_time_order() {
    let mut doc = Document::new();
    for seconds in [5.0, 1.0, 3.0] {
        doc.dispatch(Dispatch::new(Command::MarkerAdd {
            time: Time::from_seconds(seconds),
            label: format!("at {seconds}"),
        }))
        .unwrap();
    }

    let times: Vec<f64> = doc
        .project()
        .markers
        .iter()
        .map(|marker| marker.time.as_seconds())
        .collect();
    assert_eq!(times, vec![1.0, 3.0, 5.0]);
}

#[test]
fn a_marker_past_the_end_of_what_a_project_can_hold_is_refused() {
    let mut doc = Document::new();

    assert!(doc
        .dispatch(Dispatch::new(Command::MarkerAdd {
            time: Time::from_flicks(i64::MAX),
            label: "nowhere".into(),
        }))
        .is_err());
    assert!(doc.project().markers.is_empty());
}

#[test]
fn renaming_a_marker_leaves_its_time_alone() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::MarkerAdd {
        time: Time::from_seconds(2.0),
        label: "before".into(),
    }))
    .unwrap();
    let id = doc.project().markers[0].id.clone();

    doc.dispatch(Dispatch::new(Command::MarkerRename {
        marker: id,
        label: "after".into(),
    }))
    .unwrap();

    assert_eq!(doc.project().markers[0].label, "after");
    assert_eq!(doc.project().markers[0].time.as_seconds(), 2.0);
}

#[test]
fn removing_a_marker_leaves_the_others() {
    let mut doc = Document::new();
    for seconds in [1.0, 2.0] {
        doc.dispatch(Dispatch::new(Command::MarkerAdd {
            time: Time::from_seconds(seconds),
            label: "x".into(),
        }))
        .unwrap();
    }
    let first = doc.project().markers[0].id.clone();

    doc.dispatch(Dispatch::new(Command::MarkerRemove { marker: first }))
        .unwrap();

    assert_eq!(doc.project().markers.len(), 1);
    assert_eq!(doc.project().markers[0].time.as_seconds(), 2.0);
}

#[test]
fn a_marker_that_does_not_exist_can_be_neither_removed_nor_renamed() {
    let mut doc = Document::new();
    let missing = videola_core::model::MarkerId::from("mrk_nope".to_string());

    assert!(doc
        .dispatch(Dispatch::new(Command::MarkerRemove {
            marker: missing.clone(),
        }))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(Command::MarkerRename {
            marker: missing,
            label: "x".into(),
        }))
        .is_err());
}

#[test]
fn a_marker_can_be_undone() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::MarkerAdd {
        time: Time::from_seconds(2.0),
        label: "x".into(),
    }))
    .unwrap();

    doc.undo().unwrap();

    assert!(doc.project().markers.is_empty());
}
