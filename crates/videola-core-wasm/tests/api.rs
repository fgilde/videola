use std::collections::BTreeMap;
use std::io::{Cursor, Write};

use videola_core::command::{Command, Dispatch};
use videola_core::format::{LoadWarning, SaveOptions};
use videola_core::model::{MediaId, TrackKind};
use videola_core::CoreError;
use videola_core_wasm::inner::DocumentHost;

fn save_options() -> SaveOptions {
    SaveOptions {
        app_version: "0.0.0".into(),
        created: "2026-08-07T10:00:00Z".into(),
        modified: "2026-08-07T10:00:00Z".into(),
        locale: "de".into(),
    }
}

#[test]
fn a_fresh_host_has_an_empty_project_and_no_history() {
    let host = DocumentHost::new();
    assert!(host.project().timeline.tracks.is_empty());
    assert!(host.history_labels().is_empty());
}

#[test]
fn imported_media_is_addressable_by_its_returned_id() {
    let mut host = DocumentHost::new();
    let (id, _) = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();

    // The id is the content hash, not anything the caller could have supplied or influenced.
    assert_eq!(id, MediaId::from_bytes(b"bytes"));
    assert_eq!(host.project().library.len(), 1);
    assert_eq!(
        host.media_bytes(id.as_str()).as_deref(),
        Some(&b"bytes"[..])
    );

    // Re-importing identical content resolves to the same id and does not duplicate the asset.
    let (second, _) = host
        .import_media(
            "a-again.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    assert_eq!(second, id);
    assert_eq!(host.project().library.len(), 1);
}

#[test]
fn save_then_open_restores_project_and_media() {
    let mut host = DocumentHost::new();
    let (id, _) = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    let bytes = host.save(save_options(), BTreeMap::new()).unwrap();

    let reopened = DocumentHost::open(&bytes).unwrap();

    assert_eq!(reopened.project().library.len(), 1);
    assert_eq!(
        reopened.media_bytes(id.as_str()).as_deref(),
        Some(&b"bytes"[..])
    );
    assert!(reopened.warnings().is_empty());
}

#[test]
fn every_known_media_kind_string_is_accepted() {
    for kind in ["video", "audio", "image", "font", "lut"] {
        let mut host = DocumentHost::new();
        let result = host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            kind.into(),
            vec![1],
        );
        assert!(
            result.is_ok(),
            "expected media kind {kind:?} to be accepted"
        );
    }
}

#[test]
fn an_unknown_media_kind_is_rejected() {
    let mut host = DocumentHost::new();
    let error = host
        .import_media(
            "a.xyz".into(),
            "application/x".into(),
            "hologram".into(),
            vec![1],
        )
        .unwrap_err();
    assert!(matches!(error, CoreError::InvalidArgument(_)));
}

#[test]
fn opening_rubbish_fails_instead_of_panicking() {
    let error = DocumentHost::open(b"not a zip").err().unwrap();
    assert!(matches!(error, CoreError::NotAProject(_)));
}

#[test]
fn a_wellformed_zip_without_a_project_entry_is_rejected_as_not_a_project() {
    let mut sink = Cursor::new(Vec::new());
    {
        let mut archive = zip::ZipWriter::new(&mut sink);
        archive
            .start_file("readme.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"nope").unwrap();
        archive.finish().unwrap();
    }
    let error = DocumentHost::open(&sink.into_inner()).err().unwrap();
    assert!(matches!(error, CoreError::NotAProject(_)));
}

// Distinct from `opening_rubbish_fails_instead_of_panicking`: `b"not a zip"` never gets past
// `ZipArchive::new`. Cutting a saved archive in half removes the central directory and EOCD too
// (both live at the end of a ZIP), so that only re-exercises the same `ZipArchive::new` failure —
// it was tried and confirmed by instrumenting the reader. To actually reach `read_entry_bytes`'s
// `EntryReadError::Unreadable` — the mid-read path with the panic surface — the central directory
// and EOCD have to stay valid and only project.json's own compressed bytes get corrupted.
#[test]
fn a_corrupted_project_entry_is_rejected_not_panicked_on() {
    let mut host = DocumentHost::new();
    host.import_media(
        "a.mp4".into(),
        "video/mp4".into(),
        "video".into(),
        b"bytes".to_vec(),
    )
    .unwrap();
    let bytes = host.save(save_options(), BTreeMap::new()).unwrap();
    let corrupted = corrupt_entry_payload(bytes, "project.json");

    let error = DocumentHost::open(&corrupted).err().unwrap();
    assert!(matches!(error, CoreError::NotAProject(_)));
}

#[test]
fn opening_an_archive_missing_a_media_entry_still_opens_with_a_warning() {
    let mut host = DocumentHost::new();
    host.import_media(
        "a.mp4".into(),
        "video/mp4".into(),
        "video".into(),
        b"bytes".to_vec(),
    )
    .unwrap();
    let bytes = host.save(save_options(), BTreeMap::new()).unwrap();
    let stripped = strip_media_entries(bytes);

    let reopened = DocumentHost::open(&stripped).unwrap();

    assert_eq!(reopened.warnings().len(), 1);
    assert!(matches!(
        reopened.warnings()[0],
        LoadWarning::MissingMedia { .. }
    ));
}

#[test]
fn media_bytes_for_an_unknown_id_is_none_not_an_error() {
    let host = DocumentHost::new();
    assert!(host.media_bytes("garbage").is_none());
}

#[test]
fn dispatch_then_undo_then_redo_round_trips_through_history() {
    let mut host = DocumentHost::new();
    let result = host
        .dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Video,
            name: "V1".into(),
            index: None,
        }))
        .unwrap();
    assert_eq!(result.label, videola_core::command::LABEL_TRACK_ADD);
    assert!(result.patch.as_array().is_some_and(|ops| !ops.is_empty()));
    assert_eq!(host.project().timeline.tracks.len(), 1);
    assert_eq!(
        host.history_labels(),
        [videola_core::command::LABEL_TRACK_ADD]
    );

    host.undo().unwrap();
    assert!(host.project().timeline.tracks.is_empty());

    host.redo().unwrap();
    assert_eq!(host.project().timeline.tracks.len(), 1);
}

#[test]
fn importing_media_reports_that_the_import_can_be_undone() {
    let mut host = DocumentHost::new();
    let (_, result) = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    assert!(result.can_undo);
}

#[test]
fn importing_media_after_an_undo_reports_the_redo_stack_cleared() {
    let mut host = DocumentHost::new();
    host.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    host.undo().unwrap();

    let (_, result) = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    assert!(!result.can_redo);
}

// Flips a byte in the middle of `entry_name`'s compressed payload while leaving the rest of the
// archive's structure — central directory, EOCD, even this entry's own local header — untouched.
// Located by hand rather than through the `zip` crate's own reader API: a ZIP local file header
// is a fixed 30 bytes immediately before the filename, so finding the filename's bytes and
// reading the compressed-size/filename-length/extra-length fields at their fixed offsets gives
// the payload's exact position without needing any crate-internal state.
#[allow(clippy::unwrap_used)]
fn corrupt_entry_payload(mut bytes: Vec<u8>, entry_name: &str) -> Vec<u8> {
    let needle = entry_name.as_bytes();
    let header_start = bytes
        .windows(needle.len())
        .position(|window| window == needle)
        .unwrap()
        - 30;
    let filename_len =
        u16::from_le_bytes([bytes[header_start + 26], bytes[header_start + 27]]) as usize;
    let extra_len =
        u16::from_le_bytes([bytes[header_start + 28], bytes[header_start + 29]]) as usize;
    let compressed_size = u32::from_le_bytes([
        bytes[header_start + 18],
        bytes[header_start + 19],
        bytes[header_start + 20],
        bytes[header_start + 21],
    ]) as usize;
    let data_start = header_start + 30 + filename_len + extra_len;
    let flip_at = data_start + compressed_size / 2;
    bytes[flip_at] ^= 0xff;
    bytes
}

// clippy.toml's allow-unwrap-in-tests only exempts #[test] items themselves, not helpers they
// call, hence the explicit allow rather than relying on it — confined to tests/, no production
// risk. Mirrors the same allow on the equivalent helper in videola-core/tests/format_roundtrip.rs.
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
