const KEY = "smokeshield.sound";

export const soundEnabled = () => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};

export const setSoundEnabled = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable */
  }
};

/** Short two-tone alarm. Silently does nothing if the browser blocks audio before a user gesture. */
export function beep() {
  try {
    const ctx = new AudioContext();
    const tone = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.18);
    };
    tone(880, 0);
    tone(660, 0.22);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* audio unavailable */
  }
}
