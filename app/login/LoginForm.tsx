"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} noValidate>
      <label className="lbl big" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        className="field big"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.email}
        required
      />

      <label className="lbl big" htmlFor="password">
        Password
      </label>
      <div className="flex gap-2">
        <input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          className="field big"
          autoComplete="current-password"
          required
        />
        <button
          type="button"
          className="btn ghost min-w-[5.5rem] shrink-0"
          onClick={() => setShow((s) => !s)}
          aria-pressed={show}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>

      {state.error && (
        <p className="note bad mt-4" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className="bigbtn mt-5!" disabled={pending}>
        {pending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
