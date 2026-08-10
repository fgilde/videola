use super::edl::name_of;
use super::whole_fps;
use crate::model::{Clip, Project, Time, TrackKind, FLICKS_PER_SECOND};

/// FCPXML: the interchange DaVinci Resolve, Premiere Pro and Final Cut all read.
///
/// Where an EDL has one video track and one audio track, this has as many as the timeline does, in
/// the order they stack — so what leaves here is the arrangement somebody built rather than a
/// flattened version of it. It still carries no effect and no keyframe: those are every system's own
/// and there is no honest way to write a Videola blur as a Resolve one.
///
/// Times are written as FCPXML writes them: a rational `value/timescale s`, and the timescale is the
/// frame duration's denominator. Videola's flick is 705,600,000 to the second and divides evenly by
/// every rate in use, so every instant in a project is an exact number of frames and no time in this
/// file is ever rounded.
pub fn to_fcpxml(project: &Project) -> String {
    let fps = project.settings.fps;
    let timescale = i64::from(fps.numerator.max(1));
    let frame_duration = format!("{}/{}s", fps.denominator.max(1), timescale);
    let width = project.settings.width;
    let height = project.settings.height;

    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<!DOCTYPE fcpxml>\n");
    // 1.9 rather than the newest: it is the version Resolve and Premiere both read without
    // complaint, and nothing written here needs anything a later one added.
    out.push_str("<fcpxml version=\"1.9\">\n");

    out.push_str("  <resources>\n");
    out.push_str(&format!(
        "    <format id=\"r0\" name=\"FFVideoFormat{}p{}\" frameDuration=\"{}\" width=\"{}\" height=\"{}\"/>\n",
        height,
        whole_fps(fps),
        frame_duration,
        width,
        height,
    ));
    // One asset per medium, named by the id the library keys it under -- which is the SHA-256 of the
    // file's own bytes, so a relink in the other system is looking for exactly the file this project
    // held. `src` is a bare file name because a Videola project keeps its media inside its own
    // container: an absolute path from this machine would be a path that resolves nowhere else.
    let assets = media_assets(project);
    for (index, asset) in assets.iter().enumerate() {
        out.push_str(&format!(
            "    <asset id=\"a{}\" name=\"{}\" src=\"{}\" start=\"0/1s\" hasVideo=\"1\" hasAudio=\"1\" format=\"r0\"/>\n",
            index + 1,
            escaped(asset),
            escaped(asset),
        ));
    }
    out.push_str("  </resources>\n");

    out.push_str("  <library>\n");
    out.push_str(&format!(
        "    <event name=\"{}\">\n",
        escaped(&title(project))
    ));
    out.push_str(&format!(
        "      <project name=\"{}\">\n",
        escaped(&title(project))
    ));
    out.push_str(&format!(
        "        <sequence format=\"r0\" duration=\"{}\" tcStart=\"0/1s\" tcFormat=\"NDF\">\n",
        rational(end_of(project), timescale),
    ));
    out.push_str("          <spine>\n");

    // The lowest video track goes on the spine and everything above it is connected to it, which is
    // how FCPXML says "these play at the same time": a spine is one strip of time, and a second
    // layer is a clip hung off the first at an offset. `tracks[0]` is the bottom of the stack here
    // and the start of the spine there, so the two orders agree.
    let mut tracks = project
        .timeline
        .tracks
        .iter()
        .filter(|t| !t.clips.is_empty());
    let base = tracks.next();
    let above: Vec<_> = tracks.collect();

    if let Some(track) = base {
        for clip in &track.clips {
            let lane = 0;
            out.push_str(&clip_element(clip, &assets, timescale, lane, 5));
        }
    }
    for (level, track) in above.iter().enumerate() {
        for clip in &track.clips {
            // Lane numbers count up from the spine, and an audio track goes below it -- which is
            // what a negative lane means in this format.
            let lane = if matches!(track.kind, TrackKind::Audio) {
                -(level as i32 + 1)
            } else {
                level as i32 + 1
            };
            out.push_str(&clip_element(clip, &assets, timescale, lane, 5));
        }
    }

    out.push_str("          </spine>\n");
    out.push_str("        </sequence>\n");
    out.push_str("      </project>\n");
    out.push_str("    </event>\n");
    out.push_str("  </library>\n");
    out.push_str("</fcpxml>\n");
    out
}

fn clip_element(
    clip: &Clip,
    assets: &[String],
    timescale: i64,
    lane: i32,
    indent: usize,
) -> String {
    let pad = "  ".repeat(indent);
    let name = name_of(clip);
    let reference = assets
        .iter()
        .position(|asset| *asset == name)
        .map(|index| format!("a{}", index + 1));
    let offset = rational(clip.start, timescale);
    let duration = rational(clip.duration, timescale);
    let start = rational(clip.in_point, timescale);
    let lane_attribute = if lane == 0 {
        String::new()
    } else {
        format!(" lane=\"{lane}\"")
    };

    match reference {
        // A clip with no medium behind it -- a title, a colour, a compound -- is a gap of the right
        // length with its name on it. Better than an asset-clip pointing at nothing: that opens in
        // the other system as an offline clip somebody has to hunt for.
        None => format!(
            "{pad}<gap name=\"{}\" offset=\"{}\" duration=\"{}\"{}/>\n",
            escaped(&name),
            offset,
            duration,
            lane_attribute,
        ),
        Some(reference) => format!(
            "{pad}<asset-clip ref=\"{}\" name=\"{}\" offset=\"{}\" duration=\"{}\" start=\"{}\"{}/>\n",
            reference,
            escaped(&name),
            offset,
            duration,
            start,
            lane_attribute,
        ),
    }
}

/// A Videola time as FCPXML writes one: an exact rational in the sequence's own timescale.
///
/// A flick is 705,600,000 to the second and divides evenly by every rate anyone uses, so
/// `flicks * timescale` is always a whole number of ticks -- this never rounds, which is the whole
/// reason the model counts in flicks.
fn rational(at: Time, timescale: i64) -> String {
    let flicks = at.as_flicks().max(0) as i128;
    let ticks = (flicks * i128::from(timescale)) / i128::from(FLICKS_PER_SECOND);
    format!("{}/{}s", ticks, timescale)
}

fn media_assets(project: &Project) -> Vec<String> {
    let mut assets: Vec<String> = Vec::new();
    for track in &project.timeline.tracks {
        for clip in &track.clips {
            if !matches!(clip.source, crate::model::ClipSource::Media { .. }) {
                continue;
            }
            let name = name_of(clip);
            if !assets.contains(&name) {
                assets.push(name);
            }
        }
    }
    assets
}

fn end_of(project: &Project) -> Time {
    let last = project
        .timeline
        .tracks
        .iter()
        .flat_map(|track| track.clips.iter())
        .map(|clip| clip.start.as_flicks() + clip.duration.as_flicks())
        .max()
        .unwrap_or(0);
    Time::from_flicks(last)
}

fn title(project: &Project) -> String {
    let name = project.meta.title.trim();
    if name.is_empty() {
        "Untitled".to_string()
    } else {
        name.to_string()
    }
}

/// XML, so five characters decide whether the file parses at all. A project title is whatever
/// somebody typed, and an ampersand in it must not be the reason another editor refuses the file.
fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
