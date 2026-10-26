import Link from "next/link";

const benefits = [
  {
    title: "One marketplace",
    description: "Browse the current OneSpeed catalog and discover products from marketplace sellers.",
  },
  {
    title: "Shopping that stays familiar",
    description: "Your existing account, cart, checkout, and order routes remain available during this staged migration.",
  },
  {
    title: "Seller services",
    description: "Customers can learn about applying to sell without exposing administrator access in public navigation.",
  },
];

export default function Home() {
  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="OneSpeed Marketplace home">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>ONESPEED MARKETPLACE</span>
        </Link>
        <nav className="header-links" aria-label="Main navigation">
          <a href="index.html#categories">Categories</a>
          <a className="seller-link" href="/seller.html">Sell on OneSpeed</a>
          <a className="sign-in" href="/login.html">Sign in</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-content">
            <p className="eyebrow">Discover more. Shop OneSpeed.</p>
            <h1>Find your next favorite thing.</h1>
            <p>
              Explore a curated marketplace with a smooth shopping experience,
              trusted seller services, and the OneSpeed look you know.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="index.html">Browse the marketplace</a>
              <a className="button button-secondary" href="/seller.html">Become a seller</a>
            </div>
          </div>
        </section>

        <section className="benefits" aria-label="Marketplace highlights">
          {benefits.map((benefit) => (
            <article className="benefit" key={benefit.title}>
              <h2>{benefit.title}</h2>
              <p>{benefit.description}</p>
            </article>
          ))}
        </section>

        <p className="transition-note">
          OneSpeed is migrating in stages. Existing shopping, account, checkout,
          seller, and order pages continue to use the current marketplace and Supabase browser bridge.
        </p>
      </main>

      <footer className="site-footer">
        © {new Date().getFullYear()} OneSpeed Marketplace
      </footer>
    </>
  );
}
