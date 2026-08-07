use serde_json::Value;

use super::LoadWarning;
use crate::model::{Project, SCHEMA_VERSION};
use crate::{CoreError, Result};

pub fn load(raw: &str) -> Result<(Project, Vec<LoadWarning>)> {
    let mut document: Value =
        serde_json::from_str(raw).map_err(|error| CoreError::NotAProject(error.to_string()))?;
    let found = detect_version(&document)?;
    if found > u64::from(SCHEMA_VERSION) {
        return Err(CoreError::UnsupportedSchema(found));
    }
    // Safe: bounded by SCHEMA_VERSION (a u32) just above, so this never truncates.
    let found = found as u32;
    let warnings = upgrade(&mut document, found);
    // Migration runs on the JSON tree, before deserialisation: it can rename or restructure
    // fields without keeping an old struct definition around for every past schema version.
    let mut project: Project = serde_json::from_value(document)
        .map_err(|error| CoreError::NotAProject(error.to_string()))?;
    // The deserialisation boundary: sorts every keyframe track (evaluate's binary search
    // assumes sorted-by-time) and bound-checks every Time field, including nested compound
    // timelines. Fallible, so a project with impossible times fails loudly here instead of
    // reaching Clip::end() unchecked.
    project.normalize()?;
    Ok((project, warnings))
}

// `None` (the key is absent) and `Some` of a non-integer are different failure modes: an old
// file that never had a schemaVersion field is genuinely version 1, but a present value that
// isn't a plain non-negative integer (a float, a string, a number too large for i64) is not a
// version this loader understands and must not be silently coerced into one.
fn detect_version(document: &Value) -> Result<u64> {
    match document.get("schemaVersion") {
        None => Ok(1),
        Some(value) => value.as_u64().ok_or_else(|| {
            CoreError::NotAProject("schemaVersion must be a non-negative integer".into())
        }),
    }
}

fn upgrade(document: &mut Value, from: u32) -> Vec<LoadWarning> {
    if let Some(object) = document.as_object_mut() {
        object.insert("schemaVersion".into(), Value::from(SCHEMA_VERSION));
    }
    if from == SCHEMA_VERSION {
        return Vec::new();
    }
    vec![LoadWarning::Migrated {
        from,
        to: SCHEMA_VERSION,
    }]
}
