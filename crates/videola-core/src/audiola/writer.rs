use std::io::{Seek, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::model::{AudiolaClip, AudiolaProject, AudiolaTrack};
use super::{seconds_of, volume_to_gain};
use crate::format::MediaStore;
use crate::model::{ClipSource, MediaAsset, MediaKind, Project, TrackKind};
use crate::{CoreError, Result};

/// Write the sounding part of this project as an `.audiola`, so it opens in Audiola.
///
/// **What travels.** Every track carrying media that has sound: an audio track, and a video track
/// whose material has an audio stream — a mixer has no use for a picture, but the sound under one is
/// exactly what somebody would take there. Each clip keeps where it sits, where in the file it
/// starts, how long it is, its gain and its two fades.
///
/// **What does not.** Generators, compound clips, effects, transitions and keyframes. A title has no
/// sound, and a Videola compressor is not an Audiola one — writing either as the other would invent a
/// meaning neither tool agreed to. The count of what was left out comes back, so a caller can say so
/// rather than letting somebody find out in the other program.
///
/// Media are stored the way Audiola stores them, `media/<index>_<name>`, and every clip's `Media` is
/// rewritten to that path — which is what Audiola's own reader expects to find.
pub fn write_audiola<W: Write + Seek>(
    sink: W,
    project: &Project,
    media: &dyn MediaStore,
) -> Result<usize> {
    let mut zip = ZipWriter::new(sink);
    // Stored, not deflated. Audio files are already compressed and a second pass over a hundred
    // megabytes buys bytes nobody notices for seconds everybody does -- the same choice the
    // `.videola` writer makes for the same reason.
    let entry = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    let mut tracks = Vec::new();
    let mut stored: Vec<(String, Vec<u8>)> = Vec::new();
    let mut left_out = 0usize;

    for track in &project.timeline.tracks {
        if matches!(track.kind, TrackKind::Text | TrackKind::Caption) {
            left_out += track.clips.len();
            continue;
        }
        let mut clips = Vec::new();
        for clip in &track.clips {
            let ClipSource::Media { media: id } = &clip.source else {
                // A generator or a compound has no file to hand over. A mixer that received a
                // silent placeholder would show a clip it cannot play.
                left_out += 1;
                continue;
            };
            let Some(asset) = project.library.iter().find(|entry| &entry.id == id) else {
                left_out += 1;
                continue;
            };
            if !has_sound(asset) {
                left_out += 1;
                continue;
            }
            let bytes = media.read(id)?;
            let path = match stored.iter().position(|(_, held)| held == &bytes) {
                Some(index) => format!("media/{index}_{}", safe_name(&asset.original_name)),
                None => {
                    let index = stored.len();
                    let path = format!("media/{index}_{}", safe_name(&asset.original_name));
                    stored.push((path.clone(), bytes));
                    path
                }
            };
            clips.push(AudiolaClip {
                media: path,
                // What the file holds in total, which Audiola draws a clip's handles against. The
                // medium's own duration where it has one, and the clip's own length where it does
                // not -- a zero there makes Audiola draw a clip it thinks is empty.
                source_total_seconds: seconds_of(asset.duration.unwrap_or(clip.duration)),
                timeline_offset_seconds: seconds_of(clip.start),
                source_start_seconds: seconds_of(clip.in_point),
                length_seconds: seconds_of(clip.duration),
                gain_db: volume_to_gain(clip.volume),
                fade_in_seconds: seconds_of(clip.fades.in_duration),
                fade_out_seconds: seconds_of(clip.fades.out_duration),
                extra: serde_json::Map::new(),
            });
        }
        if clips.is_empty() {
            continue;
        }
        tracks.push(AudiolaTrack {
            name: track.name.clone(),
            color_hex: track.color_hex.clone(),
            volume: f64::from(track.volume),
            pan: f64::from(track.pan),
            is_enabled: !track.muted,
            is_muted: track.muted,
            is_solo: track.solo,
            clips,
            extra: serde_json::Map::new(),
        });
    }

    for (path, bytes) in &stored {
        zip.start_file(path, entry)
            .map_err(|error| CoreError::Archive(error.to_string()))?;
        zip.write_all(bytes)?;
    }

    let manifest = AudiolaProject {
        version: 1,
        master_volume: f64::from(project.master.volume),
        tracks,
        extra: serde_json::Map::new(),
    };
    zip.start_file("project.json", entry)
        .map_err(|error| CoreError::Archive(error.to_string()))?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    zip.finish()
        .map_err(|error| CoreError::Archive(error.to_string()))?;
    Ok(left_out)
}

/// Whether this medium has anything for a mixer to play. An audio file always does; a video file does
/// where it declared a sample rate, which is what the importer writes when it finds an audio stream.
fn has_sound(asset: &MediaAsset) -> bool {
    match asset.kind {
        MediaKind::Audio => true,
        MediaKind::Video => asset.sample_rate.is_some(),
        _ => false,
    }
}

/// A name a ZIP entry can carry on every system: no separators, no control characters, and never
/// empty. Audiola shows this to whoever opens the file, so it keeps the extension.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "audio".to_string()
    } else {
        trimmed.to_string()
    }
}
