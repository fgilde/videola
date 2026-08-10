//! Audiola's own project file, read and written.
//!
//! Audiola is the audio tool next door — same author, same house — and its `.audiola` is a ZIP with
//! a `project.json` beside a `media/` directory, which is the same shape a `.videola` has. So a mix
//! built there arrives here as tracks on this timeline, and a cut built here leaves as something
//! that opens there.
//!
//! What travels is what both tools mean the same thing by: a track with a name, a gain and a pan,
//! carrying clips that name a file, a place on the timeline, a place in that file, a length and two
//! fades. Everything else on either side stays where it is. Audiola's mastering chain, its spatial
//! layout and its EQ have no counterpart in a video editor's model, and Videola's effects, keyframes
//! and transitions have none in a mixer's — writing either as the other would be inventing a meaning
//! neither tool would agree to.
//!
//! **Seconds, not flicks.** Audiola counts in `double` seconds and Videola in integer flicks, and the
//! conversion is the one place this can lose anything. A flick is 705,600,000 to the second, so every
//! sample rate and frame rate in use divides it evenly; a second from Audiola becomes an exact number
//! of flicks, and the trip back is a division that only loses what a `double` cannot hold anyway.
//!
//! **The field names are Audiola's.** Its C# writes with `System.Text.Json` and no naming policy, so
//! the manifest is PascalCase, and it reads back case-sensitively. `Media`, not `media`.

mod model;
mod reader;
mod writer;

pub use model::{AudiolaClip, AudiolaProject, AudiolaTrack};
pub use reader::{read_audiola, AudiolaImport};
pub use writer::write_audiola;

use crate::model::{Time, FLICKS_PER_SECOND};

/// Audiola's seconds as flicks. Rounded to the nearest, because the alternative is a mix that walks
/// a fraction of a millisecond earlier on every trip through the two tools.
pub(crate) fn flicks_of(seconds: f64) -> Time {
    if !seconds.is_finite() {
        return Time::ZERO;
    }
    let flicks = (seconds.max(0.0) * f64::from(FLICKS_PER_SECOND as u32)).round();
    // A `double` holds every flick up to 2^53, which is a hundred and forty days of timeline; past
    // that the value is not a length anybody authored.
    Time::from_flicks(flicks.min(9_007_199_254_740_992.0) as i64)
}

/// And back. A flick divides evenly by every rate in use, so this is exact for anything Videola
/// itself authored and as close as a `double` gets for anything else.
pub(crate) fn seconds_of(at: Time) -> f64 {
    at.as_flicks() as f64 / f64::from(FLICKS_PER_SECOND as u32)
}

/// A gain in decibels as the linear factor Videola's `volume` is, and the reverse.
///
/// Audiola stores what a fader reads and Videola what a multiplier is. Clamped to the same 0..4 the
/// core clamps a volume to, so a file claiming +40 dB arrives as the loudest thing Videola allows
/// rather than as a number the command layer would refuse.
pub(crate) fn gain_to_volume(db: f64) -> f32 {
    if !db.is_finite() {
        return 1.0;
    }
    (10f64.powf(db / 20.0)).clamp(0.0, 4.0) as f32
}

pub(crate) fn volume_to_gain(volume: f32) -> f64 {
    let linear = f64::from(volume);
    if linear <= 0.0 {
        // Silence has no decibel value. −120 is below anything audible and is what every mixer
        // writes for a closed fader; zero would read as unity gain on the way back.
        return -120.0;
    }
    20.0 * linear.log10()
}
