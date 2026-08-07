use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::Effect;
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
    use super::super::timeline::TrackKind;
    use super::*;

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
    fn track_lookup_reports_missing_ids() {
        let p = Project::default();
        let missing = TrackId::from("trk_nope".to_string());
        assert!(p.track(&missing).is_none());
        assert!(p.track_index(&missing).is_none());
    }
}
