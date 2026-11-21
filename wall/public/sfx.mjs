export function createSfx(ctx) {
  const sfx = {
    muted: false,
    volume: 0.15,
    play(kind) {
      if (!ctx || sfx.muted) return;
      if (ctx.state === "suspended") ctx.resume?.().catch(() => {});
      const now = ctx.currentTime;
      const v = sfx.volume;
      const tone = (freq, delay, dur, gainPeak = v, type = "sine") => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + delay);
        gain.gain.setValueAtTime(0.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak), now + delay + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + dur + 0.05);
      };

      switch (kind) {
        case "ready":
          tone(1318.5, 0, 1.3, v * 2.2);
          tone(1760, 0.17, 1.3, v * 2.2);
          break;
        case "join":
          tone(523.25, 0, 0.12, v * 0.9, "triangle");
          break;
        case "preparing":
          tone(330, 0, 0.08, v * 0.6, "triangle");
          break;
        case "catIn":
          tone(587.33, 0, 0.11, v * 0.8);
          tone(783.99, 0.09, 0.14, v * 0.8);
          break;
        case "catOut":
          tone(783.99, 0, 0.11, v * 0.7);
          tone(587.33, 0.09, 0.14, v * 0.7);
          break;
      }
    },
  };
  return sfx;
}
