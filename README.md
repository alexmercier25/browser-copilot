# browser-copilot

Let an AI agent drive **your actual browser window** on macOS: your tabs, your logged-in
sessions, with a **visible cursor** so you can watch what it does.

No separate profile. No second browser. No re-authentication. No extension.

```bash
node copilot.mjs attach stripe    # targets your already-authenticated Stripe tab
node copilot.mjs look page.png    # screenshot + numbered badges on every clickable element
node copilot.mjs click 17         # cursor glides there, highlights it, clicks
```

`attach` targets a tab **by ID**, so the agent drives it in the background while you keep
working in another tab. Your focus is never stolen.

## Why this exists

Every "browser use" tool hits the same wall on macOS:

- **CDP is closed.** Since Chrome 136, `--remote-debugging-port` is **refused on the
  default profile**. A separate `--user-data-dir` gives you a blank profile, so none of
  your sessions. Copying the profile doesn't help: cookies are encrypted per-Keychain.
- **Playwright/Puppeteer launch their own browser.** Fresh profile, logged out of
  everything, and a second window competing with yours.
- **Vendor extensions are locked to one harness.** Claude in Chrome only attaches to the
  interactive CLI: nothing for an SDK runtime, a cron job, or a remote agent.

The way through: **Dia** (a Chromium-based browser) exposes an AppleScript command,
`execute <tab> javascript`. That's the same power CDP gives you over a page, except it
runs against **your real profile** and works from **any harness**, including headless
runtimes that can't load a browser extension.

## Requirements

- macOS, [Dia](https://www.diabrowser.com/), Node 18+, Xcode command line tools (`swiftc`)
- Any Chromium browser exposing `execute ... javascript` over AppleScript works: set
  `CC_BROWSER` / `CC_BROWSER_APP`.

## Install

```bash
git clone https://github.com/alexmercier25/browser-copilot
cd browser-copilot
./install.sh          # builds the CC Shot helper + a relaunch app
./relaunch.sh         # restarts Dia with --enable-applescript-javascript
```

Dia asks for confirmation when quitting: click **Quit**. Its tabs are persisted in its
own store, so they all come back.

To keep the bridge on across restarts, put **`~/Applications/Dia Copilot.app`** in your
Dock in place of Dia.

Screenshots use your harness's own Screen Recording permission when it has one, and
fall back to the CC Shot helper otherwise.

## Commands

```bash
node copilot.mjs tabs                  # every open tab
node copilot.mjs attach stripe         # target a tab, focus untouched (url or title match)
node copilot.mjs focus stripe          # target it AND bring it to the front
node copilot.mjs target                # which tab is currently targeted
node copilot.mjs nav https://...       # navigate the targeted tab
node copilot.mjs snap                  # inventory of clickable elements -> refs
node copilot.mjs snap invoice          # filtered inventory
node copilot.mjs read 4000             # page text
node copilot.mjs look shot.png         # snap + numbered badges + screenshot
node copilot.mjs click 42              # cursor glides to ref 42, then clicks
node copilot.mjs fill 7 "hello"        # React-safe text entry
node copilot.mjs press Enter
node copilot.mjs hover 12
node copilot.mjs scroll 600
node copilot.mjs say "Reading invoices" # change the cursor label
node copilot.mjs shot out.png
node copilot.mjs eval 'return document.title'
```

Agent loop: `attach` → `snap` → `click <ref>` → `snap` to verify. Refs are invalidated by
a re-render, so `snap` again after every action.

Reach for `look` when the agent genuinely needs to *see* the page: the number drawn on
the image **is** the ref you pass to `click`. It costs a focus switch (see below), so
prefer `read` and `eval` when text is enough.

## The visible cursor

`overlay.js` injects, inside a **shadow root** (zero interference with the host page's
CSS), an arrow, a label, and:

- an eased glide toward the target (450 ms) so you can follow the intent
- an outline on the element about to be clicked
- a ripple on click

You see where the agent is going before it gets there. That's the difference between a
tool you supervise and a tool you hope about.

## How the screenshots work

Capturing **by window ID** is the whole trick. `screencapture -R x,y,w,h` looks obvious
and is wrong: it silently fails on a window sitting on a secondary display with a
negative origin, and it captures whatever is on top rather than the window you asked for.
By ID, occlusion and display geometry stop mattering.

`ccwin.swift` resolves the ID. `CGWindowListCopyWindowInfo` returns window numbers, owners
and bounds **without** the Screen Recording permission (only window *titles* and pixels
need it), so the lookup is free.

`shot` then tries two paths in order:

1. **`screencapture -o -l <windowID>`** — uses the calling process's permission. If your
   harness already has Screen Recording, there is nothing to install and nothing to grant.
2. **CC Shot** (`ccshot.swift`, Swift + ScreenCaptureKit, packaged as an app) — a fallback
   that owns *its own* permission, so it works from a runtime that has none. Because
   `open` detaches the process, the result comes back through a `<out>.status` sidecar.

Path 1 covers most setups. Path 2 exists for headless or sandboxed runtimes.

## Known limits

- Events are **synthetic** (`isTrusted: false`). Clicks, links, forms, React: covered.
  File pickers, `requestFullscreen`, camera/mic permissions, native drag & drop: not.
- React's `onMouseEnter` doesn't always fire on a synthetic `mouseover`. Prefer `click`.
- One targeted tab at a time.
- **`look` and `shot` briefly steal focus.** A hidden tab isn't rendered, so there are no
  pixels to capture. Both bring the target forward, capture, and hand focus back to the
  tab you were on. Everything else runs fully in the background.
- Under **ad-hoc signing**, rebuilding `ccshot` **silently revokes the Screen Recording
  grant**: macOS binds it to the binary's cdhash. `install.sh` signs with a Developer ID
  when it finds one, which binds the grant to the signing identity instead and survives
  rebuilds. Without one, run `tccutil reset ScreenCapture <bundle-id>` after each
  rebuild and re-enable it in System Settings.

## Gotchas found the hard way

- **Dia already JSON-encodes** the return value of `execute javascript` before handing it
  to AppleScript. You need **two** `JSON.parse` calls: one to strip Dia's layer, one for
  your own payload. Miss it and you get a string where you expected an object.
- **`SCContentFilter` aborts without an `NSApplication`.** It reaches into SkyLight
  (`SLSGetDisplaysWithRect`), which asserts `CGS_REQUIRE_INIT` in a plain CLI binary.
  `_ = NSApplication.shared` before any ScreenCaptureKit call fixes it.
- **Dia has no `quit` in its scripting dictionary** but still responds to the AppleScript
  `quit` by showing a confirmation dialog. If nobody clicks it, your script just hangs.
- **The Screen Recording prompt has no "Allow" button.** It only offers "Open System
  Settings", because you must tick the app yourself in the list. And the app only *shows
  up* in that list while its process is **alive**. A helper that requests permission and
  exits a second later leaves the user staring at a list it isn't in. Hence the wait loop
  in `ccshot.swift`. You can also add the bundle by hand with the list's `+` button.
- JavaScript travels **base64-encoded** from Node through AppleScript into the browser.
  Quoting and non-ASCII stop being a problem entirely.
- **Never drive `active tab of front window`.** It looks like the obvious target and it
  costs you the whole point: the human can't use their browser while the agent works, and
  worse, the agent silently retargets whenever focus drifts mid-task. Addressing a tab by
  ID fixes both. JS runs fine in a hidden tab: `document.hidden` is true but layout is
  intact, so `getBoundingClientRect` and clicks behave normally.

## Security

This gives an agent access to **everything open in your browser**, banking included.
That's the point, and it's a real widening of the blast radius. Use it deliberately.
For anything sensitive, a dedicated browser profile is the safer trade.

## License

MIT
