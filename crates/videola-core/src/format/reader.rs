use std::collections::BTreeMap;
use std::io::{Read, Seek};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::ZipArchive;

use super::{Manifest, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project};
use crate::{CoreError, Result};

// Deflate's documented worst-case expansion is a bit over 1000:1 (RFC 1951, an all-zero input),
// which is why a cap is needed at all — no legitimate H.264/AAC/JPEG asset gets remotely close
// to one once its declared size is checked before a single byte is decompressed. The *size* of
// the cap is bounded by the actual deploy target, not by disk: this crate compiles to
// wasm32-unknown-unknown (see rust-toolchain.toml), where usize is 32-bit and linear memory
// tops out at 4 GiB — typically far less in a real browser tab.
const MAX_ENTRY_BYTES: u64 = 512 * 1024 * 1024;

// `project.json`/`videola.json` get their own, much smaller cap: the 512 MiB figure above reasons
// about a *media* entry's compressed-to-decompressed ratio, but a JSON entry does not decompress
// into bytes, it decompresses into a `serde_json::Value` tree — object/array nodes, `String`
// allocations, UTF-8 validation buffers — which for a 512 MiB string routinely costs several
// times that in a wasm32 tab whose entire linear memory tops out well under 512 MiB to begin
// with. No legitimate project (even a large one, hand-authored or AI-generated) gets remotely
// close to this.
const MAX_JSON_ENTRY_BYTES: u64 = 64 * 1024 * 1024;

// Bounds how much a single `read` call can commit to `LoadedProject.media` in total, independent
// of how many individual entries (each already under MAX_ENTRY_BYTES) add up to it. Public so
// callers accumulating media outside a `read` (e.g. importing from JS) can enforce the same
// ceiling instead of growing linear memory without bound.
pub const MAX_TOTAL_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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

    let raw_project = read_required_entry(&mut archive, PROJECT_ENTRY, MAX_JSON_ENTRY_BYTES)?;
    let manifest = read_manifest(&mut archive)?;
    let (project, mut warnings) = super::migrate::load(&raw_project)?;
    let (media, media_warnings) = read_media(&mut archive)?;

    let was_migrated = warnings
        .iter()
        .any(|warning| matches!(warning, LoadWarning::Migrated { .. }));

    warnings.extend(media_warnings);
    warnings.extend(missing_media(&project, &media));
    warnings.extend(manifest_mismatches(&manifest, &project, was_migrated));

    Ok(LoadedProject {
        manifest,
        project,
        media,
        warnings,
    })
}

fn read_manifest<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<Manifest> {
    let raw = read_required_entry(archive, MANIFEST_ENTRY, MAX_JSON_ENTRY_BYTES)?;
    serde_json::from_str(&raw).map_err(|error| CoreError::NotAProject(error.to_string()))
}

// A missing, oversized or unreadable *required* entry all mean the same thing to the caller:
// this archive is not a well-formed videola project. Fine-grained distinction between those
// cases only matters for media entries (see read_media_entry), which degrade instead of aborting.
fn read_required_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    cap: u64,
) -> Result<String> {
    let bytes = read_entry_bytes(archive, name, cap)
        .map_err(|_| CoreError::NotAProject(format!("missing or invalid entry: {name}")))?;
    String::from_utf8(bytes).map_err(|error| CoreError::NotAProject(error.to_string()))
}

// Not found and every read/decompress failure end up handled identically by both callers (a
// warning or NotAProject) — there is nothing left that acts on the distinction.
#[derive(Debug)]
enum EntryReadError {
    TooLarge,
    Unreadable,
}

impl From<std::io::Error> for EntryReadError {
    fn from(_: std::io::Error) -> Self {
        EntryReadError::Unreadable
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
    // A cap that does not even fit this platform's address space cannot be honoured; treat it
    // the same as an oversized entry rather than let a later conversion panic or wrap.
    if usize::try_from(cap).is_err() {
        return Err(EntryReadError::TooLarge);
    }

    let entry = archive
        .by_name(name)
        .map_err(|_| EntryReadError::Unreadable)?;
    if entry.size() > cap {
        return Err(EntryReadError::TooLarge);
    }

    // take(cap) alone would silently truncate a stream that lies about its length rather than
    // reject it; take(cap + 1) lets one extra byte through so the length check below can tell
    // "exactly cap bytes" from "more than cap bytes" and fail loudly on the latter.
    let mut bytes = Vec::new();
    entry.take(cap.saturating_add(1)).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(EntryReadError::TooLarge);
    }
    Ok(bytes)
}

enum MediaEntryOutcome {
    Loaded(MediaId, Vec<u8>),
    Warn(LoadWarning),
}

type MediaLoad = (BTreeMap<MediaId, Vec<u8>>, Vec<LoadWarning>);

fn read_media<R: Read + Seek>(archive: &mut ZipArchive<R>) -> Result<MediaLoad> {
    read_media_with_caps(archive, MAX_ENTRY_BYTES, MAX_TOTAL_MEDIA_BYTES)
}

fn read_media_with_caps<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entry_cap: u64,
    total_cap: u64,
) -> Result<MediaLoad> {
    let mut media = BTreeMap::new();
    let mut warnings = Vec::new();
    let mut total_bytes: u64 = 0;

    for name in media_entry_names(archive) {
        match read_media_entry(archive, &name, entry_cap, total_cap, &mut total_bytes)? {
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

    // Capping the read at whatever budget remains — rather than entry_cap alone and checking
    // the running total afterwards — makes overshooting the aggregate cap by up to a whole
    // entry structurally impossible instead of merely checked after the fact.
    let remaining = total_cap.saturating_sub(*total_bytes);
    let bytes = match read_entry_bytes(archive, name, entry_cap.min(remaining)) {
        Ok(bytes) => bytes,
        Err(EntryReadError::TooLarge) => {
            return Err(CoreError::Archive(format!(
                "media entry {name} exceeds the {entry_cap} byte per-entry cap or the \
                 remaining {remaining} byte aggregate budget"
            )))
        }
        Err(EntryReadError::Unreadable) => return Ok(MediaEntryOutcome::Warn(unreadable(name))),
    };

    *total_bytes = total_bytes.saturating_add(bytes.len() as u64);

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

pub(crate) fn is_content_hash(stem: &str) -> bool {
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
//
// schemaVersion is skipped once a Migrated warning already fired: `project.schema_version` is
// always stamped to the current SCHEMA_VERSION by migration, so an old file's manifest (still
// declaring its original, older version) would otherwise report a spurious mismatch on every
// migrated load, telling the user their file is inconsistent when it is merely old.
fn manifest_mismatches(
    manifest: &Manifest,
    project: &Project,
    was_migrated: bool,
) -> Vec<LoadWarning> {
    let mut mismatches = Vec::new();
    if !was_migrated && manifest.schema_version != project.schema_version {
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
    use crate::model::Project;

    fn tiny_archive(entry_name: &str, contents: &[u8]) -> Vec<u8> {
        tiny_archive_many(&[(entry_name, contents)])
    }

    fn tiny_archive_many(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut sink = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut sink);
            for (name, contents) in entries {
                writer
                    .start_file(*name, zip::write::SimpleFileOptions::default())
                    .unwrap();
                std::io::Write::write_all(&mut writer, contents).unwrap();
            }
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
    fn an_entry_exactly_at_the_cap_is_accepted_not_rejected() {
        let bytes = tiny_archive("project.json", b"0123456789");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let result = read_entry_bytes(&mut archive, "project.json", 10).unwrap();

        assert_eq!(result, b"0123456789");
    }

    // I15: `project.json`/`videola.json` must not share the media entries' 512 MiB cap — a JSON
    // entry that size would build a `Value` tree several times larger in memory, in a wasm32 tab
    // whose linear memory tops out well below that.
    #[test]
    fn the_json_entry_cap_is_smaller_than_the_media_entry_cap() {
        const { assert!(MAX_JSON_ENTRY_BYTES < MAX_ENTRY_BYTES) };
    }

    #[test]
    fn read_required_entry_honours_the_caller_supplied_cap() {
        let bytes = tiny_archive("project.json", b"0123456789");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        let result = read_required_entry(&mut archive, "project.json", 5);

        assert!(matches!(result, Err(CoreError::NotAProject(_))));
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
    fn total_bytes_exactly_at_the_aggregate_cap_is_still_allowed() {
        let content = b"0123456789";
        let hash = MediaId::from_bytes(content).content_hash().to_string();
        let name = format!("{MEDIA_PREFIX}{hash}.bin");
        let bytes = tiny_archive(&name, content);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut total_bytes = 0;

        let result = read_media_entry(&mut archive, &name, 1_000, 10, &mut total_bytes).unwrap();

        assert!(matches!(result, MediaEntryOutcome::Loaded(_, _)));
        assert_eq!(total_bytes, 10);
    }

    #[test]
    fn read_media_enforces_distinct_entry_and_aggregate_caps() {
        let name_a = format!("{MEDIA_PREFIX}{}.bin", "a".repeat(64));
        let name_b = format!("{MEDIA_PREFIX}{}.bin", "b".repeat(64));
        let bytes = tiny_archive_many(&[
            (name_a.as_str(), b"0123456789"),
            (name_b.as_str(), b"0123456789"),
        ]);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

        // Each entry (10 bytes) is well within a 1000 byte per-entry cap, but the two together
        // (20 bytes) exceed a 15 byte aggregate cap. This only fails if read_media forwards the
        // two caps to read_media_entry as distinct values rather than conflating them.
        let result = read_media_with_caps(&mut archive, 1_000, 15);

        assert!(matches!(result, Err(CoreError::Archive(_))));
    }

    #[test]
    fn tampered_content_is_reported_as_unreadable_not_silently_accepted() {
        let hash = "a".repeat(64);
        let name = format!("{MEDIA_PREFIX}{hash}.bin");
        let bytes = tiny_archive(&name, b"not the real content");
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut total_bytes = 0;

        let result = read_media_entry(&mut archive, &name, 1_000, 1_000, &mut total_bytes).unwrap();

        assert!(matches!(
            result,
            MediaEntryOutcome::Warn(LoadWarning::UnreadableEntry { .. })
        ));
    }

    #[test]
    fn matching_content_is_loaded_not_warned_about() {
        let content = b"real";
        let hash = MediaId::from_bytes(content).content_hash().to_string();
        let name = format!("{MEDIA_PREFIX}{hash}.bin");
        let bytes = tiny_archive(&name, content);
        let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut total_bytes = 0;

        let result = read_media_entry(&mut archive, &name, 1_000, 1_000, &mut total_bytes).unwrap();

        assert!(matches!(result, MediaEntryOutcome::Loaded(_, _)));
    }

    #[test]
    fn an_entry_name_whose_stem_is_not_64_hex_characters_is_not_trusted_as_a_media_id() {
        assert!(media_id_from_entry(&format!("{MEDIA_PREFIX}hello.mp4")).is_none());
        assert!(media_id_from_entry(&format!("{MEDIA_PREFIX}{}.mp4", "z".repeat(64))).is_none());
        assert!(media_id_from_entry(&format!("{MEDIA_PREFIX}{}.mp4", "a".repeat(64))).is_some());
    }

    fn agreeing_manifest(project: &Project) -> Manifest {
        Manifest {
            schema_version: project.schema_version,
            app_version: "0.0.0".into(),
            project_id: project.meta.id.to_string(),
            title: project.meta.title.clone(),
            created: String::new(),
            modified: String::new(),
            locale: "de".into(),
        }
    }

    #[test]
    fn a_manifest_that_agrees_with_the_project_has_no_mismatches() {
        let project = Project::default();
        let manifest = agreeing_manifest(&project);

        assert!(manifest_mismatches(&manifest, &project, false).is_empty());
    }

    #[test]
    fn a_manifest_whose_title_disagrees_reports_exactly_that_field() {
        let project = Project::default();
        let mut manifest = agreeing_manifest(&project);
        manifest.title = "different".into();

        assert_eq!(
            manifest_mismatches(&manifest, &project, false),
            vec![LoadWarning::ManifestMismatch {
                field: "title".into()
            }]
        );
    }

    #[test]
    fn a_migrated_project_does_not_get_a_spurious_schema_version_mismatch() {
        let project = Project::default();
        let mut manifest = agreeing_manifest(&project);
        // What the old file actually declared before migration stamped the project's own
        // schema_version to the current SCHEMA_VERSION.
        manifest.schema_version = 0;

        assert!(manifest_mismatches(&manifest, &project, true).is_empty());
    }
}
