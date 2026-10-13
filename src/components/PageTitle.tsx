export default function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-dim mt-1.5 max-w-2xl">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="dimline" />
    </div>
  );
}
