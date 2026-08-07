use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Rate, Time};
use crate::format::hash::sha256_hex;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(transparent)]
#[ts(type = "string")]
pub struct MediaId(String);

impl MediaId {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self(format!("med_{}", sha256_hex(bytes)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn hash(&self) -> &str {
        self.0.strip_prefix("med_").unwrap_or(&self.0)
    }
}

impl From<String> for MediaId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Display for MediaId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MediaKind {
    Video,
    Audio,
    Image,
    Font,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: MediaId,
    pub original_name: String,
    pub mime: String,
    pub kind: MediaKind,
    pub size_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<Time>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fps: Option<Rate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<u16>,
}

impl MediaAsset {
    pub fn new(
        id: MediaId,
        original_name: String,
        mime: String,
        kind: MediaKind,
        size_bytes: u64,
    ) -> Self {
        Self {
            id,
            original_name,
            mime,
            kind,
            size_bytes,
            duration: None,
            width: None,
            height: None,
            fps: None,
            sample_rate: None,
            channels: None,
        }
    }

    pub fn extension(&self) -> String {
        self.original_name
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .unwrap_or_else(|| "bin".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_ids_come_from_content_not_chance() {
        let a = MediaId::from_bytes(b"same bytes");
        let b = MediaId::from_bytes(b"same bytes");
        assert_eq!(a, b);
        assert!(a.as_str().starts_with("med_"));
    }

    #[test]
    fn different_content_yields_different_ids() {
        assert_ne!(MediaId::from_bytes(b"a"), MediaId::from_bytes(b"b"));
    }

    #[test]
    fn extension_comes_from_the_original_name() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "Urlaub Clip.MP4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            123,
        );
        assert_eq!(asset.extension(), "mp4");
    }

    #[test]
    fn a_name_without_a_dot_falls_back_to_bin() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "clip".into(),
            "application/octet-stream".into(),
            MediaKind::Video,
            1,
        );
        assert_eq!(asset.extension(), "bin");
    }

    #[test]
    fn optional_technical_metadata_is_omitted_from_json_when_absent() {
        let asset = MediaAsset::new(
            MediaId::from_bytes(b"x"),
            "a.wav".into(),
            "audio/wav".into(),
            MediaKind::Audio,
            10,
        );
        let json = serde_json::to_value(&asset).unwrap();
        assert!(json.get("width").is_none());
        assert!(json.get("fps").is_none());
    }
}
