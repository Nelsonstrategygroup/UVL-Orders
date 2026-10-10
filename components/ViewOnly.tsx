// The note on a screen someone can look at but not change.
export default function ViewOnly({ what }: { what: string }) {
  return (
    <p className="note small" role="note">
      You can look at {what}, but not change it. Ask an admin if you need to.
    </p>
  );
}
