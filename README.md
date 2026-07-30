# browser-copilot

Let an AI agent drive **your actual browser window** on macOS: your tabs, your logged-in
sessions, with a **visible cursor** so you can watch what it does.

No separate profile. No second browser. No re-authentication. No extension.

```bash
node copilot.mjs focus stripe     # grabs your already-authenticated Stripe tab
node copilot.mjs look page.png    # screenshot + numbered badges on every clickable element
node copilot.mjs click 17         # cursor glides there, highlights it, clicks
```

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

Screenshots need the Screen Recording permission granted **to CC Shot** the first time.

## Commands

```bash
node copilot.mjs tabs                  # every open tab
node copilot.mjs focus stripe          # bring a tab to the front (url or title match)
node copilot.mjs nav https://...       # navigate the active tab
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

Agent loop: `look` → read the annotated screenshot → `click <ref>` → `look` to verify.
The number drawn on the image **is** the ref you pass to `click`. Refs are invalidated by
a re-render, so `snap` again after every action.

## The visible cursor

`overlay.js` injects, inside a **shadow root** (zero interference with the host page's
CSS), an arrow, a label, and:

- an eased glide toward the target (450 ms) so you can follow the intent
- an outline on the element about to be clicked
- a ripple on click

You see where the agent is going before it gets there. That's the difference between a
tool you supervise and a tool you hope about.

## How the screenshots work

`screencapture` is a dead end here. The Screen Recording permission is attributed to the
process that *invokes* it, meaning every new agent runtime needs its own grant. And
`-R` can't handle a window on a secondary display with a negative origin.

So `shot` shells out to **CC Shot**, a small Swift + ScreenCaptureKit app (`ccshot.swift`).
Two things fall out of packaging it as an app launched via `open`:

1. The permission belongs to **the helper**, granted once, forever, from any harness.
2. It captures **by window ID**: immune to negative-origin displays and to occlusion.
   The browser can be fully behind another window and the capture is still correct.

Because `open` detaches, the result comes back through a `<out>.status` sidecar file.

## Known limits

- Events are **synthetic** (`isTrusted: false`). Clicks, links, forms, React: covered.
  File pickers, `requestFullscreen`, camera/mic permissions, native drag & drop: not.
- React's `onMouseEnter` doesn't always fire on a synthetic `mouseover`. Prefer `click`.
- One tab at a time: the focused one.
- Rebuilding `ccshot` **invalidates the Screen Recording grant** (it's bound to the
  binary's cdhash under ad-hoc signing). After a rebuild:
  `tccutil reset ScreenCapture <bundle-id>`, then re-enable it in System Settings.

## Gotchas found the hard way

- **Dia already JSON-encodes** the return value of `execute javascript` before handing it
  to AppleScript. You need **two** `JSON.parse` calls: one to strip Dia's layer, one for
  your own payload. Miss it and you get a string where you expected an object.
- **`SCContentFilter` aborts without an `NSApplication`.** It reaches into SkyLight
  (`SLSGetDisplaysWithRect`), which asserts `CGS_REQUIRE_INIT` in a plain CLI binary.
  `_ = NSApplication.shared` before any ScreenCaptureKit call fixes it.
- **Dia has no `quit` in its scripting dictionary** but still responds to the AppleScript
  `quit` by showing a confirmation dialog. If nobody clicks it, your script just hangs.
- JavaScript travels **base64-encoded** from Node through AppleScript into the browser.
  Quoting and non-ASCII stop being a problem entirely.

## Security

This gives an agent access to **everything open in your browser**, banking included.
That's the point, and it's a real widening of the blast radius. Use it deliberately.
For anything sensitive, a dedicated browser profile is the safer trade.

## License

MIT
