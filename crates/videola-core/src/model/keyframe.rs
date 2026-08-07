use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: Time,
    pub value: ParamValue,
    pub interp: Interp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_in: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_out: Option<[f32; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum Interp {
    Linear,
    Hold,
    Ease,
    Bezier,
}

// Keyframe tracks are deserialised straight from untrusted project JSON, so they can arrive
// out of order. Sort with `sort_track` (or `Project::normalize`) at the trust boundary before
// evaluating — this function's binary search assumes `track` is already sorted by `time`.
pub fn evaluate(track: &[Keyframe], at: Time) -> Option<ParamValue> {
    let first = track.first()?;
    let last = track.last()?;
    if at <= first.time {
        return Some(first.value.clone());
    }
    if at >= last.time {
        return Some(last.value.clone());
    }
    let right_index = track.partition_point(|kf| kf.time <= at);
    let left = &track[right_index - 1];
    let right = &track[right_index];
    Some(interpolate(left, right, at))
}

pub fn sort_track(track: &mut [Keyframe]) {
    track.sort_by_key(|kf| kf.time);
}

fn interpolate(left: &Keyframe, right: &Keyframe, at: Time) -> ParamValue {
    if left.interp == Interp::Hold {
        return left.value.clone();
    }
    let span = (right.time - left.time).as_flicks();
    if span <= 0 {
        return left.value.clone();
    }
    let linear = (at - left.time).as_flicks() as f32 / span as f32;
    let eased = ease(left, right, linear);
    left.value
        .lerp(&right.value, eased)
        .unwrap_or_else(|| left.value.clone())
}

fn ease(left: &Keyframe, right: &Keyframe, t: f32) -> f32 {
    match left.interp {
        Interp::Hold | Interp::Linear => t,
        Interp::Ease => t * t * (3.0 - 2.0 * t),
        Interp::Bezier => {
            let out = left.handle_out.unwrap_or([0.42, 0.0]);
            let in_ = right.handle_in.unwrap_or([0.58, 1.0]);
            cubic_bezier_y_at(out, in_, t)
        }
    }
}

// ponytail: 24 bisection steps instead of Newton iteration — enough for sub-pixel accuracy;
// switch to Newton if keyframe evaluation ever shows up in a profile.
fn cubic_bezier_y_at(p1: [f32; 2], p2: [f32; 2], x: f32) -> f32 {
    let mut low = 0.0f32;
    let mut high = 1.0f32;
    let mut t = x;
    for _ in 0..24 {
        let current = bezier_component(p1[0], p2[0], t);
        if current < x {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) * 0.5;
    }
    bezier_component(p1[1], p2[1], t)
}

fn bezier_component(c1: f32, c2: f32, t: f32) -> f32 {
    let u = 1.0 - t;
    3.0 * u * u * t * c1 + 3.0 * u * t * t * c2 + t * t * t
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ParamValue;

    fn kf(seconds: f64, value: f32, interp: Interp) -> Keyframe {
        Keyframe {
            time: Time::from_seconds(seconds),
            value: ParamValue::Float(value),
            interp,
            handle_in: None,
            handle_out: None,
        }
    }

    #[test]
    fn empty_track_evaluates_to_nothing() {
        assert_eq!(evaluate(&[], Time::ZERO), None);
    }

    #[test]
    fn before_first_and_after_last_are_clamped() {
        let track = vec![kf(1.0, 10.0, Interp::Linear), kf(3.0, 30.0, Interp::Linear)];
        assert_eq!(evaluate(&track, Time::ZERO), Some(ParamValue::Float(10.0)));
        assert_eq!(
            evaluate(&track, Time::from_seconds(9.0)),
            Some(ParamValue::Float(30.0))
        );
    }

    #[test]
    fn linear_interpolates_between_neighbours() {
        let track = vec![kf(0.0, 0.0, Interp::Linear), kf(2.0, 100.0, Interp::Linear)];
        assert_eq!(
            evaluate(&track, Time::from_seconds(1.0)),
            Some(ParamValue::Float(50.0))
        );
    }

    #[test]
    fn hold_keeps_the_left_value_until_the_next_key() {
        let track = vec![kf(0.0, 0.0, Interp::Hold), kf(2.0, 100.0, Interp::Linear)];
        assert_eq!(
            evaluate(&track, Time::from_seconds(1.9)),
            Some(ParamValue::Float(0.0))
        );
        assert_eq!(
            evaluate(&track, Time::from_seconds(2.0)),
            Some(ParamValue::Float(100.0))
        );
    }

    #[test]
    fn ease_is_slower_at_the_start_than_linear() {
        let track = vec![kf(0.0, 0.0, Interp::Ease), kf(2.0, 100.0, Interp::Linear)];
        let Some(ParamValue::Float(v)) = evaluate(&track, Time::from_seconds(0.5)) else {
            panic!("expected a float");
        };
        assert!(v < 25.0, "ease should lag linear at t=0.25, got {v}");
    }

    #[test]
    fn bezier_hits_both_endpoints_exactly() {
        let mut a = kf(0.0, 0.0, Interp::Bezier);
        a.handle_out = Some([0.42, 0.0]);
        let mut b = kf(2.0, 100.0, Interp::Linear);
        b.handle_in = Some([0.58, 1.0]);
        let track = vec![a, b];
        assert_eq!(evaluate(&track, Time::ZERO), Some(ParamValue::Float(0.0)));
        assert_eq!(
            evaluate(&track, Time::from_seconds(2.0)),
            Some(ParamValue::Float(100.0))
        );

        let Some(ParamValue::Float(mid)) = evaluate(&track, Time::from_seconds(0.5)) else {
            panic!("expected a float");
        };
        assert!(
            mid > 0.0 && mid < 100.0,
            "expected mid-span value, got {mid}"
        );
        assert!(
            mid < 25.0,
            "ease-in-out should lag linear at t=0.25, got {mid}"
        );
    }

    #[test]
    fn discrete_values_hold_even_on_linear_keys() {
        let track = vec![
            Keyframe {
                time: Time::ZERO,
                value: ParamValue::Bool(false),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
            Keyframe {
                time: Time::from_seconds(2.0),
                value: ParamValue::Bool(true),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            },
        ];
        assert_eq!(
            evaluate(&track, Time::from_seconds(1.0)),
            Some(ParamValue::Bool(false))
        );
    }
}
