use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::effect::{Effect, Transition};
use super::keyframe::{evaluate, evaluate_path, integrate, Keyframe};
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
        let offset = self.source_offset(t - self.start);
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
        self.source_offset(self.duration)
    }

    // How much source the clip has spent `delta` into its own run. A constant rate makes that a
    // multiplication; a rate track makes it the area under that track, and that difference is the
    // whole of what a speed ramp is -- the map from project time to source time stops being
    // proportional and becomes an integral.
    //
    // `consumed_source` is this same call asked for the whole duration, deliberately: the total and
    // every prefix of it then come out of one piece of arithmetic. A reversed clip reads
    // `consumed - offset`, so the moment those two were computed differently its head would land
    // outside the range `readable_source_time_at` clamps to and the clamp would be doing the work
    // silently instead of catching a bug.
    fn source_offset(&self, delta: Time) -> Time {
        let area = self
            .keyframes
            .get(SPEED_TRACK)
            .and_then(|track| integrate(track, self.start, self.start + delta));
        let flicks = area.unwrap_or_else(|| delta.as_flicks() as f64 * self.speed.rate as f64);
        Time::from_flicks(flicks.round() as i64)
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
        // A motion path answers the same question `x` and `y` do, so it is resolved last and wins
        // outright. Letting the two settle it by iteration order would hand the answer to a
        // BTreeMap's alphabet, and "the clip stands where the path says" is not a fact about
        // spelling. A project carrying both is one an editor migrated halfway; the path is the one
        // that was authored as a shape.
        if let Some([x, y]) = self
            .keyframes
            .get(POSITION_TRACK)
            .and_then(|track| evaluate_path(track, at))
        {
            resolved.x = x;
            resolved.y = y;
        }
        resolved
    }
}

// The keyframe track that carries a motion path: `Vec2` keys in the same project pixels
// `Transform::x` and `y` use. Named here beside the resolution that reads it and the roster that
// refuses everything else, so the command layer and the renderer cannot disagree on the spelling.
pub const POSITION_TRACK: &str = "position";

// The keyframe track that carries a speed ramp: playback rate over time, in the same factor
// `Speed::rate` uses, and the one track the picture reads by area rather than by value. It names no
// `Transform` field, so `transform_at` walks past it without a special case -- `field_mut` is still
// the whole roster of what geometry a keyframe may move.
//
// Zero is a legal value here and not on `Speed::rate`: a rate that reads zero is a frame hold,
// which is an authored thing, while a static zero is a clip that consumes no source at all and that
// the compound mapping in nesting.ts divides by.
pub const SPEED_TRACK: &str = "speed";

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

    fn path(clip: &mut Clip, points: &[(f64, f32, f32)]) {
        clip.keyframes.insert(
            POSITION_TRACK.to_string(),
            points
                .iter()
                .map(|(seconds, x, y)| Keyframe {
                    time: Time::from_seconds(*seconds),
                    value: ParamValue::Vec2([*x, *y]),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                })
                .collect(),
        );
    }

    #[test]
    fn a_motion_path_places_the_clip_on_both_axes() {
        let mut clip = media_clip(0.0, 4.0);
        path(&mut clip, &[(0.0, 0.0, 0.0), (4.0, 100.0, 40.0)]);

        let resolved = clip.transform_at(Time::from_seconds(1.0));
        assert_eq!((resolved.x, resolved.y), (25.0, 10.0));
    }

    // Two answers to "where does the clip stand" must not be settled by which key a BTreeMap yields
    // first. Both tracks would move the clip on their own; only one of them may.
    #[test]
    fn a_motion_path_wins_over_separate_x_and_y_tracks() {
        let mut clip = media_clip(0.0, 4.0);
        ramp(&mut clip, "x", 0.0, 800.0, 2.0);
        ramp(&mut clip, "y", 0.0, 800.0, 2.0);
        path(&mut clip, &[(0.0, 0.0, 0.0), (4.0, 100.0, 40.0)]);

        let resolved = clip.transform_at(Time::from_seconds(1.0));
        assert_eq!((resolved.x, resolved.y), (25.0, 10.0));
    }

    #[test]
    fn a_motion_path_leaves_every_other_field_alone() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.rotation = 33.0;
        clip.transform.opacity = 0.25;
        path(&mut clip, &[(0.0, 0.0, 0.0), (4.0, 100.0, 40.0)]);

        let resolved = clip.transform_at(Time::from_seconds(1.0));
        assert_eq!((resolved.rotation, resolved.opacity), (33.0, 0.25));
    }

    // The forward-compatible half of the same rule the scalar tracks follow: a path this version
    // cannot read leaves the clip where the static transform put it rather than at the origin.
    #[test]
    fn a_path_track_of_the_wrong_value_kind_leaves_the_placement_alone() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.x = 12.0;
        clip.transform.y = 34.0;
        clip.keyframes.insert(
            POSITION_TRACK.to_string(),
            vec![Keyframe {
                time: Time::ZERO,
                value: ParamValue::Float(7.0),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            }],
        );

        let resolved = clip.transform_at(Time::ZERO);
        assert_eq!((resolved.x, resolved.y), (12.0, 34.0));
    }

    #[test]
    fn an_empty_path_track_leaves_the_placement_alone() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.x = 12.0;
        clip.keyframes
            .insert(POSITION_TRACK.to_string(), Vec::new());

        assert_eq!(clip.transform_at(Time::from_seconds(1.0)).x, 12.0);
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

    // `normalize` sorts keyframe tracks but does not drop empty ones, and `keyframe.remove` is the
    // only thing that ever would -- so `{"keyframes": {"x": []}}` is a project that loads. The
    // field then has to keep its static value rather than fall to whatever an empty track suggests.
    #[test]
    fn an_empty_track_leaves_the_field_at_its_static_value() {
        let mut clip = media_clip(0.0, 4.0);
        clip.transform.x = 12.0;
        clip.keyframes.insert("x".into(), Vec::new());

        assert_eq!(clip.transform_at(Time::from_seconds(1.0)).x, 12.0);
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

    fn rate_track(clip: &mut Clip, points: &[(f64, f32, Interp)]) {
        clip.keyframes.insert(
            SPEED_TRACK.to_string(),
            points
                .iter()
                .map(|(seconds, rate, interp)| Keyframe {
                    time: Time::from_seconds(*seconds),
                    value: ParamValue::Float(*rate),
                    interp: *interp,
                    handle_in: None,
                    handle_out: None,
                })
                .collect(),
        );
    }

    // The claim that makes a ramp a ramp. A clip running from half speed to double over two seconds
    // has spent 0.875s of source after one -- the area under the rate, not the rate times anything.
    // Every proportional reading of the same moment lands somewhere else: the rate at that instant
    // says 1.25, the average rate says 1.25, the static rate says 1.0.
    #[test]
    fn a_speed_ramp_maps_project_time_by_the_area_under_the_rate() {
        let mut clip = media_clip(0.0, 2.0);
        rate_track(
            &mut clip,
            &[(0.0, 0.5, Interp::Linear), (2.0, 2.0, Interp::Linear)],
        );

        let at = clip.source_time_at(Time::from_seconds(1.0)).unwrap();
        assert!(
            (at.as_seconds() - 0.875).abs() < 1e-6,
            "{}",
            at.as_seconds()
        );
        assert!((clip.consumed_source().as_seconds() - 2.5).abs() < 1e-6);
    }

    // A ramp starts where the clip does, not where the timeline does: keyframe times are project
    // time, the same base a transform track uses, so a ramped clip dragged along the timeline keeps
    // the shape it was authored against only if the arithmetic reads both ends from `start`.
    #[test]
    fn a_ramp_is_measured_from_the_clip_head_not_from_time_zero() {
        let mut clip = media_clip(10.0, 2.0);
        clip.in_point = Time::from_seconds(4.0);
        rate_track(
            &mut clip,
            &[(10.0, 0.5, Interp::Linear), (12.0, 2.0, Interp::Linear)],
        );

        assert_eq!(
            clip.source_time_at(Time::from_seconds(10.0)).unwrap(),
            clip.in_point
        );
        let at = clip.source_time_at(Time::from_seconds(11.0)).unwrap();
        assert!(
            (at.as_seconds() - 4.875).abs() < 1e-6,
            "{}",
            at.as_seconds()
        );
    }

    // The two axes the brief says must cross somewhere: a ramp *and* reverse. Backwards, the clip
    // reads `consumed - area`, so it opens on the far end of a range whose size the ramp itself
    // decided -- and a constant-rate mapping would put the same instant somewhere else entirely.
    #[test]
    fn a_reversed_ramp_reads_the_same_area_backwards_from_the_out_point() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.reverse = true;
        rate_track(
            &mut clip,
            &[(0.0, 0.5, Interp::Linear), (2.0, 2.0, Interp::Linear)],
        );

        assert_eq!(clip.out_point(), clip.in_point + clip.consumed_source());
        let head = clip.source_time_at(Time::ZERO).unwrap();
        assert_eq!(head, clip.out_point());
        let mid = clip.source_time_at(Time::from_seconds(1.0)).unwrap();
        assert!(
            (mid.as_seconds() - (12.5 - 0.875)).abs() < 1e-6,
            "{}",
            mid.as_seconds()
        );
    }

    // The clamp the brief names, now that the size of the consumed range is the ramp's own doing.
    // Nothing else in the model would notice if the head fell a flick past the end.
    #[test]
    fn a_reversed_ramp_still_hands_the_decoder_a_time_inside_the_range() {
        let mut clip = media_clip(0.0, 2.0);
        clip.in_point = Time::from_seconds(10.0);
        clip.speed.reverse = true;
        rate_track(
            &mut clip,
            &[(0.0, 3.0, Interp::Ease), (2.0, 0.25, Interp::Linear)],
        );

        for step in 0..40 {
            let t = Time::from_seconds(step as f64 * 0.05);
            let at = clip.readable_source_time_at(t).unwrap();
            assert!(
                at >= clip.in_point && at < clip.out_point(),
                "{at:?} at step {step}"
            );
        }
    }

    // A frame hold is a rate of zero, and nothing else: no second kind of clip, no still-image
    // generator, no branch anywhere downstream. The first half runs, the second half stands.
    #[test]
    fn a_rate_of_zero_holds_the_frame_it_was_last_shown() {
        let mut clip = media_clip(0.0, 4.0);
        clip.in_point = Time::from_seconds(5.0);
        rate_track(
            &mut clip,
            &[(0.0, 1.0, Interp::Hold), (2.0, 0.0, Interp::Hold)],
        );

        assert_eq!(
            clip.source_time_at(Time::from_seconds(1.0))
                .unwrap()
                .as_seconds(),
            6.0
        );
        let frozen = clip.source_time_at(Time::from_seconds(2.0)).unwrap();
        for seconds in [2.0, 2.5, 3.0, 3.999] {
            assert_eq!(
                clip.source_time_at(Time::from_seconds(seconds)).unwrap(),
                frozen
            );
        }
        assert_eq!(clip.consumed_source().as_seconds(), 2.0);
    }

    // Rate never goes negative, so source time never walks backwards inside a forward clip. A sign
    // error in `span_area` would show here and nowhere in the totals.
    #[test]
    fn source_time_never_walks_backwards_under_a_ramp() {
        let mut clip = media_clip(0.0, 4.0);
        rate_track(
            &mut clip,
            &[
                (0.0, 2.0, Interp::Linear),
                (1.0, 0.0, Interp::Ease),
                (2.5, 4.0, Interp::Hold),
                (4.0, 1.0, Interp::Linear),
            ],
        );
        let mut last = Time::ZERO;
        for step in 0..80 {
            let at = clip
                .source_time_at(Time::from_seconds(step as f64 * 0.05))
                .unwrap();
            assert!(
                at >= last,
                "went backwards at step {step}: {at:?} after {last:?}"
            );
            last = at;
        }
    }

    // Forward compatibility, and the mirror of the transform rule: a rate track this build cannot
    // integrate leaves the clip running at its static rate rather than stopping dead.
    #[test]
    fn a_rate_track_this_build_cannot_integrate_falls_back_to_the_static_rate() {
        let mut clip = media_clip(0.0, 2.0);
        clip.speed.rate = 2.0;
        rate_track(
            &mut clip,
            &[(0.0, 0.5, Interp::Bezier), (2.0, 0.5, Interp::Linear)],
        );
        assert_eq!(clip.consumed_source().as_seconds(), 4.0);

        clip.keyframes.insert(SPEED_TRACK.into(), Vec::new());
        assert_eq!(clip.consumed_source().as_seconds(), 4.0);
    }

    // A rate track moves no geometry, and a transform track consumes no source. They share a map and
    // must share nothing else.
    #[test]
    fn a_rate_track_leaves_the_geometry_alone_and_a_transform_track_leaves_the_rate_alone() {
        let mut clip = media_clip(0.0, 2.0);
        rate_track(
            &mut clip,
            &[(0.0, 0.5, Interp::Linear), (2.0, 2.0, Interp::Linear)],
        );
        assert_eq!(clip.transform_at(Time::from_seconds(1.0)), clip.transform);

        let mut other = media_clip(0.0, 2.0);
        ramp(&mut other, "scaleX", 1.0, 4.0, 2.0);
        assert_eq!(other.consumed_source().as_seconds(), 2.0);
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
