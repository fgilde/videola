#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::{Cursor, Write};

use videola_core::audiola::{read_audiola, write_audiola};
use videola_core::command::{Command, Dispatch};
use videola_core::format::MemoryMediaStore;
use videola_core::model::{
    ClipSource, Generator, MediaAsset, MediaId, MediaKind, Project, Time, TrackId, TrackKind,
};
use videola_core::Document;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

// Audiola is the audio tool next door, and its `.audiola` is a ZIP with a PascalCase `project.json`
// beside a `media/` directory. These checks are about the one thing a shared format has to get right:
// that what one tool means by a place in time is what the other reads there.

const SECOND: i64 = 705_600_000;
const WAV: &[u8] = b"RIFF----WAVEfmt fake audio bytes";

fn archive(manifest: &str, entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    for (path, bytes) in entries {
        zip.start_file(*path, options).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.start_file("project.json", options).unwrap();
    zip.write_all(manifest.as_bytes()).unwrap();
    zip.finish().unwrap().into_inner()
}

// ------------------------------------------------------------------ reading

const ONE_TRACK: &str = r##"{
  "Version": 1,
  "MasterVolume": 1.0,
  "Tracks": [
    {
      "Name": "Voice",
      "ColorHex": "#AA3344",
      "Volume": 0.8,
      "Pan": -0.5,
      "IsEnabled": true,
      "IsMuted": false,
      "IsSolo": true,
      "Clips": [
        {
          "Media": "media/0_take.wav",
          "SourceTotalSeconds": 12.0,
          "TimelineOffsetSeconds": 2.5,
          "SourceStartSeconds": 1.25,
          "LengthSeconds": 4.0,
          "GainDb": -6.0,
          "FadeInSeconds": 0.5,
          "FadeOutSeconds": 0.25
        }
      ]
    }
  ]
}"##;

#[test]
fn a_track_arrives_with_its_name_gain_and_pan() {
    let read = read_audiola(Cursor::new(archive(
        ONE_TRACK,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();

    assert_eq!(read.tracks.len(), 1);
    let track = &read.tracks[0];
    assert_eq!(track.name, "Voice");
    assert_eq!(track.color_hex, "#AA3344");
    assert!((track.volume - 0.8).abs() < 1e-6);
    assert!((track.pan + 0.5).abs() < 1e-6);
    assert!(track.solo);
    assert!(!track.muted);
}

// The one place this can lose anything: Audiola counts in double seconds, Videola in integer flicks.
#[test]
fn every_time_arrives_exactly() {
    let read = read_audiola(Cursor::new(archive(
        ONE_TRACK,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();
    let clip = &read.tracks[0].clips[0];

    assert_eq!(clip.start, Time::from_flicks(5 * SECOND / 2));
    assert_eq!(clip.duration, Time::from_flicks(4 * SECOND));
    assert_eq!(clip.in_point, Time::from_flicks(5 * SECOND / 4));
    assert_eq!(clip.fade_in, Time::from_flicks(SECOND / 2));
    assert_eq!(clip.fade_out, Time::from_flicks(SECOND / 4));
}

// A fader in decibels is a multiplier here. Minus six decibels is half the amplitude, which is what
// every mixer means by it.
#[test]
fn a_gain_in_decibels_arrives_as_the_factor_it_is() {
    let read = read_audiola(Cursor::new(archive(
        ONE_TRACK,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();
    assert!((read.tracks[0].clips[0].volume - 0.501_187).abs() < 1e-4);
}

// Keyed by the hash of the bytes, like every other medium: the same file imported from an `.audiola`
// and dropped on the window is one library entry and not two.
#[test]
fn media_are_keyed_by_their_own_bytes() {
    let read = read_audiola(Cursor::new(archive(
        ONE_TRACK,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();
    let expected = MediaId::from_bytes(WAV);

    assert_eq!(read.media.len(), 1);
    assert!(read.media.contains_key(&expected));
    assert_eq!(read.tracks[0].clips[0].media, expected);
    // The index Audiola prefixes for uniqueness is the archive's business, not the file's name.
    assert_eq!(read.tracks[0].clips[0].name, "take.wav");
}

#[test]
fn a_zip_without_a_manifest_is_refused_by_name() {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("something.txt", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"not a project").unwrap();
    let bytes = zip.finish().unwrap().into_inner();

    let error = read_audiola(Cursor::new(bytes)).unwrap_err();
    assert!(format!("{error}").contains("project.json"), "{error}");
}

// A clip naming a file the archive does not hold is a note, not a failure: the rest of the mix is
// still worth having, and silence about it would be the worst answer.
#[test]
fn a_missing_file_is_said_rather_than_guessed_at() {
    let read = read_audiola(Cursor::new(archive(ONE_TRACK, &[]))).unwrap();

    assert!(read.tracks.is_empty());
    assert!(
        read.notes
            .iter()
            .any(|note| note.contains("media/0_take.wav")),
        "{:?}",
        read.notes
    );
}

#[test]
fn a_clip_with_no_length_is_left_out_and_said() {
    let manifest = ONE_TRACK.replace("\"LengthSeconds\": 4.0", "\"LengthSeconds\": 0.0");
    let read = read_audiola(Cursor::new(archive(
        &manifest,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();

    assert!(
        read.notes.iter().any(|note| note.contains("no length")),
        "{:?}",
        read.notes
    );
}

// Audiola's `IsEnabled` and its `IsMuted` both silence a track; Videola has one flag for that.
#[test]
fn a_disabled_track_arrives_muted_rather_than_audible() {
    let manifest = ONE_TRACK.replace("\"IsEnabled\": true", "\"IsEnabled\": false");
    let read = read_audiola(Cursor::new(archive(
        &manifest,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();

    assert!(read.tracks[0].muted);
}

// Somebody who mastered a mix there should learn from this list that the mastering stayed there.
#[test]
fn what_stays_in_audiola_is_named() {
    let manifest = ONE_TRACK.replace(
        "\"MasterVolume\": 1.0,",
        "\"MasterVolume\": 1.0, \"Mastering\": { \"Ceiling\": -1.0 },",
    );
    let read = read_audiola(Cursor::new(archive(
        &manifest,
        &[("media/0_take.wav", WAV)],
    )))
    .unwrap();

    assert!(
        read.notes
            .iter()
            .any(|note| note.contains("Mastering stays in Audiola")),
        "{:?}",
        read.notes
    );
}

// ------------------------------------------------------------------ writing

fn project_with_sound() -> (Project, MemoryMediaStore) {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Audio,
        name: "A1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let id = MediaId::from_bytes(WAV);
    doc.dispatch(Dispatch::new(Command::MediaImport {
        asset: MediaAsset {
            id: id.clone(),
            original_name: "take one.wav".into(),
            mime: "audio/wav".into(),
            kind: MediaKind::Audio,
            size_bytes: WAV.len() as u64,
            duration: Some(Time::from_flicks(12 * SECOND)),
            width: None,
            height: None,
            fps: None,
            sample_rate: Some(48_000),
            channels: Some(2),
        },
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: TrackId::from(track.as_str().to_string()),
        source: ClipSource::Media { media: id.clone() },
        start: Time::from_flicks(3 * SECOND),
        duration: Time::from_flicks(2 * SECOND),
    }))
    .unwrap();

    let mut store = MemoryMediaStore::default();
    store.insert(id, WAV.to_vec());
    (doc.project().clone(), store)
}

#[test]
fn what_is_written_is_what_is_read_back() {
    let (project, store) = project_with_sound();
    let mut bytes = Cursor::new(Vec::new());
    let left_out = write_audiola(&mut bytes, &project, &store).unwrap();
    assert_eq!(left_out, 0);

    let read = read_audiola(Cursor::new(bytes.into_inner())).unwrap();
    assert_eq!(read.tracks.len(), 1);
    assert_eq!(read.tracks[0].name, "A1");
    assert_eq!(read.tracks[0].clips[0].start, Time::from_flicks(3 * SECOND));
    assert_eq!(
        read.tracks[0].clips[0].duration,
        Time::from_flicks(2 * SECOND)
    );
    assert_eq!(read.tracks[0].clips[0].name, "take one.wav");
    assert_eq!(read.media.len(), 1);
}

#[test]
fn the_manifest_is_pascal_case_because_audiola_reads_it_that_way() {
    let (project, store) = project_with_sound();
    let mut bytes = Cursor::new(Vec::new());
    write_audiola(&mut bytes, &project, &store).unwrap();

    let mut zip = zip::ZipArchive::new(Cursor::new(bytes.into_inner())).unwrap();
    let mut text = String::new();
    std::io::Read::read_to_string(&mut zip.by_name("project.json").unwrap(), &mut text).unwrap();

    for field in [
        "\"Version\"",
        "\"Tracks\"",
        "\"Clips\"",
        "\"Media\"",
        "\"LengthSeconds\"",
    ] {
        assert!(text.contains(field), "{field} missing from {text}");
    }
    assert!(!text.contains("\"tracks\""), "camelCase would not be read");
}

// A title has no sound, and a mixer handed a silent placeholder would show a clip it cannot play. The
// count comes back so a caller can say what stayed behind.
#[test]
fn a_generator_is_left_out_and_counted() {
    let (project, store) = project_with_sound();
    let track = project.timeline.tracks[0].id.clone();
    let mut doc = Document::from_project(project).unwrap();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: TrackId::from(track.as_str().to_string()),
        source: ClipSource::Generator {
            generator: Generator::Solid {
                color: "#ffffff".into(),
            },
        },
        start: Time::from_flicks(10 * SECOND),
        duration: Time::from_flicks(SECOND),
    }))
    .unwrap();

    let mut bytes = Cursor::new(Vec::new());
    let left_out = write_audiola(&mut bytes, doc.project(), &store).unwrap();
    assert_eq!(left_out, 1);

    let read = read_audiola(Cursor::new(bytes.into_inner())).unwrap();
    assert_eq!(read.tracks[0].clips.len(), 1);
}

// A video track whose material has sound is exactly what somebody would take to a mixer; one whose
// material has none has nothing to give it.
#[test]
fn a_silent_medium_is_not_offered_to_a_mixer() {
    let mut doc = Document::new();
    doc.dispatch(Dispatch::new(Command::TrackAdd {
        kind: TrackKind::Video,
        name: "V1".into(),
        index: None,
    }))
    .unwrap();
    let track = doc.project().timeline.tracks[0].id.clone();
    let id = MediaId::from_bytes(b"silent");
    doc.dispatch(Dispatch::new(Command::MediaImport {
        asset: MediaAsset {
            id: id.clone(),
            original_name: "silent.mp4".into(),
            mime: "video/mp4".into(),
            kind: MediaKind::Video,
            size_bytes: 6,
            duration: Some(Time::from_flicks(SECOND)),
            width: Some(640),
            height: Some(360),
            fps: None,
            sample_rate: None,
            channels: None,
        },
    }))
    .unwrap();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: TrackId::from(track.as_str().to_string()),
        source: ClipSource::Media { media: id.clone() },
        start: Time::ZERO,
        duration: Time::from_flicks(SECOND),
    }))
    .unwrap();
    let mut store = MemoryMediaStore::default();
    store.insert(id, b"silent".to_vec());

    let mut bytes = Cursor::new(Vec::new());
    let left_out = write_audiola(&mut bytes, doc.project(), &store).unwrap();
    assert_eq!(left_out, 1);

    let read = read_audiola(Cursor::new(bytes.into_inner())).unwrap();
    assert!(read.tracks.is_empty());
}

// Unity gain has to survive the trip through decibels and back, or every clip would come home a
// fraction louder or quieter than it left.
#[test]
fn a_round_trip_keeps_the_arrangement() {
    let (project, store) = project_with_sound();
    let mut written = Cursor::new(Vec::new());
    write_audiola(&mut written, &project, &store).unwrap();

    let read = read_audiola(Cursor::new(written.into_inner())).unwrap();
    let clip = &read.tracks[0].clips[0];
    assert_eq!(clip.start, Time::from_flicks(3 * SECOND));
    assert_eq!(clip.in_point, Time::ZERO);
    assert!(
        (clip.volume - 1.0).abs() < 1e-4,
        "unity gain survives the decibel trip"
    );
}
