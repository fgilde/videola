pub mod inner;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use inner::DocumentHost;
use videola_core::command::Dispatch;
use videola_core::format::SaveOptions;

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

    pub fn state(&self) -> std::result::Result<JsValue, JsError> {
        to_js_value(self.host.project())
    }

    pub fn warnings(&self) -> std::result::Result<JsValue, JsError> {
        to_js_value(self.host.warnings())
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

    #[wasm_bindgen(js_name = importMedia)]
    pub fn import_media(
        &mut self,
        original_name: String,
        mime: String,
        kind: String,
        bytes: Vec<u8>,
    ) -> std::result::Result<String, JsError> {
        Ok(self
            .host
            .import_media(original_name, mime, kind, bytes)
            .map_err(to_js)?
            .to_string())
    }

    #[wasm_bindgen(js_name = mediaBytes)]
    pub fn media_bytes(&self, id: String) -> Option<Vec<u8>> {
        self.host.media_bytes(&id)
    }

    pub fn save(&self, options: JsValue) -> std::result::Result<Vec<u8>, JsError> {
        let parsed: SaveOptions = serde_wasm_bindgen::from_value(options)?;
        self.host.save(parsed).map_err(to_js)
    }
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
