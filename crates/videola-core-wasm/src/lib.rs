pub mod inner;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

use inner::{DocumentHost, SaveRequest};
use videola_core::command::Dispatch;
use videola_core::model::MediaId;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsSaveOptions {
    app_version: String,
    created: String,
    modified: String,
    locale: String,
    #[serde(default)]
    slim: bool,
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

    pub fn state(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(self.host.project()).map_err(JsError::from)
    }

    pub fn warnings(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(self.host.warnings()).map_err(JsError::from)
    }

    #[wasm_bindgen(js_name = historyLabels)]
    pub fn history_labels(&self) -> std::result::Result<JsValue, JsError> {
        serde_wasm_bindgen::to_value(&self.host.history_labels()).map_err(JsError::from)
    }

    pub fn dispatch(&mut self, dispatch: JsValue) -> std::result::Result<JsValue, JsError> {
        let parsed: Dispatch = serde_wasm_bindgen::from_value(dispatch)?;
        let result = self.host.dispatch(parsed).map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
    }

    pub fn undo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.undo().map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
    }

    pub fn redo(&mut self) -> std::result::Result<JsValue, JsError> {
        let result = self.host.redo().map_err(to_js)?;
        serde_wasm_bindgen::to_value(&result).map_err(JsError::from)
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
        self.host.media_bytes(&MediaId::from(id))
    }

    pub fn save(&self, options: JsValue) -> std::result::Result<Vec<u8>, JsError> {
        let parsed: JsSaveOptions = serde_wasm_bindgen::from_value(options)?;
        self.host
            .save(SaveRequest {
                app_version: parsed.app_version,
                created: parsed.created,
                modified: parsed.modified,
                locale: parsed.locale,
                slim: parsed.slim,
            })
            .map_err(to_js)
    }
}

impl Default for WasmDocument {
    fn default() -> Self {
        Self::new()
    }
}

fn to_js(error: videola_core::CoreError) -> JsError {
    JsError::new(&error.to_string())
}
