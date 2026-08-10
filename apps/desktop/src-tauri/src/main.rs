// The shell owns no editor logic: everything lives in videola-core behind the
// WASM boundary, so desktop and browser cannot drift apart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

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

    // The safety net under the splash screen. The editor hands the window over
    // itself, the moment its core is up -- but a build whose WASM never loads
    // would otherwise be a process with no window at all and no way to see why.
    // After ten seconds the window is shown regardless, so whatever went wrong is
    // on screen instead of behind a mark and a moving bar.
    #[cfg(desktop)]
    let builder = builder.setup(|app| {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.show();
            }
            if let Some(splash) = handle.get_webview_window("splashscreen") {
                let _ = splash.close();
            }
        });
        Ok(())
    });

    // If the window never comes up there is no state to rescue and nothing the
    // process could usefully do instead, so a panic is the honest reaction.
    #[allow(clippy::expect_used)]
    builder
        .run(tauri::generate_context!())
        .expect("tauri failed to start");
}
