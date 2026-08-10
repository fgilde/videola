//! The two files other editors read.
//!
//! Videola's own container round-trips losslessly and is the only one it opens. These two go the
//! other way: a cut leaves here and is finished somewhere else, in DaVinci Resolve, Premiere or
//! Final Cut. Neither carries an effect, a keyframe or a grade — they carry where each piece of
//! material sits, which is what a conform needs and the whole of what these formats agree on.
//!
//! Written here rather than in TypeScript for the reason the reader and the writer are: a timecode
//! is integer arithmetic over a rational rate, and doing it a second time in a second language is
//! how two answers to the same question come about.

mod edl;
mod fcpxml;

pub use edl::to_edl;
pub use fcpxml::to_fcpxml;

use crate::model::{Rate, Time, FLICKS_PER_SECOND};

/// A moment as `HH:MM:SS:FF` at a whole-number frame rate, which is what a timecode is.
///
/// Rounded to the nearest frame rather than truncated: a cut authored at 1.9999 s is a cut at frame
/// 60 of a 30 fps timeline, and truncation would put it one frame earlier in every file that leaves
/// here. Hours wrap at 24, the way a timecode does on a deck.
pub(crate) fn timecode(at: Time, fps: Rate) -> String {
    let frames = frames_at(at, fps);
    let per_second = whole_fps(fps);
    let seconds = frames / per_second;
    format!(
        "{:02}:{:02}:{:02}:{:02}",
        (seconds / 3600) % 24,
        (seconds / 60) % 60,
        seconds % 60,
        frames % per_second,
    )
}

/// How many frames have passed at this instant. The one place time becomes a frame count.
pub(crate) fn frames_at(at: Time, fps: Rate) -> i64 {
    let flicks = at.as_flicks().max(0) as i128;
    let num = i128::from(fps.numerator.max(1));
    let den = i128::from(fps.denominator.max(1));
    let per_frame = (i128::from(FLICKS_PER_SECOND) * den) / num;
    if per_frame <= 0 {
        return 0;
    }
    // Nearest, not floor: see the note above.
    ((flicks + per_frame / 2) / per_frame) as i64
}

/// The whole number of frames a second of timecode counts, which is the rate rounded up for the
/// fractional rates: 30000/1001 counts 30 frames a second and runs slow, and every editor that
/// reads a timecode knows it.
pub(crate) fn whole_fps(fps: Rate) -> i64 {
    let num = i64::from(fps.numerator.max(1));
    let den = i64::from(fps.denominator.max(1));
    ((num + den - 1) / den).max(1)
}

/// Whether this rate is one of the 1000/1001 family, which is what makes a timecode drop frames.
pub(crate) fn is_fractional(fps: Rate) -> bool {
    fps.denominator > 1
}
