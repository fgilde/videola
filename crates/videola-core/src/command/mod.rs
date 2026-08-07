mod clip;
mod project;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{
    ClipId, ClipSource, MediaAsset, MediaId, ParamValue, Project, ProjectSettings, Time, TrackId,
    TrackKind,
};
use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    #[serde(rename = "project.setSettings")]
    ProjectSetSettings { settings: ProjectSettings },
    #[serde(rename = "project.setTitle")]
    ProjectSetTitle { title: String },

    #[serde(rename = "track.add")]
    TrackAdd {
        kind: TrackKind,
        name: String,
        index: Option<usize>,
    },
    #[serde(rename = "track.remove")]
    TrackRemove { track: TrackId },
    #[serde(rename = "track.reorder")]
    TrackReorder { track: TrackId, to_index: usize },
    #[serde(rename = "track.rename")]
    TrackRename { track: TrackId, name: String },
    #[serde(rename = "track.setVolume")]
    TrackSetVolume { track: TrackId, volume: f32 },
    #[serde(rename = "track.setPan")]
    TrackSetPan { track: TrackId, pan: f32 },
    #[serde(rename = "track.setFlags")]
    TrackSetFlags {
        track: TrackId,
        muted: Option<bool>,
        solo: Option<bool>,
        locked: Option<bool>,
        hidden: Option<bool>,
    },

    #[serde(rename = "clip.add")]
    ClipAdd {
        track: TrackId,
        source: ClipSource,
        start: Time,
        duration: Time,
    },
    #[serde(rename = "clip.remove")]
    ClipRemove { clip: ClipId },
    #[serde(rename = "clip.move")]
    ClipMove {
        clip: ClipId,
        to_track: TrackId,
        start: Time,
    },
    #[serde(rename = "clip.trim")]
    ClipTrim {
        clip: ClipId,
        edge: TrimEdge,
        delta: Time,
    },
    #[serde(rename = "clip.split")]
    ClipSplit { clip: ClipId, at: Time },
    #[serde(rename = "clip.setSpeed")]
    ClipSetSpeed {
        clip: ClipId,
        rate: f32,
        reverse: bool,
        preserve_pitch: bool,
    },
    #[serde(rename = "clip.setVolume")]
    ClipSetVolume { clip: ClipId, volume: f32 },

    #[serde(rename = "effect.add")]
    EffectAdd { clip: ClipId, effect_type: String },
    #[serde(rename = "effect.setParam")]
    EffectSetParam {
        clip: ClipId,
        effect_type: String,
        key: String,
        value: ParamValue,
    },

    #[serde(rename = "media.import")]
    MediaImport { asset: MediaAsset },
    #[serde(rename = "media.remove")]
    MediaRemove { media: MediaId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum TrimEdge {
    Start,
    End,
}

impl Command {
    pub fn apply(&self, target: &mut Project) -> Result<()> {
        match self {
            Self::ProjectSetSettings { settings } => project::set_settings(target, settings),
            Self::ProjectSetTitle { title } => project::set_title(target, title),
            Self::TrackAdd { kind, name, index } => project::add_track(target, *kind, name, *index),
            Self::TrackRemove { track } => project::remove_track(target, track),
            Self::TrackReorder { track, to_index } => {
                project::reorder_track(target, track, *to_index)
            }
            Self::TrackRename { track, name } => project::rename_track(target, track, name),
            Self::TrackSetVolume { track, volume } => {
                project::set_track_volume(target, track, *volume)
            }
            Self::TrackSetPan { track, pan } => project::set_track_pan(target, track, *pan),
            Self::TrackSetFlags {
                track,
                muted,
                solo,
                locked,
                hidden,
            } => project::set_track_flags(target, track, *muted, *solo, *locked, *hidden),
            Self::ClipAdd {
                track,
                source,
                start,
                duration,
            } => clip::add(target, track, source.clone(), *start, *duration),
            Self::ClipRemove { clip } => clip::remove(target, clip),
            Self::ClipMove {
                clip,
                to_track,
                start,
            } => clip::move_clip(target, clip, to_track, *start),
            Self::ClipTrim { clip, edge, delta } => clip::trim(target, clip, *edge, *delta),
            Self::ClipSplit { clip, at } => clip::split(target, clip, *at),
            Self::ClipSetSpeed {
                clip,
                rate,
                reverse,
                preserve_pitch,
            } => clip::set_speed(target, clip, *rate, *reverse, *preserve_pitch),
            Self::ClipSetVolume { clip, volume } => clip::set_volume(target, clip, *volume),
            Self::EffectAdd { clip, effect_type } => clip::add_effect(target, clip, effect_type),
            Self::EffectSetParam {
                clip,
                effect_type,
                key,
                value,
            } => clip::set_effect_param(target, clip, effect_type, key, value.clone()),
            Self::MediaImport { asset } => project::import_media(target, asset),
            Self::MediaRemove { media } => project::remove_media(target, media),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::ProjectSetSettings { .. } => "cmd.project.setSettings",
            Self::ProjectSetTitle { .. } => "cmd.project.setTitle",
            Self::TrackAdd { .. } => "cmd.track.add",
            Self::TrackRemove { .. } => "cmd.track.remove",
            Self::TrackReorder { .. } => "cmd.track.reorder",
            Self::TrackRename { .. } => "cmd.track.rename",
            Self::TrackSetVolume { .. } => "cmd.track.setVolume",
            Self::TrackSetPan { .. } => "cmd.track.setPan",
            Self::TrackSetFlags { .. } => "cmd.track.setFlags",
            Self::ClipAdd { .. } => "cmd.clip.add",
            Self::ClipRemove { .. } => "cmd.clip.remove",
            Self::ClipMove { .. } => "cmd.clip.move",
            Self::ClipTrim { .. } => "cmd.clip.trim",
            Self::ClipSplit { .. } => "cmd.clip.split",
            Self::ClipSetSpeed { .. } => "cmd.clip.setSpeed",
            Self::ClipSetVolume { .. } => "cmd.clip.setVolume",
            Self::EffectAdd { .. } => "cmd.effect.add",
            Self::EffectSetParam { .. } => "cmd.effect.setParam",
            Self::MediaImport { .. } => "cmd.media.import",
            Self::MediaRemove { .. } => "cmd.media.remove",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Dispatch {
    pub command: Command,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coalesce_key: Option<String>,
}

impl Dispatch {
    pub fn new(command: Command) -> Self {
        Self {
            command,
            coalesce_key: None,
        }
    }

    pub fn coalesce(mut self, key: &str) -> Self {
        self.coalesce_key = Some(key.to_string());
        self
    }
}

pub(crate) fn find_clip_mut<'p>(
    target: &'p mut Project,
    clip: &ClipId,
) -> Result<(&'p mut crate::model::Track, usize)> {
    for track in target.timeline.tracks.iter_mut() {
        if let Some(index) = track.clip_index(clip) {
            return Ok((track, index));
        }
    }
    Err(crate::CoreError::ClipNotFound(clip.clone()))
}

pub(crate) const MAX_VOLUME: f32 = 4.0;

pub(crate) fn finite(value: f32) -> Result<f32> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(crate::CoreError::InvalidArgument(
            "value must be finite".into(),
        ))
    }
}

// Shared by every command that accepts a `Time` from the wire: clip placement, trims, and media
// metadata all need the same bound, defined once in `model::project::bounded`. This wrapper only
// exists because command handlers want the value back to keep using after the check.
pub(crate) fn bounded(t: Time) -> Result<Time> {
    crate::model::project::bounded(t)?;
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ClipId, TrackId, TrackKind};

    #[test]
    fn commands_use_dotted_tags_and_camelcase_fields() {
        let add = Command::TrackAdd {
            kind: TrackKind::Video,
            name: "V1".into(),
            index: None,
        };
        let json = serde_json::to_value(&add).unwrap();
        assert_eq!(json["type"], "track.add");

        let mv = Command::ClipMove {
            clip: ClipId::from("clp_1".to_string()),
            to_track: TrackId::from("trk_1".to_string()),
            start: Time::ZERO,
        };
        let json = serde_json::to_value(&mv).unwrap();
        assert!(json.get("toTrack").is_some());
        assert!(json.get("to_track").is_none());
    }

    // The direction a TypeScript client actually exercises: it sends camelCase, so a regression
    // in rename_all_fields would show up here, not in the serialise-only test above.
    #[test]
    fn a_camelcase_payload_from_a_client_deserialises_correctly() {
        let json = serde_json::json!({
            "type": "clip.move",
            "clip": "clp_1",
            "toTrack": "trk_1",
            "start": 42,
        });
        let command: Command = serde_json::from_value(json).unwrap();
        match command {
            Command::ClipMove {
                clip,
                to_track,
                start,
            } => {
                assert_eq!(clip, ClipId::from("clp_1".to_string()));
                assert_eq!(to_track, TrackId::from("trk_1".to_string()));
                assert_eq!(start, Time::from_flicks(42));
            }
            other => panic!("expected ClipMove, got {other:?}"),
        }
    }
}
