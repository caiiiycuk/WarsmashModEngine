import { useEffect } from 'preact/hooks';
import EnginePage from './components/EnginePage';
import { parseLaunchConfig } from './lib/launchConfig';
import { versionedAsset } from './lib/version';

export default function App() {
  const parsed = parseLaunchConfig(window.location.search);
  useEffect(() => {
    document.body.classList.add('engine-page');
    const blockContextMenu = (e: Event) => e.preventDefault();
    document.body.addEventListener('contextmenu', blockContextMenu);
    return () => document.body.removeEventListener('contextmenu', blockContextMenu);
  }, []);

  return (
    <>
      <div id="canvas-wrap"><canvas id="canvas" /></div>
      <div id="splash">
        <img id="splash-img" alt="" src={versionedAsset('goblin-tinker.webp')} />
        <div class="label">Initializing</div>
      </div>
      {parsed.ok
        ? <EnginePage launchConfig={parsed.config} />
        : <LaunchError errors={parsed.errors} />}
    </>
  );
}

function LaunchError({ errors }: { errors: string[] }) {
  return (
    <div class="boot-overlay">
      <div class="boot-overlay-card">
        <h1>Cannot start Warsmash</h1>
        <p>The launch URL is invalid:</p>
        <ul class="launch-errors">{errors.map((e) => <li>{e}</li>)}</ul>
      </div>
    </div>
  );
}
