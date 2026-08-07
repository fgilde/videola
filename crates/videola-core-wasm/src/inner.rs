use std::io::Cursor;

use serde::de::value::{Error as DeError, StrDeserializer};
use serde::Deserialize;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{
    reader, writer, LoadWarning, MediaStore, MemoryMediaStore, SaveOptions,
};
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
    ) -> Result<MediaId> {
        // Hashed here, not accepted as a field from JS: the id is what makes MediaImport's
        // validation (canonical med_ + 64 hex) meaningful. Trusting a caller-supplied id would
        // let JS point the project at bytes it never actually gave us.
        let id = MediaId::from_bytes(&bytes);
        let already_stored = self.media.read(&id).is_ok();
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
            parse_kind(&kind)?,
            bytes.len() as u64,
        );
        self.media.insert(id.clone(), bytes);
        self.document
            .dispatch(Dispatch::new(Command::MediaImport { asset }))?;
        Ok(id)
    }

    pub fn media_bytes(&self, id: &str) -> Option<Vec<u8>> {
        // ponytail: MemoryMediaStore::read only ever fails with MediaNotAvailable, so folding
        // every error into None is safe today. Revisit once media can come from OPFS/streaming,
        // where a genuine I/O error must not look like an unknown id to the caller.
        self.media.read(&MediaId::from(id.to_string())).ok()
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

    #[test]
    fn importing_up_to_the_aggregate_media_cap_is_accepted() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 5);
        let result = host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            "video".into(),
            vec![0u8; 5],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn importing_past_the_aggregate_media_cap_is_rejected() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 5);
        let error = host
            .import_media(
                "a.bin".into(),
                "application/octet-stream".into(),
                "video".into(),
                vec![0u8; 6],
            )
            .unwrap_err();
        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }
}
