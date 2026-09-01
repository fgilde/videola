pub mod inner;

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use inner::DocumentHost;
use videola_core::command::Dispatch;
use videola_core::format::SaveOptions;
use videola_core::model::{ClipId, MediaId, ProjectSettings, Time};
use videola_core::template::{builtin, Frame, SlotAnswer, Template};
use videola_core::DispatchResult;

// A bare id string would drop the undo/redo flags the import itself just changed, leaving the
// facade unable to tell the UI a new history entry landed and the redo stack was cleared.
// This type can't move to core (it only exists at the JS boundary), so ts-rs never sees it —
// keep in sync with the TypeScript facade's `ImportMediaResult`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportOutcome {
    id: String,
    result: DispatchResult,
}

#[wasm_bindgen]
pub struct WasmDocument {
    host: DocumentHost,
}

#[wasm_bindgen]
impl WasmDocument {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmDocument {
        WasmDocument {
            host: DocumentHost::new(),
        }
    }

    pub fn open(bytes: &[u8]) -> std::result::Result<WasmDocument, JsError> {
        Ok(WasmDocument {
            host: DocumentHost::open(bytes).map_err(to_js)?,
        })
    }

    /// A project state on its own, without the media a `.videola` carries. That is what makes an
    /// autosave affordable: the assets already sit in the host's storage under their content hash,
    /// so a snapshot is the timeline and nothing else.
    #[wasm_bindgen(js_name = fromProject)]
    pub fn from_project(project: JsValue) -> std::result::Result<WasmDocument, JsError> {
        let project: videola_core::model::Project = serde_wasm_bindgen::from_value(project)?;
        Ok(WasmDocument {
            host: DocumentHost::from_project(project).map_err(to_js)?,
        })
    }

    /// The shipped catalogue, whole: manifest and project together, because the gallery draws its
    /// preview from the timeline the template will actually build. There is nothing to keep back —
    /// none of them carries media.
    #[wasm_bindgen(js_name = builtinTemplates)]
    pub fn builtin_templates() -> std::result::Result<JsValue, JsError> {
        to_js_value(&builtin::templates())
    }

    /// The project a gallery card is rendered from: the template baked against a stand-in for every
    /// piece of material, each one a plain gradient sitting exactly where the real answer will
    /// land. It goes through the same `bake` a real answer does, so a card that is wrong means a
    /// template that is wrong — which is the only kind of preview worth showing.
    ///
    /// A whole `Project` comes back rather than a picture: the compositor lives in JavaScript, and
    /// returning pixels would mean writing a second one here.
    #[wasm_bindgen(js_name = templatePreview)]
    pub fn template_preview(
        template: JsValue,
        frame: JsValue,
    ) -> std::result::Result<JsValue, JsError> {
        // Untrusted on the way back in, exactly like `fromTemplate`: nothing stops the host from
        // editing a template between being handed one and asking for its picture.
        let mut template: Template = serde_wasm_bindgen::from_value(template)?;
        template.normalize().map_err(to_js)?;
        let frame: Option<Frame> = serde_wasm_bindgen::from_value(frame)?;
        to_js_value(&template.preview(frame).map_err(to_js)?)
    }

    /// A `.videolat` from disk.
    #[wasm_bindgen(js_name = readTemplate)]
    pub fn read_template(bytes: &[u8]) -> std::result::Result<JsValue, JsError> {
        let (template, media) = inner::read_template(bytes).map_err(to_js)?;
        let found = js_sys::Object::new();
        let set = |key: &str, value: &JsValue| -> std::result::Result<(), JsError> {
            js_sys::Reflect::set(&found, &key.into(), value)
                .map(|_| ())
                .map_err(|_| JsError::new("could not build the result object"))
        };
        set("template", &to_js_value(&template)?)?;
        // A Map rather than an object: the values are Uint8Arrays, and serde would walk every byte.
        let carried = js_sys::Map::new();
        for (id, bytes) in media {
            carried.set(
                &id.as_str().into(),
                &js_sys::Uint8Array::from(bytes.as_slice()).into(),
            );
        }
        set("media", &carried.into())?;
        Ok(found.into())
    }

    /// Template plus answers becomes a document like any other: the same undo stack, the same
    /// commands, no mode to leave. `settings` is `null` to keep the template's own frame.
    #[wasm_bindgen(js_name = fromTemplate)]
    pub fn from_template(
        template: JsValue,
        answers: JsValue,
        settings: JsValue,
    ) -> std::result::Result<WasmDocument, JsError> {
        // Whatever came back across the boundary is untrusted, even if this module handed it out a
        // moment ago -- nothing stops the host from editing it in between.
        let mut template: Template = serde_wasm_bindgen::from_value(template)?;
        template.normalize().map_err(to_js)?;
        let answers: BTreeMap<String, SlotAnswer> = serde_wasm_bindgen::from_value(answers)?;
        let settings: Option<ProjectSettings> = serde_wasm_bindgen::from_value(settings)?;
        Ok(WasmDocument {
            host: DocumentHost::from_template(&template, &answers, settings.as_ref())
                .map_err(to_js)?,
        })
    }

    pub fn state(&self) -> std::result::Result<JsValue, JsError> {
        to_js_value(self.host.project())
    }

    /// The sounding part of this project as an `.audiola`, so it opens in Audiola.
    ///
    /// Returns the archive and how many clips stayed behind — a title has no sound and a Videola
    /// compressor is not an Audiola one, so what does not travel is counted rather than written as
    /// something the other tool would misread.
    #[wasm_bindgen(js_name = toAudiola)]
    pub fn to_audiola(&self, media: js_sys::Map) -> std::result::Result<AudiolaExport, JsError> {
        let supplied = supplied_media(&media)?;
        let mut store = videola_core::format::MemoryMediaStore::default();
        for (id, bytes) in supplied {
            store.insert(id, bytes);
        }
        let mut sink = std::io::Cursor::new(Vec::new());
        let left_out = videola_core::audiola::write_audiola(&mut sink, self.host.project(), &store)
            .map_err(to_js)?;
        Ok(AudiolaExport {
            bytes: sink.into_inner(),
            left_out,
        })
    }

    /// The cut as another editor reads it: a CMX3600 edit decision list.
    ///
    /// Here rather than in TypeScript for the reason the reader and the writer are here: a timecode
    /// is integer arithmetic over a rational rate, and a second implementation is a second answer to
    /// the same question.
    #[wasm_bindgen(js_name = toEdl)]
    pub fn to_edl(&self) -> String {
        videola_core::interchange::to_edl(self.host.project())
    }

    /// The same cut as FCPXML, which Resolve, Premiere and Final Cut all read -- and which, unlike an
    /// EDL, carries every track rather than one of each.
    #[wasm_bindgen(js_name = toFcpxml)]
    pub fn to_fcpxml(&self) -> String {
        videola_core::interchange::to_fcpxml(self.host.project())
    }

    /// The same cut as Final Cut Pro 7 XML, which is the file Premiere Pro imports as a sequence.
    /// A different format from FCPXML despite the name, and the wider of the two doors.
    #[wasm_bindgen(js_name = toXmeml)]
    pub fn to_xmeml(&self) -> String {
        videola_core::interchange::to_xmeml(self.host.project())
    }

    pub fn warnings(&self) -> std::result::Result<JsValue, JsError> {
        to_js_value(self.host.warnings())
    }

    // Not `to_js_value`: this one stays a JS `Map`, because the caller only ever looks clips up
    // by id and never serialises it, and a Map keyed by an opaque id beats an object literal.
    #[wasm_bindgen(js_name = sourceTimesAt)]
    pub fn source_times_at(&self, at: JsValue) -> std::result::Result<JsValue, JsError> {
        let at: Time = serde_wasm_bindgen::from_value(at)?;
        Ok(serde_wasm_bindgen::to_value(
            &self.host.source_times_at(at),
        )?)
    }

    // A `Map` of `Map`s, for the same reason -- and `to_js_value` would be the wrong tool twice
    // over here, because `serialize_maps_as_objects` would flatten both levels.
    #[wasm_bindgen(js_name = effectParamsAt)]
    pub fn effect_params_at(&self, at: JsValue) -> std::result::Result<JsValue, JsError> {
        let at: Time = serde_wasm_bindgen::from_value(at)?;
        Ok(serde_wasm_bindgen::to_value(
            &self.host.effect_params_at(at),
        )?)
    }

    // A `Map` keyed by clip id, like `sourceTimesAt`; the transforms themselves are structs and
    // cross as plain objects either way.
    #[wasm_bindgen(js_name = transformsAt)]
    pub fn transforms_at(&self, at: JsValue) -> std::result::Result<JsValue, JsError> {
        let at: Time = serde_wasm_bindgen::from_value(at)?;
        Ok(serde_wasm_bindgen::to_value(&self.host.transforms_at(at))?)
    }

    /// The shape of one segment: `count` samples from the left key to the right one, each the
    /// fraction of the way the track has travelled at that point. This is what a curve editor plots
    /// and nothing else.
    ///
    /// It takes no document because two keyframes decide the whole answer. It exists at all --
    /// rather than four lines of easing written again in TypeScript -- because a drawn curve that
    /// disagreed with the animated one is the single fault a curve editor cannot have, and
    /// `segment_shape` is the very function `interpolate` applies to move the picture.
    #[wasm_bindgen(js_name = curveShape)]
    pub fn curve_shape(
        left: JsValue,
        right: JsValue,
        count: usize,
    ) -> std::result::Result<Vec<f32>, JsError> {
        let left: videola_core::model::Keyframe = serde_wasm_bindgen::from_value(left)?;
        let right: videola_core::model::Keyframe = serde_wasm_bindgen::from_value(right)?;
        let Some(last) = count.checked_sub(1).filter(|last| *last > 0) else {
            return Ok(Vec::new());
        };
        Ok((0..count)
            .map(|step| {
                videola_core::model::segment_shape(&left, &right, step as f32 / last as f32)
            })
            .collect())
    }

    #[wasm_bindgen(js_name = historyLabels)]
    pub fn history_labels(&self) -> std::result::Result<JsValue, JsError> {
        to_js_value(&self.host.history_labels())
    }

    pub fn dispatch(&mut self, dispatch: JsValue) -> std::result::Result<JsValue, JsError> {
        let parsed: Dispatch = serde_wasm_bindgen::from_value(dispatch)?;
        let result = self.host.dispatch(parsed).map_err(to_js)?;
        to_js_value(&result)
    }

    pub fn undo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.undo().map_err(to_js)?;
        to_js_value(&result)
    }

    pub fn redo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.redo().map_err(to_js)?;
        to_js_value(&result)
    }

    pub fn rollback(&mut self) -> std::result::Result<(), JsError> {
        self.host.rollback().map_err(to_js)
    }

    #[wasm_bindgen(js_name = importMedia)]
    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> std::result::Result<JsValue, JsError> {
        let (id, result) = self
            .host
            .import_media(original_name, mime, kind, bytes)
            .map_err(to_js)?;
        to_js_value(&ImportOutcome {
            id: id.to_string(),
            result,
        })
    }

    #[wasm_bindgen(js_name = mediaBytes)]
    pub fn media_bytes(&self, id: String) -> Option<Vec<u8>> {
        self.host.media_bytes(&id)
    }

    pub fn save(
        &self,
        options: JsValue,
        media: js_sys::Map,
    ) -> std::result::Result<Vec<u8>, JsError> {
        let parsed: SaveOptions = serde_wasm_bindgen::from_value(options)?;
        self.host
            .save(parsed, supplied_media(&media)?)
            .map_err(to_js)
    }

    /// This project as a `.videolat`. Marked media become slots and their material stays with the
    /// author; everything else travels with the template, which is why this takes a media map.
    ///
    /// `marked` is the editor's selection: the clips the author wants to turn into questions. Null
    /// means "decide for me". Media clips are questions either way -- the footage does not travel,
    /// so a shot that was not a question would draw nothing.
    #[wasm_bindgen(js_name = saveAsTemplate)]
    pub fn save_as_template(
        &self,
        options: JsValue,
        id: String,
        marked: JsValue,
        media: js_sys::Map,
    ) -> std::result::Result<Vec<u8>, JsError> {
        let marked: Option<BTreeSet<ClipId>> = serde_wasm_bindgen::from_value(marked)?;
        let parsed: SaveOptions = serde_wasm_bindgen::from_value(options)?;
        let supplied = supplied_media(&media)?;
        self.host
            .save_as_template(parsed, &id, marked.as_ref(), supplied)
            .map_err(to_js)
    }
}

// Not serde_wasm_bindgen: `Vec<u8>` goes through `deserialize_seq` there, which walks a
// Uint8Array element by element and allocates a JsValue for every byte. `to_vec` is one bulk
// copy, which is the difference between a save that takes a moment and one that stalls the tab
// on real video.
/// An `.audiola` and the count of what could not go into it.
#[wasm_bindgen]
pub struct AudiolaExport {
    bytes: Vec<u8>,
    left_out: usize,
}

#[wasm_bindgen]
impl AudiolaExport {
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }

    /// How many clips have no sound to hand a mixer: generators, compounds, and silent material.
    #[wasm_bindgen(getter, js_name = leftOut)]
    pub fn left_out(&self) -> usize {
        self.left_out
    }
}

/// One Audiola track, in the shape the editor turns into commands. Flicks, because that is what every
/// time on this side of the boundary is.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DescribedTrack {
    name: String,
    color_hex: String,
    volume: f32,
    pan: f32,
    muted: bool,
    solo: bool,
    clips: Vec<DescribedClip>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DescribedClip {
    media: String,
    name: String,
    start: i64,
    duration: i64,
    in_point: i64,
    volume: f32,
    fade_in: i64,
    fade_out: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Described {
    tracks: Vec<DescribedTrack>,
    notes: Vec<String>,
}

/// What an `.audiola` holds: tracks to add, and the bytes behind them.
///
/// Deliberately not a `Project`. Opening one brings a mix into an edit that already exists, so the
/// editor adds a track and its clips through the same commands a person would -- one undo step, and
/// no second way for material to reach a timeline.
#[wasm_bindgen]
pub struct AudiolaImport {
    described: JsValue,
    media: js_sys::Map,
}

#[wasm_bindgen]
impl AudiolaImport {
    /// The tracks and the notes about what stayed in Audiola.
    #[wasm_bindgen(getter)]
    pub fn described(&self) -> JsValue {
        self.described.clone()
    }

    /// The media, keyed by content hash -- the same shape `save` takes, because whatever puts them in
    /// the host's storage wants bytes and not numbers in an array.
    #[wasm_bindgen(getter)]
    pub fn media(&self) -> js_sys::Map {
        self.media.clone()
    }
}

#[wasm_bindgen(js_name = readAudiola)]
pub fn read_audiola(bytes: &[u8]) -> std::result::Result<AudiolaImport, JsError> {
    let read = videola_core::audiola::read_audiola(std::io::Cursor::new(bytes)).map_err(to_js)?;
    let described = Described {
        tracks: read
            .tracks
            .iter()
            .map(|track| DescribedTrack {
                name: track.name.clone(),
                color_hex: track.color_hex.clone(),
                volume: track.volume,
                pan: track.pan,
                muted: track.muted,
                solo: track.solo,
                clips: track
                    .clips
                    .iter()
                    .map(|clip| DescribedClip {
                        media: clip.media.as_str().to_string(),
                        name: clip.name.clone(),
                        start: clip.start.as_flicks(),
                        duration: clip.duration.as_flicks(),
                        in_point: clip.in_point.as_flicks(),
                        volume: clip.volume,
                        fade_in: clip.fade_in.as_flicks(),
                        fade_out: clip.fade_out.as_flicks(),
                    })
                    .collect(),
            })
            .collect(),
        notes: read.notes.clone(),
    };
    let media = js_sys::Map::new();
    for (id, bytes) in read.media {
        media.set(
            &JsValue::from_str(id.as_str()),
            &js_sys::Uint8Array::from(bytes.as_slice()).into(),
        );
    }
    Ok(AudiolaImport {
        described: serde_wasm_bindgen::to_value(&described)?,
        media,
    })
}

fn supplied_media(media: &js_sys::Map) -> std::result::Result<BTreeMap<MediaId, Vec<u8>>, JsError> {
    let mut supplied = BTreeMap::new();
    for key in media.keys() {
        let key = key.map_err(|_| JsError::new("media map is not iterable"))?;
        let id = key
            .as_string()
            .ok_or_else(|| JsError::new("media id must be a string"))?;
        let bytes = media
            .get(&key)
            .dyn_into::<js_sys::Uint8Array>()
            .map_err(|_| JsError::new("media bytes must be a Uint8Array"))?;
        supplied.insert(MediaId::from(id), bytes.to_vec());
    }
    Ok(supplied)
}

impl Default for WasmDocument {
    fn default() -> Self {
        Self::new()
    }
}

fn to_js_value<T: Serialize + ?Sized>(value: &T) -> std::result::Result<JsValue, JsError> {
    // Plain to_value() serialises every Rust map as a JS Map, not an object literal — but
    // Project.keyframes/params and DispatchResult.patch are all maps the frontend needs as
    // plain objects (ts-rs's generated types assume it, JSON.stringify silently empties a Map).
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
    value.serialize(&serializer).map_err(JsError::from)
}

fn to_js(error: videola_core::CoreError) -> JsError {
    JsError::new(&error.to_string())
}
