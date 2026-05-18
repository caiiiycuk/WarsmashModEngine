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
cd html/web-src && npm run vite          # Vite dev server + HMR for the frontend
```

Then open the URL printed by Vite, for example <http://127.0.0.1:5173/?mode=single>.
In dev mode, Vite serves the live Preact frontend from `html/web-src` and transparently
falls back to the already-built engine files in `html/build/dist/webapp`, so there is no
manual `dist/` copy step while iterating on UI code.

If Java, TeaVM, worker boot code, or engine-side resources change, run the full Gradle
build again before testing so the fallback engine artifacts are refreshed. For a
production-like local run, keep using the build-and-serve flow above.

## Launch URL contract

The app now has one HTML entrypoint and always renders the game shell. Launch mode is fixed at page load by query params:

| params | meaning |
|---|---|
| `?mode=single` | normal single-player/menu boot (the default if `mode` is omitted) |
| `?mode=single&map=Maps/...` | single-player boot with an optional map hint |
| `?mode=webrtc&room=ROOM&role=host&map=Maps/...` | multiplayer host bootstrap |
| `?mode=webrtc&room=ROOM&role=client` | multiplayer client bootstrap |

For `mode=webrtc`, `room` and `role` are always required. `map` is required only
for the host: the host fixes the map when creating the room, and joiners receive
that room state from the host after connecting. Optional match-only slot
configuration can be passed as URL-encoded `slots=<json-array>`. Offers,
answers, ICE candidates, and other transport internals are deliberately not part
of the URL contract.

## Starting a multiplayer match

For a simple two-player smoke test, use `Maps/FrozenThrone/(2)EchoIsles.w3x`
from a normal TFT install. In the local Warcraft III tree used while writing
this note, that file lives at:

```text
Maps/FrozenThrone/(2)EchoIsles.w3x
```

1. Build and serve the web app:

   ```sh
   ./html/dev.sh build
   ./html/dev.sh serve
   ```

2. Open the host URL in one browser window:

   ```text
   http://127.0.0.1:8000/?mode=webrtc&role=host&room=test-room&map=Maps%2FFrozenThrone%2F%282%29EchoIsles.w3x
   ```

3. Open the client URL in another browser window:

   ```text
   http://127.0.0.1:8000/?mode=webrtc&role=client&room=test-room
   ```

The host owns the room state: joiners are seated into the first available slot,
slot settings are synchronized from the host, and the map is not changeable after
room creation. Once everyone is ready, the host starts the match manually with
the room's **Start** button.


To start write 
```
window.postMessage({ 
	event: "mp.room.netConfig", 
	netConfig: {
		debug: true,
		iceServers: [{ urls: "stun:stun.l.google.com:19302" }] 
	},
})
```

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
