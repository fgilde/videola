use super::bounded;
use crate::model::{Marker, MarkerId, Project, Time};
use crate::{CoreError, Result};

// What a marker is given when nobody has said otherwise. `marker.setColor` takes it from there.
const MARKER_COLOR: &str = "#F0A030";

pub(super) fn add(target: &mut Project, time: Time, label: &str) -> Result<()> {
    let time = bounded(time)?;
    target.markers.push(Marker {
        id: MarkerId::new(),
        time,
        label: label.to_string(),
        color_hex: MARKER_COLOR.to_string(),
        note: String::new(),
    });
    // Sorted so the ruler and the snap candidates read them in the order they appear, whatever
    // order they were placed in.
    target.markers.sort_by_key(|marker| marker.time.as_flicks());
    Ok(())
}

pub(super) fn remove(target: &mut Project, marker: &MarkerId) -> Result<()> {
    let index = index_of(target, marker)?;
    target.markers.remove(index);
    Ok(())
}

pub(super) fn rename(target: &mut Project, marker: &MarkerId, label: &str) -> Result<()> {
    let index = index_of(target, marker)?;
    target.markers[index].label = label.to_string();
    Ok(())
}

// The same gate the load boundary puts on every colour it reads: a marker's ends up in an inline
// style, where anything unparsable is dropped without a word.
pub(super) fn set_color(target: &mut Project, marker: &MarkerId, color_hex: &str) -> Result<()> {
    crate::model::project::hex_color(color_hex)?;
    let index = index_of(target, marker)?;
    target.markers[index].color_hex = color_hex.to_string();
    Ok(())
}

pub(super) fn set_note(target: &mut Project, marker: &MarkerId, note: &str) -> Result<()> {
    let index = index_of(target, marker)?;
    target.markers[index].note = note.to_string();
    Ok(())
}

fn index_of(target: &Project, marker: &MarkerId) -> Result<usize> {
    target
        .markers
        .iter()
        .position(|candidate| &candidate.id == marker)
        .ok_or_else(|| CoreError::InvalidArgument(format!("no marker with id {marker}")))
}
