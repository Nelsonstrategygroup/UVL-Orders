// Sounds and buzzes for scanning in a cold room with gloves on (SPEC 11.5):
// one short high beep for a good scan, a low double tone for a problem.
// Browser only. Phones without vibration (iPhone) just play the sound.

let audio: AudioContext | null = null;

function tone(freq: number, start: number, length: number, ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.18, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + length + 0.02);
}

/** Call from a tap (e.g. "Start scanning") so phones allow sound later. */
export function unlockSound() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audio && Ctx) audio = new Ctx();
    void audio?.resume();
  } catch {
    // No sound on this device; vibration and the screen still show it.
  }
}

export function goodScan() {
  try {
    if (audio) tone(1800, 0, 0.09, audio);
    navigator.vibrate?.(70);
  } catch {
    // ignore
  }
}

export function badScan() {
  try {
    if (audio) {
      tone(300, 0, 0.16, audio);
      tone(220, 0.2, 0.22, audio);
    }
    navigator.vibrate?.([120, 80, 220]);
  } catch {
    // ignore
  }
}
