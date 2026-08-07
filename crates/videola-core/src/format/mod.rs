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

#[derive(Debug, Clone)]
pub struct SaveOptions {
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
    pub slim: bool,
}

#[cfg(test)]
impl SaveOptions {
    fn for_test() -> Self {
        Self {
            app_version: "0.0.0".into(),
            created: "2026-08-07T10:00:00Z".into(),
            modified: "2026-08-07T10:00:00Z".into(),
            locale: "de".into(),
            slim: true,
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

    pub fn take(self) -> BTreeMap<MediaId, Vec<u8>> {
        self.entries
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
