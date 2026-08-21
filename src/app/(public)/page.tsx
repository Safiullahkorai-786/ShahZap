import Link from 'next/link'

export const metadata = { title: 'ShahZap — Anonymous Random Chat With People Worldwide', description: 'Meet people through privacy-first random conversations, intelligent matching, interests, and automatic translation.' }

const FEATURES = [
  ['⚡', 'Anonymous by design', 'Use a pseudonymous profile and control exactly what others can see.'],
  ['🌎', 'Meet people worldwide', 'Discover compatible people beyond your usual social circle.'],
  ['💬', 'Smart matching', 'Preferences, safety, language, generation and interests guide every match.'],
  ['🌐', 'Automatic translation', 'Chat across languages while keeping original messages available.'],
  ['🛡️', 'Safety controls', 'Report, block and moderation tools keep conversations safer.'],
  ['🎮', 'Progression & rewards', 'Earn XP through meaningful activity and unlock useful rewards.'],
] as const

const STEPS = [
  ['Set your preferences', 'Choose language, interests and privacy levels in under a minute.'],
  ['Get matched', 'Safety and compatibility come first, then preferences and interests.'],
  ['Start chatting', 'Real-time conversation with automatic translation built in.'],
  ['Stay connected', 'Add friends, earn progression and unlock rewards along the way.'],
] as const

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <p className="text-sm font-bold tracking-tight text-cyan-300">⚡ ShahZap</p>
          <nav className="flex items-center gap-3">
            <Link href="/how-it-works" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white sm:block">How it works</Link>
            <Link href="/start" className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:brightness-110">Start free</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-cyan-800/60 bg-cyan-950/30 px-3 py-1 text-xs font-semibold text-cyan-300">Private session · no email needed</span>
          <h1 className="mt-6 max-w-4xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl sm:leading-tight">
            Anonymous random chat.<br />
            <span className="bg-gradient-to-r from-cyan-300 to-cyan-500 bg-clip-text text-transparent">Real people. New connections.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Meet people around the world through anonymous, moderated conversations.
            Choose who you want to meet, connect through shared interests, chat in your
            own language — and stay in control of your privacy.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/start" className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-8 py-4 font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110">⚡ Start Random Chat</Link>
            <Link href="/how-it-works" className="rounded-xl border border-slate-700 px-8 py-4 font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white">How it works</Link>
          </div>
          <p className="mt-5 text-xs text-slate-500">No account. No email. Just a nickname.</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, text]) => (
            <article key={title} className="group rounded-3xl border border-slate-800 bg-slate-900/70 p-6 transition hover:border-cyan-900/60 hover:bg-slate-900">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 text-lg">{icon}</div>
              <h2 className="mt-5 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-slate-800/80">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-bold tracking-tight">How ShahZap works</h2>
          <p className="mt-2 text-sm text-slate-400">From first click to first conversation in four steps.</p>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-cyan-800/60 bg-cyan-950/40 text-sm font-bold text-cyan-300">{i + 1}</span>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 rounded-3xl border border-cyan-900/60 bg-gradient-to-br from-cyan-950/40 to-slate-900 p-10 text-center">
            <h3 className="text-2xl font-bold tracking-tight">Ready to meet someone new?</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Your anonymous profile takes less than a minute to set up.</p>
            <Link href="/start" className="mt-6 inline-block rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-8 py-4 font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110">⚡ Find someone</Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-xs text-slate-500 sm:flex-row">
          <p>⚡ ShahZap — privacy-first social discovery.</p>
          <div className="flex gap-4">
            <Link href="/how-it-works" className="transition hover:text-slate-300">How it works</Link>
            <Link href="/safety" className="transition hover:text-slate-300">Safety</Link>
            <Link href="/privacy" className="transition hover:text-slate-300">Privacy</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
