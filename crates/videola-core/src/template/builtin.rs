use super::{
    Fit, Frame, Localized, Slot, SlotBinding, SlotKind, Step, Template, TemplateManifest,
    TEMPLATE_SCHEMA_VERSION,
};
use crate::model::{
    Clip, ClipId, Effect, EffectId, Interp, Keyframe, MediaId, ParamValue, Project,
    ProjectSettings, Rate, Time, Timeline, Track, TrackId, TrackKind, Transition,
    TransitionAlignment,
};

// What every shipped template is built out of, and deliberately nothing more: media clips, a
// transform, a cross dissolve, a keyframed brightness, a background colour. That is the whole of
// what this version can put on a screen — there is no text engine and no effect library — so each
// of the four below shows exactly one of those things doing real work rather than a category
// heading with nothing behind it.
//
// None of them carries footage. A template is a recipe; shipping video with it would make every
// entry as heavy as the project it came from and would put someone else's material in the gallery
// instead of the template's own idea.
pub fn templates() -> Vec<Template> {
    vec![
        three_shots(),
        bookend(),
        vertical_story(),
        picture_in_picture(),
    ]
}

pub const LANDSCAPE: Frame = Frame {
    width: 1920,
    height: 1080,
};
pub const PORTRAIT: Frame = Frame {
    width: 1080,
    height: 1920,
};
pub const SQUARE: Frame = Frame {
    width: 1080,
    height: 1080,
};

const CROSSFADE: f64 = 0.5;

/// Three shots, dissolved into one another. What it shows: the cross dissolve, and clips fitted to
/// a frame their material was never cut for.
fn three_shots() -> Template {
    let shots = ["clp_shot1", "clp_shot2", "clp_shot3"];
    let mut track = video_track("trk_main", "V1");
    for (index, id) in shots.iter().enumerate() {
        let start = index as f64 * (2.5 - CROSSFADE);
        let mut clip = placeholder(id, start, 2.5);
        if index > 0 {
            clip.transition_in = Some(dissolve(CROSSFADE));
        }
        track.clips.push(clip);
    }

    let mut slots: Vec<Slot> = shots
        .iter()
        .enumerate()
        .map(|(index, id)| media_slot(&format!("shot{}", index + 1), index + 1, id))
        .collect();
    slots.push(title_slot());
    slots.push(color_slot());

    Template {
        manifest: TemplateManifest {
            schema_version: TEMPLATE_SCHEMA_VERSION,
            id: "three-shots".into(),
            version: 1,
            name: Localized::new("Drei Aufnahmen", "Three Shots"),
            description: Localized::new(
                "Drei Aufnahmen, weich ineinander uebergeblendet, jede auf das Bildformat \
                 eingepasst.",
                "Three shots dissolving into one another, each fitted to the frame.",
            ),
            category: "montage".into(),
            tags: vec!["dissolve".into(), "montage".into()],
            aspect_ratios: vec![LANDSCAPE, PORTRAIT, SQUARE],
            steps: vec![
                footage_step(vec!["shot1".into(), "shot2".into(), "shot3".into()]),
                finishing_step(),
            ],
            slots,
        },
        project: project_with(LANDSCAPE, vec![track]),
    }
}

/// One shot opens and closes the film, a second carries the middle. What it shows: a single slot
/// writing into two places at once, and the only way this version has of fading from and to black
/// — a keyframed brightness.
fn bookend() -> Template {
    let mut track = video_track("trk_main", "V1");

    let mut open = placeholder("clp_open", 0.0, 2.0);
    open.effects
        .push(brightness_ramp("eff_in", 0.0, 0.0, 0.8, 1.0));
    track.clips.push(open);

    track.clips.push(placeholder("clp_middle", 2.0, 3.0));

    let mut close = placeholder("clp_close", 5.0, 2.0);
    close
        .effects
        .push(brightness_ramp("eff_out", 6.2, 1.0, 7.0, 0.0));
    track.clips.push(close);

    Template {
        manifest: TemplateManifest {
            schema_version: TEMPLATE_SCHEMA_VERSION,
            id: "bookend".into(),
            version: 1,
            name: Localized::new("Auftakt und Abspann", "Bookend"),
            description: Localized::new(
                "Eine Aufnahme oeffnet und schliesst den Film und blendet dabei aus dem \
                 Schwarz auf und wieder hinein; eine zweite traegt die Mitte.",
                "One shot opens and closes the film, fading up from black and back into it; a \
                 second one carries the middle.",
            ),
            category: "story".into(),
            tags: vec!["fade".into(), "story".into()],
            aspect_ratios: vec![LANDSCAPE, PORTRAIT],
            slots: vec![
                Slot {
                    id: "hero".into(),
                    kind: SlotKind::Media,
                    label: Localized::new("Rahmen-Aufnahme", "Bookend shot"),
                    hint: Localized::new(
                        "Steht am Anfang und am Ende, blendet auf und wieder ab.",
                        "Opens and closes the film, fading up and back out.",
                    ),
                    required: true,
                    bindings: vec![cover("clp_open"), cover("clp_close")],
                },
                media_slot_named(
                    "scene",
                    Localized::new("Mittelteil", "Middle"),
                    Localized::new("Was dazwischen passiert.", "Whatever happens in between."),
                    "clp_middle",
                ),
                title_slot(),
                color_slot(),
            ],
            steps: vec![
                footage_step(vec!["hero".into(), "scene".into()]),
                finishing_step(),
            ],
        },
        project: project_with(LANDSCAPE, vec![track]),
    }
}

/// Four quick cuts in a portrait frame. What it shows: the fit itself — landscape material filling
/// a 9:16 frame edge to edge instead of sitting in a letterbox, which nothing in this version's
/// interface can do by hand.
fn vertical_story() -> Template {
    let mut track = video_track("trk_main", "V1");
    let shots = ["clp_a", "clp_b", "clp_c", "clp_d"];
    for (index, id) in shots.iter().enumerate() {
        track.clips.push(placeholder(id, index as f64 * 1.8, 1.8));
    }

    let mut slots: Vec<Slot> = shots
        .iter()
        .enumerate()
        .map(|(index, id)| media_slot(&format!("shot{}", index + 1), index + 1, id))
        .collect();
    slots.push(title_slot());
    slots.push(color_slot());

    Template {
        manifest: TemplateManifest {
            schema_version: TEMPLATE_SCHEMA_VERSION,
            id: "vertical-story".into(),
            version: 1,
            name: Localized::new("Hochformat-Story", "Vertical Story"),
            description: Localized::new(
                "Vier schnelle Schnitte im Hochformat. Querformat-Material wird auf das \
                 Hochkant-Bild eingepasst statt in einen Balkenrahmen gelegt.",
                "Four quick cuts in portrait. Landscape footage is fitted to fill the upright \
                 frame instead of sitting in bars.",
            ),
            category: "social".into(),
            tags: vec!["portrait".into(), "social".into()],
            aspect_ratios: vec![PORTRAIT, SQUARE],
            steps: vec![
                footage_step(vec![
                    "shot1".into(),
                    "shot2".into(),
                    "shot3".into(),
                    "shot4".into(),
                ]),
                finishing_step(),
            ],
            slots,
        },
        project: project_with(PORTRAIT, vec![track]),
    }
}

/// A second picture in the corner of the first. What it shows: two tracks stacked, and a fit into
/// a rectangle rather than the whole frame.
fn picture_in_picture() -> Template {
    let mut back = video_track("trk_back", "V1");
    back.clips.push(placeholder("clp_back", 0.0, 6.0));
    let mut front = video_track("trk_front", "V2");
    front.clips.push(placeholder("clp_front", 0.0, 6.0));

    Template {
        manifest: TemplateManifest {
            schema_version: TEMPLATE_SCHEMA_VERSION,
            id: "picture-in-picture".into(),
            version: 1,
            name: Localized::new("Bild im Bild", "Picture in Picture"),
            description: Localized::new(
                "Eine Aufnahme fuellt das Bild, eine zweite sitzt klein in der oberen rechten \
                 Ecke.",
                "One shot fills the frame, a second sits small in the top right corner.",
            ),
            category: "overlay".into(),
            tags: vec!["overlay".into(), "two tracks".into()],
            aspect_ratios: vec![LANDSCAPE, SQUARE],
            slots: vec![
                media_slot_named(
                    "backdrop",
                    Localized::new("Hintergrund-Aufnahme", "Background shot"),
                    Localized::new("Fuellt das ganze Bild.", "Fills the whole frame."),
                    "clp_back",
                ),
                Slot {
                    id: "inset".into(),
                    kind: SlotKind::Media,
                    label: Localized::new("Einblendung", "Inset"),
                    hint: Localized::new(
                        "Sitzt klein oben rechts, vollstaendig sichtbar.",
                        "Sits small in the top right, shown whole.",
                    ),
                    required: true,
                    bindings: vec![SlotBinding::ClipMedia {
                        clip: ClipId::from("clp_front".to_string()),
                        fit: Fit::inset(0.60, 0.06, 0.34, 0.34),
                    }],
                },
                title_slot(),
                color_slot(),
            ],
            steps: vec![
                footage_step(vec!["backdrop".into(), "inset".into()]),
                finishing_step(),
            ],
        },
        project: project_with(LANDSCAPE, vec![back, front]),
    }
}

// The material a slot has yet to be given. The id names nothing that exists, which is exactly what
// `check_every_clip_has_a_source` demands a slot for.
const PLACEHOLDER: &str = "med_awaiting_a_slot_answer";

fn placeholder(id: &str, start: f64, duration: f64) -> Clip {
    let mut clip = Clip::new_media(
        MediaId::from(PLACEHOLDER.to_string()),
        Time::from_seconds(start),
        Time::from_seconds(duration),
    );
    clip.id = ClipId::from(id.to_string());
    clip
}

// Aligned to the incoming edge rather than centred: a centred dissolve reaches back to before the
// clip starts, where nothing is drawn, so half of it would simply not be seen (see `windowStart`
// in draw-list.ts). The clips overlap by exactly the length of the dissolve instead.
fn dissolve(seconds: f64) -> Transition {
    let mut transition = Transition::new("crossfade", Time::from_seconds(seconds));
    transition.alignment = TransitionAlignment::In;
    transition
}

fn brightness_ramp(id: &str, from_at: f64, from: f32, to_at: f64, to: f32) -> Effect {
    let mut effect = Effect::new("brightness");
    effect.id = EffectId::from(id.to_string());
    effect
        .keyframes
        .insert("amount".into(), vec![key(from_at, from), key(to_at, to)]);
    effect
}

fn key(at: f64, value: f32) -> Keyframe {
    Keyframe {
        time: Time::from_seconds(at),
        value: ParamValue::Float(value),
        interp: Interp::Linear,
        handle_in: None,
        handle_out: None,
    }
}

fn video_track(id: &str, name: &str) -> Track {
    let mut track = Track::new(TrackKind::Video, name.to_string());
    track.id = TrackId::from(id.to_string());
    track
}

fn project_with(frame: Frame, tracks: Vec<Track>) -> Project {
    Project {
        settings: ProjectSettings {
            width: frame.width,
            height: frame.height,
            fps: Rate::from_fps(30),
            background: "#000000".into(),
            ..ProjectSettings::default()
        },
        timeline: Timeline { tracks },
        ..Project::default()
    }
}

fn cover(clip: &str) -> SlotBinding {
    SlotBinding::ClipMedia {
        clip: ClipId::from(clip.to_string()),
        fit: Fit::full_frame(),
    }
}

fn media_slot(id: &str, ordinal: usize, clip: &str) -> Slot {
    media_slot_named(
        id,
        Localized::new(&format!("Aufnahme {ordinal}"), &format!("Shot {ordinal}")),
        Localized::new(
            "Video oder Bild; wird auf das Bildformat eingepasst.",
            "A video or a still; fitted to the frame.",
        ),
        clip,
    )
}

fn media_slot_named(id: &str, label: Localized, hint: Localized, clip: &str) -> Slot {
    Slot {
        id: id.to_string(),
        kind: SlotKind::Media,
        label,
        hint,
        required: true,
        bindings: vec![cover(clip)],
    }
}

// Bound to the project's name, and the hint says so. On-screen titles need a text generator the
// renderer does not have yet; a slot that claimed one would be the emptiest promise in the gallery.
fn title_slot() -> Slot {
    Slot {
        id: "title".into(),
        kind: SlotKind::Text,
        label: Localized::new("Projektname", "Project name"),
        hint: Localized::new(
            "Benennt das Projekt und die Exportdatei. Titel im Bild kann diese Fassung noch nicht.",
            "Names the project and the exported file. On-screen titles are not in this version yet.",
        ),
        required: false,
        bindings: vec![SlotBinding::ProjectTitle],
    }
}

fn color_slot() -> Slot {
    Slot {
        id: "color".into(),
        kind: SlotKind::Color,
        label: Localized::new("Hintergrundfarbe", "Background colour"),
        hint: Localized::new(
            "Zu sehen ueberall dort, wo kein Bild liegt.",
            "Seen wherever no picture covers the frame.",
        ),
        required: false,
        bindings: vec![SlotBinding::Background],
    }
}

fn footage_step(slots: Vec<String>) -> Step {
    Step {
        title: Localized::new("Material", "Footage"),
        slots,
    }
}

fn finishing_step() -> Step {
    Step {
        title: Localized::new("Feinschliff", "Finishing"),
        slots: vec!["title".into(), "color".into()],
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::{ClipSource, MediaAsset, MediaKind};
    use crate::template::SlotAnswer;

    fn wide_asset(name: &str) -> MediaAsset {
        let mut asset = MediaAsset::new(
            MediaId::from(format!("med_{name}")),
            format!("{name}.mp4"),
            "video/mp4".into(),
            MediaKind::Video,
            1_000,
        );
        asset.duration = Some(Time::from_seconds(30.0));
        asset.width = Some(1920);
        asset.height = Some(1080);
        asset
    }

    fn every_slot_answered(manifest: &TemplateManifest) -> BTreeMap<String, SlotAnswer> {
        manifest
            .slots
            .iter()
            .map(|slot| {
                let answer = match slot.kind {
                    SlotKind::Media => SlotAnswer::Media {
                        asset: wide_asset(&slot.id),
                    },
                    SlotKind::Text => SlotAnswer::Text {
                        text: format!("{} title", slot.id),
                    },
                    SlotKind::Color => SlotAnswer::Color {
                        color: "#1188ff".into(),
                    },
                };
                (slot.id.clone(), answer)
            })
            .collect()
    }

    #[test]
    fn every_shipped_template_passes_the_gate_it_will_be_loaded_through() {
        for mut template in templates() {
            let id = template.manifest.id.clone();
            assert!(template.normalize().is_ok(), "{id} must normalize");
        }
    }

    #[test]
    fn every_shipped_template_has_a_distinct_id() {
        let mut ids: Vec<String> = templates()
            .iter()
            .map(|template| template.manifest.id.clone())
            .collect();
        let count = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), count);
    }

    // The check against the empty gallery entry: every template, fully answered, has to produce a
    // project whose every clip points at material that is actually in the library. A clip left on
    // a placeholder draws nothing, and nothing is what a viewer would see.
    #[test]
    fn every_shipped_template_bakes_into_a_project_whose_clips_all_have_material() {
        for template in templates() {
            let id = template.manifest.id.clone();
            let baked = template
                .bake(&every_slot_answered(&template.manifest), None)
                .unwrap_or_else(|error| panic!("{id} failed to bake: {error}"));

            let clips: Vec<_> = baked
                .timeline
                .tracks
                .iter()
                .flat_map(|track| &track.clips)
                .collect();
            assert!(!clips.is_empty(), "{id} baked into an empty timeline");
            for clip in clips {
                let ClipSource::Media { media } = &clip.source else {
                    panic!("{id} baked a clip this version cannot draw");
                };
                assert!(
                    baked.library.iter().any(|asset| &asset.id == media),
                    "{id} left clip {} without material",
                    clip.id
                );
                assert_ne!(media.as_str(), PLACEHOLDER, "{id} kept a placeholder");
            }
        }
    }

    // Every offered aspect ratio is offered for real: baking into it has to succeed and the frame
    // has to be the one that was asked for, not the one the template was authored at.
    #[test]
    fn every_offered_aspect_ratio_bakes() {
        for template in templates() {
            let id = template.manifest.id.clone();
            assert!(
                !template.manifest.aspect_ratios.is_empty(),
                "{id} offers no frame at all"
            );
            for frame in &template.manifest.aspect_ratios {
                let settings = ProjectSettings {
                    width: frame.width,
                    height: frame.height,
                    ..ProjectSettings::default()
                };
                let baked = template
                    .bake(&every_slot_answered(&template.manifest), Some(&settings))
                    .unwrap_or_else(|error| panic!("{id} at {frame:?} failed: {error}"));
                assert_eq!(baked.settings.width, frame.width);
                assert_eq!(baked.settings.height, frame.height);
            }
        }
    }

    // A template's words are its whole surface in the gallery, and a missing translation is only
    // ever noticed by whoever reads the other language.
    #[test]
    fn every_shipped_template_speaks_both_languages_everywhere() {
        for template in templates() {
            let manifest = &template.manifest;
            let mut texts = vec![&manifest.name, &manifest.description];
            texts.extend(manifest.steps.iter().map(|step| &step.title));
            for slot in &manifest.slots {
                texts.push(&slot.label);
                texts.push(&slot.hint);
            }
            for text in texts {
                assert!(
                    !text.de.trim().is_empty(),
                    "{}: German missing",
                    manifest.id
                );
                assert!(
                    !text.en.trim().is_empty(),
                    "{}: English missing",
                    manifest.id
                );
                assert_ne!(
                    text.de, text.en,
                    "{}: the two languages say the same thing",
                    manifest.id
                );
            }
        }
    }

    // The dissolve only reads as a dissolve if the two clips overlap for its whole length: the
    // incoming clip is not drawn before it starts, so a dissolve reaching back past that edge is
    // half invisible.
    #[test]
    fn a_dissolve_is_covered_by_a_real_overlap() {
        for template in templates() {
            for track in &template.project.timeline.tracks {
                for (index, clip) in track.clips.iter().enumerate() {
                    let Some(transition) = &clip.transition_in else {
                        continue;
                    };
                    assert_eq!(transition.alignment, TransitionAlignment::In);
                    assert!(
                        index > 0,
                        "the first clip of a track cannot dissolve into one"
                    );
                    let previous = &track.clips[index - 1];
                    assert!(
                        previous.end() >= clip.start + transition.duration,
                        "{}: clip {} dissolves over nothing",
                        template.manifest.id,
                        clip.id
                    );
                }
            }
        }
    }

    // Nothing in the shipped set may lean on an effect or a transition the renderer does not have.
    // `effectPasses`/`mixPass` skip an unknown type in silence, so this would look like a template
    // that simply does nothing rather than one that is broken.
    #[test]
    fn the_shipped_set_only_uses_effects_this_version_can_draw() {
        for template in templates() {
            for track in &template.project.timeline.tracks {
                for clip in &track.clips {
                    for effect in &clip.effects {
                        assert_eq!(effect.effect_type, "brightness");
                    }
                    if let Some(transition) = &clip.transition_in {
                        assert_eq!(transition.transition_type, "crossfade");
                    }
                }
            }
        }
    }

    #[test]
    fn the_bookend_writes_one_answer_into_both_of_its_clips() {
        let template = templates()
            .into_iter()
            .find(|entry| entry.manifest.id == "bookend")
            .unwrap();

        let baked = template
            .bake(&every_slot_answered(&template.manifest), None)
            .unwrap();

        let sources: Vec<&MediaId> = baked.timeline.tracks[0]
            .clips
            .iter()
            .filter_map(|clip| match &clip.source {
                ClipSource::Media { media } => Some(media),
                _ => None,
            })
            .collect();
        assert_eq!(sources[0], sources[2]);
        assert_ne!(sources[0], sources[1]);
    }

    #[test]
    fn the_inset_of_the_picture_in_picture_really_is_smaller_than_the_backdrop() {
        let template = templates()
            .into_iter()
            .find(|entry| entry.manifest.id == "picture-in-picture")
            .unwrap();

        let baked = template
            .bake(&every_slot_answered(&template.manifest), None)
            .unwrap();

        let backdrop = baked.timeline.tracks[0].clips[0].transform.scale_x;
        let inset = baked.timeline.tracks[1].clips[0].transform.scale_x;
        assert_eq!(backdrop, 1.0);
        assert!(
            inset < backdrop,
            "inset {inset} is not smaller than {backdrop}"
        );
        assert!(baked.timeline.tracks[1].clips[0].transform.x > 0.0);
        assert!(baked.timeline.tracks[1].clips[0].transform.y < 0.0);
    }
}
