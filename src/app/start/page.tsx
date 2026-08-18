import Link from "next/link";

export default function StartPage() {
  return (
    <main className="shell">
      <nav className="nav"><Link href="/" className="brand"><span className="logo">⚡</span>ShahZap</Link><Link href="/" className="button">Back</Link></nav>
      <section className="hero" style={{ gridTemplateColumns: "1fr", maxWidth: 820 }}>
        <div>
          <div className="eyebrow">Step 1 foundation</div>
          <h1>Ready when you are.</h1>
          <p className="lead">The full onboarding, authentication, matching queue, and realtime chat arrive in their dedicated build phases. This page is intentionally a foundation placeholder rather than pretending those systems are complete.</p>
          <div className="actions"><Link href="/" className="button primary">Return home</Link></div>
        </div>
      </section>
    </main>
  );
}
