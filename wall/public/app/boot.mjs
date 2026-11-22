import { createFollower } from "../follow.mjs";
import { createFinder } from "./finder.mjs";
import { loadSfxEnabled, loadTillAddress, wireSettingsShortcut } from "./settings.mjs";

const SAVED_KEY = "kennko-wall-last-till";

export function bootApp({ apply, setBoot, setSfxMuted, setLink }) {
  setBoot({ ambient: false, pos: true, boardSize: 5 });
  setSfxMuted(!loadSfxEnabled());

  const follower = createFollower({
    baristas: 2,
    board: true,
    now: Date.now,
    onSnapshot: (snap) => apply(snap.state, snap.visit),
  });

  const findPlugin = window.Capacitor?.Plugins?.KennkoFind;
  const finder = createFinder({
    find: () => (findPlugin ? findPlugin.find({ timeoutMs: 5000 }) : Promise.resolve({ none: true })),
    open: (url, handlers) => {
      const es = new EventSource(`${url}/api/wall/events`);
      es.onopen = () => handlers.onUp();
      es.onmessage = (e) => {
        handlers.onFrame();
        try { follower.feed(JSON.parse(e.data)); } catch { /* ignore */ }
      };
      es.onerror = () => {
        es.close();
        follower.down();
        handlers.onDown();
      };
      return { close: () => es.close() };
    },
    saved: {
      get: () => { try { return localStorage.getItem(SAVED_KEY); } catch { return null; } },
      set: (u) => { try { localStorage.setItem(SAVED_KEY, u); } catch { /* ignore */ } },
    },
    manual: loadTillAddress,
    onState: (state, detail) => setLink(state !== "connected", detail || "Reconnecting…"),
  });

  wireSettingsShortcut({
    version: "0.0.1",
    onRetry: () => finder.retry(),
    onSfxChange: (on) => setSfxMuted(!on),
  });

  finder.start();
}
