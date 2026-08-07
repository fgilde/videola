use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::Clip;
use super::effect::Effect;
use super::{MarkerId, Time, TrackId};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub tracks: Vec<Track>,
}

impl Timeline {
    pub fn duration(&self) -> Time {
        self.tracks
            .iter()
            .flat_map(|track| track.clips.iter())
            .map(Clip::end)
            .fold(Time::ZERO, Time::max)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TrackKind {
    Video,
    Audio,
    Text,
    Overlay,
    Adjustment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: TrackId,
    pub kind: TrackKind,
    pub name: String,
    pub color_hex: String,
    pub height: u32,
    pub locked: bool,
    pub hidden: bool,
    pub muted: bool,
    pub solo: bool,
    pub volume: f32,
    pub pan: f32,
    pub clips: Vec<Clip>,
    pub effects: Vec<Effect>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Track {
    pub fn new(kind: TrackKind, name: String) -> Self {
        Self {
            id: TrackId::new(),
            kind,
            name,
            color_hex: default_color(kind).to_string(),
            height: 72,
            locked: false,
            hidden: false,
            muted: false,
            solo: false,
            volume: 1.0,
            pan: 0.0,
            clips: Vec::new(),
            effects: Vec::new(),
            extra: Map::new(),
        }
    }

    pub fn clip_index(&self, id: &crate::model::ClipId) -> Option<usize> {
        self.clips.iter().position(|clip| &clip.id == id)
    }
}

fn default_color(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "#5B8CFF",
        TrackKind::Audio => "#2EA043",
        TrackKind::Text => "#F0A030",
        TrackKind::Overlay => "#B06BD6",
        TrackKind::Adjustment => "#6BD6FF",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: MarkerId,
    pub time: Time,
    pub label: String,
    pub color_hex: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_timeline_has_zero_duration() {
        assert_eq!(Timeline::default().duration(), Time::ZERO);
    }

    #[test]
    fn new_track_is_audible_and_unlocked() {
        let t = Track::new(TrackKind::Audio, "A1".into());
        assert!(!t.muted);
        assert!(!t.locked);
        assert_eq!(t.volume, 1.0);
        assert_eq!(t.pan, 0.0);
    }

    #[test]
    fn track_kind_serialises_in_kebab_case() {
        let json = serde_json::to_string(&TrackKind::Adjustment).unwrap();
        assert_eq!(json, "\"adjustment\"");
    }
}
