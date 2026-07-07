export default function HomePage() {
  return (
    <main className="min-h-screen bg-base-black text-white">
      <section className="terminal-grid mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16">
        <p className="mb-4 text-sm uppercase tracking-[0.28em] text-base-mint">
          Public demo
        </p>
        <h1 className="max-w-3xl text-5xl font-semibold leading-tight md:text-7xl">
          Base Market Terminal Lite
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-emerald-50/72">
          A standalone MVP for exploring mock Base market data, token risk labels,
          and swap preview flows with no live transactions.
        </p>
      </section>
    </main>
  );
}
