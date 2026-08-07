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
    archive.finish().map_err(archive_error)?;
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
    for asset in &project.library {
        let bytes = media.read(&asset.id)?;
        let name = media_entry_name(&asset.id, &asset.extension());
        archive.start_file(name, stored()).map_err(archive_error)?;
        archive.write_all(&bytes)?;
    }
    Ok(())
}

pub fn media_entry_name(id: &MediaId, extension: &str) -> String {
    format!("{MEDIA_PREFIX}{}.{extension}", id.content_hash())
}

fn deflated() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

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
}
