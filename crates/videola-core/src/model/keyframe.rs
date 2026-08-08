use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

// A motion path, on the same track machinery `evaluate` runs on. The one difference is where the
// curve comes from: a segment is shaped by the keys on either side of it as well, which is the whole
// distinction between a path and two independent tracks on `x` and `y` -- those interpolate value
// against time and can only ever produce a corner where two segments meet.
//
// Timing along the segment stays `ease`, so a key's `interp` keeps its single meaning (how fast, not
// where) and the export cannot time a path differently from the preview.
//
// Two points come out exactly straight: the virtual key beyond an end is the neighbour mirrored
// through it, which makes the end tangent the chord itself. Without that mirror a two-point path
// would bulge, and a path would stop being a superset of a pair of `x`/`y` tracks.
pub fn evaluate_path(track: &[Keyframe], at: Time) -> Option<[f32; 2]> {
    let point = |index: usize| match track.get(index)?.value {
        ParamValue::Vec2(components) => Some(components),
        _ => None,
    };
    let last_index = track.len().checked_sub(1)?;
    if at <= track[0].time {
        return point(0);
    }
    if at >= track[last_index].time {
        return point(last_index);
    }
    let right = track.partition_point(|kf| kf.time <= at);
    let left = right - 1;
    let (before, after) = (&track[left], &track[right]);
    let (p1, p2) = (point(left)?, point(right)?);
    let span = (after.time - before.time).as_flicks();
    if span <= 0 || before.interp == Interp::Hold {
        return Some(p1);
    }
    let t = ease(before, after, (at - before.time).as_flicks() as f32 / span as f32);
    let p0 = if left == 0 { mirror(p1, p2) } else { point(left - 1)? };
    let p3 = if right == last_index {
        mirror(p2, p1)
    } else {
        point(right + 1)?
    };
    Some(catmull_rom(p0, p1, p2, p3, t))
}

fn mirror(through: [f32; 2], point: [f32; 2]) -> [f32; 2] {
    [2.0 * through[0] - point[0], 2.0 * through[1] - point[1]]
}

// ponytail: uniform parameterisation, so keys that are far apart in space but close in time pull
// the curve into an overshoot. Centripetal Catmull-Rom takes the same four points and divides by
// the chord lengths; swap it in here if a path ever visibly loops past a key.
fn catmull_rom(p0: [f32; 2], p1: [f32; 2], p2: [f32; 2], p3: [f32; 2], t: f32) -> [f32; 2] {
    let axis = |a: f32, b: f32, c: f32, d: f32| {
        let (square, cube) = (t * t, t * t * t);
        let tangent_in = (c - a) * 0.5;
        let tangent_out = (d - b) * 0.5;
        (2.0 * cube - 3.0 * square + 1.0) * b
            + (cube - 2.0 * square + t) * tangent_in
            + (-2.0 * cube + 3.0 * square) * c
            + (cube - square) * tangent_out
    };
    [
        axis(p0[0], p1[0], p2[0], p3[0]),
        axis(p0[1], p1[1], p2[1], p3[1]),
    ]
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

    fn at(seconds: f64, x: f32, y: f32) -> Keyframe {
        Keyframe {
            time: Time::from_seconds(seconds),
            value: ParamValue::Vec2([x, y]),
            interp: Interp::Linear,
            handle_in: None,
            handle_out: None,
        }
    }

    // The claim that makes a path a superset of a pair of `x`/`y` tracks rather than a rival to
    // them. A quarter of the way along is a quarter of the chord, not merely somewhere between the
    // ends -- the mirrored virtual key is the only reason, and without it this reads 0.203.
    #[test]
    fn a_path_of_two_points_is_exactly_the_straight_line_between_them() {
        let track = vec![at(0.0, 0.0, 0.0), at(4.0, 100.0, 40.0)];
        assert_eq!(
            evaluate_path(&track, Time::from_seconds(1.0)),
            Some([25.0, 10.0])
        );
        assert_eq!(
            evaluate_path(&track, Time::from_seconds(3.0)),
            Some([75.0, 30.0])
        );
    }

    // And the claim that it is a curve rather than a polyline: a third key changes the *first*
    // segment, which is exactly what independent `x`/`y` tracks cannot do. Both runs share the
    // same two opening keys, so the difference is the neighbour and nothing else.
    //
    // Which way it bends is not the claim. Uniform Catmull-Rom leans away from the coming corner
    // before it turns into it, so a run that pinned the sign would be pinning the parameterisation
    // rather than the curve.
    #[test]
    fn a_third_key_bends_the_segment_before_it() {
        let straight = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 0.0)];
        let bent = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 0.0), at(4.0, 100.0, 100.0)];
        let half = Time::from_seconds(1.0);

        assert_eq!(evaluate_path(&straight, half), Some([50.0, 0.0]));
        let Some([x, y]) = evaluate_path(&bent, half) else {
            panic!("expected a point");
        };
        assert!(y.abs() > 1.0, "the third key left the segment straight, y={y}");
        assert!((0.0..=100.0).contains(&x), "x ran off the path, x={x}");
    }

    #[test]
    fn a_path_hits_every_key_it_is_built_from() {
        let track = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 0.0), at(4.0, 100.0, 100.0)];
        for (seconds, want) in [(0.0, [0.0, 0.0]), (2.0, [100.0, 0.0]), (4.0, [100.0, 100.0])] {
            assert_eq!(evaluate_path(&track, Time::from_seconds(seconds)), Some(want));
        }
    }

    #[test]
    fn a_path_clamps_to_its_ends_outside_its_span() {
        let track = vec![at(1.0, 10.0, 20.0), at(3.0, 30.0, 40.0)];
        assert_eq!(evaluate_path(&track, Time::ZERO), Some([10.0, 20.0]));
        assert_eq!(
            evaluate_path(&track, Time::from_seconds(9.0)),
            Some([30.0, 40.0])
        );
    }

    // `interp` times the travel and nothing else, so `Hold` parks the clip on the key it left --
    // the same rule a scalar track follows, and the reason a path needs no notion of its own.
    #[test]
    fn a_held_key_parks_the_clip_until_the_next_one() {
        let mut track = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 100.0)];
        track[0].interp = Interp::Hold;
        assert_eq!(
            evaluate_path(&track, Time::from_seconds(1.9)),
            Some([0.0, 0.0])
        );
    }

    #[test]
    fn easing_along_a_path_lags_a_linear_run() {
        let mut track = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 0.0)];
        track[0].interp = Interp::Ease;
        let Some([x, _]) = evaluate_path(&track, Time::from_seconds(0.5)) else {
            panic!("expected a point");
        };
        assert!(x < 25.0, "ease should lag linear at a quarter, got {x}");
    }

    #[test]
    fn an_empty_path_evaluates_to_nothing() {
        assert_eq!(evaluate_path(&[], Time::ZERO), None);
    }

    // A hand-authored project can put a float on the path track. Taking it as one component of a
    // position would place the clip somewhere nobody asked for; there is no position to report.
    #[test]
    fn a_path_key_that_is_not_a_point_evaluates_to_nothing() {
        let mut track = vec![at(0.0, 0.0, 0.0), at(2.0, 100.0, 100.0)];
        track[1].value = ParamValue::Float(5.0);
        assert_eq!(evaluate_path(&track, Time::from_seconds(1.0)), None);
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
