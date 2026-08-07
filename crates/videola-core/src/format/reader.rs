use std::collections::BTreeMap;
use std::io::{Read, Seek};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::ZipArchive;

use super::{Manifest, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project};
use crate::{CoreError, Result};

// Deflate's documented worst-case expansion is a bit over 1000:1 (RFC 1951, an all-zero input).
// No legitimate H.264/AAC/JPEG asset gets remotely close to this cap once its declared size is
// checked before a single byte is decompressed — it exists to bound memory against a forged
// header, not to model real asset sizes.
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024 * 1024;

// Bounds how much a single `read` call can commit to `LoadedProject.media` in total, independent
// of how many individual entries (each already under MAX_ENTRY_BYTES) add up to it.
const MAX_TOTAL_MEDIA_BYTES: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoadWarning {
    MissingMedia { media: MediaId },
    UnreadableEntry { name: String },
    Migrated { from: u32, to: u32 },
    ManifestMismatch { field: String },
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

    let raw_project = read_required_entry(&mut archive, PROJECT_ENTRY)?;
    let manifest = read_manifest(&mut archive)?;
    let (project, mut warnings) = super::migrate::load(&raw_project)?;
    let (media, media_warnings) = read_media(&mut archive)?;

    warnings.extend(media_warnings);
    warnings.extend(missing_media(&project, &media));
    warnings.extend(manifest_mismatches(&manifest, &project));

    Ok(LoadedProject {
        manifest,
        project,
        media,
        warnings,
    })
}

fn read_manifest<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Manifest> {
    let raw = read_required_entry(archive, MANIFEST_ENTRY)?;
    serde_json::from_str(&raw).map_err(|error| CoreError::NotAProject(error.to_string()))
}

// A missing, oversized or unreadable *required* entry all mean the same thing to the caller:
// this archive is not a well-formed videola project. Fine-grained distinction between those
// three only matters for media entries (see read_media_entry), which degrade instead of aborting.
fn read_required_entry<R: Read + Seek>(archive: &mut ZipArchive<R>, name: &str) -> Result<String> {
    let bytes = read_entry_bytes(archive, name, MAX_ENTRY_BYTES)
        .map_err(|_| CoreError::NotAProject(format!("missing or invalid entry: {name}")))?;
    String::from_utf8(bytes).map_err(|error| CoreError::NotAProject(error.to_string()))
}

#[derive(Debug)]
enum EntryReadError {
    NotFound,
    TooLarge,
    // Every caller degrades any read failure the same way (a warning or NotAProject), so the
    // underlying io::Error carries no information anyone acts on differently — see
    // read_media_entry and read_required_entry.
    Io,
}

impl From<std::io::Error> for EntryReadError {
    fn from(_: std::io::Error) -> Self {
        EntryReadError::Io
    }
}

// The one place that turns a ZIP entry into bytes, so the size cap and the take() guard against
// a lying header only need to be written once and apply to the manifest, the project and every
// media entry alike.
fn read_entry_bytes<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    cap: u64,
) -> std::result::Result<Vec<u8>, EntryReadError> {
    let entry = archive
        .by_name(name)
        .map_err(|_| EntryReadError::NotFound)?;
    if entry.size() > cap {
        return Err(EntryReadError::TooLarge);
    }
    let mut bytes = Vec::new();
    entry.take(cap).read_to_end(&mut bytes)?;
    Ok(bytes)
}

enum MediaEntryOutcome {
    Loaded(MediaId, Vec<u8>),
    Warn(LoadWarning),
}

type MediaLoad = (BTreeMap<MediaId, Vec<u8>>, Vec<LoadWarning>);

fn read_media<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<MediaLoad> {
    let mut media = BTreeMap::new();
    let mut warnings = Vec::new();
    let mut total_bytes: u64 = 0;

    for name in media_entry_names(archive) {
        match read_media_entry(
            archive,
            &name,
            MAX_ENTRY_BYTES,
            MAX_TOTAL_MEDIA_BYTES,
            &mut total_bytes,
        )? {
            MediaEntryOutcome::Loaded(id, bytes) => {
                media.insert(id, bytes);
            }
            MediaEntryOutcome::Warn(warning) => warnings.push(warning),
        }
    }
    Ok((media, warnings))
}

fn media_entry_names<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Vec<String> {
    (0..archive.len())
        .filter_map(|index| {
            archive
                .by_index(index)
                .ok()
                .map(|entry| entry.name().to_string())
        })
        .filter(|name| name.starts_with(MEDIA_PREFIX) && !name.ends_with('/'))
        .collect()
}

// A corrupt-but-present media entry (bad name, decompression failure, forged content) degrades
// to a warning: the user relinks one asset instead of losing the whole project. Only a cap
// breach is a hard error — that one protects the process itself, not just this asset.
fn read_media_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    entry_cap: u64,
    total_cap: u64,
    total_bytes: &mut u64,
) -> Result<MediaEntryOutcome> {
    let Some(expected_id) = media_id_from_entry(name) else {
        return Ok(MediaEntryOutcome::Warn(unreadable(name)));
    };

    let bytes = match read_entry_bytes(archive, name, entry_cap) {
        Ok(bytes) => bytes,
        Err(EntryReadError::TooLarge) => {
            return Err(CoreError::Archive(format!(
                "media entry {name} exceeds the {entry_cap} byte cap"
            )))
        }
        Err(_) => return Ok(MediaEntryOutcome::Warn(unreadable(name))),
    };

    *total_bytes = total_bytes.saturating_add(bytes.len() as u64);
    if *total_bytes > total_cap {
        return Err(CoreError::Archive(format!(
            "media payload exceeds the {total_cap} byte aggregate cap"
        )));
    }

    // MediaId is content-addressed by definition; an entry whose bytes don't hash back to the
    // name they're filed under has been tampered with or corrupted, and the id in the name can
    // no longer be trusted to mean what it claims.
    if MediaId::from_bytes(&bytes) != expected_id {
        return Ok(MediaEntryOutcome::Warn(unreadable(name)));
    }

    Ok(MediaEntryOutcome::Loaded(expected_id, bytes))
}

fn unreadable(name: &str) -> LoadWarning {
    LoadWarning::UnreadableEntry {
        name: name.to_string(),
    }
}

fn media_id_from_entry(name: &str) -> Option<MediaId> {
    let file = name.strip_prefix(MEDIA_PREFIX)?;
    let stem = file.split('.').next().unwrap_or(file);
    if !is_content_hash(stem) {
        return None;
    }
    Some(MediaId::from(format!("med_{stem}")))
}

fn is_content_hash(stem: &str) -> bool {
    stem.len() == 64 && stem.bytes().all(|byte| byte.is_ascii_hexdigit())
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

// The manifest is a convenience copy of a few project fields for hosts that want them without
// parsing project.json; project.json (via migrate::load) stays the single source of truth. A
// mismatch means the two copies disagree, which the caller should know about rather than
// silently trusting whichever one it happens to read first.
fn manifest_mismatches(manifest: &Manifest, project: &Project) -> Vec<LoadWarning> {
    let mut mismatches = Vec::new();
    if manifest.schema_version != project.schema_version {
        mismatches.push(mismatch("schemaVersion"));
    }
    if manifest.title != project.meta.title {
        mismatches.push(mismatch("title"));
    }
    if manifest.project_id != project.meta.id.to_string() {
        mismatches.push(mismatch("projectId"));
    }
    mismatches
}

fn mismatch(field: &str) -> LoadWarning {
    LoadWarning::ManifestMismatch {
        field: field.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    fn tiny_archive(entry_name: &str, contents: &[u8]) -> Vec<u8> {
        let mut sink = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut sink);
            writer
                .start_file(entry_name, zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut writer, contents).unwrap();
            writer.finish().unwrap();
        }
        sink.into_inner()
    }

    #[test]
    fn an_entry_declaring_more_than_the_cap_is_rejected_before_it_is_read() {
        let bytes = tiny_archive("project.json", b"0123456789");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let result = read_entry_bytes(&mut archive, "project.json", 5);

        assert!(matches!(result, Err(EntryReadError::TooLarge)));
    }

    #[test]
    fn an_entry_within_the_cap_is_read_in_full() {
        let bytes = tiny_archive("project.json", b"0123456789");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let result = read_entry_bytes(&mut archive, "project.json", 1_000).unwrap();

        assert_eq!(result, b"0123456789");
    }

    #[test]
    fn the_aggregate_media_cap_stops_loading_once_crossed() {
        let hash = "a".repeat(64);
        let name = format!("{MEDIA_PREFIX}{hash}.bin");
        let bytes = tiny_archive(&name, b"0123456789");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut total_bytes = 8;

        let result = read_media_entry(&mut archive, &name, 1_000, 10, &mut total_bytes);

        assert!(matches!(result, Err(CoreError::Archive(_))));
    }

    #[test]
    fn an_entry_name_whose_stem_is_not_64_hex_characters_is_not_trusted_as_a_media_id() {
        assert!(media_id_from_entry(&format!("{MEDIA_PREFIX}hello.mp4")).is_none());
        assert!(media_id_from_entry(&format!("{MEDIA_PREFIX}{}.mp4", "a".repeat(64))).is_some());
    }
}
