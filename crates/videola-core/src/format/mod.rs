pub mod hash;
pub mod migrate;
pub mod reader;
pub mod writer;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::MediaId;
use crate::{CoreError, Result};

pub use reader::{LoadWarning, LoadedProject};

pub const MANIFEST_ENTRY: &str = "videola.json";
pub const PROJECT_ENTRY: &str = "project.json";
pub const MEDIA_PREFIX: &str = "media/";
// A `.videolat` is a `.videola` with this one extra entry. Reusing the container rather than
// inventing a second one means the size caps, the content-addressed media naming, the manifest
// and the migration path are already written and already tested — and a template that outgrows
// "no media of its own" needs no new format to carry it.
pub const TEMPLATE_ENTRY: &str = "template.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema_version: u32,
    pub app_version: String,
    pub project_id: String,
    pub title: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
}

#[cfg(test)]
impl SaveOptions {
    fn for_test() -> Self {
        Self {
            app_version: "0.0.0".into(),
            created: "2026-08-07T10:00:00Z".into(),
            modified: "2026-08-07T10:00:00Z".into(),
            locale: "de".into(),
        }
    }
}

pub trait MediaStore {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>>;
}

#[derive(Debug, Default)]
pub struct MemoryMediaStore {
    entries: BTreeMap<MediaId, Vec<u8>>,
}

impl MemoryMediaStore {
    pub fn insert(&mut self, id: MediaId, bytes: Vec<u8>) {
        self.entries.insert(id, bytes);
    }

    // A presence check that doesn't go through `read`: `read` clones the stored bytes, so using
    // it just to ask "is this id here" would allocate and immediately drop a copy of whatever is
    // stored — cheap for a thumbnail, a multi-hundred-MB liability for video.
    pub fn contains(&self, id: &MediaId) -> bool {
        self.entries.contains_key(id)
    }

    // Callers that want to hand bytes onward as an `Option` (no "not found" error to represent)
    // use this instead of the fallible `MediaStore::read` — no error path, nothing to swallow.
    pub fn get(&self, id: &MediaId) -> Option<&Vec<u8>> {
        self.entries.get(id)
    }
}

impl MediaStore for MemoryMediaStore {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>> {
        self.entries
            .get(id)
            .cloned()
            .ok_or_else(|| CoreError::MediaNotAvailable(id.clone()))
    }
}
