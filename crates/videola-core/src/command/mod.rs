mod clip;
mod marker;
mod project;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{
    Clip, ClipId, ClipSource, Interp, MarkerId, MediaAsset, MediaId, ParamValue, Project,
    ProjectSettings, Time, TrackId, TrackKind, Transform, Transition,
};
use crate::Result;

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Command {
    /// Replace the whole render setting block: resolution, frame rate, sample rate, colour space.
    #[serde(rename = "project.setSettings")]
    ProjectSetSettings { settings: ProjectSettings },
    /// Rename the project.
    #[serde(rename = "project.setTitle")]
    ProjectSetTitle { title: String },
    /// Set the master gain the whole mix passes through, where 1 is unity and 4 the accepted
    /// maximum.
    #[serde(rename = "project.setMasterVolume")]
    ProjectSetMasterVolume { volume: f32 },

    /// Add a track. Without `index` it goes last; index 0 is the bottom of the stack.
    #[serde(rename = "track.add")]
    TrackAdd {
        kind: TrackKind,
        name: String,
        index: Option<usize>,
    },
    /// Remove a track and every clip on it.
    #[serde(rename = "track.remove")]
    TrackRemove { track: TrackId },
    /// Move a track to another position in the stack.
    #[serde(rename = "track.reorder")]
    TrackReorder { track: TrackId, to_index: usize },
    /// Rename a track.
    #[serde(rename = "track.rename")]
    TrackRename { track: TrackId, name: String },
    /// Set a track's gain, where 1 is unity and 4 the accepted maximum.
    #[serde(rename = "track.setVolume")]
    TrackSetVolume { track: TrackId, volume: f32 },
    /// Set a track's stereo position from -1 (left) through 0 (centre) to 1 (right).
    #[serde(rename = "track.setPan")]
    TrackSetPan { track: TrackId, pan: f32 },
    /// Change any subset of a track's flags; a field left null keeps its current value.
    #[serde(rename = "track.setFlags")]
    TrackSetFlags {
        track: TrackId,
        muted: Option<bool>,
        solo: Option<bool>,
        locked: Option<bool>,
        hidden: Option<bool>,
    },

    /// Place a new clip on a track. `source` names a medium already in the library, a generator,
    /// or a nested timeline.
    #[serde(rename = "clip.add")]
    ClipAdd {
        track: TrackId,
        source: ClipSource,
        start: Time,
        duration: Time,
    },
    /// Delete a clip.
    #[serde(rename = "clip.remove")]
    ClipRemove { clip: ClipId },
    /// Move a clip to a new start time, on its own track or another one.
    #[serde(rename = "clip.move")]
    ClipMove {
        clip: ClipId,
        to_track: TrackId,
        start: Time,
    },
    /// Drag one edge of a clip by `delta`. Always compute the delta from the clip's current edge;
    /// a rejected step must not be carried into the next one.
    #[serde(rename = "clip.trim")]
    ClipTrim {
        clip: ClipId,
        edge: TrimEdge,
        delta: Time,
    },
    /// Cut a clip in two at a timeline position strictly inside it.
    #[serde(rename = "clip.split")]
    ClipSplit { clip: ClipId, at: Time },
    /// Delete a clip and pull every later clip on its track back by the gap, leaving none.
    #[serde(rename = "clip.rippleDelete")]
    ClipRippleDelete { clip: ClipId },
    /// Trim one edge like `clip.trim` and move every later clip on the track by the same step, so
    /// no gap opens and none closes. Trimming the head keeps the clip where it is and moves its
    /// material instead.
    #[serde(rename = "clip.rippleTrim")]
    ClipRippleTrim {
        clip: ClipId,
        edge: TrimEdge,
        delta: Time,
    },
    /// Move the cut this clip's edge shares with its neighbour: both clips are trimmed by `delta`,
    /// so the pair keeps its total length. Refused where no clip meets that edge.
    #[serde(rename = "clip.roll")]
    ClipRoll {
        clip: ClipId,
        edge: TrimEdge,
        delta: Time,
    },
    /// Move the material under a clip while the clip stays where it is and keeps its length.
    #[serde(rename = "clip.slip")]
    ClipSlip { clip: ClipId, delta: Time },
    /// Move a clip along its track and let the clips that meet it absorb the step, so everything
    /// around it keeps its total length.
    #[serde(rename = "clip.slide")]
    ClipSlide { clip: ClipId, delta: Time },
    /// Place a copy of a whole clip on a track. Ids and group membership are new; everything else
    /// — material, speed, transform, effects, keyframes — comes from `clip`.
    #[serde(rename = "clip.paste")]
    ClipPaste {
        track: TrackId,
        clip: Box<Clip>,
        start: Time,
    },
    /// Tie clips together, so an editor can select and move them as one. At least two.
    #[serde(rename = "clip.group")]
    ClipGroup { clips: Vec<ClipId> },
    /// Dissolve the group this clip belongs to, for every clip in it.
    #[serde(rename = "clip.ungroup")]
    ClipUngroup { clip: ClipId },
    /// Fold clips into one compound clip covering the span they occupied. The compound lands on
    /// the lowest track any of them was on and holds their own timeline inside it.
    #[serde(rename = "clip.nest")]
    ClipNest { clips: Vec<ClipId> },
    /// Set playback rate and direction. `rate` is a factor in (0, 100]; 1 is unchanged.
    #[serde(rename = "clip.setSpeed")]
    ClipSetSpeed {
        clip: ClipId,
        rate: f32,
        reverse: bool,
        preserve_pitch: bool,
    },
    /// Set a clip's gain, where 1 is unity and 4 the accepted maximum.
    #[serde(rename = "clip.setVolume")]
    ClipSetVolume { clip: ClipId, volume: f32 },
    /// Replace a clip's whole geometry block. Read the current transform and change one field.
    #[serde(rename = "clip.setTransform")]
    ClipSetTransform { clip: ClipId, transform: Transform },
    // A transition belongs to the incoming edge of a clip — the only edge the compositor reads
    // (see `mixPass` in draw-list.ts). `null` clears it, so one command adds, retimes and removes.
    /// Set or clear the transition on a clip's incoming edge; `null` removes it.
    #[serde(rename = "clip.setTransition")]
    ClipSetTransition {
        clip: ClipId,
        transition: Option<Transition>,
    },

    /// Append an effect to the chain of a clip, a track or the project. Adding the same
    /// `effectType` to the same chain twice is a no-op.
    #[serde(rename = "effect.add")]
    EffectAdd {
        target: EffectTarget,
        effect_type: String,
    },
    /// Set one static parameter of an effect already in that chain.
    #[serde(rename = "effect.setParam")]
    EffectSetParam {
        target: EffectTarget,
        effect_type: String,
        key: String,
        value: ParamValue,
    },

    // Keyframes address the same chain `effect.setParam` does, plus one track that belongs to no
    // effect at all: leave `effectType` out and the keys address the clip's own transform. That is
    // what makes a motion path an ordinary keyframe track rather than a second mechanism.
    //
    // `keyframe.add` is an upsert: sending it repeatedly under one coalesce key is what turns a
    // slider drag over a keyframed parameter into a single undo step.
    /// Add or replace the keyframe at `time`. With `effectType` set this addresses an effect
    /// parameter, which then overrides the static value from `effect.setParam`; without it, a
    /// field of the clip's transform (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `anchorX`,
    /// `anchorY`, `opacity`, `cropLeft`, `cropTop`, `cropRight`, `cropBottom`), which then
    /// overrides the matching field of `clip.setTransform`.
    #[serde(rename = "keyframe.add")]
    KeyframeAdd {
        target: EffectTarget,
        effect_type: Option<String>,
        key: String,
        time: Time,
        value: ParamValue,
        interp: Interp,
    },
    /// Remove the keyframe at `time`.
    #[serde(rename = "keyframe.remove")]
    KeyframeRemove {
        target: EffectTarget,
        effect_type: Option<String>,
        key: String,
        time: Time,
    },
    /// Move a keyframe from one time to another, keeping its value and interpolation.
    #[serde(rename = "keyframe.move")]
    KeyframeMove {
        target: EffectTarget,
        effect_type: Option<String>,
        key: String,
        from: Time,
        to: Time,
    },
    /// Change how a keyframe interpolates towards the next one.
    #[serde(rename = "keyframe.setInterp")]
    KeyframeSetInterp {
        target: EffectTarget,
        effect_type: Option<String>,
        key: String,
        time: Time,
        interp: Interp,
    },

    /// Put a marker on the timeline at `time`.
    #[serde(rename = "marker.add")]
    MarkerAdd { time: Time, label: String },
    /// Remove a marker.
    #[serde(rename = "marker.remove")]
    MarkerRemove { marker: MarkerId },
    /// Change a marker's label.
    #[serde(rename = "marker.rename")]
    MarkerRename { marker: MarkerId, label: String },

    /// Put an asset into the library. The id must be `med_` followed by the SHA-256 of the file's
    /// bytes, so importing the same file twice yields the same id.
    #[serde(rename = "media.import")]
    MediaImport { asset: MediaAsset },
    /// Remove an asset from the library along with every clip that uses it.
    #[serde(rename = "media.remove")]
    MediaRemove { media: MediaId },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TrimEdge {
    Start,
    End,
}

/// Which effect chain a command addresses. A clip's, a track's, or the project's own mastering
/// chain — three places in the model, one address, so an equaliser is authored, automated and
/// undone by exactly the commands a clip effect already uses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EffectTarget {
    Clip { clip: ClipId },
    Track { track: TrackId },
    Project,
}

impl Command {
    pub fn apply(&self, target: &mut Project) -> Result<()> {
        match self {
            Self::ProjectSetSettings { settings } => project::set_settings(target, settings),
            Self::ProjectSetTitle { title } => project::set_title(target, title),
            Self::ProjectSetMasterVolume { volume } => project::set_master_volume(target, *volume),
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
            Self::ClipRippleDelete { clip } => clip::ripple_delete(target, clip),
            Self::ClipRippleTrim { clip, edge, delta } => {
                clip::ripple_trim(target, clip, *edge, *delta)
            }
            Self::ClipRoll { clip, edge, delta } => clip::roll(target, clip, *edge, *delta),
            Self::ClipSlip { clip, delta } => clip::slip(target, clip, *delta),
            Self::ClipSlide { clip, delta } => clip::slide(target, clip, *delta),
            Self::ClipPaste { track, clip, start } => clip::paste(target, track, clip, *start),
            Self::ClipGroup { clips } => clip::group(target, clips),
            Self::ClipUngroup { clip } => clip::ungroup(target, clip),
            Self::ClipNest { clips } => clip::nest(target, clips),
            Self::ClipSetSpeed {
                clip,
                rate,
                reverse,
                preserve_pitch,
            } => clip::set_speed(target, clip, *rate, *reverse, *preserve_pitch),
            Self::ClipSetVolume { clip, volume } => clip::set_volume(target, clip, *volume),
            Self::ClipSetTransform { clip, transform } => {
                clip::set_transform(target, clip, transform)
            }
            Self::ClipSetTransition { clip, transition } => {
                clip::set_transition(target, clip, transition.as_ref())
            }
            Self::EffectAdd {
                target: at,
                effect_type,
            } => clip::add_effect(target, at, effect_type),
            Self::EffectSetParam {
                target: at,
                effect_type,
                key,
                value,
            } => clip::set_effect_param(target, at, effect_type, key, value.clone()),
            Self::KeyframeAdd {
                target: at,
                effect_type,
                key,
                time,
                value,
                interp,
            } => clip::add_keyframe(
                target,
                at,
                effect_type.as_deref(),
                key,
                *time,
                value.clone(),
                *interp,
            ),
            Self::KeyframeRemove {
                target: at,
                effect_type,
                key,
                time,
            } => clip::remove_keyframe(target, at, effect_type.as_deref(), key, *time),
            Self::KeyframeMove {
                target: at,
                effect_type,
                key,
                from,
                to,
            } => clip::move_keyframe(target, at, effect_type.as_deref(), key, *from, *to),
            Self::KeyframeSetInterp {
                target: at,
                effect_type,
                key,
                time,
                interp,
            } => clip::set_keyframe_interp(target, at, effect_type.as_deref(), key, *time, *interp),
            Self::MarkerAdd { time, label } => marker::add(target, *time, label),
            Self::MarkerRemove { marker } => marker::remove(target, marker),
            Self::MarkerRename { marker, label } => marker::rename(target, marker, label),
            Self::MediaImport { asset } => project::import_media(target, asset),
            Self::MediaRemove { media } => project::remove_media(target, media),
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::ProjectSetSettings { .. } => LABEL_PROJECT_SET_SETTINGS,
            Self::ProjectSetTitle { .. } => LABEL_PROJECT_SET_TITLE,
            Self::ProjectSetMasterVolume { .. } => LABEL_PROJECT_SET_MASTER_VOLUME,
            Self::TrackAdd { .. } => LABEL_TRACK_ADD,
            Self::TrackRemove { .. } => LABEL_TRACK_REMOVE,
            Self::TrackReorder { .. } => LABEL_TRACK_REORDER,
            Self::TrackRename { .. } => LABEL_TRACK_RENAME,
            Self::TrackSetVolume { .. } => LABEL_TRACK_SET_VOLUME,
            Self::TrackSetPan { .. } => LABEL_TRACK_SET_PAN,
            Self::TrackSetFlags { .. } => LABEL_TRACK_SET_FLAGS,
            Self::ClipAdd { .. } => LABEL_CLIP_ADD,
            Self::ClipRemove { .. } => LABEL_CLIP_REMOVE,
            Self::ClipMove { .. } => LABEL_CLIP_MOVE,
            Self::ClipTrim { .. } => LABEL_CLIP_TRIM,
            Self::ClipSplit { .. } => LABEL_CLIP_SPLIT,
            Self::ClipRippleDelete { .. } => LABEL_CLIP_RIPPLE_DELETE,
            Self::ClipRippleTrim { .. } => LABEL_CLIP_RIPPLE_TRIM,
            Self::ClipRoll { .. } => LABEL_CLIP_ROLL,
            Self::ClipSlip { .. } => LABEL_CLIP_SLIP,
            Self::ClipSlide { .. } => LABEL_CLIP_SLIDE,
            Self::ClipPaste { .. } => LABEL_CLIP_PASTE,
            Self::ClipGroup { .. } => LABEL_CLIP_GROUP,
            Self::ClipUngroup { .. } => LABEL_CLIP_UNGROUP,
            Self::ClipNest { .. } => LABEL_CLIP_NEST,
            Self::ClipSetSpeed { .. } => LABEL_CLIP_SET_SPEED,
            Self::ClipSetVolume { .. } => LABEL_CLIP_SET_VOLUME,
            Self::ClipSetTransform { .. } => LABEL_CLIP_SET_TRANSFORM,
            Self::ClipSetTransition { .. } => LABEL_CLIP_SET_TRANSITION,
            Self::EffectAdd { .. } => LABEL_EFFECT_ADD,
            Self::EffectSetParam { .. } => LABEL_EFFECT_SET_PARAM,
            Self::KeyframeAdd { .. } => LABEL_KEYFRAME_ADD,
            Self::KeyframeRemove { .. } => LABEL_KEYFRAME_REMOVE,
            Self::KeyframeMove { .. } => LABEL_KEYFRAME_MOVE,
            Self::KeyframeSetInterp { .. } => LABEL_KEYFRAME_SET_INTERP,
            Self::MarkerAdd { .. } => LABEL_MARKER_ADD,
            Self::MarkerRemove { .. } => LABEL_MARKER_REMOVE,
            Self::MarkerRename { .. } => LABEL_MARKER_RENAME,
            Self::MediaImport { .. } => LABEL_MEDIA_IMPORT,
            Self::MediaRemove { .. } => LABEL_MEDIA_REMOVE,
        }
    }
}

pub const LABEL_PROJECT_SET_SETTINGS: &str = "cmd.project.setSettings";
pub const LABEL_PROJECT_SET_TITLE: &str = "cmd.project.setTitle";
pub const LABEL_PROJECT_SET_MASTER_VOLUME: &str = "cmd.project.setMasterVolume";
pub const LABEL_TRACK_ADD: &str = "cmd.track.add";
pub const LABEL_TRACK_REMOVE: &str = "cmd.track.remove";
pub const LABEL_TRACK_REORDER: &str = "cmd.track.reorder";
pub const LABEL_TRACK_RENAME: &str = "cmd.track.rename";
pub const LABEL_TRACK_SET_VOLUME: &str = "cmd.track.setVolume";
pub const LABEL_TRACK_SET_PAN: &str = "cmd.track.setPan";
pub const LABEL_TRACK_SET_FLAGS: &str = "cmd.track.setFlags";
pub const LABEL_CLIP_ADD: &str = "cmd.clip.add";
pub const LABEL_CLIP_REMOVE: &str = "cmd.clip.remove";
pub const LABEL_CLIP_MOVE: &str = "cmd.clip.move";
pub const LABEL_CLIP_TRIM: &str = "cmd.clip.trim";
pub const LABEL_CLIP_SPLIT: &str = "cmd.clip.split";
pub const LABEL_CLIP_RIPPLE_DELETE: &str = "cmd.clip.rippleDelete";
pub const LABEL_CLIP_RIPPLE_TRIM: &str = "cmd.clip.rippleTrim";
pub const LABEL_CLIP_ROLL: &str = "cmd.clip.roll";
pub const LABEL_CLIP_SLIP: &str = "cmd.clip.slip";
pub const LABEL_CLIP_SLIDE: &str = "cmd.clip.slide";
pub const LABEL_CLIP_PASTE: &str = "cmd.clip.paste";
pub const LABEL_CLIP_GROUP: &str = "cmd.clip.group";
pub const LABEL_CLIP_UNGROUP: &str = "cmd.clip.ungroup";
pub const LABEL_CLIP_NEST: &str = "cmd.clip.nest";
pub const LABEL_CLIP_SET_SPEED: &str = "cmd.clip.setSpeed";
pub const LABEL_CLIP_SET_VOLUME: &str = "cmd.clip.setVolume";
pub const LABEL_CLIP_SET_TRANSFORM: &str = "cmd.clip.setTransform";
pub const LABEL_CLIP_SET_TRANSITION: &str = "cmd.clip.setTransition";
pub const LABEL_EFFECT_ADD: &str = "cmd.effect.add";
pub const LABEL_EFFECT_SET_PARAM: &str = "cmd.effect.setParam";
pub const LABEL_KEYFRAME_ADD: &str = "cmd.keyframe.add";
pub const LABEL_KEYFRAME_REMOVE: &str = "cmd.keyframe.remove";
pub const LABEL_KEYFRAME_MOVE: &str = "cmd.keyframe.move";
pub const LABEL_KEYFRAME_SET_INTERP: &str = "cmd.keyframe.setInterp";
pub const LABEL_MARKER_ADD: &str = "cmd.marker.add";
pub const LABEL_MARKER_REMOVE: &str = "cmd.marker.remove";
pub const LABEL_MARKER_RENAME: &str = "cmd.marker.rename";
pub const LABEL_MEDIA_IMPORT: &str = "cmd.media.import";
pub const LABEL_MEDIA_REMOVE: &str = "cmd.media.remove";

pub const ALL_COMMAND_LABELS: &[&str] = &[
    LABEL_PROJECT_SET_SETTINGS,
    LABEL_PROJECT_SET_TITLE,
    LABEL_PROJECT_SET_MASTER_VOLUME,
    LABEL_TRACK_ADD,
    LABEL_TRACK_REMOVE,
    LABEL_TRACK_REORDER,
    LABEL_TRACK_RENAME,
    LABEL_TRACK_SET_VOLUME,
    LABEL_TRACK_SET_PAN,
    LABEL_TRACK_SET_FLAGS,
    LABEL_CLIP_ADD,
    LABEL_CLIP_REMOVE,
    LABEL_CLIP_MOVE,
    LABEL_CLIP_TRIM,
    LABEL_CLIP_SPLIT,
    LABEL_CLIP_RIPPLE_DELETE,
    LABEL_CLIP_RIPPLE_TRIM,
    LABEL_CLIP_ROLL,
    LABEL_CLIP_SLIP,
    LABEL_CLIP_SLIDE,
    LABEL_CLIP_PASTE,
    LABEL_CLIP_GROUP,
    LABEL_CLIP_UNGROUP,
    LABEL_CLIP_NEST,
    LABEL_CLIP_SET_SPEED,
    LABEL_CLIP_SET_VOLUME,
    LABEL_CLIP_SET_TRANSFORM,
    LABEL_CLIP_SET_TRANSITION,
    LABEL_EFFECT_ADD,
    LABEL_EFFECT_SET_PARAM,
    LABEL_KEYFRAME_ADD,
    LABEL_KEYFRAME_REMOVE,
    LABEL_KEYFRAME_MOVE,
    LABEL_KEYFRAME_SET_INTERP,
    LABEL_MARKER_ADD,
    LABEL_MARKER_REMOVE,
    LABEL_MARKER_RENAME,
    LABEL_MEDIA_IMPORT,
    LABEL_MEDIA_REMOVE,
];

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
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

// The one definition of "finite" the load path and every command handler share; see
// `model::project::finite`.
pub(crate) use crate::model::project::finite;

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
