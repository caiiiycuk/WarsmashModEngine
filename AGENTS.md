@/home/caiiiycuk/.codex/RTK.md

Project focus for the current work:
- Treat the web build as the only target unless the user explicitly asks about another platform.
- After engine code changes that affect the web build, run `./gradlew :html:buildWeb` so the browser artifacts are actually regenerated, not just recompiled.
