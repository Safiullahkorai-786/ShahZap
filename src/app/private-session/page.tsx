import type { Metadata } from 'next'
import Link from 'next/link'
import { AppHeader } from '@/components/app-header'
import { AdsterraBanner } from '@/components/adsterra-banner'

export const metadata = { title: 'How private sessions work' }

const POINTS: [string, string, string][] = [
  ['👤', 'Just a nickname', 'You pick a nickname — no email, no phone number, no password. Nobody here ever sees your real identity unless you tell them yourself.'],
  ['🌐', 'It lives in this browser', 'Your session is saved inside the browser you started it in (Chrome, Safari…). Close the app and come back later — you are still you.'],
  ['🧹', 'Clearing = fresh start', 'Delete your browser data or press "Start ShahZap" on a brand-new device and you get a completely new anonymous identity. Nothing to recover, by design.'],
]

const SAFE: [string, string][] = [
  ['You control every detail', 'Open Settings → Privacy & visibility to decide who can see your age band, gender, generation, country and interests — each has its own switch.'],
  ['Blocking works instantly', 'Block anyone from the chat menu. Both sides lose the ability to message, react or send friend requests — enforced on our servers, not just hidden.'],
  ['Reports go to real people', 'The Report button sends conversations to human moderation with full audit logs.'],
]

export default function PrivateSessionPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Private session" icon="shield" back="/" />
      <div className="mx-auto max-w-2xl w-full px-4 pb-10 pt-5">
        <p className="text-sm leading-relaxed text-slate-300">
          Every chat on ShahZap starts as a <b>private session</b>. Here is all you
          need to know — in plain words.
        </p>

        <section className="mt-6 space-y-3">
          {POINTS.map(([icon, title, body]) => (
            <div key={title} className="flex items-start gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <span className="text-2xl">{icon}</span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-400">{body}</span>
              </span>
            </div>
          ))}
        </section>

        <h2 className="mt-8 text-lg font-bold">Staying safe</h2>
        <section className="mt-3 space-y-3">
          {SAFE.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
              <p className="font-semibold text-emerald-300">✓ {title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/start" className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110">
            Start a private session
          </Link>
          <Link href="/settings" className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500">
            Open privacy settings
          </Link>
        </div>

        <div className="mt-8 flex justify-center">
          <AdsterraBanner size="300x250" />
        </div>
      </div>
    </main>
  )
}
