use super::{is_fractional, timecode, whole_fps};
use crate::model::{Clip, ClipSource, Project, Time, TrackKind};

/// A CMX3600 edit decision list: the oldest thing in this trade and the one every system reads.
///
/// It carries one video track and one audio track, four timecodes per event, and the name of the
/// material. That is all it can carry — no effects, no keyframes, no second video layer — and saying
/// so is more useful than a file that pretends otherwise. An EDL is what a conform starts from: the
/// cut arrives, the material is relinked by name, and the finishing happens in the other system.
///
/// The lowest video track and the lowest audio track are the two that go, because an EDL has one
/// channel for each and picking the busiest would make which track survived a fact about counting.
/// Everything above them is listed in a comment, so nothing goes missing quietly.
pub fn to_edl(project: &Project) -> String {
    let fps = project.settings.fps;
    let mut out = String::new();
    out.push_str(&format!("TITLE: {}\n", sanitised(&project.meta.title)));
    // Non-drop, always, and the note says why: drop-frame timecode skips numbers rather than frames,
    // which only matters when a duration is read off the clock by hand. Every system this file is for
    // reads the header and obeys it.
    out.push_str("FCM: NON-DROP FRAME\n");
    if is_fractional(fps) {
        out.push_str(&format!(
            "* RATE: {}/{} — TIMECODE COUNTS {} FRAMES A SECOND AND RUNS SLOW\n",
            fps.numerator,
            fps.denominator,
            whole_fps(fps),
        ));
    }
    out.push('\n');

    let video = first_of(project, |kind| matches!(kind, TrackKind::Video));
    let audio = first_of(project, |kind| matches!(kind, TrackKind::Audio));

    let mut event = 0u32;
    for (channel, track) in [("V", video), ("A", audio)] {
        let Some(clips) = track else { continue };
        for clip in clips {
            event += 1;
            let source_in = clip.in_point;
            let source_out =
                Time::from_flicks(clip.in_point.as_flicks() + clip.duration.as_flicks());
            out.push_str(&format!(
                "{:03}  AX       {:<5} C        {} {} {} {}\n",
                event,
                channel,
                timecode(source_in, fps),
                timecode(source_out, fps),
                timecode(clip.start, fps),
                timecode(
                    Time::from_flicks(clip.start.as_flicks() + clip.duration.as_flicks()),
                    fps,
                ),
            ));
            out.push_str(&format!(
                "* FROM CLIP NAME: {}\n",
                sanitised(&name_of(clip))
            ));
        }
    }

    if event == 0 {
        out.push_str("* NOTHING TO CONFORM: THIS TIMELINE HOLDS NO CLIPS\n");
    }

    let carried = 1 + usize::from(audio.is_some());
    let total = project.timeline.tracks.len();
    if total > carried {
        out.push_str(&format!(
            "\n* THIS EDL CARRIES ONE VIDEO AND ONE AUDIO TRACK. {} OF {} TRACKS ARE NOT IN IT.\n",
            total - carried,
            total,
        ));
    }
    out
}

fn first_of(project: &Project, wanted: impl Fn(TrackKind) -> bool) -> Option<&[Clip]> {
    project
        .timeline
        .tracks
        .iter()
        .find(|track| wanted(track.kind))
        .map(|track| track.clips.as_slice())
}

/// What the material is called. An EDL relinks by name, so a clip with no medium behind it says what
/// it is instead of naming nothing — a conform that silently dropped a title would be worse.
pub(crate) fn name_of(clip: &Clip) -> String {
    match &clip.source {
        ClipSource::Media { media } => media.as_str().to_string(),
        ClipSource::Generator { .. } => "GENERATED".to_string(),
        ClipSource::Compound { .. } => "COMPOUND".to_string(),
    }
}

/// An EDL is a line-oriented format with no way to escape anything, so a newline or a stray
/// non-ASCII byte in a title is a line another system will misread. Kept to what the format can
/// carry, in upper case, which is the convention every EDL follows.
fn sanitised(text: &str) -> String {
    let trimmed: String = text
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let name = trimmed.trim();
    if name.is_empty() {
        "UNTITLED".to_string()
    } else {
        name.to_uppercase()
    }
}
