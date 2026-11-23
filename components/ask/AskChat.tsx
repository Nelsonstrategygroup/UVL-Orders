"use client";

// Ask, big and simple: type or say a question, read or hear the answer. Used
// on the Ask screen and in the side panel; both share one conversation.

import { useEffect, useRef, useState } from "react";
import { answerLine } from "@/lib/ai/answerText";
import { useAsk } from "./AskProvider";
import { canSpeak, speak, stopSpeaking, useListen, useSpeaking } from "./speech";

const EXAMPLES = [
  "How many BNLS Legs were ordered this week?",
  "Which customers haven't ordered this week?",
  "How many boxes are on each pallet this week, and how much do they weigh?",
];

export default function AskChat({ autoFocus = false }: { autoFocus?: boolean }) {
  const { turns, busy, error, readAloud, setReadAloud, send, clear, showSql } = useAsk();
  const [question, setQuestion] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const speaking = useSpeaking();
  const [voiceOut, setVoiceOut] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only feature check
    setVoiceOut(canSpeak());
  }, []);

  async function submit(text: string, spoken = false) {
    if (await send(text, { spoken })) setQuestion("");
    box.current?.focus({ preventScroll: true });
  }

  const listen = useListen(setQuestion, (text) => submit(text, true));

  return (
    <div className="grid gap-3">
      <div className="card">
        <h2>Ask a question</h2>
        <p className="muted mb-2">
          Ask about orders, packing, customers and more, in your own words. Answers come from the app&apos;s records.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <textarea
            ref={box}
            autoFocus={autoFocus}
            className="field w-full text-[1.1rem]"
            rows={3}
            aria-label="Your question"
            placeholder={listen.listening ? "Listening…" : "Type your question here"}
            value={question}
            maxLength={2000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
          />
          <div className="mt-2 flex gap-2">
            <button type="submit" className="btn min-h-[56px] flex-1 text-[1.1rem]" disabled={busy || listen.listening || !question.trim()}>
              {busy ? "Looking it up…" : "Ask"}
            </button>
            {listen.supported && (
              <button
                type="button"
                className={`btn min-h-[56px] min-w-[56px] px-4 text-[1.05rem] ${listen.listening ? "" : "ghost"}`}
                onClick={listen.listening ? listen.stop : listen.start}
                disabled={busy}
                aria-pressed={listen.listening}
                aria-label={listen.listening ? "Stop listening" : "Say your question"}
              >
                <span aria-hidden="true">🎤</span> {listen.listening ? "Listening… tap when done" : "Talk"}
              </button>
            )}
          </div>
        </form>
        {(listen.error || error) && (
          <p role="alert" className="note bad mt-2 text-[1.02rem]">
            {listen.error || error}
          </p>
        )}
        {voiceOut && (
          <label className="mt-2 flex min-h-[44px] items-center gap-3">
            <input
              type="checkbox"
              checked={readAloud}
              onChange={(e) => setReadAloud(e.target.checked)}
              className="h-6 w-6 accent-forest"
            />
            Read every answer out loud
          </label>
        )}
        {listen.supported && (
          <p className="small muted mt-1">Tap Talk and say your question. When you stop talking, it&apos;s sent and the answer is read out loud.</p>
        )}
        {turns.length === 0 && !busy && (
          <div className="mt-3">
            <p className="small muted mb-1">For example:</p>
            <div className="grid gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn ghost min-h-[44px] text-left" onClick={() => submit(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {[...turns].reverse().map((t) => (
        <div key={t.id} className="card">
          <p className="small muted mb-1">You asked: {t.question}</p>
          <div className="whitespace-pre-wrap text-[1.1rem] leading-relaxed">
            {t.answer.split("\n").map((line, k) => (
              <span key={k}>
                {k > 0 && "\n"}
                {answerLine(line).map((p, n) => (p.bold ? <b key={n}>{p.text}</b> : p.text))}
              </span>
            ))}
          </div>
          {voiceOut && (
            <button
              type="button"
              className="btn ghost mt-2 min-h-[44px]"
              onClick={() => (speaking === t.id ? stopSpeaking() : speak(t.answer, t.id))}
            >
              <span aria-hidden="true">{speaking === t.id ? "■" : "🔊"}</span> {speaking === t.id ? "Stop reading" : "Read out loud"}
            </button>
          )}
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
        <button type="button" className="btn ghost min-h-[44px]" onClick={clear}>
          Start over
        </button>
      )}
    </div>
  );
}
