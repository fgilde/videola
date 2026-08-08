use std::fmt;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident, $prefix:literal) => {
        #[derive(
            Debug,
            Clone,
            PartialEq,
            Eq,
            PartialOrd,
            Ord,
            Hash,
            Serialize,
            Deserialize,
            TS,
            JsonSchema,
        )]
        #[serde(transparent)]
        #[ts(type = "string")]
        #[schemars(description = concat!("Id of the form `", $prefix, "_<hex>`."))]
        pub struct $name(String);

        impl $name {
            pub fn new() -> Self {
                Self(format!("{}_{}", $prefix, Uuid::new_v4().simple()))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(ProjectId, "prj");
id_type!(TrackId, "trk");
id_type!(ClipId, "clp");
id_type!(EffectId, "eff");
id_type!(MarkerId, "mrk");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_ids_are_unique_and_prefixed() {
        let a = TrackId::new();
        let b = TrackId::new();
        assert_ne!(a, b);
        assert!(a.as_str().starts_with("trk_"));
    }

    #[test]
    fn ids_serialise_as_bare_strings() {
        let id = ClipId::from("clp_abc".to_string());
        assert_eq!(serde_json::to_string(&id).unwrap(), "\"clp_abc\"");
    }
}
