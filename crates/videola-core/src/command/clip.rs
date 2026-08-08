use super::{bounded, find_clip_mut, finite, TrimEdge, MAX_VOLUME};
use crate::model::keyframe::sort_track;
use crate::model::{
    Clip, ClipId, ClipSource, Effect, GroupId, Interp, Keyframe, MediaId, ParamValue, Project,
    Time, TrackId, Transform, Transition,
};
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
    let trimmed = trimmed(&track.clips[index], edge, delta)?;
    write_trim(&mut track.clips[index], trimmed);
    Ok(())
}

// What a trim would leave behind, or the refusal. Separated from writing it because roll and slide
// trim two clips at once and must refuse both or neither -- a check that runs after the first clip
// is already written is not a refusal, it is half an edit.
struct Trimmed {
    start: Time,
    duration: Time,
    in_point: Time,
}

fn trimmed(current: &Clip, edge: TrimEdge, delta: Time) -> Result<Trimmed> {
    let (start, duration, in_point) = trimmed_fields(current, edge, delta)?;
    checked_trim(start, duration, in_point)
}

fn checked_trim(start: Time, duration: Time, in_point: Time) -> Result<Trimmed> {
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "trim would empty the clip".into(),
        ));
    }
    let start = bounded(start)?;
    let duration = bounded(duration)?;
    let in_point = bounded(in_point)?;
    bounded(checked_add(start, duration)?)?;
    Ok(Trimmed {
        start,
        duration,
        in_point,
    })
}

fn write_trim(clip: &mut Clip, trimmed: Trimmed) {
    clip.start = trimmed.start;
    clip.duration = trimmed.duration;
    clip.in_point = trimmed.in_point;
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

pub(super) fn ripple_delete(target: &mut Project, clip: &ClipId) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let removed = track.clips[index].clone();
    track.clips.remove(index);
    // Cannot fail: a clip that starts at or after the removed one's end starts at least a whole
    // `duration` past zero, so pulling it back by that much stays in range.
    shift_from(
        &mut track.clips,
        removed.end(),
        Time::ZERO - removed.duration,
    )
}

pub(super) fn ripple_trim(
    target: &mut Project,
    clip: &ClipId,
    edge: TrimEdge,
    delta: Time,
) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = track.clips[index].clone();
    let (start, duration, in_point) = trimmed_fields(&current, edge, delta)?;
    // Trimming the head moves the material, not the clip: the clip stays butted against whatever
    // is in front of it, and the step is paid by everything behind it instead. Which is also why
    // this cannot go through `trimmed` -- that one would refuse a head extension at time zero for
    // a start the ripple never moves.
    let start = match edge {
        TrimEdge::Start => current.start,
        TrimEdge::End => start,
    };
    let trimmed = checked_trim(start, duration, in_point)?;
    let shift = checked_sub(checked_add(trimmed.start, trimmed.duration)?, current.end())?;
    // The followers go first because they are the pass that can still refuse; the trimmed clip
    // itself starts before its own old end, so `shift_from` never touches it.
    shift_from(&mut track.clips, current.end(), shift)?;
    write_trim(&mut track.clips[index], trimmed);
    Ok(())
}

pub(super) fn roll(target: &mut Project, clip: &ClipId, edge: TrimEdge, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = track.clips[index].clone();
    let other = meeting(&track.clips, &current, edge)
        .ok_or_else(|| CoreError::InvalidArgument("no clip meets that edge of this one".into()))?;
    let mine = trimmed(&current, edge, delta)?;
    let theirs = trimmed(&track.clips[other], opposite(edge), delta)?;
    write_trim(&mut track.clips[index], mine);
    write_trim(&mut track.clips[other], theirs);
    Ok(())
}

pub(super) fn slip(target: &mut Project, clip: &ClipId, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = track.clips[index].clone();
    // The source shift comes from a probe clip's own `consumed_source`, the way `trimmed_fields`
    // does it, so a slip at a rate other than 1 lands where a trim of the same size would.
    let mut probe = current.clone();
    probe.duration = delta;
    let shift = probe.consumed_source();
    // A reversed clip maps a later timeline instant to an earlier source instant, so pushing its
    // material forward in time means reading from further back.
    let in_point = if current.speed.reverse {
        checked_sub(current.in_point, shift)?
    } else {
        checked_add(current.in_point, shift)?
    };
    track.clips[index].in_point = bounded(in_point)?;
    Ok(())
}

pub(super) fn slide(target: &mut Project, clip: &ClipId, delta: Time) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let current = track.clips[index].clone();
    let start = bounded(checked_add(current.start, delta)?)?;
    bounded(checked_add(start, current.duration)?)?;
    let before = meeting(&track.clips, &current, TrimEdge::Start);
    let after = meeting(&track.clips, &current, TrimEdge::End);
    // Both neighbours are judged before either is written, so a slide that would empty one of them
    // moves nothing at all.
    let grow = before
        .map(|at| trimmed(&track.clips[at], TrimEdge::End, delta))
        .transpose()?;
    let shrink = after
        .map(|at| trimmed(&track.clips[at], TrimEdge::Start, delta))
        .transpose()?;
    if let (Some(at), Some(trimmed)) = (before, grow) {
        write_trim(&mut track.clips[at], trimmed);
    }
    if let (Some(at), Some(trimmed)) = (after, shrink) {
        write_trim(&mut track.clips[at], trimmed);
    }
    track.clips[index].start = start;
    Ok(())
}

pub(super) fn paste(
    target: &mut Project,
    track: &TrackId,
    source: &Clip,
    start: Time,
) -> Result<()> {
    if target.track_index(track).is_none() {
        return Err(CoreError::TrackNotFound(track.clone()));
    }
    if source.duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "duration must be positive".into(),
        ));
    }
    let mut clip = source.clone();
    clip.start = bounded(start.clamp_min_zero())?;
    bounded(checked_add(clip.start, clip.duration)?)?;
    // Normalised before the ids are minted, not after: it is the depth cap in there that bounds
    // `fresh_ids`' recursion over a nested timeline that arrived from the wire.
    crate::model::project::normalize_new_clip(&mut clip)?;
    // A pasted clip carries the original's material and look, not its identity, and not its
    // membership in a group the original happens to be in.
    clip.group_id = None;
    fresh_ids(&mut clip);
    let target_track = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target_track.clips.push(clip);
    sort_clips(target_track);
    Ok(())
}

pub(super) fn group(target: &mut Project, clips: &[ClipId]) -> Result<()> {
    if clips.len() < 2 {
        return Err(CoreError::InvalidArgument(
            "a group needs at least two clips".into(),
        ));
    }
    // Every id is looked up before the first one is written, so a group naming one clip that does
    // not exist leaves the others as they were.
    for clip in clips {
        find_clip_mut(target, clip)?;
    }
    let group = GroupId::new();
    for clip in clips {
        let (track, index) = find_clip_mut(target, clip)?;
        track.clips[index].group_id = Some(group.clone());
    }
    Ok(())
}

pub(super) fn ungroup(target: &mut Project, clip: &ClipId) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    let group = track.clips[index]
        .group_id
        .clone()
        .ok_or_else(|| CoreError::InvalidArgument("this clip is in no group".into()))?;
    // A group spans tracks, so dissolving it is a walk over all of them rather than over the one
    // the named clip happens to sit on.
    for track in target.timeline.tracks.iter_mut() {
        for clip in track.clips.iter_mut() {
            if clip.group_id.as_ref() == Some(&group) {
                clip.group_id = None;
            }
        }
    }
    Ok(())
}

// Everything that begins at or after `from` moves by `shift`. A clip that merely reaches across
// `from` keeps its place: it is not part of the run being closed up, and moving it would trade a
// gap for an overlap nobody authored.
fn shift_from(clips: &mut [Clip], from: Time, shift: Time) -> Result<()> {
    let moved: Vec<usize> = clips
        .iter()
        .enumerate()
        .filter(|(_, clip)| clip.start >= from)
        .map(|(index, _)| index)
        .collect();
    for &index in &moved {
        let start = bounded(checked_add(clips[index].start, shift)?)?;
        bounded(checked_add(start, clips[index].duration)?)?;
    }
    for &index in &moved {
        clips[index].start = clips[index].start + shift;
    }
    Ok(())
}

// The clip whose own edge sits exactly where this clip's `edge` is. Roll needs one and slide uses
// whichever exists; both ask the same question, and asking it of the sorted neighbour index alone
// would miss the answer as soon as two clips on the track overlap.
fn meeting(clips: &[Clip], current: &Clip, edge: TrimEdge) -> Option<usize> {
    let cut = match edge {
        TrimEdge::Start => current.start,
        TrimEdge::End => current.end(),
    };
    // No guard against matching `current` itself: that would need its own end to equal its own
    // start, and a clip with a duration of zero is refused everywhere one can be made.
    clips.iter().position(|other| match edge {
        TrimEdge::Start => other.end() == cut,
        TrimEdge::End => other.start == cut,
    })
}

fn opposite(edge: TrimEdge) -> TrimEdge {
    match edge {
        TrimEdge::Start => TrimEdge::End,
        TrimEdge::End => TrimEdge::Start,
    }
}

// A compound clip carries whole tracks of clips with ids of their own, so a shallow copy would put
// the same clip id in the project twice.
fn fresh_ids(clip: &mut Clip) {
    clip.id = ClipId::new();
    if let ClipSource::Compound { timeline } = &mut clip.source {
        for track in &mut timeline.tracks {
            track.id = TrackId::new();
            for nested in &mut track.clips {
                fresh_ids(nested);
            }
        }
    }
}

pub(super) fn set_speed(
    target: &mut Project,
    clip: &ClipId,
    rate: f32,
    reverse: bool,
    preserve_pitch: bool,
) -> Result<()> {
    crate::model::project::speed_rate_bounded(rate)?;
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

pub(super) fn set_transform(
    target: &mut Project,
    clip: &ClipId,
    transform: &Transform,
) -> Result<()> {
    crate::model::project::transform_finite(transform)?;
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index].transform = transform.clone();
    Ok(())
}

pub(super) fn set_transition(
    target: &mut Project,
    clip: &ClipId,
    transition: Option<&Transition>,
) -> Result<()> {
    if let Some(transition) = transition {
        crate::model::project::transition_bounded(transition)?;
    }
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index].transition_in = transition.cloned();
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
    crate::model::project::param_value_finite(&value)?;
    let effect = find_effect_mut(target, clip, effect_type)?;
    effect.params.insert(key.to_string(), value);
    Ok(())
}

// Replaces the keyframe already sitting at `time` rather than adding a second one there: two keys
// at the same instant have no defined order, and the upsert is what lets a slider drag over a
// keyframed parameter repeat this command under one coalesce key.
pub(super) fn add_keyframe(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    time: Time,
    value: ParamValue,
    interp: Interp,
) -> Result<()> {
    let keyframe = Keyframe {
        time,
        value,
        interp,
        handle_in: None,
        handle_out: None,
    };
    crate::model::project::keyframe_bounded(&keyframe)?;
    let effect = find_effect_mut(target, clip, effect_type)?;
    let track = effect.keyframes.entry(key.to_string()).or_default();
    match track.iter_mut().find(|existing| existing.time == time) {
        Some(existing) => *existing = keyframe,
        None => {
            track.push(keyframe);
            sort_track(track);
        }
    }
    Ok(())
}

pub(super) fn remove_keyframe(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    time: Time,
) -> Result<()> {
    let effect = find_effect_mut(target, clip, effect_type)?;
    let (track, index) = keyframe_at(effect, key, time)?;
    track.remove(index);
    // An empty track would still read as "keyframed" in the JSON while `param_at` has already
    // fallen back to the static value — the last removal takes the parameter back off the clock.
    if track.is_empty() {
        effect.keyframes.remove(key);
    }
    Ok(())
}

pub(super) fn move_keyframe(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    from: Time,
    to: Time,
) -> Result<()> {
    bounded(to)?;
    let effect = find_effect_mut(target, clip, effect_type)?;
    let (track, index) = keyframe_at(effect, key, from)?;
    if from != to && track.iter().any(|keyframe| keyframe.time == to) {
        return Err(CoreError::InvalidArgument(
            "a keyframe already sits at that time".into(),
        ));
    }
    track[index].time = to;
    sort_track(track);
    Ok(())
}

pub(super) fn set_keyframe_interp(
    target: &mut Project,
    clip: &ClipId,
    effect_type: &str,
    key: &str,
    time: Time,
    interp: Interp,
) -> Result<()> {
    let effect = find_effect_mut(target, clip, effect_type)?;
    let (track, index) = keyframe_at(effect, key, time)?;
    track[index].interp = interp;
    Ok(())
}

fn find_effect_mut<'p>(
    target: &'p mut Project,
    clip: &ClipId,
    effect_type: &str,
) -> Result<&'p mut Effect> {
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index]
        .effects
        .iter_mut()
        .find(|effect| effect.effect_type == effect_type)
        .ok_or_else(|| CoreError::InvalidArgument(format!("effect not on clip: {effect_type}")))
}

// One refusal, not two: "this parameter has no track" and "this track has nothing at that time"
// are the same answer to the caller, and splitting them left the first guard unable to produce an
// outcome the second did not already produce.
fn keyframe_at<'e>(
    effect: &'e mut Effect,
    key: &str,
    time: Time,
) -> Result<(&'e mut Vec<Keyframe>, usize)> {
    let missing = || CoreError::InvalidArgument(format!("no keyframe on {key} at that time"));
    let track = effect.keyframes.get_mut(key).ok_or_else(missing)?;
    let index = track
        .iter()
        .position(|keyframe| keyframe.time == time)
        .ok_or_else(missing)?;
    Ok((track, index))
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
