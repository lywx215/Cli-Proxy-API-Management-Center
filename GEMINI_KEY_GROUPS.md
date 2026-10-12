# Gemini API Key groups

Gemini opens in the **Groups** view. Each group stores shared settings once; Keys without an override inherit current group settings. **All Keys** retains search, pagination and selection across groups. View and page-size preferences are remembered, while credential input and edit drafts remain in page memory.

## Adding credentials

Choose **Add Keys** on an existing group, or create a group and continue to its import dialog. Paste one Key per line or import a TXT file. A submission accepts at most 1,000 nonblank lines; TXT files are limited to 1 MiB.

The preview trims surrounding whitespace, ignores blank lines and skips duplicates within the input or target group. It reports invalid line numbers and warns about credentials already present in other groups. Cross-group duplicates are allowed. Custom upstream credentials do not require a Google-specific prefix.

Import saves the complete raw group list through one conditional `PUT /v8/management/config/api-keys/gemini`. It does not create each Key separately or copy shared settings onto the imported Keys. Previews mask credential values, including short Keys.

## Shared settings and exceptions

**Edit shared settings** updates only fields changed in the dialog. Bulk group edits show current values from the first selected group and apply changed fields to every selected group. Model lists and header maps are replaced as complete fields, rather than merged with individual entries. The preview counts inherited Keys and preserved exceptions for each changed field.

The Key editor explicitly separates inheritance from an individual override. The service URL belongs to the group; weight belongs to each Key. Missing or null shared fields inherit. An explicit empty header map or model list is an override; `models: []` selects the default model catalog, rather than disabling all models.

**Restore inheritance** deletes only the selected override fields. Other settings, weight and credential values are preserved. Selecting a group's checkbox selects all of its Keys, including rows hidden by filters; selecting a table page affects only that page.

Global Gemini model aliases continue to use the existing alias page and migration tools.

## Conflicts and consolidation

Saves include the snapshot revision in `If-Match`. A conflict retains the draft and requires reloading and a new preview. Targets are relocated only when their identities can be confirmed. Import drafts whose groups changed require choosing a target again. Uncertain save results require checking the latest configuration before retrying. **Saved** confirms configuration persistence, not completion of runtime hot reload.

**Merge identical groups** is a separate, explicit operation. It compares raw defaults, missing/null states, ordered models, supported advanced metadata and effective Key settings. It retains the earliest group's name and concatenates Keys in original order, preserving weight and credential identity. It never deduplicates existing credentials.

Ambiguous duplicate identities and unknown configuration fields that cannot be moved safely are excluded and reported. The current backend binds unknown extensions to their existing owners and locations. Such fields are preserved by ordinary edits but are not assumed safe to relocate during consolidation. Business header names are not configuration extensions.

This frontend change uses existing v8 APIs and requires no production migration. It does not add a template system or use deprecated v0 management endpoints.
