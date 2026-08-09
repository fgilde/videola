use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ParamValue {
    Float(f32),
    Int(i64),
    Bool(bool),
    Color([f32; 4]),
    Vec2([f32; 2]),
    Choice(String),
    /// A tone curve, as the control points a person drags: `[input, output]` pairs, both in 0..1,
    /// x ascending. The renderer samples them; what is stored is what the editor put on screen, so
    /// a curve that has been keyframed can still be picked up and moved afterwards.
    ///
    /// Deliberately not the sampled table the shader wants. A table is derivable from the points
    /// and the points are not derivable from a table, and a keyframe between two tables is not a
    /// keyframe between two curves -- it is a keyframe between two of their shadows.
    Curve(Vec<[f32; 2]>),
}

impl ParamValue {
    pub fn lerp(&self, other: &Self, t: f32) -> Option<Self> {
        match (self, other) {
            (Self::Float(a), Self::Float(b)) => Some(Self::Float(mix(*a, *b, t))),
            (Self::Vec2(a), Self::Vec2(b)) => {
                Some(Self::Vec2([mix(a[0], b[0], t), mix(a[1], b[1], t)]))
            }
            (Self::Color(a), Self::Color(b)) => Some(Self::Color([
                mix(a[0], b[0], t),
                mix(a[1], b[1], t),
                mix(a[2], b[2], t),
                mix(a[3], b[3], t),
            ])),
            // Point for point, which is the only reading of "halfway between two curves" that is
            // still a curve. Two curves with different point counts have no pairing at all, and
            // guessing one -- resampling the shorter onto the longer -- would make the midpoint
            // depend on which of the two was authored first.
            (Self::Curve(a), Self::Curve(b)) if a.len() == b.len() => Some(Self::Curve(
                a.iter()
                    .zip(b)
                    .map(|(p, q)| [mix(p[0], q[0], t), mix(p[1], q[1], t)])
                    .collect(),
            )),
            _ => None,
        }
    }
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floats_interpolate() {
        let a = ParamValue::Float(0.0);
        let b = ParamValue::Float(10.0);
        assert_eq!(a.lerp(&b, 0.25), Some(ParamValue::Float(2.5)));
    }

    #[test]
    fn colors_interpolate_per_channel() {
        let a = ParamValue::Color([0.0, 0.0, 0.0, 1.0]);
        let b = ParamValue::Color([1.0, 0.5, 0.0, 1.0]);
        assert_eq!(
            a.lerp(&b, 0.5),
            Some(ParamValue::Color([0.5, 0.25, 0.0, 1.0]))
        );
    }

    #[test]
    fn discrete_values_do_not_interpolate() {
        let a = ParamValue::Bool(false);
        let b = ParamValue::Bool(true);
        assert_eq!(a.lerp(&b, 0.5), None);

        let c = ParamValue::Choice("linear".into());
        let d = ParamValue::Choice("radial".into());
        assert_eq!(c.lerp(&d, 0.5), None);
    }

    #[test]
    fn mismatched_kinds_do_not_interpolate() {
        assert_eq!(ParamValue::Float(1.0).lerp(&ParamValue::Int(2), 0.5), None);
    }

    #[test]
    fn ints_do_not_interpolate() {
        assert_eq!(ParamValue::Int(1).lerp(&ParamValue::Int(2), 0.5), None);
    }

    #[test]
    fn vec2_interpolates_per_component() {
        let a = ParamValue::Vec2([0.0, 10.0]);
        let b = ParamValue::Vec2([10.0, 0.0]);
        assert_eq!(a.lerp(&b, 0.5), Some(ParamValue::Vec2([5.0, 5.0])));
    }

    #[test]
    fn curves_interpolate_point_by_point() {
        let flat = ParamValue::Curve(vec![[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]]);
        let lifted = ParamValue::Curve(vec![[0.0, 0.0], [0.5, 0.9], [1.0, 1.0]]);
        assert_eq!(
            flat.lerp(&lifted, 0.5),
            Some(ParamValue::Curve(vec![[0.0, 0.0], [0.5, 0.7], [1.0, 1.0]]))
        );
    }

    // Both components move, not only the output: a keyframe that drags a control point sideways
    // moves the tone it acts on, and lerping y alone would leave the knee standing still.
    #[test]
    fn a_curve_keyframe_moves_the_point_along_both_axes() {
        let left = ParamValue::Curve(vec![[0.25, 0.25]]);
        let right = ParamValue::Curve(vec![[0.75, 0.5]]);
        assert_eq!(
            left.lerp(&right, 0.5),
            Some(ParamValue::Curve(vec![[0.5, 0.375]]))
        );
    }

    // No pairing exists, so there is no midpoint. `interpolate` turns this into a hold on the left
    // key, which is the same answer a bool or a choice gets.
    #[test]
    fn curves_of_different_lengths_do_not_interpolate() {
        let two = ParamValue::Curve(vec![[0.0, 0.0], [1.0, 1.0]]);
        let three = ParamValue::Curve(vec![[0.0, 0.0], [0.5, 0.6], [1.0, 1.0]]);
        assert_eq!(two.lerp(&three, 0.5), None);
    }
}
