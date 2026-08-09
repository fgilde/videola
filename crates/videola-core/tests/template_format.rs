use std::collections::BTreeMap;
use std::io::Cursor;

use videola_core::format::{reader, writer, MemoryMediaStore, SaveOptions};
use videola_core::model::{
    Clip, ClipId, ClipSource, MediaAsset, MediaId, MediaKind, Project, Time, Track, TrackKind,
};
use videola_core::template::{builtin, SlotAnswer, SlotKind, Template};
use videola_core::CoreError;

fn save_options() -> SaveOptions {
    SaveOptions {
        app_version: "0.1.0".into(),
        created: "2026-08-08T10:00:00Z".into(),
        modified: "2026-08-08T10:00:00Z".into(),
        locale: "de".into(),
    }
}

#[allow(clippy::unwrap_used)]
fn asset(name: &str) -> MediaAsset {
    let mut asset = MediaAsset::new(
        MediaId::from(format!("med_{name}")),
        format!("{name}.mp4"),
        "video/mp4".into(),
        MediaKind::Video,
        1_000,
    );
    asset.duration = Some(Time::from_seconds(20.0));
    asset.width = Some(1280);
    asset.height = Some(720);
    asset
}

fn answers_for(template: &Template) -> BTreeMap<String, SlotAnswer> {
    template
        .manifest
        .slots
        .iter()
        .map(|slot| {
            let answer = match slot.kind {
                SlotKind::Media => SlotAnswer::Media {
                    asset: asset(&slot.id),
                },
                SlotKind::Text => SlotAnswer::Text {
                    text: "Ein Titel".into(),
                },
                SlotKind::Color => SlotAnswer::Color {
                    color: "#1188ff".into(),
                },
            };
            (slot.id.clone(), answer)
        })
        .collect()
}

#[allow(clippy::unwrap_used)]
fn to_videolat(template: &Template) -> Vec<u8> {
    let mut sink = Cursor::new(Vec::new());
    writer::write_template(
        &mut sink,
        template,
        &MemoryMediaStore::default(),
        &save_options(),
    )
    .unwrap();
    sink.into_inner()
}

#[test]
fn a_shipped_template_survives_the_container_it_will_be_shared_in() {
    // The one with the most in it: four media slots, a masked band, two text generators and a
    // keyframed effect. If anything in the container flattens a nested map or drops a field, it
    // shows up here rather than in whichever template happens to be first.
    let original = builtin::templates()
        .into_iter()
        .find(|entry| entry.manifest.id == "soft-slideshow")
        .expect("the soft slideshow is in the shipped set");

    let reopened = reader::read_template(Cursor::new(to_videolat(&original))).unwrap();

    assert_eq!(reopened, original);
}

// The point of reusing the `.videola` container: the same bytes still open as a project. A template
// is a project with questions attached, not a second kind of file.
#[test]
fn a_videolat_also_opens_as_the_project_it_describes() {
    let original = builtin::templates().into_iter().next().unwrap();

    let loaded = reader::read(Cursor::new(to_videolat(&original))).unwrap();

    assert_eq!(loaded.project, original.project);
    assert!(loaded.template.is_some());
}

#[test]
fn an_ordinary_project_file_is_not_mistaken_for_a_template() {
    let mut sink = Cursor::new(Vec::new());
    writer::write(
        &mut sink,
        &Project::default(),
        &MemoryMediaStore::default(),
        &save_options(),
    )
    .unwrap();
    let bytes = sink.into_inner();

    assert!(reader::read(Cursor::new(bytes.clone()))
        .unwrap()
        .template
        .is_none());
    assert!(matches!(
        reader::read_template(Cursor::new(bytes)),
        Err(CoreError::NotAProject(_))
    ));
}

// A template file is untrusted input exactly like a project file. The manifest reaching the reader
// with a binding that names nothing has to be refused there, not discovered by the wizard.
#[test]
fn a_template_file_whose_binding_names_no_clip_is_refused_on_load() {
    let original = builtin::templates().into_iter().next().unwrap();
    let media = original
        .manifest
        .slots
        .iter()
        .position(|slot| slot.kind == SlotKind::Media)
        .expect("a media slot to break");
    let bytes = to_videolat(&original);
    let broken = rewrite_entry(bytes, "template.json", |raw| {
        let mut manifest: serde_json::Value = serde_json::from_str(raw).unwrap();
        manifest["slots"][media]["bindings"][0]["clip"] = serde_json::json!("clp_ghost");
        serde_json::to_string(&manifest).unwrap()
    });

    assert!(matches!(
        reader::read_template(Cursor::new(broken)),
        Err(CoreError::ClipNotFound(_))
    ));
}

// The same rule for the bindings that reach a generator. These name a clip *and* the kind of
// generator on it, so a file pointing one at nothing has to be turned away at the door rather than
// discovered by a wizard field whose answer goes nowhere.
#[test]
fn a_template_file_whose_text_binding_names_no_generator_is_refused_on_load() {
    let original = builtin::templates().into_iter().next().unwrap();
    let words = original
        .manifest
        .slots
        .iter()
        .position(|slot| slot.kind == SlotKind::Text)
        .expect("a text slot to break");
    let bytes = to_videolat(&original);
    let broken = rewrite_entry(bytes, "template.json", |raw| {
        let mut manifest: serde_json::Value = serde_json::from_str(raw).unwrap();
        manifest["slots"][words]["bindings"][0]["clip"] = serde_json::json!("clp_ghost");
        serde_json::to_string(&manifest).unwrap()
    });

    assert!(matches!(
        reader::read_template(Cursor::new(broken)),
        Err(CoreError::InvalidArgument(_))
    ));
}

#[test]
fn a_template_file_with_an_unreadable_manifest_fails_loudly_instead_of_becoming_a_project() {
    let original = builtin::templates().into_iter().next().unwrap();
    let bytes = to_videolat(&original);
    let broken = rewrite_entry(bytes, "template.json", |_| "{ not json".to_string());

    assert!(matches!(
        reader::read(Cursor::new(broken)),
        Err(CoreError::NotAProject(_))
    ));
}

// The whole loop the milestone claims: a project becomes a template, the template becomes a file,
// the file becomes a template again, and baking it with different material gives a project that
// still passes the ordinary load gate.
#[test]
fn a_project_saved_as_a_template_comes_back_and_bakes_with_new_material() {
    let mut project = Project::default();
    project.meta.title = "Wanderung".into();
    let original = asset("original");
    project.library.push(original.clone());
    let mut track = Track::new(TrackKind::Video, "V1".into());
    let mut clip = Clip::new_media(original.id.clone(), Time::ZERO, Time::from_seconds(4.0));
    clip.id = ClipId::from("clp_one".to_string());
    track.clips.push(clip);
    project.timeline.tracks.push(track);

    let template = Template::from_project(&project, "wanderung", None).unwrap();
    let reopened = reader::read_template(Cursor::new(to_videolat(&template))).unwrap();
    let replacement = asset("replacement");
    let mut answers = answers_for(&reopened);
    answers.insert(
        "media1".into(),
        SlotAnswer::Media {
            asset: replacement.clone(),
        },
    );

    let mut baked = reopened.bake(&answers, None).unwrap();

    assert_eq!(
        baked.timeline.tracks[0].clips[0].source,
        ClipSource::Media {
            media: replacement.id
        }
    );
    assert_eq!(baked.meta.title, "Ein Titel");
    assert!(baked.normalize().is_ok());
}

#[allow(clippy::unwrap_used)]
fn rewrite_entry(bytes: Vec<u8>, name: &str, rewrite: impl Fn(&str) -> String) -> Vec<u8> {
    let mut source = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut sink = Cursor::new(Vec::new());
    {
        let mut out = zip::ZipWriter::new(&mut sink);
        for index in 0..source.len() {
            let mut entry = source.by_index(index).unwrap();
            let entry_name = entry.name().to_string();
            out.start_file(&entry_name, zip::write::SimpleFileOptions::default())
                .unwrap();
            if entry_name == name {
                let mut raw = String::new();
                std::io::Read::read_to_string(&mut entry, &mut raw).unwrap();
                std::io::Write::write_all(&mut out, rewrite(&raw).as_bytes()).unwrap();
            } else {
                std::io::copy(&mut entry, &mut out).unwrap();
            }
        }
        out.finish().unwrap();
    }
    sink.into_inner()
}
