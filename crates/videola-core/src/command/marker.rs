use super::bounded;
use crate::model::{Marker, MarkerId, Project, Time};
use crate::{CoreError, Result};

// The one colour markers get in this version. A per-marker colour is a field on the model already,
// so the command that sets it can arrive without touching anything else.
const MARKER_COLOR: &str = "#F0A030";

pub(super) fn add(target: &mut Project, time: Time, label: &str) -> Result<()> {
    let time = bounded(time)?;
    target.markers.push(Marker {
        id: MarkerId::new(),
        time,
        label: label.to_string(),
        color_hex: MARKER_COLOR.to_string(),
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

fn index_of(target: &Project, marker: &MarkerId) -> Result<usize> {
    target
        .markers
        .iter()
        .position(|candidate| &candidate.id == marker)
        .ok_or_else(|| CoreError::InvalidArgument(format!("no marker with id {marker}")))
}
