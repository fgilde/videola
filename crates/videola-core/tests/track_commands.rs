use videola_core::command::{Command, Dispatch};
use videola_core::model::{ClipSource, MediaId, ProjectSettings, Rate, Time, TrackKind};
use videola_core::{CoreError, Document};

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
fn an_index_equal_to_the_length_appends() {
    let mut doc = doc_with_tracks(&["V1", "V2"]);
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: Some(2),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[2].name, "A1");
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
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: first.clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_seconds(1.0),
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::TrackRemove { track: first }))
        .unwrap();

    assert_eq!(doc.project().timeline.tracks.len(), 1);
    assert_eq!(doc.project().timeline.tracks[0].name, "V2");
    let total_clips: usize = doc
        .project()
        .timeline
        .tracks
        .iter()
        .map(|t| t.clips.len())
        .sum();
    assert_eq!(total_clips, 0);
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
fn reorder_forward_accounts_for_the_shift_after_removal() {
    let mut doc = doc_with_tracks(&["V1", "V2", "V3"]);
    let first = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackReorder {
        track: first,
        to_index: 2,
    }))
    .unwrap();
    let names: Vec<_> = doc
        .project()
        .timeline
        .tracks
        .iter()
        .map(|t| t.name.clone())
        .collect();
    assert_eq!(names, vec!["V2", "V3", "V1"]);
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
fn non_finite_volume_and_pan_are_rejected() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();

    assert!(doc
        .dispatch(Dispatch::new(Command::TrackSetVolume {
            track: track.clone(),
            volume: f32::NAN
        }))
        .is_err());
    assert!(doc
        .dispatch(Dispatch::new(Command::TrackSetPan {
            track,
            pan: f32::INFINITY
        }))
        .is_err());
}

#[test]
fn set_flags_only_touches_the_flags_it_is_given() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track: track.clone(),
        muted: None,
        solo: Some(true),
        locked: None,
        hidden: None,
    }))
    .unwrap();

    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track,
        muted: Some(true),
        solo: None,
        locked: None,
        hidden: None,
    }))
    .unwrap();

    let t = &doc.project().timeline.tracks[0];
    assert!(t.muted);
    assert!(t.solo);
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

#[test]
fn renaming_a_track_changes_only_its_name() {
    let mut doc = doc_with_tracks(&["V1"]);
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::TrackRename {
        track: track.clone(),
        name: "Intro".into(),
    }))
    .unwrap();
    assert_eq!(doc.project().timeline.tracks[0].name, "Intro");
    assert_eq!(doc.project().timeline.tracks[0].id, track);
}

#[test]
fn setting_project_settings_replaces_them_wholesale() {
    let mut doc = Document::new();
    let settings = ProjectSettings {
        width: 3840,
        height: 2160,
        fps: Rate::from_fps(60),
        sample_rate: 48_000,
        color_space: "srgb".into(),
        background: "#000000".into(),
    };
    doc.dispatch(Dispatch::new(Command::ProjectSetSettings {
        settings: settings.clone(),
    }))
    .unwrap();
    assert_eq!(doc.project().settings.width, 3840);
    assert_eq!(doc.project().settings.fps, Rate::from_fps(60));
}

fn ntsc_settings() -> ProjectSettings {
    ProjectSettings {
        width: 3840,
        height: 2160,
        fps: Rate::new(30_000, 1001),
        sample_rate: 48_000,
        color_space: "srgb".into(),
        background: "#000000".into(),
    }
}

#[test]
fn setting_a_legitimate_ntsc_rate_and_4k_resolution_is_accepted() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::ProjectSetSettings {
        settings: ntsc_settings(),
    }))
    .unwrap();
    assert_eq!(doc.project().settings.fps, Rate::new(30_000, 1001));
    assert_eq!(doc.project().settings.width, 3840);
}

#[test]
fn setting_a_zero_denominator_fps_is_rejected() {
    let mut doc = Document::new();
    let mut settings = ntsc_settings();
    settings.fps = Rate::new(30, 0);
    let result = doc.dispatch(Dispatch::new(Command::ProjectSetSettings { settings }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

#[test]
fn setting_a_zero_width_is_rejected() {
    let mut doc = Document::new();
    let mut settings = ntsc_settings();
    settings.width = 0;
    let result = doc.dispatch(Dispatch::new(Command::ProjectSetSettings { settings }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}

#[test]
fn setting_a_zero_sample_rate_is_rejected() {
    let mut doc = Document::new();
    let mut settings = ntsc_settings();
    settings.sample_rate = 0;
    let result = doc.dispatch(Dispatch::new(Command::ProjectSetSettings { settings }));
    assert!(matches!(result, Err(CoreError::InvalidArgument(_))));
}
