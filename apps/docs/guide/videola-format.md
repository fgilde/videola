# The `.videola` format

A `.videola` file is a ZIP archive. `unzip -l project.videola` lists it, `unzip -p project.videola
project.json | jq .` reads the model, and nothing in the format needs Videola to inspect it. This
page describes what is in there and which parts a reader may rely on.

Reader, writer and migration live in `crates/videola-core/src/format`.

## Container layout

What the writer produces today:

```
project.videola  (ZIP)
├─ videola.json          the manifest
├─ project.json          the model
└─ media/<sha256>.<ext>  one entry per library asset
```

The two JSON entries are Deflate-compressed and written with pretty-printing, so they are readable
straight out of the archive. Media entries are **stored, not deflated** — H.264, AAC and JPEG are
already compressed, and running Deflate over them again costs time for no useful size gain.

The full layout the design reserves, with everything below the line regenerable:

```
├─ videola.json
├─ project.json
├─ media/<sha256>.<ext>
├─ media/index.json              hash → technical metadata
├─ assets/fonts/…                embedded fonts
├─ preview.jpg                   project thumbnail
├─ preview.mp4                   optional preview video
│
└── regenerable from here; omitted by a slim save ──
   ├─ proxies/<sha256>.mp4        low-resolution proxies
   ├─ thumbs/<sha256>/…           timeline thumbnails
   ├─ cache/waveforms/<sha256>.pk audio peaks
   └─ history.json                undo history (opt-in)
```

Only `videola.json`, `project.json` and `media/` are written or read today. The rest is planned.
`media/index.json` in particular is not yet needed: the technical metadata it would carry lives in
`project.json` under `library`, where each `MediaAsset` records `originalName`, `mime`, `kind`,
`sizeBytes` and optionally `duration`, `width`, `height`, `fps`, `sampleRate` and `channels`.

## Contract and cache

The distinction the layout draws is the important part of it.

**Contract.** The manifest, the model, the media, the embedded fonts and the previews. Losing any of
them loses work.

**Cache.** Proxies, thumbnails, waveform peaks and the optional history. All of it is derivable from
the contract half. A *slim save* drops it and produces a small file that is reasonable to email or
commit; a *full save* keeps it so that reopening the project is immediately fast. Both open
everywhere — a reader is never required to find a cache entry, and a missing one only costs
recomputation.

Nothing enforces this today because nothing writes cache entries yet. The rule to hold to when it
does: a reader must never derive contract information from a cache entry.

## `videola.json`

```json
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "prj_…",
  "title": "My project",
  "created": "2026-08-07T10:00:00Z",
  "modified": "2026-08-07T10:00:00Z",
  "locale": "de"
}
```

The manifest is a **convenience copy**. It exists so a file browser, a gallery or an indexer can read
a project's title and identity without parsing the whole model. `project.json` is the single source
of truth, always.

The reader compares the two and reports a `manifestMismatch` warning naming each field that
disagrees — `title`, `projectId` or `schemaVersion`. It does not pick a winner; a caller that sees the
warning knows the copies have diverged rather than silently trusting whichever it happened to read
first.

`schemaVersion` is exempt from that comparison when the file was migrated. Migration stamps the
project's own `schemaVersion` up to the current one, so an old file — whose manifest still declares
the version it was written with — would otherwise report a mismatch on every load and tell the user
their file is inconsistent when it is merely old.

## `media/` and content addressing

An entry is named

```
media/<64 lower-case hex characters>.<extension>
```

where the hex is the SHA-256 of the entry's own bytes. The corresponding `MediaId` in `project.json`
is that same hash with a `med_` prefix: `med_<hash>`.

The extension is derived from the asset's `originalName`, lower-cased, and accepted only if it is
one to eight ASCII alphanumeric characters. Anything else becomes `bin`. The hash part is likewise
re-hashed if it is not already 64 hex characters. Both rules exist because `originalName` and the
stored id both arrive from untrusted JSON and both feed a ZIP entry path; deriving the whole name
means no value from the file can steer an entry out of `media/`.

Consequences worth knowing when reading a file by hand:

- **Duplicates collapse.** Two library entries pointing at the same bytes produce one archive entry.
- **Ids are stable across saves.** They are a property of the content, not of a save operation, so
  projects diff and sync sensibly.
- **The archive is self-verifying.** The reader hashes each entry and compares it with the name it is
  filed under. A mismatch means the entry was tampered with or corrupted, and the id in the name can
  no longer be trusted, so the entry is dropped with an `unreadableEntry` warning rather than loaded.

## Loading is lenient about media and strict about structure

A `.videola` that is not a well-formed archive, or whose `videola.json` or `project.json` is missing,
unparseable or oversized, fails outright with `NotAProject`. There is nothing useful to recover.

Everything else degrades to a warning, so one damaged asset costs a relink rather than the project:

| Warning | Meaning |
|---|---|
| `missingMedia` | `project.json` references an asset with no entry in `media/` |
| `unreadableEntry` | an entry under `media/` has an unusable name, failed to decompress, or does not hash to its own name |
| `migrated` | the file declared an older `schemaVersion` and was upgraded on load |
| `manifestMismatch` | `videola.json` and `project.json` disagree on the named field |

Clips whose media is missing keep every parameter, so relinking the asset restores the project
rather than requiring the edit to be redone.

Three size caps protect the loader, and they matter because this crate also runs as
`wasm32-unknown-unknown`, where `usize` is 32-bit and a browser tab's linear memory is well under
4 GiB:

| Cap | Value | Applies to |
|---|---|---|
| JSON entry | 64 MiB | `videola.json`, `project.json` |
| Media entry | 512 MiB | one entry under `media/` |
| Media total | 2 GiB | all media entries of a single load, combined |

The JSON cap is deliberately far below the media cap: a media entry decompresses into bytes, but a
JSON entry decompresses into a `serde_json::Value` tree whose object nodes and string allocations
cost several times the raw size. The caps are checked against the declared entry size *before*
anything is decompressed, and the read is then bounded again in case the header lied.

## Schema version

`SCHEMA_VERSION` is currently `1`. The rules the loader applies, in order:

1. **Absent `schemaVersion` means version 1.** A file written before the field existed is genuinely
   version 1, so a missing key is not an error.
2. **A present but non-integer `schemaVersion` is an error.** A float, a string or a number too large
   for an `i64` is not a version this loader understands and must not be coerced into one.
3. **A version newer than `SCHEMA_VERSION` is refused** with `UnsupportedSchema`. Guessing at a
   future schema is how a newer file gets quietly damaged.
4. **An older version is migrated, and the migration is reported** as a `migrated` warning carrying
   the `from` and `to` versions.

Migration runs on the parsed JSON tree, before the model is deserialised. That is what makes it
possible to rename or restructure fields without keeping an obsolete struct definition around for
every past version of the schema.

After deserialisation the model is normalised once: every keyframe track is sorted by time (keyframe
evaluation binary-searches and assumes that ordering), and every `Time` field — including those
inside nested compound timelines — is bounds-checked. A project with impossible times fails loudly at
load rather than misbehaving later. Compound clip nesting is capped at eight levels.

## Unknown fields survive a round trip

`Project`, `Timeline`, `Clip` and `Effect` each carry a `#[serde(flatten)]` catch-all map. Any field a
reader does not recognise is captured on load and written back on save, in sorted order.

This is what stops an older Videola from destroying a newer file. Open a project written by a future
version, change the title, save: the fields that version added are still there. Without it, "open
and save" would be a lossy operation against any file newer than the application reading it.

A practical consequence for anyone extending the format: adding a field to one of those four types is
backwards-compatible in both directions. Adding one elsewhere is not, because there is nowhere for an
older reader to keep it.
