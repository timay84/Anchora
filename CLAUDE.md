# Anchora Development Guide

## Product shape

Anchora is a local-first Tauri 2 desktop app for mindful productivity. The two primary records are daily tasks and mindful moments. The focus timer must remain dismissible through snooze and end controls.

## Repository layout

- `src/`: React + TypeScript UI, storage adapter, domain types, and styles.
- `src-tauri/src/`: Rust commands, system tray setup, monitor discovery, and native file export.
- `src-tauri/tauri.conf.json`: desktop window and build configuration.
- `requirements.md`: product requirements and acceptance context.

## Development commands

- `npm run dev`: start the Vite frontend.
- `npm run build`: type-check and build the frontend.
- `npm test`: run Vitest tests.
- `npm run tauri dev`: run the complete desktop app (requires Rust and platform prerequisites).

## Implementation rules

- Keep user data local. Use the versioned `anchora:data:v1` storage key and extend `AppData` deliberately.
- Keep timer/reminder controls non-blocking: always preserve snooze, end, and close actions.
- Native functionality belongs behind Tauri commands in `src-tauri/src/lib.rs`; the UI must tolerate browser/Vite mode where `invoke` is unavailable.
- Use React components for feature boundaries and Tailwind utilities only when they improve readability; shared visual tokens live in `src/styles.css`.
- Any new persisted field needs a safe default and a storage test.
- Do not commit `node_modules`, `dist`, or `src-tauri/target`.

## Verification

Run `npm test` and `npm run build` before submitting UI changes. Run `cargo check` from `src-tauri` on a machine with Rust installed before changing native commands.
