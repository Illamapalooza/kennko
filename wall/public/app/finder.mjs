const LOOKING_COPY = "Looking for Kennko POS on the wifi…";
const LOST_COPY = "Can't find Kennko POS. Is the tablet on, with Kennko POS open? Still looking.";

export function createFinder({
  find,
  open,
  saved,
  manual,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  onState = () => {},
}) {
  let stopped = false;
  let activeConn = null;
  let lostSince = 0;
  let wakeup = null;

  const wake = () => {
    const fn = wakeup;
    wakeup = null;
    if (fn) fn();
  };

  function emitLooking() {
    if (!lostSince) lostSince = now();
    if (now() - lostSince >= 30_000) onState("lost", LOST_COPY);
    else onState("looking", LOOKING_COPY);
  }

  function tryUrl(url) {
    return new Promise((resolve) => {
      if (stopped) { resolve(false); return; }
      let settled = false;
      let connected = false;
      let watchdog = null;

      const resetWatchdog = () => {
        if (watchdog !== null) timers.clear(watchdog);
        watchdog = timers.set(() => {
          watchdog = null;
          conn.close();
        }, 45_000);
      };

      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (watchdog !== null) { timers.clear(watchdog); watchdog = null; }
        activeConn = null;
        resolve(ok);
      };

      resetWatchdog();
      const conn = open(url, {
        onUp() {
          connected = true;
          lostSince = 0;
          saved.set(url);
          onState("connected", "");
          resetWatchdog();
        },
        onFrame() {
          resetWatchdog();
        },
        onDown() {
          if (connected) {
            emitLooking();
          }
          finish(connected);
        },
      });
      activeConn = conn;
    });
  }

  async function loop() {
    lostSince = now();
    emitLooking();
    while (!stopped) {
      const candidates = [];
      try {
        const found = await find();
        if (found && "host" in found && found.host) {
          candidates.push(`http://${found.host}:${found.port}`);
        }
      } catch { /* ignore */ }
      const s = saved.get();
      if (s && !candidates.includes(s)) candidates.push(s);
      const m = (manual() || "").trim().replace(/\/+$/, "");
      if (m && !candidates.includes(m)) candidates.push(m);

      let hadConnection = false;
      for (const url of candidates) {
        if (stopped) break;
        const ok = await tryUrl(url);
        if (ok) { hadConnection = true; break; }
      }
      if (stopped) break;
      if (!hadConnection) emitLooking();

      await Promise.race([
        wait(10_000),
        new Promise((resolve) => { wakeup = resolve; }),
      ]);
      wakeup = null;
    }
  }

  return {
    start() {
      stopped = false;
      loop();
    },
    stop() {
      stopped = true;
      activeConn?.close();
      wake();
    },
    retry() {
      activeConn?.close();
      wake();
    },
  };
}
