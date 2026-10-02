// Placeholder for screens built in later phases.
export default function ComingSoon({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[640px]">
      <h2 className="mb-3">{title}</h2>
      <div className="panel empty">
        <p className="m-0 text-[1.05rem]">This screen is coming soon.</p>
        {children && <p className="mt-2 mb-0">{children}</p>}
      </div>
    </div>
  );
}
