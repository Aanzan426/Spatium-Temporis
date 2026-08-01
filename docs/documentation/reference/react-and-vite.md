# React and Vite — everything in this repo, and why

Written 2026-08-01, alongside the scaffold in commit `ce85740`.

This assumes **zero** prior knowledge of either tool. Every claim below is about the files
actually sitting in this repository, not a generic tutorial. Where a version number matters
it is the version actually installed, verified with `npm ls`.

Read it in order the first time. After that it's a reference.

---

# Part 0 — The shape of the problem

## 0.1 What a browser actually does

A browser can do exactly three things with a website:

1. Parse **HTML** into a tree of objects called the **DOM** (Document Object Model)
2. Apply **CSS** to style that tree
3. Run **JavaScript**, which can read and modify that tree while the page is live

That's it. Everything else — React, Vite, TypeScript — is machinery that exists to produce
those three things. None of them run in the browser as themselves. **The browser has never
heard of React.** It receives HTML, CSS and JavaScript, always.

The DOM is a live tree. If JavaScript does this:

```js
document.getElementById('root').textContent = 'hello'
```

the screen updates immediately, because the DOM *is* the page — not a description of it.

## 0.2 Why you can't just write a `.js` file and open the HTML

Historically you could. Write `index.html`, add `<script src="app.js">`, double-click the
HTML file, done. For this project that breaks in three separate places.

**Break 1 — `import` of a bare name.**

Your `src/main.tsx` starts with:

```ts
import { StrictMode } from 'react'
```

`'react'` is a **bare specifier** — a name, not a path. Browsers only understand imports that
are URLs or relative paths (`./thing.js`, `/src/thing.js`, `https://…`). A browser given
`import … from 'react'` throws immediately, because it has no idea where `react` lives. Only
Node.js and bundlers know the convention "look in `node_modules/react`".

**Break 2 — `.tsx` is not JavaScript.**

Your files contain TypeScript types (`useState<Page>('main')`) and JSX (`<button>…</button>`).
Neither is JavaScript. A browser handed this file fails to parse it. Something has to strip
the types and convert the JSX into real function calls before the browser sees it.

**Break 3 — the request waterfall.**

Even if the first two were solved, a real app has hundreds of small modules, and each one
imports more. Loading them individually over HTTP means hundreds of round trips, each one
discovered only after the previous finished. On a slow connection that's catastrophic.

**Vite exists to solve all three.** That is genuinely all it is for.

---

# Part 1 — Vite

## 1.1 What Vite is

Vite is **two tools wearing one name**, and confusing them is the single most common source
of "why does it work in dev but not in prod":

- **`vite` (the dev server)** — runs while you develop. Optimised for *instant feedback*.
- **`vite build`** — runs once to produce the deployable files. Optimised for *small, fast
  output*.

They work differently on purpose. Dev mode barely bundles anything; the build bundles
aggressively.

## 1.2 Vite's entry point is `index.html`, which is unusual

Most older build tools start from a JavaScript file and generate HTML around it. **Vite starts
from HTML.** Your `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spatium Temporis</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Line by line:

**`<!doctype html>`** — tells the browser to use standards mode rather than a 1990s
compatibility mode. Its absence causes bizarre CSS behaviour. It carries no other meaning.

**`<meta charset="UTF-8" />`** — declares the byte encoding. Without it, non-ASCII characters
(any em-dash, any accented letter, any emoji) can render as mojibake. Must appear early in
`<head>`.

**`<meta name="viewport" content="width=device-width, initial-scale=1.0" />`** — mobile only.
Without it, phones assume the page was designed for a ~980px desktop and zoom out to fit,
making everything tiny. `width=device-width` says "the layout viewport is the actual device
width." This is a hard requirement for the phone capture view.

**`<title>`** — browser tab text. Also what a PWA install uses as a default name.

**`<div id="root"></div>`** — an empty box. This is where the entire React application will be
inserted at runtime. Before JavaScript runs, your page is genuinely blank. That is normal for
this kind of app (and is also why such apps are bad for SEO without extra work — irrelevant
here, since there's one user).

**`<script type="module" src="/src/main.tsx"></script>`** — the important line.

- `type="module"` means this is an ES module, not an old-style script. Modules can use
  `import`, are automatically deferred (they run after HTML parsing, so `#root` exists by the
  time the script runs), and run in strict mode.
- `src="/src/main.tsx"` — note the **leading slash**. That's a path from the project root, not
  a relative path. Vite resolves it against the project directory.
- **A browser cannot execute a `.tsx` file.** It works because in dev, Vite intercepts the
  request and returns compiled JavaScript; and in build, Vite rewrites this tag entirely.

## 1.3 Dev mode, request by request

When you run `npm run dev`, this happens:

1. Vite starts an HTTP server (default `http://localhost:5173`).
2. It **pre-bundles dependencies**. It looks at what you import from `node_modules` — React,
   React-DOM, date-fns, ulid — and converts each into a single optimised ES module cached in
   `node_modules/.vite/`. Reason: a package like date-fns ships hundreds of tiny files; without
   this you'd trigger hundreds of HTTP requests for one import. This step is why the *first*
   `npm run dev` is slower than later ones.
3. Browser requests `/`. Vite serves `index.html`, lightly rewritten.
4. Browser hits `<script type="module" src="/src/main.tsx">` and requests that file.
5. **Vite compiles `main.tsx` on demand, only that file**: strips TypeScript types, converts
   JSX to function calls, and **rewrites bare imports into real paths** —
   `from 'react'` becomes something like `from '/node_modules/.vite/deps/react.js'`. It sends
   back valid JavaScript.
6. The browser sees that file's imports and requests `/src/App.tsx`. Vite compiles that on
   demand too. And so on down the tree.

**The key insight: in dev, Vite does not bundle your source at all.** The browser's own module
loader does the graph traversal, and Vite acts as a just-in-time compiler for individual
files. That's why startup is near-instant regardless of project size — Vite only ever
compiles the files actually requested.

## 1.4 Hot Module Replacement and React Fast Refresh

Edit `App.tsx` and save. Instead of reloading the page, Vite pushes the single changed module
over a WebSocket and the app swaps it in place.

**Why this matters more than it sounds:** a full reload destroys all state. If you've panned
and zoomed the timeline to a specific view, a reload dumps you back to the start every time
you change a colour. HMR keeps you where you were.

**React Fast Refresh** is the React-specific version, provided by `@vitejs/plugin-react`. It
preserves the state inside your components — your `useState` values survive the edit. It has
rules: it works reliably when a file exports React components; it falls back to a full reload
when a file exports other things too, or when you edit something it can't reason about. If you
notice state getting wiped on save, that's usually why.

## 1.5 `vite build` — the production path

`npm run build` runs `tsc --noEmit && vite build`. The Vite half does:

1. **Bundling.** Follows every import from `index.html` and merges the whole graph into a small
   number of files.
2. **Tree-shaking.** Removes exports that are never imported anywhere. This is why importing
   one function from date-fns doesn't ship all of date-fns.
3. **Minification.** Strips whitespace and comments, shortens local variable names
   (`const canvasElement` → `const a`). Behaviour identical, size much smaller.
4. **Content hashing.** Output is `index-CvyfuQ9G.js` — that suffix is a hash of the file's
   contents. Change one character of source and the hash changes, so the filename changes.
   This lets a server tell browsers to cache these files *forever*, because a new deploy
   produces new filenames. Never a stale-cache problem, never a manual cache-bust. This is
   why you must not link to build outputs by name — the name changes every build.
5. **Rewriting `index.html`** to point at the hashed filenames, and writing it to `dist/`.

`dist/` is the entire deployable app. It's in `.gitignore` because it's generated.

## 1.6 Reading your actual build output

This is the real output from today:

```
vite v8.2.0 building client environment for production...
✓ 17 modules transformed.
dist/index.html                  0.32 kB │ gzip:  0.23 kB
dist/assets/index-CvyfuQ9G.js  190.77 kB │ gzip: 60.07 kB
✓ built in 181ms
```

**"17 modules transformed"** — your ~15 source files plus React's entry modules. Small,
because nothing is implemented yet.

**`190.77 kB`** — and here's the thing worth internalising: **almost none of that is your
code.** Your entire source is roughly 2 kB. The rest is React and React-DOM. React is a
fixed up-front cost of roughly 180 kB minified; it does not grow proportionally as you add
features. A month of real work might add 30 kB.

**`gzip: 60.07 kB`** — servers compress responses before sending. gzip is very effective on
JavaScript (repetitive keywords, repeated identifiers). **60 kB is the number that actually
matters for load time**, not 190. The browser decompresses on arrival.

**`181ms`** — the whole production build. This is Rolldown being Rust rather than JavaScript.
Webpack on an equivalent project would take a few seconds.

## 1.7 What's actually under the hood (and why tutorials are wrong)

Verified in `node_modules` today:

```
vite@8.2.0  →  rolldown@~1.2.0,  @oxc-project/*,  lightningcss,  postcss
```

**Nearly every Vite tutorial online says "esbuild in dev, Rollup in production."** For Vite 8
that is **out of date**. There is no esbuild and no Rollup in this tree.

- **Rolldown** — a Rust bundler, API-compatible with Rollup, now doing both the dev transforms
  and the production bundling.
- **Oxc** — the Rust JavaScript/TypeScript parser and transformer Rolldown uses. This is the
  thing stripping your types and converting your JSX.
- **Lightning CSS** — Rust CSS parser/minifier.

It doesn't change how you use Vite at all. It matters for two practical reasons: when you
search for a plugin or an error message, results assuming Rollup internals may not apply; and
the speed you're seeing (181 ms) is because this pipeline is native code, not JavaScript.

## 1.8 `vite.config.ts`, line by line

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

**`defineConfig`** does nothing at runtime — it returns its argument unchanged. It exists
purely so TypeScript knows the shape of the object, giving you autocomplete and errors on
typos. You could `export default { plugins: [react()] }` and it would work identically, with
no editor help.

**`plugins: [react()]`** — note it's `react()`, a *call*. Vite plugins are factory functions:
calling it produces a configured plugin object. `react` without parentheses would be a
function sitting in the array, and Vite would ignore or choke on it. This is an easy typo with
a confusing error.

**What `@vitejs/plugin-react` actually adds** — this is not optional decoration:

1. **The JSX transform.** Converts `<button>…</button>` into function calls (Part 2.3).
   Without it, nothing containing JSX compiles.
2. **React Fast Refresh** (§1.4).
3. **Correct dev-mode React builds**, with the development warnings that tell you when you've
   broken a rule.

Remove this plugin and the project stops building entirely.

## 1.9 The one that will actually bite you: **Vite does not typecheck**

This is the most important paragraph in Part 1.

Oxc strips TypeScript types by **deleting** them. It never checks whether they were correct.
This code builds and runs perfectly under `vite build`:

```ts
const scale: number = "not a number"   // no error from Vite. none.
```

Vite's job is transformation, not verification, and skipping the check is a large part of why
it's fast.

This is why `package.json` has:

```json
"build": "tsc --noEmit && vite build"
```

`tsc` is the actual TypeScript compiler. `--noEmit` means "check everything, produce no
output files" — checking is the entire point; Vite handles the output. The `&&` means the
build only proceeds if the check passes.

**Practical consequence:** during `npm run dev`, type errors do **not** stop you. Your editor
will underline them in red, and the app will run anyway. Run `npm run typecheck` before
committing, or you'll find out at build time.

---

# Part 2 — React

## 2.1 The problem React solves

Without a framework, updating the page means writing the update steps yourself:

```js
document.getElementById('count').textContent = String(count)
if (count > 5) document.getElementById('warning').style.display = 'block'
else document.getElementById('warning').style.display = 'none'
```

This is **imperative** — a list of instructions. It works fine for one counter. Now imagine
your timeline: a node changes magnitude, so it must disappear at this zoom level, its bar must
be removed, the day-lane list must update if that day was selected, the revision strip must
gain an entry, the inbox count must change. Every one of those is a manual DOM edit, and every
combination of state is a path you have to have thought of. This is where UI bugs live.

React inverts it. You write a function that says **what the UI should look like for a given
state**:

```
UI = f(state)
```

When state changes, React re-runs your function, compares the new description to the previous
one, and works out the minimal set of DOM operations itself. You never write
`element.style.display = 'none'` again. This is **declarative**.

The cost is that you must think in terms of "what is true now" rather than "what changed" —
which is a genuine adjustment, and worth the trade.

## 2.2 Components

A React component is **a function that returns a description of UI**. That is the entire
definition. From your repo:

```tsx
export function MainPage() {
  return <main>main page</main>
}
```

Rules:
- The name **must start with a capital letter**. `<MainPage />` is treated as your component;
  `<mainPage />` is treated as an unknown HTML tag. This is not a convention, it's how the JSX
  transform distinguishes them.
- It returns one tree (or `null`).
- It should be **pure**: same inputs → same output, no side effects during rendering. React
  may call it more than once for a single update, and StrictMode deliberately does (§2.6).

Components compose: `App` uses `MainPage`, which will use `TimelineCanvas`, and so on. That
tree of function calls is the app.

## 2.3 JSX is not HTML — it's function calls

`<button onClick={handleClick}>Timeline</button>` looks like HTML sitting inside JavaScript.
It isn't. It's **JSX**, a syntax extension that gets compiled away before the browser sees it.

That line compiles to roughly:

```js
import { jsx as _jsx } from "react/jsx-runtime";
_jsx("button", { onClick: handleClick, children: "Timeline" })
```

And your fragment in `App.tsx`:

```jsx
<>
  <nav>…</nav>
  {page === 'main' ? <MainPage /> : <SchedulerPage />}
</>
```

becomes roughly:

```js
import { jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
_jsxs(_Fragment, { children: [ _jsx("nav", {…}), page === 'main' ? _jsx(MainPage, {}) : _jsx(SchedulerPage, {}) ] })
```

(`jsxs` is the variant for multiple children — a small optimisation, nothing conceptual.)

**The return value is a plain JavaScript object** — a lightweight description of what to
render. Not a DOM element. Nothing has touched the page yet. React takes these objects, diffs
them against the previous set, and issues DOM operations.

Consequences that follow directly from JSX being JavaScript:

- **`className`, not `class`.** `class` is a reserved word in JavaScript.
- **`htmlFor`, not `for`.** Same reason.
- **camelCase events**: `onClick`, not `onclick`.
- **`{}` embeds an expression**: `{page === 'main' ? <A/> : <B/>}`. An *expression*, not a
  statement — you can't put an `if` there, which is why ternaries are everywhere in JSX.
- **Styles are objects**: `style={{ width: '100%' }}`. The outer braces are "here comes JS",
  the inner ones are the object literal. That's why it's always doubled.
- **Every tag must close**: `<br />`, not `<br>`.

**Why you don't `import React from 'react'`:** older React required it, because JSX compiled
to `React.createElement(…)`, so the name `React` had to be in scope. Modern React (17+) uses
the **automatic runtime**, which imports `jsx` from `react/jsx-runtime` itself. Your
`tsconfig.json` selects this with `"jsx": "react-jsx"`. **Any tutorial that tells you to add
`import React from 'react'` at the top of every file is pre-2020.** It's harmless but unnecessary.

## 2.4 Why `react` and `react-dom` are two packages

- **`react`** — the component model, hooks, state, the diffing algorithm. It knows nothing
  about browsers, DOM, or HTML.
- **`react-dom`** — the *renderer* that turns React's output into DOM operations.

They're split because React is deliberately platform-independent. `react-native` renders to
native mobile views; there are renderers for terminals, PDFs, 3D scenes. Same `react`, different
renderer.

Practically: **their versions must match.** Both are `19.2.8` here. Mismatched React and
React-DOM produce obscure runtime errors.

You'll also see `scheduler` in `node_modules` — React's internal work-prioritisation package.
You never import it; it's there because React depends on it.

## 2.5 `src/main.tsx`, line by line

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

This file exists to do exactly one thing: **connect the React world to the one real DOM element
in `index.html`.** It's the only place those two worlds meet.

**`import { createRoot } from 'react-dom/client'`** — note the `/client` subpath. React-DOM
ships multiple entry points (`react-dom/client` for browsers, `react-dom/server` for
server-rendering). Tutorials showing `import ReactDOM from 'react-dom'` and
`ReactDOM.render(...)` are pre-React-18; that API was removed.

**`document.getElementById('root')`** — plain browser API, no React involved. Finds the
`<div id="root">`.

**The `!`** — a TypeScript **non-null assertion**. `getElementById` is typed as returning
`HTMLElement | null`, because TypeScript can't know whether that id exists. `!` says "trust
me, this is not null." It's you overriding the compiler.

It's acceptable *here specifically* because if `#root` is missing the app cannot function at
all and you want the crash immediately. **Do not develop a habit of it.** Everywhere else,
handle the null. In your canvas code you'll write `if (!canvas) return` instead, and that's
the right pattern.

**`createRoot(...)`** — creates a React root: the binding between React and that DOM node.
React now owns everything inside it and will overwrite whatever is there.

**`.render(<StrictMode><App /></StrictMode>)`** — hands React the top of your component tree
and starts it. From here React runs everything.

**The trailing comma** after `</StrictMode>` is just style — legal, and keeps future diffs
clean.

## 2.6 StrictMode — and the thing that will confuse you within a week

`<StrictMode>` renders nothing. It's a development-only marker that makes React
**deliberately misbehave** to surface bugs.

Its main effect: **in development, React calls your component functions twice, and runs your
effects twice** (mount → unmount → mount).

**This is intentional, and it is not a bug.** It exists to expose two very common mistakes:

1. **Impure render.** If your component function mutates something outside itself, calling it
   twice produces a visibly different result. React wants that to fail loudly in dev rather
   than subtly in production.
2. **Missing cleanup.** If an effect starts a timer, subscribes to an event, or opens a
   connection without cleaning it up, running it twice leaves two of them alive. Doubling
   makes the leak obvious immediately.

**Why you specifically need to know this now:** you're about to write canvas code with event
listeners and probably an animation loop. Under StrictMode your effect runs twice, so without
proper cleanup you'll end up with **two `requestAnimationFrame` loops running simultaneously**.
The symptoms — double-speed panning, flickering, doubled event handling — look exactly like a
maths bug in your transform, and you can lose hours there.

The fix is never to remove StrictMode. It's to return a cleanup function from your effect
(§2.13). If cleanup is correct, double-invocation is invisible.

**This does not happen in production builds.** Only dev.

## 2.7 `src/App.tsx`, line by line

```tsx
import { useState } from 'react'
import { MainPage } from './pages/main/MainPage'
import { SchedulerPage } from './pages/scheduler/SchedulerPage'

type Page = 'main' | 'scheduler'

export function App() {
  const [page, setPage] = useState<Page>('main')

  return (
    <>
      <nav>
        <button onClick={() => setPage('main')}>Timeline</button>
        <button onClick={() => setPage('scheduler')}>Scheduler</button>
      </nav>
      {page === 'main' ? <MainPage /> : <SchedulerPage />}
    </>
  )
}
```

**`type Page = 'main' | 'scheduler'`** — a TypeScript **union of string literals**. The type
isn't "string", it's "one of exactly these two strings". `setPage('mian')` is a compile error.
This is one of TypeScript's genuinely great features and you should use it constantly — your
`precision`, `magnitude`, `outcome` and recurrence `kind` fields are all exactly this shape.

**`const [page, setPage] = useState<Page>('main')`** — dissected in §2.8.

**`<>…</>`** — a **Fragment**. A component must return a single node, but you often have
siblings with no meaningful wrapper. A Fragment groups them and renders **no DOM element at
all**. Using a `<div>` instead would inject a real element that could interfere with CSS
layout.

**`onClick={() => setPage('main')}`** — an arrow function passed as a prop. Note it's a
function *definition*, not a call. `onClick={setPage('main')}` would call it during render,
immediately, on every render — an infinite loop of state updates. This is a classic first-week
bug and worth staring at until the distinction is automatic.

**`{page === 'main' ? <MainPage /> : <SchedulerPage />}`** — conditional rendering. Exactly one
of these exists in the tree at a time. When `page` changes, React unmounts one and mounts the
other. **Anything the unmounted one held in state is destroyed** — which matters later, because
switching tabs will reset your camera position unless the camera state lives higher up.

This is a hand-rolled two-page switch with no router library. Fine for two pages. When you need
URLs, back-button support and deep links, that's when a router earns its place — not before.

## 2.8 `useState` and the re-render cycle

```tsx
const [page, setPage] = useState<Page>('main')
```

- `useState('main')` returns an array of exactly two things: the current value, and a function
  to change it.
- `const [page, setPage] = …` is **array destructuring** — plain JavaScript, unpacking
  positionally. The names are yours; `[a, b]` would work identically. Convention is
  `[thing, setThing]`.
- `<Page>` explicitly types the state. Without it TypeScript would infer `string` from
  `'main'`, and you'd lose the union check.
- `'main'` is the **initial** value, used only on the first render. On later renders this
  argument is ignored entirely — React remembers the current value.

**The cycle, precisely:**

1. `App()` runs. `useState` returns `'main'`. React builds a description of the UI.
2. You click "Scheduler". `setPage('scheduler')` runs.
3. React marks this component as needing an update and **schedules** re-render. It does not
   re-render synchronously.
4. **React calls `App()` again — the entire function body, from the top.** `useState` now
   returns `'scheduler'`.
5. React compares the new description with the old one. `<nav>` and both `<button>`s are
   unchanged, so **their DOM nodes are not touched**. Only the changed part is updated:
   `MainPage`'s DOM is removed and `SchedulerPage`'s inserted.
6. Browser paints.

**The crucial mental model: your component function runs again from scratch on every update.**
Every `const` in it is recreated. Every arrow function is a new object. The *only* things that
survive between renders are values held by hooks (`useState`, `useRef`).

Two consequences that catch everyone:

**State updates are not immediate.**

```tsx
setPage('scheduler')
console.log(page)   // still 'main'
```

`page` is a const captured by *this* render. The new value appears in the *next* render.

**Never mutate state, always replace it.**

```tsx
items.push(newItem); setItems(items)     // BROKEN — same array reference, React sees no change
setItems([...items, newItem])            // correct — new array
```

React compares by reference (`Object.is`). Same reference means "nothing changed" and it skips
the re-render. This will bite you the first time you store an array or object in state, and the
symptom is simply that the screen doesn't update.

## 2.9 The Rules of Hooks

A **hook** is any function starting with `use`. Two absolute rules:

1. **Only call hooks at the top level of a component.** Never inside `if`, loops, or nested
   functions.
2. **Only call hooks from React components or other hooks.** Not from plain functions or event
   handlers.

**Why rule 1 exists** — this is worth understanding rather than memorising. React does not know
your variable names. It tracks hook state **by call order**: first `useState` in this component
gets slot 0, second gets slot 1, and so on. If a hook is inside a condition, the order changes
between renders, and slot 1 suddenly returns what belonged to slot 2. State silently attaches
to the wrong variable.

Correct:

```tsx
const [a, setA] = useState(0)
const [b, setB] = useState(0)
if (a > 5) { /* conditional logic here, not conditional hooks */ }
```

Wrong:

```tsx
const [a, setA] = useState(0)
if (a > 5) { const [b, setB] = useState(0) }   // order now varies between renders
```

## 2.10 Props

Props are the arguments passed into a component. You have none yet, but you will everywhere.

```tsx
type DayLanesProps = {
  date: number                       // epoch ms
  spans: Span[]
  onSelect: (id: string | null) => void
}

export function DayLanes({ date, spans, onSelect }: DayLanesProps) { … }
```

Used as `<DayLanes date={today} spans={visible} onSelect={handleSelect} />`.

Two rules:

- **Props flow down, one way.** A parent passes data to a child. A child cannot write to its
  parent's state.
- **To send information upward, the parent passes a function down** and the child calls it —
  `onSelect` above. This is the standard pattern and it's how every interaction in your app
  will communicate.

Props are read-only. Never assign to one.

## 2.11 Keys in lists

Rendering a list uses `.map()`:

```tsx
{spans.map(span => <Bar key={span.id} span={span} />)}
```

**`key` is mandatory and it is not decoration.** When the list changes, React uses keys to work
out which items are the same item as before — so it can move a DOM node rather than destroying
and rebuilding it, and so component state stays attached to the right row.

**Never use the array index as a key** for a list that can reorder, filter or have items
inserted. With index keys, inserting at the top shifts every key by one, and React concludes
every single item changed. The visible symptom is state (a selection, an open editor, an input's
text) jumping to the wrong row.

Your ULIDs are ideal keys: unique and stable for the life of the object.

## 2.12 `useEffect`

Rendering must be pure — no side effects. But real apps need side effects: DOM measurement,
event listeners, timers, network calls. `useEffect` is the escape hatch, and it runs **after**
React has committed to the DOM.

```tsx
useEffect(() => {
  // effect
  return () => { /* cleanup */ }
}, [dependencies])
```

The **dependency array** controls when it runs:

- `[]` — after the first render only.
- `[scale, tOrigin]` — after the first render, and again whenever either value changed since
  last time.
- **omitted entirely** — after *every* render. Almost always a mistake, and a common cause of
  infinite loops (effect sets state → re-render → effect runs → …).

The **cleanup function** runs before the effect runs again, and when the component unmounts.
Anything you start, you stop here. This is what makes StrictMode's double-invocation harmless.

A warning worth taking seriously: `useEffect` is over-used by beginners. It is for
synchronising with things **outside** React — the DOM, a canvas, a subscription, a timer. It is
*not* for computing derived values. If something can be calculated during render from existing
state, calculate it during render. Storing derived data in state and syncing it with an effect
is the single most common source of bugs in React codebases.

## 2.13 `useRef` — and why you're about to need it constantly

`useRef` gives you a **box that survives re-renders and does not trigger them when changed**.

```tsx
const ref = useRef(initialValue)
ref.current            // read
ref.current = newValue // write — no re-render
```

Two distinct uses:

**1. Getting hold of a real DOM element.**

```tsx
const canvasRef = useRef<HTMLCanvasElement>(null)
return <canvas ref={canvasRef} />
```

React sets `canvasRef.current` to the actual `<canvas>` DOM node after mounting. This is how
you reach a real element from inside React, and it's the only way to get a canvas context.

**2. Holding mutable values that must not cause re-renders.** This is the one that matters for
your timeline (§2.14).

The distinction from `useState`:

| | `useState` | `useRef` |
|---|---|---|
| Survives re-renders | yes | yes |
| Changing it re-renders | **yes** | **no** |
| Use for | anything shown in JSX | DOM handles, values read by imperative code |

## 2.14 React and canvas — the pattern for your next task

This deserves its own section because React and canvas have a genuine philosophical conflict,
and getting it wrong will make your timeline feel bad.

**The conflict:** React's entire model is that it owns the DOM and updates it declaratively.
A canvas is a black box — React can create the `<canvas>` element, but everything *inside* it
is pixels you draw imperatively. React has no visibility into it and cannot diff it.

**The resolution, and it's clean:** let React own the element, and own the pixels yourself.

```tsx
import { useRef, useEffect } from 'react'

export function TimelineCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // devicePixelRatio setup — see the day-1 log
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    let frame = 0
    const draw = () => {
      // ... all drawing happens here, outside React entirely
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(frame)   // <- without this, StrictMode leaves two loops running
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
```

(That's the canonical shape, not your implementation — the transform, bands and ticks are
yours to write.)

**The critical architectural decision inside this: where does camera state live?**

Your camera is `scale` and `tOrigin`. During a drag, they change on every mouse-move — call it
60+ times per second.

**If you put them in `useState`**, every mouse-move triggers a full React re-render. React will
reconcile the whole component tree 60 times a second to update a number that only imperative
canvas code reads. It will feel sluggish, and it's pure waste — React isn't drawing anything.

**Put them in a `useRef` instead:**

```tsx
const camera = useRef({ scale: 1e-7, tOrigin: Date.now() })
```

Mouse handlers mutate `camera.current` directly. The `requestAnimationFrame` loop reads it and
redraws. React never re-renders during a pan at all. This is dramatically faster and it is the
standard approach for canvas-driven views.

**The rule of thumb:** if a value is only ever read by canvas drawing code, it belongs in a ref.
If it's displayed in actual DOM — the current zoom band's name in a label, the selected node's
title in a panel — that needs `useState`, because React has to re-render to show it. It is
completely normal to hold the fast-changing value in a ref and separately push a throttled copy
into state for display.

**Also note:** the effect above has `[]` deps, so it runs once. Don't add `scale` to the
dependency array to "make it redraw" — that tears down and rebuilds the entire loop on every
zoom. The rAF loop reads the current ref value every frame; it never needs restarting.

## 2.15 Which React tutorials will mislead you

React has changed a lot, and most search results are old. Anything showing these is dated:

| Outdated | Current |
|---|---|
| `class Foo extends React.Component`, `this.state`, `render()` | function components + hooks |
| `ReactDOM.render(<App/>, el)` | `createRoot(el).render(<App/>)` |
| `import React from 'react'` required in every file | unnecessary since the automatic JSX transform |
| `PropTypes` for runtime prop checking | TypeScript, at compile time |
| `forwardRef` to pass a ref into a component | React 19 passes `ref` as an ordinary prop |
| `componentDidMount` / `componentWillUnmount` | `useEffect` with a cleanup return |

You're on **React 19.2.8**. When something doesn't match a tutorial, check its date first.

---

# Part 3 — `tsconfig.json`, option by option

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true
  },
  "include": ["src", "vite.config.ts"]
}
```

**`"target": "ES2022"`** — which JavaScript version to assume. Affects whether modern syntax is
down-levelled to older equivalents. ES2022 is supported by every browser you care about, so
nothing is transformed unnecessarily. It also enables class fields and `.at()`.

**`"lib": ["ES2022", "DOM", "DOM.Iterable"]`** — which *type definitions* exist. `ES2022` gives
`Array`, `Promise`, `Map`. **`DOM` is what makes `document`, `window`, `HTMLCanvasElement` and
`CanvasRenderingContext2D` exist as types** — without it, none of your canvas code would
typecheck. `DOM.Iterable` lets you `for…of` over things like `NodeList`.

**`"module": "ESNext"`** — emit modern `import`/`export`. Vite handles the rest.

**`"moduleResolution": "bundler"`** — how to resolve `import './App'` to a file. `bundler` mode
matches what Vite actually does: it allows extensionless imports (`'./App'` finds `App.tsx`)
and understands the `exports` field in package.json. The older `node` mode would demand file
extensions and get `react-dom/client` wrong.

**`"jsx": "react-jsx"`** — the automatic JSX runtime (§2.3). This is what means you don't
import React. The alternative `"react"` is the legacy `React.createElement` mode.

**`"strict": true`** — the important one. Turns on the whole family of strict checks, most
notably `strictNullChecks`, which makes `string` and `string | null` genuinely different types.
This is what forces `if (!canvas) return` and what makes the `!` in `main.tsx` necessary.

It is more annoying at first and it is not close: **leave it on.** Nearly everything strict mode
complains about is a real bug you'd otherwise find at runtime. Turning it off later in a large
codebase is effectively impossible.

**`"noUnusedLocals": false`** — deliberately relaxed. With it on, an unused variable is a
*compile error*, which is miserable while you're mid-thought with a half-written function. Your
editor will still grey them out. Consider turning it on when the codebase settles.

**`"noEmit": true`** — TypeScript checks but produces no files. Vite emits the JavaScript. This
is what makes `tsc --noEmit` a pure verification step.

**`"skipLibCheck": true`** — don't typecheck inside `node_modules/**/*.d.ts`. Those files are
huge, you can't fix them, and occasionally two libraries have mutually incompatible internal
types. Standard practice; big speedup.

**`"isolatedModules": true`** — enforces that every file can be compiled **independently**, with
no knowledge of any other file. This is required because Oxc transforms one file at a time and
never sees the whole program. It rejects a few TypeScript features that need cross-file
knowledge (like re-exporting a type without `export type`). Better to have the compiler tell you
than to hit a confusing build failure.

**`"verbatimModuleSyntax": true`** — makes import elision explicit. Without it, TypeScript
silently deletes imports it decides were type-only, which can accidentally remove a module whose
import had a side effect. With it, you write your intent:

```ts
import type { Span } from './core/types'   // erased at compile time
import { ulid } from 'ulid'                // kept
```

You'll get errors telling you to add `type` to some imports. That's this setting working.

**`"resolveJsonModule": true`** — allows `import data from './x.json'` with proper types.

**`"include": ["src", "vite.config.ts"]`** — what to check. `vite.config.ts` is listed
explicitly because it sits outside `src/` and would otherwise be unchecked.

---

# Part 4 — `package.json`, line by line

```json
{
  "name": "spatium-temporis",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": { … },
  "dependencies": { … },
  "devDependencies": { … }
}
```

**`"private": true`** — a safety latch. `npm publish` refuses to run on a private package. Since
this is a personal application, not a library, publishing would only ever be an accident.

**`"type": "module"`** — tells Node to interpret `.js` files in this project as ES modules
(`import`) rather than CommonJS (`require`). This is why `vite.config.ts` can use `import`
syntax. Without it you'd need `.mjs` extensions.

**`"version": "0.0.1"`** — meaningless for a private app; required by npm's schema.

## 4.1 `dependencies` vs `devDependencies`

- **`dependencies`** — needed by the app **at runtime**, ends up in the bundle.
- **`devDependencies`** — needed only to *build* or develop, never shipped.

| Package | Where | Why it's there |
|---|---|---|
| `react` 19.2.8 | dep | The component and state model |
| `react-dom` 19.2.8 | dep | Renders React output to browser DOM |
| `date-fns` 4.4.0 | dep | Calendar-aware date arithmetic (§ day-1 log) |
| `ulid` 3.0.2 | dep | Sortable unique ids |
| `vite` 8.2.0 | dev | Dev server + production build |
| `@vitejs/plugin-react` 6.0.5 | dev | JSX transform + Fast Refresh |
| `typescript` 7.0.2 | dev | The typechecker (`tsc`) |
| `@types/react` 19.2.18 | dev | Type definitions for React |
| `@types/react-dom` 19.2.4 | dev | Type definitions for React-DOM |

**Why `@types/*` are separate packages:** React is written in JavaScript, so it ships no type
information. The community maintains definitions in a repository called DefinitelyTyped,
published as `@types/<name>`. They're dev-only because types vanish at compile time. Libraries
written in TypeScript — `date-fns`, `ulid` — bundle their own and need no `@types` package.

**TypeScript 7.0.2** is notable: TypeScript was rewritten in Go for version 7, making `tsc`
dramatically faster than the JavaScript implementation. Same language, same config, same
behaviour.

## 4.2 `^` and the lockfile

```json
"react": "^19.2.8"
```

The caret means **"19.2.8 or any later version that doesn't change the major number"** — 19.3.0
is acceptable, 20.0.0 is not. That follows semantic versioning: major = breaking, minor =
additive, patch = fixes.

This creates a reproducibility problem: install today and get 19.2.8, install in three months
and get 19.7.0, and now your machine and any other differ.

**`package-lock.json` solves it.** It records the *exact* version of every package and every
transitive dependency, with integrity hashes. It's 1386 lines here for nine direct
dependencies, because those nine pull in others.

**Commit it. Always.** It's what makes "it works on my machine" reproducible. It's in commit
`ce85740`.

- `npm install` — respects the lockfile; updates it if `package.json` demands something it
  can't satisfy.
- `npm ci` — installs *strictly* from the lockfile, deleting `node_modules` first. What CI
  should use.

## 4.3 The scripts

```json
"dev":       "vite",
"build":     "tsc --noEmit && vite build",
"preview":   "vite preview",
"typecheck": "tsc --noEmit"
```

- **`npm run dev`** — dev server with HMR. What you'll live in.
- **`npm run build`** — typecheck, then build to `dist/`. Fails if types are wrong (§1.9).
- **`npm run preview`** — serves the *built* `dist/` locally. This is not a dev server; it's for
  verifying the production build. Some bugs only appear here — minification issues,
  environment differences, missing assets.
- **`npm run typecheck`** — check types without building. Fast; run it often.

Scripts can run local binaries (`vite`, `tsc`) without a path because npm puts
`node_modules/.bin` on PATH. Typing `vite` in your shell directly won't work unless it's
installed globally; `npx vite` will.

Note it's `npm run dev`, not `npm dev`. Only a few names (`start`, `test`) work without `run`.

---

# Part 5 — `node_modules`, and what `import` actually does

**`node_modules/`** is where npm puts downloaded packages. It's gitignored because it's fully
reconstructible from `package.json` + `package-lock.json`, and because it's enormous — even
this minimal project has ~30 top-level entries plus transitive dependencies.

Delete it whenever things get weird; `npm install` rebuilds it. That genuinely fixes a
surprising share of problems.

**Resolution.** When Vite sees `import { useState } from 'react'`, it:
1. Recognises `react` as a bare specifier — not a path.
2. Looks in `node_modules/react/`.
3. Reads that package's `package.json` `exports`/`main` field to find the actual entry file.
4. Rewrites the import to a real URL the browser can fetch.

For `import { App } from './App'`, it resolves relative to the current file and tries
extensions — `./App.tsx` wins. The extensionless form is allowed by
`"moduleResolution": "bundler"`.

**ESM vs CommonJS.** Two competing module systems in the JavaScript ecosystem:

```js
import { x } from 'y'          // ESM  — the standard, static, tree-shakeable
const { x } = require('y')     // CommonJS — older Node format, dynamic
```

ESM is statically analysable, which is what makes tree-shaking possible. `"type": "module"`
tells Node this project is ESM. You will occasionally hit an old package that only ships
CommonJS; Vite handles the interop, but the error messages when it goes wrong are cryptic —
recognising the two syntaxes is enough to diagnose it.

---

# Part 6 — The full chain, end to end

What actually happens, in order, when you type `npm run dev` and load the page:

1. npm reads `package.json`, finds `"dev": "vite"`, runs `node_modules/.bin/vite`.
2. Vite reads `vite.config.ts`, loads `@vitejs/plugin-react`.
3. Vite scans imports and pre-bundles `react`, `react-dom`, `date-fns`, `ulid` into
   `node_modules/.vite/deps/`.
4. Dev server listens on `http://localhost:5173`.
5. Browser requests `/`. Vite serves `index.html` with a small HMR client script injected.
6. Browser parses HTML, creates `<div id="root">` (empty), reaches the `<script type="module">`.
7. Browser requests `/src/main.tsx`.
8. Vite reads that file, hands it to Oxc: types stripped, JSX converted to `_jsx(...)` calls.
   Bare imports rewritten to real paths. Valid JavaScript sent back.
9. Browser executes it. It sees `import … from '/node_modules/.vite/deps/react.js'` and
   `'./App'`, and requests both.
10. Vite compiles `App.tsx` the same way. `App.tsx` imports the two pages; those get requested
    and compiled too. The graph resolves.
11. `main.tsx` runs: `document.getElementById('root')` returns the div; `createRoot` binds React
    to it; `.render()` starts React.
12. React calls `App()`. `useState` initialises to `'main'`. `App` returns a description object.
13. React calls `MainPage()`, which returns a description of `<main>main page</main>`.
14. React walks the tree and — for the first render — creates real DOM nodes for all of it and
    inserts them into `#root`.
15. Browser paints. You see the page.
16. You click "Scheduler". The `onClick` arrow function runs `setPage('scheduler')`.
17. React schedules an update, calls `App()` again. `useState` now returns `'scheduler'`.
18. React diffs old description against new. `<nav>` unchanged → untouched. `MainPage` replaced
    by `SchedulerPage` → removes one DOM subtree, inserts another.
19. Browser repaints only the changed region.
20. You edit `App.tsx` and save. Vite's file watcher fires, recompiles that one file, pushes it
    over the WebSocket. Fast Refresh swaps the component and **keeps `page` as it was.**

Steps 12–19 are the whole of React. Steps 1–10 and 20 are the whole of Vite.

---

# Part 7 — Gotchas, ranked by how soon they'll hit you

1. **StrictMode runs your effects twice in dev.** Two rAF loops, two event listeners, doubled
   behaviour that looks like a maths bug. Return a cleanup function. (§2.6)
2. **Vite does not typecheck.** Red squiggles in your editor won't stop `npm run dev`. Run
   `npm run typecheck`. (§1.9)
3. **`onClick={fn()}` calls immediately; `onClick={() => fn()}` doesn't.** (§2.7)
4. **Mutating state doesn't re-render.** `arr.push(x); setArr(arr)` does nothing visible.
   Replace the array. (§2.8)
5. **State reads are stale within the same render.** `setX(1); console.log(x)` logs the old
   value. (§2.8)
6. **Camera state in `useState` will make panning feel bad.** Use a ref for values only canvas
   code reads. (§2.14)
7. **Index as a `key`** in a reorderable list attaches state to the wrong row. Use ULIDs.
   (§2.11)
8. **Effect with no dependency array** runs after every render — a classic infinite loop when
   the effect also sets state. (§2.12)
9. **Components must be Capitalised**, or JSX treats them as unknown HTML tags. (§2.2)
10. **`class` → `className`, `for` → `htmlFor`**, and styles are objects with double braces.
    (§2.3)
11. **Half the React content online is pre-hooks or pre-18.** Check the date. (§2.15)
12. **Vite 8 uses Rolldown and Oxc, not Rollup and esbuild.** Tutorials will say otherwise.
    (§1.7)

---

# Part 8 — What I deliberately did *not* add

Every one of these is a real decision, not an oversight:

- **No router** (`react-router` etc.) — two pages and a `useState` ternary is enough. A router
  earns its place when you need URLs, back-button support and deep links.
- **No state management library** (Redux, Zustand, Jotai) — you have one piece of state. Most
  of your genuinely hard state (camera position) belongs in a ref, not a store, because it
  changes 60 times a second and React shouldn't see it at all.
- **No CSS framework or CSS-in-JS** (Tailwind, styled-components) — the timeline is drawn in
  canvas, so the DOM styling surface is small. Adding a styling system before knowing what the
  UI is is guessing.
- **No component library** (MUI, shadcn) — none of them contain a zoomable time canvas, and
  their aesthetic is not the light-cone aesthetic.
- **No test runner** (Vitest) — worth adding, but at the point where there's logic worth
  testing. `core/time.ts` and `core/recurrence.ts` are the first real candidates: pure
  functions with fiddly edge cases (DST, month boundaries, weekday expansion) and no UI. Add
  Vitest when you write them.
- **No linter/formatter** (ESLint, Prettier) — useful, and a distraction on day one.
  `eslint-plugin-react-hooks` is genuinely worth it eventually: it catches Rules-of-Hooks
  violations and missing effect dependencies automatically.

Everything above can be added later with no restructuring. That's the reason for leaving them
out now.
