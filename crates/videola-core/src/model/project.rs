use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::{Clip, ClipSource};
use super::effect::{Effect, Transition};
use super::keyframe::sort_track;
use super::media::MediaAsset;
use super::timeline::{Marker, Timeline, Track};
use super::{ProjectId, Rate, Time, TrackId};
use crate::{CoreError, Result};

// `ClipSource::Compound` nests a whole `Timeline`, which can itself contain compound clips.
// `Box<Timeline>` cannot form a cycle in safe Rust (there is no way to reach back to an
// ancestor), so a depth cap is the only guard nesting needs — do not add a visited-set later.
pub(crate) const MAX_COMPOUND_DEPTH: usize = 8;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub meta: ProjectMeta,
    pub settings: ProjectSettings,
    #[serde(default)]
    pub library: Vec<MediaAsset>,
    pub timeline: Timeline,
    #[serde(default)]
    pub markers: Vec<Marker>,
    pub master: MasterSettings,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            meta: ProjectMeta::default(),
            settings: ProjectSettings::default(),
            library: Vec::new(),
            timeline: Timeline::default(),
            markers: Vec::new(),
            master: MasterSettings::default(),
            extra: Map::new(),
        }
    }
}

impl Project {
    pub fn track_index(&self, id: &TrackId) -> Option<usize> {
        self.timeline
            .tracks
            .iter()
            .position(|track| &track.id == id)
    }

    pub fn track(&self, id: &TrackId) -> Option<&Track> {
        self.timeline.tracks.iter().find(|track| &track.id == id)
    }

    pub fn track_mut(&mut self, id: &TrackId) -> Option<&mut Track> {
        self.timeline
            .tracks
            .iter_mut()
            .find(|track| &track.id == id)
    }

    // Keyframe tracks come straight from deserialised, untrusted JSON and `evaluate` assumes
    // sorted-by-time (see keyframe.rs); the same JSON can also carry a corrupt or hostile Time
    // value (e.g. i64::MAX), which Clip::end()/out_point() would then add unchecked. The loader
    // calls this once after parsing so nothing downstream has to re-check either.
    pub fn normalize(&mut self) -> Result<()> {
        settings_bounded(&self.settings)?;
        normalize_timeline(&mut self.timeline, 0)?;
        normalize_effects(&mut self.master.effects)?;
        normalize_markers(&self.markers)?;
        normalize_library(&self.library)
    }
}

// Entry point for a `ClipSource` that hasn't been stored yet (the command layer's `clip.add`):
// the same field-by-field walk `Project::normalize` runs for every clip already in the tree,
// so a hostile nested timeline is rejected before it reaches the model, not on the next load.
pub(crate) fn normalize_new_clip(clip: &mut Clip) -> Result<()> {
    normalize_clip(clip, 0)
}

fn normalize_timeline(timeline: &mut Timeline, depth: usize) -> Result<()> {
    if depth > MAX_COMPOUND_DEPTH {
        return Err(CoreError::InvalidArgument(
            "compound clip nesting too deep".into(),
        ));
    }
    for track in &mut timeline.tracks {
        normalize_track(track, depth)?;
    }
    Ok(())
}

fn normalize_track(track: &mut Track, depth: usize) -> Result<()> {
    for clip in &mut track.clips {
        normalize_clip(clip, depth)?;
    }
    normalize_effects(&mut track.effects)
}

fn normalize_clip(clip: &mut Clip, depth: usize) -> Result<()> {
    bounded(clip.start)?;
    bounded(clip.duration)?;
    bounded(clip.in_point)?;
    bounded(clip.fades.in_duration)?;
    bounded(clip.fades.out_duration)?;
    normalize_transition(&clip.transition_in)?;
    normalize_transition(&clip.transition_out)?;
    for keyframes in clip.keyframes.values_mut() {
        sort_track(keyframes);
        for keyframe in keyframes.iter() {
            bounded(keyframe.time)?;
        }
    }
    if let ClipSource::Compound { timeline } = &mut clip.source {
        normalize_timeline(timeline, depth + 1)?;
    }
    normalize_effects(&mut clip.effects)
}

fn normalize_transition(transition: &Option<Transition>) -> Result<()> {
    match transition {
        Some(transition) => bounded(transition.duration),
        None => Ok(()),
    }
}

fn normalize_effects(effects: &mut [Effect]) -> Result<()> {
    for effect in effects {
        for keyframes in effect.keyframes.values_mut() {
            sort_track(keyframes);
            for keyframe in keyframes.iter() {
                bounded(keyframe.time)?;
            }
        }
    }
    Ok(())
}

fn normalize_markers(markers: &[Marker]) -> Result<()> {
    for marker in markers {
        bounded(marker.time)?;
    }
    Ok(())
}

fn normalize_library(library: &[MediaAsset]) -> Result<()> {
    for asset in library {
        if let Some(duration) = asset.duration {
            bounded(duration)?;
        }
        if let Some(fps) = asset.fps {
            rate_bounded(fps)?;
        }
    }
    Ok(())
}

// The one definition of the `Time` bound `Project::normalize` enforces on load; the command
// layer re-exposes this (see `command::bounded`) so a value that would fail to reload is
// rejected up front instead of round-tripping through save/load once.
pub(crate) fn bounded(time: Time) -> Result<()> {
    if time.as_flicks() < 0 || time > Time::MAX_REASONABLE {
        Err(CoreError::InvalidArgument("time value out of range".into()))
    } else {
        Ok(())
    }
}

// The `Rate` equivalent of `bounded`: `settings.fps` and every `MediaAsset.fps` cross the same
// untrusted-JSON boundary, and a zero denominator or numerator turns straight into a division by
// zero in `Time::from_frames`/`to_frame`. 1 fps is the floor because anything slower makes a
// nominal frame count meaningless (and rounds to zero, which is the same bug wearing a costume);
// 1000 fps covers every real high-speed camera in use today while keeping `from_frames` far from
// overflowing `i64` flicks.
const MIN_REASONABLE_FPS: f64 = 1.0;
const MAX_REASONABLE_FPS: f64 = 1000.0;

pub(crate) fn rate_bounded(rate: Rate) -> Result<()> {
    if rate.numerator == 0 || rate.denominator == 0 {
        return Err(CoreError::InvalidArgument(
            "rate must have a non-zero numerator and denominator".into(),
        ));
    }
    match rate.as_f64() {
        Some(fps) if (MIN_REASONABLE_FPS..=MAX_REASONABLE_FPS).contains(&fps) => Ok(()),
        _ => Err(CoreError::InvalidArgument(
            "rate out of reasonable range".into(),
        )),
    }
}

// 16384 covers 8K (7680x4320) with headroom for odd custom sizes, and keeps `width * height * 4`
// (a full RGBA frame buffer) at ~1 GiB, nowhere near overflowing a u32 byte count downstream.
const MAX_REASONABLE_DIMENSION: u32 = 16_384;

// 192 kHz is the practical ceiling for real audio hardware; doubling it leaves room for an
// oversampled pro-audio pipeline without accepting values that only a corrupt file would carry.
const MAX_REASONABLE_SAMPLE_RATE: u32 = 384_000;

fn dimension_bounded(value: u32) -> Result<()> {
    if value == 0 || value > MAX_REASONABLE_DIMENSION {
        Err(CoreError::InvalidArgument(
            "width and height must be between 1 and 16384".into(),
        ))
    } else {
        Ok(())
    }
}

fn sample_rate_bounded(value: u32) -> Result<()> {
    if value == 0 || value > MAX_REASONABLE_SAMPLE_RATE {
        Err(CoreError::InvalidArgument(
            "sample rate must be between 1 and 384000".into(),
        ))
    } else {
        Ok(())
    }
}

// The one rule `Project::normalize` (load) and `command::project::set_settings` (dispatch) both
// enforce for `ProjectSettings` — without this, a `project.setSettings` command could set a
// zero-denominator fps or a zero width that a loaded project could never carry, corrupting the
// project from that dispatch onward.
pub(crate) fn settings_bounded(settings: &ProjectSettings) -> Result<()> {
    rate_bounded(settings.fps)?;
    dimension_bounded(settings.width)?;
    dimension_bounded(settings.height)?;
    sample_rate_bounded(settings.sample_rate)
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub width: u32,
    pub height: u32,
    pub fps: Rate,
    pub sample_rate: u32,
    pub color_space: String,
    pub background: String,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: Rate::from_fps(30),
            sample_rate: 48_000,
            color_space: "srgb".to_string(),
            background: "#000000".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MasterSettings {
    pub volume: f32,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl Default for MasterSettings {
    fn default() -> Self {
        Self {
            volume: 1.0,
            effects: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Interp, Keyframe, MediaAsset, MediaId, MediaKind, ParamValue, Time, TrackKind,
    };

    #[test]
    fn default_project_has_no_tracks_and_sane_settings() {
        let p = Project::default();
        assert_eq!(p.schema_version, SCHEMA_VERSION);
        assert!(p.timeline.tracks.is_empty());
        assert_eq!(p.settings.width, 1920);
        assert_eq!(p.settings.height, 1080);
        assert_eq!(p.settings.fps, Rate::from_fps(30));
        assert_eq!(p.settings.sample_rate, 48_000);
    }

    #[test]
    fn json_roundtrip_preserves_everything() {
        let mut p = Project::default();
        p.timeline
            .tracks
            .push(Track::new(TrackKind::Video, "V1".into()));
        let json = serde_json::to_string(&p).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let json = r##"{
            "schemaVersion": 1,
            "meta": {"id":"prj_1","title":"T","tags":[]},
            "settings": {"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1},
                         "sampleRate":48000,"colorSpace":"srgb","background":"#000000"},
            "timeline": {"tracks":[]},
            "markers": [],
            "master": {"volume":1.0,"effects":[]},
            "futureField": {"keep":"me"}
        }"##;
        let p: Project = serde_json::from_str(json).unwrap();
        let out = serde_json::to_value(&p).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }

    #[test]
    fn extra_fields_keep_deterministic_key_order() {
        let mut p = Project::default();
        p.extra.insert("z".into(), serde_json::json!(1));
        p.extra.insert("a".into(), serde_json::json!(2));
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.find("\"a\"").unwrap() < json.find("\"z\"").unwrap());
    }

    #[test]
    fn track_lookup_reports_missing_ids() {
        let p = Project::default();
        let missing = TrackId::from("trk_nope".to_string());
        assert!(p.track(&missing).is_none());
        assert!(p.track_index(&missing).is_none());
    }

    #[test]
    fn track_lookup_finds_an_existing_track() {
        let mut p = Project::default();
        let track = Track::new(TrackKind::Video, "V1".into());
        let id = track.id.clone();
        p.timeline.tracks.push(track);

        assert_eq!(p.track_index(&id), Some(0));
        assert_eq!(p.track(&id).map(|t| t.id.clone()), Some(id.clone()));
        assert_eq!(p.track_mut(&id).map(|t| t.id.clone()), Some(id));
    }

    #[test]
    fn normalize_sorts_out_of_order_keyframe_tracks() {
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
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        p.normalize().unwrap();

        let keyframes = &p.timeline.tracks[0].clips[0].keyframes["opacity"];
        assert_eq!(
            crate::model::keyframe::evaluate(keyframes, Time::from_seconds(1.0)),
            Some(ParamValue::Float(50.0))
        );
    }

    #[test]
    fn a_clip_with_an_absurd_start_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.start = Time::from_flicks(i64::MAX);
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    fn leaf_clip() -> Clip {
        Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        )
    }

    fn compound_clip(inner: Clip) -> Clip {
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
    fn a_compound_clips_nested_start_is_checked_too() {
        let mut nested = leaf_clip();
        nested.start = Time::from_flicks(i64::MAX);
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(compound_clip(nested));
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn two_levels_of_compound_nesting_are_accepted() {
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(compound_clip(compound_clip(leaf_clip())));
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        assert!(p.normalize().is_ok());
    }

    fn project_json_with_fps(numerator: u32, denominator: u32) -> String {
        format!(
            r##"{{
                "schemaVersion": 1,
                "meta": {{"id":"prj_1","title":"T","tags":[]}},
                "settings": {{"width":1920,"height":1080,
                             "fps":{{"numerator":{numerator},"denominator":{denominator}}},
                             "sampleRate":48000,"colorSpace":"srgb","background":"#000000"}},
                "timeline": {{"tracks":[]}},
                "markers": [],
                "master": {{"volume":1.0,"effects":[]}}
            }}"##
        )
    }

    #[test]
    fn a_zero_denominator_fps_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(30, 0)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_zero_numerator_fps_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(0, 1)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_sub_one_fps_rate_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(1, 3)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn ntsc_rates_still_load() {
        for (numerator, denominator) in [(30_000, 1001), (24_000, 1001), (60_000, 1001)] {
            let mut p: Project =
                serde_json::from_str(&project_json_with_fps(numerator, denominator)).unwrap();
            assert!(
                p.normalize().is_ok(),
                "{numerator}/{denominator} should be accepted"
            );
        }
    }

    fn project_json_with_settings(width: u32, height: u32, sample_rate: u32) -> String {
        format!(
            r##"{{
                "schemaVersion": 1,
                "meta": {{"id":"prj_1","title":"T","tags":[]}},
                "settings": {{"width":{width},"height":{height},
                             "fps":{{"numerator":30000,"denominator":1001}},
                             "sampleRate":{sample_rate},"colorSpace":"srgb","background":"#000000"}},
                "timeline": {{"tracks":[]}},
                "markers": [],
                "master": {{"volume":1.0,"effects":[]}}
            }}"##
        )
    }

    #[test]
    fn a_zero_width_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(0, 1080, 48_000)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_zero_sample_rate_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(1920, 1080, 0)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_legitimate_4k_ntsc_project_still_loads() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(3840, 2160, 48_000)).unwrap();
        assert!(p.normalize().is_ok());
    }

    #[test]
    fn a_media_assets_bad_fps_is_caught_too() {
        let mut p = Project::default();
        let mut asset = MediaAsset::new(
            MediaId::from("med_x".to_string()),
            "clip.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            10,
        );
        asset.fps = Some(Rate::new(30, 0));
        p.library.push(asset);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn compound_nesting_deeper_than_the_limit_is_rejected() {
        let mut clip = leaf_clip();
        for _ in 0..(MAX_COMPOUND_DEPTH + 2) {
            clip = compound_clip(clip);
        }
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(clip);
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }
}
