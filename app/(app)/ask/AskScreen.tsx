"use client";

// One question at a time, big and simple. Earlier questions and answers on
// this screen (and the queries behind them) are sent along so a follow-up
// ("and the week before?", "why is that so high?") works.

import { useRef, useState } from "react";

type Query = { purpose: string; sql: string; rowCount?: number; truncated?: boolean; error?: string };
type Turn = { question: string; answer: string; queries: Query[] };

const EXAMPLES = [
  "How many BNLS Legs were ordered this week?",
  "Which customers haven't ordered this week?",
  "How many boxes are on each pallet this week, and how much do they weigh?",
];

export default function AskScreen({ showSql }: { showSql: boolean }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError("");
    // The last 10 questions, each answer with the queries behind it, so a
    // follow-up ("why is that so high?") digs into the same rows.
    const history = turns.slice(-10).flatMap((t) => [
      { role: "user", content: t.question },
      { role: "assistant", content: t.answer, queries: t.queries },
    ]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; queries?: Query[]; error?: string };
      if (data.answer !== undefined) {
        setTurns((ts) => [...ts, { question: q, answer: data.answer!, queries: data.queries ?? [] }]);
        setQuestion("");
      } else {
        setError(data.error || "Ask couldn't get an answer just now. Try again.");
      }
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="grid gap-3">
      <div className="card">
        <h2>Ask a question</h2>
        <p className="muted mb-2">Ask about orders, packing, customers and more, in your own words. Answers come from the app&apos;s records.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(question);
          }}
        >
          <textarea
            ref={box}
            className="field w-full text-[1.1rem]"
            rows={3}
            aria-label="Your question"
            placeholder="Type your question here"
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(question);
              }
            }}
          />
          <button type="submit" className="btn mt-2 min-h-[56px] w-full text-[1.1rem]" disabled={busy || !question.trim()}>
            {busy ? "Looking it up…" : "Ask"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-[1.02rem] text-bad">
            {error}
          </p>
        )}
        {turns.length === 0 && !busy && (
          <div className="mt-3">
            <p className="small muted mb-1">For example:</p>
            <div className="grid gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn ghost min-h-[44px] text-left" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {[...turns].reverse().map((t, i) => (
        <div key={turns.length - i} className="card">
          <p className="small muted mb-1">You asked: {t.question}</p>
          <div className="whitespace-pre-wrap text-[1.1rem] leading-relaxed">{t.answer}</div>
          {t.queries.length > 0 && (
            <details className="mt-2">
              <summary className="small muted min-h-[44px] cursor-pointer">How I found this</summary>
              <ul className="small mt-1 grid gap-2">
                {t.queries.map((q, j) => (
                  <li key={j}>
                    {q.purpose || "Looked something up"}
                    {q.error ? " (didn't work, tried again)" : q.truncated ? ` (first ${q.rowCount} rows)` : ""}
                    {showSql && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-field p-2 text-[.8rem]">{q.sql}</pre>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}

      {turns.length > 0 && (
        <button type="button" className="btn ghost min-h-[44px]" onClick={() => setTurns([])}>
          Start over
        </button>
      )}
    </div>
  );
}
