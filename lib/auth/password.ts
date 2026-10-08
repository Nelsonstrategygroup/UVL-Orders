// Password rules shared by "Forgot password?", "Change my password", and the
// admin's "Set a new password" on the Users screen.

export const MIN_PASSWORD = 8;

/** What's wrong with a new password typed twice, or null if it's fine. */
export function newPasswordProblem(password: string, again: string): string | null {
  if (password.length < MIN_PASSWORD) return `The new password needs at least ${MIN_PASSWORD} characters.`;
  if (password !== again) return "The two new passwords don't match. Please type them again.";
  return null;
}

/** How long after opening a reset link the person may set a password without the old one. */
export const RESET_WINDOW_MS = 60 * 60 * 1000;

type Amr = { method?: string; timestamp?: number }[] | undefined;

/**
 * True when this session came from a password reset link opened in the last
 * hour: it was not started with a password. Such a session may set a new
 * password without typing the old one. Any other session must give the
 * current password ("Change my password").
 */
export function isFreshResetSession(amr: Amr, now: number = Date.now()): boolean {
  if (!amr?.length) return false;
  if (amr.some((a) => a.method === "password")) return false;
  const newest = Math.max(...amr.map((a) => (a.timestamp ?? 0) * 1000));
  return now - newest <= RESET_WINDOW_MS;
}

/** The message after "Send reset link". Always the same, so it never says whether an email has a login. */
export const RESET_SENT_MESSAGE = "If that email has a login, a reset link is on its way. Check your email.";
