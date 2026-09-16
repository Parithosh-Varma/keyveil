/* Landing demo: type a fake key, watch it get redacted, watch a blind call run. */
"use strict";

const screen = document.getElementById("demo-screen");
const keyInput = document.getElementById("demo-key");
const runBtn = document.getElementById("demo-run");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function barFor(key) {
  const k = key.trim() || "sk-live-••••";
  const head = esc(k.slice(0, 3));
  const bars = "████".repeat(Math.max(2, Math.min(6, Math.ceil(k.length / 4))));
  return `${head}<span class="bar">${bars}</span>`;
}

function linesFor(key) {
  return [
    { t: `$ keyveil secrets add OPENAI_API_KEY`, c: "" },
    { t: `  value taken hidden · stored encrypted`, c: "dim" },
    { t: `$ keyveil keys create --name agent --scopes openai:chat`, c: "" },
    { t: `  token tv_live_… shown once · hash stored, secret never`, c: "dim" },
    { t: `$ keyveil proxy openai chat '{"input":"summarize this"}'`, c: "" },
    { t: `  secret injected server-side for ${barFor(key)}`, c: "" },
    { t: `  ← answer returned · key never printed, logged, or sent`, c: "good" },
    { t: `$ keyveil audit`, c: "" },
    { t: `  agent chat ok · ip logged · value absent`, c: "dim" },
  ];
}

let running = false;
async function play() {
  if (running) return;
  running = true;
  runBtn.disabled = true;
  screen.innerHTML = "";
  const lines = linesFor(keyInput.value);
  for (const line of lines) {
    const div = document.createElement("div");
    if (line.c) div.className = line.c;
    screen.appendChild(div);
    if (reduceMotion) {
      div.innerHTML = line.t;
      continue;
    }
    const plain = div.textContent;
    // type plain-text progressively; render full HTML at the end
    const text = line.t.replace(/<[^>]*>/g, "");
    for (let i = 1; i <= text.length; i += 2) {
      div.textContent = text.slice(0, i);
      await new Promise((r) => setTimeout(r, 12));
    }
    div.innerHTML = line.t;
  }
  running = false;
  runBtn.disabled = false;
}

runBtn.addEventListener("click", play);
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") play();
});

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const el = document.getElementById(btn.dataset.copy);
    try {
      await navigator.clipboard.writeText(el.innerText);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Select manually";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1600);
  });
});

// Single orchestrated moment: auto-play once on load, unless reduced motion.
if (!reduceMotion) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        play();
        io.disconnect();
      }
    },
    { threshold: 0.3 }
  );
  io.observe(screen);
} else {
  screen.innerHTML = linesFor(keyInput.value)
    .map((l) => `<div class="${l.c}">${l.t}</div>`)
    .join("");
}
