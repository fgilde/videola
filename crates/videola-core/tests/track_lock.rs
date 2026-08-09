#![allow(clippy::unwrap_used, clippy::expect_used)]

use videola_core::command::{Command, Dispatch, EffectTarget, TrimEdge};
use videola_core::model::{ClipId, ClipSource, Generator, MediaId, Time, TrackId, TrackKind};
use videola_core::{CoreError, Document};

// A lock is a promise about a track: nothing on it moves until it is unlocked again. The gate that
// keeps that promise sits in front of the whole command dispatch, so what is asked here is the
// promise itself -- one command per shape a lock has to cover -- and not the twenty handlers.

const SECOND: i64 = 705_600_000;

fn seeded() -> (Document, TrackId, TrackId, ClipId) {
    let mut doc = Document::new();
    for name in ["V1", "V2"] {
        doc.dispatch(Dispatch::new(Command::TrackAdd {
            kind: TrackKind::Video,
            name: name.to_string(),
            index: None,
        }))
        .unwrap();
    }
    let tracks: Vec<TrackId> = doc
        .project()
        .timeline
        .tracks
        .iter()
        .map(|track| track.id.clone())
        .collect();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: tracks[0].clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_a".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_flicks(2 * SECOND),
    }))
    .unwrap();
    let clip = doc.project().timeline.tracks[0].clips[0].id.clone();
    (doc, tracks[0].clone(), tracks[1].clone(), clip)
}

fn lock(doc: &mut Document, track: &TrackId) {
    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track: track.clone(),
        muted: None,
        solo: None,
        locked: Some(true),
        hidden: None,
    }))
    .unwrap();
}

fn refused(result: Result<(), CoreError>, track: &TrackId) {
    match result {
        Err(CoreError::TrackLocked(named)) => assert_eq!(&named, track),
        Err(other) => panic!("refused for the wrong reason: {other}"),
        Ok(()) => panic!("a locked track took the edit"),
    }
}

#[test]
fn a_locked_track_refuses_every_edit_to_the_clips_on_it() {
    let (mut doc, locked_track, other, clip) = seeded();
    lock(&mut doc, &locked_track);

    for command in [
        Command::ClipRemove { clip: clip.clone() },
        Command::ClipMove {
            clip: clip.clone(),
            to_track: other.clone(),
            start: Time::from_flicks(SECOND),
        },
        Command::ClipTrim {
            clip: clip.clone(),
            edge: TrimEdge::End,
            delta: Time::from_flicks(-SECOND / 2),
        },
        Command::ClipSplit {
            clip: clip.clone(),
            at: Time::from_flicks(SECOND),
        },
        Command::ClipRippleDelete { clip: clip.clone() },
        Command::ClipSlip {
            clip: clip.clone(),
            delta: Time::from_flicks(SECOND / 4),
        },
        Command::ClipSetVolume {
            clip: clip.clone(),
            volume: 0.5,
        },
        Command::ClipSetGenerator {
            clip: clip.clone(),
            generator: Generator::Solid {
                color: "#101010".into(),
            },
        },
        Command::EffectAdd {
            target: EffectTarget::Clip { clip: clip.clone() },
            effect_type: "brightness".into(),
        },
        Command::ClipAdd {
            track: locked_track.clone(),
            source: ClipSource::Media {
                media: MediaId::from("med_b".to_string()),
            },
            start: Time::from_flicks(4 * SECOND),
            duration: Time::from_flicks(SECOND),
        },
        Command::TrackRemove {
            track: locked_track.clone(),
        },
    ] {
        let named = format!("{command:?}");
        refused(
            doc.dispatch(Dispatch::new(command)).map(|_| ()),
            &locked_track,
        );
        assert_eq!(
            doc.project().timeline.tracks[0].clips.len(),
            1,
            "the timeline changed under a refused {named}"
        );
    }
}

// The other half of the promise. A lock that also silenced the fader would leave a locked track
// unmixable, and a lock that covered its own flags could never be undone.
#[test]
fn a_locked_track_still_mixes_and_still_unlocks() {
    let (mut doc, locked_track, _, _) = seeded();
    lock(&mut doc, &locked_track);

    doc.dispatch(Dispatch::new(Command::TrackSetVolume {
        track: locked_track.clone(),
        volume: 0.25,
    }))
    .expect("a locked track is still mixed");
    doc.dispatch(Dispatch::new(Command::TrackRename {
        track: locked_track.clone(),
        name: "Titles".into(),
    }))
    .expect("a locked track is still named");
    doc.dispatch(Dispatch::new(Command::TrackSetFlags {
        track: locked_track.clone(),
        muted: None,
        solo: None,
        locked: Some(false),
        hidden: None,
    }))
    .expect("a lock has to be undoable from the outside");
    assert!(!doc.project().timeline.tracks[0].locked);
}

#[test]
fn a_lock_elsewhere_does_not_reach_an_unlocked_track() {
    let (mut doc, first, second, _) = seeded();
    lock(&mut doc, &first);
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: second,
        source: ClipSource::Media {
            media: MediaId::from("med_b".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_flicks(SECOND),
    }))
    .expect("the track next to a locked one is an ordinary track");
    assert_eq!(doc.project().timeline.tracks[1].clips.len(), 1);
}

// The other direction of a move. A lock that only asked where a clip comes from would let a clip
// be dropped onto a locked track, which is material appearing on a track that promised to hold
// still.
#[test]
fn a_clip_cannot_be_moved_onto_a_locked_track_either() {
    let (mut doc, first, second, _) = seeded();
    doc.dispatch(Dispatch::new(Command::ClipAdd {
        track: second.clone(),
        source: ClipSource::Media {
            media: MediaId::from("med_b".to_string()),
        },
        start: Time::ZERO,
        duration: Time::from_flicks(SECOND),
    }))
    .unwrap();
    let loose = doc.project().timeline.tracks[1].clips[0].id.clone();
    lock(&mut doc, &first);

    refused(
        doc.dispatch(Dispatch::new(Command::ClipMove {
            clip: loose,
            to_track: first.clone(),
            start: Time::ZERO,
        }))
        .map(|_| ()),
        &first,
    );
    assert_eq!(doc.project().timeline.tracks[0].clips.len(), 1);
    assert_eq!(doc.project().timeline.tracks[1].clips.len(), 1);
}

// A track's own chain is on the track, so it is under the same lock as the clips: an equaliser
// added to a locked track is a change to what that track does.
#[test]
fn a_locked_tracks_own_effect_chain_is_locked_with_it() {
    let (mut doc, first, _, _) = seeded();
    lock(&mut doc, &first);
    refused(
        doc.dispatch(Dispatch::new(Command::EffectAdd {
            target: EffectTarget::Track {
                track: first.clone(),
            },
            effect_type: "brightness".into(),
        }))
        .map(|_| ()),
        &first,
    );
    assert!(doc.project().timeline.tracks[0].effects.is_empty());
}

// An insert opens the gap on every track, because a picture edit that moved the sound out from
// under it is the one thing it must never do. Skipping the locked track would do exactly that, so
// a single locked track anywhere refuses the whole edit -- and the timeline is left as it was.
#[test]
fn an_insert_refuses_while_any_track_is_locked() {
    let (mut doc, first, second, _) = seeded();
    lock(&mut doc, &first);
    let before = doc.project().timeline.tracks[0].clips[0].start;
    refused(
        doc.dispatch(Dispatch::new(Command::ClipInsert {
            track: second,
            source: ClipSource::Media {
                media: MediaId::from("med_b".to_string()),
            },
            start: Time::ZERO,
            duration: Time::from_flicks(SECOND),
            in_point: Time::ZERO,
        }))
        .map(|_| ()),
        &first,
    );
    assert_eq!(doc.project().timeline.tracks[0].clips[0].start, before);
}

// A refused command must not reach the history either: an undo step that undoes nothing is worse
// than no step at all, because the next undo then skips a real edit.
#[test]
fn a_refused_edit_leaves_no_step_to_undo() {
    let (mut doc, locked_track, _, clip) = seeded();
    lock(&mut doc, &locked_track);
    let steps = doc.history().labels().len();
    let _ = doc.dispatch(Dispatch::new(Command::ClipRemove { clip }));
    assert_eq!(doc.history().labels().len(), steps);
}
