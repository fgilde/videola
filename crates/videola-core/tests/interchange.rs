#![allow(clippy::unwrap_used, clippy::expect_used)]

use videola_core::command::{Command, Dispatch};
use videola_core::interchange::{to_edl, to_fcpxml};
use videola_core::model::{ClipSource, MediaId, Project, ProjectSettings, Rate, Time, TrackKind};
use videola_core::Document;

// Neither file carries an effect or a keyframe. What they carry is where each piece of material sits,
// and that is what these checks are about: a timecode, an offset, and a name another system can
// relink by.

const SECOND: i64 = 705_600_000;

fn doc(fps: Rate) -> Document {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::ProjectSetSettings {
        settings: ProjectSettings {
            fps,
            ..ProjectSettings::default()
        },
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle {
        title: "Reel & Cut".into(),
    }))
    .unwrap();
    doc
}

fn add_track(doc: &mut Document, kind: TrackKind, name: &str) -> String {
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind,
        name: name.to_string(),
        index: None,
    }))
    .unwrap();
    doc.project()
        .timeline
        .tracks
        .last()
        .map(|track| track.id.as_str().to_string())
        .unwrap()
}

fn add_clip(doc: &mut Document, track: &str, media: &str, start: i64, duration: i64) {
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: videola_core::model::TrackId::from(track.to_string()),
        source: ClipSource::Media {
            media: MediaId::from(media.to_string()),
        },
        start: Time::from_flicks(start),
        duration: Time::from_flicks(duration),
    }))
    .unwrap();
}

fn project_with_two_tracks() -> Project {
    let mut doc = doc(Rate::from_fps(25));
    let video = add_track(&mut doc, TrackKind::Video, "V1");
    let audio = add_track(&mut doc, TrackKind::Audio, "A1");
    add_clip(&mut doc, &video, "med_a", 0, 2 * SECOND);
    add_clip(&mut doc, &video, "med_b", 2 * SECOND, 3 * SECOND);
    add_clip(&mut doc, &audio, "med_c", SECOND, 4 * SECOND);
    doc.project().clone()
}

// ------------------------------------------------------------------ the EDL

#[test]
fn an_edl_names_the_project_and_its_frame_counting() {
    let edl = to_edl(&project_with_two_tracks());
    assert!(edl.starts_with("TITLE: REEL & CUT\n"), "{edl}");
    assert!(edl.contains("FCM: NON-DROP FRAME"));
}

#[test]
fn an_edl_holds_one_event_per_clip_with_four_timecodes() {
    let edl = to_edl(&project_with_two_tracks());
    // Two on the video track, one on the audio track.
    assert_eq!(edl.matches("* FROM CLIP NAME:").count(), 3);
    // The second video event: two seconds in, three long, at 25 frames a second.
    assert!(
        edl.contains(
            "002  AX       V     C        00:00:00:00 00:00:03:00 00:00:02:00 00:00:05:00"
        ),
        "{edl}"
    );
    // And the audio one is its own channel.
    assert!(
        edl.contains(
            "003  AX       A     C        00:00:00:00 00:00:04:00 00:00:01:00 00:00:05:00"
        ),
        "{edl}"
    );
}

// The format has one video and one audio channel. Saying which tracks did not fit is the difference
// between a file that is honest about its limits and one that quietly loses two layers.
#[test]
fn an_edl_says_which_tracks_it_could_not_carry() {
    let mut doc = doc(Rate::from_fps(25));
    for name in ["V1", "V2", "V3"] {
        let track = add_track(&mut doc, TrackKind::Video, name);
        add_clip(&mut doc, &track, "med_a", 0, SECOND);
    }
    let edl = to_edl(doc.project());
    assert!(edl.contains("2 OF 3 TRACKS ARE NOT IN IT"), "{edl}");
}

#[test]
fn an_edl_says_so_rather_than_being_empty() {
    let edl = to_edl(doc(Rate::from_fps(25)).project());
    assert!(edl.contains("NOTHING TO CONFORM"), "{edl}");
}

// A newline in a title is a line another system misreads, and an EDL has no way to escape one.
#[test]
fn an_edl_keeps_a_title_to_what_the_format_can_carry() {
    let mut doc = doc(Rate::from_fps(25));
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle {
        title: "two\nlines\tand ümlauts".into(),
    }))
    .unwrap();
    let edl = to_edl(doc.project());
    let first = edl.lines().next().unwrap();
    assert_eq!(first, "TITLE: TWO_LINES_AND _MLAUTS");
    assert_eq!(
        edl.lines()
            .filter(|line| line.starts_with("TITLE:"))
            .count(),
        1
    );
}

// 30000/1001 counts thirty frames a second and runs slow. The header says non-drop and the note says
// what the rate really is, because a duration read off this clock by hand will be a little short.
#[test]
fn an_edl_notes_a_fractional_rate_instead_of_pretending_it_is_whole() {
    let mut doc = doc(Rate::new(30000, 1001));
    let track = add_track(&mut doc, TrackKind::Video, "V1");
    add_clip(&mut doc, &track, "med_a", 0, 2 * SECOND);

    let edl = to_edl(doc.project());
    assert!(edl.contains("* RATE: 30000/1001"), "{edl}");
    assert!(
        edl.contains("COUNTS 30 FRAMES A SECOND AND RUNS SLOW"),
        "{edl}"
    );
}

// ------------------------------------------------------------------ FCPXML

#[test]
fn fcpxml_declares_the_version_the_other_editors_read() {
    let xml = to_fcpxml(&project_with_two_tracks());
    assert!(xml.contains("<!DOCTYPE fcpxml>"));
    assert!(xml.contains("<fcpxml version=\"1.9\">"));
    assert!(xml.trim_end().ends_with("</fcpxml>"));
}

#[test]
fn fcpxml_carries_the_format_the_project_renders_at() {
    let xml = to_fcpxml(&project_with_two_tracks());
    assert!(
        xml.contains("frameDuration=\"1/25s\" width=\"1920\" height=\"1080\""),
        "{xml}"
    );
}

// One asset per medium, keyed by the id the library uses -- the SHA-256 of the file's own bytes -- so
// a relink in the other system is looking for exactly the file this project held.
#[test]
fn fcpxml_declares_each_medium_once() {
    let xml = to_fcpxml(&project_with_two_tracks());
    assert_eq!(xml.matches("<asset ").count(), 3);
    assert_eq!(xml.matches("<asset id=\"a1\"").count(), 1, "declared once");
    assert_eq!(
        xml.matches("ref=\"a1\"").count(),
        1,
        "and referenced by the clip that uses it"
    );
}

// Exact, and that is the point of counting in flicks: a flick divides evenly by every rate anyone
// uses, so no time in this file is ever rounded.
#[test]
fn fcpxml_writes_every_time_exactly() {
    let xml = to_fcpxml(&project_with_two_tracks());
    assert!(
        xml.contains("offset=\"50/25s\" duration=\"75/25s\""),
        "{xml}"
    );
    for rate in [
        Rate::from_fps(24),
        Rate::new(30000, 1001),
        Rate::from_fps(60),
    ] {
        let mut doc = doc(rate);
        let track = add_track(&mut doc, TrackKind::Video, "V1");
        add_clip(&mut doc, &track, "med_a", SECOND / 3, SECOND / 7);
        let written = to_fcpxml(doc.project());
        assert!(
            !written.contains(".") || !written.contains("offset=\"0."),
            "{written}"
        );
    }
}

// A second layer is a clip hung off the spine at a lane number, which is how this format says "these
// two play at the same time". Audio goes below the spine, which is what a negative lane means.
#[test]
fn fcpxml_puts_a_second_track_on_a_lane_of_its_own() {
    let xml = to_fcpxml(&project_with_two_tracks());
    assert!(xml.contains("lane=\"-1\""), "{xml}");
    assert_eq!(
        xml.matches("lane=").count(),
        1,
        "the spine itself carries no lane"
    );
}

// A title or a colour has no asset to point at, and an asset-clip pointing at nothing opens in the
// other system as an offline clip somebody has to hunt for.
#[test]
fn fcpxml_writes_a_generator_as_a_gap_of_the_right_length() {
    let mut doc = doc(Rate::from_fps(25));
    let track = add_track(&mut doc, TrackKind::Video, "V1");
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: videola_core::model::TrackId::from(track.clone()),
        source: ClipSource::Generator {
            generator: videola_core::model::Generator::Solid {
                color: "#ff0000".into(),
            },
        },
        start: Time::ZERO,
        duration: Time::from_flicks(2 * SECOND),
    }))
    .unwrap();

    let xml = to_fcpxml(doc.project());
    assert!(xml.contains("<gap name=\"GENERATED\""), "{xml}");
    assert!(xml.contains("duration=\"50/25s\""), "{xml}");
    assert!(
        !xml.contains("<asset "),
        "nothing to relink, so nothing declared"
    );
}

// XML: five characters decide whether the file parses at all, and a title is whatever somebody typed.
#[test]
fn fcpxml_escapes_what_xml_reserves() {
    let mut doc = doc(Rate::from_fps(25));
    doc.dispatch(Dispatch::new(Command::ProjectSetTitle {
        title: "<a> & \"b\"".into(),
    }))
    .unwrap();
    let xml = to_fcpxml(doc.project());
    assert!(
        xml.contains("name=\"&lt;a&gt; &amp; &quot;b&quot;\""),
        "{xml}"
    );
    assert!(!xml.contains("name=\"<a>"), "{xml}");
}

#[test]
fn fcpxml_of_an_empty_timeline_is_still_a_document() {
    let xml = to_fcpxml(doc(Rate::from_fps(25)).project());
    assert!(xml.contains("<spine>"));
    assert!(xml.contains("duration=\"0/25s\""), "{xml}");
}
