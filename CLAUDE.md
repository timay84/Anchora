# Anchora Development Guide

## Product shape

Anchora is a local-first Tauri 2 desktop app for mindful productivity. Its records are mindful moments, daily tasks, and focus-session work caches. The timeline supports date-based browsing, creation, editing, deletion, and forwarding between record types.

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
- `npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis,msi`: build Windows x64 installers.
- `npm run tauri build -- --target aarch64-pc-windows-msvc --bundles nsis,msi`: build Windows on ARM64 installers.

## Implementation rules

- Keep user data local. Use the versioned `anchora:data:v1` storage key and extend `AppData` deliberately.
- Keep timer/reminder controls non-blocking: always preserve snooze, end, close, summary save, and emergency lock-exit actions.
- Calculate focus, reflection, and lock deadlines from the session's persisted timestamps; snapshot the user settings when a session starts.
- Persist forwarding metadata (`sentTo` and `sentAt`) for moments and tasks, preserve the original record, and mark forwarded records complete and non-editable.
- Use the computer's local timezone for record dates and display times; Markdown serialization and parsing must preserve forwarding metadata.
- Moments, tasks, and work caches may be copied to any record type, including the same type, with a selectable target date; the source remains marked as forwarded.
- Timeline Vault reconnects must read the new Vault before writing, merge local and Vault records, and never overwrite an existing daily note before it has been imported.
- Native functionality belongs behind Tauri commands in `src-tauri/src/lib.rs`; the UI must tolerate browser/Vite mode where `invoke` is unavailable.
- Use React components for feature boundaries and Tailwind utilities only when they improve readability; shared visual tokens live in `src/styles.css`.
- Any new persisted field needs a safe default and a storage test.
- Do not commit `node_modules`, `dist`, or `src-tauri/target`.

## Verification

Run `npm test` and `npm run build` before submitting UI changes. Run `cargo check` from `src-tauri` on a machine with Rust installed before changing native commands.
The current frontend test suite contains 8 Vitest tests.

## Windows packaging

- Product name is `Anchora`; the stable application identifier is `com.timay84.anchora`.
- Installer targets are `nsis` (`.exe`) and `msi` (`.msi`), configured in `src-tauri/tauri.conf.json`.
- Icons are stored in `src-tauri/icons/`; the Windows installer uses `icons/icon.ico` and the PNG sizes listed in the configuration.
- For Windows on ARM64, install the Rust target once with `rustup target add aarch64-pc-windows-msvc`, then run the ARM64 build command above from the repository root.
- The ARM64 build requires Visual Studio Build Tools with the MSVC ARM64 toolchain and Windows SDK. Artifacts are written under `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/`.
- For Windows x64, install the Rust target once with `rustup target add x86_64-pc-windows-msvc`, then run the x64 build command above from the repository root. Artifacts are written under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`.
- Release builds hide the Windows console; closing the main window hides it to the system tray instead. Left-click the Anchora tray icon to toggle the window, and use the tray menu's `退出` item to terminate the process.

## Obsidian Vault

- The Settings page can select an Obsidian Vault directory using the native dialog.
- Anchora writes daily records to `<vault>/Anchora/Daily/YYYY-MM-DD.md` using the two-section Markdown template.
- The timeline reads daily Markdown files from that directory and can open a selected note with the system default application.
- LocalStorage remains the draft/settings cache. Daily Markdown is the shared record format for Anchora and Obsidian.
- The current sync path is local and same-machine. Avoid editing the same daily file concurrently until conflict-aware merging is implemented.
