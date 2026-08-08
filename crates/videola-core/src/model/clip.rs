use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::{Effect, Transition};
use super::keyframe::{evaluate, Keyframe};
use super::{ClipId, GroupId, MediaId, ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: ClipId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<GroupId>,
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

    // What a decoder may be handed. `source_time_at` maps the head of a reversed clip onto the
    // exclusive end of the consumed range, and that is a flick past the last sample there is.
    pub fn readable_source_time_at(&self, t: Time) -> Option<Time> {
        let last = (self.out_point() - Time::from_flicks(1)).max(self.in_point);
        self.source_time_at(t)
            .map(|at| at.clamp(self.in_point, last))
    }

    pub fn consumed_source(&self) -> Time {
        Time::from_flicks(
            (self.duration.as_flicks() as f64 * self.speed.rate as f64).round() as i64,
        )
    }

    // What the picture is drawn with; `transform` alone is only the value at rest. A keyframed
    // field wins over the static one, the same rule `Effect::param_at` applies to a parameter, and
    // for the same reason: the inspector and the renderer must not interpolate separately.
    //
    // A track under a name no `Transform` carries is skipped, not refused -- a project written by a
    // later version has to keep drawing. The command layer is where such a name is turned away, so
    // nothing an editor writes here can end up invisible.
    pub fn transform_at(&self, at: Time) -> Transform {
        let mut resolved = self.transform.clone();
        for (key, track) in &self.keyframes {
            let Some(field) = resolved.field_mut(key) else {
                continue;
            };
            if let Some(ParamValue::Float(value)) = evaluate(track, at) {
                *field = value;
            }
        }
        resolved
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

impl Transform {
    // The single roster of what a keyframe track may address, under the names the field carries in
    // JSON. Both readers go through it -- `transform_at` to resolve and the command layer to refuse
    // -- so there is no list to drift out of step with the struct.
    pub fn field_mut(&mut self, key: &str) -> Option<&mut f32> {
        Some(match key {
            "x" => &mut self.x,
            "y" => &mut self.y,
            "scaleX" => &mut self.scale_x,
            "scaleY" => &mut self.scale_y,
            "rotation" => &mut self.rotation,
            "anchorX" => &mut self.anchor_x,
            "anchorY" => &mut self.anchor_y,
            "opacity" => &mut self.opacity,
            "cropLeft" => &mut self.crop.left,
            "cropTop" => &mut self.crop.top,
            "cropRight" => &mut self.crop.right,
            "cropBottom" => &mut self.crop.bottom,
            _ => return None,
        })
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Crop {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Fades {
    pub in_duration: Time,
    pub out_duration: Time,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Interp, MediaId};

    fn ramp(clip: &mut Clip, key: &str, from: f32, to: f32, seconds: f64) {
        clip.keyframes.insert(
            key.to_string(),
            vec![
                Keyframe {
                    time: Time::ZERO,
                    value: ParamValue::Float(from),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
                Keyframe {
                    time: Time::from_seconds(seconds),
                    value: ParamValue::Float(to),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
            ],
        );
    }

    #[test]
    fn a_keyframed_transform_field_moves_and_the_rest_stays_put() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.x = 500.0;
        clip.transform.y = 42.0;
        ramp(&mut clip, "x", 0.0, 100.0, 2.0);

        assert_eq!(clip.transform_at(Time::from_seconds(1.0)).x, 50.0);
        assert_eq!(clip.transform_at(Time::from_seconds(1.0)).y, 42.0);
    }

    // Every field a keyframe may address has to be the one it names. A single wrong arm in
    // `field_mut` would animate a neighbour instead, which the compositor draws without complaint.
    #[test]
    fn every_keyframable_field_is_the_field_it_is_named_after() {
        type Named = (&'static str, fn(&Transform) -> f32);
        let named: [Named; 12] = [
            ("x", |t| t.x),
            ("y", |t| t.y),
            ("scaleX", |t| t.scale_x),
            ("scaleY", |t| t.scale_y),
            ("rotation", |t| t.rotation),
            ("anchorX", |t| t.anchor_x),
            ("anchorY", |t| t.anchor_y),
            ("opacity", |t| t.opacity),
            ("cropLeft", |t| t.crop.left),
            ("cropTop", |t| t.crop.top),
            ("cropRight", |t| t.crop.right),
            ("cropBottom", |t| t.crop.bottom),
        ];
        for (key, read) in named {
            let mut clip = media_clip(0.0, 4.0);
            ramp(&mut clip, key, 0.0, 8.0, 2.0);
            let resolved = clip.transform_at(Time::from_seconds(1.0));
            assert_eq!(read(&resolved), 4.0, "{key} did not move");
            let untouched = named
                .iter()
                .filter(|(other, _)| *other != key)
                .filter(|(_, other)| other(&resolved) != other(&Transform::default()))
                .count();
            assert_eq!(untouched, 0, "{key} moved a field it does not name");
        }
    }

    #[test]
    fn a_transform_without_keyframes_is_the_static_one() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.rotation = 33.0;
        assert_eq!(clip.transform_at(Time::from_seconds(2.0)), clip.transform);
    }

    // Forward compatibility, and the reason the command layer has to refuse unknown names itself:
    // nothing here complains, the field simply never moves.
    #[test]
    fn a_track_naming_no_transform_field_is_ignored() {
        let mut clip = media_clip(0.0, 4.0);
        ramp(&mut clip, "wobble", 0.0, 100.0, 2.0);
        assert_eq!(clip.transform_at(Time::from_seconds(1.0)), clip.transform);
    }

    // A hand-authored project can put any `ParamValue` on any track. A colour is not a transform
    // field, and taking its first channel would be worse than leaving the field alone.
    #[test]
    fn a_track_of_the_wrong_value_kind_leaves_the_field_alone() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.opacity = 0.25;
        clip.keyframes.insert(
            "opacity".into(),
            vec![Keyframe {
                time: Time::ZERO,
                value: ParamValue::Bool(true),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            }],
        );
        assert_eq!(clip.transform_at(Time::ZERO).opacity, 0.25);
    }

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
    fn readable_source_time_keeps_a_reversed_head_inside_the_consumed_range() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.rate = 2.0;
        clip.speed.reverse = true;
        let at = clip.readable_source_time_at(Time::ZERO).unwrap();
        assert_eq!(at, clip.out_point() - Time::from_flicks(1));
        assert!(at < clip.out_point());
    }

    #[test]
    fn readable_source_time_leaves_every_other_point_alone() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.reverse = true;
        assert_eq!(
            clip.readable_source_time_at(Time::from_seconds(1.0)),
            clip.source_time_at(Time::from_seconds(1.0))
        );

        let forward = media_clip(0.0, 2.0);
        assert_eq!(
            forward.readable_source_time_at(Time::from_seconds(1.5)),
            forward.source_time_at(Time::from_seconds(1.5))
        );
    }

    #[test]
    fn readable_source_time_outside_the_clip_is_none() {
        let clip = media_clip(2.0, 1.0);
        assert!(clip
            .readable_source_time_at(Time::from_seconds(5.0))
            .is_none());
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
