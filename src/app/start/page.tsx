import Link from "next/link";
import { StartShahZap } from "@/app/components/start-shahzap";

export default function StartPage() {
  return (
    <main className="shell">
      <nav className="nav"><Link href="/" className="brand"><span className="logo">⚡</span>ShahZap</Link><Link href="/" className="button">Back</Link></nav>
      <section className="hero" style={{ gridTemplateColumns: "1fr", maxWidth: 820 }}>
        <div>
          <div className="eyebrow">Private by default</div>
          <h1>Start without an account.</h1>
          <p className="lead">ShahZap creates an anonymous Supabase session so you can set up a pseudonymous profile without giving us an email address or password.</p>
          <StartShahZap />
          <p className="mt-5 max-w-xl text-sm text-slate-500">Your anonymous session is tied to this browser. If you clear its data or use another device, the anonymous account cannot be recovered unless a future identity-linking option is added.</p>
        </div>
      </section>
    </main>
  );
}
