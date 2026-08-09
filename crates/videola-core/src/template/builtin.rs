use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{
    Fit, FitMode, Frame, Localized, Slot, SlotBinding, SlotKind, Step, Template, TemplateManifest,
    TEMPLATE_SCHEMA_VERSION,
};
use crate::model::{
    Clip, ClipId, Effect, EffectId, Generator, Interp, Keyframe, MediaId, ParamValue, Project,
    ProjectSettings, Rate, Time, Timeline, Track, TrackId, TrackKind, Transition,
    TransitionAlignment,
};

// There is no footage in this repository and there is not going to be any: a template is a recipe,
// and shipping video with it would make every entry as heavy as the project it came from and would
// put someone else's material in the gallery instead of the template's own idea.
//
// So every template below is built out of what the renderer can draw with nothing but a project
// file: the text generator with its entry, exit and loop moves, solids and gradients, the ten
// effects, the five transitions, masks, and keyframed transforms including a motion path. The
// person's own material arrives through the slots. What a card can honestly show is rhythm,
// typography, colour and movement — and that is exactly what tells someone whether a template is
// any good.
pub fn templates() -> Vec<Template> {
    vec![
        bold_open(),
        iris_open(),
        soft_slideshow(),
        beat_slideshow(),
        story_vertical(),
        split_screen(),
        lower_third(),
        end_card(),
        product_reveal(),
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

// The five categories the gallery groups by. Strings rather than an enum because a template can
// arrive from a file this build has never seen, and a category it does not know has to land
// somewhere rather than fail to load.
pub const INTRO: &str = "intro";
pub const SLIDESHOW: &str = "slideshow";
pub const SOCIAL: &str = "social";
pub const TITLES: &str = "titles";
pub const PRODUCT: &str = "product";

/// A colour field opening onto a shot. What it shows: a title growing in over a gradient, a
/// subtitle rising under it, and the zoom transition handing the frame to the material.
fn bold_open() -> Template {
    let mut back = video_track("trk_back", "V1");
    back.clips.push(gradient_clip(
        "clp_bg",
        0.0,
        3.6,
        "#2f6fed",
        "#101625",
        155.0,
    ));
    let mut shot = placeholder("clp_shot", 3.0, 3.5);
    shot.transition_in = Some(zoom(0.6, 1.45));
    back.clips.push(shot);

    let mut title = text_track("trk_title", "T1");
    title.clips.push(text_clip(
        "clp_title",
        0.3,
        2.9,
        "IHR TITEL\nHIER",
        &[
            ("fontSize", json!(0.135)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.04)),
            ("lineHeight", json!(1.08)),
            ("y", json!(0.42)),
            ("animateIn", json!("grow")),
            ("animateInSeconds", json!(0.6)),
            ("animateOut", json!("fade")),
            ("animateOutSeconds", json!(0.5)),
            ("shadowBlur", json!(0.35)),
            ("shadowY", json!(0.06)),
        ],
    ));

    let mut sub = text_track("trk_sub", "T2");
    sub.clips.push(text_clip(
        "clp_sub",
        0.9,
        2.3,
        "Ein Untertitel, der den Ton setzt",
        &[
            ("fontSize", json!(0.042)),
            ("fontWeight", json!(500)),
            ("letterSpacing", json!(0.22)),
            ("y", json!(0.63)),
            ("color", json!("#ffffffcc")),
            ("animateIn", json!("rise")),
            ("animateInSeconds", json!(0.6)),
            ("animateOut", json!("fade")),
        ],
    ));

    let slots = vec![
        text_slot(
            "title",
            Localized::new("Titel", "Title"),
            Localized::new(
                "Steht groß im Bild und benennt zugleich das Projekt.",
                "Fills the frame, and names the project while it is at it.",
            ),
            vec![generator_text("clp_title"), SlotBinding::ProjectTitle],
        ),
        text_slot(
            "subtitle",
            Localized::new("Untertitel", "Subtitle"),
            Localized::new(
                "Eine Zeile darunter, kleiner und weit gesperrt.",
                "One line underneath, smaller and widely tracked.",
            ),
            vec![generator_text("clp_sub")],
        ),
        media_slot_named(
            "shot",
            Localized::new("Erste Aufnahme", "Opening shot"),
            Localized::new(
                "Übernimmt das Bild, während der Titel herauszoomt.",
                "Takes the frame over as the title zooms away.",
            ),
            "clp_shot",
        ),
        color_slot_named(
            "brand",
            Localized::new("Ihre Farbe", "Your colour"),
            Localized::new(
                "Färbt die Fläche hinter dem Titel.",
                "Colours the field the title stands on.",
            ),
            vec![generator_color("clp_bg"), SlotBinding::Background],
        ),
    ];

    template(
        "bold-open",
        Localized::new("Kraftvoller Auftakt", "Bold Open"),
        Localized::new(
            "Ein Titel wächst über einer Farbfläche auf, ein Untertitel steigt darunter herein, \
             dann übernimmt Ihre erste Aufnahme mit einem Zoom.",
            "A title grows up over a field of colour, a subtitle rises beneath it, then your \
             opening shot takes over with a zoom.",
        ),
        INTRO,
        vec!["titel", "zoom", "farbe"],
        vec![LANDSCAPE, PORTRAIT, SQUARE],
        1.7,
        slots,
        project_with(LANDSCAPE, "#101625", vec![back, title, sub]),
    )
}

/// A circle opening onto the picture. What it shows: a mask whose size is keyframed — the one way
/// this version has of revealing a shot out of a shape rather than out of a fade.
fn iris_open() -> Template {
    let mut back = video_track("trk_back", "V1");
    back.clips
        .push(solid_clip("clp_back", 0.0, 4.6, "#12141b"));

    let mut front = video_track("trk_front", "V2");
    let mut shot = placeholder("clp_shot", 0.0, 4.6);
    shot.effects.push(iris("eff_iris", 0.2, 1.9));
    front.clips.push(shot);

    let mut word = text_track("trk_word", "T1");
    word.clips.push(text_clip(
        "clp_word",
        1.1,
        3.3,
        "AUFGEDECKT",
        &[
            ("fontSize", json!(0.075)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.18)),
            ("y", json!(0.84)),
            ("background", json!("#000000a6")),
            ("padding", json!(0.5)),
            ("animateIn", json!("rise")),
            ("animateOut", json!("fade")),
            ("loop", json!("pulse")),
            ("loopSeconds", json!(2.2)),
        ],
    ));

    let slots = vec![
        media_slot_named(
            "shot",
            Localized::new("Aufnahme", "Shot"),
            Localized::new(
                "Wird von der Mitte her aufgedeckt.",
                "Is uncovered from the middle outwards.",
            ),
            "clp_shot",
        ),
        text_slot(
            "word",
            Localized::new("Schlagwort", "Catchword"),
            Localized::new(
                "Ein kurzes Wort auf dunklem Kasten, das leicht pulsiert.",
                "One short word on a dark box, gently pulsing.",
            ),
            vec![generator_text("clp_word"), SlotBinding::ProjectTitle],
        ),
        color_slot_named(
            "tint",
            Localized::new("Grundton", "Ground colour"),
            Localized::new(
                "Zu sehen, solange der Kreis noch klein ist.",
                "Seen for as long as the circle is still small.",
            ),
            vec![generator_color("clp_back"), SlotBinding::Background],
        ),
    ];

    template(
        "iris-open",
        Localized::new("Blende auf", "Iris Open"),
        Localized::new(
            "Ein Kreis öffnet sich aus der Bildmitte und gibt die Aufnahme frei; ein Schlagwort \
             legt sich unten darüber.",
            "A circle opens out of the middle of the frame and lets the shot through; a catchword \
             settles over the bottom of it.",
        ),
        INTRO,
        vec!["maske", "blende", "wort"],
        vec![LANDSCAPE, SQUARE],
        1.6,
        slots,
        project_with(LANDSCAPE, "#12141b", vec![back, front, word]),
    )
}

const SOFT_STEP: f64 = 2.0;
const SOFT_HOLD: f64 = 2.6;
const SOFT_DISSOLVE: f64 = 0.6;

/// Four pictures, softly handed over. What it shows: the cross dissolve at a length you can feel,
/// a masked band that lifts the words off the picture, and a two-line lower caption that stays put
/// while everything under it changes.
fn soft_slideshow() -> Template {
    let mut lane = video_track("trk_main", "V1");
    for index in 0..4 {
        let mut clip = placeholder(
            &format!("clp_slide{}", index + 1),
            index as f64 * SOFT_STEP,
            SOFT_HOLD,
        );
        if index > 0 {
            clip.transition_in = Some(crossfade(SOFT_DISSOLVE));
        }
        lane.clips.push(clip);
    }
    let total = 3.0 * SOFT_STEP + SOFT_HOLD;

    let mut band = overlay_track("trk_band", "O1");
    let mut bar = solid_clip("clp_band", 0.0, total, "#05070c");
    bar.transform.opacity = 0.82;
    bar.effects
        .push(band_mask("eff_band", 0.5, 0.885, 1.0, 0.30, 0.16));
    band.clips.push(bar);

    let mut kicker = text_track("trk_kicker", "T1");
    kicker.clips.push(text_clip(
        "clp_kicker",
        0.4,
        total - 0.8,
        "REISETAGEBUCH",
        &[
            ("fontSize", json!(0.026)),
            ("fontWeight", json!(700)),
            ("letterSpacing", json!(0.3)),
            ("align", json!("left")),
            ("x", json!(0.06)),
            ("y", json!(0.815)),
            ("maxWidth", json!(0.88)),
            ("color", json!("#8ab4ff")),
            ("animateIn", json!("rise")),
            ("animateOut", json!("fade")),
        ],
    ));

    let mut caption = text_track("trk_caption", "T2");
    caption.clips.push(text_clip(
        "clp_caption",
        0.4,
        total - 0.8,
        "Vier Bilder, eine Geschichte",
        &[
            ("fontSize", json!(0.052)),
            ("fontWeight", json!(650)),
            ("align", json!("left")),
            ("x", json!(0.06)),
            ("y", json!(0.885)),
            ("maxWidth", json!(0.88)),
            ("animateIn", json!("rise")),
            ("animateInSeconds", json!(0.7)),
            ("animateOut", json!("fade")),
        ],
    ));

    let mut slots: Vec<Slot> = (0..4)
        .map(|index| {
            media_slot(
                &format!("slide{}", index + 1),
                index + 1,
                &format!("clp_slide{}", index + 1),
            )
        })
        .collect();
    slots.push(text_slot(
        "caption",
        Localized::new("Bildunterschrift", "Caption"),
        Localized::new(
            "Steht die ganze Zeit unten links auf dem abgedunkelten Streifen.",
            "Sits bottom left on the darkened band for the whole run.",
        ),
        vec![generator_text("clp_caption"), SlotBinding::ProjectTitle],
    ));
    slots.push(text_slot(
        "kicker",
        Localized::new("Dachzeile", "Kicker"),
        Localized::new(
            "Die kleine gesperrte Zeile darüber.",
            "The small tracked-out line above it.",
        ),
        vec![generator_text("clp_kicker")],
    ));
    slots.push(color_slot_named(
        "accent",
        Localized::new("Akzentfarbe", "Accent colour"),
        Localized::new("Färbt die Dachzeile.", "Colours the kicker line."),
        vec![generator_color("clp_kicker")],
    ));

    template(
        "soft-slideshow",
        Localized::new("Weiche Diaschau", "Soft Slideshow"),
        Localized::new(
            "Vier Aufnahmen blenden weich ineinander, während unten ein abgedunkelter Streifen \
             Dachzeile und Bildunterschrift trägt.",
            "Four shots dissolve softly into one another while a darkened band along the bottom \
             carries a kicker and a caption.",
        ),
        SLIDESHOW,
        vec!["überblendung", "bildunterschrift", "maske"],
        vec![LANDSCAPE, SQUARE, PORTRAIT],
        3.1,
        slots,
        project_with(LANDSCAPE, "#05070c", vec![lane, band, kicker, caption]),
    )
}

const BEAT_STEP: f64 = 0.75;
const BEAT_HOLD: f64 = 1.0;
const BEAT_WIPE: f64 = 0.25;

/// Five pictures on a short beat. What it shows: the wipe, and that its angle is a parameter — each
/// hand-over comes from a different edge, which is the difference between a transition and a tic.
fn beat_slideshow() -> Template {
    let mut lane = video_track("trk_main", "V1");
    let angles = [0.0, 90.0, 180.0, 270.0];
    for index in 0..5 {
        let mut clip = placeholder(
            &format!("clp_beat{}", index + 1),
            index as f64 * BEAT_STEP,
            BEAT_HOLD,
        );
        if index > 0 {
            clip.transition_in = Some(wipe(BEAT_WIPE, angles[(index - 1) % angles.len()]));
        }
        lane.clips.push(clip);
    }
    let total = 4.0 * BEAT_STEP + BEAT_HOLD;

    let mut word = text_track("trk_word", "T1");
    word.clips.push(text_clip(
        "clp_word",
        0.0,
        total,
        "IM TAKT",
        &[
            ("fontSize", json!(0.05)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.34)),
            ("y", json!(0.09)),
            ("strokeWidth", json!(0.02)),
            ("shadowBlur", json!(0.3)),
            ("animateIn", json!("fade")),
            ("animateInSeconds", json!(0.3)),
            ("loop", json!("pulse")),
            ("loopSeconds", json!(0.75)),
        ],
    ));

    let mut slots: Vec<Slot> = (0..5)
        .map(|index| {
            media_slot(
                &format!("beat{}", index + 1),
                index + 1,
                &format!("clp_beat{}", index + 1),
            )
        })
        .collect();
    slots.push(text_slot(
        "word",
        Localized::new("Kopfzeile", "Header"),
        Localized::new(
            "Steht oben durch und pulsiert auf dem Takt mit.",
            "Stands across the top and pulses along with the beat.",
        ),
        vec![generator_text("clp_word"), SlotBinding::ProjectTitle],
    ));
    slots.push(color_slot_named(
        "ink",
        Localized::new("Schriftfarbe", "Ink"),
        Localized::new(
            "Färbt die Kopfzeile.",
            "Colours the header.",
        ),
        vec![generator_color("clp_word")],
    ));

    template(
        "beat-slideshow",
        Localized::new("Im Takt", "On the Beat"),
        Localized::new(
            "Fünf kurze Einstellungen, jede von einer anderen Seite hereingewischt, unter einer \
             mitpulsierenden Kopfzeile.",
            "Five short takes, each wiped in from a different edge, under a header pulsing along \
             with them.",
        ),
        SLIDESHOW,
        vec!["wisch", "schnell", "takt"],
        vec![LANDSCAPE, PORTRAIT, SQUARE],
        1.15,
        slots,
        project_with(LANDSCAPE, "#000000", vec![lane, word]),
    )
}

const STORY_STEP: f64 = 2.0;
const STORY_HOLD: f64 = 2.4;

/// Three shots upright. What it shows: the slide transition, the fit filling a 9:16 frame with
/// landscape material instead of putting it in bars, and a headline on its own box.
fn story_vertical() -> Template {
    let mut lane = video_track("trk_main", "V1");
    for index in 0..3 {
        let mut clip = placeholder(
            &format!("clp_story{}", index + 1),
            index as f64 * STORY_STEP,
            STORY_HOLD,
        );
        if index > 0 {
            clip.transition_in = Some(slide(0.4, 90.0));
        }
        lane.clips.push(clip);
    }
    let total = 2.0 * STORY_STEP + STORY_HOLD;

    let mut hook = text_track("trk_hook", "T1");
    hook.clips.push(text_clip(
        "clp_hook",
        0.2,
        total - 0.4,
        "Das müssen Sie sehen",
        &[
            ("fontSize", json!(0.048)),
            ("fontWeight", json!(750)),
            ("y", json!(0.13)),
            ("maxWidth", json!(0.84)),
            ("background", json!("#101625d9")),
            ("padding", json!(0.5)),
            ("animateIn", json!("rise")),
            ("animateOut", json!("fade")),
        ],
    ));

    let mut call = text_track("trk_call", "T2");
    call.clips.push(text_clip(
        "clp_call",
        total - 2.2,
        2.2,
        "JETZT ANSEHEN",
        &[
            ("fontSize", json!(0.036)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.16)),
            ("y", json!(0.9)),
            ("color", json!("#ffd166")),
            ("shadowBlur", json!(0.4)),
            ("animateIn", json!("grow")),
            ("loop", json!("pulse")),
            ("loopSeconds", json!(1.1)),
        ],
    ));

    let mut slots: Vec<Slot> = (0..3)
        .map(|index| {
            media_slot(
                &format!("story{}", index + 1),
                index + 1,
                &format!("clp_story{}", index + 1),
            )
        })
        .collect();
    slots.push(text_slot(
        "hook",
        Localized::new("Aufhänger", "Hook"),
        Localized::new(
            "Die erste Zeile, die jemand liest — auf einem eigenen Kasten oben.",
            "The first line anyone reads, on a box of its own at the top.",
        ),
        vec![generator_text("clp_hook"), SlotBinding::ProjectTitle],
    ));
    slots.push(text_slot(
        "call",
        Localized::new("Aufforderung", "Call to action"),
        Localized::new(
            "Erscheint am Ende unten und pulsiert.",
            "Turns up at the end along the bottom, pulsing.",
        ),
        vec![generator_text("clp_call")],
    ));
    slots.push(color_slot_named(
        "ink",
        Localized::new("Farbe der Aufforderung", "Call colour"),
        Localized::new(
            "Färbt die Schrift der Aufforderung.",
            "Colours the letters of the call to action.",
        ),
        vec![generator_color("clp_call")],
    ));

    template(
        "story-vertical",
        Localized::new("Hochkant-Story", "Vertical Story"),
        Localized::new(
            "Drei Aufnahmen hochkant, seitlich ineinandergeschoben, mit Aufhänger oben und \
             pulsierender Aufforderung am Schluss. Querformat-Material wird eingepasst statt \
             in Balken gelegt.",
            "Three upright shots slid sideways into one another, with a hook at the top and a \
             pulsing call to action at the end. Landscape material is fitted rather than barred.",
        ),
        SOCIAL,
        vec!["hochkant", "schieber", "aufforderung"],
        vec![PORTRAIT, SQUARE],
        1.3,
        slots,
        project_with(PORTRAIT, "#101625", vec![lane, hook, call]),
    )
}

/// Two pictures, one frame. What it shows: a cover fit into half the frame and a rectangular mask
/// holding it there — the pair is what makes a split that has no seam.
fn split_screen() -> Template {
    let mut upper = video_track("trk_top", "V1");
    let mut top = placeholder("clp_top", 0.0, 5.0);
    top.effects
        .push(band_mask("eff_top", 0.5, 0.25, 1.0, 0.5, 0.0));
    upper.clips.push(top);

    let mut lower = video_track("trk_bottom", "V2");
    let mut bottom = placeholder("clp_bottom", 0.0, 5.0);
    bottom
        .effects
        .push(band_mask("eff_bottom", 0.5, 0.75, 1.0, 0.5, 0.0));
    lower.clips.push(bottom);

    let mut middle = text_track("trk_word", "T1");
    middle.clips.push(text_clip(
        "clp_word",
        0.0,
        5.0,
        "ODER",
        &[
            ("fontSize", json!(0.07)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.1)),
            ("y", json!(0.5)),
            ("background", json!("#101625")),
            ("padding", json!(0.45)),
            ("animateIn", json!("grow")),
            ("animateInSeconds", json!(0.4)),
            ("loop", json!("pulse")),
            ("loopSeconds", json!(1.6)),
        ],
    ));

    let slots = vec![
        media_slot_named(
            "top",
            Localized::new("Obere Hälfte", "Upper half"),
            Localized::new(
                "Füllt die obere Bildhälfte randlos.",
                "Fills the upper half of the frame edge to edge.",
            ),
            "clp_top",
        )
        .with_fit(Fit {
            mode: FitMode::Cover,
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 0.5,
        }),
        media_slot_named(
            "bottom",
            Localized::new("Untere Hälfte", "Lower half"),
            Localized::new(
                "Füllt die untere Bildhälfte randlos.",
                "Fills the lower half of the frame edge to edge.",
            ),
            "clp_bottom",
        )
        .with_fit(Fit {
            mode: FitMode::Cover,
            x: 0.0,
            y: 0.5,
            width: 1.0,
            height: 0.5,
        }),
        text_slot(
            "word",
            Localized::new("Wort in der Mitte", "Word between"),
            Localized::new(
                "Sitzt auf der Naht zwischen beiden Hälften.",
                "Sits on the seam between the two halves.",
            ),
            vec![generator_text("clp_word"), SlotBinding::ProjectTitle],
        ),
        color_slot_named(
            "ink",
            Localized::new("Schriftfarbe", "Ink"),
            Localized::new(
                "Färbt das Wort in der Mitte.",
                "Colours the word between the halves.",
            ),
            vec![generator_color("clp_word")],
        ),
    ];

    template(
        "split-screen",
        Localized::new("Geteiltes Bild", "Split Screen"),
        Localized::new(
            "Zwei Aufnahmen übereinander, jede randlos in ihrer Hälfte, dazwischen ein Wort auf \
             der Naht.",
            "Two shots one above the other, each filling its half edge to edge, with a word on \
             the seam between them.",
        ),
        SOCIAL,
        vec!["maske", "vergleich", "hochkant"],
        vec![PORTRAIT, SQUARE],
        2.1,
        slots,
        project_with(PORTRAIT, "#101625", vec![upper, lower, middle]),
    )
}

/// A name and a role over a shot. What it shows: a bar that slides in because its *mask* moves, not
/// the clip — and two lines timed a fraction apart so they read as one gesture rather than a jump.
fn lower_third() -> Template {
    let mut lane = video_track("trk_main", "V1");
    lane.clips.push(placeholder("clp_shot", 0.0, 6.0));

    let mut band = overlay_track("trk_band", "O1");
    let mut bar = gradient_clip("clp_bar", 0.6, 4.2, "#2f6fed", "#101625", 0.0);
    let mut mask = band_mask("eff_bar", 0.30, 0.80, 0.56, 0.14, 0.0);
    mask.keyframes.insert(
        "centerX".into(),
        vec![float_key(0.6, -0.30), float_key(1.15, 0.30)],
    );
    bar.effects.push(mask);
    band.clips.push(bar);

    let mut name = text_track("trk_name", "T1");
    name.clips.push(text_clip(
        "clp_name",
        0.85,
        3.9,
        "Ihr Name",
        &[
            ("fontSize", json!(0.052)),
            ("fontWeight", json!(700)),
            ("align", json!("left")),
            ("x", json!(0.06)),
            ("y", json!(0.775)),
            ("maxWidth", json!(0.5)),
            ("animateIn", json!("rise")),
            ("animateInSeconds", json!(0.4)),
            ("animateOut", json!("fade")),
        ],
    ));

    let mut role = text_track("trk_role", "T2");
    role.clips.push(text_clip(
        "clp_role",
        1.0,
        3.75,
        "WAS SIE TUN",
        &[
            ("fontSize", json!(0.03)),
            ("fontWeight", json!(600)),
            ("letterSpacing", json!(0.18)),
            ("align", json!("left")),
            ("x", json!(0.06)),
            ("y", json!(0.842)),
            ("maxWidth", json!(0.5)),
            ("color", json!("#dbe4f5")),
            ("animateIn", json!("rise")),
            ("animateInSeconds", json!(0.5)),
            ("animateOut", json!("fade")),
        ],
    ));

    let slots = vec![
        media_slot_named(
            "shot",
            Localized::new("Aufnahme", "Shot"),
            Localized::new(
                "Läuft durch, während die Bauchbinde kommt und geht.",
                "Runs throughout while the lower third comes and goes.",
            ),
            "clp_shot",
        ),
        text_slot(
            "name",
            Localized::new("Ihr Name", "Name"),
            Localized::new(
                "Die obere, größere Zeile der Bauchbinde.",
                "The upper, larger line of the lower third.",
            ),
            vec![generator_text("clp_name"), SlotBinding::ProjectTitle],
        ),
        text_slot(
            "role",
            Localized::new("Rolle", "Role"),
            Localized::new(
                "Die kleine gesperrte Zeile darunter.",
                "The small tracked-out line beneath it.",
            ),
            vec![generator_text("clp_role")],
        ),
        color_slot_named(
            "brand",
            Localized::new("Farbe der Binde", "Bar colour"),
            Localized::new(
                "Färbt den Balken, auf dem die Zeilen liegen.",
                "Colours the bar the lines lie on.",
            ),
            vec![generator_color("clp_bar")],
        ),
    ];

    template(
        "lower-third",
        Localized::new("Bauchbinde", "Lower Third"),
        Localized::new(
            "Ein farbiger Balken schiebt sich unter Ihre Aufnahme, Name und Rolle steigen \
             nacheinander herein und verschwinden wieder.",
            "A coloured bar slides in under your shot; a name and a role rise into it one after \
             the other and leave again.",
        ),
        TITLES,
        vec!["bauchbinde", "name", "maske"],
        vec![LANDSCAPE, SQUARE],
        2.0,
        slots,
        project_with(LANDSCAPE, "#05070c", vec![lane, band, name, role]),
    )
}

/// The way out. What it shows: a keyframed brightness taking the picture down to nothing, the dip
/// transition handing over to a card, and two closing lines arriving a beat apart.
fn end_card() -> Template {
    let mut lane = video_track("trk_main", "V1");
    let mut shot = placeholder("clp_shot", 0.0, 4.0);
    shot.effects
        .push(brightness_ramp("eff_out", 2.8, 1.0, 4.0, 0.1));
    lane.clips.push(shot);

    let mut card = gradient_clip("clp_card", 3.6, 2.9, "#2f6fed", "#0b0e16", 200.0);
    card.transition_in = Some(dip(0.4));
    lane.clips.push(card);

    let mut closing = text_track("trk_closing", "T1");
    closing.clips.push(text_clip(
        "clp_closing",
        4.1,
        2.2,
        "Danke fürs Zusehen",
        &[
            ("fontSize", json!(0.086)),
            ("fontWeight", json!(750)),
            ("y", json!(0.44)),
            ("animateIn", json!("rise")),
            ("animateInSeconds", json!(0.55)),
            ("animateOut", json!("fade")),
        ],
    ));

    let mut handle = text_track("trk_handle", "T2");
    handle.clips.push(text_clip(
        "clp_handle",
        4.5,
        1.8,
        "@ihr-name",
        &[
            ("fontSize", json!(0.036)),
            ("fontWeight", json!(550)),
            ("letterSpacing", json!(0.24)),
            ("y", json!(0.6)),
            ("color", json!("#c9d6f0")),
            ("animateIn", json!("fade")),
            ("animateInSeconds", json!(0.6)),
            ("animateOut", json!("fade")),
        ],
    ));

    let slots = vec![
        media_slot_named(
            "shot",
            Localized::new("Letzte Aufnahme", "Closing shot"),
            Localized::new(
                "Wird zum Schluss dunkel und gibt an die Karte ab.",
                "Goes dark towards the end and hands over to the card.",
            ),
            "clp_shot",
        ),
        text_slot(
            "closing",
            Localized::new("Schlusswort", "Closing line"),
            Localized::new(
                "Die große Zeile auf der Abspannkarte.",
                "The large line on the end card.",
            ),
            vec![generator_text("clp_closing"), SlotBinding::ProjectTitle],
        ),
        text_slot(
            "handle",
            Localized::new("Kennung", "Handle"),
            Localized::new(
                "Wo man Sie findet — klein und weit gesperrt.",
                "Where to find you: small and widely tracked.",
            ),
            vec![generator_text("clp_handle")],
        ),
        color_slot_named(
            "card",
            Localized::new("Farbe der Karte", "Card colour"),
            Localized::new(
                "Färbt die Abspannkarte hinter den Zeilen.",
                "Colours the end card behind the lines.",
            ),
            vec![generator_color("clp_card"), SlotBinding::Background],
        ),
    ];

    template(
        "end-card",
        Localized::new("Abspann", "End Card"),
        Localized::new(
            "Die letzte Aufnahme dunkelt ab, eine Farbkarte übernimmt, und Schlusswort und \
             Kennung kommen nacheinander herein.",
            "The closing shot fades down, a colour card takes over, and a closing line and a \
             handle arrive one after the other.",
        ),
        TITLES,
        vec!["abspann", "abblende", "karte"],
        vec![LANDSCAPE, PORTRAIT, SQUARE],
        5.1,
        slots,
        project_with(LANDSCAPE, "#0b0e16", vec![lane, closing, handle]),
    )
}

/// One thing, shown properly. What it shows: a motion path — a `position` keyframe track carrying a
/// line across the frame, which nothing else in this set does — plus a vignette and a contained fit
/// that leaves the product room to breathe.
fn product_reveal() -> Template {
    let mut back = video_track("trk_back", "V1");
    let mut field = gradient_clip("clp_back", 0.0, 7.0, "#2f6fed", "#0a0d15", 135.0);
    field.effects.push(vignette("eff_vignette", 0.5, 0.72));
    back.clips.push(field);

    let mut front = video_track("trk_front", "V2");
    front.clips.push(placeholder("clp_shot", 0.5, 6.5));

    let mut claim = text_track("trk_claim", "T1");
    let mut line = text_clip(
        "clp_claim",
        1.0,
        6.0,
        "Ihr Produkt, in einem Satz",
        &[
            ("fontSize", json!(0.05)),
            ("fontWeight", json!(700)),
            ("y", json!(0.5)),
            ("maxWidth", json!(0.8)),
            ("animateIn", json!("fade")),
            ("animateInSeconds", json!(0.5)),
            ("animateOut", json!("fade")),
        ],
    );
    // The motion path, in the project pixels `Transform::x`/`y` use, measured from the centre of
    // the frame. Both frames this template offers are 1080 high, so the resting height below is the
    // same picture in either of them.
    line.keyframes.insert(
        "position".into(),
        vec![
            vec2_key(1.0, [-820.0, 300.0]),
            vec2_key(1.9, [0.0, 300.0]),
        ],
    );
    claim.clips.push(line);

    let mut price = text_track("trk_price", "T2");
    price.clips.push(text_clip(
        "clp_price",
        2.3,
        4.7,
        "AB 49 €",
        &[
            ("fontSize", json!(0.038)),
            ("fontWeight", json!(800)),
            ("letterSpacing", json!(0.2)),
            ("y", json!(0.9)),
            ("color", json!("#ffd166")),
            ("animateIn", json!("grow")),
            ("animateInSeconds", json!(0.45)),
            ("animateOut", json!("fade")),
        ],
    ));

    let slots = vec![
        media_slot_named(
            "shot",
            Localized::new("Das Produkt", "The product"),
            Localized::new(
                "Steht mittig und vollständig sichtbar im Farbfeld.",
                "Stands in the middle of the colour field, shown whole.",
            ),
            "clp_shot",
        )
        .with_fit(Fit::inset(0.30, 0.10, 0.40, 0.52)),
        text_slot(
            "claim",
            Localized::new("Versprechen", "Claim"),
            Localized::new(
                "Fährt von links herein und bleibt unter dem Produkt stehen.",
                "Travels in from the left and comes to rest under the product.",
            ),
            vec![generator_text("clp_claim"), SlotBinding::ProjectTitle],
        ),
        text_slot(
            "price",
            Localized::new("Preis oder Hinweis", "Price or note"),
            Localized::new(
                "Die kurze Zeile ganz unten.",
                "The short line right at the bottom.",
            ),
            vec![generator_text("clp_price")],
        ),
        color_slot_named(
            "brand",
            Localized::new("Ihre Farbe", "Your colour"),
            Localized::new(
                "Färbt das Feld hinter dem Produkt.",
                "Colours the field the product stands in.",
            ),
            vec![generator_color("clp_back")],
        ),
    ];

    template(
        "product-reveal",
        Localized::new("Produkt im Blick", "Product Reveal"),
        Localized::new(
            "Das Produkt steht mittig in einem abgedunkelten Farbfeld; das Versprechen fährt von \
             links herein, der Preis wächst darunter auf.",
            "The product stands in the middle of a vignetted colour field; the claim travels in \
             from the left and the price grows in beneath it.",
        ),
        PRODUCT,
        vec!["bewegungspfad", "vignette", "produkt"],
        vec![LANDSCAPE, SQUARE],
        3.0,
        slots,
        project_with(LANDSCAPE, "#0a0d15", vec![back, front, claim, price]),
    )
}

// ---------------------------------------------------------------------------------------------
// The pieces every template above is assembled from.
// ---------------------------------------------------------------------------------------------

// The material a slot has yet to be given. The id names nothing that exists, which is exactly what
// `check_every_clip_has_a_source` demands a slot for.
const PLACEHOLDER: &str = "med_awaiting_a_slot_answer";

#[allow(clippy::too_many_arguments)]
fn template(
    id: &str,
    name: Localized,
    description: Localized,
    category: &str,
    tags: Vec<&str>,
    aspect_ratios: Vec<Frame>,
    poster_seconds: f64,
    slots: Vec<Slot>,
    project: Project,
) -> Template {
    Template {
        manifest: TemplateManifest {
            schema_version: TEMPLATE_SCHEMA_VERSION,
            id: id.to_string(),
            version: 1,
            name,
            description,
            category: category.to_string(),
            tags: tags.into_iter().map(str::to_string).collect(),
            aspect_ratios,
            poster_at: Some(Time::from_seconds(poster_seconds)),
            steps: steps_for(&slots),
            slots,
        },
        project,
    }
}

// One step per kind of question, in the order someone would answer them: the material first because
// it is the slow part, then the words, then the colour. Derived rather than authored, so the rule
// that every slot appears in exactly one step cannot be broken by a template that forgets a slot.
fn steps_for(slots: &[Slot]) -> Vec<Step> {
    [
        (
            SlotKind::Media,
            Localized::new("Ihr Material", "Your footage"),
        ),
        (SlotKind::Text, Localized::new("Ihre Worte", "Your words")),
        (SlotKind::Color, Localized::new("Ihre Farbe", "Your colour")),
    ]
    .into_iter()
    .filter_map(|(kind, title)| {
        let ids: Vec<String> = slots
            .iter()
            .filter(|slot| slot.kind == kind)
            .map(|slot| slot.id.clone())
            .collect();
        (!ids.is_empty()).then_some(Step { title, slots: ids })
    })
    .collect()
}

fn placeholder(id: &str, start: f64, duration: f64) -> Clip {
    let mut clip = Clip::new_media(
        MediaId::from(PLACEHOLDER.to_string()),
        Time::from_seconds(start),
        Time::from_seconds(duration),
    );
    clip.id = ClipId::from(id.to_string());
    clip
}

fn generator_clip(id: &str, start: f64, duration: f64, generator: Generator) -> Clip {
    let mut clip = Clip::new_generator(
        generator,
        Time::from_seconds(start),
        Time::from_seconds(duration),
    );
    clip.id = ClipId::from(id.to_string());
    clip
}

fn text_clip(id: &str, start: f64, duration: f64, content: &str, style: &[(&str, Value)]) -> Clip {
    generator_clip(
        id,
        start,
        duration,
        Generator::Text {
            content: content.to_string(),
            style: style
                .iter()
                .map(|(key, value)| ((*key).to_string(), value.clone()))
                .collect::<BTreeMap<String, Value>>(),
        },
    )
}

fn solid_clip(id: &str, start: f64, duration: f64, color: &str) -> Clip {
    generator_clip(
        id,
        start,
        duration,
        Generator::Solid {
            color: color.to_string(),
        },
    )
}

fn gradient_clip(id: &str, start: f64, duration: f64, from: &str, to: &str, angle: f32) -> Clip {
    generator_clip(
        id,
        start,
        duration,
        Generator::Gradient {
            from: from.to_string(),
            to: to.to_string(),
            angle,
        },
    )
}

// Aligned to the incoming edge rather than centred: a centred transition reaches back to before the
// clip starts, where nothing is drawn, so half of it would simply not be seen (see `windowStart` in
// draw-list.ts). The clips overlap by exactly the length of the transition instead.
fn transition(kind: &str, seconds: f64, params: &[(&str, f32)]) -> Transition {
    let mut transition = Transition::new(kind, Time::from_seconds(seconds));
    transition.alignment = TransitionAlignment::In;
    transition.params = params
        .iter()
        .map(|(key, value)| ((*key).to_string(), ParamValue::Float(*value)))
        .collect();
    transition
}

fn crossfade(seconds: f64) -> Transition {
    transition("crossfade", seconds, &[])
}

fn wipe(seconds: f64, angle: f32) -> Transition {
    transition("wipe", seconds, &[("angle", angle), ("softness", 0.03)])
}

fn slide(seconds: f64, angle: f32) -> Transition {
    transition("slide", seconds, &[("angle", angle)])
}

fn zoom(seconds: f64, from: f32) -> Transition {
    transition("zoom", seconds, &[("from", from)])
}

fn dip(seconds: f64) -> Transition {
    transition("dip", seconds, &[("level", 0.0)])
}

fn effect_with(id: &str, kind: &str, params: &[(&str, f32)]) -> Effect {
    let mut effect = Effect::new(kind);
    effect.id = EffectId::from(id.to_string());
    effect.params = params
        .iter()
        .map(|(key, value)| ((*key).to_string(), ParamValue::Float(*value)))
        .collect();
    effect
}

fn brightness_ramp(id: &str, from_at: f64, from: f32, to_at: f64, to: f32) -> Effect {
    let mut effect = effect_with(id, "brightness", &[]);
    effect.keyframes.insert(
        "amount".into(),
        vec![float_key(from_at, from), float_key(to_at, to)],
    );
    effect
}

// A rectangle held over a clip: the split screen's seam, the slideshow's dark band, the lower
// third's bar. All six numbers are fractions of the frame with the origin at the top left.
fn band_mask(id: &str, x: f32, y: f32, width: f32, height: f32, feather: f32) -> Effect {
    effect_with(
        id,
        "mask-rect",
        &[
            ("centerX", x),
            ("centerY", y),
            ("width", width),
            ("height", height),
            ("feather", feather),
        ],
    )
}

// The circle that opens: the same mask with its width and height keyframed from nothing to past the
// corners of the frame. 2.4 rather than 2.0 because a circle only covers a rectangle's corners once
// its diameter passes the diagonal.
fn iris(id: &str, from_at: f64, to_at: f64) -> Effect {
    let mut effect = effect_with(id, "mask-ellipse", &[("feather", 0.02)]);
    for key in ["width", "height"] {
        effect.keyframes.insert(
            key.into(),
            vec![float_key(from_at, 0.0), float_key(to_at, 2.4)],
        );
    }
    effect
}

fn vignette(id: &str, amount: f32, size: f32) -> Effect {
    effect_with(id, "vignette", &[("amount", amount), ("size", size)])
}

fn float_key(at: f64, value: f32) -> Keyframe {
    key(at, ParamValue::Float(value))
}

fn vec2_key(at: f64, value: [f32; 2]) -> Keyframe {
    key(at, ParamValue::Vec2(value))
}

fn key(at: f64, value: ParamValue) -> Keyframe {
    Keyframe {
        time: Time::from_seconds(at),
        value,
        interp: Interp::Linear,
        handle_in: None,
        handle_out: None,
    }
}

fn track(id: &str, kind: TrackKind, name: &str) -> Track {
    let mut track = Track::new(kind, name.to_string());
    track.id = TrackId::from(id.to_string());
    track
}

fn video_track(id: &str, name: &str) -> Track {
    track(id, TrackKind::Video, name)
}

fn text_track(id: &str, name: &str) -> Track {
    track(id, TrackKind::Text, name)
}

fn overlay_track(id: &str, name: &str) -> Track {
    track(id, TrackKind::Overlay, name)
}

fn project_with(frame: Frame, background: &str, tracks: Vec<Track>) -> Project {
    Project {
        settings: ProjectSettings {
            width: frame.width,
            height: frame.height,
            fps: Rate::from_fps(30),
            background: background.to_string(),
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

fn generator_text(clip: &str) -> SlotBinding {
    SlotBinding::GeneratorText {
        clip: ClipId::from(clip.to_string()),
    }
}

fn generator_color(clip: &str) -> SlotBinding {
    SlotBinding::GeneratorColor {
        clip: ClipId::from(clip.to_string()),
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

// Every text slot is optional, and that is the whole reason a card can show something: the template
// ships the words it was designed with, so an unanswered title is the designer's line rather than
// an empty rectangle.
fn text_slot(id: &str, label: Localized, hint: Localized, bindings: Vec<SlotBinding>) -> Slot {
    Slot {
        id: id.to_string(),
        kind: SlotKind::Text,
        label,
        hint,
        required: false,
        bindings,
    }
}

fn color_slot_named(
    id: &str,
    label: Localized,
    hint: Localized,
    bindings: Vec<SlotBinding>,
) -> Slot {
    Slot {
        id: id.to_string(),
        kind: SlotKind::Color,
        label,
        hint,
        required: false,
        bindings,
    }
}

impl Slot {
    // Reads at the call site as "this shot, but into that rectangle", which is the one thing about
    // a media slot that differs between templates often enough to be worth saying inline.
    fn with_fit(mut self, fit: Fit) -> Self {
        for binding in &mut self.bindings {
            if let SlotBinding::ClipMedia { fit: existing, .. } = binding {
                *existing = fit;
            }
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;
    use crate::model::{ClipSource, MediaAsset, MediaId, MediaKind};
    use crate::template::SlotAnswer;

    // Everything `paintsGenerator`, the effect registry and the transition registry in the engine
    // actually implement. A template leaning on anything outside these lists would look complete in
    // the timeline and be blank on the screen: `effectPasses` and `mixPass` skip a type they do not
    // know in silence.
    const DRAWN_EFFECTS: &[&str] = &[
        "brightness",
        "contrast",
        "saturation",
        "temperature",
        "vignette",
        "blur",
        "sharpen",
        "chromaKey",
        "mask-rect",
        "mask-ellipse",
    ];
    const DRAWN_TRANSITIONS: &[&str] = &["crossfade", "wipe", "slide", "zoom", "dip"];
    const DRAWN_TRACK_KINDS: &[TrackKind] = &[TrackKind::Video, TrackKind::Text, TrackKind::Overlay];

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
                        text: format!("answer for {}", slot.id),
                    },
                    SlotKind::Color => SlotAnswer::Color {
                        color: "#1188ff".into(),
                    },
                };
                (slot.id.clone(), answer)
            })
            .collect()
    }

    fn clips(project: &Project) -> impl Iterator<Item = &Clip> {
        project
            .timeline
            .tracks
            .iter()
            .flat_map(|track| &track.clips)
    }

    fn named(id: &str) -> Template {
        templates()
            .into_iter()
            .find(|entry| entry.manifest.id == id)
            .unwrap_or_else(|| panic!("no template {id}"))
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
    // project whose every clip is something the renderer draws — material that is really in the
    // library, or a generator it paints.
    #[test]
    fn every_shipped_template_bakes_into_a_project_the_renderer_can_draw_all_of() {
        for template in templates() {
            let id = template.manifest.id.clone();
            let baked = template
                .bake(&every_slot_answered(&template.manifest), None)
                .unwrap_or_else(|error| panic!("{id} failed to bake: {error}"));

            assert!(
                clips(&baked).count() > 0,
                "{id} baked into an empty timeline"
            );
            for clip in clips(&baked) {
                match &clip.source {
                    ClipSource::Media { media } => {
                        assert!(
                            baked.library.iter().any(|asset| &asset.id == media),
                            "{id} left clip {} without material",
                            clip.id
                        );
                        assert_ne!(media.as_str(), PLACEHOLDER, "{id} kept a placeholder");
                    }
                    ClipSource::Generator {
                        generator: Generator::Text { .. } | Generator::Solid { .. } | Generator::Gradient { .. },
                    } => {}
                    _ => panic!("{id} baked a clip this version draws nothing for"),
                }
            }
        }
    }

    // Nothing in the shipped set may lean on an effect, a transition or a track kind the renderer
    // has not got. All three are skipped in silence where they are unknown, so this is the
    // difference between a template that is broken and one that merely does nothing.
    #[test]
    fn the_shipped_set_only_uses_what_this_version_can_draw() {
        for template in templates() {
            let id = &template.manifest.id;
            for track in &template.project.timeline.tracks {
                assert!(
                    DRAWN_TRACK_KINDS.contains(&track.kind),
                    "{id}: track kind {:?} paints nothing",
                    track.kind
                );
                for clip in &track.clips {
                    for effect in &clip.effects {
                        assert!(
                            DRAWN_EFFECTS.contains(&effect.effect_type.as_str()),
                            "{id}: effect {} is not drawn",
                            effect.effect_type
                        );
                    }
                    if let Some(transition) = &clip.transition_in {
                        assert!(
                            DRAWN_TRANSITIONS.contains(&transition.transition_type.as_str()),
                            "{id}: transition {} is not drawn",
                            transition.transition_type
                        );
                    }
                    // Only the incoming edge is rendered; an outgoing transition would be authored
                    // work nobody ever sees.
                    assert!(
                        clip.transition_out.is_none(),
                        "{id}: clip {} carries an outgoing transition, which is never drawn",
                        clip.id
                    );
                }
            }
        }
    }

    // A gallery of nine cards is only worth having if the nine are not the same card. Between them
    // the shipped set has to exercise every transition the renderer implements — that is what makes
    // the set a tour of what the tool does rather than one idea in nine colours.
    #[test]
    fn between_them_the_shipped_templates_use_every_transition_that_exists() {
        let used: BTreeSet<String> = templates()
            .iter()
            .flat_map(|template| {
                template
                    .project
                    .timeline
                    .tracks
                    .iter()
                    .flat_map(|track| &track.clips)
                    .filter_map(|clip| clip.transition_in.as_ref())
                    .map(|transition| transition.transition_type.clone())
                    .collect::<Vec<_>>()
            })
            .collect();

        for kind in DRAWN_TRANSITIONS {
            assert!(used.contains(*kind), "no shipped template uses {kind}");
        }
    }

    // Every template has to stand on its own with no material at all: that is what the gallery card
    // is rendered from, and a card is the only thing anyone sees before choosing. A template whose
    // preview is nothing but the stand-in grey is a template with no idea of its own.
    #[test]
    fn every_shipped_template_previews_with_something_of_its_own_in_the_picture() {
        for template in templates() {
            let id = &template.manifest.id;
            let preview = template.preview(None).unwrap();
            let poster = template.manifest.poster_at.expect("a poster instant");

            let showing: Vec<&Clip> = clips(&preview).filter(|clip| clip.contains(poster)).collect();
            assert!(
                showing
                    .iter()
                    .any(|clip| matches!(&clip.source, ClipSource::Generator { .. })),
                "{id}: at its own poster instant the card would show nothing but stand-ins"
            );
            assert!(
                showing
                    .iter()
                    .any(|clip| matches!(&clip.source, ClipSource::Generator { generator: Generator::Text { content, .. } } if !content.trim().is_empty())),
                "{id}: no words on screen at the poster instant"
            );
        }
    }

    // The card is drawn at the poster instant, so an instant past the end of the build would be a
    // black rectangle in the gallery.
    #[test]
    fn every_poster_instant_lands_inside_the_template_it_belongs_to() {
        for template in templates() {
            let id = &template.manifest.id;
            let poster = template.manifest.poster_at.expect("a poster instant");
            let end = clips(&template.project)
                .map(|clip| clip.end())
                .max()
                .expect("a clip");
            assert!(poster < end, "{id}: the poster instant is past the end");
        }
    }

    // Every offered aspect ratio is offered for real: baking into it has to succeed and the frame
    // has to be the one that was asked for, not the one the template was authored at.
    #[test]
    fn every_offered_aspect_ratio_bakes_and_previews() {
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

                let preview = template.preview(Some(*frame)).unwrap();
                assert_eq!(preview.settings.width, frame.width);
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
                assert!(!text.de.trim().is_empty(), "{}: German missing", manifest.id);
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

    // The gallery groups by category, so a category nobody else is in is a heading with one card
    // under it, and a category string nothing shares is a typo nobody would notice.
    #[test]
    fn every_shipped_template_sits_in_one_of_the_named_categories() {
        let known = [INTRO, SLIDESHOW, SOCIAL, TITLES, PRODUCT];
        let mut seen = BTreeSet::new();
        for template in templates() {
            assert!(
                known.contains(&template.manifest.category.as_str()),
                "{}: category {} is not one of the five",
                template.manifest.id,
                template.manifest.category
            );
            seen.insert(template.manifest.category.clone());
        }
        assert_eq!(seen.len(), known.len(), "a category with nothing in it");
    }

    // A transition only reads as one if the two clips overlap for its whole length: the incoming
    // clip is not drawn before it starts, so one reaching back past that edge is half invisible.
    #[test]
    fn every_transition_is_covered_by_a_real_overlap() {
        for template in templates() {
            for track in &template.project.timeline.tracks {
                for (index, clip) in track.clips.iter().enumerate() {
                    let Some(transition) = &clip.transition_in else {
                        continue;
                    };
                    assert_eq!(transition.alignment, TransitionAlignment::In);
                    assert!(index > 0, "the first clip of a track cannot transition into one");
                    let previous = &track.clips[index - 1];
                    assert!(
                        previous.end() >= clip.start + transition.duration,
                        "{}: clip {} transitions over nothing",
                        template.manifest.id,
                        clip.id
                    );
                }
            }
        }
    }

    // Two clips on the same track at the same instant, beyond the overlap a transition asks for,
    // means one is drawn over the other for reasons nobody authored.
    #[test]
    fn no_track_stacks_two_clips_on_top_of_each_other() {
        for template in templates() {
            for track in &template.project.timeline.tracks {
                for pair in track.clips.windows(2) {
                    let (before, after) = (&pair[0], &pair[1]);
                    let allowed = after
                        .transition_in
                        .as_ref()
                        .map_or(Time::ZERO, |transition| transition.duration);
                    assert!(
                        before.end() <= after.start + allowed,
                        "{}: {} and {} overlap by more than a transition",
                        template.manifest.id,
                        before.id,
                        after.id
                    );
                }
            }
        }
    }

    // The discriminating half of the bake: a template that ships its own words has to hand them
    // over when the wizard supplies different ones, into the generator that draws them and not
    // merely into the project's name.
    #[test]
    fn a_text_answer_replaces_the_words_the_template_shipped_with() {
        let template = named("bold-open");
        let before = text_of(&template.project, "clp_title");

        let baked = template
            .bake(&every_slot_answered(&template.manifest), None)
            .unwrap();

        assert_eq!(text_of(&baked, "clp_title"), "answer for title");
        assert_ne!(text_of(&baked, "clp_title"), before);
        assert_eq!(text_of(&baked, "clp_sub"), "answer for subtitle");
    }

    #[test]
    fn a_colour_answer_reaches_the_generator_it_is_bound_to() {
        let baked = named("bold-open")
            .bake(&every_slot_answered(&named("bold-open").manifest), None)
            .unwrap();

        let ClipSource::Generator {
            generator: Generator::Gradient { from, to, .. },
        } = &find(&baked, "clp_bg").source
        else {
            panic!("the backdrop is not a gradient");
        };
        assert_eq!(from, "#1188ff");
        // Only the stop the slot names moves; the other end of the ramp is the author's.
        assert_eq!(to, "#101625");
        assert_eq!(baked.settings.background, "#1188ff");
    }

    #[test]
    fn a_colour_answer_reaching_a_title_changes_its_ink_and_nothing_else() {
        let template = named("beat-slideshow");
        let baked = template
            .bake(&every_slot_answered(&template.manifest), None)
            .unwrap();

        let ClipSource::Generator {
            generator: Generator::Text { style, .. },
        } = &find(&baked, "clp_word").source
        else {
            panic!("the header is not a text generator");
        };
        assert_eq!(style["color"], serde_json::json!("#1188ff"));
        assert_eq!(style["letterSpacing"], serde_json::json!(0.34));
    }

    // The preview is what the gallery card is, so the one thing it must not do is invent a picture
    // the bake would not produce. The stand-in is the size of the frame, which is the size a
    // generator is drawn at, so the grey rectangle lands exactly where the footage will.
    #[test]
    fn a_preview_puts_its_stand_in_where_the_real_material_would_go() {
        let template = named("product-reveal");
        let frame = LANDSCAPE;

        let preview = template.preview(Some(frame)).unwrap();
        let baked = template
            .bake(
                &every_slot_answered(&template.manifest),
                Some(&ProjectSettings {
                    width: frame.width,
                    height: frame.height,
                    ..ProjectSettings::default()
                }),
            )
            .unwrap();

        let shown = &find(&preview, "clp_shot").transform;
        let real = &find(&baked, "clp_shot").transform;
        assert_eq!((shown.x, shown.y), (real.x, real.y));
        // The contained box is 40% of the width; a frame-sized stand-in scaled to it is the same
        // rectangle a 1920x1080 answer lands in.
        assert_eq!(shown.scale_x, real.scale_x);
        assert!(shown.scale_x < 1.0, "the inset is not inset");
    }

    #[test]
    fn a_preview_carries_no_material_and_no_placeholder() {
        for template in templates() {
            let id = &template.manifest.id;
            let preview = template.preview(None).unwrap();

            assert!(preview.library.is_empty(), "{id}: the preview carries media");
            for clip in clips(&preview) {
                assert!(
                    matches!(&clip.source, ClipSource::Generator { .. }),
                    "{id}: clip {} is not something a preview can draw",
                    clip.id
                );
                assert_eq!(clip.speed.rate, 1.0, "{id}: a stand-in was slowed down");
            }
        }
    }

    fn find<'p>(project: &'p Project, id: &str) -> &'p Clip {
        clips(project)
            .find(|clip| clip.id.as_str() == id)
            .unwrap_or_else(|| panic!("no clip {id}"))
    }

    fn text_of(project: &Project, id: &str) -> String {
        match &find(project, id).source {
            ClipSource::Generator {
                generator: Generator::Text { content, .. },
            } => content.clone(),
            _ => panic!("{id} is not a text generator"),
        }
    }
}
