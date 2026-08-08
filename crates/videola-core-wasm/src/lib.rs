pub mod inner;

use std::collections::BTreeMap;

use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

use inner::DocumentHost;
use videola_core::command::Dispatch;
use videola_core::format::SaveOptions;
use videola_core::model::{MediaId, ProjectSettings, Time};
use videola_core::template::{builtin, SlotAnswer, Template};
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

    /// The shipped catalogue, whole: manifest and project together, because the gallery draws its
    /// preview from the timeline the template will actually build. There is nothing to keep back —
    /// none of them carries media.
    #[wasm_bindgen(js_name = builtinTemplates)]
    pub fn builtin_templates() -> std::result::Result<JsValue, JsError> {
        to_js_value(&builtin::templates())
    }

    /// A `.videolat` from disk.
    #[wasm_bindgen(js_name = readTemplate)]
    pub fn read_template(bytes: &[u8]) -> std::result::Result<JsValue, JsError> {
        to_js_value(&inner::read_template(bytes).map_err(to_js)?)
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

    /// This project as a `.videolat`. Every medium it uses becomes a slot and stays behind, which
    /// is why there is no media map here.
    #[wasm_bindgen(js_name = saveAsTemplate)]
    pub fn save_as_template(
        &self,
        options: JsValue,
        id: String,
    ) -> std::result::Result<Vec<u8>, JsError> {
        let parsed: SaveOptions = serde_wasm_bindgen::from_value(options)?;
        self.host.save_as_template(parsed, &id).map_err(to_js)
    }
}

// Not serde_wasm_bindgen: `Vec<u8>` goes through `deserialize_seq` there, which walks a
// Uint8Array element by element and allocates a JsValue for every byte. `to_vec` is one bulk
// copy, which is the difference between a save that takes a moment and one that stalls the tab
// on real video.
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
