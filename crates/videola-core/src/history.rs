use json_patch::Patch;

pub(crate) const HISTORY_LIMIT: usize = 500;

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub label: &'static str,
    pub patch: Patch,
    pub inverse: Patch,
    pub coalesce_key: Option<String>,
}

#[derive(Debug)]
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    limit: usize,
}

impl History {
    pub(crate) fn new(limit: usize) -> Self {
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

    pub(crate) fn coalesces_with(&self, key: &Option<String>) -> bool {
        match (key, self.undo.last()) {
            (Some(key), Some(last)) => last.coalesce_key.as_deref() == Some(key.as_str()),
            _ => false,
        }
    }

    pub(crate) fn clear_redo(&mut self) {
        self.redo.clear();
    }

    pub(crate) fn push(&mut self, entry: Entry) {
        self.undo.push(entry);
        self.trim();
    }

    pub(crate) fn replace_last(&mut self, patch: Patch, inverse: Patch) {
        if let Some(last) = self.undo.last_mut() {
            last.patch = patch;
            last.inverse = inverse;
        }
    }

    pub(crate) fn last_inverse(&self) -> Option<&Patch> {
        self.undo.last().map(|entry| &entry.inverse)
    }

    pub(crate) fn peek_undo(&self) -> Option<&Entry> {
        self.undo.last()
    }

    pub(crate) fn peek_redo(&self) -> Option<&Entry> {
        self.redo.last()
    }

    // Only ever called after the caller has successfully re-applied the entry's patch — moving
    // it between stacks before that would leave undo permanently lost if the apply then failed.
    pub(crate) fn commit_undo(&mut self) {
        if let Some(entry) = self.undo.pop() {
            self.redo.push(entry);
        }
    }

    pub(crate) fn commit_redo(&mut self) {
        if let Some(entry) = self.redo.pop() {
            self.undo.push(entry);
            self.trim();
        }
    }

    fn trim(&mut self) {
        while self.undo.len() > self.limit {
            self.undo.remove(0);
        }
    }
}

pub(crate) fn diff(from: &serde_json::Value, to: &serde_json::Value) -> Patch {
    json_patch::diff(from, to)
}
