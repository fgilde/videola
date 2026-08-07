use std::collections::BTreeMap;
use std::io::{Read, Seek};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::ZipArchive;

use super::{Manifest, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project};
use crate::{CoreError, Result};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoadWarning {
    MissingMedia { media: MediaId },
    UnreadableEntry { name: String },
    Migrated { from: u32, to: u32 },
}

// ponytail: the reader keeps all media data in memory. Fine for M0 and test-sized projects;
// from M1 on, switch to streaming extraction into host storage (OPFS or filesystem) —
// LoadedProject.media then becomes an iterator.
#[derive(Debug)]
pub struct LoadedProject {
    pub manifest: Manifest,
    pub project: Project,
    pub media: BTreeMap<MediaId, Vec<u8>>,
    pub warnings: Vec<LoadWarning>,
}

pub fn read<R: Read + Seek>(source: R) -> Result<LoadedProject> {
    let mut archive =
        ZipArchive::new(source).map_err(|error| CoreError::NotAProject(error.to_string()))?;

    let raw_project = read_entry_to_string(&mut archive, PROJECT_ENTRY)?;
    let manifest = read_manifest(&mut archive)?;
    let (project, mut warnings) = super::migrate::load(&raw_project)?;
    let media = read_media(&mut archive);

    warnings.extend(missing_media(&project, &media));
    Ok(LoadedProject {
        manifest,
        project,
        media,
        warnings,
    })
}

fn read_manifest<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Manifest> {
    let raw = read_entry_to_string(archive, MANIFEST_ENTRY)?;
    Ok(serde_json::from_str(&raw)?)
}

fn read_entry_to_string<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str) -> Result<String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| CoreError::NotAProject(format!("missing entry: {name}")))?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw)?;
    Ok(raw)
}

fn read_media<R: Read + Seek>(archive: &mut ZipArchive<R>) -> BTreeMap<MediaId, Vec<u8>> {
    let names: Vec<String> = (0..archive.len())
        .filter_map(|index| archive.by_index(index).ok().map(|e| e.name().to_string()))
        .filter(|name| name.starts_with(MEDIA_PREFIX) && !name.ends_with('/'))
        .collect();

    names
        .into_iter()
        .filter_map(|name| {
            let id = media_id_from_entry(&name)?;
            let mut bytes = Vec::new();
            archive.by_name(&name).ok()?.read_to_end(&mut bytes).ok()?;
            Some((id, bytes))
        })
        .collect()
}

fn media_id_from_entry(name: &str) -> Option<MediaId> {
    let file = name.strip_prefix(MEDIA_PREFIX)?;
    let stem = file.split('.').next()?;
    if stem.is_empty() {
        return None;
    }
    Some(MediaId::from(format!("med_{stem}")))
}

fn missing_media(project: &Project, media: &BTreeMap<MediaId, Vec<u8>>) -> Vec<LoadWarning> {
    project
        .library
        .iter()
        .filter(|asset| !media.contains_key(&asset.id))
        .map(|asset| LoadWarning::MissingMedia {
            media: asset.id.clone(),
        })
        .collect()
}
