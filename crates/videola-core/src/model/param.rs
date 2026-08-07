use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ParamValue {
    Float(f32),
    Int(i64),
    Bool(bool),
    Color([f32; 4]),
    Vec2([f32; 2]),
    Choice(String),
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
}
