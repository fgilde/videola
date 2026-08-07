use super::Command;
use crate::model::{Project, Track, TrackId};
use crate::{CoreError, Result};

const MAX_TRACK_VOLUME: f32 = 4.0;

pub(super) fn apply(command: &Command, target: &mut Project) -> Result<()> {
    match command {
        Command::ProjectSetSettings { settings } => {
            target.settings = settings.clone();
            Ok(())
        }
        Command::ProjectSetTitle { title } => {
            target.meta.title = title.clone();
            Ok(())
        }
        Command::TrackAdd { kind, name, index } => add_track(target, *kind, name, *index),
        Command::TrackRemove { track } => remove_track(target, track),
        Command::TrackReorder { track, to_index } => reorder_track(target, track, *to_index),
        Command::TrackRename { track, name } => {
            track_mut(target, track)?.name = name.clone();
            Ok(())
        }
        Command::TrackSetVolume { track, volume } => {
            track_mut(target, track)?.volume = volume.clamp(0.0, MAX_TRACK_VOLUME);
            Ok(())
        }
        Command::TrackSetPan { track, pan } => {
            track_mut(target, track)?.pan = pan.clamp(-1.0, 1.0);
            Ok(())
        }
        Command::TrackSetFlags {
            track,
            muted,
            solo,
            locked,
            hidden,
        } => {
            let target_track = track_mut(target, track)?;
            if let Some(value) = muted {
                target_track.muted = *value;
            }
            if let Some(value) = solo {
                target_track.solo = *value;
            }
            if let Some(value) = locked {
                target_track.locked = *value;
            }
            if let Some(value) = hidden {
                target_track.hidden = *value;
            }
            Ok(())
        }
        other => Err(CoreError::InvalidArgument(other.label().to_string())),
    }
}

fn add_track(
    target: &mut Project,
    kind: crate::model::TrackKind,
    name: &str,
    index: Option<usize>,
) -> Result<()> {
    let track = Track::new(kind, name.to_string());
    let len = target.timeline.tracks.len();
    match index {
        None => target.timeline.tracks.push(track),
        Some(at) if at <= len => target.timeline.tracks.insert(at, track),
        Some(at) => return Err(CoreError::IndexOutOfRange { index: at, len }),
    }
    Ok(())
}

fn remove_track(target: &mut Project, track: &TrackId) -> Result<()> {
    let index = target
        .track_index(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target.timeline.tracks.remove(index);
    Ok(())
}

fn reorder_track(target: &mut Project, track: &TrackId, to_index: usize) -> Result<()> {
    let from = target
        .track_index(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    let len = target.timeline.tracks.len();
    if to_index >= len {
        return Err(CoreError::IndexOutOfRange {
            index: to_index,
            len,
        });
    }
    let moved = target.timeline.tracks.remove(from);
    target.timeline.tracks.insert(to_index, moved);
    Ok(())
}

fn track_mut<'p>(target: &'p mut Project, track: &TrackId) -> Result<&'p mut Track> {
    target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))
}
