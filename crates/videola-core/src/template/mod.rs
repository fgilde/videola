pub mod builtin;

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;

use crate::model::project::{dimension_bounded, finite, settings_bounded};
use crate::model::{
    Clip, ClipId, ClipSource, Generator, MediaAsset, MediaId, MediaKind, Project, ProjectId,
    ProjectSettings, Time, Transform,
};
use crate::{CoreError, Result};

pub const TEMPLATE_SCHEMA_VERSION: u32 = 1;

// A `.videolat` is untrusted input exactly like a `.videola`, and every slot becomes a rendered
// field in the wizard. Sixty-four is far past any template a person would sit through and far
// short of a number that makes the wizard the reason a tab dies.
const MAX_SLOTS: usize = 64;

// How far a clip may be slowed to cover a slot whose material is too short (see `speed_for`).
// Past four times slower a shot stops reading as slow motion and starts reading as a freeze, and
// the honest answer is then "this file is too short", not a still that pretends to be a shot.
const MIN_STRETCH_RATE: f32 = 0.25;

// The material `preview` answers every media slot with, and the two greys it is drawn in. Long
// enough that no slot can be short of it — a preview that slowed a clip down would be showing a
// rhythm the template never asked for.
const STAND_IN: &str = "med_preview_stand_in";
const STAND_IN_SECONDS: f64 = 3_600.0;
// Light enough to read as a filled rectangle against the card it sits on, and flat enough that
// nobody mistakes it for a design decision. A stand-in darker than the surface behind it makes a
// template whose material fills the frame look like an empty card, which is the worst thing a
// gallery can do -- it hides the good templates behind the ones that happen to carry more text.
const STAND_IN_FROM: &str = "#5d6675";
const STAND_IN_TO: &str = "#343b46";
const STAND_IN_ANGLES: [f32; 3] = [135.0, 45.0, 200.0];

fn stand_in(frame: Frame) -> MediaAsset {
    let mut asset = MediaAsset::new(
        MediaId::from(STAND_IN.to_string()),
        "preview".into(),
        "video/mp4".into(),
        MediaKind::Video,
        0,
    );
    asset.duration = Some(Time::from_seconds(STAND_IN_SECONDS));
    asset.width = Some(frame.width);
    asset.height = Some(frame.height);
    asset
}

/// A template as it lives in memory: the manifest that describes the questions, and the project
/// that answers them. The two travel together because neither validates without the other — a
/// binding is only meaningful against the clip it names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub manifest: TemplateManifest,
    pub project: Project,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TemplateManifest {
    pub schema_version: u32,
    pub id: String,
    pub version: u32,
    pub name: Localized,
    pub description: Localized,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// The frames this template offers in the gallery. Every fit is worked out against the frame
    /// chosen at bake time, so a portrait entry costs the author nothing but this line.
    #[serde(default)]
    pub aspect_ratios: Vec<Frame>,
    /// The instant the gallery draws its card from. An author picks it, because only the author
    /// knows which second of their build is the one worth showing; there is no arithmetic that
    /// reliably lands on it. Absent means the start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster_at: Option<Time>,
    pub slots: Vec<Slot>,
    pub steps: Vec<Step>,
}

/// Both languages side by side rather than a catalogue key, because a template can arrive from a
/// file the application has never seen and its words cannot be in a catalogue that shipped before
/// it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Localized {
    pub de: String,
    pub en: String,
}

impl Localized {
    pub fn new(de: &str, en: &str) -> Self {
        Self {
            de: de.to_string(),
            en: en.to_string(),
        }
    }

    fn same(text: &str) -> Self {
        Self::new(text, text)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Slot {
    pub id: String,
    pub kind: SlotKind,
    pub label: Localized,
    pub hint: Localized,
    pub required: bool,
    pub bindings: Vec<SlotBinding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SlotKind {
    Media,
    Text,
    Color,
}

/// Where a slot's value lands. The specification writes this as a `path` string; an enum of the
/// places a value can actually reach is fewer lines than a JSON-pointer writer and cannot name a
/// field that does not exist. Every variant here is something a viewer can see today.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "target",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SlotBinding {
    ClipMedia {
        clip: ClipId,
        fit: Fit,
    },
    ClipLabel {
        clip: ClipId,
    },
    ProjectTitle,
    Background,
    /// The words a text generator puts on the screen. The one binding that makes a template look
    /// like the person who filled it in, rather than like the template.
    GeneratorText {
        clip: ClipId,
    },
    /// The colour a generator is drawn in: a solid's fill, the first stop of a gradient, or the
    /// ink of a title. One answer, one clip, whichever of the three it happens to be.
    GeneratorColor {
        clip: ClipId,
    },
}

/// The rectangle a clip's picture is placed in, as fractions of the frame with the origin at the
/// top left. Worked out at bake time, because only then are both the material's size and the
/// chosen frame known — which is also what lets one template serve landscape and portrait.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Fit {
    pub mode: FitMode,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum FitMode {
    /// Fills the rectangle; whatever does not fit runs past its edges.
    Cover,
    /// Fits inside the rectangle; whatever is left over stays empty.
    Contain,
}

impl Fit {
    pub fn full_frame() -> Self {
        Self {
            mode: FitMode::Cover,
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }
    }

    pub fn inset(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            mode: FitMode::Contain,
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub title: Localized,
    pub slots: Vec<String>,
}

/// One answer from the wizard. The media variant carries the whole asset rather than an id: the
/// file has already been through the ordinary import (hashed, in storage, probed), and bake needs
/// its size to work the fit out and its length to decide whether the clip has to be slowed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SlotAnswer {
    Media { asset: MediaAsset },
    Text { text: String },
    Color { color: String },
}

impl Template {
    /// The one gate a template passes through, whichever way it arrived. `Project::normalize` runs
    /// first because every manifest check below reads the project it just vouched for.
    pub fn normalize(&mut self) -> Result<()> {
        self.project.normalize()?;
        self.manifest.check_against(&self.project)
    }

    /// The whole point of the milestone: template plus answers becomes an ordinary project, with
    /// no mode, no marker and no second kind of document behind it.
    pub fn bake(
        &self,
        answers: &BTreeMap<String, SlotAnswer>,
        settings: Option<&ProjectSettings>,
    ) -> Result<Project> {
        let mut project = self.project.clone();
        // A new identity, or two projects from the same template are the same project as far as
        // the manifest, the recent list and any sync ever built on top of it are concerned.
        project.meta.id = ProjectId::new();
        if let Some(settings) = settings {
            settings_bounded(settings)?;
            project.settings = settings.clone();
        }
        let frame = Frame {
            width: project.settings.width,
            height: project.settings.height,
        };

        let mut unfilled = BTreeSet::new();
        for slot in &self.manifest.slots {
            match answers.get(&slot.id) {
                Some(answer) => apply(&mut project, slot, answer, frame)?,
                None if slot.required => {
                    return Err(CoreError::InvalidArgument(format!(
                        "slot {} is required and has no answer",
                        slot.id
                    )))
                }
                // An unanswered optional media slot leaves a clip pointing at material that does
                // not exist. That clip draws nothing at all, so it goes — an invisible rectangle
                // in the timeline is the template promising something it cannot show.
                None => unfilled.extend(slot.media_clips().cloned()),
            }
        }
        drop_clips(&mut project, &unfilled);

        project.extra.insert(
            "template".into(),
            json!({ "id": self.manifest.id, "version": self.manifest.version }),
        );
        project.normalize()?;
        Ok(project)
    }

    /// What the gallery draws its card from: the template baked against a stand-in for every piece
    /// of material, where each stand-in is a plain gradient sitting in exactly the rectangle the
    /// real answer will land in.
    ///
    /// Why bake rather than paint a picture of the timeline: a painted card is a promise with
    /// nothing behind it — it can show a look the renderer would never produce. This one goes
    /// through the same `bake` a real answer goes through, so if the card is wrong the template is
    /// wrong. The stand-in is exactly the size of the frame, which is the size a generator is drawn
    /// at, so the fit arithmetic puts the grey rectangle precisely where the footage goes.
    pub fn preview(&self, frame: Option<Frame>) -> Result<Project> {
        let frame = frame
            .or_else(|| self.manifest.aspect_ratios.first().copied())
            .unwrap_or(Frame {
                width: self.project.settings.width,
                height: self.project.settings.height,
            });
        dimension_bounded(frame.width)?;
        dimension_bounded(frame.height)?;
        let settings = ProjectSettings {
            width: frame.width,
            height: frame.height,
            ..self.project.settings.clone()
        };

        let answers = self
            .manifest
            .slots
            .iter()
            .filter(|slot| slot.kind == SlotKind::Media)
            .map(|slot| {
                (
                    slot.id.clone(),
                    SlotAnswer::Media {
                        asset: stand_in(frame),
                    },
                )
            })
            .collect();
        let mut project = self.bake(&answers, Some(&settings))?;

        // The ramp is turned a little further for each stand-in in turn. Two pictures side by side
        // -- a split screen, an inset over a backdrop -- are two different pictures, and drawing
        // both in exactly the same grey makes the seam between them disappear, which is the one
        // thing those templates exist to show.
        let mut nth = 0;
        for track in &mut project.timeline.tracks {
            for clip in &mut track.clips {
                if !matches!(&clip.source, ClipSource::Media { media } if media.as_str() == STAND_IN)
                {
                    continue;
                }
                clip.source = ClipSource::Generator {
                    generator: Generator::Gradient {
                        from: STAND_IN_FROM.into(),
                        to: STAND_IN_TO.into(),
                        angle: STAND_IN_ANGLES[nth % STAND_IN_ANGLES.len()],
                    },
                };
                nth += 1;
                // A stand-in is never too short, so any slowing left over from the bake would be a
                // rate this preview invented rather than one the template asked for.
                clip.speed.rate = 1.0;
            }
        }
        project
            .library
            .retain(|asset| asset.id.as_str() != STAND_IN);
        project.normalize()?;
        Ok(project)
    }

    /// A project becomes a template. `marked` is the author's own choice of which clips turn into
    /// questions — the editor's selection, which is marking a clip without inventing a second way
    /// to mark one. `None` means "decide for me".
    ///
    /// What marking can and cannot decide, honestly:
    ///
    /// * **Media clips are always slots, marked or not.** The footage stays with whoever made it,
    ///   so a media clip that was not a question would point at material no copy of the template
    ///   carries — it would draw nothing at all. There is no version of "leave this shot as it is"
    ///   that does not mean shipping the shot.
    /// * **Text generators are a real choice.** An unmarked title simply keeps its words, because a
    ///   generator is its own material; marking one turns it into a field in the wizard. With
    ///   nothing marked, every title becomes a field, which is what someone sharing a title
    ///   sequence wants.
    /// * **A marked solid or gradient becomes a colour question.** Unmarked ones never do: one
    ///   colour field per coloured clip would be a wall of questions about a design nobody asked to
    ///   change.
    pub fn from_project(
        project: &Project,
        id: &str,
        marked: Option<&BTreeSet<ClipId>>,
    ) -> Result<Self> {
        let mut stripped = project.clone();
        let mut slots = Vec::new();
        let mut media_slots = Vec::new();
        let mut text_slots = Vec::new();
        let mut color_slots = Vec::new();

        for (index, media) in used_media(project).into_iter().enumerate() {
            let bindings = clips_using(project, &media)
                .into_iter()
                .map(|clip| SlotBinding::ClipMedia {
                    clip,
                    fit: Fit::full_frame(),
                })
                .collect();
            let slot_id = format!("media{}", index + 1);
            media_slots.push(slot_id.clone());
            slots.push(Slot {
                id: slot_id,
                kind: SlotKind::Media,
                label: Localized::new(
                    &format!("Aufnahme {}", index + 1),
                    &format!("Shot {}", index + 1),
                ),
                hint: Localized::same(&original_name(project, &media)),
                required: true,
                bindings,
            });
        }

        // With nothing marked, every title is a question; with something marked, only what was
        // marked is. Either way the hint is the words the clip carries today, because "which of my
        // four titles is this?" is the only question an author of a template ever has about it.
        for (index, (clip, generator)) in generator_clips(project).into_iter().enumerate() {
            let wanted = marked.is_none_or(|chosen| chosen.contains(&clip));
            match generator {
                Generator::Text { content, .. } if wanted => {
                    let slot_id = format!("text{}", index + 1);
                    text_slots.push(slot_id.clone());
                    slots.push(Slot {
                        id: slot_id,
                        kind: SlotKind::Text,
                        label: Localized::new(
                            &format!("Text {}", index + 1),
                            &format!("Text {}", index + 1),
                        ),
                        hint: Localized::same(&first_line(content)),
                        required: false,
                        bindings: vec![SlotBinding::GeneratorText { clip }],
                    });
                }
                Generator::Solid { .. } | Generator::Gradient { .. }
                    if wanted && marked.is_some() =>
                {
                    let slot_id = format!("colour{}", index + 1);
                    color_slots.push(slot_id.clone());
                    slots.push(Slot {
                        id: slot_id,
                        kind: SlotKind::Color,
                        label: Localized::new(
                            &format!("Farbe {}", index + 1),
                            &format!("Colour {}", index + 1),
                        ),
                        hint: Localized::new(
                            "Die Farbe dieser Fläche.",
                            "The colour of this field.",
                        ),
                        required: false,
                        bindings: vec![SlotBinding::GeneratorColor { clip }],
                    });
                }
                _ => {}
            }
        }

        text_slots.push("title".into());
        slots.push(Slot {
            id: "title".into(),
            kind: SlotKind::Text,
            label: Localized::new("Titel", "Title"),
            hint: Localized::new("Benennt das Projekt.", "Names the project."),
            required: false,
            bindings: vec![SlotBinding::ProjectTitle],
        });
        color_slots.push("background".into());
        slots.push(Slot {
            id: "background".into(),
            kind: SlotKind::Color,
            label: Localized::new("Hintergrund", "Background"),
            hint: Localized::new(
                "Die Farbe hinter allem.",
                "The colour behind everything else.",
            ),
            required: false,
            bindings: vec![SlotBinding::Background],
        });

        // The material stays with whoever made it: a template is a recipe, and shipping the
        // footage would make every copy of it as big as the project it came from.
        stripped.library.clear();

        let mut template = Self {
            manifest: TemplateManifest {
                schema_version: TEMPLATE_SCHEMA_VERSION,
                id: id.to_string(),
                version: 1,
                name: Localized::same(nonempty(&project.meta.title, "Vorlage")),
                description: Localized::same(project.meta.description.as_deref().unwrap_or("")),
                category: "custom".into(),
                tags: project.meta.tags.clone(),
                aspect_ratios: vec![Frame {
                    width: project.settings.width,
                    height: project.settings.height,
                }],
                poster_at: None,
                // A step per kind of question, and no empty ones: a project with no footage in it
                // must not open the wizard on a panel with nothing on it.
                steps: [
                    (Localized::new("Ihr Material", "Your footage"), media_slots),
                    (Localized::new("Ihre Worte", "Your words"), text_slots),
                    (Localized::new("Ihre Farbe", "Your colour"), color_slots),
                ]
                .into_iter()
                .filter(|(_, ids)| !ids.is_empty())
                .map(|(title, ids)| Step { title, slots: ids })
                .collect(),
                slots,
            },
            project: stripped,
        };
        template.normalize()?;
        Ok(template)
    }
}

impl Slot {
    fn media_clips(&self) -> impl Iterator<Item = &ClipId> {
        self.bindings.iter().filter_map(|binding| match binding {
            SlotBinding::ClipMedia { clip, .. } => Some(clip),
            _ => None,
        })
    }
}

impl TemplateManifest {
    fn check_against(&self, project: &Project) -> Result<()> {
        if self.schema_version != TEMPLATE_SCHEMA_VERSION {
            return Err(CoreError::UnsupportedSchema(self.schema_version as u64));
        }
        if self.id.trim().is_empty() {
            return Err(invalid("a template needs a non-empty id"));
        }
        if self.slots.len() > MAX_SLOTS {
            return Err(invalid("a template may not carry more than 64 slots"));
        }
        for frame in &self.aspect_ratios {
            dimension_bounded(frame.width)?;
            dimension_bounded(frame.height)?;
        }

        let mut seen = BTreeSet::new();
        for slot in &self.slots {
            if slot.id.trim().is_empty() || !seen.insert(slot.id.as_str()) {
                return Err(invalid("slot ids must be present and unique"));
            }
            check_slot(slot, project)?;
        }
        check_steps(&self.steps, &seen)?;
        // Every clip has to be fillable, or the gallery is offering a picture nobody can produce.
        check_every_clip_has_a_source(project, &self.slots)
    }
}

fn check_slot(slot: &Slot, project: &Project) -> Result<()> {
    for binding in &slot.bindings {
        let allowed = match (slot.kind, binding) {
            // No check that the clip is a *media* clip: `check_every_clip_has_a_source` already
            // refuses a template containing any other kind, so a second check here could only
            // change the wording of the refusal. A mutation that removed it survived, which is
            // what said so.
            (SlotKind::Media, SlotBinding::ClipMedia { clip, fit }) => {
                fit_bounded(fit)?;
                exists(project, clip)?;
                true
            }
            (SlotKind::Text, SlotBinding::ClipLabel { clip }) => find_clip(project, clip).is_some(),
            (SlotKind::Text, SlotBinding::ProjectTitle) => true,
            (SlotKind::Color, SlotBinding::Background) => true,
            // Named against the clip's actual generator, not merely against a clip that exists: a
            // text answer written into a solid colour would vanish without a word, and the wizard
            // would have asked a question whose answer goes nowhere.
            (SlotKind::Text, SlotBinding::GeneratorText { clip }) => {
                matches!(generator_of(project, clip), Some(Generator::Text { .. }))
            }
            (SlotKind::Color, SlotBinding::GeneratorColor { clip }) => {
                generator_of(project, clip).is_some_and(recolourable)
            }
            _ => false,
        };
        if !allowed {
            return Err(invalid(&format!(
                "slot {} cannot be bound the way it is",
                slot.id
            )));
        }
    }
    Ok(())
}

// Every slot belongs to exactly one step, and every step names slots that exist. A required slot
// no step asks about would make the wizard hand bake an answer set it is bound to refuse — the
// dead end would only show itself on the last button of the flow.
fn check_steps(steps: &[Step], slots: &BTreeSet<&str>) -> Result<()> {
    let mut asked = BTreeSet::new();
    for step in steps {
        for id in &step.slots {
            if !slots.contains(id.as_str()) {
                return Err(invalid(&format!("step names an unknown slot: {id}")));
            }
            if !asked.insert(id.as_str()) {
                return Err(invalid(&format!("slot {id} appears in two steps")));
            }
        }
    }
    if asked.len() != slots.len() {
        return Err(invalid("every slot must appear in a step"));
    }
    Ok(())
}

// The rule that keeps a template from being a gallery entry with nothing in it: every clip has to
// be something a viewer will actually see. A media clip either takes its material from a slot or
// the template brought that material along itself; a generator clip has to be one the renderer
// paints.
//
// This is the rule that lets a template be a *build* rather than a film. There is no footage in
// this repository and there is never going to be any, so what a template shows on its own is text,
// colour and movement — and that is only worth anything if the gate below insists the renderer can
// draw it.
fn check_every_clip_has_a_source(project: &Project, slots: &[Slot]) -> Result<()> {
    let filled: BTreeSet<&ClipId> = slots.iter().flat_map(|slot| slot.media_clips()).collect();
    for track in &project.timeline.tracks {
        for clip in &track.clips {
            match &clip.source {
                ClipSource::Media { media } => {
                    if !filled.contains(&clip.id)
                        && !project.library.iter().any(|asset| &asset.id == media)
                    {
                        return Err(invalid(&format!(
                            "clip {} has neither a slot nor material of its own",
                            clip.id
                        )));
                    }
                }
                ClipSource::Generator { generator } => {
                    if !paints(generator) {
                        return Err(invalid(&format!(
                            "clip {} uses a generator this version draws nothing for",
                            clip.id
                        )));
                    }
                }
                // Still refused. A compound clip carries a whole second timeline, and every clip
                // inside it would need the same slot-or-material proof this loop gives the top
                // level. Nothing in the shipped set wants one, so the honest answer is no rather
                // than a check that only looks like it recurses.
                ClipSource::Compound { .. } => {
                    return Err(invalid("a template may not use a compound clip"))
                }
            }
        }
    }
    Ok(())
}

fn exists(project: &Project, clip: &ClipId) -> Result<()> {
    match find_clip(project, clip) {
        Some(_) => Ok(()),
        None => Err(CoreError::ClipNotFound(clip.clone())),
    }
}

fn fit_bounded(fit: &Fit) -> Result<()> {
    for value in [fit.x, fit.y, fit.width, fit.height] {
        finite(value)?;
    }
    if fit.width <= 0.0 || fit.height <= 0.0 {
        return Err(invalid("a fit rectangle needs a positive width and height"));
    }
    Ok(())
}

fn apply(project: &mut Project, slot: &Slot, answer: &SlotAnswer, frame: Frame) -> Result<()> {
    match (slot.kind, answer) {
        (SlotKind::Media, SlotAnswer::Media { asset }) => fill_media(project, slot, asset, frame),
        (SlotKind::Text, SlotAnswer::Text { text }) => {
            for binding in &slot.bindings {
                match binding {
                    SlotBinding::ProjectTitle => project.meta.title = text.clone(),
                    SlotBinding::ClipLabel { clip } => {
                        if let Some(found) = find_clip_mut(project, clip) {
                            found.label = Some(text.clone());
                        }
                    }
                    SlotBinding::GeneratorText { clip } => {
                        if let Some(Generator::Text { content, .. }) =
                            generator_of_mut(project, clip)
                        {
                            *content = text.clone();
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        (SlotKind::Color, SlotAnswer::Color { color }) => {
            // Not checked here: `Project::normalize` at the end of bake is the one place a colour
            // is judged, so a hand-written project.json and a wizard answer cannot disagree.
            for binding in &slot.bindings {
                match binding {
                    SlotBinding::Background => project.settings.background = color.clone(),
                    SlotBinding::GeneratorColor { clip } => {
                        if let Some(generator) = generator_of_mut(project, clip) {
                            recolour(generator, color);
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        _ => Err(invalid(&format!(
            "slot {} was answered with the wrong kind of value",
            slot.id
        ))),
    }
}

fn fill_media(project: &mut Project, slot: &Slot, asset: &MediaAsset, frame: Frame) -> Result<()> {
    let (Some(width), Some(height)) = (asset.width, asset.height) else {
        return Err(invalid(&format!(
            "slot {} needs material with a picture",
            slot.id
        )));
    };
    if !project.library.iter().any(|entry| entry.id == asset.id) {
        project.library.push(asset.clone());
    }

    let placements: Vec<(ClipId, Fit)> = slot
        .bindings
        .iter()
        .filter_map(|binding| match binding {
            SlotBinding::ClipMedia { clip, fit } => Some((clip.clone(), *fit)),
            _ => None,
        })
        .collect();

    for (id, fit) in placements {
        let media = asset.id.clone();
        let available = asset.duration;
        let Some(clip) = find_clip_mut(project, &id) else {
            return Err(CoreError::ClipNotFound(id));
        };
        clip.source = ClipSource::Media { media };
        let rate = speed_for(clip, available)?;
        clip.speed.rate = rate;
        clip.transform = fit_transform(&clip.transform, &fit, (width, height), frame);
    }
    Ok(())
}

// A slot's rhythm is the template, so a file that is too short is slowed rather than shortened:
// shortening the clip would leave a hole where the next transition expects a picture, and moving
// the clips after it would be a different template than the gallery showed. Material at or past
// the length the slot wants runs at its own speed and the rest of it is simply not used.
fn speed_for(clip: &Clip, available: Option<Time>) -> Result<f32> {
    let Some(available) = available else {
        return Ok(clip.speed.rate);
    };
    let usable = (available - clip.in_point).as_flicks();
    let wanted = clip.duration.as_flicks();
    if usable <= 0 || wanted <= 0 {
        return Err(invalid(
            "this material starts after the slot it should fill",
        ));
    }
    if usable >= (wanted as f64 * clip.speed.rate as f64) as i64 {
        return Ok(clip.speed.rate);
    }
    let rate = usable as f32 / wanted as f32;
    if rate < MIN_STRETCH_RATE {
        return Err(invalid(
            "this material is too short for the slot, even slowed down",
        ));
    }
    Ok(rate)
}

// Scale and position only. Rotation, opacity, crop and the anchor stay as the template authored
// them, so a fit cannot quietly undo an authored look.
fn fit_transform(base: &Transform, fit: &Fit, source: (u32, u32), frame: Frame) -> Transform {
    let frame_width = frame.width as f32;
    let frame_height = frame.height as f32;
    let box_width = fit.width * frame_width;
    let box_height = fit.height * frame_height;
    let by_width = box_width / source.0 as f32;
    let by_height = box_height / source.1 as f32;
    let scale = match fit.mode {
        FitMode::Cover => by_width.max(by_height),
        FitMode::Contain => by_width.min(by_height),
    };
    Transform {
        // Project pixels from the centre of the frame, the units `draw-list.ts` defines.
        x: (fit.x + fit.width / 2.0) * frame_width - frame_width / 2.0,
        y: (fit.y + fit.height / 2.0) * frame_height - frame_height / 2.0,
        scale_x: scale,
        scale_y: scale,
        ..base.clone()
    }
}

fn drop_clips(project: &mut Project, ids: &BTreeSet<ClipId>) {
    if ids.is_empty() {
        return;
    }
    for track in &mut project.timeline.tracks {
        track.clips.retain(|clip| !ids.contains(&clip.id));
    }
}

fn generator_of<'p>(project: &'p Project, id: &ClipId) -> Option<&'p Generator> {
    match &find_clip(project, id)?.source {
        ClipSource::Generator { generator } => Some(generator),
        _ => None,
    }
}

fn generator_of_mut<'p>(project: &'p mut Project, id: &ClipId) -> Option<&'p mut Generator> {
    match &mut find_clip_mut(project, id)?.source {
        ClipSource::Generator { generator } => Some(generator),
        _ => None,
    }
}

// The shapes the renderer draws, which is the same list `paintsGenerator` in generator.ts carries. A
// shape name is a free string in the model, so an unknown one is a clip nothing draws and has to be
// refused here rather than found on a blank screen.
const DRAWN_SHAPES: [&str; 5] = ["rectangle", "square", "ellipse", "circle", "triangle"];

// Which generators the renderer actually puts on a screen. A clip whose generator is not on that
// list is dropped from the draw list without a word, so a template built on one would look complete
// in the timeline and be blank on the screen.
pub(crate) fn paints(generator: &Generator) -> bool {
    match generator {
        Generator::Text { .. }
        | Generator::Solid { .. }
        | Generator::Gradient { .. }
        | Generator::Countdown { .. } => true,
        Generator::Shape { shape, .. } => DRAWN_SHAPES.contains(&shape.as_str()),
    }
}

// Not every generator that paints has a colour a person would call *its* colour. A solid's fill, the
// stop a gradient starts from, the ink of a title and a shape's fill are one each; a countdown's
// number is drawn in the one colour the renderer gives it, and offering a colour slot for it would
// be a control that does nothing.
fn recolourable(generator: &Generator) -> bool {
    !matches!(generator, Generator::Countdown { .. }) && paints(generator)
}

fn recolour(generator: &mut Generator, color: &str) {
    match generator {
        Generator::Solid { color: fill } => *fill = color.to_string(),
        Generator::Gradient { from, .. } => *from = color.to_string(),
        Generator::Text { style, .. } => {
            style.insert("color".into(), json!(color));
        }
        Generator::Shape { color: fill, .. } => *fill = color.to_string(),
        Generator::Countdown { .. } => {}
    }
}

fn find_clip<'p>(project: &'p Project, id: &ClipId) -> Option<&'p Clip> {
    project
        .timeline
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .find(|clip| &clip.id == id)
}

fn find_clip_mut<'p>(project: &'p mut Project, id: &ClipId) -> Option<&'p mut Clip> {
    project
        .timeline
        .tracks
        .iter_mut()
        .flat_map(|track| &mut track.clips)
        .find(|clip| &clip.id == id)
}

fn used_media(project: &Project) -> Vec<MediaId> {
    let mut seen = Vec::new();
    for track in &project.timeline.tracks {
        for clip in &track.clips {
            if let ClipSource::Media { media } = &clip.source {
                if !seen.contains(media) {
                    seen.push(media.clone());
                }
            }
        }
    }
    seen
}

fn clips_using(project: &Project, media: &MediaId) -> Vec<ClipId> {
    project
        .timeline
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .filter(|clip| matches!(&clip.source, ClipSource::Media { media: id } if id == media))
        .map(|clip| clip.id.clone())
        .collect()
}

fn generator_clips(project: &Project) -> Vec<(ClipId, &Generator)> {
    project
        .timeline
        .tracks
        .iter()
        .flat_map(|track| &track.clips)
        .filter_map(|clip| match &clip.source {
            ClipSource::Generator { generator } => Some((clip.id.clone(), generator)),
            _ => None,
        })
        .collect()
}

// A hint is one line in a wizard panel. A title over three lines, or one long enough to push the
// field off the panel, would make the hint the loudest thing about the question it explains.
fn first_line(content: &str) -> String {
    let line = content.lines().next().unwrap_or("").trim();
    match line.char_indices().nth(48) {
        Some((cut, _)) => format!("{}…", &line[..cut]),
        None => line.to_string(),
    }
}

fn original_name(project: &Project, media: &MediaId) -> String {
    project
        .library
        .iter()
        .find(|asset| &asset.id == media)
        .map(|asset| asset.original_name.clone())
        .unwrap_or_default()
}

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn invalid(message: &str) -> CoreError {
    CoreError::InvalidArgument(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{MediaKind, Track, TrackKind};

    fn asset(seconds: f64, width: u32, height: u32) -> MediaAsset {
        let mut asset = MediaAsset::new(
            MediaId::from(format!("med_{width}x{height}x{seconds}")),
            "shot.mp4".into(),
            "video/mp4".into(),
            MediaKind::Video,
            1_000,
        );
        asset.duration = Some(Time::from_seconds(seconds));
        asset.width = Some(width);
        asset.height = Some(height);
        asset
    }

    fn media_answer(seconds: f64, width: u32, height: u32) -> SlotAnswer {
        SlotAnswer::Media {
            asset: asset(seconds, width, height),
        }
    }

    fn answers(pairs: &[(&str, SlotAnswer)]) -> BTreeMap<String, SlotAnswer> {
        pairs
            .iter()
            .map(|(id, answer)| ((*id).to_string(), answer.clone()))
            .collect()
    }

    fn one_slot_template() -> Template {
        let mut clip = Clip::new_media(
            MediaId::from("med_slot".to_string()),
            Time::ZERO,
            Time::from_seconds(2.0),
        );
        clip.id = ClipId::from("clp_a".to_string());
        let mut track = Track::new(TrackKind::Video, "V1".into());
        track.clips.push(clip);
        let mut project = Project::default();
        project.timeline.tracks.push(track);

        Template {
            manifest: TemplateManifest {
                schema_version: TEMPLATE_SCHEMA_VERSION,
                id: "one".into(),
                version: 1,
                name: Localized::same("One"),
                description: Localized::same(""),
                category: "test".into(),
                tags: Vec::new(),
                aspect_ratios: vec![Frame {
                    width: 1920,
                    height: 1080,
                }],
                poster_at: None,
                slots: vec![Slot {
                    id: "shot".into(),
                    kind: SlotKind::Media,
                    label: Localized::same("Shot"),
                    hint: Localized::same(""),
                    required: true,
                    bindings: vec![SlotBinding::ClipMedia {
                        clip: ClipId::from("clp_a".to_string()),
                        fit: Fit::full_frame(),
                    }],
                }],
                steps: vec![Step {
                    title: Localized::same("Shots"),
                    slots: vec!["shot".into()],
                }],
            },
            project,
        }
    }

    #[test]
    fn a_baked_project_carries_the_answered_material_not_the_placeholder() {
        let template = one_slot_template();
        let answer = media_answer(4.0, 1920, 1080);
        let SlotAnswer::Media { asset: given } = answer.clone() else {
            unreachable!()
        };

        let baked = template.bake(&answers(&[("shot", answer)]), None).unwrap();

        let clip = &baked.timeline.tracks[0].clips[0];
        assert_eq!(clip.source, ClipSource::Media { media: given.id });
        assert_eq!(baked.library.len(), 1);
    }

    #[test]
    fn the_answered_title_and_colour_reach_the_project() {
        let mut template = one_slot_template();
        template.manifest.slots.push(Slot {
            id: "title".into(),
            kind: SlotKind::Text,
            label: Localized::same("Title"),
            hint: Localized::same(""),
            required: false,
            bindings: vec![
                SlotBinding::ProjectTitle,
                SlotBinding::ClipLabel {
                    clip: ClipId::from("clp_a".to_string()),
                },
            ],
        });
        template.manifest.slots.push(Slot {
            id: "colour".into(),
            kind: SlotKind::Color,
            label: Localized::same("Colour"),
            hint: Localized::same(""),
            required: false,
            bindings: vec![SlotBinding::Background],
        });
        template.manifest.steps[0]
            .slots
            .extend(["title".to_string(), "colour".to_string()]);
        template.normalize().unwrap();

        let baked = template
            .bake(
                &answers(&[
                    ("shot", media_answer(4.0, 1920, 1080)),
                    (
                        "title",
                        SlotAnswer::Text {
                            text: "Sommer 2026".into(),
                        },
                    ),
                    (
                        "colour",
                        SlotAnswer::Color {
                            color: "#1188ff".into(),
                        },
                    ),
                ]),
                None,
            )
            .unwrap();

        assert_eq!(baked.meta.title, "Sommer 2026");
        assert_eq!(baked.settings.background, "#1188ff");
        assert_eq!(
            baked.timeline.tracks[0].clips[0].label.as_deref(),
            Some("Sommer 2026")
        );
    }

    // The bake test that would pass on any project at all is the one worth guarding against: a
    // wrong scale is still "a project came out".
    #[test]
    fn material_smaller_than_the_frame_is_scaled_up_to_cover_it() {
        let template = one_slot_template();

        let baked = template
            .bake(&answers(&[("shot", media_answer(4.0, 640, 360))]), None)
            .unwrap();

        let transform = &baked.timeline.tracks[0].clips[0].transform;
        assert_eq!(transform.scale_x, 3.0);
        assert_eq!(transform.scale_y, 3.0);
        assert_eq!(transform.x, 0.0);
        assert_eq!(transform.y, 0.0);
    }

    // The whole reason a template can offer both orientations: landscape material in a portrait
    // frame has to be scaled by the *height*, not by the width, or it sits in a letterbox.
    #[test]
    fn cover_in_a_portrait_frame_scales_by_the_taller_edge() {
        let template = one_slot_template();
        let portrait = ProjectSettings {
            width: 1080,
            height: 1920,
            ..ProjectSettings::default()
        };

        let baked = template
            .bake(
                &answers(&[("shot", media_answer(4.0, 1920, 1080))]),
                Some(&portrait),
            )
            .unwrap();

        // 1920/1920 = 1 by width, 1920/1080 = 1.777… by height. Cover takes the larger.
        assert_eq!(
            baked.timeline.tracks[0].clips[0].transform.scale_x,
            1920.0 / 1080.0
        );
    }

    #[test]
    fn contain_fits_inside_an_inset_box_and_lands_on_its_centre() {
        let mut template = one_slot_template();
        template.manifest.slots[0].bindings = vec![SlotBinding::ClipMedia {
            clip: ClipId::from("clp_a".to_string()),
            fit: Fit::inset(0.5, 0.0, 0.5, 0.5),
        }];

        let baked = template
            .bake(&answers(&[("shot", media_answer(4.0, 1920, 1080))]), None)
            .unwrap();

        let transform = &baked.timeline.tracks[0].clips[0].transform;
        // Box is 960x540; the material is exactly half that in both directions.
        assert_eq!(transform.scale_x, 0.5);
        // Centre of the top right quarter of a 1920x1080 frame.
        assert_eq!(transform.x, 480.0);
        assert_eq!(transform.y, -270.0);
    }

    // Flicks are frame-rate independent by construction; this holds that construction to it, since
    // the whole reason a template may be baked at another rate is that its rhythm must not move.
    #[test]
    fn baking_at_another_frame_rate_moves_no_clip_by_a_single_flick() {
        let template = one_slot_template();
        let at = |fps| {
            let settings = ProjectSettings {
                fps: crate::model::Rate::from_fps(fps),
                ..ProjectSettings::default()
            };
            template
                .bake(
                    &answers(&[("shot", media_answer(4.0, 1920, 1080))]),
                    Some(&settings),
                )
                .unwrap()
        };

        let thirty = at(30);
        let twentyfive = at(25);

        let flicks = |project: &Project| {
            project.timeline.tracks[0]
                .clips
                .iter()
                .map(|clip| (clip.start.as_flicks(), clip.duration.as_flicks()))
                .collect::<Vec<_>>()
        };
        assert_eq!(flicks(&thirty), flicks(&twentyfive));
        assert_eq!(twentyfive.settings.fps, crate::model::Rate::from_fps(25));
    }

    #[test]
    fn material_shorter_than_the_slot_is_slowed_rather_than_leaving_a_hole() {
        let template = one_slot_template();

        let baked = template
            .bake(&answers(&[("shot", media_answer(1.0, 1920, 1080))]), None)
            .unwrap();

        let clip = &baked.timeline.tracks[0].clips[0];
        assert_eq!(clip.speed.rate, 0.5);
        assert_eq!(clip.duration, Time::from_seconds(2.0));
    }

    #[test]
    fn material_far_too_short_is_refused_instead_of_frozen() {
        let template = one_slot_template();

        let error = template
            .bake(&answers(&[("shot", media_answer(0.4, 1920, 1080))]), None)
            .unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn material_longer_than_the_slot_plays_at_its_own_speed() {
        let template = one_slot_template();

        let baked = template
            .bake(&answers(&[("shot", media_answer(30.0, 1920, 1080))]), None)
            .unwrap();

        assert_eq!(baked.timeline.tracks[0].clips[0].speed.rate, 1.0);
    }

    #[test]
    fn a_required_slot_without_an_answer_stops_the_bake() {
        let template = one_slot_template();

        let error = template.bake(&BTreeMap::new(), None).unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn an_unanswered_optional_media_slot_takes_its_clip_with_it() {
        let mut template = one_slot_template();
        template.manifest.slots[0].required = false;

        let baked = template.bake(&BTreeMap::new(), None).unwrap();

        assert!(baked.timeline.tracks[0].clips.is_empty());
    }

    #[test]
    fn material_without_a_picture_cannot_fill_a_media_slot() {
        let template = one_slot_template();
        let mut sound = asset(10.0, 1920, 1080);
        sound.kind = MediaKind::Audio;
        sound.width = None;
        sound.height = None;

        let error = template
            .bake(
                &answers(&[("shot", SlotAnswer::Media { asset: sound })]),
                None,
            )
            .unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn an_answer_of_the_wrong_kind_is_refused() {
        let template = one_slot_template();

        let error = template
            .bake(
                &answers(&[(
                    "shot",
                    SlotAnswer::Text {
                        text: "not a video".into(),
                    },
                )]),
                None,
            )
            .unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn a_baked_project_says_which_template_it_came_from_and_is_its_own_project() {
        let template = one_slot_template();

        let baked = template
            .bake(&answers(&[("shot", media_answer(4.0, 1920, 1080))]), None)
            .unwrap();
        let again = template
            .bake(&answers(&[("shot", media_answer(4.0, 1920, 1080))]), None)
            .unwrap();

        assert_eq!(baked.extra["template"]["id"], "one");
        assert_ne!(baked.meta.id, again.meta.id);
    }

    #[test]
    fn a_baked_project_still_passes_the_ordinary_load_gate() {
        let template = one_slot_template();
        let mut baked = template
            .bake(&answers(&[("shot", media_answer(4.0, 1920, 1080))]), None)
            .unwrap();

        assert!(baked.normalize().is_ok());
    }

    // A colour that reaches the compositor as garbage is silently drawn as black. Bake ends in
    // `Project::normalize`, so this is the same gate a hand-written project.json meets.
    #[test]
    fn a_colour_answer_that_is_not_a_colour_is_refused() {
        let mut template = one_slot_template();
        template.manifest.slots.push(Slot {
            id: "colour".into(),
            kind: SlotKind::Color,
            label: Localized::same("Colour"),
            hint: Localized::same(""),
            required: false,
            bindings: vec![SlotBinding::Background],
        });
        template.manifest.steps[0].slots.push("colour".into());

        let error = template
            .bake(
                &answers(&[
                    ("shot", media_answer(4.0, 1920, 1080)),
                    (
                        "colour",
                        SlotAnswer::Color {
                            color: "chartreuse".into(),
                        },
                    ),
                ]),
                None,
            )
            .unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn a_template_settings_override_meets_the_same_bounds_a_project_does() {
        let template = one_slot_template();
        let broken = ProjectSettings {
            width: 0,
            ..ProjectSettings::default()
        };

        let error = template
            .bake(
                &answers(&[("shot", media_answer(4.0, 1920, 1080))]),
                Some(&broken),
            )
            .unwrap_err();

        assert!(matches!(error, CoreError::InvalidArgument(_)));
    }

    #[test]
    fn a_valid_template_passes_its_own_gate() {
        assert!(one_slot_template().normalize().is_ok());
    }

    #[test]
    fn a_binding_naming_a_clip_that_is_not_there_is_refused() {
        let mut template = one_slot_template();
        template.manifest.slots[0].bindings = vec![SlotBinding::ClipMedia {
            clip: ClipId::from("clp_nope".to_string()),
            fit: Fit::full_frame(),
        }];

        assert!(matches!(
            template.normalize(),
            Err(CoreError::ClipNotFound(_))
        ));
    }

    #[test]
    fn a_colour_slot_cannot_be_bound_to_a_clip() {
        let mut template = one_slot_template();
        template.manifest.slots[0].kind = SlotKind::Color;

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // The two bindings that make a template look like the person who filled it in. Both are checked
    // against the clip's actual generator rather than merely against a clip that exists: a text
    // answer written into a solid colour would vanish without a word, and the wizard would have
    // asked a question whose answer goes nowhere.
    fn generator_template(generator: Generator) -> Template {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();
        template.project.timeline.tracks[0].clips[0].source = ClipSource::Generator { generator };
        template
    }

    fn with_slot(mut template: Template, kind: SlotKind, binding: SlotBinding) -> Template {
        template.manifest.slots.push(Slot {
            id: "answer".into(),
            kind,
            label: Localized::same("Answer"),
            hint: Localized::same(""),
            required: false,
            bindings: vec![binding],
        });
        template.manifest.steps[0].slots.push("answer".into());
        template
    }

    #[test]
    fn a_text_slot_bound_to_a_text_generator_is_accepted_and_writes_its_words_in() {
        let mut template = with_slot(
            generator_template(Generator::Text {
                content: "shipped words".into(),
                style: BTreeMap::new(),
            }),
            SlotKind::Text,
            SlotBinding::GeneratorText {
                clip: ClipId::from("clp_a".to_string()),
            },
        );
        assert!(template.normalize().is_ok());

        let baked = template
            .bake(
                &answers(&[(
                    "answer",
                    SlotAnswer::Text {
                        text: "my words".into(),
                    },
                )]),
                None,
            )
            .unwrap();

        let ClipSource::Generator {
            generator: Generator::Text { content, .. },
        } = &baked.timeline.tracks[0].clips[0].source
        else {
            unreachable!()
        };
        assert_eq!(content, "my words");
    }

    #[test]
    fn a_text_slot_bound_to_a_generator_that_draws_no_words_is_refused() {
        let mut template = with_slot(
            generator_template(Generator::Solid {
                color: "#ff0000".into(),
            }),
            SlotKind::Text,
            SlotBinding::GeneratorText {
                clip: ClipId::from("clp_a".to_string()),
            },
        );

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_generator_binding_naming_a_media_clip_is_refused() {
        let mut template = one_slot_template();
        template.manifest.slots.push(Slot {
            id: "words".into(),
            kind: SlotKind::Text,
            label: Localized::same("Words"),
            hint: Localized::same(""),
            required: false,
            bindings: vec![SlotBinding::GeneratorText {
                clip: ClipId::from("clp_a".to_string()),
            }],
        });
        template.manifest.steps[0].slots.push("words".into());

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_colour_answer_reaches_a_solid_and_meets_the_same_gate_a_background_does() {
        let mut template = with_slot(
            generator_template(Generator::Solid {
                color: "#ff0000".into(),
            }),
            SlotKind::Color,
            SlotBinding::GeneratorColor {
                clip: ClipId::from("clp_a".to_string()),
            },
        );
        assert!(template.normalize().is_ok());

        let baked = template
            .bake(
                &answers(&[(
                    "answer",
                    SlotAnswer::Color {
                        color: "#00ff00".into(),
                    },
                )]),
                None,
            )
            .unwrap();
        assert_eq!(
            baked.timeline.tracks[0].clips[0].source,
            ClipSource::Generator {
                generator: Generator::Solid {
                    color: "#00ff00".into()
                }
            }
        );

        // The same colour check `settings.background` meets, because the compositor reads an
        // unparsable generator colour as black just as silently.
        assert!(template
            .bake(
                &answers(&[(
                    "answer",
                    SlotAnswer::Color {
                        color: "chartreuse".into(),
                    },
                )]),
                None,
            )
            .is_err());
    }

    #[test]
    fn a_preview_falls_back_to_the_projects_own_frame_when_a_template_offers_none() {
        let mut template = one_slot_template();
        template.manifest.aspect_ratios.clear();
        template.project.settings.width = 1234;
        template.project.settings.height = 720;

        let preview = template.preview(None).unwrap();

        assert_eq!(preview.settings.width, 1234);
        assert_eq!(preview.settings.height, 720);
    }

    // A preview is a picture, not a document: it must not leave behind a library entry naming
    // material that exists nowhere, because that entry would follow the project if anyone saved it.
    #[test]
    fn a_preview_keeps_no_stand_in_in_the_library() {
        let preview = one_slot_template().preview(None).unwrap();

        assert!(preview.library.is_empty());
        assert!(matches!(
            preview.timeline.tracks[0].clips[0].source,
            ClipSource::Generator { .. }
        ));
    }

    #[test]
    fn a_slot_no_step_asks_about_is_refused() {
        let mut template = one_slot_template();
        template.manifest.steps[0].slots.clear();

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // Asked twice is as wrong as never asked: the second panel would show a field whose answer the
    // first one already took, and whichever one the user fills last silently wins.
    #[test]
    fn a_slot_asked_about_in_two_steps_is_refused() {
        let mut template = one_slot_template();
        let twin = template.manifest.steps[0].clone();
        template.manifest.steps.push(twin);

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_step_naming_a_slot_that_is_not_there_is_refused() {
        let mut template = one_slot_template();
        template.manifest.steps[0].slots.push("ghost".into());

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn two_slots_with_the_same_id_are_refused() {
        let mut template = one_slot_template();
        let twin = template.manifest.slots[0].clone();
        template.manifest.slots.push(twin);

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // The rule against the empty gallery entry, from both sides.
    #[test]
    fn a_clip_with_neither_a_slot_nor_material_is_refused() {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_clip_the_template_brings_its_own_material_for_needs_no_slot() {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();
        let mut own = asset(10.0, 1920, 1080);
        own.id = MediaId::from("med_slot".to_string());
        template.project.library.push(own);

        assert!(template.normalize().is_ok());
    }

    // A generator needs no slot and no library entry: it *is* its own material. This is what lets
    // a template show something before anyone has chosen a file, which is the whole of what a
    // gallery card can honestly be.
    #[test]
    fn a_generator_clip_the_renderer_paints_needs_neither_a_slot_nor_material() {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();
        template.project.timeline.tracks[0].clips[0].source = ClipSource::Generator {
            generator: Generator::Solid {
                color: "#ff0000".into(),
            },
        };

        assert!(template.normalize().is_ok());
    }

    // The half of that rule that has not moved. A shape name is a free string, and one the renderer
    // has no path for is dropped from the draw list without a word -- so a template built on it would
    // look complete in the timeline and be blank on the screen. The named shapes and the countdown
    // are drawn now and are accepted here for that reason and no other.
    #[test]
    fn a_generator_clip_the_renderer_draws_nothing_for_is_still_refused() {
        let refused = Generator::Shape {
            shape: "hexagon".into(),
            color: "#ff0000".into(),
        };
        assert!(matches!(
            with_generator(refused).normalize(),
            Err(CoreError::InvalidArgument(_))
        ));

        for generator in [
            Generator::Shape {
                shape: "circle".into(),
                color: "#ff0000".into(),
            },
            Generator::Countdown { from_seconds: 5 },
        ] {
            assert!(with_generator(generator).normalize().is_ok());
        }
    }

    fn with_generator(generator: Generator) -> Template {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();
        template.project.timeline.tracks[0].clips[0].source = ClipSource::Generator { generator };
        template
    }

    #[test]
    fn a_compound_clip_is_still_refused_because_nothing_proves_what_is_inside_it() {
        let mut template = one_slot_template();
        template.manifest.slots.clear();
        template.manifest.steps[0].slots.clear();
        template.project.timeline.tracks[0].clips[0].source = ClipSource::Compound {
            timeline: Box::default(),
        };

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_template_from_a_newer_schema_is_refused_rather_than_guessed_at() {
        let mut template = one_slot_template();
        template.manifest.schema_version = TEMPLATE_SCHEMA_VERSION + 1;

        assert!(matches!(
            template.normalize(),
            Err(CoreError::UnsupportedSchema(_))
        ));
    }

    #[test]
    fn a_fit_rectangle_of_no_size_is_refused() {
        let mut template = one_slot_template();
        template.manifest.slots[0].bindings = vec![SlotBinding::ClipMedia {
            clip: ClipId::from("clp_a".to_string()),
            fit: Fit::inset(0.0, 0.0, 0.0, 0.5),
        }];

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    // The same 1e300-through-JSON route the project's own bounds are tested by: no f32 literal
    // expresses infinity, and a plain JSON number that downcasts to it is what a hostile file
    // actually carries.
    #[test]
    fn a_non_finite_fit_is_refused() {
        let template = one_slot_template();
        let mut json = serde_json::to_value(&template).unwrap();
        json["manifest"]["slots"][0]["bindings"][0]["fit"]["x"] = serde_json::json!(1e300);
        let mut loaded: Template = serde_json::from_value(json).unwrap();

        assert!(matches!(
            loaded.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn a_template_carrying_a_broken_project_is_refused_by_the_project_gate() {
        let mut template = one_slot_template();
        template.project.timeline.tracks[0].clips[0].speed.rate = 1e30;

        assert!(matches!(
            template.normalize(),
            Err(CoreError::InvalidArgument(_))
        ));
    }

    #[test]
    fn saving_a_project_as_a_template_gives_one_slot_per_medium_and_leaves_the_bytes_behind() {
        let mut project = Project::default();
        project.meta.title = "Urlaub".into();
        let first = asset(5.0, 1920, 1080);
        let second = asset(6.0, 1280, 720);
        project.library.push(first.clone());
        project.library.push(second.clone());
        let mut track = Track::new(TrackKind::Video, "V1".into());
        for (index, media) in [&first, &first, &second].into_iter().enumerate() {
            let mut clip = Clip::new_media(
                media.id.clone(),
                Time::from_seconds(index as f64 * 2.0),
                Time::from_seconds(2.0),
            );
            clip.id = ClipId::from(format!("clp_{index}"));
            track.clips.push(clip);
        }
        project.timeline.tracks.push(track);

        let template = Template::from_project(&project, "mine", None).unwrap();

        assert!(template.project.library.is_empty());
        let media_slots: Vec<&Slot> = template
            .manifest
            .slots
            .iter()
            .filter(|slot| slot.kind == SlotKind::Media)
            .collect();
        assert_eq!(media_slots.len(), 2);
        assert_eq!(media_slots[0].bindings.len(), 2);
        assert_eq!(media_slots[1].bindings.len(), 1);
        assert_eq!(template.manifest.name.de, "Urlaub");
    }

    // Author mode: which clips become questions. What the author can decide, and what they cannot.
    fn project_with_two_titles() -> Project {
        let mut project = Project::default();
        let mut track = Track::new(TrackKind::Text, "T1".into());
        for (id, words) in [("clp_head", "Kopfzeile"), ("clp_foot", "Fusszeile")] {
            let mut clip = Clip::new_generator(
                Generator::Text {
                    content: words.into(),
                    style: BTreeMap::new(),
                },
                Time::ZERO,
                Time::from_seconds(2.0),
            );
            clip.id = ClipId::from(id.to_string());
            clip.start = if id == "clp_foot" {
                Time::from_seconds(2.0)
            } else {
                Time::ZERO
            };
            track.clips.push(clip);
        }
        project.timeline.tracks.push(track);
        project
    }

    fn slot_ids(template: &Template, kind: SlotKind) -> Vec<String> {
        template
            .manifest
            .slots
            .iter()
            .filter(|slot| slot.kind == kind)
            .map(|slot| slot.id.clone())
            .collect()
    }

    #[test]
    fn with_nothing_marked_every_title_in_the_project_becomes_a_question() {
        let template = Template::from_project(&project_with_two_titles(), "mine", None).unwrap();

        // Two titles plus the project's own name.
        assert_eq!(slot_ids(&template, SlotKind::Text).len(), 3);
        assert!(slot_ids(&template, SlotKind::Media).is_empty());
    }

    #[test]
    fn marking_one_clip_leaves_the_other_ones_words_alone() {
        let marked = BTreeSet::from([ClipId::from("clp_head".to_string())]);

        let template =
            Template::from_project(&project_with_two_titles(), "mine", Some(&marked)).unwrap();

        // The marked title and the project name; the unmarked one keeps the words it has, which is
        // legal precisely because a generator is its own material.
        assert_eq!(slot_ids(&template, SlotKind::Text), vec!["text1", "title"]);
        assert_eq!(
            template.manifest.slots[0].bindings,
            vec![SlotBinding::GeneratorText {
                clip: ClipId::from("clp_head".to_string())
            }]
        );
        // And the unanswered one still draws: the gate would refuse it otherwise.
        let baked = template.bake(&BTreeMap::new(), None).unwrap();
        let ClipSource::Generator {
            generator: Generator::Text { content, .. },
        } = &baked.timeline.tracks[0].clips[1].source
        else {
            unreachable!()
        };
        assert_eq!(content, "Fusszeile");
    }

    // The one thing marking cannot decide. The footage does not travel with a template, so a media
    // clip that was not a question would point at material no copy of the file carries.
    #[test]
    fn a_media_clip_is_a_question_whether_it_was_marked_or_not() {
        let mut project = project_with_two_titles();
        let asset = asset(5.0, 1920, 1080);
        project.library.push(asset.clone());
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(asset.id, Time::ZERO, Time::from_seconds(2.0));
        clip.id = ClipId::from("clp_shot".to_string());
        track.clips.push(clip);
        project.timeline.tracks.push(track);
        let marked = BTreeSet::from([ClipId::from("clp_head".to_string())]);

        let template = Template::from_project(&project, "mine", Some(&marked)).unwrap();

        assert_eq!(slot_ids(&template, SlotKind::Media), vec!["media1"]);
        assert!(template.project.library.is_empty());
    }

    #[test]
    fn a_marked_colour_field_becomes_a_colour_question_and_an_unmarked_one_does_not() {
        let mut project = Project::default();
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_generator(
            Generator::Solid {
                color: "#123456".into(),
            },
            Time::ZERO,
            Time::from_seconds(2.0),
        );
        clip.id = ClipId::from("clp_field".to_string());
        track.clips.push(clip);
        project.timeline.tracks.push(track);

        let untouched = Template::from_project(&project, "mine", None).unwrap();
        // Only the background: one colour field per coloured clip would be a wall of questions.
        assert_eq!(slot_ids(&untouched, SlotKind::Color), vec!["background"]);

        let marked = BTreeSet::from([ClipId::from("clp_field".to_string())]);
        let chosen = Template::from_project(&project, "mine", Some(&marked)).unwrap();
        assert_eq!(
            slot_ids(&chosen, SlotKind::Color),
            vec!["colour1", "background"]
        );
    }

    // A project with no footage at all must not open the wizard on a panel with nothing on it.
    #[test]
    fn a_template_made_from_a_project_without_footage_has_no_empty_step() {
        let template = Template::from_project(&project_with_two_titles(), "mine", None).unwrap();

        assert!(template
            .manifest
            .steps
            .iter()
            .all(|step| !step.slots.is_empty()));
        assert_eq!(template.manifest.steps.len(), 2);
    }

    #[test]
    fn a_saved_template_bakes_back_into_a_project_with_the_new_material_in_place() {
        let mut project = Project::default();
        let original = asset(5.0, 1920, 1080);
        project.library.push(original.clone());
        let mut track = Track::new(TrackKind::Video, "V1".into());
        let mut clip = Clip::new_media(original.id.clone(), Time::ZERO, Time::from_seconds(2.0));
        clip.id = ClipId::from("clp_only".to_string());
        track.clips.push(clip);
        project.timeline.tracks.push(track);

        let template = Template::from_project(&project, "mine", None).unwrap();
        let replacement = asset(9.0, 640, 480);
        let baked = template
            .bake(
                &answers(&[(
                    "media1",
                    SlotAnswer::Media {
                        asset: replacement.clone(),
                    },
                )]),
                None,
            )
            .unwrap();

        assert_eq!(
            baked.timeline.tracks[0].clips[0].source,
            ClipSource::Media {
                media: replacement.id
            }
        );
        assert_eq!(baked.library.len(), 1);
    }
}
