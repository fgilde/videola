use serde::{Deserialize, Serialize};

/// Audiola's `project.json`, as much of it as travels.
///
/// Every field Audiola writes that Videola has no counterpart for is carried through untouched in
/// `extra`, so a file that goes there, comes here and goes back keeps its mastering chain, its EQ and
/// its spatial layout. Dropping them would make a round trip through Videola a way to lose work, and
/// a video editor has no business deciding that a mixer's reverb was unimportant.
///
/// PascalCase because that is what `System.Text.Json` writes with no naming policy set, and Audiola
/// reads its own file case-sensitively.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AudiolaProject {
    #[serde(default = "one")]
    pub version: i32,
    #[serde(default = "unity")]
    pub master_volume: f64,
    #[serde(default)]
    pub tracks: Vec<AudiolaTrack>,
    /// Everything else the file carried. Kept so a round trip does not quietly discard a mix.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AudiolaTrack {
    #[serde(default)]
    pub name: String,
    #[serde(default = "track_colour")]
    pub color_hex: String,
    #[serde(default = "unity")]
    pub volume: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default = "yes")]
    pub is_enabled: bool,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub is_solo: bool,
    #[serde(default)]
    pub clips: Vec<AudiolaClip>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AudiolaClip {
    /// The path inside the archive, `media/…`, which is what Audiola rewrites it to when it saves.
    #[serde(default)]
    pub media: String,
    #[serde(default)]
    pub source_total_seconds: f64,
    #[serde(default)]
    pub timeline_offset_seconds: f64,
    #[serde(default)]
    pub source_start_seconds: f64,
    #[serde(default)]
    pub length_seconds: f64,
    #[serde(default)]
    pub gain_db: f64,
    #[serde(default)]
    pub fade_in_seconds: f64,
    #[serde(default)]
    pub fade_out_seconds: f64,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn one() -> i32 {
    1
}

fn unity() -> f64 {
    1.0
}

fn yes() -> bool {
    true
}

// The colour Audiola gives a new track, so one written from here looks like one written there.
fn track_colour() -> String {
    "#5B8CFF".to_string()
}
