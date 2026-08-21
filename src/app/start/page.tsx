import Link from 'next/link'
import { StartShahZap } from '@/app/components/start-shahzap'

export const metadata = { title: 'Start — ShahZap', description: 'Start an anonymous ShahZap session without creating an account.' }

const TRUST = [
  ['No email or password', 'A private session is created instantly in this browser.'],
  ['You choose what is visible', 'Every profile field has its own privacy toggle.'],
  ['Safety comes first', 'Age compatibility, blocking and reporting are built in.'],
] as const

export default function StartPage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[640px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-3xl" />

      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Link href="/" className="text-sm font-bold tracking-tight text-cyan-300">⚡ ShahZap</Link>
          <Link href="/" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:text-white">Back</Link>
        </div>
      </header>

      <section className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-800/60 bg-cyan-950/30 px-3 py-1 text-xs font-semibold text-cyan-300">Private by default</span>
        <h1 className="mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">Start without an account.</h1>
        <p className="mt-4 max-w-xl leading-8 text-slate-300">
          ShahZap creates an anonymous session so you can set up a pseudonymous
          profile — no email address, no password, no personal details.
        </p>

        <div className="mt-10 max-w-md">
          <StartShahZap />
        </div>

        <ul className="mt-12 grid gap-3 sm:grid-cols-3">
          {TRUST.map(([title, text]) => (
            <li key={title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{text}</p>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-xl text-xs leading-relaxed text-slate-500">
          Your anonymous session is tied to this browser. If you clear its data or
          switch devices, the anonymous account cannot be recovered unless a future
          identity-linking option is added.
        </p>
      </section>
    </main>
  )
}
