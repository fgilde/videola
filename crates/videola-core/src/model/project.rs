use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::Clip;
use super::effect::Effect;
use super::keyframe::sort_track;
use super::media::MediaAsset;
use super::timeline::{Marker, Timeline, Track};
use super::{ProjectId, Rate, TrackId};

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
    // sorted-by-time (see keyframe.rs). The loader calls this once after parsing so nothing
    // downstream has to re-check it.
    pub fn normalize(&mut self) {
        for track in &mut self.timeline.tracks {
            normalize_track(track);
        }
        normalize_effects(&mut self.master.effects);
    }
}

fn normalize_track(track: &mut Track) {
    for clip in &mut track.clips {
        normalize_clip(clip);
    }
    normalize_effects(&mut track.effects);
}

fn normalize_clip(clip: &mut Clip) {
    for keyframes in clip.keyframes.values_mut() {
        sort_track(keyframes);
    }
    normalize_effects(&mut clip.effects);
}

fn normalize_effects(effects: &mut [Effect]) {
    for effect in effects {
        for keyframes in effect.keyframes.values_mut() {
            sort_track(keyframes);
        }
    }
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
    use crate::model::{Interp, Keyframe, MediaId, ParamValue, Time, TrackKind};

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

        p.normalize();

        let keyframes = &p.timeline.tracks[0].clips[0].keyframes["opacity"];
        assert_eq!(
            crate::model::keyframe::evaluate(keyframes, Time::from_seconds(1.0)),
            Some(ParamValue::Float(50.0))
        );
    }
}
