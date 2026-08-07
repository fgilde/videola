use thiserror::Error;

use crate::model::{ClipId, TrackId};

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("track not found: {0}")]
    TrackNotFound(TrackId),

    #[error("clip not found: {0}")]
    ClipNotFound(ClipId),

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
}
