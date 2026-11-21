import { agedVisit, fromPosFeed } from "./pos-feed.mjs";

export function createFollower({
  baristas,
  board,
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) },
  onStandIn = () => {},
  onSnapshot = () => {},
}) {
  let state = { day: "", seq: 0, baristas, orders: [] };
  let visit = { visitors: [], checkin: null, tillNow: null };
  let visitReceivedAt = now();
  let menuList = [];
  let standInTimer = null;

  const currentSnapshot = () => ({
    state,
    now: now(),
    visit: agedVisit(visit, visitReceivedAt, now()),
  });

  function clearStandIn() {
    if (standInTimer !== null) {
      timers.clear(standInTimer);
      standInTimer = null;
    }
  }

  return {
    feed(raw) {
      if (raw && typeof raw === "object" && Array.isArray(raw.menu)) {
        menuList = raw.menu;
      }
      const next = fromPosFeed(raw, baristas);
      if (!next) return;
      clearStandIn();
      const { visitors, checkin, tillNow, ...sheet } = next;
      state = sheet;
      visit = { visitors, checkin, tillNow };
      visitReceivedAt = now();
      onSnapshot(currentSnapshot());
    },

    up() {
      clearStandIn();
    },

    down() {
      if (visit.checkin) {
        visit = { ...visit, checkin: null };
        onSnapshot(currentSnapshot());
      }
      if (!board && standInTimer === null) {
        standInTimer = timers.set(() => {
          standInTimer = null;
          onStandIn();
        }, 15_000);
      }
    },

    snapshot: currentSnapshot,
    menu: () => menuList,
  };
}
