"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { ROLE_INFO, ROLES, type Role } from "@/lib/auth/roles";
import { blockedReason, byName } from "@/lib/auth/userRules";
import { formatDateTime } from "@/lib/format";
import {
  addUser,
  deleteUser,
  renameUser,
  setUserActive,
  setUserEmail,
  setUserPassword,
  setUserRole,
  type ActionResult,
} from "./actions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
};

// Sections that open and close. Role sections start open; "Turned off"
// starts closed. What someone opens or closes is remembered on this device.
type SectionKey = Role | "off";
const DEFAULT_OPEN: Record<SectionKey, boolean> = { admin: true, office: true, packing: true, viewer: true, off: false };
const STORE = "uvl.users.sections";

function useSections() {
  const [open, setOpen] = useState(DEFAULT_OPEN);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<Record<SectionKey, boolean>>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after the page loads
      setOpen((o) => ({ ...o, ...saved }));
    } catch {
      // No storage on this device: use the defaults.
    }
  }, []);
  const set = (k: SectionKey, v: boolean) =>
    setOpen((o) => {
      const next = { ...o, [k]: v };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Not saved; fine.
      }
      return next;
    });
  return [open, set] as const;
}

export default function UsersScreen({ users, myId }: { users: UserRow[]; myId: string }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useSections();
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditingId(null), []);
  const editing = users.find((u) => u.id === editingId) ?? null;

  const sections: { key: SectionKey; title: string; list: UserRow[] }[] = [
    ...ROLES.map((r) => ({ key: r as SectionKey, title: ROLE_INFO[r].label, list: byName(users.filter((u) => u.active && u.role === r)) })),
    { key: "off", title: "Turned off", list: byName(users.filter((u) => !u.active)) },
  ];

  return (
    <>
      <button type="button" className="bigbtn mt-0! mb-4" onClick={() => setAdding(true)}>
        Add a person
      </button>

      {users.length === 0 && <p className="panel empty">No one yet.</p>}
      {sections
        .filter((sec) => sec.key !== "off" || sec.list.length > 0)
        .map((sec) => (
          <details
            key={sec.key}
            className="mb-3"
            open={open[sec.key]}
            onToggle={(e) => {
              const now = (e.currentTarget as HTMLDetailsElement).open;
              if (now !== open[sec.key]) setOpen(sec.key, now);
            }}
          >
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[1.1rem] font-semibold">
              {sec.title} ({sec.list.length})
            </summary>
            {sec.key === "off" && <p className="small muted mt-0 mb-2">Tap someone to turn their login back on.</p>}
            <div className="grid gap-1.5">
              {sec.list.map((u) => (
                <UserLine key={u.id} user={u} isMe={u.id === myId} onOpen={() => setEditingId(u.id)} />
              ))}
              {sec.list.length === 0 && <p className="small muted my-1">No one.</p>}
            </div>
          </details>
        ))}

      {adding && (
        <Sheet title="Add a person" onClose={closeAdd}>
          <AddUserForm onDone={closeAdd} />
        </Sheet>
      )}
      {editing && (
        <Sheet title={editing.name || editing.email} onClose={closeEdit}>
          <EditUser user={editing} users={users} myId={myId} onDone={closeEdit} />
        </Sheet>
      )}
    </>
  );
}

/** One person: name, then email and last login. The whole row opens Change. */
function UserLine({ user: u, isMe, onOpen }: { user: UserRow; isMe: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Change ${u.name || u.email}`}
      className={`flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 rounded-[10px] border border-line px-3 py-2 text-left ${u.active ? "bg-paper" : "bg-field"}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">
          {u.name || u.email}
          {isMe && <span className="muted font-normal"> (you)</span>}
        </span>
        <span className="block truncate text-[.85rem] text-ink-soft">
          {u.email} · {u.lastLoginAt ? `Last logged in ${formatDateTime(u.lastLoginAt)}` : "Has not logged in yet"}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl text-forest">
        ›
      </span>
    </button>
  );
}

function PasswordInput({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        className="field big"
        autoComplete="new-password"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
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
  );
}

function RoleChoice({ value, onChange, disabled }: { value: Role | null; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2" role="group" aria-label="What they do">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          className="bigchoice"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          disabled={disabled}
        >
          <b>{ROLE_INFO[r].label}</b>
          {ROLE_INFO[r].sub}
        </button>
      ))}
    </div>
  );
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "note mt-3" : "note bad mt-3"} role={result.ok ? "status" : "alert"}>
      {result.message}
    </p>
  );
}

function AddUserForm({ onDone }: { onDone: () => void }) {
  const [result, action, pending] = useActionState(addUser, null);
  const [role, setRole] = useState<Role | null>(null);

  if (result?.ok) {
    return (
      <div>
        <Result result={result} />
        <p className="muted">Give them their email and password in person or by phone.</p>
        <button type="button" className="bigbtn" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form action={action}>
      <label className="lbl big" htmlFor="add-name">
        Name
      </label>
      <input id="add-name" name="name" className="field big" autoComplete="off" autoFocus />

      <label className="lbl big" htmlFor="add-email">
        Email
      </label>
      <input
        id="add-email"
        name="email"
        type="email"
        className="field big"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />

      <label className="lbl big" htmlFor="add-password">
        Password
      </label>
      <PasswordInput id="add-password" name="password" />
      <p className="muted small mt-1">At least 8 characters.</p>

      <p className="lbl big">What do they do?</p>
      <RoleChoice value={role} onChange={setRole} />
      <input type="hidden" name="role" value={role ?? ""} />

      <Result result={result} />
      <button type="submit" className="bigbtn mt-4!" disabled={pending}>
        {pending ? "Adding..." : "Add this person"}
      </button>
    </form>
  );
}

function EditUser({ user, users, myId, onDone }: { user: UserRow; users: UserRow[]; myId: string; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isMe = user.id === myId;
  const neverIn = !user.lastLoginAt;

  // The same rules the server checks.
  const turnOffBlock = blockedReason("turnOff", user, users, myId);
  const deleteBlock = blockedReason("delete", user, users, myId);
  const roleBlock = (r: Role) => blockedReason("changeRole", user, users, myId, r);
  const anyRoleBlock = ROLES.filter((r) => r !== user.role).map(roleBlock).find(Boolean) ?? null;

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) after?.();
    });

  return (
    <div>
      {!neverIn && <p className="muted mt-0">{user.email}</p>}

      <section className="border-t border-line py-3">
        <label className="lbl big mt-0!" htmlFor="edit-name">
          Name
        </label>
        <div className="flex gap-2">
          <input id="edit-name" className="field big" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className="btn shrink-0"
            disabled={pending || name.trim() === user.name}
            onClick={() => run(() => renameUser(user.id, name))}
          >
            Save
          </button>
        </div>
      </section>

      {neverIn && (
        <section className="border-t border-line py-3">
          <label className="lbl big mt-0!" htmlFor="edit-email">
            Email
          </label>
          <div className="flex gap-2">
            <input
              id="edit-email"
              type="email"
              className="field big"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              type="button"
              className="btn shrink-0"
              disabled={pending || email.trim().toLowerCase() === user.email}
              onClick={() => run(() => setUserEmail(user.id, email))}
            >
              Save
            </button>
          </div>
          <p className="small muted mt-1 mb-0">They haven&apos;t logged in yet, so you can fix a typo here.</p>
        </section>
      )}

      <section className="border-t border-line py-3">
        <p className="lbl big mt-0!">What do they do?</p>
        {isMe ? (
          <p className="muted">
            You are {ROLE_INFO[user.role].label.toLowerCase()}. Another admin can change your role.
          </p>
        ) : (
          <>
            <RoleChoice
              value={user.role}
              disabled={pending}
              onChange={(r) => {
                if (r === user.role) return;
                const why = roleBlock(r);
                if (why) setResult({ ok: false, message: why });
                else run(() => setUserRole(user.id, r));
              }}
            />
            {anyRoleBlock && <p className="small muted mt-2 mb-0">{anyRoleBlock}</p>}
          </>
        )}
      </section>

      <section className="border-t border-line py-3">
        <label className="lbl big mt-0!" htmlFor="edit-password">
          Set a new password
        </label>
        <PasswordInput id="edit-password" value={password} onChange={setPassword} />
        <button
          type="button"
          className="btn mt-2"
          disabled={pending || password.length === 0}
          onClick={() => run(() => setUserPassword(user.id, password), () => setPassword(""))}
        >
          Save new password
        </button>
      </section>

      {!isMe && (
        <section className="border-t border-line py-3">
          {!user.active ? (
            <>
              <p className="muted mt-0">This login is turned off.</p>
              <button type="button" className="btn" disabled={pending} onClick={() => run(() => setUserActive(user.id, true))}>
                Turn it back on
              </button>
            </>
          ) : turnOffBlock ? (
            <p className="muted my-0">{turnOffBlock}</p>
          ) : (
            <>
              <p className="muted mt-0">Turning off a login logs them out and stops them logging in. You can turn it back on.</p>
              <button
                type="button"
                className="btn danger"
                disabled={pending}
                onClick={() => run(() => setUserActive(user.id, false))}
              >
                Turn off this login
              </button>
            </>
          )}
        </section>
      )}

      {!isMe && neverIn && !deleteBlock && (
        <section className="border-t border-line py-3">
          {confirmDelete ? (
            <>
              <p className="mt-0">
                Delete <b>{user.name || user.email}</b>? Their login is removed for good. You can add them again later.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteUser(user.id);
                      if (!r.ok) {
                        setResult(r);
                        setConfirmDelete(false);
                        return;
                      }
                      toast(r.message);
                      onDone();
                    })
                  }
                >
                  {pending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted mt-0">They have never logged in, so this login can be deleted.</p>
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
                Delete this login
              </button>
            </>
          )}
        </section>
      )}

      <Result result={result} />
      <div className="mt-3 flex justify-end">
        <button type="button" className="btn ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
