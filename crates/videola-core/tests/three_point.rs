#![allow(clippy::unwrap_used, clippy::expect_used)]

//! The three-point edit: a range marked in the source, a place chosen on the timeline, and the
//! range either inserted (everything after it moves) or overwritten (nothing moves). These are the
//! two operations the whole of classical cutting is built on, so what they promise is checked here
//! in the terms a timeline can be read in — total length, order, and what happened on the *other*
//! tracks.

use videola_core::command::{Command, Dispatch};
use videola_core::model::{
    Clip, ClipId, ClipSource, MarkerId, MediaId, Project, Time, TrackId, TrackKind, Transition,
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

fn add_track(doc: &mut Document, kind: TrackKind, name: &str) -> TrackId {
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind,
        name: name.into(),
        index: None,
    }))
    .unwrap();
    doc.project()
        .timeline
        .tracks
        .last()
        .expect("the track just added")
        .id
        .clone()
}

fn add_clip(doc: &mut Document, track: &TrackId, start_s: f64, duration_s: f64) -> ClipId {
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: media_source(),
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(duration_s),
    }))
    .unwrap();
    doc.project()
        .track(track)
        .unwrap()
        .clips
        .iter()
        .find(|clip| clip.start == Time::from_seconds(start_s))
        .unwrap()
        .id
        .clone()
}

// Three clips butted end to end on one video track.
fn doc_with_a_run() -> (Document, TrackId, Vec<ClipId>) {
    let (mut doc, track) = doc_with_track();
    let ids = vec![
        add_clip(&mut doc, &track, 0.0, 2.0),
        add_clip(&mut doc, &track, 2.0, 2.0),
        add_clip(&mut doc, &track, 4.0, 2.0),
    ];
    (doc, track, ids)
}

fn media_source() -> ClipSource {
    ClipSource::Media {
        media: MediaId::from("med_a".to_string()),
    }
}

fn insert(track: &TrackId, start_s: f64, duration_s: f64, in_point_s: f64) -> Command {
    Command::ClipInsert {
        track: track.clone(),
        source: media_source(),
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(duration_s),
        in_point: Time::from_seconds(in_point_s),
    }
}

fn overwrite(track: &TrackId, start_s: f64, duration_s: f64, in_point_s: f64) -> Command {
    Command::ClipOverwrite {
        track: track.clone(),
        source: media_source(),
        start: Time::from_seconds(start_s),
        duration: Time::from_seconds(duration_s),
        in_point: Time::from_seconds(in_point_s),
    }
}

fn spans(project: &Project, track: usize) -> Vec<(f64, f64)> {
    project.timeline.tracks[track]
        .clips
        .iter()
        .map(|clip| (clip.start.as_seconds(), clip.duration.as_seconds()))
        .collect()
}

fn total(project: &Project, track: usize) -> f64 {
    project.timeline.tracks[track]
        .clips
        .iter()
        .map(|clip| clip.duration.as_seconds())
        .sum()
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

// -- insert --------------------------------------------------------------------------------------

// The claim an insert makes, in the terms a timeline can be read in: more material than before, in
// the order it was put there, and nothing lost.
#[test]
fn an_insert_grows_the_track_and_pushes_the_rest_back() {
    let (mut doc, track, _) = doc_with_a_run();
    let before = total(doc.project(), 0);

    doc.dispatch(Dispatch::new(insert(&track, 2.0, 1.5, 0.0)))
        .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 2.0), (2.0, 1.5), (3.5, 2.0), (5.5, 2.0)]
    );
    assert_eq!(total(doc.project(), 0), before + 1.5);
}

// The insertion point falls inside a clip rather than on a cut, which is the ordinary case: the
// clip is cut there and the material goes between the halves, instead of over the middle of one.
#[test]
fn an_insert_inside_a_clip_cuts_it_and_lands_between_the_halves() {
    let (mut doc, track) = doc_with_track();
    add_clip(&mut doc, &track, 0.0, 4.0);

    doc.dispatch(Dispatch::new(insert(&track, 1.0, 2.0, 0.0)))
        .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 1.0), (1.0, 2.0), (3.0, 3.0)]
    );
    // The far half reads on from where the near half stopped, so taking the inserted material back
    // out leaves a cut nobody can see.
    assert_eq!(
        doc.project().timeline.tracks[0].clips[2]
            .in_point
            .as_seconds(),
        1.0
    );
}

// The one thing an insert must never do. Sound and picture are separate tracks, so a gap that
// opened on only one of them would put the timeline out of step from that point on.
#[test]
fn an_insert_opens_the_same_gap_on_every_track() {
    let (mut doc, track, _) = doc_with_a_run();
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    add_clip(&mut doc, &audio, 0.0, 6.0);

    doc.dispatch(Dispatch::new(insert(&track, 2.0, 1.5, 0.0)))
        .unwrap();

    assert_eq!(spans(doc.project(), 1), vec![(0.0, 2.0), (3.5, 4.0)]);
}

// The source range is the whole point of marking in and out: the clip that lands reads from
// `inPoint`, not from the head of the medium.
#[test]
fn an_insert_reads_the_source_from_the_in_point_it_was_given() {
    let (mut doc, track) = doc_with_track();

    doc.dispatch(Dispatch::new(insert(&track, 0.0, 2.0, 3.0)))
        .unwrap();

    let placed = &doc.project().timeline.tracks[0].clips[0];
    assert_eq!(placed.in_point.as_seconds(), 3.0);
    assert_eq!(placed.out_point().as_seconds(), 5.0);
}

// Both halves of the contract: one command, so one step, and the step puts every track back.
#[test]
fn an_insert_is_a_single_undo_step() {
    let (mut doc, track, _) = doc_with_a_run();
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    add_clip(&mut doc, &audio, 0.0, 6.0);
    let before = (spans(doc.project(), 0), spans(doc.project(), 1));
    let steps = doc.history().labels().len();

    doc.dispatch(Dispatch::new(insert(&track, 1.0, 1.0, 0.0)))
        .unwrap();
    assert_eq!(doc.history().labels().len(), steps + 1);

    doc.undo().unwrap();

    assert_eq!((spans(doc.project(), 0), spans(doc.project(), 1)), before);
    assert_eq!(doc.history().labels().len(), steps);
}

// Groups are the other axis this crosses: an insert moves the clips of a group, and a group that
// came apart because half of it was pushed and half was not would be a group in name only.
#[test]
fn an_insert_keeps_a_group_together_across_the_gap() {
    let (mut doc, track, ids) = doc_with_a_run();
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![ids[1].clone(), ids[2].clone()],
    }))
    .unwrap();
    let group = clip_of(doc.project(), &ids[1]).group_id.clone();
    assert!(group.is_some());

    doc.dispatch(Dispatch::new(insert(&track, 2.0, 1.0, 0.0)))
        .unwrap();

    assert_eq!(clip_of(doc.project(), &ids[1]).start.as_seconds(), 3.0);
    assert_eq!(clip_of(doc.project(), &ids[2]).start.as_seconds(), 5.0);
    assert_eq!(clip_of(doc.project(), &ids[1]).group_id, group);
    assert_eq!(clip_of(doc.project(), &ids[2]).group_id, group);
}

// A group whose clips sit on two tracks is the case that would break if the ripple ran per track
// with a different rule on each: both halves have to travel the same distance.
#[test]
fn an_insert_moves_a_group_that_spans_two_tracks_by_the_same_step() {
    let (mut doc, track) = doc_with_track();
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    let picture = add_clip(&mut doc, &track, 2.0, 2.0);
    let sound = add_clip(&mut doc, &audio, 2.0, 2.0);
    doc.dispatch(Dispatch::new(Command::ClipGroup {
        clips: vec![picture.clone(), sound.clone()],
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(insert(&track, 0.0, 1.0, 0.0)))
        .unwrap();

    assert_eq!(clip_of(doc.project(), &picture).start.as_seconds(), 3.0);
    assert_eq!(clip_of(doc.project(), &sound).start.as_seconds(), 3.0);
}

// -- overwrite -----------------------------------------------------------------------------------

// The claim an overwrite makes: the material replaces what was there and the timeline keeps its
// length.
#[test]
fn an_overwrite_replaces_the_span_and_keeps_the_total_length() {
    let (mut doc, track, _) = doc_with_a_run();
    let end = doc.project().timeline.duration().as_seconds();

    doc.dispatch(Dispatch::new(overwrite(&track, 1.0, 2.0, 0.0)))
        .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 1.0), (1.0, 2.0), (3.0, 1.0), (4.0, 2.0)]
    );
    assert_eq!(doc.project().timeline.duration().as_seconds(), end);
}

// The span falls wholly inside one clip, which is the case a handler written for the two edges
// alone gets wrong: it has to leave a head and a tail, not one of them.
#[test]
fn an_overwrite_inside_one_clip_leaves_a_head_and_a_tail() {
    let (mut doc, track) = doc_with_track();
    add_clip(&mut doc, &track, 0.0, 6.0);

    doc.dispatch(Dispatch::new(overwrite(&track, 2.0, 2.0, 0.0)))
        .unwrap();

    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 2.0), (2.0, 2.0), (4.0, 2.0)]
    );
    assert_eq!(
        doc.project().timeline.tracks[0].clips[2]
            .in_point
            .as_seconds(),
        4.0
    );
}

#[test]
fn an_overwrite_that_covers_a_clip_entirely_removes_it() {
    let (mut doc, track, ids) = doc_with_a_run();

    doc.dispatch(Dispatch::new(overwrite(&track, 2.0, 2.0, 0.0)))
        .unwrap();

    assert!(!doc.project().timeline.tracks[0]
        .clips
        .iter()
        .any(|clip| clip.id == ids[1]));
    assert_eq!(
        spans(doc.project(), 0),
        vec![(0.0, 2.0), (2.0, 2.0), (4.0, 2.0)]
    );
}

// Only the track being edited. An overwrite that reached across tracks would be an insert with the
// ripple taken out, which is a different operation.
#[test]
fn an_overwrite_leaves_every_other_track_alone() {
    let (mut doc, track, _) = doc_with_a_run();
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    add_clip(&mut doc, &audio, 0.0, 6.0);

    doc.dispatch(Dispatch::new(overwrite(&track, 1.0, 2.0, 0.0)))
        .unwrap();

    assert_eq!(spans(doc.project(), 1), vec![(0.0, 6.0)]);
}

// Transitions are the axis overwrite crosses: a dissolve belongs to the incoming edge of the clip
// it was authored on, and a clip that is gone takes its dissolve with it rather than leaving it on
// a cut that no longer exists.
#[test]
fn an_overwrite_takes_the_transition_of_a_clip_it_replaces() {
    let (mut doc, track, ids) = doc_with_a_run();
    doc.dispatch(Dispatch::new(Command::ClipSetTransition {
        clip: ids[1].clone(),
        transition: Some(Transition::new("crossfade", Time::from_seconds(0.5))),
    }))
    .unwrap();
    assert!(clip_of(doc.project(), &ids[1]).transition_in.is_some());

    doc.dispatch(Dispatch::new(overwrite(&track, 2.0, 2.0, 0.0)))
        .unwrap();

    assert!(doc.project().timeline.tracks[0]
        .clips
        .iter()
        .all(|clip| clip.transition_in.is_none()));
}

// The other half of the same rule, and the one that makes the test above discriminating: a clip the
// overwrite never touches keeps the dissolve on its own edge.
#[test]
fn an_overwrite_that_stops_short_leaves_a_later_transition_standing() {
    let (mut doc, track, ids) = doc_with_a_run();
    doc.dispatch(Dispatch::new(Command::ClipSetTransition {
        clip: ids[2].clone(),
        transition: Some(Transition::new("crossfade", Time::from_seconds(0.5))),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(overwrite(&track, 0.0, 1.0, 0.0)))
        .unwrap();

    assert!(clip_of(doc.project(), &ids[2]).transition_in.is_some());
}

#[test]
fn an_overwrite_is_a_single_undo_step() {
    let (mut doc, track, _) = doc_with_a_run();
    let before = spans(doc.project(), 0);
    let steps = doc.history().labels().len();

    doc.dispatch(Dispatch::new(overwrite(&track, 1.0, 3.0, 0.0)))
        .unwrap();
    assert_eq!(doc.history().labels().len(), steps + 1);

    doc.undo().unwrap();

    assert_eq!(spans(doc.project(), 0), before);
    assert_eq!(doc.history().labels().len(), steps);
}

// -- refusals ------------------------------------------------------------------------------------

#[test]
fn neither_half_accepts_an_unknown_track() {
    let (mut doc, _, _) = doc_with_a_run();
    let missing = TrackId::from("trk_nope".to_string());
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(insert(&missing, 1.0, 1.0, 0.0)))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(overwrite(&missing, 1.0, 1.0, 0.0)))
        .is_err());
    assert_eq!(spans(doc.project(), 0), before);
}

#[test]
fn neither_half_accepts_an_empty_range() {
    let (mut doc, track, _) = doc_with_a_run();
    let before = spans(doc.project(), 0);

    assert!(doc
        .dispatch(Dispatch::new(insert(&track, 1.0, 0.0, 0.0)))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(overwrite(&track, 1.0, 0.0, 0.0)))
        .is_err());
    assert_eq!(spans(doc.project(), 0), before);
}

// A refusal has to leave every track as it was, not the target one only -- the insert walks all of
// them, so a check that ran after the first track was written would be half an edit.
#[test]
fn a_refused_insert_moves_nothing_on_any_track() {
    let (mut doc, track, _) = doc_with_a_run();
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    add_clip(&mut doc, &audio, 0.0, 6.0);
    let before = (spans(doc.project(), 0), spans(doc.project(), 1));

    assert!(doc
        .dispatch(Dispatch::new(Command::ClipInsert {
            track: track.clone(),
            source: media_source(),
            start: Time::from_seconds(1.0),
            duration: Time::MAX_REASONABLE,
            in_point: Time::ZERO,
        }))
        .is_err());

    assert_eq!((spans(doc.project(), 0), spans(doc.project(), 1)), before);
}

// -- markers -------------------------------------------------------------------------------------

fn one_marker(doc: &mut Document) -> MarkerId {
    doc.dispatch(Dispatch::new(Command::MarkerAdd {
        time: Time::from_seconds(1.0),
        label: "x".into(),
    }))
    .unwrap();
    doc.project().markers[0].id.clone()
}

#[test]
fn a_marker_takes_a_colour_and_a_note() {
    let mut doc = Document::new();
    let marker = one_marker(&mut doc);

    doc.dispatch(Dispatch::new(Command::MarkerSetColor {
        marker: marker.clone(),
        color_hex: "#2EA043".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::MarkerSetNote {
        marker,
        note: "the take we kept".into(),
    }))
    .unwrap();

    assert_eq!(doc.project().markers[0].color_hex, "#2EA043");
    assert_eq!(doc.project().markers[0].note, "the take we kept");
}

// The same gate every other colour in the model goes through: a marker's ends up in an inline
// style, where anything unparsable is dropped without a word.
#[test]
fn a_marker_colour_that_is_not_a_hex_colour_is_refused() {
    let mut doc = Document::new();
    let marker = one_marker(&mut doc);

    assert!(doc
        .dispatch(Dispatch::new(Command::MarkerSetColor {
            marker,
            color_hex: "rebeccapurple".into(),
        }))
        .is_err());
    assert_eq!(doc.project().markers[0].color_hex, "#F0A030");
}

#[test]
fn a_marker_note_survives_a_save_and_a_load() {
    let mut doc = Document::new();
    let marker = one_marker(&mut doc);
    doc.dispatch(Dispatch::new(Command::MarkerSetNote {
        marker,
        note: "the take we kept".into(),
    }))
    .unwrap();

    let json = serde_json::to_string(doc.project()).unwrap();
    let mut back: Project = serde_json::from_str(&json).unwrap();
    back.normalize().unwrap();

    assert_eq!(back.markers[0].note, "the take we kept");
}

// A project written before markers had a note reads back with an empty one rather than failing to
// load: the field is defaulted for exactly this.
#[test]
fn a_marker_without_a_note_still_loads() {
    let mut doc = Document::new();
    one_marker(&mut doc);
    let mut json = serde_json::to_value(doc.project()).unwrap();
    json["markers"][0]
        .as_object_mut()
        .unwrap()
        .remove("note")
        .unwrap();

    let mut back: Project = serde_json::from_value(json).unwrap();
    back.normalize().unwrap();

    assert_eq!(back.markers[0].note, "");
}
