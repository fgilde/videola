use videola_core_wasm::inner::{DocumentHost, SaveRequest};

#[test]
fn a_fresh_host_has_an_empty_project_and_no_history() {
    let host = DocumentHost::new();
    assert!(host.project().timeline.tracks.is_empty());
    assert!(host.history_labels().is_empty());
}

#[test]
fn imported_media_is_addressable_by_its_returned_id() {
    let mut host = DocumentHost::new();
    let id = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    assert_eq!(host.project().library.len(), 1);
    assert_eq!(host.media_bytes(&id).as_deref(), Some(&b"bytes"[..]));
}

#[test]
fn save_then_open_restores_project_and_media() {
    let mut host = DocumentHost::new();
    let id = host
        .import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"bytes".to_vec(),
        )
        .unwrap();
    let bytes = host
        .save(SaveRequest {
            app_version: "0.0.0".into(),
            created: "2026-08-07T10:00:00Z".into(),
            modified: "2026-08-07T10:00:00Z".into(),
            locale: "de".into(),
            slim: true,
        })
        .unwrap();

    let reopened = DocumentHost::open(&bytes).unwrap();

    assert_eq!(reopened.project().library.len(), 1);
    assert_eq!(reopened.media_bytes(&id).as_deref(), Some(&b"bytes"[..]));
    assert!(reopened.warnings().is_empty());
}

#[test]
fn an_unknown_media_kind_is_rejected() {
    let mut host = DocumentHost::new();
    assert!(host
        .import_media(
            "a.xyz".into(),
            "application/x".into(),
            "hologram".into(),
            vec![1]
        )
        .is_err());
}

#[test]
fn opening_rubbish_fails_instead_of_panicking() {
    assert!(DocumentHost::open(b"not a zip").is_err());
}
