"use client";

// The phone camera, reading box labels continuously while `active`. Calls
// onRead with each label's text once; the same label is ignored for a few
// seconds so one box isn't read twice while it's still in view.

import { useEffect, useRef, useState } from "react";
import { makeFrameReader, type FrameReader } from "@/lib/scan/reader";

const SAME_LABEL_MS = 3000;
const EVERY_MS = 150;

export default function CameraScanner({ active, onRead }: { active: boolean; onRead: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<FrameReader["kind"] | null>(null);
  const [torch, setTorch] = useState<{ on: boolean; set: (on: boolean) => void } | null>(null);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const last = { text: "", at: 0 };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "The camera is blocked. Allow the camera for this site in the phone's settings, or use a Bluetooth scanner."
            : "The camera couldn't start. Use a Bluetooth scanner or type the label.",
        );
        return;
      }
      if (stop || !video.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);

      // A light for dim freezers, where the phone has one.
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      if (caps.torch) {
        const set = (on: boolean) => {
          void track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
          setTorch({ on, set });
        };
        setTorch({ on: false, set });
      }

      const reader = await makeFrameReader();
      if (stop) return;
      setKind(reader.kind);
      const tick = async () => {
        if (stop || !video.current) return;
        try {
          const texts = await reader.read(video.current);
          const now = Date.now();
          for (const t of texts) {
            if (t === last.text && now - last.at < SAME_LABEL_MS) continue;
            last.text = t;
            last.at = now;
            onReadRef.current(t);
            break;
          }
        } catch {
          // A frame that can't be read; try the next one.
        }
        if (!stop) timer = setTimeout(() => void tick(), EVERY_MS);
      };
      void tick();
    })();

    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      setTorch(null);
    };
  }, [active]);

  if (!active) return null;
  return (
    <div className="scanview">
      {problem ? (
        <p className="note bad m-0">{problem}</p>
      ) : (
        <>
          <video ref={video} playsInline muted aria-label="Camera" />
          <div className="scanguide" aria-hidden="true" />
          <div className="scanbar">
            <span className="small">{kind ? "Hold the barcode across the line" : "Starting the camera..."}</span>
            {torch && (
              <button type="button" className="btn ghost" onClick={() => torch.set(!torch.on)}>
                {torch.on ? "Light off" : "Light on"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
