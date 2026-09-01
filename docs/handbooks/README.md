# Nexus Handbooks

Handbooks explain durable product and operator workflows. Markdown under `markdown/` is authoritative; `html/` is generated and must not be edited by hand. Technical companions under `technical/` document component boundaries that support the workflows.

## Walkthroughs

- [Generation recovery and validation](markdown/generation-recovery.md)
- [Architecture atlas](markdown/atlas.md)

## Technical companions

- [Installer repair and runtime state](technical/installer-runtime.md)
- [Local media runtime](technical/media-runtime.md)
- [Transcript and Agents workspace](technical/transcript-and-workspaces.md)

Run `npm run docs:handbooks` after editing Markdown and `npm run docs:handbooks:check` in verification.
