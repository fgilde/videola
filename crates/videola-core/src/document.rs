use json_patch::Patch;
use serde::Serialize;
use serde_json::Value;

use crate::command::Dispatch;
use crate::history::{diff, Entry, History};
use crate::model::Project;
use crate::{CoreError, Result};

const HISTORY_LIMIT: usize = 500;

pub struct Document {
    project: Project,
    history: History,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub patch: Value,
    pub label: &'static str,
    pub can_undo: bool,
    pub can_redo: bool,
}

impl Default for Document {
    fn default() -> Self {
        Self::from_project(Project::default())
    }
}

impl Document {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_project(project: Project) -> Self {
        Self {
            project,
            history: History::new(HISTORY_LIMIT),
        }
    }

    pub fn project(&self) -> &Project {
        &self.project
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    // ponytail: pro Dispatch wird das Projekt geklont und zweimal serialisiert. Bei grossen
    // Projekten und Drag-Frequenz kann das auffallen; dann Patches pro Command von Hand
    // erzeugen statt zu diffen — die Entry-Struktur bleibt dabei gleich.
    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        let before = serde_json::to_value(&self.project)?;
        let mut candidate = self.project.clone();
        dispatch.command.apply(&mut candidate)?;
        let after = serde_json::to_value(&candidate)?;

        let patch = diff(&before, &after);
        if self.history.coalesces_with(&dispatch.coalesce_key) {
            self.coalesce_into_last(&before, &after)?;
        } else {
            self.history.push(Entry {
                label: dispatch.command.label(),
                patch: patch.clone(),
                inverse: diff(&after, &before),
                coalesce_key: dispatch.coalesce_key,
            });
        }
        self.project = candidate;
        Ok(self.result(patch, dispatch.command.label()))
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.pop_undo().ok_or(CoreError::NothingToUndo)?;
        let patch = entry.inverse.clone();
        self.apply_patch(&patch)?;
        Ok(self.result(patch, entry.label))
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.pop_redo().ok_or(CoreError::NothingToRedo)?;
        let patch = entry.patch.clone();
        self.apply_patch(&patch)?;
        Ok(self.result(patch, entry.label))
    }

    fn coalesce_into_last(&mut self, before: &Value, after: &Value) -> Result<()> {
        let Some(inverse) = self.history.last_inverse().cloned() else {
            return Ok(());
        };
        let mut group_start = before.clone();
        json_patch::patch(&mut group_start, &inverse)
            .map_err(|error| CoreError::InvalidArgument(error.to_string()))?;
        self.history
            .replace_last(diff(&group_start, after), diff(after, &group_start));
        Ok(())
    }

    fn apply_patch(&mut self, patch: &Patch) -> Result<()> {
        let mut state = serde_json::to_value(&self.project)?;
        json_patch::patch(&mut state, patch)
            .map_err(|error| CoreError::InvalidArgument(error.to_string()))?;
        self.project = serde_json::from_value(state)?;
        Ok(())
    }

    fn result(&self, patch: Patch, label: &'static str) -> DispatchResult {
        DispatchResult {
            patch: serde_json::to_value(&patch).unwrap_or(Value::Null),
            label,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
        }
    }
}
