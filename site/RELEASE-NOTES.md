# Notarized Mac first launch — 2026-09-28

Replace the obsolete ad-hoc signing warning and Open Anyway workaround with the signed and notarized status shipped in DuckTerm v0.4.82. Keep separate CLI/tmux prerequisites until the bundled-server release.

Lesson: first-launch instructions must track the downloadable app’s signing status, not an earlier build.

# Mac download correction — 2026-09-27

Reuse the approved hero button for the stable Apple Silicon Mac ZIP. Keep the latest release page available, resolve the CLI wheel through GitHub with five-minute revalidation and a readable fallback, and explain external CLI/tmux prerequisites and the first-launch Privacy & Security step. The demo download remains the MP4 recording.

Lesson: check documentation anchors against the current README heading (Install). A current download page needs both a stable app URL and a release-aware CLI command; test the complete first-launch path instead of only the ZIP response.

# DuckTerm website refresh — 2026-09-25

Approved design: current DuckTerm branding, real-dashboard recording with fictional content, current installation instructions, and canonical domain duckterm.utsava.xyz.

Validation: production build, type checks, desktop/mobile playback and reduced-motion checks. Compatible dependency patches and PostCSS override remove known audited vulnerabilities.

Lesson: use the actual product UI for the marketing demo; manually approximated panels and animation diverged from the real app. Verify the new domain serves the new deployment before reporting completion.
