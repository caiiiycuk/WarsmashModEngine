# Warsmash Web Port — Dev Notes

TeaVM-compiled build that runs the Warsmash engine in the browser. If you're
on the desktop build, see the root [`README.md`](../README.md) — this file is
web-only.

## Java environment

This web build currently uses the repo's Gradle wrapper (`Gradle 7.3.3`) and
targets Java 17. Run it with a JDK 17 environment; newer system JDKs such as
Java 25 can fail before the build starts with errors like
`Unsupported class file major version 69`.

On Ubuntu/Debian, install JDK 17 if needed:

```sh
sudo apt install openjdk-17-jdk
```

Then select it for the current shell before building:

```sh
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH="$JAVA_HOME/bin:$PATH"

java -version
```

## Quick start

```sh
./html/dev.sh build    # ./gradlew :html:buildWeb
./html/dev.sh serve    # python3 -m http.server 8000 in html/build/dist/webapp
./html/dev.sh dev      # build + serve, one shot
```

Then open <http://127.0.0.1:8000/?mode=single>. Hard-reload (⌘⇧R / Ctrl⇧R) after rebuilds
to bust `app.js?v=…` cache.


## Fast frontend-only iteration

After one full engine build, UI-only changes do not need another Java/TeaVM compile:

```sh
./gradlew :html:buildWeb                 # once: produce app.js, workers, and engine assets
cd html/web-src && npm run build         # rebuild only the Vite frontend
cp -R dist/. ../build/dist/webapp/       # layer the fresh UI over reused engine output
cd ../build/dist/webapp && python3 -m http.server 8000
```

This loop updates only the Vite/Preact UI from `html/web-src`. If Java, TeaVM, worker boot code, or engine-side resources change, run the full Gradle build again before testing.

## Launch URL contract

The app now has one HTML entrypoint and always renders the game shell. Launch mode is fixed at page load by query params:

| params | meaning |
|---|---|
| `?mode=single` | normal single-player/menu boot (the default if `mode` is omitted) |
| `?mode=single&map=Maps/...` | single-player boot with an optional map hint |
| `?mode=webrtc&room=ROOM&role=host&map=Maps/...` | multiplayer host bootstrap |
| `?mode=webrtc&room=ROOM&role=client&map=Maps/...` | multiplayer client bootstrap |

`room`, `role`, and `map` are required for `mode=webrtc`. Optional match-only slot configuration can be passed as URL-encoded `slots=<json-array>`. Offers, answers, ICE candidates, and other transport internals are deliberately not part of the URL contract.

## Asset staging

The engine doesn't ship with Warcraft III assets — you supply them yourself.
On first load, a worker extracts staged MPQs into OPFS under `/extracted` and
drops a `.w3-ready` marker. The boot screen waits for that marker. If you get
stuck on "waiting for extraction worker", your OPFS is empty — seed it via
the file picker at boot.

## URL flags

| flag | default | meaning |
|---|---|---|
| `?menu=1` | off | route through the real `MenuUI` (MeleeUI, Custom Game, …) instead of the direct-map harness |
| `?preloadOpfs=N` | 12 | OPFS read concurrency (1–64) |
| `?preloadDecode=M` | 6 | JPEG-BLP decode concurrency (1–32) |
| `?tier1=0` | on | disable the parallel preload pump — fall back to serial |

Example: `http://127.0.0.1:8000/?menu=1&preloadOpfs=24`.

## Architecture cheatsheet

- **Java → JS** via TeaVM. Build output is a single `app.js` plus assets,
  served static.
- **No async → sync bridge.** The engine's DataSource contract is synchronous.
  OPFS is async. We bridge by pre-reading everything the main menu touches
  into an `InMemoryDataSource` before handing it to the engine. See
  `ExtractedPreloader`, `WebMapBootScreen`, `MapBytesEnsurer`.
- **Backend-swap hooks** follow a static-plugin pattern — each has a
  `install(…)` the web launcher calls once at startup:
  - `util.Platform` — URL opener
  - `parsers.fdf.DynamicFontGeneratorHolderFactory` — fonts (FreeType vs stub)
  - `networking.NetworkPlatform` — real UDP/TCP on desktop, no-op on web
  - `datasources.MapBytesEnsurer` — OPFS lazy-fetch safety net on web
- **ANTLR UUID.** `html/src/org/antlr/v4/runtime/atn/ATNDeserializer.java`
  is a web-only override — TeaVM doesn't emulate `new UUID(long, long)`, so
  we round-trip through `UUID.fromString`.
