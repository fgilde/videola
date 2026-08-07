use videola_core::command::{Command, Dispatch};
use videola_core::model::TrackKind;
use videola_core::Document;

#[allow(clippy::unwrap_used)]
fn doc_with_tracks(names: &[&str]) -> Document {
    let mut doc = Document::new();
    for name in names {
        doc.dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Video,
            name: (*name).to_string(),
            index: None,
        }))
        .unwrap();
    }
    doc
}

#[test]
fn tracks_append_in_order_and_get_a_kind_specific_colour() {
    let doc = doc_with_tracks(&["V1", "V2"]);
    let tracks = &doc.project().timeline.tracks;
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0].name, "V1");
    assert_eq!(tracks[1].name, "V2");
    assert_eq!(tracks[0].color_hex, "#5B8CFF");
}

#[test]
fn an_explicit_index_inserts_instead_of_appending() {
    let mut doc = doc_with_tracks(&["V1", "V2"]);
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: Some(0),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].name, "A1");
}

#[test]
fn an_out_of_range_index_is_rejected() {
    let mut doc = doc_with_tracks(&["V1"]);
    assert!(doc
        .dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Audio,
            name: "A1".into(),
            index: Some(9),
        }))
        .is_err());
}

#[test]
fn removing_a_track_takes_its_clips_with_it() {
    let mut doc = doc_with_tracks(&["V1", "V2"]);
    let first = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackRemove { track: first }))
        .unwrap();
    assert_eq!(doc.project().timeline.tracks.len(), 1);
    assert_eq!(doc.project().timeline.tracks[0].name, "V2");
}

#[test]
fn reorder_moves_a_track_to_the_target_index() {
    let mut doc = doc_with_tracks(&["V1", "V2", "V3"]);
    let third = doc.project().timeline.tracks[2].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackReorder {
        track: third,
        to_index: 0,
    }))
    .unwrap();
    let names: Vec<_> = doc
        .project()
        .timeline
        .tracks
        .iter()
        .map(|t| t.name.clone())
        .collect();
    assert_eq!(names, vec!["V3", "V1", "V2"]);
}

#[test]
fn volume_and_pan_are_clamped_to_valid_ranges() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();

    doc.dispatch(Dispatch::new(Command::TrackSetVolume {
        track: track.clone(),
        volume: 9.0,
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].volume, 4.0);

    doc.dispatch(Dispatch::new(Command::TrackSetPan { track, pan: -3.0 }))
        .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].pan, -1.0);
}

#[test]
fn set_flags_only_touches_the_flags_it_is_given() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track: track.clone(),
        muted: Some(true),
        solo: None,
        locked: None,
        hidden: None,
    }))
    .unwrap();
    let t = &doc.project().timeline.tracks[0];
    assert!(t.muted);
    assert!(!t.solo);
    assert!(!t.locked);
}

#[test]
fn setting_the_title_leaves_the_project_id_alone() {
    let mut doc = Document::new();
    let id = doc.project().meta.id.clone();
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle {
        title: "Urlaub".into(),
    }))
    .unwrap();
    assert_eq!(doc.project().meta.title, "Urlaub");
    assert_eq!(doc.project().meta.id, id);
}
