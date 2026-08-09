use thiserror::Error;

use crate::model::{ClipId, MediaId, TrackId};

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("track not found: {0}")]
    TrackNotFound(TrackId),

    #[error("clip not found: {0}")]
    ClipNotFound(ClipId),

    #[error("track is locked: {0}")]
    TrackLocked(TrackId),

    #[error("index {index} out of range (len {len})")]
    IndexOutOfRange { index: usize, len: usize },

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("nothing to undo")]
    NothingToUndo,

    #[error("nothing to redo")]
    NothingToRedo,

    #[error("serialisation failed: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("archive error: {0}")]
    Archive(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("media not available: {0}")]
    MediaNotAvailable(MediaId),

    #[error("not a videola project: {0}")]
    NotAProject(String),

    #[error("unsupported schema version {0}")]
    UnsupportedSchema(u64),
}
