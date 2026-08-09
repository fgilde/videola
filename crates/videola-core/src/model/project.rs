use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use super::clip::{Clip, ClipSource, Generator, Transform};
use super::effect::{Effect, Transition};
use super::keyframe::{sort_track, Keyframe};
use super::media::MediaAsset;
use super::param::ParamValue;
use super::timeline::{Marker, Timeline, Track};
use super::{ProjectId, Rate, Time, TrackId};
use crate::{CoreError, Result};

// `ClipSource::Compound` nests a whole `Timeline`, which can itself contain compound clips.
// `Box<Timeline>` cannot form a cycle in safe Rust (there is no way to reach back to an
// ancestor), so a depth cap is the only guard nesting needs — do not add a visited-set later.
pub const MAX_COMPOUND_DEPTH: usize = 8;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub schema_version: u32,
    pub meta: ProjectMeta,
    pub settings: ProjectSettings,
    #[serde(default)]
    pub library: Vec<MediaAsset>,
    pub timeline: Timeline,
    #[serde(default)]
    pub markers: Vec<Marker>,
    pub master: MasterSettings,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            meta: ProjectMeta::default(),
            settings: ProjectSettings::default(),
            library: Vec::new(),
            timeline: Timeline::default(),
            markers: Vec::new(),
            master: MasterSettings::default(),
            extra: Map::new(),
        }
    }
}

impl Project {
    pub fn track_index(&self, id: &TrackId) -> Option<usize> {
        self.timeline
            .tracks
            .iter()
            .position(|track| &track.id == id)
    }

    pub fn track(&self, id: &TrackId) -> Option<&Track> {
        self.timeline.tracks.iter().find(|track| &track.id == id)
    }

    pub fn track_mut(&mut self, id: &TrackId) -> Option<&mut Track> {
        self.timeline
            .tracks
            .iter_mut()
            .find(|track| &track.id == id)
    }

    // Keyframe tracks come straight from deserialised, untrusted JSON and `evaluate` assumes
    // sorted-by-time (see keyframe.rs); the same JSON can also carry a corrupt or hostile Time
    // value (e.g. i64::MAX), which Clip::end()/out_point() would then add unchecked. The loader
    // calls this once after parsing so nothing downstream has to re-check either.
    pub fn normalize(&mut self) -> Result<()> {
        settings_bounded(&self.settings)?;
        normalize_timeline(&mut self.timeline, 0)?;
        finite(self.master.volume)?;
        normalize_effects(&mut self.master.effects)?;
        normalize_markers(&self.markers)?;
        normalize_library(&self.library)
    }
}

// Entry point for a `ClipSource` that hasn't been stored yet (the command layer's `clip.add`):
// the same field-by-field walk `Project::normalize` runs for every clip already in the tree,
// so a hostile nested timeline is rejected before it reaches the model, not on the next load.
pub(crate) fn normalize_new_clip(clip: &mut Clip) -> Result<()> {
    normalize_clip(clip, 0)
}

fn normalize_timeline(timeline: &mut Timeline, depth: usize) -> Result<()> {
    if depth > MAX_COMPOUND_DEPTH {
        return Err(CoreError::InvalidArgument(
            "compound clip nesting too deep".into(),
        ));
    }
    for track in &mut timeline.tracks {
        normalize_track(track, depth)?;
    }
    Ok(())
}

fn normalize_track(track: &mut Track, depth: usize) -> Result<()> {
    finite(track.volume)?;
    finite(track.pan)?;
    hex_color(&track.color_hex)?;
    for clip in &mut track.clips {
        normalize_clip(clip, depth)?;
    }
    normalize_effects(&mut track.effects)
}

fn normalize_clip(clip: &mut Clip, depth: usize) -> Result<()> {
    bounded(clip.start)?;
    bounded(clip.duration)?;
    bounded(clip.in_point)?;
    bounded(clip.fades.in_duration)?;
    bounded(clip.fades.out_duration)?;
    speed_rate_bounded(clip.speed.rate)?;
    clip_scalars_finite(clip)?;
    // An empty group id would make every clip carrying one a member of the same group, so a single
    // `clip.ungroup` would dissolve unrelated groups across the project.
    if clip
        .group_id
        .as_ref()
        .is_some_and(|id| id.as_str().is_empty())
    {
        return Err(CoreError::InvalidArgument(
            "a group id must not be empty".into(),
        ));
    }
    if clip.transition_in.is_some() || clip.transition_out.is_some() {
        transition_source_allowed(&clip.source)?;
    }
    normalize_transition(&clip.transition_in)?;
    normalize_transition(&clip.transition_out)?;
    normalize_keyframes(&mut clip.keyframes)?;
    speed_track_bounded(clip)?;
    match &mut clip.source {
        ClipSource::Compound { timeline } => normalize_timeline(timeline, depth + 1)?,
        // A generator's colour is read by `hex()` in generator.ts, which falls back to black or
        // white for anything it cannot parse — the same silent reinterpretation
        // `settings.background` is checked against, and now reachable from a template's colour
        // slot as well as from a hand-written project.json.
        ClipSource::Generator {
            generator: Generator::Gradient { from, to, angle },
        } => {
            finite(*angle)?;
            hex_color(from)?;
            hex_color(to)?;
        }
        ClipSource::Generator {
            generator: Generator::Solid { color } | Generator::Shape { color, .. },
        } => hex_color(color)?,
        ClipSource::Generator { .. } | ClipSource::Media { .. } => {}
    }
    normalize_effects(&mut clip.effects)
}

// A clip's `params`/keyframes are what `command::clip::set_effect_param` writes one field at a
// time; a hand-authored project.json can set every field of every variant at once, so this
// checks all of them the setter would ever see, not just `Float`. Discrete variants (`Int`,
// `Bool`, `Choice`) have no float to go non-finite.
pub(crate) fn param_value_finite(value: &ParamValue) -> Result<()> {
    match value {
        ParamValue::Float(v) => finite(*v).map(|_| ()),
        ParamValue::Color(channels) => channels.iter().try_for_each(|c| finite(*c).map(|_| ())),
        ParamValue::Vec2(components) => components.iter().try_for_each(|c| finite(*c).map(|_| ())),
        ParamValue::Curve(points) => {
            if points.len() > MAX_CURVE_POINTS {
                return Err(CoreError::InvalidArgument(format!(
                    "a curve carries at most {MAX_CURVE_POINTS} points"
                )));
            }
            points
                .iter()
                .try_for_each(|point| point.iter().try_for_each(|c| finite(*c).map(|_| ())))
        }
        ParamValue::Int(_) | ParamValue::Bool(_) | ParamValue::Choice(_) => Ok(()),
    }
}

// The one variant whose size a project file chooses. Every other kind is a fixed handful of floats,
// so this is the only place where a loaded document decides how much work the renderer does per
// frame -- the shader's table is sampled from these points, once per curve per frame. Sixty-four is
// far past any curve a person drags and far short of a list that costs a frame to walk.
//
// Bounded here and not clamped: x out of order, or y outside 0..1, is still a curve that draws, and
// the sampler at the uniform seam is where a value has always been brought into range. Refusing to
// open a project over that would be the harsher answer to the milder problem.
pub(crate) const MAX_CURVE_POINTS: usize = 64;

// `speed.rate` is the one scalar C1 of the M0 review found unbounded here: `Clip::consumed_source`
// and `out_point` multiply it straight into a `Time`, and a value past this bound overflows the
// raw `+`/`-` on `Time` in command/clip.rs's trim and split instead of raising an error. The rest
// of a clip's floats (volume, pan, transform, crop) have no such overflow path, only the ordinary
// hazard of a non-finite value surviving into a computation and then into JS as `null` — `finite`
// alone closes that for them.
fn clip_scalars_finite(clip: &Clip) -> Result<()> {
    finite(clip.volume)?;
    finite(clip.pan)?;
    transform_finite(&clip.transform)
}

// Shared with `command::clip::set_transform`, which takes a whole `Transform` off the wire.
pub(crate) fn transform_finite(transform: &Transform) -> Result<()> {
    for value in [
        transform.x,
        transform.y,
        transform.scale_x,
        transform.scale_y,
        transform.rotation,
        transform.anchor_x,
        transform.anchor_y,
        transform.opacity,
        transform.crop.left,
        transform.crop.top,
        transform.crop.right,
        transform.crop.bottom,
    ] {
        finite(value)?;
    }
    Ok(())
}

// A transition mixes its clip with the picture the frame already holds. A compound clip reaches the
// compositor as the several clips inside it, so the mix would run once per nested clip and count
// what is underneath again every time. Refused at the gate rather than dropped by the renderer:
// a dissolve that silently does nothing is worse than one that never gets authored.
pub(crate) fn transition_source_allowed(source: &ClipSource) -> Result<()> {
    match source {
        ClipSource::Compound { .. } => Err(CoreError::InvalidArgument(
            "a compound clip cannot carry a transition".into(),
        )),
        ClipSource::Media { .. } | ClipSource::Generator { .. } => Ok(()),
    }
}

fn normalize_transition(transition: &Option<Transition>) -> Result<()> {
    match transition {
        Some(transition) => transition_bounded(transition),
        None => Ok(()),
    }
}

// Shared with `command::clip::set_transition`, which takes a whole `Transition` off the wire.
// `params` are unread by the M1 renderer but still cross into JS, where a non-finite float
// becomes `null` without anything raising.
pub(crate) fn transition_bounded(transition: &Transition) -> Result<()> {
    bounded(transition.duration)?;
    transition.params.values().try_for_each(param_value_finite)
}

fn normalize_effects(effects: &mut [Effect]) -> Result<()> {
    for effect in effects {
        for value in effect.params.values() {
            param_value_finite(value)?;
        }
        normalize_keyframes(&mut effect.keyframes)?;
    }
    Ok(())
}

fn normalize_keyframes(tracks: &mut BTreeMap<String, Vec<Keyframe>>) -> Result<()> {
    for keyframes in tracks.values_mut() {
        sort_track(keyframes);
        keyframes.iter().try_for_each(keyframe_bounded)?;
    }
    Ok(())
}

// Shared with every `keyframe.*` command, so a keyframe one route accepts is never one the other
// route would refuse to load back. The handles are the reason this is a function rather than two
// lines: `Interp::Bezier` feeds them into `cubic_bezier_y_at`, and a NaN there propagates through
// `lerp` into the interpolated value — the same non-finite-into-JS hole `finite` closes elsewhere.
pub(crate) fn keyframe_bounded(keyframe: &Keyframe) -> Result<()> {
    bounded(keyframe.time)?;
    param_value_finite(&keyframe.value)?;
    for handle in [keyframe.handle_in, keyframe.handle_out]
        .into_iter()
        .flatten()
    {
        handle.iter().try_for_each(|c| finite(*c).map(|_| ()))?;
    }
    Ok(())
}

fn normalize_markers(markers: &[Marker]) -> Result<()> {
    for marker in markers {
        bounded(marker.time)?;
        hex_color(&marker.color_hex)?;
    }
    Ok(())
}

fn normalize_library(library: &[MediaAsset]) -> Result<()> {
    for asset in library {
        if let Some(duration) = asset.duration {
            bounded(duration)?;
        }
        if let Some(fps) = asset.fps {
            rate_bounded(fps)?;
        }
    }
    Ok(())
}

// The one definition of the `Time` bound `Project::normalize` enforces on load; the command
// layer re-exposes this (see `command::bounded`) so a value that would fail to reload is
// rejected up front instead of round-tripping through save/load once.
pub(crate) fn bounded(time: Time) -> Result<()> {
    if time.as_flicks() < 0 || time > Time::MAX_REASONABLE {
        Err(CoreError::InvalidArgument("time value out of range".into()))
    } else {
        Ok(())
    }
}

// The `Rate` equivalent of `bounded`: `settings.fps` and every `MediaAsset.fps` cross the same
// untrusted-JSON boundary, and a zero denominator or numerator turns straight into a division by
// zero in `Time::from_frames`/`to_frame`. 1 fps is the floor because anything slower makes a
// nominal frame count meaningless (and rounds to zero, which is the same bug wearing a costume);
// 1000 fps covers every real high-speed camera in use today while keeping `from_frames` far from
// overflowing `i64` flicks.
const MIN_REASONABLE_FPS: f64 = 1.0;
const MAX_REASONABLE_FPS: f64 = 1000.0;

// Shared by the load path and every command that accepts an f32 from the wire: `is_finite`
// rejects NaN/infinity before they can cross into JS, where `JSON.stringify` silently turns
// either into `null` and the loss becomes invisible at the point it happens.
pub(crate) fn finite(value: f32) -> Result<f32> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(CoreError::InvalidArgument("value must be finite".into()))
    }
}

// Above this, `Clip::consumed_source`'s `as i64` cast starts saturating instead of overflowing
// cleanly, which would silently corrupt the source range rather than raising an error. Shared by
// `command::clip::set_speed` and `normalize_clip` so a rate one route accepts is never a rate the
// other route lets overflow `Time`'s raw arithmetic on the next trim or split.
pub(crate) const MAX_SPEED_RATE: f32 = 100.0;

// The same seam one level down, for the track a speed ramp lives on. `Clip::source_offset`
// multiplies a rate off this track straight into a `Time` exactly as `speed.rate` is multiplied, so
// the hole C1 found in the scalar is a hole here too — with the extra twist that a track carries
// arbitrarily many of them and `keyframe_bounded` only checks that they are finite.
//
// Zero is allowed here and refused on `speed.rate`, deliberately: a rate track reading zero is a
// frame hold, which someone authored, while a static zero is a clip that consumes no source at all
// and that the compound mapping divides by.
//
// A `Bezier` key is refused because `integrate` cannot answer it exactly, and an inexact answer
// would break the one property the mapping rests on — that the area over the whole clip is the sum
// of the areas over its parts. A compound clip is refused because the compound mapping in
// nesting.ts inverts the outer rate by dividing, which only works while the rate is one number.
// Both are honest refusals: the alternative is a ramp in the menu that draws the wrong frame.
pub(crate) fn speed_track_bounded(clip: &Clip) -> Result<()> {
    let Some(track) = clip.keyframes.get(super::clip::SPEED_TRACK) else {
        return Ok(());
    };
    if track.is_empty() {
        return Ok(());
    }
    if matches!(clip.source, ClipSource::Compound { .. }) {
        return Err(CoreError::InvalidArgument(
            "a compound clip cannot carry a speed ramp".into(),
        ));
    }
    for keyframe in track {
        let ParamValue::Float(rate) = keyframe.value else {
            return Err(CoreError::InvalidArgument(
                "a speed keyframe must be a number".into(),
            ));
        };
        finite(rate)?;
        if !(0.0..=MAX_SPEED_RATE).contains(&rate) {
            return Err(CoreError::InvalidArgument(
                "a speed keyframe must be between 0 and 100".into(),
            ));
        }
        if keyframe.interp == super::Interp::Bezier {
            return Err(CoreError::InvalidArgument(
                "a speed keyframe cannot be a bezier".into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn speed_rate_bounded(rate: f32) -> Result<()> {
    finite(rate)?;
    if !(0.0 < rate && rate <= MAX_SPEED_RATE) {
        return Err(CoreError::InvalidArgument(
            "rate must be positive and at most 100".into(),
        ));
    }
    Ok(())
}

pub(crate) fn rate_bounded(rate: Rate) -> Result<()> {
    if rate.numerator == 0 || rate.denominator == 0 {
        return Err(CoreError::InvalidArgument(
            "rate must have a non-zero numerator and denominator".into(),
        ));
    }
    match rate.as_f64() {
        Some(fps) if (MIN_REASONABLE_FPS..=MAX_REASONABLE_FPS).contains(&fps) => Ok(()),
        _ => Err(CoreError::InvalidArgument(
            "rate out of reasonable range".into(),
        )),
    }
}

// 16384 covers 8K (7680x4320) with headroom for odd custom sizes, and keeps `width * height * 4`
// (a full RGBA frame buffer) at ~1 GiB, nowhere near overflowing a u32 byte count downstream.
const MAX_REASONABLE_DIMENSION: u32 = 16_384;

// 192 kHz is the practical ceiling for real audio hardware; doubling it leaves room for an
// oversampled pro-audio pipeline without accepting values that only a corrupt file would carry.
const MAX_REASONABLE_SAMPLE_RATE: u32 = 384_000;

// Shared with `template::Frame`, which offers alternative output sizes that end up in exactly
// these two fields — an aspect ratio a template offers must not be one the resulting project
// could never carry.
pub(crate) fn dimension_bounded(value: u32) -> Result<()> {
    if value == 0 || value > MAX_REASONABLE_DIMENSION {
        Err(CoreError::InvalidArgument(
            "width and height must be between 1 and 16384".into(),
        ))
    } else {
        Ok(())
    }
}

fn sample_rate_bounded(value: u32) -> Result<()> {
    if value == 0 || value > MAX_REASONABLE_SAMPLE_RATE {
        Err(CoreError::InvalidArgument(
            "sample rate must be between 1 and 384000".into(),
        ))
    } else {
        Ok(())
    }
}

// The one rule `Project::normalize` (load) and `command::project::set_settings` (dispatch) both
// enforce for `ProjectSettings` — without this, a `project.setSettings` command could set a
// zero-denominator fps or a zero width that a loaded project could never carry, corrupting the
// project from that dispatch onward.
pub(crate) fn settings_bounded(settings: &ProjectSettings) -> Result<()> {
    rate_bounded(settings.fps)?;
    dimension_bounded(settings.width)?;
    dimension_bounded(settings.height)?;
    sample_rate_bounded(settings.sample_rate)?;
    hex_color(&settings.background)
}

// The renderer's own reading of this field (`parseColor` in draw-list.ts) falls back to opaque
// black for anything it cannot parse, which means a typo becomes a colour rather than a complaint.
// Checked here so the one gate that judges settings judges all of them -- template colour slots
// write straight into this field and must not be able to smuggle in a value the compositor
// silently reinterprets.
//
// Track and marker colours go through the same check: both end up in an inline style in the
// timeline, where anything unparsable is dropped without a word.
fn hex_color(value: &str) -> Result<()> {
    let digits = value.strip_prefix('#').unwrap_or("");
    let shaped = matches!(digits.len(), 3 | 6 | 8) && digits.bytes().all(|b| b.is_ascii_hexdigit());
    if shaped {
        Ok(())
    } else {
        Err(CoreError::InvalidArgument(
            "background must be a hex colour such as #101820".into(),
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    pub width: u32,
    pub height: u32,
    pub fps: Rate,
    pub sample_rate: u32,
    pub color_space: String,
    pub background: String,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: Rate::from_fps(30),
            sample_rate: 48_000,
            color_space: "srgb".to_string(),
            background: "#000000".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MasterSettings {
    pub volume: f32,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl Default for MasterSettings {
    fn default() -> Self {
        Self {
            volume: 1.0,
            effects: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Interp, Keyframe, MediaAsset, MediaId, MediaKind, ParamValue, Time, TrackKind,
    };

    #[test]
    fn default_project_has_no_tracks_and_sane_settings() {
        let p = Project::default();
        assert_eq!(p.schema_version, SCHEMA_VERSION);
        assert!(p.timeline.tracks.is_empty());
        assert_eq!(p.settings.width, 1920);
        assert_eq!(p.settings.height, 1080);
        assert_eq!(p.settings.fps, Rate::from_fps(30));
        assert_eq!(p.settings.sample_rate, 48_000);
    }

    #[test]
    fn json_roundtrip_preserves_everything() {
        let mut p = Project::default();
        p.timeline
            .tracks
            .push(Track::new(TrackKind::Video, "V1".into()));
        let json = serde_json::to_string(&p).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(p, back);
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let json = r##"{
            "schemaVersion": 1,
            "meta": {"id":"prj_1","title":"T","tags":[]},
            "settings": {"width":1920,"height":1080,"fps":{"numerator":30,"denominator":1},
                         "sampleRate":48000,"colorSpace":"srgb","background":"#000000"},
            "timeline": {"tracks":[]},
            "markers": [],
            "master": {"volume":1.0,"effects":[]},
            "futureField": {"keep":"me"}
        }"##;
        let p: Project = serde_json::from_str(json).unwrap();
        let out = serde_json::to_value(&p).unwrap();
        assert_eq!(out["futureField"]["keep"], "me");
    }

    #[test]
    fn extra_fields_keep_deterministic_key_order() {
        let mut p = Project::default();
        p.extra.insert("z".into(), serde_json::json!(1));
        p.extra.insert("a".into(), serde_json::json!(2));
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.find("\"a\"").unwrap() < json.find("\"z\"").unwrap());
    }

    #[test]
    fn track_lookup_reports_missing_ids() {
        let p = Project::default();
        let missing = TrackId::from("trk_nope".to_string());
        assert!(p.track(&missing).is_none());
        assert!(p.track_index(&missing).is_none());
    }

    #[test]
    fn track_lookup_finds_an_existing_track() {
        let mut p = Project::default();
        let track = Track::new(TrackKind::Video, "V1".into());
        let id = track.id.clone();
        p.timeline.tracks.push(track);

        assert_eq!(p.track_index(&id), Some(0));
        assert_eq!(p.track(&id).map(|t| t.id.clone()), Some(id.clone()));
        assert_eq!(p.track_mut(&id).map(|t| t.id.clone()), Some(id));
    }

    #[test]
    fn normalize_sorts_out_of_order_keyframe_tracks() {
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(2.0),
        );
        clip.keyframes.insert(
            "opacity".into(),
            vec![
                Keyframe {
                    time: Time::from_seconds(2.0),
                    value: ParamValue::Float(100.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
                Keyframe {
                    time: Time::ZERO,
                    value: ParamValue::Float(0.0),
                    interp: Interp::Linear,
                    handle_in: None,
                    handle_out: None,
                },
            ],
        );
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(clip);
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        p.normalize().unwrap();

        let keyframes = &p.timeline.tracks[0].clips[0].keyframes["opacity"];
        assert_eq!(
            crate::model::keyframe::evaluate(keyframes, Time::from_seconds(1.0)),
            Some(ParamValue::Float(50.0))
        );
    }

    #[test]
    fn a_clip_with_an_absurd_start_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.start = Time::from_flicks(i64::MAX);
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // C1: a speed rate this absurd used to sail through `normalize` untouched, and only overflow
    // `Time`'s raw `+` on the next `clip.trim` or `clip.split` — far from where the bad value
    // actually entered.
    #[test]
    fn a_clip_with_an_absurd_speed_rate_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.speed.rate = 1e30;
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // The same hole one level down, and the reason `speed_track_bounded` exists: a rate track
    // carries arbitrarily many rates and `keyframe_bounded` only ever asked whether they were
    // finite. `1e30` on the track multiplies into a `Time` in `Clip::source_offset` exactly as the
    // scalar did, and the next `clip.trim` overflows on it just the same.
    #[test]
    fn a_clip_with_an_absurd_rate_on_its_speed_track_fails_to_load() {
        for rate in [1e30f32, -1.0, 101.0] {
            let mut loaded: Project = serde_json::from_str(
                &serde_json::to_string(&ramped(rate, Interp::Linear)).unwrap(),
            )
            .unwrap();
            assert!(
                matches!(loaded.normalize(), Err(CoreError::InvalidArgument(_))),
                "{rate} loaded"
            );
        }
    }

    // A bezier rate has no exact area, so `integrate` would answer `None` and the clip would fall
    // back to its static rate — a project that silently plays at a speed nobody authored. Refused
    // at the boundary instead, which is where a shape this build cannot honour belongs.
    #[test]
    fn a_bezier_rate_keyframe_fails_to_load_and_a_zero_one_does_not() {
        let mut bezier: Project =
            serde_json::from_str(&serde_json::to_string(&ramped(2.0, Interp::Bezier)).unwrap())
                .unwrap();
        assert!(matches!(
            bezier.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));

        let mut hold: Project =
            serde_json::from_str(&serde_json::to_string(&ramped(0.0, Interp::Hold)).unwrap())
                .unwrap();
        assert!(hold.normalize().is_ok());
    }

    #[allow(clippy::unwrap_used)]
    fn ramped(rate: f32, interp: Interp) -> Project {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.keyframes.insert(
            super::super::clip::SPEED_TRACK.into(),
            vec![Keyframe {
                time: Time::ZERO,
                value: ParamValue::Float(rate),
                interp,
                handle_in: None,
                handle_out: None,
            }],
        );
        track.clips.push(clip);
        p.timeline.tracks.push(track);
        p
    }

    // I3: `1e300` is a valid JSON number and casts to `f32::INFINITY` on deserialisation (no
    // f32 literal can express this directly, hence going via `Value` rather than field
    // assignment), which `normalize` used to wave through — the value only became a problem
    // once it crossed to JS, where `JSON.stringify` turns `Infinity` into `null` with no error
    // anywhere in between.
    #[test]
    fn a_clip_with_a_non_finite_volume_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let mut json = serde_json::to_value(&p).unwrap();
        json["timeline"]["tracks"][0]["clips"][0]["volume"] = serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // The one scalar `normalize` walked past: the audio graph writes it straight into a
    // `GainNode`, which throws on a non-finite value and takes the whole transport down with it.
    // Found while giving the master fader a command of its own -- the seam the command creates is
    // exactly this field.
    #[test]
    fn a_non_finite_master_volume_fails_to_load() {
        let p = Project::default();
        let mut json = serde_json::to_value(&p).unwrap();
        json["master"]["volume"] = serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn an_ordinary_master_volume_still_loads() {
        let mut p = Project::default();
        p.master.volume = 0.8;
        assert!(p.normalize().is_ok());
    }

    #[test]
    fn a_clip_with_ordinary_scalars_still_loads() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.volume = 0.8;
        track.pan = -0.3;
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.volume = 1.5;
        clip.pan = 0.2;
        clip.speed.rate = 2.0;
        clip.transform.opacity = 0.5;
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(loaded.normalize().is_ok());
    }

    // C2 follow-up: none of these fields have a command-layer setter that would clamp or reject
    // them (only `effect.setParam` does, covered by the command-level test), so a hand-authored
    // project.json is the only way a non-finite value reaches them. Injected as a JSON `1e300`
    // (a legitimate JSON number, unlike `f32::INFINITY` which `serde_json` would already refuse
    // to serialise as anything but `null`, itself unparsable back into an `f32`) — the actual
    // reviewer repro: a plain, valid-looking JSON number that downcasts to `f32::INFINITY` only
    // once `normalize` reads the field, and must be caught there, not one step earlier.
    #[test]
    fn a_keyframes_non_finite_value_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(2.0),
        );
        clip.keyframes.insert(
            "opacity".into(),
            vec![Keyframe {
                time: Time::ZERO,
                value: ParamValue::Float(0.5),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            }],
        );
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let mut json = serde_json::to_value(&p).unwrap();
        json["timeline"]["tracks"][0]["clips"][0]["keyframes"]["opacity"][0]["value"]["value"] =
            serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // A motion path is `Vec2`, and the second component is the one a check written for scalars
    // walks past. It reaches `Transform::y` and from there the matrix, where a non-finite value
    // takes the whole quad out of the picture rather than raising anything.
    #[test]
    #[allow(clippy::unwrap_used)]
    fn a_motion_paths_non_finite_component_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(2.0),
        );
        clip.keyframes.insert(
            crate::model::POSITION_TRACK.into(),
            vec![Keyframe {
                time: Time::ZERO,
                value: ParamValue::Vec2([1.0, 2.0]),
                interp: Interp::Linear,
                handle_in: None,
                handle_out: None,
            }],
        );
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let mut json = serde_json::to_value(&p).unwrap();
        json["timeline"]["tracks"][0]["clips"][0]["keyframes"]["position"][0]["value"]["value"]
            [1] = serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn an_effects_non_finite_param_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        let mut effect = crate::model::Effect::new("brightness");
        effect
            .params
            .insert("amount".into(), ParamValue::Color([0.2, 0.0, 0.0, 1.0]));
        clip.effects.push(effect);
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let mut json = serde_json::to_value(&p).unwrap();
        json["timeline"]["tracks"][0]["clips"][0]["effects"][0]["params"]["amount"]["value"][0] =
            serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    fn project_with_curve(points: Vec<[f32; 2]>) -> Project {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        let mut effect = crate::model::Effect::new("curves");
        effect.params.insert("luma".into(), ParamValue::Curve(points));
        clip.effects.push(effect);
        track.clips.push(clip);
        p.timeline.tracks.push(track);
        p
    }

    // The one parameter whose size the file chooses, so the one that has to be bounded rather than
    // merely checked: the sampler walks every point, once per curve, once per frame.
    #[test]
    fn a_curve_with_more_points_than_anyone_drags_fails_to_load() {
        let mut inside = project_with_curve(vec![[0.5, 0.5]; MAX_CURVE_POINTS]);
        assert!(inside.normalize().is_ok());

        let mut over = project_with_curve(vec![[0.5, 0.5]; MAX_CURVE_POINTS + 1]);
        assert!(matches!(
            over.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_curve_with_a_non_finite_point_fails_to_load() {
        let mut loaded = project_with_curve(vec![[0.0, 0.0], [f32::NAN, 0.5], [1.0, 1.0]]);
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_generators_non_finite_gradient_angle_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let clip = Clip::new_generator(
            crate::model::Generator::Gradient {
                from: "#000000".into(),
                to: "#ffffff".into(),
                angle: 45.0,
            },
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        let mut json = serde_json::to_value(&p).unwrap();
        json["timeline"]["tracks"][0]["clips"][0]["source"]["generator"]["angle"] =
            serde_json::json!(1e300);
        let mut loaded: Project = serde_json::from_value(json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    fn leaf_clip() -> Clip {
        Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        )
    }

    fn compound_clip(inner: Clip) -> Clip {
        let mut track = Track::new(TrackKind::Video, "nested".into());
        track.clips.push(inner);
        let mut timeline = Timeline::default();
        timeline.tracks.push(track);
        let mut clip = Clip::new_media(
            MediaId::from(String::new()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.source = ClipSource::Compound {
            timeline: Box::new(timeline),
        };
        clip
    }

    #[test]
    fn a_compound_clips_nested_start_is_checked_too() {
        let mut nested = leaf_clip();
        nested.start = Time::from_flicks(i64::MAX);
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(compound_clip(nested));
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        let json = serde_json::to_string(&p).unwrap();
        let mut loaded: Project = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn two_levels_of_compound_nesting_are_accepted() {
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(compound_clip(compound_clip(leaf_clip())));
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        assert!(p.normalize().is_ok());
    }

    fn project_json_with_fps(numerator: u32, denominator: u32) -> String {
        format!(
            r##"{{
                "schemaVersion": 1,
                "meta": {{"id":"prj_1","title":"T","tags":[]}},
                "settings": {{"width":1920,"height":1080,
                             "fps":{{"numerator":{numerator},"denominator":{denominator}}},
                             "sampleRate":48000,"colorSpace":"srgb","background":"#000000"}},
                "timeline": {{"tracks":[]}},
                "markers": [],
                "master": {{"volume":1.0,"effects":[]}}
            }}"##
        )
    }

    #[test]
    fn a_zero_denominator_fps_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(30, 0)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_zero_numerator_fps_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(0, 1)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_sub_one_fps_rate_fails_to_load() {
        let mut p: Project = serde_json::from_str(&project_json_with_fps(1, 3)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn ntsc_rates_still_load() {
        for (numerator, denominator) in [(30_000, 1001), (24_000, 1001), (60_000, 1001)] {
            let mut p: Project =
                serde_json::from_str(&project_json_with_fps(numerator, denominator)).unwrap();
            assert!(
                p.normalize().is_ok(),
                "{numerator}/{denominator} should be accepted"
            );
        }
    }

    fn project_json_with_settings(width: u32, height: u32, sample_rate: u32) -> String {
        format!(
            r##"{{
                "schemaVersion": 1,
                "meta": {{"id":"prj_1","title":"T","tags":[]}},
                "settings": {{"width":{width},"height":{height},
                             "fps":{{"numerator":30000,"denominator":1001}},
                             "sampleRate":{sample_rate},"colorSpace":"srgb","background":"#000000"}},
                "timeline": {{"tracks":[]}},
                "markers": [],
                "master": {{"volume":1.0,"effects":[]}}
            }}"##
        )
    }

    #[test]
    fn a_zero_width_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(0, 1080, 48_000)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_zero_sample_rate_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(1920, 1080, 0)).unwrap();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    // A generator's colour is read by `hex()` in generator.ts, which falls back to black or white
    // for anything it cannot parse -- so a typo becomes a colour rather than a message, exactly as
    // `settings.background` used to. Reachable from a hand-written project.json and from a
    // template's colour slot, which is why it is judged at the one gate both go through.
    #[test]
    fn a_generator_colour_that_is_not_a_hex_colour_fails_to_load() {
        for generator in [
            Generator::Solid {
                color: "chartreuse".into(),
            },
            Generator::Gradient {
                from: "#112233".into(),
                to: "rebeccapurple".into(),
                angle: 0.0,
            },
        ] {
            let mut project = Project::default();
            let mut track = Track::new(TrackKind::Video, "V1".into());
            track.clips.push(Clip::new_generator(
                generator,
                Time::ZERO,
                Time::from_seconds(1.0),
            ));
            project.timeline.tracks.push(track);

            assert!(matches!(
                project.normalize(),
                Err(CoreError::InvalidArgument(_))
            ));
        }
    }

    #[test]
    fn a_background_that_is_not_a_hex_colour_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(1920, 1080, 48_000)).unwrap();
        p.settings.background = "chartreuse".into();
        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn the_three_hex_lengths_a_compositor_reads_all_load() {
        for background in ["#fff", "#3366cc", "#80808080", "#ABCDEF"] {
            let mut p: Project =
                serde_json::from_str(&project_json_with_settings(1920, 1080, 48_000)).unwrap();
            p.settings.background = background.into();
            assert!(p.normalize().is_ok(), "{background} should be accepted");
        }
    }

    // Both colours end up in an inline style in the timeline, where an unparsable value is dropped
    // without a word -- the same silent reinterpretation `settings.background` is checked against.
    #[test]
    fn a_track_colour_that_is_not_a_hex_colour_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.color_hex = "javascript:alert(1)".into();
        p.timeline.tracks.push(track);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_marker_colour_that_is_not_a_hex_colour_fails_to_load() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(1920, 1080, 48_000)).unwrap();
        p.markers.push(super::Marker {
            id: crate::model::MarkerId::new(),
            time: Time::ZERO,
            label: "x".into(),
            color_hex: "rebeccapurple".into(),
        });

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    // An empty group id would put every clip carrying one in the same group, so one `clip.ungroup`
    // anywhere would dissolve groups the author never touched.
    #[test]
    fn a_clip_with_an_empty_group_id_fails_to_load() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.group_id = Some(crate::model::GroupId::from(String::new()));
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn a_clip_with_a_real_group_id_still_loads() {
        let mut p = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(1.0),
        );
        clip.group_id = Some(crate::model::GroupId::new());
        track.clips.push(clip);
        p.timeline.tracks.push(track);

        assert!(p.normalize().is_ok());
    }

    #[test]
    fn a_legitimate_4k_ntsc_project_still_loads() {
        let mut p: Project =
            serde_json::from_str(&project_json_with_settings(3840, 2160, 48_000)).unwrap();
        assert!(p.normalize().is_ok());
    }

    #[test]
    fn a_media_assets_bad_fps_is_caught_too() {
        let mut p = Project::default();
        let mut asset = MediaAsset::new(
            MediaId::from("med_x".to_string()),
            "clip.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            10,
        );
        asset.fps = Some(Rate::new(30, 0));
        p.library.push(asset);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }

    #[test]
    fn compound_nesting_deeper_than_the_limit_is_rejected() {
        let mut clip = leaf_clip();
        for _ in 0..(MAX_COMPOUND_DEPTH + 2) {
            clip = compound_clip(clip);
        }
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(clip);
        let mut p = Project::default();
        p.timeline.tracks.push(track);

        assert!(matches!(p.normalize(), Err(CoreError::InvalidArgument(_))));
    }
}
