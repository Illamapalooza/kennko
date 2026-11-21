// Lets the wall follow the Kennko POS: real orders from the till drive the cats.
// Plain Node, no dependencies, like the rest of the wall.
import { agedVisit, fromPosFeed, sseParser } from "./public/pos-feed.mjs";

export { agedVisit, fromPosFeed, sseParser };

/**
 * Keep a connection to the till open for as long as the wall runs, reconnecting whenever it drops.
 * @param {string} baseUrl e.g. http://localhost:4466
 * @param {{ onFeed: (feed: unknown) => void, onUp: () => void, onDown: (why: string) => void }} handlers
 */
export function followPos(baseUrl, { onFeed, onUp, onDown }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/wall/events`;
  let stopped = false;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  (async () => {
    while (!stopped) {
      const abort = new AbortController();
      // The till sends a keepalive every 20s; a longer silence means the line is dead even if the socket is not.
      let quiet = setTimeout(() => abort.abort(), 45000);
      try {
        const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: abort.signal });
        if (!res.ok || !res.body) throw new Error(`the till answered ${res.status}`);
        onUp();
        const parse = sseParser((data) => {
          try { onFeed(JSON.parse(data)); } catch { /* a garbled message is skipped; the next one replaces it */ }
        });
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          clearTimeout(quiet);
          quiet = setTimeout(() => abort.abort(), 45000);
          parse(decoder.decode(chunk, { stream: true }));
        }
        throw new Error("the till closed the connection");
      } catch (err) {
        if (!stopped) onDown(err?.cause?.code === "ECONNREFUSED" ? "the till is not running" : err?.name === "AbortError" ? "the till went quiet" : err?.message === "terminated" ? "the till stopped" : String(err?.message ?? err));
      } finally {
        clearTimeout(quiet);
      }
      await wait(3000);
    }
  })();

  return () => { stopped = true; };
}
