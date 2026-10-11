# maiDOS modular desktop

Goal: preserve the supplied index(2).html appearance, assets, fictional connection sequence and social links while making new apps easy to add.

Use native browser ES modules with no build step. index.html owns the static login/desktop/decorations. desktop.js owns login and the local clock. core/app-manager.js owns single-instance app windows, pointer dragging/resizing, focus stacking, minimize/restore, maximize, desktop fullscreen and closing. apps/registry.js declares app metadata and lazy module loaders. The manager generates an icon and taskbar entry for every registered app.

App contract: a module exports mount(context), optionally asynchronous, returning lifecycle hooks (onOpen, onFocus, onResize, beforeClose, destroy). context exposes root, signal, session, asset access, announce, setTitle, focus, minimize, maximize, setFullscreen and close. App content and CSS are scoped. An AbortSignal terminates work on close. Session state lives per app in the manager for the page lifetime. Shell-initiated close requests respect beforeClose and closePolicy; context.close() is the app's own decision. Locked desktop fullscreen hides shell controls, prevents minimize/focus switching and is released by the app. It is not browser fullscreen and cannot prevent browser/tab closure.

Terminal is extracted with its original text, timing, banner and commands. Successful connection state remains in context.session across close/reopen; cancelled first connections retry. Assets are real files under assets/, referenced by assets/manifest.js, and CSS wallpaper uses a runtime CSS variable. Paths are relative for GitHub Pages project paths or custom domains.

Implementation steps:

1. Write browser regression tests for dragging, shared app lifecycle, fullscreen locking, extraction and terminal session reuse; establish a failing baseline.
2. Extract original assets, desktop and terminal CSS/markup; implement shared app manager and registry. Preserve latest source content.
3. Add a disabled-by-default example app and API guide. Test normal/reduced motion, desktop/mobile, errors and interrupted loading, and asset requests over local HTTP.
4. Review and package a complete deployable ZIP. No deployment or repository mutation.
