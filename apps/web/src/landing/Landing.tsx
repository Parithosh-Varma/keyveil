import { Demo } from "./Demo";
import { GoogleLogo } from "../components/GoogleButton";

export function Landing() {
  return (
    <>
      <header className="nav">
        <a className="wordmark" href="./">
          keyveil
        </a>
        <nav>
          <a href="#platform">Platform</a>
          <a href="#security">Security</a>
          <a href="#cli">CLI</a>
          <a href="https://github.com/Parithosh-Varma/keyveil">GitHub</a>
          <a className="cta" href="./dashboard.html">
            Dashboard
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1>
            <span className="line">
              KeyVeil<span className="dot" aria-hidden="true" />
            </span>
            <span className="line">Platform</span>
          </h1>
          <div className="hero-support">
            <p className="tagline">
              Blind keys for fast agents. Store API keys encrypted, hand agents scoped tokens, and let every
              call run through a proxy that injects the secret server-side.
            </p>
            <div className="cta-row">
              <a className="btn google" href="./dashboard.html#login">
                <GoogleLogo />
                <span>Continue with Google</span>
              </a>
              <a className="btn" href="#demo">
                See one blind call
              </a>
            </div>
          </div>
        </section>

        <section className="pillars" id="platform">
          <div className="pillar">
            <p className="pillar-tag">Storage</p>
            <h2>VeilVault</h2>
            <p>
              Keys encrypted with AES-256-GCM before they touch the database, wrapped by per-account keys.
              Dashboards and APIs list names only — values are never returned by default.
            </p>
          </div>
          <div className="pillar">
            <p className="pillar-tag">Control</p>
            <h2>VeilScope</h2>
            <p>
              Agent tokens limited to named actions, IP ranges, and expiry dates. Each token is shown once;
              only its hash is stored. Revocation lands on the very next request.
            </p>
          </div>
          <div className="pillar">
            <p className="pillar-tag">Execution</p>
            <h2>VeilProxy</h2>
            <p>
              Calls arrive with a token, never a key. The gateway checks scope and identity, injects the
              secret, and returns only the result. Reading a raw value needs the separate{" "}
              <code>secrets:reveal</code> scope — and gets logged.
            </p>
          </div>
        </section>

        <section className="stats" aria-label="Platform facts">
          <ul>
            <li>
              <span>AES-256-GCM</span>
              <span>encryption at rest</span>
            </li>
            <li>
              <span>0</span>
              <span>secret characters in logs</span>
            </li>
            <li>
              <span>100%</span>
              <span>of calls audit-logged</span>
            </li>
            <li>
              <span>1</span>
              <span>request to revoke everywhere</span>
            </li>
          </ul>
        </section>

        <section className="demo-wrap" id="demo">
          <Demo />
        </section>

        <section className="security" id="security">
          <h2>Enterprise controls, on from the first request</h2>
          <div className="security-grid">
            <article>
              <h3>Least privilege by default</h3>
              <p>
                Scopes like <code>openai:chat</code> or <code>github:create-repo</code> bind each token to
                named actions. Raw-value reads live behind their own scope, granted only to keys in your
                terminal.
              </p>
            </article>
            <article>
              <h3>Identity and sessions</h3>
              <p>
                Google sign-in, opaque server-side sessions, one-click logout. Tokens carry expiries and
                optional IP allowlists; revocation is a single call.
              </p>
            </article>
            <article>
              <h3>Audit everything</h3>
              <p>
                Every store, reveal, proxy call, and revocation records who acted, what ran, and from where
                — values never included.
              </p>
            </article>
            <article>
              <h3>Your terminal, scripted</h3>
              <p>
                The same API behind the dashboard drives the <code>keyveil</code> CLI, so teams can rotate,
                scope, and revoke without leaving their workflow.
              </p>
            </article>
          </div>
        </section>

        <section className="cli" id="cli">
          <h2>Script the whole lifecycle</h2>
          <div className="codeblock">
            <CopyButton targetId="cli-snippet" />
            <pre id="cli-snippet">
              <code>
                {`npm run cli -- login --token tv_live_…
npm run cli -- secrets add STRIPE_KEY
npm run cli -- keys create --name agent --scopes github:create-repo --ttl 90
npm run cli -- proxy github create-repo -d '{"name":"my-project","isPublic":true}'`}
              </code>
            </pre>
          </div>
        </section>

        <section className="closing">
          <h2>
            Put every key
            <br />
            to work
          </h2>
          <a className="btn google" href="./dashboard.html#login">
            <GoogleLogo />
            <span>Continue with Google</span>
          </a>
        </section>
      </main>

      <footer>
        <span>KeyVeil runs on Cloudflare Pages, Workers, and D1.</span>
        <nav>
          <a href="./dashboard.html">Dashboard</a>
          <a href="https://github.com/Parithosh-Varma/keyveil">GitHub</a>
        </nav>
      </footer>
    </>
  );
}

function CopyButton({ targetId }: { targetId: string }) {
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = document.getElementById(targetId);
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(el?.innerText || "");
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select manually";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  };
  return (
    <button className="copy" type="button" onClick={(e) => void copy(e)}>
      Copy
    </button>
  );
}
