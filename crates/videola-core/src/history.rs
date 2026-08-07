use json_patch::Patch;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct Entry {
    pub label: &'static str,
    pub patch: Patch,
    pub inverse: Patch,
    pub coalesce_key: Option<String>,
}

#[derive(Debug, Default)]
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryLabel {
    pub label: &'static str,
}

impl History {
    pub fn new(limit: usize) -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            limit,
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn labels(&self) -> Vec<&'static str> {
        self.undo.iter().map(|entry| entry.label).collect()
    }

    pub fn coalesces_with(&self, key: &Option<String>) -> bool {
        match (key, self.undo.last()) {
            (Some(key), Some(last)) => last.coalesce_key.as_deref() == Some(key.as_str()),
            _ => false,
        }
    }

    pub fn push(&mut self, entry: Entry) {
        self.redo.clear();
        self.undo.push(entry);
        if self.undo.len() > self.limit {
            self.undo.remove(0);
        }
    }

    pub fn replace_last(&mut self, patch: Patch, inverse: Patch) {
        if let Some(last) = self.undo.last_mut() {
            last.patch = patch;
            last.inverse = inverse;
        }
    }

    pub fn last_inverse(&self) -> Option<&Patch> {
        self.undo.last().map(|entry| &entry.inverse)
    }

    pub fn pop_undo(&mut self) -> Option<Entry> {
        let entry = self.undo.pop()?;
        self.redo.push(entry.clone());
        Some(entry)
    }

    pub fn pop_redo(&mut self) -> Option<Entry> {
        let entry = self.redo.pop()?;
        self.undo.push(entry.clone());
        Some(entry)
    }
}

pub fn empty_patch() -> Patch {
    Patch(Vec::new())
}

pub fn diff(from: &Value, to: &Value) -> Patch {
    json_patch::diff(from, to)
}
