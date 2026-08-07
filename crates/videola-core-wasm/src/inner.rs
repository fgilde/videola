use std::io::Cursor;

use serde::de::value::{Error as DeError, StrDeserializer};
use serde::Deserialize;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{reader, writer, LoadWarning, MemoryMediaStore, SaveOptions};
use videola_core::model::{MediaAsset, MediaId, MediaKind, Project};
use videola_core::{CoreError, DispatchResult, Document, Result};

pub struct DocumentHost {
    document: Document,
    media: MemoryMediaStore,
    media_bytes_total: u64,
    warnings: Vec<LoadWarning>,
}

impl Default for DocumentHost {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentHost {
    pub fn new() -> Self {
        Self {
            document: Document::new(),
            media: MemoryMediaStore::default(),
            media_bytes_total: 0,
            warnings: Vec::new(),
        }
    }

    pub fn open(bytes: &[u8]) -> Result<Self> {
        let loaded = reader::read(Cursor::new(bytes))?;
        let mut media = MemoryMediaStore::default();
        let mut media_bytes_total = 0u64;
        for (id, bytes) in loaded.media {
            media_bytes_total += bytes.len() as u64;
            media.insert(id, bytes);
        }
        Ok(Self {
            document: Document::from_project(loaded.project)?,
            media,
            media_bytes_total,
            warnings: loaded.warnings,
        })
    }

    pub fn project(&self) -> &Project {
        self.document.project()
    }

    pub fn warnings(&self) -> &[LoadWarning] {
        &self.warnings
    }

    pub fn history_labels(&self) -> Vec<&'static str> {
        self.document.history().labels()
    }

    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        self.document.dispatch(dispatch)
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        self.document.undo()
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        self.document.redo()
    }

    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> Result<(MediaId, DispatchResult)> {
        // Hashed here, not accepted as a field from JS: the id is what makes MediaImport's
        // validation (canonical med_ + 64 hex) meaningful for *this* path. `dispatch()` still
        // takes a raw `Command::MediaImport` with a caller-supplied id and only checks its shape,
        // not that JS actually holds the bytes it names — that sibling path is not guarded here.
        let id = MediaId::from_bytes(&bytes);
        // Resolved before anything is committed: an unknown kind must fail without charging the
        // media budget or storing bytes, otherwise a rejected import still costs its budget slice
        // forever, and a run of them locks out every legitimate import for the module's lifetime.
        let media_kind = parse_kind(&kind)?;
        let already_stored = self.media.contains(&id);
        if !already_stored {
            let projected = self.media_bytes_total + bytes.len() as u64;
            if projected > reader::MAX_TOTAL_MEDIA_BYTES {
                return Err(CoreError::InvalidArgument(format!(
                    "importing {} bytes would exceed the {} byte media budget",
                    bytes.len(),
                    reader::MAX_TOTAL_MEDIA_BYTES
                )));
            }
            self.media_bytes_total = projected;
        }
        let asset = MediaAsset::new(
            id.clone(),
            original_name,
            mime,
            media_kind,
            bytes.len() as u64,
        );
        self.media.insert(id.clone(), bytes);
        // ponytail: this dispatch only ever succeeds today — `asset` always carries a canonical
        // hashed id and `duration: None`, and `validate_new_asset` cannot reject either. If a
        // future change threads a real duration through from JS, this `?` can fail *after* the
        // budget and the store were already committed, reopening the N-1 leak at the tail instead
        // of the head. Move the budget charge after this dispatch succeeds if that happens.
        let result = self
            .document
            .dispatch(Dispatch::new(Command::MediaImport { asset }))?;
        Ok((id, result))
    }

    pub fn media_bytes(&self, id: &str) -> Option<Vec<u8>> {
        self.media.get(&MediaId::from(id.to_string())).cloned()
    }

    pub fn save(&self, options: SaveOptions) -> Result<Vec<u8>> {
        let mut sink = Cursor::new(Vec::new());
        writer::write(&mut sink, self.document.project(), &self.media, &options)?;
        Ok(sink.into_inner())
    }
}

fn parse_kind(kind: &str) -> Result<MediaKind> {
    MediaKind::deserialize(StrDeserializer::<DeError>::new(kind))
        .map_err(|_| CoreError::InvalidArgument(format!("unknown media kind: {kind}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Constructing near the 2 GiB cap directly instead of actually allocating gigabytes of
    // zeroes keeps this test instant while still exercising the exact boundary.
    fn host_with_media_bytes_total(total: u64) -> DocumentHost {
        DocumentHost {
            document: Document::new(),
            media: MemoryMediaStore::default(),
            media_bytes_total: total,
            warnings: Vec::new(),
        }
    }

    // A single test, not two: it must fail if the running total is never actually updated on
    // acceptance (the first import would look free to every later check, and this would let the
    // second import through instead of rejecting it).
    #[test]
    fn importing_media_accumulates_against_the_aggregate_cap() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 10);
        host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            "video".into(),
            vec![0u8; 5],
        )
        .unwrap();

        let error = host
            .import_media(
                "b.bin".into(),
                "application/octet-stream".into(),
                "video".into(),
                vec![0u8; 6],
            )
            .unwrap_err();
        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn a_rejected_kind_does_not_charge_the_media_budget() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 5);
        host.import_media(
            "a.xyz".into(),
            "application/x".into(),
            "hologram".into(),
            vec![0u8; 5],
        )
        .unwrap_err();

        // If the rejected import above had already charged the budget, this legitimate one
        // would be turned away too.
        let result = host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            "video".into(),
            vec![0u8; 5],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn open_seeds_the_media_byte_counter_from_loaded_media() {
        let mut host = DocumentHost::new();
        host.import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"12345".to_vec(),
        )
        .unwrap();
        let bytes = host
            .save(SaveOptions {
                app_version: "0.0.0".into(),
                created: "c".into(),
                modified: "m".into(),
                locale: "de".into(),
                slim: true,
            })
            .unwrap();

        let reopened = DocumentHost::open(&bytes).unwrap();

        assert_eq!(reopened.media_bytes_total, 5);
    }
}
