use std::collections::BTreeMap;
use std::io::{Read, Seek};

use zip::ZipArchive;

use super::model::AudiolaProject;
use super::{flicks_of, gain_to_volume};
use crate::model::{MediaId, Time};
use crate::{CoreError, Result};

/// One Audiola track as Videola would place it, with its media already keyed by content hash.
#[derive(Debug, Clone)]
pub struct ImportedTrack {
    pub name: String,
    pub color_hex: String,
    pub volume: f32,
    pub pan: f32,
    pub muted: bool,
    pub solo: bool,
    pub clips: Vec<ImportedClip>,
}

#[derive(Debug, Clone)]
pub struct ImportedClip {
    pub media: MediaId,
    /// The file name Audiola stored it under, which is what a library entry is called here.
    pub name: String,
    pub start: Time,
    pub duration: Time,
    pub in_point: Time,
    pub volume: f32,
    pub fade_in: Time,
    pub fade_out: Time,
}

/// What an `.audiola` yields: tracks to add, and the bytes behind them.
///
/// Not a `Project`. The point of opening one is to bring a mix into an edit that already exists, so
/// what comes back is something to append — the caller adds a track per entry and a clip per clip,
/// through the same commands a person would. That keeps one undo step per import and no second way
/// for material to reach a timeline.
#[derive(Debug, Clone)]
pub struct AudiolaImport {
    pub tracks: Vec<ImportedTrack>,
    pub media: BTreeMap<MediaId, Vec<u8>>,
    /// What the file held and this could not use, in words, so a silent loss is never silent.
    pub notes: Vec<String>,
}

const MANIFEST: &str = "project.json";

/// Read an `.audiola`.
///
/// Refuses an archive with no `project.json` rather than returning nothing found: a ZIP that is not
/// an Audiola project is a mistake worth naming, and a caller handed an empty import would put an
/// empty track on the timeline and wonder why.
pub fn read_audiola<R: Read + Seek>(source: R) -> Result<AudiolaImport> {
    let mut archive = ZipArchive::new(source)
        .map_err(|error| CoreError::Archive(format!("not a readable archive: {error}")))?;

    let manifest: AudiolaProject = {
        let entry = archive
            .by_name(MANIFEST)
            .map_err(|_| CoreError::NotAProject("no project.json in the archive".into()))?;
        serde_json::from_reader(entry).map_err(|error| {
            CoreError::NotAProject(format!("project.json is unreadable: {error}"))
        })?
    };

    let mut notes = Vec::new();
    let mut media = BTreeMap::new();
    let mut tracks = Vec::new();

    for track in &manifest.tracks {
        let mut clips = Vec::new();
        for clip in &track.clips {
            if clip.media.is_empty() {
                notes.push(format!("a clip on \"{}\" names no file", track.name));
                continue;
            }
            // A length of zero is what Audiola writes for a clip it has not measured yet, and a clip
            // of no length is one Videola's command layer refuses outright.
            if clip.length_seconds <= 0.0 {
                notes.push(format!(
                    "a clip on \"{}\" has no length and was left out",
                    track.name
                ));
                continue;
            }
            let bytes = match read_entry(&mut archive, &clip.media) {
                Some(bytes) => bytes,
                None => {
                    notes.push(format!("{} is named but not in the archive", clip.media));
                    continue;
                }
            };
            // Keyed by the hash of the bytes, like every other medium here: the same file imported
            // from an `.audiola` and dropped on the window is one library entry, not two.
            let id = MediaId::from_bytes(&bytes);
            media.entry(id.clone()).or_insert(bytes);
            clips.push(ImportedClip {
                media: id,
                name: file_name(&clip.media),
                start: flicks_of(clip.timeline_offset_seconds),
                duration: flicks_of(clip.length_seconds),
                in_point: flicks_of(clip.source_start_seconds),
                volume: gain_to_volume(clip.gain_db),
                fade_in: flicks_of(clip.fade_in_seconds),
                fade_out: flicks_of(clip.fade_out_seconds),
            });
        }

        if clips.is_empty() {
            notes.push(format!("\"{}\" held nothing to bring over", track.name));
            continue;
        }
        tracks.push(ImportedTrack {
            name: if track.name.trim().is_empty() {
                "Audiola".to_string()
            } else {
                track.name.clone()
            },
            color_hex: track.color_hex.clone(),
            // Audiola's `IsEnabled` and its `IsMuted` both silence a track; Videola has one flag, so
            // either one arrives as muted rather than one of them being dropped.
            volume: (track.volume.clamp(0.0, 4.0)) as f32,
            pan: (track.pan.clamp(-1.0, 1.0)) as f32,
            muted: track.is_muted || !track.is_enabled,
            solo: track.is_solo,
            clips,
        });
    }

    if tracks.is_empty() {
        notes.push("the file held no track with material on it".to_string());
    }
    // Named rather than silently ignored: somebody who mastered a mix in Audiola should learn from
    // this list that the mastering did not come with it.
    for kept in ["Mastering", "Spatial", "Eq", "Metadata"] {
        if manifest.extra.contains_key(kept) && manifest.extra[kept] != serde_json::Value::Null {
            notes.push(format!(
                "{kept} stays in Audiola: a video editor has no counterpart for it"
            ));
        }
    }

    Ok(AudiolaImport {
        tracks,
        media,
        notes,
    })
}

fn read_entry<R: Read + Seek>(archive: &mut ZipArchive<R>, path: &str) -> Option<Vec<u8>> {
    // Both separators, because the path was written on Windows as often as not and a ZIP is supposed
    // to hold forward slashes either way.
    let candidates = [path.to_string(), path.replace('\\', "/")];
    for candidate in candidates {
        if let Ok(mut entry) = archive.by_name(&candidate) {
            let mut bytes = Vec::new();
            if entry.read_to_end(&mut bytes).is_ok() {
                return Some(bytes);
            }
        }
    }
    None
}

fn file_name(path: &str) -> String {
    let tail = path.rsplit(['/', '\\']).next().unwrap_or(path);
    // Audiola prefixes each file with its index to keep names unique inside the archive. The number
    // is the archive's business and not part of what the file is called.
    match tail.split_once('_') {
        Some((prefix, rest))
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit()) =>
        {
            rest.to_string()
        }
        _ => tail.to_string(),
    }
}
