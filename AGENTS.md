@/home/caiiiycuk/.codex/RTK.md

Project focus for the current work:
- Treat the web build as the only target unless the user explicitly asks about another platform.
- After engine code changes (.java) that affect the web build, run `./gradlew :html:buildWeb` so the browser artifacts are actually regenerated, not just recompiled.

This is a fork, and in case you need to compare something with original working game use commit d69e772b4dede6fd3569f9949a3180cdfea4635b.