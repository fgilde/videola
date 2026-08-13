use super::edl::name_of;
use super::{frames_at, is_fractional, whole_fps};
use crate::model::{Clip, ClipSource, Project, Rate, Time, TrackKind};

/// Final Cut Pro 7 XML, `xmeml` version 5: the interchange Premiere Pro imports natively.
///
/// Why a second XML alongside FCPXML: they are different formats with confusingly similar names, and
/// which one an editor reads is not a matter of taste. Resolve reads FCPXML 1.x well. Premiere Pro's
/// FCPXML support has always been partial, while **File ▸ Import** has taken an `xmeml` sequence
/// since Premiere read Final Cut projects for a living — that is the file that arrives as a real
/// sequence with real clips rather than as a list of errors. Resolve reads `xmeml` too, so this is
/// the wider of the two doors, and Videola writes both rather than guessing.
///
/// The unit here is the frame, not a rational. That is the format's own decision and the reason this
/// is not a variation on the FCPXML writer: every instant becomes an integer frame number through
/// `frames_at`, which rounds to nearest, so a cut lands on the frame it was authored on.
///
/// What it carries: where each piece of material sits, its source range, its own name, and the
/// arrangement of tracks. What it does not: effects, keyframes, grades and generators. A title or a
/// colour field has no file behind it, and `xmeml` has no gap element — a clip with no material is
/// left out rather than written as a clipitem pointing nowhere, which would arrive as an offline clip
/// somebody has to hunt for.
pub fn to_xmeml(project: &Project) -> String {
    let fps = project.settings.fps;
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str("<!DOCTYPE xmeml>\n");
    out.push_str("<xmeml version=\"5\">\n");
    out.push_str("  <sequence id=\"sequence-1\">\n");
    out.push_str(&format!("    <name>{}</name>\n", escaped(&title(project))));
    out.push_str(&format!(
        "    <duration>{}</duration>\n",
        frames_at(end_of(project), fps)
    ));
    out.push_str(&rate_element(fps, 2));
    // The sequence's own start. Zero rather than an hour: a Videola timeline starts at zero, and an
    // offset written here would move every clip in the conform.
    out.push_str("    <timecode>\n");
    out.push_str(&rate_element(fps, 3));
    out.push_str("      <string>00:00:00:00</string>\n");
    out.push_str("      <frame>0</frame>\n");
    out.push_str(&format!(
        "      <displayformat>{}</displayformat>\n",
        if is_fractional(fps) { "DF" } else { "NDF" }
    ));
    out.push_str("    </timecode>\n");

    out.push_str("    <media>\n");
    // A file is declared in full where it is first used and referenced by id after that. Repeating
    // the whole element per clip is legal and is how a file ends up in the project panel four times.
    let mut declared: Vec<String> = Vec::new();
    let mut item = 0;

    out.push_str("      <video>\n");
    out.push_str("        <format>\n");
    out.push_str("          <samplecharacteristics>\n");
    out.push_str(&rate_element(fps, 6));
    out.push_str(&format!(
        "            <width>{}</width>\n            <height>{}</height>\n",
        project.settings.width, project.settings.height
    ));
    out.push_str("          </samplecharacteristics>\n");
    out.push_str("        </format>\n");
    for track in picture_tracks(project) {
        out.push_str("        <track>\n");
        for clip in &track.clips {
            out.push_str(&clip_item(
                clip,
                fps,
                &mut declared,
                &mut item,
                MediaType::Video,
            ));
        }
        out.push_str("        </track>\n");
    }
    out.push_str("      </video>\n");

    let sound = sound_tracks(project);
    if !sound.is_empty() {
        out.push_str("      <audio>\n");
        for track in sound {
            out.push_str("        <track>\n");
            for clip in &track.clips {
                out.push_str(&clip_item(
                    clip,
                    fps,
                    &mut declared,
                    &mut item,
                    MediaType::Audio,
                ));
            }
            out.push_str("        </track>\n");
        }
        out.push_str("      </audio>\n");
    }

    out.push_str("    </media>\n");
    out.push_str("  </sequence>\n");
    out.push_str("</xmeml>\n");
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MediaType {
    Video,
    Audio,
}

impl MediaType {
    fn name(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Audio => "audio",
        }
    }
}

fn clip_item(
    clip: &Clip,
    fps: Rate,
    declared: &mut Vec<String>,
    item: &mut usize,
    media: MediaType,
) -> String {
    if !matches!(clip.source, ClipSource::Media { .. }) {
        return String::new();
    }
    let name = name_of(clip);
    *item += 1;
    let start = frames_at(clip.start, fps);
    let duration = frames_at(clip.duration, fps);
    let in_point = frames_at(clip.in_point, fps);
    let mut out = String::new();
    out.push_str(&format!(
        "          <clipitem id=\"clipitem-{}\">\n            <name>{}</name>\n",
        item,
        escaped(&name)
    ));
    out.push_str(&format!("            <duration>{duration}</duration>\n"));
    out.push_str(&rate_element(fps, 6));
    // Four numbers, and the pair that is easy to get wrong: `start`/`end` are where the clip sits on
    // the timeline, `in`/`out` are which part of the file it shows. `end` is exclusive, so a clip of
    // one frame has end == start + 1.
    out.push_str(&format!(
        "            <start>{}</start>\n            <end>{}</end>\n",
        start,
        start + duration
    ));
    out.push_str(&format!(
        "            <in>{}</in>\n            <out>{}</out>\n",
        in_point,
        in_point + duration
    ));
    out.push_str(&format!(
        "            <enabled>{}</enabled>\n",
        if clip.enabled { "TRUE" } else { "FALSE" }
    ));
    let id = file_id(&name, declared);
    if declared.contains(&name) {
        out.push_str(&format!("            <file id=\"{id}\"/>\n"));
    } else {
        declared.push(name.clone());
        out.push_str(&format!(
            "            <file id=\"{}\">\n              <name>{}</name>\n",
            id,
            escaped(&name)
        ));
        // Relative, and no host: a Videola project keeps its media inside its own container, so an
        // absolute path from this machine would be a path that resolves nowhere else. Dropped beside
        // the XML, the file is found; anywhere else it is one relink.
        out.push_str(&format!(
            "              <pathurl>{}</pathurl>\n",
            escaped(&name)
        ));
        out.push_str(&rate_element(fps, 7));
        out.push_str("              <media>\n                <video/>\n                <audio/>\n              </media>\n");
        out.push_str("            </file>\n");
    }
    // Which stream of the file this clip takes. Without it an audio clipitem is ambiguous, and
    // Premiere puts the whole file on the track rather than its sound.
    out.push_str(&format!(
        "            <sourcetrack>\n              <mediatype>{}</mediatype>\n              <trackindex>1</trackindex>\n            </sourcetrack>\n",
        media.name()
    ));
    out.push_str("          </clipitem>\n");
    out
}

/// `<rate>` as this format writes one: a whole-number timebase and a flag for the 1000/1001 family.
/// 30000/1001 is `timebase 30, ntsc TRUE`, which is exactly how every editor reading this states it.
fn rate_element(fps: Rate, indent: usize) -> String {
    let pad = "  ".repeat(indent);
    format!(
        "{pad}<rate>\n{pad}  <timebase>{}</timebase>\n{pad}  <ntsc>{}</ntsc>\n{pad}</rate>\n",
        whole_fps(fps),
        if is_fractional(fps) { "TRUE" } else { "FALSE" },
    )
}

fn file_id(name: &str, declared: &[String]) -> String {
    match declared.iter().position(|held| held == name) {
        Some(index) => format!("file-{}", index + 1),
        None => format!("file-{}", declared.len() + 1),
    }
}

fn picture_tracks(project: &Project) -> Vec<&crate::model::Track> {
    project
        .timeline
        .tracks
        .iter()
        .filter(|track| !matches!(track.kind, TrackKind::Audio))
        .filter(|track| track.clips.iter().any(has_media))
        .collect()
}

fn sound_tracks(project: &Project) -> Vec<&crate::model::Track> {
    project
        .timeline
        .tracks
        .iter()
        .filter(|track| matches!(track.kind, TrackKind::Audio))
        .filter(|track| track.clips.iter().any(has_media))
        .collect()
}

fn has_media(clip: &Clip) -> bool {
    matches!(clip.source, ClipSource::Media { .. })
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

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
