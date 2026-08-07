use videola_core::format::migrate;
use videola_core::format::LoadWarning;
use videola_core::model::{
    Clip, Interp, Keyframe, MediaId, ParamValue, Project, Time, Track, TrackKind,
};
use videola_core::CoreError;

const MINIMAL_V1: &str = r##"{
  "schemaVersion": 1,
  "meta": {"id":"prj_1","title":"T","tags":[]},
  "settings": {"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1},
               "sampleRate":48000,"colorSpace":"srgb","background":"#000000"},
  "library": [],
  "timeline": {"tracks":[]},
  "markers": [],
  "master": {"volume":1.0,"effects":[]}
}"##;

#[test]
fn a_current_version_loads_without_warnings() {
    let (project, warnings) = migrate::load(MINIMAL_V1).unwrap();
    assert_eq!(project.meta.title, "T");
    assert!(warnings.is_empty());
}

#[test]
fn a_missing_schema_version_is_treated_as_version_one() {
    let without = MINIMAL_V1.replace("\"schemaVersion\": 1,", "");
    let (project, _) = migrate::load(&without).unwrap();
    assert_eq!(project.schema_version, videola_core::model::SCHEMA_VERSION);
}

#[test]
fn a_newer_schema_version_is_refused() {
    let newer = MINIMAL_V1.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99");
    assert!(matches!(
        migrate::load(&newer),
        Err(videola_core::CoreError::UnsupportedSchema(99))
    ));
}

#[test]
fn unknown_fields_are_preserved_and_do_not_warn() {
    let extended = MINIMAL_V1.replace(
        "\"markers\": [],",
        "\"markers\": [], \"futureThing\": {\"a\":1},",
    );
    let (project, warnings) = migrate::load(&extended).unwrap();
    let out = serde_json::to_value(&project).unwrap();
    assert_eq!(out["futureThing"]["a"], 1);
    assert!(!warnings
        .iter()
        .any(|w| matches!(w, LoadWarning::Migrated { .. })));
}

#[test]
fn malformed_json_fails_loudly() {
    assert!(migrate::load("{ not json").is_err());
}

#[test]
fn a_float_schema_version_is_rejected_not_silently_treated_as_v1() {
    let sneaky = MINIMAL_V1.replace("\"schemaVersion\": 1", "\"schemaVersion\": 99.0");
    assert!(migrate::load(&sneaky).is_err());
}

#[test]
fn a_string_schema_version_is_rejected() {
    let sneaky = MINIMAL_V1.replace("\"schemaVersion\": 1", "\"schemaVersion\": \"99\"");
    assert!(migrate::load(&sneaky).is_err());
}

#[test]
fn well_formed_json_that_is_not_a_project_is_rejected_as_not_a_project() {
    assert!(matches!(
        migrate::load(r#"{"schemaVersion":1,"totally":"unrelated"}"#),
        Err(CoreError::NotAProject(_))
    ));
}

#[test]
fn a_schema_version_beyond_u32_is_rejected_as_unsupported_not_wrapped_to_a_small_number() {
    let sneaky = MINIMAL_V1.replace("\"schemaVersion\": 1", "\"schemaVersion\": 4294967296");
    assert!(matches!(
        migrate::load(&sneaky),
        Err(CoreError::UnsupportedSchema(_))
    ));
}

#[test]
fn loading_sorts_an_out_of_order_keyframe_track() {
    let mut clip = Clip::new_media(
        MediaId::from("med_x".to_string()),
        Time::ZERO,
        Time::from_seconds(2.0),
    );
    clip.keyframes.insert(
        "opacity".into(),
        vec![
            Keyframe {
                time: Time::from_seconds(2.0),
                value: ParamValue::Float(100.0),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
            Keyframe {
                time: Time::ZERO,
                value: ParamValue::Float(0.0),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
        ],
    );
    let mut track = Track::new(TrackKind::Video, "V1".into());
    track.clips.push(clip);
    let mut project = Project::default();
    project.timeline.tracks.push(track);
    let raw = serde_json::to_string(&project).unwrap();

    let (loaded, _) = migrate::load(&raw).unwrap();

    let keyframes = &loaded.timeline.tracks[0].clips[0].keyframes["opacity"];
    assert_eq!(keyframes[0].time, Time::ZERO);
    assert_eq!(keyframes[1].time, Time::from_seconds(2.0));
}

#[test]
fn loading_a_clip_with_an_absurd_start_fails_with_invalid_argument() {
    let mut clip = Clip::new_media(
        MediaId::from("med_x".to_string()),
        Time::ZERO,
        Time::from_seconds(1.0),
    );
    clip.start = Time::from_flicks(i64::MAX);
    let mut track = Track::new(TrackKind::Video, "V1".into());
    track.clips.push(clip);
    let mut project = Project::default();
    project.timeline.tracks.push(track);
    let raw = serde_json::to_string(&project).unwrap();

    assert!(matches!(
        migrate::load(&raw),
        Err(CoreError::InvalidArgument(_))
    ));
}
