use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::Clip;
use super::effect::Effect;
use super::{ClipId, MarkerId, Time, TrackId};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TrackKind {
    Video,
    Audio,
    Text,
    // A kind of its own rather than a text track by convention, and the reason is a question only
    // this field can answer: "which of these clips are subtitles". A lower third is a text clip on
    // a text track too -- the builtin templates put them there -- so a subtitle file written from
    // every text clip in the project would carry the lower thirds as cues, and one written from
    // some of them would need a second marking somewhere else to say which. `Text` stays what it
    // is: titles, cards, credits, anything drawn from words. `Caption` is the spoken word timed to
    // the picture, and it is the track a `.srt` is read into and written out of.
    Caption,
    Overlay,
    Adjustment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

    pub fn clip_index(&self, id: &ClipId) -> Option<usize> {
        self.clips.iter().position(|clip| &clip.id == id)
    }
}

fn default_color(kind: TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "#5B8CFF",
        TrackKind::Audio => "#2EA043",
        TrackKind::Text => "#F0A030",
        TrackKind::Caption => "#E0C040",
        TrackKind::Overlay => "#B06BD6",
        TrackKind::Adjustment => "#6BD6FF",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: MarkerId,
    pub time: Time,
    pub label: String,
    pub color_hex: String,
    // A note is what a marker is for once there are more than three of them: the label is what the
    // ruler can show, this is what the list reads out. Defaulted rather than optional, because a
    // marker written before this field existed has an empty note, not an absent one.
    #[serde(default)]
    pub note: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MediaId;

    #[test]
    fn empty_timeline_has_zero_duration() {
        assert_eq!(Timeline::default().duration(), Time::ZERO);
    }

    #[test]
    fn duration_is_the_latest_clip_end_across_all_tracks() {
        let mut timeline = Timeline::default();

        let mut a = Track::new(TrackKind::Video, "V1".into());
        a.clips.push(Clip::new_media(
            MediaId::from("med_a".to_string()),
            Time::ZERO,
            Time::from_seconds(3.0),
        ));
        timeline.tracks.push(a);

        let mut b = Track::new(TrackKind::Audio, "A1".into());
        b.clips.push(Clip::new_media(
            MediaId::from("med_b".to_string()),
            Time::from_seconds(1.0),
            Time::from_seconds(5.0),
        ));
        timeline.tracks.push(b);

        assert_eq!(timeline.duration().as_seconds(), 6.0);
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
    fn clip_index_finds_an_existing_clip() {
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        let id = clip.id.clone();
        track.clips.push(clip);
        assert_eq!(track.clip_index(&id), Some(0));
    }

    #[test]
    fn track_kind_serialises_in_kebab_case() {
        let json = serde_json::to_string(&TrackKind::Adjustment).unwrap();
        assert_eq!(json, "\"adjustment\"");
        assert_eq!(serde_json::to_string(&TrackKind::Caption).unwrap(), "\"caption\"");
    }

    // Every kind has to be a colour of its own: the timeline draws the track's stripe from this and
    // two kinds sharing one would make a caption track indistinguishable from the titles above it.
    #[test]
    fn every_track_kind_has_a_colour_no_other_kind_uses() {
        let kinds = [
            TrackKind::Video,
            TrackKind::Audio,
            TrackKind::Text,
            TrackKind::Caption,
            TrackKind::Overlay,
            TrackKind::Adjustment,
        ];
        let mut seen = std::collections::BTreeSet::new();
        for kind in kinds {
            assert!(seen.insert(default_color(kind)), "{kind:?} repeats a colour");
        }
        assert_eq!(seen.len(), kinds.len());
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let track = Track::new(TrackKind::Video, "V1".into());
        let mut json = serde_json::to_value(&track).unwrap();
        json.as_object_mut()
            .unwrap()
            .insert("futureField".into(), serde_json::json!({"keep": "me"}));
        let back: Track = serde_json::from_value(json).unwrap();
        let out = serde_json::to_value(&back).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }
}
