use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::keyframe::{evaluate, Keyframe};
use super::{EffectId, ParamValue, Time};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: EffectId,
    pub effect_type: String,
    pub enabled: bool,
    #[serde(default)]
    pub params: BTreeMap<String, ParamValue>,
    #[serde(default)]
    pub keyframes: BTreeMap<String, Vec<Keyframe>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Effect {
    pub fn new(effect_type: &str) -> Self {
        Self {
            id: EffectId::new(),
            effect_type: effect_type.to_string(),
            enabled: true,
            params: BTreeMap::new(),
            keyframes: BTreeMap::new(),
            extra: Map::new(),
        }
    }

    pub fn static_param(&self, key: &str) -> Option<&ParamValue> {
        self.params.get(key)
    }

    pub fn param_at(&self, key: &str, at: Time) -> Option<ParamValue> {
        match self.keyframes.get(key) {
            Some(track) if !track.is_empty() => evaluate(track, at),
            _ => self.params.get(key).cloned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub transition_type: String,
    pub duration: Time,
    pub alignment: TransitionAlignment,
    #[serde(default)]
    pub params: BTreeMap<String, ParamValue>,
}

impl Transition {
    pub fn new(transition_type: &str, duration: Time) -> Self {
        Self {
            transition_type: transition_type.to_string(),
            duration,
            alignment: TransitionAlignment::Center,
            params: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TransitionAlignment {
    Center,
    In,
    Out,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Interp, ParamValue};

    #[test]
    fn a_new_effect_is_enabled_and_empty() {
        let effect = Effect::new("brightness");
        assert!(effect.enabled);
        assert!(effect.params.is_empty());
        assert!(effect.id.as_str().starts_with("eff_"));
    }

    #[test]
    fn static_params_are_returned_as_is() {
        let mut effect = Effect::new("brightness");
        effect
            .params
            .insert("amount".into(), ParamValue::Float(0.5));
        assert_eq!(
            effect.param_at("amount", Time::ZERO),
            Some(ParamValue::Float(0.5))
        );
    }

    #[test]
    fn keyframed_params_win_over_static_ones() {
        let mut effect = Effect::new("brightness");
        effect
            .params
            .insert("amount".into(), ParamValue::Float(0.5));
        effect.keyframes.insert(
            "amount".into(),
            vec![
                Keyframe {
                    time: Time::ZERO,
                    value: ParamValue::Float(0.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
                Keyframe {
                    time: Time::from_seconds(2.0),
                    value: ParamValue::Float(1.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
            ],
        );
        assert_eq!(
            effect.param_at("amount", Time::from_seconds(1.0)),
            Some(ParamValue::Float(0.5))
        );
    }

    #[test]
    fn unknown_params_are_none() {
        assert_eq!(Effect::new("brightness").param_at("nope", Time::ZERO), None);
    }

    #[test]
    fn transitions_default_to_centre_alignment() {
        let t = Transition::new("crossfade", Time::from_seconds(1.0));
        assert_eq!(t.alignment, TransitionAlignment::Center);
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let effect = Effect::new("brightness");
        let mut json = serde_json::to_value(&effect).unwrap();
        json.as_object_mut()
            .unwrap()
            .insert("futureField".into(), serde_json::json!({"keep": "me"}));
        let back: Effect = serde_json::from_value(json).unwrap();
        let out = serde_json::to_value(&back).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }
}
