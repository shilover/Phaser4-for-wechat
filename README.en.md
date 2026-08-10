[中文](README.md) | English

# Phaser4 in WeChat Mini Game — Minimal Feasibility Spike

Purpose: the main Phaser project is built on Phaser 4.0.0. Before committing to the
WeChat Mini Game platform, it was necessary to confirm whether "Phaser 4 can run
directly in the Mini Game runtime" holds, rather than assuming a downgrade to
Phaser 3 is required. This repository is the minimal, reproducible spike for that
verification.

This spike was carried out against a mobile game project.

Below is the Mini Game integration example from that project, verified to run
correctly in WeChat DevTools:
https://github.com/shilover/CuteLandFarm/tree/phaser4-wechat-minigame
![alt text](images/Phaser4-wechat-minigame.png)

## Status

- **CANVAS render mode: verified.**
- **WEBGL render mode: verified.** (This is the mode the production scenes use —
  CANVAS cannot sustain the rendering load of Tween, Graphics rounded panels, and
  procedural icons at that scale.)

Summary of verified capabilities:

- Rendering (both CANVAS and WEBGL modes)
- Touch input (tap to change color, drag to follow)
- `wx.setStorageSync` persistence (survives rebuilds and render-mode switches)
- Loading real image textures
- `Graphics.generateTexture` texture baking
- Loading JSON config files (`this.load.json()`)
- Audio loading, decoding, and playback (`this.load.audio()` + `this.sound.play()`,
  backed by a native `AudioContext`)
- Tween animation driving a Container
- Multi-scene switching (`scene.start`) combined with camera `fadeOut`/`fadeIn`

Both render modes confirmed the following work correctly: rendering; touch input
(tap to change color, drag to follow); `wx.setStorageSync` counter persistence
across rebuilds and render-mode switches; loading real image textures;
`Graphics.generateTexture` texture baking (a technique `ProceduralIcons.ts` relies
on heavily); loading JSON config files (`this.load.json()`, the same path used by
the main project's `hero.json`/`item.json` and similar resources); audio loading,
decoding, and playback (`this.load.audio()` with `this.sound.play()`, with audible
playback confirmed) — this environment provides a genuine native `AudioContext`,
so Phaser automatically selects the fully-featured `WebAudioSoundManager` rather
than a degraded no-op implementation, which was the most unexpected positive
result of this spike, since audio has historically been considered the part of
Mini Game adaptation most prone to failure; Tween animation driving a Container,
and scene switching (`scene.start`) combined with camera `fadeOut`/`fadeIn` (the
latter is the core technique behind the `goToScene` helper in the main project's
`SceneTransition.ts`, while the former underlies UI effects used throughout the
project — button hover, panel pop-ups, settlement number scrolling).

Conclusion: Phaser 4.0.0 (the same version as the `design` branch of the main
Phaser project) runs correctly in both render modes under the WeChat Mini Game
environment. The premise "does this need to be downgraded to Phaser 3" no longer
holds — the current assessment is that no downgrade is necessary. To switch which
render mode is exercised, change the `type: Phaser.WEBGL` / `Phaser.CANVAS` line
in `game.js`.

## Getting Started

Run this in the root of the cloned repository (the directory containing
`package.json`):

```
npm install
```

After installation, open that same repository root in WeChat DevTools, then
click "Tools" → "Build npm", followed by "Compile" (rebuild npm again whenever
dependencies change; not required for code-only changes).

`project.config.json` uses `touristappid` (tourist mode) for the `appid` field,
so anyone can open and verify it locally without configuring their own AppID.

## Key Files

- `game.js`: entry point, sets up a minimal Phaser Scene (draws a rectangle and
  text, supports touch-to-change-color/drag-to-follow, persists a tap counter)
- `weapp-adapter.js`: **core file** — the minimal shim layer that lets Phaser
  believe it's running in a browser; written entirely from scratch, with no
  dependency on any community weapp-adapter
- `scripts/patch-phaser.js`: runs automatically after `npm install`, patches
  `node_modules/phaser`'s `package.json` (see below for why)

## Issues Encountered (chronological)

1. **`window` is a getter-only property** — `GameGlobal` itself is a
   Window-like host object pre-provided by this version of the runtime;
   assigning directly via `GameGlobal.window = xxx` throws in strict mode. Fix:
   check `Object.getOwnPropertyDescriptor` first to see whether the property is
   configurable; skip the assignment and use the runtime's own object if it
   isn't.
2. **`document` exists, but `documentElement` is `undefined`** — again a
   pre-provided, incomplete object that can't be replaced wholesale (it's
   flagged non-configurable); it can only be patched in place to fill in the
   missing fields.
3. **Phaser 4's `package.json` `main` field points at the uncompiled source
   directory** (`./src/phaser.js`) — WeChat's "Build npm" tool doesn't
   understand the new `exports` field, so it falls back to `main`, pulling in
   the entire uncompiled source tree (including the unused WebGL debugging tool
   `phaser3spectorjs`). Fix: `scripts/patch-phaser.js` rewrites `main` to
   `./dist/phaser.js`.
4. **SpectorJS (the WebGL debugging tool baked into the Phaser dist bundle)
   unconditionally runs a round of DOM operations during Game initialization**
   — this fires regardless of whether WEBGL mode is selected, requiring stub
   implementations for `document.head`, `document.querySelector('html')`
   (confirmed by reading the source — not `'head'`), `getElementsByTagName`,
   and a handful of other query methods.
5. **`requestAnimationFrame` is actually provided natively by this version of
   the runtime** — the initial implementation delegated it to
   `canvas.requestAnimationFrame`, but that method doesn't exist on the canvas
   instance, so this ended up shadowing a perfectly usable native
   implementation. Lesson: for globals that "seem like they should exist",
   check for presence first rather than overwriting blindly.
6. **`document.elementFromPoint` is missing** — Phaser's touch-move handling
   relies on it to determine which element sits under the touch point; since
   the only element present is the single canvas, it can simply return itself.
7. **`gl.bindVertexArray is not a function` after switching to WEBGL mode** —
   the root cause wasn't a missing runtime capability but a self-inflicted
   issue: `WebGLRenderingContext` had earlier been shimmed as an empty
   function (to avoid `instanceof` checks throwing on an undefined
   identifier). This caused a critical internal Phaser check —
   `gl instanceof WebGLRenderingContext`, used to decide whether to patch
   WebGL2 methods like `bindVertexArray` from the `OES_vertex_array_object`
   extension onto a WebGL1 `gl` object — to always evaluate to `false`,
   silently skipping Phaser's own WebGL1 compatibility patch. Fix: probe a
   real `canvas.getContext('webgl')` and use its actual constructor
   (`Object.getPrototypeOf(gl).constructor`) instead of an arbitrary empty
   function. Lesson: when stubbing a "type identifier" placeholder, only a
   constructor from a genuine source is safe — an arbitrary constructor can
   silently change the result of `instanceof` checks and introduce new bugs.

8. **Image loading fails with `XMLHttpRequest is not defined`** — reading the
   Phaser source revealed that the default `ImageFile` loader uses
   `XHR + responseType: 'blob'`, then converts the Blob to `img.src` via
   `File.createObjectURL(img, xhr.response, 'image/png')` once loaded — this
   matches the known limitation surfaced during earlier research ("modern
   Phaser relies heavily on Blob, which weapp-adapter can't emulate"), and the
   Mini Game environment simply has no Blob/XHR support. Rather than hand-write
   a Blob compatibility layer, the source revealed a built-in Phaser switch:
   setting `loader: { imageLoadType: 'HTMLImageElement' }` in the Game config
   switches to an entirely different load path (`ImageFile.loadImage`), which
   uses `new Image()` with `.src`/`.onload` directly, touching neither
   XHR nor Blob — a perfect match for the `Image` implementation in the shim
   layer. Note: JSON/text resources most likely still go through XHR; this fix
   only addresses the image-loading case.
9. **JSON loading fails with the same `XMLHttpRequest is not defined` error,
   but with no equivalent `imageLoadType` switch to work around it** —
   `JSONFile` uses `responseType: 'text'` and doesn't involve Blob. Reading the
   source confirmed that `XHRLoader` only actually touches the methods and
   properties `open`/`setRequestHeader`/`overrideMimeType`/`send`/`onload`/
   `onerror`/`status`/`readyState`/`response`/`responseText`, so a minimal
   working `XMLHttpRequest` class was implemented against just that surface:
   local relative paths (without an `http(s)://` prefix) are read via
   `wx.getFileSystemManager().readFile()`, while remote URLs go through
   `wx.request()`. Verified working — Phaser's config-file loading path
   functions correctly.
10. **Audio loading turned out to be mostly trouble-free** —
    `this.load.audio()` uses `responseType: 'arraybuffer'`, and simply reusing
    the `XMLHttpRequest` shim built for JSON loading works out of the box
    (local files read via `wx.getFileSystemManager().readFile()` without
    specifying `encoding` default to ArrayBuffer). More unexpectedly, this
    version of the Mini Game runtime provides a genuine native `AudioContext`
    (`typeof AudioContext === 'function'`), so Phaser automatically selects
    the fully-featured `WebAudioSoundManager` for decoding and playback, with
    no additional audio compatibility code required.
11. **Tween, Container, multi-scene switching, and camera `fadeOut`/`fadeIn`
    all worked without a single issue** — once the browser-global shim layer
    from earlier rounds was in place, Phaser's own object model (Tween,
    Container, SceneManager, camera post-processing) worked exactly as
    expected, with no further adaptation needed.

The overall takeaway from this spike: this version of the Mini Game runtime
(`GameGlobal`) already pre-provides a fair number of "browser-like" partial
global objects (`window`, `document`, etc.), which is a different situation from
the traditional weapp-adapter approach of "a completely blank environment where
everything must be built from scratch" — when an error surfaces, the first
question should be whether the object "already exists but is merely
incomplete", rather than reaching straight for a full replacement.

## FAQ: Why does `phaser3spectorjs` (note the "3") show up in a Phaser 4 project?

This is a legacy dependency carried over by the Phaser 4.0.0 package itself, for
the following reasons:

1. **The name is a historical holdover** — it's one of the `devDependencies` in
   `node_modules/phaser/package.json`. This WebGL debugging tool was originally
   built during the Phaser 3 era, and the Phaser team kept the same package
   name after upgrading to 4.0 rather than renaming it to
   `phaser4spectorjs`.
2. **Why this project's own `package.json` declares it explicitly** — this
   traces back to issue #3 above: Phaser 4's `package.json` uses the new
   `exports` field, which WeChat's "Build npm" tool doesn't support, so it
   falls back to reading `main`. Without the `patch-phaser.js` patch applied,
   `main` points at the uncompiled source directory `./src/phaser.js`, which
   contains genuine `require('phaser3spectorjs')` calls (used by the WebGL
   debug renderer). As "Build npm" walks the dependency graph along those
   require statements, it will fail outright with a "module not found" error
   if `phaser3spectorjs` isn't installed in `node_modules`. Declaring it
   explicitly as a direct dependency of this project ensures it's always
   present, regardless of whether the build pipeline happens to hit that
   fallback path.
3. **It's never actually invoked at runtime** — the file that's actually in
   effect is `node_modules/phaser/dist/phaser.js` (the production build, i.e.
   the file `patch-phaser.js` redirects `main` to), and lines 185967–185969 of
   that file read:

   ```js
   if (false)
   // removed by dead control flow
   { var SPECTOR; }
   ```

   The Phaser team builds their dist bundle with a `DEBUG=false` flag, and
   webpack eliminates the `require('phaser3spectorjs')` branch as dead code
   under that flag. So the `phaser3spectorjs` directory that ends up inside
   the built `miniprogram_npm` output is never actually invoked at
   runtime — it's only there to let the "Build npm" step complete
   successfully; it's an unnecessary passenger dependency, not an actual
   problem.
