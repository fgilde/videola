use std::collections::BTreeMap;
use std::io::Cursor;

use serde::de::value::{Error as DeError, StrDeserializer};
use serde::Deserialize;

use videola_core::command::{Command, Dispatch};
use videola_core::format::{
    reader, writer, LoadWarning, MediaStore, MemoryMediaStore, SaveOptions,
};
use videola_core::model::{
    Clip, ClipId, ClipSource, Effect, EffectId, MediaAsset, MediaId, MediaKind, ParamValue, Project,
    ProjectSettings, Time, MAX_COMPOUND_DEPTH,
};
use videola_core::template::{SlotAnswer, Template};
use videola_core::{CoreError, DispatchResult, Document, Result};

pub struct DocumentHost {
    document: Document,
    media: MemoryMediaStore,
    media_bytes_total: u64,
    warnings: Vec<LoadWarning>,
}

impl Default for DocumentHost {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentHost {
    pub fn new() -> Self {
        Self {
            document: Document::new(),
            media: MemoryMediaStore::default(),
            media_bytes_total: 0,
            warnings: Vec::new(),
        }
    }

    pub fn open(bytes: &[u8]) -> Result<Self> {
        let loaded = reader::read(Cursor::new(bytes))?;
        let mut media = MemoryMediaStore::default();
        let mut media_bytes_total = 0u64;
        for (id, bytes) in loaded.media {
            media_bytes_total += bytes.len() as u64;
            media.insert(id, bytes);
        }
        Ok(Self {
            document: Document::from_project(loaded.project)?,
            media,
            media_bytes_total,
            warnings: loaded.warnings,
        })
    }

    // What an autosaved snapshot comes back through. No media travels with it: every asset is
    // already in the host's own storage under its content hash, which is where the renderer reads
    // it from anyway -- gathering the bytes back into the core would be copying a video to
    // remember where a clip sits.
    pub fn from_project(project: Project) -> Result<Self> {
        Ok(Self {
            document: Document::from_project(project)?,
            media: MemoryMediaStore::default(),
            media_bytes_total: 0,
            warnings: Vec::new(),
        })
    }

    // The baked project walks in through `Document::from_project`, the same door a `.videola`
    // uses, so nothing downstream can tell a template's output from a file that was opened. No
    // media is held: the answers name material the host already put in its own storage, exactly
    // as after an ordinary import.
    pub fn from_template(
        template: &Template,
        answers: &BTreeMap<String, SlotAnswer>,
        settings: Option<&ProjectSettings>,
    ) -> Result<Self> {
        Ok(Self {
            document: Document::from_project(template.bake(answers, settings)?)?,
            media: MemoryMediaStore::default(),
            media_bytes_total: 0,
            warnings: Vec::new(),
        })
    }

    pub fn project(&self) -> &Project {
        self.document.project()
    }

    pub fn warnings(&self) -> &[LoadWarning] {
        &self.warnings
    }

    // A batch, because playback asks at display rate: one crossing of the boundary per frame
    // instead of one per clip per frame. Clips the moment does not touch are simply absent.
    //
    // Compound clips are walked through rather than answered for: they have no medium of their own,
    // and what the renderer needs is where each clip *inside* them reads from. The map stays flat
    // because a clip id is unique across the whole project, nesting included.
    pub fn source_times_at(&self, at: Time) -> BTreeMap<ClipId, Time> {
        let mut found = BTreeMap::new();
        source_times_into(&self.project().timeline, at, 0, &mut found);
        found
    }

    // A batch for the same reason: the preview resolves every parameter of every effect it is
    // about to draw, once per frame. Keyed by effect id, which is unique across the project, so a
    // caller that has the effect needs no clip to look one up. Disabled effects are in as well --
    // the inspector shows their values and the renderer skips them, and deciding that here would
    // give the two consumers different data.
    pub fn effect_params_at(&self, at: Time) -> BTreeMap<EffectId, BTreeMap<String, ParamValue>> {
        let mut found = BTreeMap::new();
        effect_params_into(&self.project().timeline, at, 0, &mut found);
        found
    }

    pub fn history_labels(&self) -> Vec<&'static str> {
        self.document.history().labels()
    }

    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        self.document.dispatch(dispatch)
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        self.document.undo()
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        self.document.redo()
    }

    pub fn rollback(&mut self) -> Result<()> {
        self.document.rollback()
    }

    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> Result<(MediaId, DispatchResult)> {
        // Hashed here, not accepted as a field from JS: the id is what makes MediaImport's
        // validation (canonical med_ + 64 hex) meaningful for *this* path. `dispatch()` still
        // takes a raw `Command::MediaImport` with a caller-supplied id and only checks its shape,
        // not that JS actually holds the bytes it names — that sibling path is not guarded here.
        let id = MediaId::from_bytes(&bytes);
        // Resolved before anything is committed: an unknown kind must fail without charging the
        // media budget or storing bytes, otherwise a rejected import still costs its budget slice
        // forever, and a run of them locks out every legitimate import for the module's lifetime.
        let media_kind = parse_kind(&kind)?;
        let already_stored = self.media.contains(&id);
        if !already_stored {
            let projected = self.media_bytes_total + bytes.len() as u64;
            if projected > reader::MAX_TOTAL_MEDIA_BYTES {
                return Err(CoreError::InvalidArgument(format!(
                    "importing {} bytes would exceed the {} byte media budget",
                    bytes.len(),
                    reader::MAX_TOTAL_MEDIA_BYTES
                )));
            }
            self.media_bytes_total = projected;
        }
        let asset = MediaAsset::new(
            id.clone(),
            original_name,
            mime,
            media_kind,
            bytes.len() as u64,
        );
        self.media.insert(id.clone(), bytes);
        // ponytail: this dispatch only ever succeeds today — `asset` always carries a canonical
        // hashed id and `duration: None`, and `validate_new_asset` cannot reject either. If a
        // future change threads a real duration through from JS, this `?` can fail *after* the
        // budget and the store were already committed, reopening the N-1 leak at the tail instead
        // of the head. Move the budget charge after this dispatch succeeds if that happens.
        let result = self
            .document
            .dispatch(Dispatch::new(Command::MediaImport { asset }))?;
        Ok((id, result))
    }

    pub fn media_bytes(&self, id: &str) -> Option<Vec<u8>> {
        self.media.get(&MediaId::from(id.to_string())).cloned()
    }

    // ponytail: every medium the project references is resident for the length of the write --
    // `MediaStore::read` hands the writer an owned `Vec<u8>`, so moving media into OPFS buys
    // nothing on this path. The way out is a streaming writer that takes a `Blob` (or a reader)
    // per entry and pushes it into the ZIP, at which point JS hands over handles instead of
    // bytes. Until then the reader's own cap on the same data is the loud failure.
    pub fn save(
        &self,
        options: SaveOptions,
        supplied: BTreeMap<MediaId, Vec<u8>>,
    ) -> Result<Vec<u8>> {
        media_within_cap(supplied.values().map(|bytes| bytes.len() as u64).sum())?;
        let store = SaveStore {
            supplied,
            held: &self.media,
        };
        let mut sink = Cursor::new(Vec::new());
        writer::write(&mut sink, self.document.project(), &store, &options)?;
        Ok(sink.into_inner())
    }

    // `Template::from_project` leaves the material behind, so the library it writes is empty and
    // the store never has to hand anything over -- no media parameter, and no way for this call to
    // fail on bytes the host would have had to re-read.
    pub fn save_as_template(&self, options: SaveOptions, id: &str) -> Result<Vec<u8>> {
        let template = Template::from_project(self.document.project(), id)?;
        let mut sink = Cursor::new(Vec::new());
        writer::write_template(&mut sink, &template, &MemoryMediaStore::default(), &options)?;
        Ok(sink.into_inner())
    }
}

pub fn read_template(bytes: &[u8]) -> Result<Template> {
    reader::read_template(Cursor::new(bytes))
}

// The same ceiling the reader enforces when it loads media back out of a `.videola`, applied on
// the way in: a project that would be refused on reopen fails here instead, and it fails with a
// message rather than by exhausting the heap somewhere inside the ZIP writer.
fn media_within_cap(total: u64) -> Result<()> {
    if total > reader::MAX_TOTAL_MEDIA_BYTES {
        return Err(CoreError::InvalidArgument(format!(
            "{total} bytes of media exceed the {} byte limit",
            reader::MAX_TOTAL_MEDIA_BYTES
        )));
    }
    Ok(())
}

// Bytes handed in from JS win over bytes still held here. Since M1 an import writes the file to
// OPFS and the core never sees it, so `held` is empty for anything imported this session - but it
// is full for a project opened from disk, and making JS re-read those would be work for nothing.
// Read-through rather than a merge, so the in-memory entries are not copied a second time.
struct SaveStore<'a> {
    supplied: BTreeMap<MediaId, Vec<u8>>,
    held: &'a MemoryMediaStore,
}

impl MediaStore for SaveStore<'_> {
    fn read(&self, id: &MediaId) -> Result<Vec<u8>> {
        match self.supplied.get(id) {
            Some(bytes) => Ok(bytes.clone()),
            None => self.held.read(id),
        }
    }
}

// The instant a compound clip is showing of its own timeline. `readable_source_time_at` rather
// than the raw mapping, for the same reason a decoder gets the clamped value: the head of a
// reversed clip maps one flick past the end of the range it consumes, and inside a compound that
// is a moment the nested timeline does not have.
//
// The cap is the loader's, so a project that loads is a project that draws -- and a depth this
// walk would not survive is one `Project::normalize` already refused.
fn descend(clip: &Clip, at: Time) -> Option<(&videola_core::model::Timeline, Time)> {
    match &clip.source {
        ClipSource::Compound { timeline } => Some((timeline, clip.readable_source_time_at(at)?)),
        ClipSource::Media { .. } | ClipSource::Generator { .. } => None,
    }
}

fn source_times_into(
    timeline: &videola_core::model::Timeline,
    at: Time,
    depth: usize,
    into: &mut BTreeMap<ClipId, Time>,
) {
    if depth > MAX_COMPOUND_DEPTH {
        return;
    }
    for clip in timeline.tracks.iter().flat_map(|track| &track.clips) {
        match descend(clip, at) {
            Some((nested, inner)) => source_times_into(nested, inner, depth + 1, into),
            None => {
                if let Some(source_at) = clip.readable_source_time_at(at) {
                    into.insert(clip.id.clone(), source_at);
                }
            }
        }
    }
}

// A nested effect's keyframes are written on the timeline it lives on, so it is resolved at the
// instant inside that timeline -- while the compound's own effects are resolved at the outer one.
fn effect_params_into(
    timeline: &videola_core::model::Timeline,
    at: Time,
    depth: usize,
    into: &mut BTreeMap<EffectId, BTreeMap<String, ParamValue>>,
) {
    if depth > MAX_COMPOUND_DEPTH {
        return;
    }
    for clip in timeline.tracks.iter().flat_map(|track| &track.clips) {
        if !clip.contains(at) {
            continue;
        }
        for effect in &clip.effects {
            into.insert(effect.id.clone(), resolved_params(effect, at));
        }
        if let Some((nested, inner)) = descend(clip, at) {
            effect_params_into(nested, inner, depth + 1, into);
        }
    }
}

// Every key the effect can answer for: a keyframed parameter need not have a static entry, and a
// static one need not be keyframed. `param_at` decides which of the two wins -- that rule stays
// here, so the renderer and the inspector cannot end up interpolating differently.
fn resolved_params(effect: &Effect, at: Time) -> BTreeMap<String, ParamValue> {
    effect
        .params
        .keys()
        .chain(effect.keyframes.keys())
        .filter_map(|key| Some((key.clone(), effect.param_at(key, at)?)))
        .collect()
}

fn parse_kind(kind: &str) -> Result<MediaKind> {
    MediaKind::deserialize(StrDeserializer::<DeError>::new(kind))
        .map_err(|_| CoreError::InvalidArgument(format!("unknown media kind: {kind}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    use videola_core::model::{Interp, Keyframe, Timeline, Track, TrackKind};

    // Constructing near the 2 GiB cap directly instead of actually allocating gigabytes of
    // zeroes keeps this test instant while still exercising the exact boundary.
    fn host_with_media_bytes_total(total: u64) -> DocumentHost {
        DocumentHost {
            document: Document::new(),
            media: MemoryMediaStore::default(),
            media_bytes_total: total,
            warnings: Vec::new(),
        }
    }

    // A single test, not two: it must fail if the running total is never actually updated on
    // acceptance (the first import would look free to every later check, and this would let the
    // second import through instead of rejecting it).
    #[test]
    fn importing_media_accumulates_against_the_aggregate_cap() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 10);
        host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            "video".into(),
            vec![0u8; 5],
        )
        .unwrap();

        let error = host
            .import_media(
                "b.bin".into(),
                "application/octet-stream".into(),
                "video".into(),
                vec![0u8; 6],
            )
            .unwrap_err();
        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn a_rejected_kind_does_not_charge_the_media_budget() {
        let mut host = host_with_media_bytes_total(reader::MAX_TOTAL_MEDIA_BYTES - 5);
        host.import_media(
            "a.xyz".into(),
            "application/x".into(),
            "hologram".into(),
            vec![0u8; 5],
        )
        .unwrap_err();

        // If the rejected import above had already charged the budget, this legitimate one
        // would be turned away too.
        let result = host.import_media(
            "a.bin".into(),
            "application/octet-stream".into(),
            "video".into(),
            vec![0u8; 5],
        );
        assert!(result.is_ok());
    }

    #[test]
    fn open_seeds_the_media_byte_counter_from_loaded_media() {
        let mut host = DocumentHost::new();
        host.import_media(
            "a.mp4".into(),
            "video/mp4".into(),
            "video".into(),
            b"12345".to_vec(),
        )
        .unwrap();
        let bytes = host.save(options(), BTreeMap::new()).unwrap();

        let reopened = DocumentHost::open(&bytes).unwrap();

        assert_eq!(reopened.media_bytes_total, 5);
    }

    // Two clips overlapping on separate tracks, so the query has something to include *and*
    // something to leave out at every moment it is asked about.
    fn host_with_overlapping_clips() -> (DocumentHost, Vec<ClipId>) {
        let mut host = DocumentHost::new();
        let mut clips = Vec::new();
        for start in [0.0, 3.0] {
            host.dispatch(Dispatch::new(Command::TrackAdd {
                kind: videola_core::model::TrackKind::Video,
                name: "V".into(),
                index: None,
            }))
            .unwrap();
            let track = host.project().timeline.tracks.last().unwrap().id.clone();
            host.dispatch(Dispatch::new(Command::ClipAdd {
                track: track.clone(),
                source: videola_core::model::ClipSource::Media {
                    media: MediaId::from("med_x".to_string()),
                },
                start: Time::from_seconds(start),
                duration: Time::from_seconds(4.0),
            }))
            .unwrap();
            clips.push(
                host.project().timeline.tracks.last().unwrap().clips[0]
                    .id
                    .clone(),
            );
        }
        (host, clips)
    }

    #[test]
    fn source_times_answer_for_every_clip_the_moment_touches() {
        let (host, clips) = host_with_overlapping_clips();

        let times = host.source_times_at(Time::from_seconds(3.5));

        assert_eq!(
            times,
            BTreeMap::from([
                (clips[0].clone(), Time::from_seconds(3.5)),
                (clips[1].clone(), Time::from_seconds(0.5)),
            ])
        );
    }

    #[test]
    fn source_times_drop_a_clip_at_its_exclusive_end() {
        let (host, clips) = host_with_overlapping_clips();

        let times = host.source_times_at(Time::from_seconds(4.0));

        assert_eq!(times.keys().collect::<Vec<_>>(), vec![&clips[1]]);
        assert!(host.source_times_at(Time::from_seconds(9.0)).is_empty());
    }

    // The claim nesting has to hold up: folding clips into a compound changes where they are
    // written down, never what any instant reads. Answered against the batch the renderer uses,
    // because that is the layer a nested clip would otherwise fall out of.
    #[test]
    fn nesting_leaves_every_source_time_exactly_where_it_was() {
        let (mut host, clips) = host_with_overlapping_clips();
        let mut before = Vec::new();
        let mut at = Time::ZERO;
        while at < Time::from_seconds(9.0) {
            before.push(host.source_times_at(at));
            at = at + Time::from_seconds(1.0 / 30.0);
        }

        host.dispatch(Dispatch::new(Command::ClipNest {
            clips: clips.clone(),
        }))
        .unwrap();

        let mut at = Time::ZERO;
        for expected in before {
            assert_eq!(host.source_times_at(at), expected, "at {}s", at.as_seconds());
            at = at + Time::from_seconds(1.0 / 30.0);
        }
    }

    // The compound itself has no medium, so answering for it would send the decoder after a clip
    // that has nothing to decode.
    #[test]
    fn a_compound_clip_gets_no_source_time_of_its_own() {
        let (mut host, clips) = host_with_overlapping_clips();
        host.dispatch(Dispatch::new(Command::ClipNest { clips }))
            .unwrap();
        let compound = host.project().timeline.tracks[0].clips[0].id.clone();

        assert!(!host
            .source_times_at(Time::from_seconds(1.0))
            .contains_key(&compound));
    }

    #[test]
    fn a_nested_effect_is_resolved_at_the_instant_inside_the_compound() {
        let (mut host, effect) = host_with_effect(vec![ramp(0.0, 0.0), ramp(2.0, 1.0)]);
        let clip = host.project().timeline.tracks[0].clips[0].id.clone();
        host.dispatch(Dispatch::new(Command::ClipNest { clips: vec![clip] }))
            .unwrap();
        let compound = host.project().timeline.tracks[0].clips[0].id.clone();
        host.dispatch(Dispatch::new(Command::ClipMove {
            clip: compound,
            to_track: host.project().timeline.tracks[0].id.clone(),
            start: Time::from_seconds(3.0),
        }))
        .unwrap();

        let params = host.effect_params_at(Time::from_seconds(4.0));

        assert_eq!(params[&effect]["amount"], ParamValue::Float(0.5));
    }

    // A depth the loader refuses is a depth the walk must never be handed, and a walk without the
    // cap is a stack overflow a project file can trigger.
    #[test]
    fn a_nesting_deeper_than_the_cap_is_walked_no_further() {
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(4.0),
        );
        for _ in 0..(MAX_COMPOUND_DEPTH + 2) {
            let mut track = Track::new(TrackKind::Video, "nested".into());
            track.clips.push(clip);
            let mut timeline = Timeline::default();
            timeline.tracks.push(track);
            clip = Clip::new_media(
                MediaId::from(String::new()),
                Time::ZERO,
                Time::from_seconds(4.0),
            );
            clip.source = ClipSource::Compound {
                timeline: Box::new(timeline),
            };
        }
        let mut timeline = Timeline::default();
        timeline
            .tracks
            .push(Track::new(TrackKind::Video, "V".into()));
        timeline.tracks[0].clips.push(clip);

        let mut found = BTreeMap::new();
        source_times_into(&timeline, Time::from_seconds(1.0), 0, &mut found);

        assert!(found.is_empty(), "the walk stops at the cap");
    }

    // One clip carrying one effect whose `amount` is both static and keyframed, so the two rules
    // the batch has to keep apart are present at once.
    fn host_with_effect(keys: Vec<Keyframe>) -> (DocumentHost, EffectId) {
        host_with_params(Some(2.0), keys)
    }

    fn host_with_params(statics: Option<f32>, keys: Vec<Keyframe>) -> (DocumentHost, EffectId) {
        let mut clip = Clip::new_media(
            MediaId::from("med_x".to_string()),
            Time::ZERO,
            Time::from_seconds(4.0),
        );
        let mut effect = Effect::new("brightness");
        if let Some(value) = statics {
            effect
                .params
                .insert("amount".into(), ParamValue::Float(value));
        }
        if !keys.is_empty() {
            effect.keyframes.insert("amount".into(), keys);
        }
        let id = effect.id.clone();
        clip.effects.push(effect);
        let mut project = Project::default();
        project
            .timeline
            .tracks
            .push(Track::new(TrackKind::Video, "V".into()));
        project.timeline.tracks[0].clips.push(clip);
        let host = DocumentHost {
            document: Document::from_project(project).unwrap(),
            media: MemoryMediaStore::default(),
            media_bytes_total: 0,
            warnings: Vec::new(),
        };
        (host, id)
    }

    fn ramp(seconds: f64, value: f32) -> Keyframe {
        Keyframe {
            time: Time::from_seconds(seconds),
            value: ParamValue::Float(value),
            interp: Interp::Linear,
            handle_in: None,
            handle_out: None,
        }
    }

    #[test]
    fn keyframed_parameters_come_out_interpolated_at_the_moment_asked_for() {
        let (host, effect) = host_with_effect(vec![ramp(0.0, 0.0), ramp(2.0, 1.0)]);

        let at_quarter = host.effect_params_at(Time::from_seconds(0.5));
        let at_half = host.effect_params_at(Time::from_seconds(1.0));

        assert_eq!(at_quarter[&effect]["amount"], ParamValue::Float(0.25));
        assert_eq!(at_half[&effect]["amount"], ParamValue::Float(0.5));
    }

    #[test]
    fn a_parameter_without_keyframes_keeps_its_static_value() {
        let (host, effect) = host_with_effect(Vec::new());

        let params = host.effect_params_at(Time::from_seconds(1.0));

        assert_eq!(params[&effect]["amount"], ParamValue::Float(2.0));
    }

    // A parameter that only ever existed as a ramp: nothing in `params` names it, so a batch that
    // walks the static entries alone answers with an empty map for an effect that is animating.
    #[test]
    fn a_parameter_that_is_only_keyframed_is_still_answered_for() {
        let (host, effect) = host_with_params(None, vec![ramp(0.0, 0.0), ramp(2.0, 1.0)]);

        let params = host.effect_params_at(Time::from_seconds(1.0));

        assert_eq!(params[&effect]["amount"], ParamValue::Float(0.5));
    }

    // The crossing the renderer walks every frame: a keyframe ramp that reaches past the clip.
    // Outside the clip the effect is simply not in the batch, however the ramp would evaluate.
    #[test]
    fn effects_of_a_clip_the_moment_does_not_touch_are_absent() {
        let (host, effect) = host_with_effect(vec![ramp(0.0, 0.0), ramp(8.0, 1.0)]);

        assert!(host
            .effect_params_at(Time::from_seconds(3.999))
            .contains_key(&effect));
        assert!(host.effect_params_at(Time::from_seconds(4.0)).is_empty());
    }

    fn options() -> SaveOptions {
        SaveOptions {
            app_version: "0.0.0".into(),
            created: "c".into(),
            modified: "m".into(),
            locale: "de".into(),
        }
    }

    // The round trip M1 actually walks: the bytes went to OPFS, so the core never saw them and
    // `media.import` only ever carried metadata. Without the supplied map the writer fails on
    // `media.read` and a milestone that can import cannot save.
    #[test]
    fn save_writes_media_the_core_never_held() {
        let mut host = DocumentHost::new();
        let bytes = b"bytes that only OPFS has".to_vec();
        let id = MediaId::from_bytes(&bytes);
        let asset = MediaAsset::new(
            id.clone(),
            "a.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            bytes.len() as u64,
        );
        host.dispatch(Dispatch::new(Command::MediaImport { asset }))
            .unwrap();

        let supplied = BTreeMap::from([(id.clone(), bytes.clone())]);
        let archive = host.save(options(), supplied).unwrap();

        let reopened = DocumentHost::open(&archive).unwrap();
        assert_eq!(reopened.media_bytes(id.as_str()), Some(bytes));
        assert_eq!(reopened.project().library.len(), 1);
    }

    // Tested through the bound rather than through `save`, because reaching it for real means
    // allocating two gibibytes.
    #[test]
    fn media_beyond_the_reader_cap_is_refused() {
        assert!(media_within_cap(reader::MAX_TOTAL_MEDIA_BYTES).is_ok());
        assert!(matches!(
            media_within_cap(reader::MAX_TOTAL_MEDIA_BYTES + 1),
            Err(CoreError::InvalidArgument(_))
        ));
    }
}
