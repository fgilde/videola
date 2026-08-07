use super::{find_clip_mut, finite, TrimEdge, MAX_VOLUME};
use crate::model::{Clip, ClipId, ClipSource, Effect, MediaId, ParamValue, Project, Time, TrackId};
use crate::{CoreError, Result};

pub(super) fn add(
    target: &mut Project,
    track: &TrackId,
    source: ClipSource,
    start: Time,
    duration: Time,
) -> Result<()> {
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "duration must be positive".into(),
        ));
    }
    let start = bounded(start.clamp_min_zero())?;
    let duration = bounded(duration)?;
    bounded(checked_add(start, duration)?)?;

    let mut clip = Clip::new_media(MediaId::from(String::new()), start, duration);
    clip.source = source;
    crate::model::project::normalize_new_clip(&mut clip)?;
    let target_track = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target_track.clips.push(clip);
    sort_clips(target_track);
    Ok(())
}

pub(super) fn remove(target: &mut Project, clip: &ClipId) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips.remove(index);
    Ok(())
}

pub(super) fn move_clip(
    target: &mut Project,
    clip: &ClipId,
    to_track: &TrackId,
    start: Time,
) -> Result<()> {
    if target.track_index(to_track).is_none() {
        return Err(CoreError::TrackNotFound(to_track.clone()));
    }
    let start = bounded(start.clamp_min_zero())?;
    let (source_track, index) = find_clip_mut(target, clip)?;
    bounded(checked_add(start, source_track.clips[index].duration)?)?;
    let mut moved = source_track.clips.remove(index);
    moved.start = start;
    let destination = target
        .track_mut(to_track)
        .ok_or_else(|| CoreError::TrackNotFound(to_track.clone()))?;
    destination.clips.push(moved);
    sort_clips(destination);
    Ok(())
}

pub(super) fn trim(target: &mut Project, clip: &ClipId, edge: TrimEdge, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = track.clips[index].clone();
    let (start, duration, in_point) = trimmed_fields(&current, edge, delta)?;
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "trim would empty the clip".into(),
        ));
    }
    let start = bounded(start)?;
    let duration = bounded(duration)?;
    let in_point = bounded(in_point)?;
    bounded(checked_add(start, duration)?)?;

    let clip = &mut track.clips[index];
    clip.start = start;
    clip.duration = duration;
    clip.in_point = in_point;
    Ok(())
}

// A reversed clip maps its timeline start to the *end* of the consumed source range (see
// Clip::source_time_at), so the edge that owns in_point flips too: forward trims the head by
// advancing in_point, reverse trims the tail by advancing it instead. Both branches derive the
// shift from a probe clip's own consumed_source()/out_point() rather than repeating the
// duration*rate multiplication, so the rounding always matches what Clip itself would compute.
fn trimmed_fields(current: &Clip, edge: TrimEdge, delta: Time) -> Result<(Time, Time, Time)> {
    match (edge, current.speed.reverse) {
        (TrimEdge::Start, false) => {
            let start = checked_add(current.start, delta)?;
            let duration = checked_sub(current.duration, delta)?;
            let mut probe = current.clone();
            probe.duration = delta;
            let in_point = checked_add(current.in_point, probe.consumed_source())?;
            Ok((start, duration, in_point))
        }
        (TrimEdge::End, false) => {
            let duration = checked_add(current.duration, delta)?;
            Ok((current.start, duration, current.in_point))
        }
        (TrimEdge::Start, true) => {
            let start = checked_add(current.start, delta)?;
            let duration = checked_sub(current.duration, delta)?;
            Ok((start, duration, current.in_point))
        }
        (TrimEdge::End, true) => {
            let duration = checked_add(current.duration, delta)?;
            let mut probe = current.clone();
            probe.duration = duration;
            let in_point = checked_sub(current.out_point(), probe.consumed_source())?;
            Ok((current.start, duration, in_point))
        }
    }
}

pub(super) fn split(target: &mut Project, clip: &ClipId, at: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let original = track.clips[index].clone();
    let at = bounded(at)?;
    if at <= original.start || at >= original.end() {
        return Err(CoreError::InvalidArgument(
            "split point outside the clip".into(),
        ));
    }
    let consumed = checked_sub(at, original.start)?;
    let remaining = checked_sub(original.duration, consumed)?;

    let mut left = original.clone();
    left.duration = consumed;
    left.transition_out = None;

    let mut right = original.clone();
    right.id = ClipId::new();
    right.start = at;
    right.duration = remaining;
    right.transition_in = None;
    // a transition belongs to the edge it was authored on; the split creates a brand-new
    // boundary in the middle that never had one, so both new outer edges start clean.

    if original.speed.reverse {
        // reversed: the earlier half must keep the original's out_point (the source position
        // its own start already mapped to); the later half keeps in_point unchanged.
        left.in_point = checked_sub(original.out_point(), left.consumed_source())?;
        right.in_point = original.in_point;
    } else {
        right.in_point = left.out_point();
    }

    track.clips[index] = left;
    track.clips.insert(index + 1, right);
    Ok(())
}

// Above this, consumed_source()'s `as i64` cast starts saturating instead of overflowing
// cleanly, which would silently corrupt the source range rather than raising an error.
const MAX_SPEED_RATE: f32 = 100.0;

pub(super) fn set_speed(
    target: &mut Project,
    clip: &ClipId,
    rate: f32,
    reverse: bool,
    preserve_pitch: bool,
) -> Result<()> {
    let rate = finite(rate)?;
    if !(0.0 < rate && rate <= MAX_SPEED_RATE) {
        return Err(CoreError::InvalidArgument(
            "rate must be positive and at most 100".into(),
        ));
    }
    let (track, index) = find_clip_mut(target, clip)?;
    let clip = &mut track.clips[index];
    clip.speed.rate = rate;
    clip.speed.reverse = reverse;
    clip.speed.preserve_pitch = preserve_pitch;
    Ok(())
}

pub(super) fn set_volume(target: &mut Project, clip: &ClipId, volume: f32) -> Result<()> {
    let volume = finite(volume)?;
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index].volume = volume.clamp(0.0, MAX_VOLUME);
    Ok(())
}

pub(super) fn add_effect(target: &mut Project, clip: &ClipId, effect_type: &str) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let effects = &mut track.clips[index].effects;
    if effects
        .iter()
        .any(|effect| effect.effect_type == effect_type)
    {
        return Ok(());
    }
    effects.push(Effect::new(effect_type));
    Ok(())
}

pub(super) fn set_effect_param(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    value: ParamValue,
) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let effect = track.clips[index]
        .effects
        .iter_mut()
        .find(|effect| effect.effect_type == effect_type)
        .ok_or_else(|| CoreError::InvalidArgument(format!("effect not on clip: {effect_type}")))?;
    effect.params.insert(key.to_string(), value);
    Ok(())
}

fn sort_clips(track: &mut crate::model::Track) {
    track.clips.sort_by_key(|clip| clip.start.as_flicks());
}

fn checked_add(a: Time, b: Time) -> Result<Time> {
    a.checked_add(b)
        .ok_or_else(|| CoreError::InvalidArgument("time overflow".into()))
}

fn checked_sub(a: Time, b: Time) -> Result<Time> {
    a.checked_sub(b)
        .ok_or_else(|| CoreError::InvalidArgument("time overflow".into()))
}

fn bounded(t: Time) -> Result<Time> {
    if t.as_flicks() < 0 || t > Time::MAX_REASONABLE {
        Err(CoreError::InvalidArgument("time value out of range".into()))
    } else {
        Ok(t)
    }
}
