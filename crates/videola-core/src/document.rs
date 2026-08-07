use json_patch::Patch;
use serde::Serialize;
use serde_json::Value;

use crate::command::Dispatch;
use crate::history::{diff, Entry, History, HISTORY_LIMIT};
use crate::model::Project;
use crate::{CoreError, Result};

#[derive(Debug)]
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

    // The entry point every deserialised project comes through; normalising here means nothing
    // downstream has to check keyframe ordering itself (see Project::normalize).
    pub fn from_project(mut project: Project) -> Self {
        project.normalize();
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

    // ponytail: every dispatch clones the project and serialises it twice. On large projects
    // and drag-frequency dispatch this can start to show; then build patches per command by
    // hand instead of diffing — the Entry struct stays the same either way.
    pub fn dispatch(&mut self, dispatch: Dispatch) -> Result<DispatchResult> {
        let before = serde_json::to_value(&self.project)?;
        let mut candidate = self.project.clone();
        dispatch.command.apply(&mut candidate)?;
        let after = serde_json::to_value(&candidate)?;
        let label = dispatch.command.label();

        let patch = diff(&before, &after);
        if !patch.is_empty() {
            self.history.clear_redo();
            if self.history.coalesces_with(&dispatch.coalesce_key) {
                self.coalesce_into_last(&before, &after)?;
            } else {
                self.history.push(Entry {
                    label,
                    patch: patch.clone(),
                    inverse: diff(&after, &before),
                    coalesce_key: dispatch.coalesce_key,
                });
            }
        }
        self.project = candidate;
        self.result(patch, label)
    }

    pub fn undo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.peek_undo().ok_or(CoreError::NothingToUndo)?;
        let patch = entry.inverse.clone();
        let label = entry.label;
        self.apply_patch(&patch)?;
        self.history.commit_undo();
        self.result(patch, label)
    }

    pub fn redo(&mut self) -> Result<DispatchResult> {
        let entry = self.history.peek_redo().ok_or(CoreError::NothingToRedo)?;
        let patch = entry.patch.clone();
        let label = entry.label;
        self.apply_patch(&patch)?;
        self.history.commit_redo();
        self.result(patch, label)
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

    fn result(&self, patch: Patch, label: &'static str) -> Result<DispatchResult> {
        Ok(DispatchResult {
            patch: serde_json::to_value(&patch)?,
            label,
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
        })
    }
}
