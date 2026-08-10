use std::collections::BTreeMap;

use super::{bounded, find_clip_mut, finite, EffectTarget, TrimEdge, MAX_VOLUME};
use crate::model::keyframe::sort_track;
use crate::model::{
    Clip, ClipId, ClipSource, Effect, Generator, GroupId, Interp, Keyframe, MediaId, ParamValue,
    Project, Time, TrackId, Transform, Transition, POSITION_TRACK, SPEED_TRACK,
};
use crate::{CoreError, Result};

pub(super) fn add(
    target: &mut Project,
    track: &TrackId,
    source: ClipSource,
    start: Time,
    duration: Time,
) -> Result<()> {
    let clip = made(source, start, duration, Time::ZERO)?;
    let target_track = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    target_track.clips.push(clip);
    sort_clips(target_track);
    Ok(())
}

// The clip `clip.add`, `clip.insert` and `clip.overwrite` all place, judged before any of them
// moves anything. `in_point` is the source in point the range was marked at; `add` has none and
// passes zero, which is what the whole medium means.
fn made(source: ClipSource, start: Time, duration: Time, in_point: Time) -> Result<Clip> {
    if duration.as_flicks() <= 0 {
        return Err(CoreError::InvalidArgument(
            "duration must be positive".into(),
        ));
    }
    let start = bounded(start.clamp_min_zero())?;
    let duration = bounded(duration)?;
    let in_point = bounded(in_point.clamp_min_zero())?;
    bounded(checked_add(start, duration)?)?;
    bounded(checked_add(in_point, duration)?)?;

    let mut clip = Clip::new_media(MediaId::from(String::new()), start, duration);
    clip.source = source;
    clip.in_point = in_point;
    crate::model::project::normalize_new_clip(&mut clip)?;
    Ok(clip)
}

// The three-point edit, insert half. Everything from the insertion point on moves back by the
// length of the material, on every track and not only the one being edited -- an insert that moved
// picture without moving the sound under it would put the whole timeline out of sync, which is the
// one thing the operation must never do.
//
// One command, not a dozen: the gap opens on every track, a clip that reaches across the point is
// cut in two, and the material lands, all inside a single `Command::apply`. The patch the document
// diffs out of it is one undo step whatever the timeline looked like.
//
// ponytail: `track.locked` does not exempt a track. Lock is not enforced anywhere in the core
// today, and honouring it here alone would leave one command as the only authority on what a lock
// means -- and an exempt track would be an overlap nobody authored. When lock becomes a rule, it
// becomes one for `clip.move` and `clip.trim` at the same time.
pub(super) fn insert(
    target: &mut Project,
    track: &TrackId,
    source: ClipSource,
    start: Time,
    duration: Time,
    in_point: Time,
) -> Result<()> {
    if target.track_index(track).is_none() {
        return Err(CoreError::TrackNotFound(track.clone()));
    }
    let clip = made(source, start, duration, in_point)?;
    let (at, gap) = (clip.start, clip.duration);
    for existing in target.timeline.tracks.iter_mut() {
        split_across(existing, at)?;
        shift_from(&mut existing.clips, at, gap)?;
    }
    let destination = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    destination.clips.push(clip);
    sort_clips(destination);
    Ok(())
}

// The other half: the material replaces whatever occupied that span, and nothing moves. Only the
// track being edited is touched, which is what makes an overwrite the operation that leaves the
// total length alone.
//
// Cutting at both edges first is what makes the rest one line: once no clip reaches across either
// edge, every clip is wholly inside the span or wholly outside it.
pub(super) fn overwrite(
    target: &mut Project,
    track: &TrackId,
    source: ClipSource,
    start: Time,
    duration: Time,
    in_point: Time,
) -> Result<()> {
    if target.track_index(track).is_none() {
        return Err(CoreError::TrackNotFound(track.clone()));
    }
    let clip = made(source, start, duration, in_point)?;
    let (at, end) = (clip.start, checked_add(clip.start, clip.duration)?);
    let destination = target
        .track_mut(track)
        .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?;
    split_across(destination, at)?;
    split_across(destination, end)?;
    destination
        .clips
        .retain(|existing| existing.end() <= at || existing.start >= end);
    destination.clips.push(clip);
    sort_clips(destination);
    Ok(())
}

// Cuts every clip that reaches across `at` in two, so a gap opened there opens between two clips
// rather than through the middle of one. Two clips can straddle the same instant wherever a track
// carries an overlap, so this walks the whole track rather than finding one.
fn split_across(track: &mut crate::model::Track, at: Time) -> Result<()> {
    let mut index = 0;
    while index < track.clips.len() {
        let clip = &track.clips[index];
        if clip.start < at && clip.end() > at {
            let (left, right) = halves(clip, at)?;
            track.clips[index] = left;
            track.clips.insert(index + 1, right);
            index += 1;
        }
        index += 1;
    }
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
    let at = bounded(at)?;
    let original = &track.clips[index];
    if at <= original.start || at >= original.end() {
        return Err(CoreError::InvalidArgument(
            "split point outside the clip".into(),
        ));
    }
    let (left, right) = halves(original, at)?;
    track.clips[index] = left;
    track.clips.insert(index + 1, right);
    Ok(())
}

// One clip cut in two at an instant strictly inside it. The one definition of what a cut is, so the
// boundary `clip.split` makes by hand and the ones `clip.insert` and `clip.overwrite` make to clear
// a span are the same cut -- including what happens to the source range and to the transitions.
fn halves(original: &Clip, at: Time) -> Result<(Clip, Clip)> {
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

    Ok((left, right))
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

// Folds clips into a single compound clip. The compound covers the span they occupied and lands on
// the lowest track any of them was on; the nested timeline keeps one track per project track that
// contributed, in project order, so `tracks[0]` is the bottom of the stack inside a compound
// exactly as it is outside one.
//
// Nothing is moved until the whole result has been through `normalize_new_clip`, which is where the
// nesting depth cap applies -- folding a stack of compounds one level too deep must leave the
// timeline as it was rather than half emptied.
pub(super) fn nest(target: &mut Project, clips: &[ClipId]) -> Result<()> {
    let mut located: Vec<(usize, usize)> = Vec::new();
    for id in clips {
        let found = target
            .timeline
            .tracks
            .iter()
            .enumerate()
            .find_map(|(track, candidate)| candidate.clip_index(id).map(|index| (track, index)))
            .ok_or_else(|| CoreError::ClipNotFound(id.clone()))?;
        if !located.contains(&found) {
            located.push(found);
        }
    }
    located.sort_unstable();

    let at = |&(track, index): &(usize, usize)| &target.timeline.tracks[track].clips[index];
    let Some(&host) = located.first() else {
        return Err(CoreError::InvalidArgument(
            "nesting needs at least one clip".into(),
        ));
    };
    let mut span_start = at(&host).start;
    let mut span_end = at(&host).end();
    for found in &located {
        // Ramps and compounds do not mix, in either direction: `speed_track_bounded` refuses a ramp
        // on a compound because the outer rate is inverted by division, and this refuses a ramp
        // *inside* one because folding a nested clip back out multiplies its rate by the outer one
        // and trims its in point by the same factor — neither of which a rate track is. Permitting
        // it would draw the inside of the compound at instants nobody authored, silently. Flatten
        // the ramp or nest first and ramp after.
        if at(found)
            .keyframes
            .get(SPEED_TRACK)
            .is_some_and(|track| !track.is_empty())
        {
            return Err(CoreError::InvalidArgument(
                "a clip with a speed ramp cannot be nested".into(),
            ));
        }
        span_start = span_start.min(at(found).start);
        span_end = span_end.max(at(found).end());
    }
    let duration = checked_sub(span_end, span_start)?;

    let mut timeline = crate::model::Timeline::default();
    for (track_index, group) in by_track(&located) {
        let source = &target.timeline.tracks[track_index];
        let mut nested = source.clone();
        nested.id = TrackId::new();
        nested.clips = group
            .iter()
            .map(|&index| {
                let mut clip = source.clips[index].clone();
                clip.start = clip.start - span_start;
                // The nested clips are no longer separately selectable, so a group they were in
                // would only be reachable from the clips left outside -- and `clip.ungroup` walks
                // the top level, which would dissolve half a group and leave the other half tied.
                clip.group_id = None;
                clip
            })
            .collect();
        timeline.tracks.push(nested);
    }

    let mut compound = Clip::new_media(MediaId::from(String::new()), span_start, duration);
    compound.source = ClipSource::Compound {
        timeline: Box::new(timeline),
    };
    crate::model::project::normalize_new_clip(&mut compound)?;

    // Highest index first, so the indices collected above still address the clips they named.
    for &(track, index) in located.iter().rev() {
        target.timeline.tracks[track].clips.remove(index);
    }
    let track = &mut target.timeline.tracks[host.0];
    track.clips.push(compound);
    sort_clips(track);
    Ok(())
}

// `located` is sorted, so one track's clips are always consecutive.
fn by_track(located: &[(usize, usize)]) -> Vec<(usize, Vec<usize>)> {
    let mut grouped: Vec<(usize, Vec<usize>)> = Vec::new();
    for &(track, index) in located {
        match grouped.last_mut() {
            Some((last, indices)) if *last == track => indices.push(index),
            _ => grouped.push((track, vec![index])),
        }
    }
    grouped
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

// No clamp and nothing to validate: a flag is a flag. Here rather than inline in the dispatch so every
// clip setter is in one file and reads the same way.
pub(super) fn set_enabled(target: &mut Project, clip: &ClipId, enabled: bool) -> Result<()> {
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index].enabled = enabled;
    Ok(())
}

// Bounded at one frame. Longer than that and consecutive output frames would be averaged over
// overlapping windows -- every moment of the material drawn into two frames, which is not a shutter
// any camera has and reads as a dissolve rather than as movement.
pub(super) fn set_motion_blur(target: &mut Project, clip: &ClipId, amount: f32) -> Result<()> {
    let amount = finite(amount)?;
    let (track, index) = find_clip_mut(target, clip)?;
    track.clips[index].motion_blur = amount.clamp(0.0, 1.0);
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

// The counterpart of `set_transform` for a clip's material rather than its geometry, and the only
// way the words of a title or a subtitle can ever change after the clip exists. Refused on a medium
// or a compound: a generator is not something a clip can be given, it is something a clip already
// is, and turning a video clip into a title would leave its in point, speed and trim addressing
// material that is no longer there.
pub(super) fn set_generator(
    target: &mut Project,
    clip: &ClipId,
    generator: &Generator,
) -> Result<()> {
    crate::model::project::generator_bounded(generator)?;
    let (track, index) = find_clip_mut(target, clip)?;
    match &mut track.clips[index].source {
        ClipSource::Generator { generator: held } => {
            *held = generator.clone();
            Ok(())
        }
        ClipSource::Media { .. } | ClipSource::Compound { .. } => Err(CoreError::InvalidArgument(
            "only a generator clip has a generator".into(),
        )),
    }
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

pub(super) fn add_effect(target: &mut Project, at: &EffectTarget, effect_type: &str) -> Result<()> {
    let effects = chain_mut(target, at)?;
    if effects
        .iter()
        .any(|effect| effect.effect_type == effect_type)
    {
        return Ok(());
    }
    effects.push(Effect::new(effect_type));
    Ok(())
}

// Refuses a chain that has no such effect rather than doing nothing. An effect somebody removed twice
// is a surface that thinks it is still there, and telling it so is how it finds out.
pub(super) fn remove_effect(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: &str,
) -> Result<()> {
    let effects = chain_mut(target, at)?;
    let index = effects
        .iter()
        .position(|effect| effect.effect_type == effect_type)
        .ok_or_else(|| CoreError::InvalidArgument(format!("no {effect_type} in that chain")))?;
    effects.remove(index);
    Ok(())
}

// Bypass, which is not the same as removing: the parameters and every keyframe on them stay, so
// switching an effect off to hear what it was doing and back on again costs nothing and loses nothing.
// The renderer and the audio graph both skip a disabled effect; the inspector still shows it, which is
// what makes the state visible rather than mysterious.
pub(super) fn set_effect_enabled(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: &str,
    enabled: bool,
) -> Result<()> {
    find_effect_mut(target, at, effect_type)?.enabled = enabled;
    Ok(())
}

pub(super) fn set_effect_param(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: &str,
    key: &str,
    value: ParamValue,
) -> Result<()> {
    crate::model::project::param_value_finite(&value)?;
    let effect = find_effect_mut(target, at, effect_type)?;
    effect.params.insert(key.to_string(), value);
    Ok(())
}

// Replaces the keyframe already sitting at `time` rather than adding a second one there: two keys
// at the same instant have no defined order, and the upsert is what lets a slider drag over a
// keyframed parameter repeat this command under one coalesce key.
pub(super) fn add_keyframe(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
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
    // Only where a track is created, because that is the only place a name nobody reads can be
    // written; the three commands below reach an existing track or refuse on their own.
    if effect_type.is_none() && key != SPEED_TRACK {
        transform_field(key)?;
    }
    let tracks = keyframes_mut(target, at, effect_type)?;
    let track = tracks.entry(key.to_string()).or_default();
    match track.iter_mut().find(|existing| existing.time == time) {
        Some(existing) => {
            // Value and interpolation come from the caller; the handles do not, because no command
            // carries a pair. Overwriting the whole struct would be the one thing an upsert could
            // do to a curve a project arrived with, and it would do it on every pointer move of a
            // slider drag -- with nothing on any surface able to put the shape back.
            existing.value = keyframe.value;
            existing.interp = keyframe.interp;
        }
        None => {
            track.push(keyframe);
            sort_track(track);
        }
    }
    speed_ramp_allowed(target, at, effect_type, key)
}

// The rate track meets the load boundary's own check here, and through the same function, so a ramp
// one route accepts is never a ramp the other refuses to load back.
//
// Checked on the mutated clip rather than on the incoming value, because "a compound clip carries no
// ramp" is a fact about the clip, and because `keyframe.move` and `keyframe.setInterp` reach the
// same track without passing a value at all. `Command::apply` runs on a clone the document discards
// on error, so a refusal here leaves nothing behind.
fn speed_ramp_allowed(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
    key: &str,
) -> Result<()> {
    if effect_type.is_some() || key != SPEED_TRACK {
        return Ok(());
    }
    let EffectTarget::Clip { clip } = at else {
        return Ok(());
    };
    let (track, index) = find_clip_mut(target, clip)?;
    crate::model::project::speed_track_bounded(&track.clips[index])
}

pub(super) fn remove_keyframe(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
    key: &str,
    time: Time,
) -> Result<()> {
    let tracks = keyframes_mut(target, at, effect_type)?;
    let (track, index) = keyframe_at(tracks, key, time)?;
    track.remove(index);
    // An empty track would still read as "keyframed" in the JSON while `param_at` has already
    // fallen back to the static value — the last removal takes the parameter back off the clock.
    if track.is_empty() {
        tracks.remove(key);
    }
    Ok(())
}

pub(super) fn move_keyframe(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
    key: &str,
    from: Time,
    to: Time,
) -> Result<()> {
    bounded(to)?;
    let tracks = keyframes_mut(target, at, effect_type)?;
    let (track, index) = keyframe_at(tracks, key, from)?;
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
    at: &EffectTarget,
    effect_type: Option<&str>,
    key: &str,
    time: Time,
    interp: Interp,
) -> Result<()> {
    let tracks = keyframes_mut(target, at, effect_type)?;
    let (track, index) = keyframe_at(tracks, key, time)?;
    track[index].interp = interp;
    speed_ramp_allowed(target, at, effect_type, key)
}

// What a curve editor drags. The whole keyframe goes back through `keyframe_bounded` afterwards
// rather than the pair being checked on its own: a NaN handle is the same hole on this route as on
// the load path, and one function answering for both is what keeps a curve this accepts from being
// a curve a reload refuses. `Command::apply` works on a clone the document throws away on error, so
// a refusal here leaves the pair the keyframe had.
//
// No speed check: handles are read only while the neighbouring key is `Bezier`, and a rate track
// cannot be `Bezier` -- `set_keyframe_interp` and the load path both refuse that, which is the one
// place the rule belongs.
pub(super) fn set_keyframe_handles(
    target: &mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
    key: &str,
    time: Time,
    handle_in: Option<[f32; 2]>,
    handle_out: Option<[f32; 2]>,
) -> Result<()> {
    let tracks = keyframes_mut(target, at, effect_type)?;
    let (track, index) = keyframe_at(tracks, key, time)?;
    track[index].handle_in = handle_in;
    track[index].handle_out = handle_out;
    crate::model::project::keyframe_bounded(&track[index])
}

// The three chains an effect can live in, behind one address. A clip's own is reached the way it
// always was; a track's and the project's have been in the model since M0 with nothing able to put
// anything in them.
pub(super) fn chain_mut<'p>(
    target: &'p mut Project,
    at: &EffectTarget,
) -> Result<&'p mut Vec<Effect>> {
    match at {
        EffectTarget::Clip { clip } => {
            let (track, index) = find_clip_mut(target, clip)?;
            Ok(&mut track.clips[index].effects)
        }
        EffectTarget::Track { track } => Ok(&mut target
            .track_mut(track)
            .ok_or_else(|| CoreError::TrackNotFound(track.clone()))?
            .effects),
        EffectTarget::Project => Ok(&mut target.master.effects),
    }
}

fn find_effect_mut<'p>(
    target: &'p mut Project,
    at: &EffectTarget,
    effect_type: &str,
) -> Result<&'p mut Effect> {
    chain_mut(target, at)?
        .iter_mut()
        .find(|effect| effect.effect_type == effect_type)
        .ok_or_else(|| {
            CoreError::InvalidArgument(format!("no such effect in that chain: {effect_type}"))
        })
}

// The keyframe tracks a command addresses. With an effect type they belong to that effect; without
// one they belong to the clip itself, which is the transform. Nothing else in the model carries a
// track of its own, so a target that is not a clip has nothing to answer with.
fn keyframes_mut<'p>(
    target: &'p mut Project,
    at: &EffectTarget,
    effect_type: Option<&str>,
) -> Result<&'p mut BTreeMap<String, Vec<Keyframe>>> {
    match effect_type {
        Some(effect_type) => Ok(&mut find_effect_mut(target, at, effect_type)?.keyframes),
        None => match at {
            EffectTarget::Clip { clip } => {
                let (track, index) = find_clip_mut(target, clip)?;
                Ok(&mut track.clips[index].keyframes)
            }
            _ => Err(CoreError::InvalidArgument(
                "only a clip has a transform to keyframe".into(),
            )),
        },
    }
}

// `Transform::field_mut` is the roster, so a field the picture reads and a field a keyframe may
// address are the same set by construction. Without this a keyframe under a misspelt name would be
// written, saved and reloaded without ever reaching a pixel.
//
// The motion path is the one track outside that roster, because it names two fields rather than
// one. `transform_at` reads it under the same constant, so the two ends still cannot drift.
fn transform_field(key: &str) -> Result<()> {
    if key == POSITION_TRACK || Transform::default().field_mut(key).is_some() {
        Ok(())
    } else {
        Err(CoreError::InvalidArgument(format!(
            "not a keyframable transform field: {key}"
        )))
    }
}

// One refusal, not two: "this parameter has no track" and "this track has nothing at that time"
// are the same answer to the caller, and splitting them left the first guard unable to produce an
// outcome the second did not already produce.
fn keyframe_at<'t>(
    tracks: &'t mut BTreeMap<String, Vec<Keyframe>>,
    key: &str,
    time: Time,
) -> Result<(&'t mut Vec<Keyframe>, usize)> {
    let missing = || CoreError::InvalidArgument(format!("no keyframe on {key} at that time"));
    let track = tracks.get_mut(key).ok_or_else(missing)?;
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
