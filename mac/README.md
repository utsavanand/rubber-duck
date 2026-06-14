# Rubberduck.app (macOS menu-bar app)

A native menu-bar wrapper around the local Rubberduck dashboard. The UI is the
**same** dashboard you get in the browser — it's loaded in a `WKWebView` against
`http://127.0.0.1:4200`, so there's one UI codebase, not a reimplementation.

## What it does
- Lives in the menu bar (`🦆`), no Dock icon.
- Starts `rubberduck serve` on launch (or attaches to one already running) and
  stops it on quit — `ServerProcess.swift`.
- **Open dashboard** opens the dashboard in a native window — `DashboardWindow.swift`.
- Polls `/sessions` for a menu-bar count (busy · waiting · idle) and fires a
  native notification when a session starts waiting on you — `SessionPoller.swift`.

## Build
Requires a working Swift toolchain with the macOS SDK. **Full Xcode is
recommended.** The standalone CommandLineTools 16.4 SDK ships a broken module map
(duplicate `SwiftBridging`) that fails to import AppKit; if you hit
`redefinition of module 'SwiftBridging'`, install Xcode and point the toolchain
at it:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

Then:

```sh
./build.sh          # -> build/Rubberduck.app
./build.sh --run    # build and launch
```

The build compiles the sources directly with `swiftc` (not SwiftPM) into an
ad-hoc-signed `.app`. That runs on this machine; distributing to others needs
code-signing + notarization with an Apple Developer account (not set up here).

## Verify (smoke test, once it builds)
1. `./build.sh --run` — the `🦆` appears in the menu bar.
2. The menu shows a live count; **Open dashboard** shows the three-panel UI.
3. In the window: the **Pulse** feed streams live (SSE works in WKWebView), and a
   row action (Stop / Checkpoint) succeeds (auth token + same-origin work in the
   embedded web view).
4. Make a session wait on input → a native notification fires.

## Status
Menu-bar app + server lifecycle + dashboard window + notifications are
implemented. Native (non-WebView) panels are intentionally out of scope — see
the roadmap.
