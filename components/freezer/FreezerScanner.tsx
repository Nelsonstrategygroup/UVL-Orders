"use client";

// Scanning for the freezer (Add to freezer and counts): choose the Bluetooth
// scanner or the phone camera once, then scan continuously. Same parts as
// Scan boxes on Packing: the camera reader, and a box the scanner types into.

import { useEffect, useRef, useState } from "react";
import CameraScanner from "@/components/scan/CameraScanner";
import { unlockSound } from "@/lib/scan/feedback";

export type ScanMode = "" | "bluetooth" | "camera";

export default function FreezerScanner({
  mode,
  setMode,
  paused,
  onRead,
  disabled,
}: {
  mode: ScanMode;
  setMode: (m: ScanMode) => void;
  /** A question is open: the camera stops and the scanner box lets go of the focus. */
  paused: boolean;
  onRead: (text: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLInputElement>(null);
  // The scanner box keeps the focus whenever nothing else is open, so the next label goes in.
  useEffect(() => {
    if (mode !== "bluetooth" || paused) return;
    const t = setInterval(() => {
      const el = document.activeElement;
      if (!el || el === document.body) box.current?.focus();
    }, 500);
    box.current?.focus();
    return () => clearInterval(t);
  }, [mode, paused]);

  if (!mode)
    return (
      <div className="mt-3 grid gap-2">
        <p className="lbl m-0">How are you scanning?</p>
        <button
          type="button"
          className="scanbtn"
          disabled={disabled}
          onClick={() => {
            unlockSound();
            setMode("bluetooth");
          }}
        >
          Bluetooth scanner
        </button>
        <button
          type="button"
          className="scanbtn alt"
          disabled={disabled}
          onClick={() => {
            unlockSound();
            setMode("camera");
          }}
        >
          Phone camera
        </button>
      </div>
    );

  return (
    <>
      <div className="scanmode mt-3">
        <span className="flex-1">
          <b>{mode === "bluetooth" ? "Bluetooth scanner" : "Phone camera"}</b>
          <span className="small block">{mode === "bluetooth" ? "Camera off. Scan a label." : "Hold a label in the frame."}</span>
        </span>
        <button type="button" className="btn ghost" onClick={() => setMode(mode === "bluetooth" ? "camera" : "bluetooth")}>
          {mode === "bluetooth" ? "Use the camera" : "Use the scanner"}
        </button>
        <button type="button" className="btn" onClick={() => setMode("")}>
          Done scanning
        </button>
      </div>
      {mode === "camera" && <CameraScanner active={!paused} onRead={onRead} />}
      {mode === "bluetooth" && <ScannerBox inputRef={box} onRead={onRead} />}
    </>
  );
}

/** The box a Bluetooth scanner (keyboard mode) types into: it types the label and presses Enter. */
function ScannerBox({ inputRef, onRead }: { inputRef: React.RefObject<HTMLInputElement | null>; onRead: (text: string) => void }) {
  const [typed, setTyped] = useState("");
  const [keyboard, setKeyboard] = useState(false);
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = typed;
        setTyped("");
        if (t.trim()) onRead(t);
      }}
    >
      <label className="grid flex-1 gap-1">
        <span className="lbl m-0">Scanner</span>
        <input
          ref={inputRef}
          className="field"
          value={typed}
          inputMode={keyboard ? "numeric" : "none"}
          autoComplete="off"
          placeholder="Scan a box label"
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <button type="button" className="btn ghost" onClick={() => setKeyboard((k) => !k)}>
        {keyboard ? "Hide keys" : "Type it"}
      </button>
      <button type="submit" className="btn ghost">
        Enter
      </button>
    </form>
  );
}
