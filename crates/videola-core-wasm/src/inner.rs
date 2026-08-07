use std::io::Cursor;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{
    reader, writer, LoadWarning, MediaStore, MemoryMediaStore, SaveOptions,
};
use videola_core::model::{MediaAsset, MediaId, MediaKind, Project};
use videola_core::{CoreError, DispatchResult, Document, Result};

pub struct SaveRequest {
    pub app_version: String,
    pub created: String,
    pub modified: String,
    pub locale: String,
    pub slim: bool,
}

pub struct DocumentHost {
    document: Document,
    media: MemoryMediaStore,
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
            warnings: Vec::new(),
        }
    }

    pub fn open(bytes: &[u8]) -> Result<Self> {
        let loaded = reader::read(Cursor::new(bytes.to_vec()))?;
        let mut media = MemoryMediaStore::default();
        for (id, bytes) in loaded.media {
            media.insert(id, bytes);
        }
        Ok(Self {
            document: Document::from_project(loaded.project)?,
            media,
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
        let id = MediaId::from_bytes(&bytes);
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

    pub fn media_bytes(&self, id: &MediaId) -> Option<Vec<u8>> {
        self.media.read(id).ok()
    }

    pub fn save(&self, request: SaveRequest) -> Result<Vec<u8>> {
        let mut sink = Cursor::new(Vec::new());
        writer::write(
            &mut sink,
            self.document.project(),
            &self.media,
            &SaveOptions {
                app_version: request.app_version,
                created: request.created,
                modified: request.modified,
                locale: request.locale,
                slim: request.slim,
            },
        )?;
        Ok(sink.into_inner())
    }
}

fn parse_kind(kind: &str) -> Result<MediaKind> {
    match kind {
        "video" => Ok(MediaKind::Video),
        "audio" => Ok(MediaKind::Audio),
        "image" => Ok(MediaKind::Image),
        "font" => Ok(MediaKind::Font),
        other => Err(CoreError::InvalidArgument(format!(
            "unknown media kind: {other}"
        ))),
    }
}
