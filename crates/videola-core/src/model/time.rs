use std::ops::{Add, Sub};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const FLICKS_PER_SECOND: i64 = 705_600_000;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize, TS,
)]
#[serde(transparent)]
#[ts(type = "number")]
pub struct Time(i64);

impl Time {
    pub const ZERO: Time = Time(0);

    // Commands arrive from a REST API and from AI agents; without an upper bound a single
    // absurd value (e.g. i64::MAX) would pass every other check and only misbehave far
    // downstream. 24h is generous for any real edit and cheap to raise later if needed.
    pub const MAX_REASONABLE: Time = Time(FLICKS_PER_SECOND * 60 * 60 * 24);

    pub const fn from_flicks(flicks: i64) -> Self {
        Self(flicks)
    }

    pub const fn as_flicks(self) -> i64 {
        self.0
    }

    pub fn from_seconds(seconds: f64) -> Self {
        Self((seconds * FLICKS_PER_SECOND as f64).round() as i64)
    }

    pub fn as_seconds(self) -> f64 {
        self.0 as f64 / FLICKS_PER_SECOND as f64
    }

    // `rate` can come straight from `Rate::new`, not just from a validated project (see
    // `Project::normalize`'s `rate_bounded`), so `numerator == 0` here would panic on integer
    // division rather than merely misbehave. `None` pushes that choice back to the caller instead
    // of picking a fallback value on their behalf.
    pub fn from_frames(frame: i64, rate: Rate) -> Option<Self> {
        if rate.numerator == 0 {
            return None;
        }
        Some(Self(
            frame * FLICKS_PER_SECOND * rate.denominator as i64 / rate.numerator as i64,
        ))
    }

    pub fn to_frame(self, rate: Rate) -> Option<i64> {
        if rate.denominator == 0 {
            return None;
        }
        Some(self.0 * rate.numerator as i64 / (FLICKS_PER_SECOND * rate.denominator as i64))
    }

    pub fn max(self, other: Time) -> Time {
        if self.0 >= other.0 {
            self
        } else {
            other
        }
    }

    pub fn clamp_min_zero(self) -> Time {
        Time(self.0.max(0))
    }

    pub fn checked_add(self, rhs: Time) -> Option<Time> {
        self.0.checked_add(rhs.0).map(Time)
    }

    pub fn checked_sub(self, rhs: Time) -> Option<Time> {
        self.0.checked_sub(rhs.0).map(Time)
    }
}

impl Add for Time {
    type Output = Time;
    fn add(self, rhs: Time) -> Time {
        Time(self.0 + rhs.0)
    }
}

impl Sub for Time {
    type Output = Time;
    fn sub(self, rhs: Time) -> Time {
        Time(self.0 - rhs.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Rate {
    pub numerator: u32,
    pub denominator: u32,
}

impl Rate {
    pub const fn new(numerator: u32, denominator: u32) -> Self {
        Self {
            numerator,
            denominator,
        }
    }

    pub const fn from_fps(fps: u32) -> Self {
        Self::new(fps, 1)
    }

    // Float division by zero would not panic here, only silently yield `inf`/`NaN` that then
    // propagates into every downstream computation (timecode formatting, playback speed). `None`
    // makes that failure visible at the point it happens instead of several calls downstream.
    pub fn as_f64(self) -> Option<f64> {
        if self.denominator == 0 {
            None
        } else {
            Some(self.numerator as f64 / self.denominator as f64)
        }
    }
}

impl Default for Rate {
    fn default() -> Self {
        Self::from_fps(30)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_is_exact_for_common_rates() {
        for fps in [24u32, 25, 30, 48, 50, 60, 90, 100, 120] {
            let rate = Rate::from_fps(fps);
            for frame in [0i64, 1, 7, 1000, 123_456] {
                let t = Time::from_frames(frame, rate).unwrap();
                assert_eq!(t.to_frame(rate).unwrap(), frame, "fps={fps} frame={frame}");
            }
        }
    }

    #[test]
    fn ntsc_rate_stays_exact() {
        let rate = Rate::new(30_000, 1001);
        let t = Time::from_frames(90_000, rate).unwrap();
        assert_eq!(t.to_frame(rate).unwrap(), 90_000);
    }

    #[test]
    fn from_frames_rejects_a_zero_numerator() {
        assert_eq!(Time::from_frames(10, Rate::new(0, 1)), None);
    }

    #[test]
    fn to_frame_rejects_a_zero_denominator() {
        assert_eq!(Time::ZERO.to_frame(Rate::new(30, 0)), None);
    }

    #[test]
    fn as_f64_rejects_a_zero_denominator() {
        assert_eq!(Rate::new(30, 0).as_f64(), None);
        assert_eq!(Rate::new(30, 1).as_f64(), Some(30.0));
    }

    #[test]
    fn seconds_conversion_is_lossless_for_a_whole_and_a_fractional_value() {
        assert_eq!(Time::from_seconds(2.5).as_seconds(), 2.5);
        assert_eq!(Time::from_seconds(0.0), Time::ZERO);
    }

    #[test]
    fn serialises_as_plain_integer() {
        let json = serde_json::to_string(&Time::from_seconds(1.0)).unwrap();
        assert_eq!(json, "705600000");
    }

    #[test]
    fn arithmetic_and_ordering_work() {
        let a = Time::from_seconds(1.0);
        let b = Time::from_seconds(0.25);
        assert_eq!((a + b).as_seconds(), 1.25);
        assert_eq!((a - b).as_seconds(), 0.75);
        assert!(b < a);
    }
}
