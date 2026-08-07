use std::io::{Seek, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{Manifest, MediaStore, SaveOptions, MANIFEST_ENTRY, MEDIA_PREFIX, PROJECT_ENTRY};
use crate::model::{MediaId, Project, SCHEMA_VERSION};
use crate::{CoreError, Result};

pub fn write<W: Write + Seek>(
    sink: W,
    project: &Project,
    media: &dyn MediaStore,
    options: &SaveOptions,
) -> Result<()> {
    let mut archive = ZipWriter::new(sink);
    write_json(&mut archive, MANIFEST_ENTRY, &manifest(project, options))?;
    write_json(&mut archive, PROJECT_ENTRY, project)?;
    write_media(&mut archive, project, media)?;
    // `finish()` hands back the inner writer; for a buffered sink (e.g. &mut BufWriter<File>)
    // that buffer's tail is only guaranteed on disk once flushed, and a dropped `&mut` reference
    // flushes nothing on its own.
    let mut sink = archive.finish().map_err(archive_error)?;
    sink.flush()?;
    Ok(())
}

fn manifest(project: &Project, options: &SaveOptions) -> Manifest {
    Manifest {
        schema_version: SCHEMA_VERSION,
        app_version: options.app_version.clone(),
        project_id: project.meta.id.to_string(),
        title: project.meta.title.clone(),
        created: options.created.clone(),
        modified: options.modified.clone(),
        locale: options.locale.clone(),
    }
}

fn write_json<W: Write + Seek, T: serde::Serialize>(
    archive: &mut ZipWriter<W>,
    name: &str,
    value: &T,
) -> Result<()> {
    archive
        .start_file(name, deflated())
        .map_err(archive_error)?;
    archive.write_all(serde_json::to_string_pretty(value)?.as_bytes())?;
    Ok(())
}

fn write_media<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    project: &Project,
    media: &dyn MediaStore,
) -> Result<()> {
    // `library` is a plain Vec sourced from untrusted JSON, with no uniqueness invariant: two
    // entries with the same id (and extension) would otherwise produce two identically-named
    // ZIP entries, which `zip` does not reject on its own.
    let mut written = std::collections::BTreeSet::new();
    for asset in &project.library {
        let name = media_entry_name(&asset.id, &asset.extension());
        if !written.insert(name.clone()) {
            continue;
        }
        let bytes = media.read(&asset.id)?;
        archive.start_file(name, stored()).map_err(archive_error)?;
        archive.write_all(&bytes)?;
    }
    Ok(())
}

// Sanitised here too, not just at `MediaAsset::extension()`'s call site: this function is a
// public entry-name builder future callers (Tasks 14-16) can reach directly, and the guarantee
// against path-traversal / oversized extensions must hold no matter who calls it. That includes
// `id`: `command::project::import_media` rejects a non-canonical id, but a `.videola` loaded from
// disk skips that command entirely, and `normalize_library` never checks id shape — so a hostile
// `library[].id` reaches here regardless of path. Hashing anything that isn't already a content
// hash keeps the entry inside `MEDIA_PREFIX` either way, instead of trusting two call sites to
// agree on validation.
pub fn media_entry_name(id: &MediaId, extension: &str) -> String {
    let extension = if crate::model::media::is_safe_extension(extension) {
        extension
    } else {
        "bin"
    };
    let hash = id.content_hash();
    let hash = if super::reader::is_content_hash(hash) {
        hash.to_string()
    } else {
        super::hash::sha256_hex(hash.as_bytes())
    };
    format!("{MEDIA_PREFIX}{hash}.{extension}")
}

fn deflated() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

// Media is already compressed (H.264, AAC, JPEG, ...); running deflate over it again only costs
// time for negligible size gain.
fn stored() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

fn archive_error(error: zip::result::ZipError) -> CoreError {
    CoreError::Archive(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::format::MemoryMediaStore;
    use crate::model::{MediaAsset, MediaKind, Project, Time, Track, TrackKind};

    fn project_with_media(store: &mut MemoryMediaStore) -> Project {
        let bytes = b"fake mp4 bytes".to_vec();
        let id = MediaId::from_bytes(&bytes);
        store.insert(id.clone(), bytes.clone());

        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            id.clone(),
            "clip.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            bytes.len() as u64,
        ));
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(crate::model::Clip::new_media(
            id,
            Time::ZERO,
            Time::from_seconds(2.0),
        ));
        project.timeline.tracks.push(track);
        project
    }

    fn entry_names(bytes: &[u8]) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect()
    }

    #[test]
    fn writes_manifest_project_and_media_entries() {
        let mut store = MemoryMediaStore::default();
        let project = project_with_media(&mut store);
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        let names = entry_names(sink.get_ref());
        assert!(names.contains(&MANIFEST_ENTRY.to_string()));
        assert!(names.contains(&PROJECT_ENTRY.to_string()));
        assert_eq!(
            names.iter().filter(|n| n.starts_with(MEDIA_PREFIX)).count(),
            1
        );
    }

    #[test]
    fn media_entries_are_named_after_the_content_hash() {
        let mut store = MemoryMediaStore::default();
        let project = project_with_media(&mut store);
        let expected = format!("{MEDIA_PREFIX}{}.mp4", project.library[0].id.content_hash());
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        assert!(entry_names(sink.get_ref()).contains(&expected));
    }

    #[test]
    fn the_manifest_carries_the_supplied_timestamps_and_locale() {
        let store = MemoryMediaStore::default();
        let mut sink = Cursor::new(Vec::new());
        write(
            &mut sink,
            &Project::default(),
            &store,
            &SaveOptions::for_test(),
        )
        .unwrap();

        let mut archive = zip::ZipArchive::new(sink).unwrap();
        let manifest: Manifest =
            serde_json::from_reader(archive.by_name(MANIFEST_ENTRY).unwrap()).unwrap();
        assert_eq!(manifest.created, "2026-08-07T10:00:00Z");
        assert_eq!(manifest.locale, "de");
        assert_eq!(manifest.schema_version, crate::model::SCHEMA_VERSION);
    }

    #[test]
    fn missing_media_is_reported_instead_of_silently_skipped() {
        let store = MemoryMediaStore::default();
        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            MediaId::from("med_ghost".to_string()),
            "gone.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            1,
        ));
        let mut sink = Cursor::new(Vec::new());

        let result = write(&mut sink, &project, &store, &SaveOptions::for_test());
        assert!(matches!(
            result,
            Err(crate::CoreError::MediaNotAvailable(_))
        ));
    }

    #[test]
    fn duplicate_library_entries_do_not_produce_duplicate_zip_entries() {
        let mut store = MemoryMediaStore::default();
        let mut project = project_with_media(&mut store);
        let duplicate = project.library[0].clone();
        project.library.push(duplicate);
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        let names = entry_names(sink.get_ref());
        assert_eq!(
            names.iter().filter(|n| n.starts_with(MEDIA_PREFIX)).count(),
            1
        );
    }

    #[test]
    fn a_path_traversal_extension_falls_back_to_bin_in_the_entry_name() {
        let bytes = b"data".to_vec();
        let id = MediaId::from_bytes(&bytes);
        let mut store = MemoryMediaStore::default();
        store.insert(id.clone(), bytes.clone());
        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            id.clone(),
            "x.../../../../evil".into(),
            "application/octet-stream".into(),
            MediaKind::Video,
            bytes.len() as u64,
        ));
        let mut sink = Cursor::new(Vec::new());

        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        let expected = format!("{MEDIA_PREFIX}{}.bin", id.content_hash());
        assert!(entry_names(sink.get_ref()).contains(&expected));
    }

    // `import_media` rejects a non-canonical id at the command boundary, but a `.videola` loaded
    // straight from disk never goes through that command, and `normalize_library` does not check
    // id shape either — so a hostile `library[].id` reaches `write` regardless of how the project
    // got here. `media_entry_name` is the one guard that must hold no matter which path led to it.
    #[test]
    fn a_hostile_media_id_cannot_escape_the_media_prefix_on_save() {
        let bytes = b"data".to_vec();
        let id = MediaId::from("med_../../evil".to_string());
        let mut store = MemoryMediaStore::default();
        store.insert(id.clone(), bytes.clone());

        let mut project = Project::default();
        project.library.push(MediaAsset::new(
            id,
            "clip.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            bytes.len() as u64,
        ));
        let loaded = crate::Document::from_project(project).unwrap();

        let mut sink = Cursor::new(Vec::new());
        write(
            &mut sink,
            loaded.project(),
            &store,
            &SaveOptions::for_test(),
        )
        .unwrap();

        for name in entry_names(sink.get_ref()) {
            if let Some(rest) = name.strip_prefix(MEDIA_PREFIX) {
                assert!(!rest.contains(".."), "entry escaped media/: {name}");
                assert!(!rest.contains('/'), "entry escaped media/: {name}");
            }
        }
    }

    #[test]
    fn the_model_is_deflated_and_media_is_stored() {
        let mut store = MemoryMediaStore::default();
        let project = project_with_media(&mut store);
        let mut sink = Cursor::new(Vec::new());
        write(&mut sink, &project, &store, &SaveOptions::for_test()).unwrap();

        let mut archive = zip::ZipArchive::new(sink).unwrap();
        assert_eq!(
            archive.by_name(PROJECT_ENTRY).unwrap().compression(),
            CompressionMethod::Deflated
        );
        let media_name = format!("{MEDIA_PREFIX}{}.mp4", project.library[0].id.content_hash());
        assert_eq!(
            archive.by_name(&media_name).unwrap().compression(),
            CompressionMethod::Stored
        );
    }
}
