You are reviewing the kiri repo for quality and consistency issues the
maintainer might want to know about. Walk the repo with Read, Glob,
and Grep — keep it read-only.

Read these first for context:

- CLAUDE.md (working instructions)
- docs/design-notes.md (architecture)
- docs/milestones.md (build sequence and design invariants)

Then walk src/, bin/, scripts/, workflows/. Flag findings that fit any
of these categories — be concrete, cite file paths and line ranges:

- Bugs or logic errors
- Patterns that drift from existing codebase conventions
- Missing test coverage where neighbouring code is well-tested
- Stale references after recent renames (filenames, symbols, paths)
- Documentation drift between docs/ or README.md and the actual code
- Violations of the design invariants in docs/milestones.md

Skip cosmetic nits unless they obscure intent. Don't propose fixes —
just call out the issues so the maintainer can triage.

Keep your final message tight: a one-paragraph summary, then findings
grouped by file path. If nothing of substance turns up, say so.
