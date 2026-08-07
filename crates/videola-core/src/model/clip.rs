use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::{Effect, Transition};
use super::keyframe::Keyframe;
use super::{ClipId, MediaId, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: ClipId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub source: ClipSource,
    pub start: Time,
    pub duration: Time,
    pub in_point: Time,
    pub speed: Speed,
    pub transform: Transform,
    pub blend: BlendMode,
    pub fades: Fades,
    pub volume: f32,
    pub pan: f32,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_in: Option<Transition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_out: Option<Transition>,
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Clip {
    pub fn new_media(media: MediaId, start: Time, duration: Time) -> Self {
        Self::new(ClipSource::Media { media }, start, duration)
    }

    pub fn new_generator(generator: Generator, start: Time, duration: Time) -> Self {
        Self::new(ClipSource::Generator { generator }, start, duration)
    }

    fn new(source: ClipSource, start: Time, duration: Time) -> Self {
        Self {
            id: ClipId::new(),
            label: None,
            group_id: None,
            source,
            start,
            duration,
            in_point: Time::ZERO,
            speed: Speed::default(),
            transform: Transform::default(),
            blend: BlendMode::Normal,
            fades: Fades::default(),
            volume: 1.0,
            pan: 0.0,
            effects: Vec::new(),
            transition_in: None,
            transition_out: None,
            keyframes: BTreeMap::new(),
            extra: Map::new(),
        }
    }

    pub fn end(&self) -> Time {
        self.start + self.duration
    }

    pub fn contains(&self, t: Time) -> bool {
        t >= self.start && t < self.end()
    }

    // Derived, not stored: out_point = in_point + consumed_source. A stored field would be a
    // second source of truth that source_time_at never consulted, and it drifts from the real
    // consumed range the moment a clip is trimmed at a rate other than 1.0.
    pub fn out_point(&self) -> Time {
        self.in_point + self.consumed_source()
    }

    pub fn source_time_at(&self, t: Time) -> Option<Time> {
        if !self.contains(t) {
            return None;
        }
        let offset = Time::from_flicks(
            ((t - self.start).as_flicks() as f64 * self.speed.rate as f64).round() as i64,
        );
        Some(if self.speed.reverse {
            // At t == start this returns in_point + consumed_source, the *exclusive* end of the
            // consumed source range — one flick past the last valid source sample. The decode
            // path must clamp reads into [in_point, in_point + consumed_source) or the first
            // frame of a reversed clip comes back black (read past end-of-media).
            self.in_point + self.consumed_source() - offset
        } else {
            self.in_point + offset
        })
    }

    pub fn consumed_source(&self) -> Time {
        Time::from_flicks(
            (self.duration.as_flicks() as f64 * self.speed.rate as f64).round() as i64,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ClipSource {
    Media {
        media: MediaId,
    },
    Generator {
        generator: Generator,
    },
    Compound {
        timeline: Box<super::timeline::Timeline>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Generator {
    Text {
        content: String,
        style: BTreeMap<String, Value>,
    },
    Solid {
        color: String,
    },
    Shape {
        shape: String,
        color: String,
    },
    Gradient {
        from: String,
        to: String,
        angle: f32,
    },
    Countdown {
        from_seconds: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Speed {
    pub rate: f32,
    pub reverse: bool,
    pub preserve_pitch: bool,
}

impl Default for Speed {
    fn default() -> Self {
        Self {
            rate: 1.0,
            reverse: false,
            preserve_pitch: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotation: f32,
    pub anchor_x: f32,
    pub anchor_y: f32,
    pub opacity: f32,
    pub crop: Crop,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation: 0.0,
            anchor_x: 0.5,
            anchor_y: 0.5,
            opacity: 1.0,
            crop: Crop::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Add,
    Subtract,
    Difference,
    Lighten,
    Darken,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Fades {
    pub in_duration: Time,
    pub out_duration: Time,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MediaId;

    fn media_clip(start_s: f64, dur_s: f64) -> Clip {
        Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::from_seconds(start_s),
            Time::from_seconds(dur_s),
        )
    }

    #[test]
    fn end_is_start_plus_duration() {
        let clip = media_clip(2.0, 3.0);
        assert_eq!(clip.end().as_seconds(), 5.0);
    }

    #[test]
    fn contains_is_start_inclusive_and_end_exclusive() {
        let clip = media_clip(2.0, 3.0);
        assert!(clip.contains(Time::from_seconds(2.0)));
        assert!(clip.contains(Time::from_seconds(4.999)));
        assert!(!clip.contains(Time::from_seconds(5.0)));
        assert!(!clip.contains(Time::from_seconds(1.999)));
    }

    #[test]
    fn out_point_accounts_for_speed_when_trimmed() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.rate = 2.0;
        assert_eq!(clip.out_point().as_seconds(), 14.0);
    }

    #[test]
    fn source_time_follows_in_point_at_normal_speed() {
        let mut clip = media_clip(10.0, 4.0);
        clip.in_point = Time::from_seconds(7.0);
        let at = clip.source_time_at(Time::from_seconds(11.0)).unwrap();
        assert_eq!(at.as_seconds(), 8.0);
    }

    #[test]
    fn source_time_reads_backwards_when_reversed() {
        let mut clip = media_clip(0.0, 4.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.reverse = true;
        assert_eq!(
            clip.source_time_at(Time::from_seconds(0.0))
                .unwrap()
                .as_seconds(),
            14.0
        );
        assert_eq!(
            clip.source_time_at(Time::from_seconds(3.0))
                .unwrap()
                .as_seconds(),
            11.0
        );
    }

    #[test]
    fn source_time_scales_with_rate() {
        let mut clip = media_clip(0.0, 2.0);
        clip.speed.rate = 2.0;
        assert_eq!(
            clip.source_time_at(Time::from_seconds(1.0))
                .unwrap()
                .as_seconds(),
            2.0
        );
    }

    #[test]
    fn source_time_scales_with_rate_when_reversed() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.rate = 2.0;
        clip.speed.reverse = true;
        assert_eq!(clip.source_time_at(Time::ZERO).unwrap().as_seconds(), 14.0);
    }

    #[test]
    fn source_time_outside_the_clip_is_none() {
        let clip = media_clip(2.0, 1.0);
        assert!(clip.source_time_at(Time::from_seconds(5.0)).is_none());
    }

    #[test]
    fn generator_clips_need_no_media() {
        let clip = Clip::new_generator(
            Generator::Solid {
                color: "#ff0000".into(),
            },
            Time::ZERO,
            Time::from_seconds(3.0),
        );
        assert!(matches!(clip.source, ClipSource::Generator { .. }));
        assert_eq!(clip.end().as_seconds(), 3.0);
    }

    #[test]
    fn generator_fields_serialise_in_camel_case() {
        let json = serde_json::to_value(Generator::Countdown { from_seconds: 5 }).unwrap();
        assert_eq!(json["fromSeconds"], 5);
        assert!(json.get("from_seconds").is_none());
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let clip = media_clip(0.0, 1.0);
        let mut json = serde_json::to_value(&clip).unwrap();
        json.as_object_mut()
            .unwrap()
            .insert("futureField".into(), serde_json::json!({"keep": "me"}));
        let back: Clip = serde_json::from_value(json).unwrap();
        let out = serde_json::to_value(&back).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }
}
