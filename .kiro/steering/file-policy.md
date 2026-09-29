# Agent File Generation Policy

## Permitted Source Code Creation
- You ARE ALLOWED to create new source files (e.g., components, utility modules, routes, services, models) whenever building new features or when modularity requires a new file.
- Always place newly created source files into their standard domain directories (e.g., `src/components/`, `src/lib/`, `src/app/`).

## Spec File Location Scope
- Spec and planning files (`requirements.md`, `design.md`, `tasks.md`) are STRICTLY PERMITTED ONLY inside the `.kiro/` directory.
- NEVER create, move, or duplicate spec files anywhere outside of `.kiro/`.
- Everytime, when you make changes update the PROJECT_STATUS.MD at the end of the chat.

## Restrictive Constraints
- DO NOT create Markdown files (`*.md`), documentation files, or changelogs outside the `.kiro/` folder.
- DO NOT create unit or integration test files (`*.test.*`, `*.spec.*`, `*_test.*`, or `tests/`) unless explicitly requested in the user prompt.
- DO NOT generate redundant wrapper files, empty index exports, or micro-abstractions that bloat the feature structure.

## Execution Rules
- Update existing files in-place for small edits or feature tweaks.
- Create new implementation files ONLY when genuinely needed to build the requested feature modularly and cleanly.