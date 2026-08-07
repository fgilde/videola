use serde_json::Value;

use super::LoadWarning;
use crate::model::{Project, SCHEMA_VERSION};
use crate::{CoreError, Result};

pub fn load(raw: &str) -> Result<(Project, Vec<LoadWarning>)> {
    let mut document: Value = serde_json::from_str(raw)?;
    let found = detect_version(&document);
    if found > SCHEMA_VERSION {
        return Err(CoreError::UnsupportedSchema(found));
    }
    let warnings = upgrade(&mut document, found);
    let mut project: Project = serde_json::from_value(document)?;
    project.normalize()?;
    Ok((project, warnings))
}

fn detect_version(document: &Value) -> u32 {
    document
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .map(|version| version as u32)
        .unwrap_or(1)
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
