use super::{bounded, finite, MAX_VOLUME};
use crate::format::reader::is_content_hash;
use crate::model::project::MAX_COMPOUND_DEPTH;
use crate::model::{
    Clip, ClipSource, MediaAsset, MediaId, Project, ProjectSettings, Timeline, Track, TrackId,
    TrackKind,
};
use crate::{CoreError, Result};

pub(super) fn set_settings(target: &mut Project, settings: &ProjectSettings) -> Result<()> {
    target.settings = settings.clone();
    Ok(())
}

pub(super) fn set_title(target: &mut Project, title: &str) -> Result<()> {
    target.meta.title = title.to_string();
    Ok(())
}

pub(super) fn add_track(
    target: &mut Project,
    kind: TrackKind,
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

pub(super) fn remove_track(target: &mut Project, track: &TrackId) -> Result<()> {
    let index = target
        .track_index(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target.timeline.tracks.remove(index);
    Ok(())
}

pub(super) fn reorder_track(target: &mut Project, track: &TrackId, to_index: usize) -> Result<()> {
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

pub(super) fn rename_track(target: &mut Project, track: &TrackId, name: &str) -> Result<()> {
    track_mut(target, track)?.name = name.to_string();
    Ok(())
}

pub(super) fn set_track_volume(target: &mut Project, track: &TrackId, volume: f32) -> Result<()> {
    let volume = finite(volume)?;
    track_mut(target, track)?.volume = volume.clamp(0.0, MAX_VOLUME);
    Ok(())
}

pub(super) fn set_track_pan(target: &mut Project, track: &TrackId, pan: f32) -> Result<()> {
    let pan = finite(pan)?;
    track_mut(target, track)?.pan = pan.clamp(-1.0, 1.0);
    Ok(())
}

pub(super) fn set_track_flags(
    target: &mut Project,
    track: &TrackId,
    muted: Option<bool>,
    solo: Option<bool>,
    locked: Option<bool>,
    hidden: Option<bool>,
) -> Result<()> {
    let target_track = track_mut(target, track)?;
    if let Some(value) = muted {
        target_track.muted = value;
    }
    if let Some(value) = solo {
        target_track.solo = value;
    }
    if let Some(value) = locked {
        target_track.locked = value;
    }
    if let Some(value) = hidden {
        target_track.hidden = value;
    }
    Ok(())
}

fn track_mut<'p>(target: &'p mut Project, track: &TrackId) -> Result<&'p mut Track> {
    target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))
}

pub(super) fn import_media(target: &mut Project, asset: &MediaAsset) -> Result<()> {
    validate_new_asset(asset)?;
    // First import wins. Every field but `original_name` is derived purely from the asset's
    // bytes, and an identical id means identical bytes, so an honest second import of the same
    // content contributes nothing new. The metadata is attacker-supplied, though: letting a
    // later import overwrite it would let a second media.import silently rewrite an existing
    // asset's mime/kind and change how every clip already referencing it gets interpreted.
    if !target
        .library
        .iter()
        .any(|existing| existing.id == asset.id)
    {
        target.library.push(asset.clone());
    }
    Ok(())
}

// `media.import` is a trust boundary like every other command: `id` arrives as an arbitrary
// string that `writer::media_entry_name` later interpolates unsanitised into a ZIP entry path,
// and `duration` feeds the same bound `Project::normalize` enforces on load. Rejecting both here
// means a project that dispatches cleanly can also be saved and reopened.
fn validate_new_asset(asset: &MediaAsset) -> Result<()> {
    if !is_content_hash(asset.id.content_hash()) {
        return Err(CoreError::InvalidArgument(
            "media id must be a content hash".into(),
        ));
    }
    if let Some(duration) = asset.duration {
        bounded(duration)?;
    }
    Ok(())
}

pub(super) fn remove_media(target: &mut Project, media: &MediaId) -> Result<()> {
    let before = target.library.len();
    target.library.retain(|asset| &asset.id != media);
    if target.library.len() == before {
        return Err(CoreError::MediaNotAvailable(media.clone()));
    }
    remove_clips_using(&mut target.timeline, media, 0)
}

// A clip using the removed medium can sit inside a Compound clip's own nested timeline, not just
// on a top-level track; leaving it there would be the same dangling reference this command exists
// to prevent, so the walk recurses the same way Project::normalize already does. Unlike
// normalize's walk, this one runs on a fully public Project that `Command::apply` (also public)
// can be handed directly, bypassing `clip.add`'s own normalize step — so it needs its own depth
// cap rather than trusting the caller to have gone through a command that already checked one.
fn remove_clips_using(timeline: &mut Timeline, media: &MediaId, depth: usize) -> Result<()> {
    if depth > MAX_COMPOUND_DEPTH {
        return Err(CoreError::InvalidArgument(
            "compound clip nesting too deep".into(),
        ));
    }
    for track in &mut timeline.tracks {
        track.clips.retain(|clip| !uses_media(clip, media));
        for clip in &mut track.clips {
            // A compound clip that loses every one of its own clips is kept, not deleted: it may
            // still carry other, unrelated clips, or the resulting gap on the parent track may be
            // exactly what the author wants. media.remove only deletes clips that themselves
            // reference the removed medium, never their container.
            if let ClipSource::Compound { timeline: nested } = &mut clip.source {
                remove_clips_using(nested, media, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn uses_media(clip: &Clip, media: &MediaId) -> bool {
    matches!(&clip.source, ClipSource::Media { media: used } if used == media)
}
