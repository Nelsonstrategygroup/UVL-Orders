"use client";

// Talking to Ask and hearing answers, with the browser's own speech (no extra
// service). Listening works in Chrome, Edge and Safari; Chrome sends the audio
// to Google to turn it into text. Reading aloud works in every browser.

import { useCallback, useEffect, useRef, useState } from "react";
import { forSpeech } from "@/lib/ai/spoken";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const HEARD_ERRORS: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it for this site in the browser, then try again.",
  "service-not-allowed": "The microphone is blocked. Allow it for this site in the browser, then try again.",
  "no-speech": "I didn't hear anything. Tap the microphone and try again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Listening needs a connection. Try again when you have signal.",
};

/**
 * Listen for one question. `onHeard` gets the words so far as they come in;
 * `onDone` gets the finished question when the person stops talking.
 */
export function useListen(onHeard: (text: string) => void, onDone: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const heard = useRef("");
  const cbs = useRef({ onHeard, onDone });
  useEffect(() => {
    cbs.current = { onHeard, onDone };
  });

  // Checked after the page loads, so the server and browser draw the same thing first.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only feature check
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    stopSpeaking();
    setError("");
    heard.current = "";
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard.current = text;
      cbs.current.onHeard(text);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(HEARD_ERRORS[e.error] ?? "Listening stopped. Tap the microphone to try again.");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const text = heard.current.trim();
      if (text) cbs.current.onDone(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError("Listening didn't start. Tap the microphone to try again.");
    }
  }, []);

  /** Stop listening now; what was heard so far is sent. */
  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported, listening, error, start, stop };
}

let speakingId: string | null = null;
const speakListeners = new Set<(id: string | null) => void>();
function setSpeaking(id: string | null) {
  speakingId = id;
  speakListeners.forEach((f) => f(id));
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Read an answer aloud. `id` lets a button show it's the one talking. */
export function speak(text: string, id: string) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  u.lang = "en-US";
  u.onend = u.onerror = () => {
    if (speakingId === id) setSpeaking(null);
  };
  setSpeaking(id);
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  setSpeaking(null);
}

/**
 * iPhones and iPads only let a page talk after a tap. Call this from a tap
 * (Ask, the microphone) so the answer can be read aloud when it arrives.
 */
export function unlockSpeech() {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

/** Which answer is being read aloud right now, if any. */
export function useSpeaking(): string | null {
  const [id, setId] = useState<string | null>(speakingId);
  useEffect(() => {
    speakListeners.add(setId);
    return () => {
      speakListeners.delete(setId);
    };
  }, []);
  return id;
}
