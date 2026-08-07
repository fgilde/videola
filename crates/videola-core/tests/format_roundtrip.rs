use std::io::Cursor;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{
    reader, writer, LoadWarning, MediaStore, MemoryMediaStore, SaveOptions,
};
use videola_core::model::{ClipSource, MediaAsset, MediaId, MediaKind, Project, Time, TrackKind};
use videola_core::{CoreError, Document};

fn save_options() -> SaveOptions {
    SaveOptions {
        app_version: "0.1.0".into(),
        created: "2026-08-07T10:00:00Z".into(),
        modified: "2026-08-07T11:00:00Z".into(),
        locale: "de".into(),
        slim: true,
    }
}

#[allow(clippy::unwrap_used)]
fn built_project() -> (Project, MemoryMediaStore) {
    let bytes = b"pretend this is an mp4".to_vec();
    let id = MediaId::from_bytes(&bytes);
    let mut store = MemoryMediaStore::default();
    store.insert(id.clone(), bytes.clone());

    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle {
        title: "Urlaub 2026".into(),
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track,
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_seconds(3.0),
    }))
    .unwrap();

    let mut project = doc.project().clone();
    project.library.push(MediaAsset::new(
        id,
        "urlaub.mp4".into(),
        "video/mp4".into(),
        MediaKind::Video,
        bytes.len() as u64,
    ));

    // Otherwise the round-trip equality checks below would pass even if a writer or migration
    // step silently dropped `extra`, since an empty map serialises indistinguishably from one
    // that was never populated.
    project
        .extra
        .insert("futureProjectField".into(), serde_json::json!("keep-me"));
    project.timeline.tracks[0]
        .extra
        .insert("futureTrackField".into(), serde_json::json!("keep-me"));
    project.timeline.tracks[0].clips[0]
        .extra
        .insert("futureClipField".into(), serde_json::json!("keep-me"));

    (project, store)
}

#[test]
fn a_saved_project_loads_back_identically() {
    let (project, store) = built_project();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();

    let loaded = reader::read(Cursor::new(sink.into_inner())).unwrap();

    assert_eq!(loaded.project, project);
    assert!(loaded.warnings.is_empty());
    assert_eq!(loaded.manifest.title, "Urlaub 2026");
    assert_eq!(loaded.manifest.modified, "2026-08-07T11:00:00Z");
}

#[test]
fn media_bytes_survive_the_roundtrip() {
    let (project, store) = built_project();
    let id = project.library[0].id.clone();
    let original = store.read(&id).unwrap();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();

    let loaded = reader::read(Cursor::new(sink.into_inner())).unwrap();

    assert_eq!(loaded.media.get(&id), Some(&original));
}

#[test]
fn a_project_whose_media_entry_is_gone_still_opens_with_a_warning() {
    let (project, store) = built_project();
    let mut sink = Cursor::new(Vec::new());
    writer::write(&mut sink, &project, &store, &save_options()).unwrap();
    let stripped = strip_media_entries(sink.into_inner());

    let loaded = reader::read(Cursor::new(stripped)).unwrap();

    // Bit-identical to the saved project: only the media bytes are gone, not any parameter of
    // the clips that reference them. A reader that zeroed a duration or dropped a keyframe to
    // "handle" the missing asset would still pass a looser clips.len() == 1 check.
    assert_eq!(loaded.project, project);
    assert_eq!(loaded.warnings.len(), 1);
    assert!(matches!(
        loaded.warnings[0],
        LoadWarning::MissingMedia { .. }
    ));
}

#[test]
fn an_archive_without_a_project_entry_is_rejected() {
    let mut sink = Cursor::new(Vec::new());
    {
        let mut archive = zip::ZipWriter::new(&mut sink);
        archive
            .start_file("readme.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        std::io::Write::write_all(&mut archive, b"nope").unwrap();
        archive.finish().unwrap();
    }
    assert!(matches!(
        reader::read(Cursor::new(sink.into_inner())),
        Err(CoreError::NotAProject(_))
    ));
}

#[test]
fn a_non_zip_file_is_rejected_as_not_a_project() {
    assert!(matches!(
        reader::read(Cursor::new(b"not a zip".to_vec())),
        Err(CoreError::NotAProject(_))
    ));
}

#[allow(clippy::unwrap_used)]
fn strip_media_entries(bytes: Vec<u8>) -> Vec<u8> {
    let mut source = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut sink = Cursor::new(Vec::new());
    {
        let mut out = zip::ZipWriter::new(&mut sink);
        for index in 0..source.len() {
            let mut entry = source.by_index(index).unwrap();
            let name = entry.name().to_string();
            if name.starts_with("media/") {
                continue;
            }
            out.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::copy(&mut entry, &mut out).unwrap();
        }
        out.finish().unwrap();
    }
    sink.into_inner()
}
