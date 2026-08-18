import Link from "next/link";

const features = [
  ["⚡", "Intelligent matching", "Preferences, interests, language, and safety compatibility work together before ShahZap falls back to a random compatible person."],
  ["🌎", "Talk across languages", "Your interface language and preferred chat language are separate, so translation can work without changing how you use ShahZap."],
  ["🛡️", "Privacy-first by design", "Use a pseudonymous profile, control what is visible, and block or report people whenever you need to."],
];

export default function HomePage() {
  return (
    <main className="shell">
      <nav className="nav" aria-label="Primary navigation">
        <Link href="/" className="brand"><span className="logo">⚡</span>ShahZap</Link>
        <div className="navLinks">
          <Link href="#how-it-works">How it works</Link>
          <Link href="#safety">Safety</Link>
          <Link href="#features">Features</Link>
        </div>
        <Link href="/start" className="button">Get started</Link>
      </nav>

      <section className="hero">
        <div>
          <div className="eyebrow">Meet someone new</div>
          <h1><span className="gradientText">One zap.</span><br />One new connection.</h1>
          <p className="lead">ShahZap is a privacy-first social discovery experience built around meaningful random conversations, intelligent matching, translation, and a progression system that rewards real participation.</p>
          <div className="actions">
            <Link href="/start" className="button primary">⚡ Find someone</Link>
            <Link href="#how-it-works" className="button">See how it works</Link>
          </div>
        </div>

        <aside className="matchCard" aria-label="Example ShahZap match card">
          <div className="cardTop"><span>ShahZap preview</span><span className="status"><i className="dot" /> ready</span></div>
          <div className="avatar" aria-hidden="true">🌙</div>
          <div className="cardName">Someone new</div>
          <div className="cardMeta">Matched by shared interests</div>
          <div className="pills"><span className="pill">🎮 Gaming</span><span className="pill">🎵 Music</span><span className="pill">🌎 Language</span></div>
        </aside>
      </section>

      <section className="section" id="how-it-works">
        <div className="sectionTitle"><div className="eyebrow">Simple on the surface</div><h2>The complicated work happens behind the zap.</h2><p className="lead">ShahZap keeps the experience simple while the matching system handles compatibility, exclusions, interests, language, and safe fallback.</p></div>
        <div className="features" id="features">
          {features.map(([icon, title, text]) => <article className="feature" key={title}><div className="featureIcon">{icon}</div><h3>{title}</h3><p>{text}</p></article>)}
        </div>
      </section>

      <section className="section" id="safety">
        <div className="sectionTitle"><div className="eyebrow">Built for trust</div><h2>Safety comes before matching.</h2><p className="lead">Age compatibility and safety rules are evaluated before preferences. Blocking and reporting are first-class features, and private conversations stay private from search engines.</p></div>
      </section>

      <footer className="footer">© {new Date().getFullYear()} ShahZap. Built step by step.</footer>
    </main>
  );
}
