use videola_core::command::{Command, Dispatch};
use videola_core::model::{ClipSource, MediaAsset, MediaId, MediaKind, Time, TrackKind};
use videola_core::Document;

fn asset(bytes: &[u8], name: &str) -> MediaAsset {
    MediaAsset::new(
        MediaId::from_bytes(bytes),
        name.to_string(),
        "video/mp4".into(),
        MediaKind::Video,
        bytes.len() as u64,
    )
}

#[test]
fn importing_registers_the_asset_in_the_library() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::MediaImport {
        asset: asset(b"a", "a.mp4"),
    }))
    .unwrap();
    assert_eq!(doc.project().library.len(), 1);
    assert_eq!(doc.project().library[0].original_name, "a.mp4");
}

#[test]
fn importing_the_same_content_twice_keeps_one_entry() {
    let mut doc = Document::new();
    for name in ["a.mp4", "kopie.mp4"] {
        doc.dispatch(Dispatch::new(Command::MediaImport {
            asset: asset(b"a", name),
        }))
        .unwrap();
    }
    assert_eq!(doc.project().library.len(), 1);
}

#[test]
fn removing_a_medium_also_removes_the_clips_that_use_it() {
    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media }))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id }))
        .unwrap();

    assert!(doc.project().library.is_empty());
    assert!(doc.project().timeline.tracks[0].clips.is_empty());
}

#[test]
fn removing_an_unknown_medium_fails() {
    let mut doc = Document::new();
    assert!(doc
        .dispatch(Dispatch::new(Command::MediaRemove {
            media: MediaId::from("med_ghost".to_string()),
        }))
        .is_err());
}

#[test]
fn undo_restores_both_library_and_clips() {
    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media }))
        .unwrap();
    let before = serde_json::to_value(doc.project()).unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id }))
        .unwrap();
    doc.undo().unwrap();

    assert_eq!(serde_json::to_value(doc.project()).unwrap(), before);
}

// MediaRemove must also reach clips nested inside a Compound clip's own timeline: a clip in
// there pointing at removed media is the same broken invariant as one on a top-level track.
#[test]
fn removing_a_medium_reaches_clips_inside_a_compound_clips_nested_timeline() {
    use videola_core::model::{Clip, Timeline, Track};

    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media }))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();

    let nested_clip = Clip::new_media(id.clone(), Time::ZERO, Time::from_seconds(1.0));
    let mut nested_track = Track::new(TrackKind::Video, "nested".into());
    nested_track.clips.push(nested_clip);
    let mut nested_timeline = Timeline::default();
    nested_timeline.tracks.push(nested_track);

    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Compound {
            timeline: Box::new(nested_timeline),
        },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id }))
        .unwrap();

    let compound = &doc.project().timeline.tracks[0].clips[0];
    match &compound.source {
        ClipSource::Compound { timeline } => {
            assert!(timeline.tracks[0].clips.is_empty());
        }
        other => panic!("expected a compound clip, got {other:?}"),
    }
}
