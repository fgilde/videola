// stub — implemented in Task 11

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::Manifest;
use crate::model::{MediaId, Project};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoadWarning {
    MissingMedia { media: MediaId },
    UnreadableEntry { name: String },
    Migrated { from: u32, to: u32 },
}

#[derive(Debug)]
pub struct LoadedProject {
    pub manifest: Manifest,
    pub project: Project,
    pub media: BTreeMap<MediaId, Vec<u8>>,
    pub warnings: Vec<LoadWarning>,
}
