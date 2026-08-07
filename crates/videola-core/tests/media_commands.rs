use videola_core::command::{Command, Dispatch};
use videola_core::model::{
    Clip, ClipSource, MediaAsset, MediaId, MediaKind, Project, Time, Timeline, Track, TrackKind,
};
use videola_core::{CoreError, Document};

fn asset(bytes: &[u8], name: &str) -> MediaAsset {
    MediaAsset::new(
        MediaId::from_bytes(bytes),
        name.to_string(),
        "video/mp4".into(),
        MediaKind::Video,
        bytes.len() as u64,
    )
}

// A clip on a compound clip's own nested timeline, for tests that need to reach past the
// top-level tracks without going through `clip.add` (which would apply its own normalize step).
fn leaf_clip_on(media: MediaId) -> Clip {
    Clip::new_media(media, Time::ZERO, Time::from_seconds(1.0))
}

fn wrap_in_compound(inner: Clip) -> Clip {
    let mut track = Track::new(TrackKind::Video, "nested".into());
    track.clips.push(inner);
    let mut timeline = Timeline::default();
    timeline.tracks.push(track);
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
    // First-wins: a later import of the same content must not overwrite the first import's
    // metadata.
    assert_eq!(doc.project().library[0].original_name, "a.mp4");

    // A distinct asset imported afterwards must add to the library, not replace it wholesale.
    doc.dispatch(Dispatch::new(Command::MediaImport {
        asset: asset(b"b", "b.mp4"),
    }))
    .unwrap();
    assert_eq!(doc.project().library.len(), 2);
    assert_eq!(doc.project().library[0].original_name, "a.mp4");
}

#[test]
fn import_media_rejects_an_id_that_is_not_a_content_hash() {
    let mut doc = Document::new();
    let mut bad = asset(b"a", "a.mp4");
    bad.id = MediaId::from("med_../../../../evil".to_string());

    let result = doc.dispatch(Dispatch::new(Command::MediaImport { asset: bad }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

// A 64-hex id missing the `med_` prefix would pass a check against `content_hash()` alone
// (`content_hash()` falls back to the full string when there is no prefix to strip), but
// `reader::media_id_from_entry` always reconstructs `med_<hash>` on load, so every clip
// referencing the un-prefixed id would dangle after one save/load round trip.
#[test]
fn import_media_rejects_an_id_missing_the_med_prefix() {
    let mut doc = Document::new();
    let mut bad = asset(b"a", "a.mp4");
    bad.id = MediaId::from(bad.id.content_hash().to_string());

    let result = doc.dispatch(Dispatch::new(Command::MediaImport { asset: bad }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

#[test]
fn import_media_rejects_a_duration_out_of_range() {
    let mut doc = Document::new();
    let mut bad = asset(b"a", "a.mp4");
    bad.duration = Some(Time::from_flicks(i64::MAX));

    let result = doc.dispatch(Dispatch::new(Command::MediaImport { asset: bad }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

// C2: a zero-denominator fps used to pass this command unnoticed, only to make the project
// unloadable the next time it was opened (`normalize_library` calls the same `rate_bounded` on
// read). Rejecting it here means a dispatch that succeeds can also be saved and reopened.
#[test]
fn import_media_rejects_a_zero_denominator_fps() {
    let mut doc = Document::new();
    let mut bad = asset(b"a", "a.mp4");
    bad.fps = Some(videola_core::model::Rate::new(30, 0));

    let result = doc.dispatch(Dispatch::new(Command::MediaImport { asset: bad }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

#[test]
fn import_media_accepts_a_legitimate_fps() {
    let mut doc = Document::new();
    let mut good = asset(b"a", "a.mp4");
    good.fps = Some(videola_core::model::Rate::new(30_000, 1001));

    let result = doc.dispatch(Dispatch::new(Command::MediaImport { asset: good }));
    assert!(result.is_ok());
}

#[test]
fn removing_a_medium_also_removes_the_clips_that_use_it() {
    let mut doc = Document::new();
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();
    let other_media = asset(b"b", "b.mp4");
    let other_id = other_media.id.clone();

    doc.dispatch(Dispatch::new(Command::MediaImport { asset: media }))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::MediaImport { asset: other_media }))
        .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: track.clone(),
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media {
            media: other_id.clone(),
        },
        start: Time::from_seconds(2.0),
        duration: Time::from_seconds(2.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::MediaRemove { media: id }))
        .unwrap();

    assert_eq!(doc.project().library.len(), 1);
    assert_eq!(doc.project().library[0].id, other_id);
    let clips = &doc.project().timeline.tracks[0].clips;
    assert_eq!(clips.len(), 1);
    assert!(matches!(&clips[0].source, ClipSource::Media { media } if *media == other_id));
}

#[test]
fn removing_an_unknown_medium_fails() {
    let mut doc = Document::new();
    let result = doc.dispatch(Dispatch::new(Command::MediaRemove {
        media: MediaId::from("med_ghost".to_string()),
    }));
    assert!(matches!(result, Err(CoreError::MediaNotAvailable(_))));
}

#[test]
fn undo_restores_both_library_and_clips() {
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

// `media.remove` walks a fully public `Project` that a caller could have built by hand, so its
// own depth cap has to hold even when `clip.add`'s normalize step never ran. Nesting is built
// directly on the model rather than through `clip.add` for that reason. `MAX_COMPOUND_DEPTH` is
// crate-private and not visible from this integration test, so its value (8) is inlined; the
// depth chosen here (10) mirrors the margin `model::project`'s own depth test uses.
#[test]
fn media_remove_rejects_compound_nesting_deeper_than_the_limit() {
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();

    let mut clip = leaf_clip_on(id.clone());
    for _ in 0..10 {
        clip = wrap_in_compound(clip);
    }
    let mut track = Track::new(TrackKind::Video, "V1".into());
    track.clips.push(clip);

    let mut project = Project::default();
    project.timeline.tracks.push(track);
    project.library.push(media);

    let result = Command::MediaRemove { media: id }.apply(&mut project);
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
    // The walk itself mutates as it descends — clips at shallower levels than the failing depth
    // are already gone by the time this assertion runs. The library entry survives specifically
    // because `remove_media` only retains it after the walk returns `Ok`, not because anything
    // was verified up front.
    assert_eq!(project.library.len(), 1);
}

// The counterpart to the rejection test above: two levels of nesting is well within the limit
// and must not be caught by an off-by-one at depth 1.
#[test]
fn media_remove_reaches_two_legitimate_levels_of_compound_nesting() {
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();

    let clip = wrap_in_compound(wrap_in_compound(leaf_clip_on(id.clone())));
    let mut track = Track::new(TrackKind::Video, "V1".into());
    track.clips.push(clip);

    let mut project = Project::default();
    project.timeline.tracks.push(track);
    project.library.push(media);

    Command::MediaRemove { media: id }
        .apply(&mut project)
        .unwrap();

    match &project.timeline.tracks[0].clips[0].source {
        ClipSource::Compound { timeline } => match &timeline.tracks[0].clips[0].source {
            ClipSource::Compound { timeline: inner } => assert!(inner.tracks[0].clips.is_empty()),
            other => panic!("expected a nested compound clip, got {other:?}"),
        },
        other => panic!("expected a compound clip, got {other:?}"),
    }
}

// Depths 2 and 10 alone would also pass a stricter-than-intended `>=` check that rejects one
// level earlier than `normalize` does; nesting exactly to the limit pins that boundary.
#[test]
fn media_remove_accepts_nesting_exactly_at_the_depth_limit() {
    let media = asset(b"a", "a.mp4");
    let id = media.id.clone();

    let mut clip = leaf_clip_on(id.clone());
    for _ in 0..8 {
        clip = wrap_in_compound(clip);
    }
    let mut track = Track::new(TrackKind::Video, "V1".into());
    track.clips.push(clip);

    let mut project = Project::default();
    project.timeline.tracks.push(track);
    project.library.push(media);

    Command::MediaRemove { media: id }
        .apply(&mut project)
        .unwrap();
}
