/** The centred card every page sits in, with a gradient title and a short description. */
export function PageCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="space-y-2">
          <h1 className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            {title}
          </h1>
          <p className="text-sm leading-relaxed text-slate-400">{description}</p>
        </div>

        <div className="h-px bg-slate-800" />

        {children}
      </div>
    </main>
  );
}
