import { Demo } from "./Demo";
import { GoogleLogo } from "../../../shared/GoogleButton";

const API = "https://keyveil-api.parithosh.workers.dev";
const DASH = "https://keyveil-dashboard.pages.dev/";
const REPO = "https://github.com/Parithosh-Varma/keyveil";

const AGENT_PROMPT = `# Secrets are here — use KeyVeil, don't ask for keys

This project keeps all API keys in KeyVeil, a blind secrets gateway. When you need
a key (OpenAI, GitHub, …), just notify the user that the secrets are here and spend
them through the proxy — never ask anyone to paste a key into chat.

- Base: $API_BASE_URL (default ${API})
- Auth: Authorization: Bearer $VEIL_AGENT_TOKEN (already in env, never print it)
- Discover first: GET /v1/tools — only use tools this user allows
- Spend blind: POST /v1/proxy/<provider>/<action> with JSON args; use the returned result only
- Never echo / cat / printenv secrets; never put secret values in chat, logs, or git
- On 401/403/429 stop and report "veil auth failed / scope denied / IP not allowlisted / rate limited" — don't retry with another key`;

export function Landing() {
  return (
    <>
      <header className="nav">
        <a className="wordmark" href="./">
          <img className="brandmark" src="/logo-mark.png" alt="KeyVeil mark" width="26" height="26" />
          <span>keyveil</span>
        </a>
        <nav>
          <a href="#platform">Platform</a>
          <a href="#agents">Agents</a>
          <a href="#cli">CLI</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQ</a>
          <a className="cta" href={DASH}>
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
              <a className="btn google" href={`${DASH}?start=login`}>
                <GoogleLogo />
                <span>Continue with Google</span>
              </a>
              <a className="btn" href="#demo">
                See one blind call
              </a>
            </div>
          </div>
        </section>

        <section className="block problem" id="problem">
          <p className="eyebrow">The problem</p>
          <h2>Your agent reads everything you give it.</h2>
          <div className="leak-grid">
            <article>
              <h3>Pasted into a chat</h3>
              <p>
                A key dropped into a chat window to "just get unblocked" now lives in someone's model logs,
                forever, searchable.
              </p>
            </article>
            <article>
              <h3>Leaked through tool calls</h3>
              <p>
                One <code>printenv</code> or <code>cat .env</code> inside an agent's tool call and the secret
                is sitting in the transcript.
              </p>
            </article>
            <article>
              <h3>Committed by a helpful agent</h3>
              <p>
                An agent that "helpfully" writes a config file commits your key to the repo — then to every
                clone, fork, and log.
              </p>
            </article>
          </div>
          <p className="answer">
            The one-line answer: <strong>the key never leaves the Worker.</strong> The agent gets a result,
            not a string.
          </p>
        </section>

        <section className="block" id="how">
          <p className="eyebrow">How it works</p>
          <h2>Three boxes. The secret crosses one boundary.</h2>
          <div className="flow" role="img" aria-label="Agent sends a scoped bearer token to the KeyVeil Worker, which decrypts the secret from KV, injects it, calls the provider, and returns only the result.">
            <div className="flow-box">
              <p className="flow-tag">1 · Agent</p>
              <code>Bearer tv_live_…</code>
              <div className="chips">
                <span>openai:chat</span>
                <span>github:create-repo</span>
              </div>
              <p className="flow-note">Scoped token. No key on disk, in env, or in chat.</p>
            </div>
            <div className="flow-arrow" aria-hidden="true">→</div>
            <div className="flow-box">
              <p className="flow-tag">2 · KeyVeil Worker</p>
              <ol>
                <li>Checks scope, expiry, IP allowlist</li>
                <li>Decrypts the secret from KV</li>
                <li>Injects it and calls the provider</li>
              </ol>
            </div>
            <div className="flow-arrow" aria-hidden="true">→</div>
            <div className="flow-box">
              <p className="flow-tag">3 · Provider</p>
              <p className="flow-note">OpenAI, GitHub…</p>
              <p className="flow-result">Agent sees: result JSON only.</p>
            </div>
          </div>
          <aside className="callout">
            <h3>Two paths, deliberately separate</h3>
            <p>
              <strong>Proxy path</strong> (agents): <code>POST /v1/proxy/&lt;provider&gt;/&lt;action&gt;</code>{" "}
              with a scoped token. Blind by construction — the raw value is never in the request or the
              response. <strong>Reveal path</strong> (your terminal only):{" "}
              <code>GET /v1/secrets/:name</code> needs the <code>secrets:reveal</code> scope, and every reveal
              is audit-logged. Never grant <code>secrets:reveal</code> to a shared agent.
            </p>
          </aside>
        </section>

        <section className="block" id="compare">
          <p className="eyebrow">Before / after</p>
          <h2>Delete the key from the agent's world.</h2>
          <div className="compare">
            <div>
              <p className="compare-label bad">Before — agent can read this</p>
              <div className="codeblock">
                <CopyButton targetId="before-snippet" />
                <pre id="before-snippet">
                  <code>
                    {`OPENAI_API_KEY=sk-proj-abc123...   # agent can read this

$ printenv | grep OPENAI   # it's in the transcript now`}
                  </code>
                </pre>
              </div>
            </div>
            <div>
              <p className="compare-label good">After — agent gets a result, not a string</p>
              <div className="codeblock">
                <CopyButton targetId="after-snippet" />
                <pre id="after-snippet">
                  <code>
                    {`curl -H "Authorization: Bearer $VEIL_AGENT_TOKEN" \\
  -d '{"model":"gpt-4o-mini","input":"summarize this"}' \\
  "${API}/v1/proxy/openai/chat"`}
                  </code>
                </pre>
              </div>
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

        <section className="block" id="cli">
          <p className="eyebrow">CLI</p>
          <h2>Script the whole lifecycle</h2>
          <div className="codeblock install">
            <CopyButton targetId="cli-install" />
            <pre id="cli-install">
              <code>{`npm i -g keyveil`}</code>
            </pre>
          </div>
          <div className="cli-steps">
            <div className="step">
              <h3>1 · Log in</h3>
              <p>Create an agent key in the dashboard, then store it (mode 600).</p>
              <div className="codeblock">
                <CopyButton targetId="cli-login" />
                <pre id="cli-login">
                  <code>
                    {`$ keyveil login --token tv_live_…
saved to ~/.keyveil/config.json (api: ${API})

$ keyveil login --status
ok as u_498975c1719ba1d6903734 via agent (key: opencode)
scopes: openai:chat, github:create-repo
api: ${API}`}
                  </code>
                </pre>
              </div>
            </div>
            <div className="step">
              <h3>2 · Store secrets</h3>
              <p>List shows masked previews and last use — never values.</p>
              <div className="codeblock">
                <CopyButton targetId="cli-secrets" />
                <pre id="cli-secrets">
                  <code>
                    {`$ keyveil secrets add OPENAI_API_KEY
Value for OPENAI_API_KEY (hidden):
stored OPENAI_API_KEY (encrypted server-side)

$ keyveil secrets list
name            preview   updated_at            last_used
GITHUB_TOKEN    ghp_…9f2c  2026-09-10T08:12Z    2026-09-16T12:31Z
OPENAI_API_KEY  sk-p…f4a2  2026-09-12T19:44Z    2026-09-16T12:33Z`}
                  </code>
                </pre>
              </div>
            </div>
            <div className="step">
              <h3>3 · Mint a scoped agent key</h3>
              <p>Scopes lock at creation — proxy-only by default, inherited when an agent mints. Token prints once.</p>
              <div className="codeblock">
                <CopyButton targetId="cli-keys" />
                <pre id="cli-keys">
                  <code>
                    {`$ keyveil keys create --name opencode --ttl 90
created key k_9f2c41ab (tv_live_9f2c41ab) scopes=openai:chat,github:create-repo
SAVE THIS TOKEN NOW — it is shown only once:
tv_live_9f2c41ab7d…`}
                  </code>
                </pre>
              </div>
            </div>
            <div className="step">
              <h3>4 · Spend blind</h3>
              <p>Server injects the secret; you only see the result.</p>
              <div className="codeblock">
                <CopyButton targetId="cli-proxy" />
                <pre id="cli-proxy">
                  <code>
                    {`$ keyveil proxy github create-repo -d '{"name":"demo","isPublic":true}'
{
  "url": "https://github.com/you/demo",
  "full_name": "you/demo",
  "private": false
}`}
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="agents">
          <p className="eyebrow">Agents</p>
          <h2>Give your agent the skill, not the secret.</h2>
          <div className="agent-prompt">
            <h3>Project prompt — paste into <code>AGENTS.md</code></h3>
            <p>
              One block that tells any coding agent the secrets are here. Copy it into your repo's agent
              instructions and agents stop asking for keys.
            </p>
            <div className="codeblock">
              <CopyButton targetId="agent-prompt" />
              <pre id="agent-prompt">
                <code>{AGENT_PROMPT}</code>
              </pre>
            </div>
          </div>
          <div className="agent-grid">
            <div>
              <h3>OpenCode</h3>
              <p>Paste this block into your session. Verbatim from <code>SKILL.md</code>.</p>
              <div className="codeblock">
                <CopyButton targetId="skill-opencode" />
                <pre id="skill-opencode">
                  <code>{SKILL_OPENCODE}</code>
                </pre>
              </div>
            </div>
            <div>
              <h3>Claude Code</h3>
              <p>Same contract, dropped into <code>CLAUDE.md</code>.</p>
              <div className="codeblock">
                <CopyButton targetId="skill-claude" />
                <pre id="skill-claude">
                  <code>{SKILL_CLAUDE}</code>
                </pre>
              </div>
            </div>
            <div>
              <h3>Cursor</h3>
              <p>Same contract as a <code>.cursorrules</code> entry.</p>
              <div className="codeblock">
                <CopyButton targetId="skill-cursor" />
                <pre id="skill-cursor">
                  <code>{SKILL_CURSOR}</code>
                </pre>
              </div>
            </div>
            <div>
              <h3>Any tool-using agent</h3>
              <p>Expose the two proxy tools as functions. Raw values are never a tool.</p>
              <div className="codeblock">
                <CopyButton targetId="skill-generic" />
                <pre id="skill-generic">
                  <code>{SKILL_GENERIC}</code>
                </pre>
              </div>
            </div>
          </div>
          <div className="agent-duo">
            <div>
              <h3>Discovery: <code>GET /v1/tools</code></h3>
              <p>
                Public to any bearer token. Agents call it first to learn exactly what this user allows —
                no guessing, no prompt archaeology.
              </p>
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Input</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>github/create-repo</code>
                    </td>
                    <td>
                      <code>{"{ name, isPublic }"}</code>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <code>openai/chat</code>
                    </td>
                    <td>
                      <code>{"{ model, input }"}</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <h3>Error contract</h3>
              <p>Agent builders: these are stable. Parse them, don't retry around them.</p>
              <table className="spec-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Meaning</th>
                    <th>Do</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <code>401</code>
                    </td>
                    <td>Missing, invalid, or expired token/grant</td>
                    <td>Stop, ask the human to re-issue</td>
                  </tr>
                  <tr>
                    <td>
                      <code>403</code>
                    </td>
                    <td>Scope denied (<code>need</code> names it) or IP not allowlisted</td>
                    <td>Stop — never try a different key</td>
                  </tr>
                  <tr>
                    <td>
                      <code>429</code>
                    </td>
                    <td>Over 60 req/min on this key (<code>Retry-After: 60</code>)</td>
                    <td>Back off, then continue</td>
                  </tr>
                  <tr>
                    <td>
                      <code>404</code>
                    </td>
                    <td>Unknown tool — response lists the tools you do have</td>
                    <td>Re-discover via <code>/v1/tools</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="block" id="providers">
          <p className="eyebrow">Providers</p>
          <h2>A short honest list.</h2>
          <div className="provider-grid">
            <article className="prov live">
              <h3>OpenAI</h3>
              <p className="prov-status">Live — chat completions</p>
              <p>
                <code>POST /v1/proxy/openai/chat</code>
              </p>
            </article>
            <article className="prov live">
              <h3>GitHub</h3>
              <p className="prov-status">Live — create repos</p>
              <p>
                <code>POST /v1/proxy/github/create-repo</code>
              </p>
            </article>
            <article className="prov planned">
              <h3>Anthropic</h3>
              <p className="prov-status">Planned</p>
              <p>Messages API through the same blind path.</p>
            </article>
            <article className="prov planned">
              <h3>Stripe</h3>
              <p className="prov-status">Planned</p>
              <p>Scoped payment intents, never the secret key.</p>
            </article>
            <a className="prov request" href={`${REPO}/issues/new`}>
              <h3>+ Request a provider →</h3>
              <p className="prov-status">We add what agents actually spend.</p>
            </a>
          </div>
        </section>

        <section className="security" id="security">
          <p className="eyebrow">Security</p>
          <h2>Enterprise controls, on from the first request</h2>
          <div className="security-grid">
            <article>
              <h3>Encryption, concretely</h3>
              <p>
                AES-256-GCM. Each account gets its own data key, wrapped by a master KEK held only as a
                Cloudflare secret (<code>ENCRYPTION_KEK</code>). KV holds ciphertext blobs (
                <code>u:&lt;user&gt;:s:&lt;NAME&gt;</code>); D1 holds names, masked hints, and audit rows —
                never plaintext.
              </p>
            </article>
            <article>
              <h3>Tokens that can't leak twice</h3>
              <p>
                Agent tokens (<code>tv_live_…</code>) print once; only a SHA-256 hash is stored. Expiry is
                mandatory thinking (default 90 days), IP allowlists are per key, and revocation lands on the
                very next request. Proxy calls are capped at 60 req/min per key.
              </p>
            </article>
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
                — values never included. Read yours any time with <code>audit:read</code>.
              </p>
            </article>
            <article>
              <h3>Limits, stated plainly</h3>
              <p>
                KeyVeil removes the secret from the agent's world — it does not remove spend: a compromised
                agent token can still use your quota within its scopes until you revoke it. Scope stored keys
                minimally at the provider too, and treat Cloudflare (which operates the infra) as in the
                trust path. Full notes: <a href={`${REPO}/blob/main/docs/SECURITY.md`}>docs/SECURITY.md</a>.
              </p>
            </article>
          </div>
        </section>

        <section className="block" id="audit">
          <p className="eyebrow">Audit</p>
          <h2>Receipts, not promises.</h2>
          <p className="lede">
            Real rows from this site's production audit log — timestamp, actor, action, result. Values are
            never recorded. See your own live in the dashboard.
          </p>
          <figure className="shot">
            <img src="/audit.png" alt="Production KeyVeil audit log rows" width="1160" height="auto" />
            <figcaption>
              Live D1 rows · <a href={DASH}>open your audit tab →</a>
            </figcaption>
          </figure>
        </section>

        <section className="block" id="faq">
          <p className="eyebrow">FAQ</p>
          <h2>Objections, answered.</h2>
          <div className="faq">
            <details open>
              <summary>Why not just use environment variables?</summary>
              <p>
                Because your agent can read them. One <code>printenv</code> in a tool call and the key is in
                the transcript, the logs, and possibly the model's training-adjacent data. KeyVeil keeps the
                key in the Worker and hands the agent a result — there is nothing in the environment worth
                stealing.
              </p>
            </details>
            <details>
              <summary>Why not Doppler, 1Password, or Vault?</summary>
              <p>
                Those are excellent at getting a secret <em>to</em> a process — which then holds it in memory,
                env, or a file your agent can also read. KeyVeil never hands the secret to the process at
                all: it injects the key server-side at call time and returns only the upstream result.
              </p>
            </details>
            <details>
              <summary>What if KeyVeil is down? Is it self-hostable?</summary>
              <p>
                Yes — loudly. It's one Worker plus D1 plus KV, no other infrastructure. Clone the repo and:
              </p>
              <div className="codeblock">
                <CopyButton targetId="selfhost-snippet" />
                <pre id="selfhost-snippet">
                  <code>
                    {`wrangler d1 create keyveil-db
wrangler kv:namespace create VEIL_KV
wrangler d1 execute keyveil-db --file=db/schema.sql --remote
wrangler secret put ENCRYPTION_KEK   # + GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET
npm run deploy:api && npm run deploy:web`}
                  </code>
                </pre>
              </div>
              <p>
                Full steps: <a href={`${REPO}/blob/main/docs/SETUP.md`}>docs/SETUP.md</a>.
              </p>
            </details>
            <details>
              <summary>Do you see my keys? What's the encryption model?</summary>
              <p>
                Values arrive over TLS, are encrypted with AES-256-GCM under your per-account data key, and
                stored as ciphertext in KV. The master KEK lives only as a Cloudflare Worker secret. D1 keeps
                names, masked previews (<code>sk-p…f4a2</code>), and audit rows — never values, never in logs.
                Honest caveat: Cloudflare operates the infrastructure, so it sits in the trust path; what
                KeyVeil guarantees is that agents, transcripts, repos, and logs never see your keys.
              </p>
            </details>
            <details>
              <summary>What does it cost?</summary>
              <p>
                Free while in beta — hosted, no card. If you outgrow that or want full custody, self-host on
                Cloudflare's free tier in about ten minutes (above). Paid tiers only arrive with SLAs and
                team features.
              </p>
            </details>
          </div>
        </section>

        <section className="block pricing" id="pricing">
          <p className="eyebrow">Pricing</p>
          <h2>Free while in beta. Self-host anytime.</h2>
          <p className="lede">
            Hosted KeyVeil costs nothing right now. When you want custody, the whole gateway is a Worker, a
            D1, and a KV you can run yourself.
          </p>
          <div className="cta-row start">
            <a className="btn primary" href={`${DASH}?start=login`}>
              Start free
            </a>
            <a className="btn" href={`${REPO}/blob/main/docs/SETUP.md`}>
              Self-host in 10 minutes
            </a>
          </div>
        </section>

        <section className="closing">
          <h2>
            Put every key
            <br />
            to work
          </h2>
          <a className="btn google" href={`${DASH}?start=login`}>
            <GoogleLogo />
            <span>Continue with Google</span>
          </a>
        </section>
      </main>

      <footer>
        <span className="foot-brand">
          <img src="/logo-mark.png" alt="KeyVeil mark" width="18" height="18" />
          KeyVeil runs on Cloudflare Pages, Workers, and D1.
        </span>
        <nav>
          <a href={DASH}>Dashboard</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </footer>
    </>
  );
}

const SKILL_OPENCODE = `You have access to a personal blind secrets gateway. Do NOT ask the user for API keys.

Base: $API_BASE_URL (default ${API})
Auth: Authorization: Bearer $VEIL_AGENT_TOKEN (already in env, never print it)

Rules:
1. Prefer blind proxy. POST /v1/proxy/<provider>/<action> with JSON args. Use the returned result only.
   - GitHub repo: POST /v1/proxy/github/create-repo {"name":"foo","isPublic":true}
   - OpenAI: POST /v1/proxy/openai/chat {"model":"gpt-4o-mini","input":"..."}
2. Discover first: GET /v1/tools lists what this user allows.
3. Never echo / cat / printenv secrets. Never put secret values in chat, logs, or git. Raw values are only available via GET /v1/secrets/:name with an explicit secrets:reveal scope (terminal use, audit-logged) — proxy calls must never request or expect them.
4. On 401/403/429 stop and say: "veil auth failed / scope denied / IP not allowlisted / rate limited" — do not retry with a different key, do not dump headers.
5. Every proxy call is audit-logged per user. Keep args minimal.
6. Terminal management (human's own terminal): the keyveil CLI (login, secrets, keys, proxy) talks to the same API with $VEIL_AGENT_TOKEN.`;

const SKILL_CLAUDE = `# KeyVeil — blind secrets gateway (paste into CLAUDE.md)

You have access to a personal blind secrets gateway. Do NOT ask the user for API keys.

- Base: $API_BASE_URL (default ${API})
- Auth: Authorization: Bearer $VEIL_AGENT_TOKEN (already in env, never print it)
- Prefer blind proxy: POST /v1/proxy/<provider>/<action> with JSON args; use the returned result only.
  - GitHub repo: POST /v1/proxy/github/create-repo {"name":"foo","isPublic":true}
  - OpenAI: POST /v1/proxy/openai/chat {"model":"gpt-4o-mini","input":"..."}
- Discover first: GET /v1/tools lists what this user allows.
- Never echo / cat / printenv secrets. Never put secret values in chat, logs, or git. Raw values need secrets:reveal scope (terminal use, audit-logged) — proxy calls must never request them.
- On 401/403/429 stop and report "veil auth failed / scope denied / IP not allowlisted / rate limited". Do not retry with a different key, do not dump headers.`;

const SKILL_CURSOR = `# .cursorrules — KeyVeil blind secrets gateway

- Never ask the user for API keys. A blind secrets gateway is available.
- Base: $API_BASE_URL (default ${API}); Auth: Bearer $VEIL_AGENT_TOKEN (env, never print).
- Use blind proxy only: POST /v1/proxy/github/create-repo {"name","isPublic"} or POST /v1/proxy/openai/chat {"model","input"}. Consume the result JSON; the secret itself is never visible.
- Discover via GET /v1/tools before assuming an action exists.
- Forbidden: echo/cat/printenv of secrets; secrets in chat, logs, git, or generated config files.
- On 401/403/429: stop, report the mapped message (auth failed / scope denied / IP not allowlisted / rate limited), do not retry with another key.`;

const SKILL_GENERIC = `// Tool definitions for any function-calling agent.
// Auth: Authorization: Bearer $VEIL_AGENT_TOKEN. Base: ${API}
{
  "tools": [
    {
      "name": "keyveil_proxy",
      "description": "Run an allowed provider action blind. The secret is injected server-side; only the result returns.",
      "input_schema": {
        "provider": "github | openai",
        "action": "create-repo | chat",
        "args": "object (e.g. {\\"name\\": \\"demo\\", \\"isPublic\\": true})"
      },
      "endpoint": "POST /v1/proxy/{provider}/{action}"
    },
    {
      "name": "keyveil_tools",
      "description": "List what this user allows. Call first.",
      "endpoint": "GET /v1/tools"
    }
  ],
  "never": ["request secret values", "echo/printenv/cat secrets", "retry 401/403 with another key"]
}`;

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
