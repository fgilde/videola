// The shell owns no editor logic: everything lives in videola-core behind the
// WASM boundary, so desktop and browser cannot drift apart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // If the window never comes up there is no state to rescue and nothing the
    // process could usefully do instead, so a panic is the honest reaction.
    #[allow(clippy::expect_used)]
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
