use super::{find_clip_mut, Command, TrimEdge};
use crate::model::{Clip, ClipId, ClipSource, Effect, ParamValue, Project, Time, TrackId};
use crate::{CoreError, Result};

pub(super) fn apply(command: &Command, target: &mut Project) -> Result<()> {
    match command {
        Command::ClipAdd {
            track,
            source,
            start,
            duration,
        } => add(target, track, source.clone(), *start, *duration),
        Command::ClipRemove { clip } => remove(target, clip),
        Command::ClipMove {
            clip,
            to_track,
            start,
        } => move_clip(target, clip, to_track, *start),
        Command::ClipTrim { clip, edge, delta } => trim(target, clip, *edge, *delta),
        Command::ClipSplit { clip, at } => split(target, clip, *at),
        Command::ClipSetSpeed {
            clip,
            rate,
            reverse,
            preserve_pitch,
        } => set_speed(target, clip, *rate, *reverse, *preserve_pitch),
        Command::ClipSetVolume { clip, volume } => {
            let (track, index) = find_clip_mut(target, clip)?;
            track.clips[index].volume = volume.clamp(0.0, 4.0);
            Ok(())
        }
        Command::EffectAdd { clip, effect_type } => add_effect(target, clip, effect_type),
        Command::EffectSetParam {
            clip,
            effect_type,
            key,
            value,
        } => set_effect_param(target, clip, effect_type, key, value.clone()),
        other => Err(CoreError::InvalidArgument(other.label().to_string())),
    }
}

fn add(
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
    let mut clip = Clip::new_media(crate::model::MediaId::from(String::new()), start, duration);
    clip.source = source;
    clip.start = start.clamp_min_zero();
    let target_track = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target_track.clips.push(clip);
    sort_clips(target_track);
    Ok(())
}

fn remove(target: &mut Project, clip: &ClipId) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips.remove(index);
    Ok(())
}

fn move_clip(target: &mut Project, clip: &ClipId, to_track: &TrackId, start: Time) -> Result<()> {
    if target.track_index(to_track).is_none() {
        return Err(CoreError::TrackNotFound(to_track.clone()));
    }
    let (source_track, index) = find_clip_mut(target, clip)?;
    let mut moved = source_track.clips.remove(index);
    moved.start = start.clamp_min_zero();
    let destination = target
        .track_mut(to_track)
        .ok_or_else(|| CoreError::TrackNotFound(to_track.clone()))?;
    destination.clips.push(moved);
    sort_clips(destination);
    Ok(())
}

fn trim(target: &mut Project, clip: &ClipId, edge: TrimEdge, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = &track.clips[index];
    let (start, duration, in_point) = match edge {
        TrimEdge::Start => (
            current.start + delta,
            current.duration - delta,
            current.in_point + delta,
        ),
        TrimEdge::End => (current.start, current.duration + delta, current.in_point),
    };
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "trim would empty the clip".into(),
        ));
    }
    if start.as_flicks() < 0 || in_point.as_flicks() < 0 {
        return Err(CoreError::InvalidArgument(
            "trim would move before zero".into(),
        ));
    }
    let clip = &mut track.clips[index];
    clip.start = start;
    clip.duration = duration;
    clip.in_point = in_point;
    Ok(())
}

fn split(target: &mut Project, clip: &ClipId, at: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let left = &track.clips[index];
    if at <= left.start || at >= left.end() {
        return Err(CoreError::InvalidArgument(
            "split point outside the clip".into(),
        ));
    }
    let consumed = at - left.start;
    let source_offset = Time::from_seconds(consumed.as_seconds() * left.speed.rate as f64);

    let mut right = left.clone();
    right.id = ClipId::new();
    right.start = at;
    right.duration = left.duration - consumed;
    right.in_point = left.in_point + source_offset;
    right.transition_in = None;

    let left = &mut track.clips[index];
    left.duration = consumed;
    left.transition_out = None;

    track.clips.insert(index + 1, right);
    Ok(())
}

fn set_speed(
    target: &mut Project,
    clip: &ClipId,
    rate: f32,
    reverse: bool,
    preserve_pitch: bool,
) -> Result<()> {
    if !(rate.is_finite() && rate > 0.0) {
        return Err(CoreError::InvalidArgument("rate must be positive".into()));
    }
    let (track, index) = find_clip_mut(target, clip)?;
    let clip = &mut track.clips[index];
    clip.speed.rate = rate;
    clip.speed.reverse = reverse;
    clip.speed.preserve_pitch = preserve_pitch;
    Ok(())
}

fn add_effect(target: &mut Project, clip: &ClipId, effect_type: &str) -> Result<()> {
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

fn set_effect_param(
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
