"use client";

// The Ask conversation, kept in the app shell so it stays the same on the Ask
// screen and in the side panel, and carries on as you move between screens.
// It goes away on reload or log out (nothing is saved).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { splitAnswer } from "@/lib/ai/answerText";
import { speak, stopSpeaking, unlockSpeech } from "./speech";

export type AskQuery = { purpose: string; sql: string; rowCount?: number; truncated?: boolean; error?: string };
export type AskTurn = { id: string; question: string; answer: string; queries: AskQuery[]; spoken: boolean };

type Ask = {
  turns: AskTurn[];
  busy: boolean;
  error: string;
  /** Read every answer aloud, not only answers to spoken questions (remembered on this device). */
  readAloud: boolean;
  setReadAloud: (on: boolean) => void;
  send: (text: string, opts?: { spoken?: boolean }) => Promise<boolean>;
  clear: () => void;
  showSql: boolean;
};

const AskContext = createContext<Ask | null>(null);
const READ_KEY = "uvl:askReadAloud";

export function AskProvider({ showSql, children }: { showSql: boolean; children: React.ReactNode }) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readAloud, setReadAloudState] = useState(false);
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  });

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read a device setting after load
      setReadAloudState(localStorage.getItem(READ_KEY) === "1");
    } catch {
      // Private browsing: the setting just won't be remembered.
    }
  }, []);

  const setReadAloud = useCallback((on: boolean) => {
    setReadAloudState(on);
    if (!on) stopSpeaking();
    try {
      localStorage.setItem(READ_KEY, on ? "1" : "0");
    } catch {
      // Private browsing.
    }
  }, []);

  const busyRef = useRef(false);
  const send = useCallback(
    async (text: string, opts: { spoken?: boolean } = {}) => {
      const q = text.trim();
      if (!q || busyRef.current) return false;
      const spoken = opts.spoken === true;
      if (spoken || readAloud) unlockSpeech();
      busyRef.current = true;
      setBusy(true);
      setError("");
      // The last 10 questions, each answer with the queries behind it, so a
      // follow-up ("why is that so high?") digs into the same rows.
      const history = turnsRef.current.slice(-10).flatMap((t) => [
        { role: "user", content: t.question },
        { role: "assistant", content: t.answer, queries: t.queries },
      ]);
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, history, spoken }),
        });
        const data = (await res.json().catch(() => ({}))) as { answer?: string; queries?: AskQuery[]; error?: string };
        if (data.answer !== undefined) {
          const turn: AskTurn = { id: `${Date.now()}`, question: q, answer: data.answer, queries: data.queries ?? [], spoken };
          setTurns((ts) => [...ts, turn]);
          // Read only the answer, not the notes folded under it.
          if (spoken || readAloud) speak(splitAnswer(turn.answer).main, turn.id);
          return true;
        }
        setError(data.error || "Ask couldn't get an answer just now. Try again.");
      } catch {
        setError("No connection. Try again when you have signal.");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return false;
    },
    [readAloud],
  );

  const clear = useCallback(() => {
    stopSpeaking();
    setTurns([]);
    setError("");
  }, []);

  return (
    <AskContext.Provider value={{ turns, busy, error, readAloud, setReadAloud, send, clear, showSql }}>
      {children}
    </AskContext.Provider>
  );
}

export function useAsk(): Ask {
  const a = useContext(AskContext);
  if (!a) throw new Error("useAsk outside AskProvider");
  return a;
}
