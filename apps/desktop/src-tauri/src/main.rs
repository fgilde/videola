// The shell owns no editor logic: everything lives in videola-core behind the
// WASM boundary, so desktop and browser cannot drift apart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let builder = tauri::Builder::default();

    // The updater exists on the three desktop systems only; Android and iOS
    // update through their stores, and the crate has no build for them.
    //
    // Registered from the configuration rather than unconditionally: the plugin
    // deserializes `plugins.updater` at startup and a missing block is a hard
    // error, not a default -- an app built without a signing key would refuse to
    // open its window. The release workflow writes that block only when both
    // halves of the key exist, so on every other build there is nothing to
    // register and nothing to fail.
    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        if app.config().plugins.0.contains_key("updater") {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
        }
        Ok(())
    });

    // If the window never comes up there is no state to rescue and nothing the
    // process could usefully do instead, so a panic is the honest reaction.
    #[allow(clippy::expect_used)]
    builder
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
