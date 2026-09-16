import { useEffect, useRef, useState } from "react";

interface Seg {
  text: string;
  cls?: string;
  bar?: boolean;
}
interface DemoLine {
  segs: Seg[];
  cls?: string;
}

function barFor(key: string): Seg[] {
  const k = key.trim() || "sk-live-••••";
  const bars = "████".repeat(Math.max(2, Math.min(6, Math.ceil(k.length / 4))));
  return [{ text: k.slice(0, 3) }, { text: bars, bar: true }];
}

function linesFor(key: string): DemoLine[] {
  return [
    { segs: [{ text: "$ keyveil secrets add OPENAI_API_KEY" }] },
    { segs: [{ text: "  value taken hidden · stored encrypted", cls: "dim" }] },
    { segs: [{ text: "$ keyveil keys create --name agent --scopes openai:chat" }] },
    { segs: [{ text: "  token tv_live_… shown once · hash stored, secret never", cls: "dim" }] },
    { segs: [{ text: `$ keyveil proxy openai chat '{"input":"summarize this"}'` }] },
    { segs: [{ text: "  secret injected server-side for " }, ...barFor(key)] },
    { segs: [{ text: "  ← answer returned · key never printed, logged, or sent", cls: "good" }] },
    { segs: [{ text: "$ keyveil audit" }] },
    { segs: [{ text: "  agent chat ok · ip logged · value absent", cls: "dim" }] },
  ];
}

function plainText(line: DemoLine): string {
  return line.segs.map((s) => (s.bar ? "████████" : s.text)).join("");
}

export function Demo() {
  const [key, setKey] = useState("sk-live-9f2KqZx7");
  const [lines, setLines] = useState<DemoLine[]>([]);
  const [running, setRunning] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const autoPlayed = useRef(false);

  async function play() {
    if (running) return;
    setRunning(true);
    const acc: DemoLine[] = [];
    const push = () => setLines([...acc]);
    push();
    const script = linesFor(keyInputRef.current);
    for (const line of script) {
      if (reduceMotion.current) {
        acc.push(line);
        push();
        continue;
      }
      const full = plainText(line);
      acc.push({ segs: [{ text: "" }] });
      const at = acc.length - 1;
      for (let i = 2; i <= full.length; i += 2) {
        acc[at] = { segs: [{ text: full.slice(0, i) }] };
        push();
        await new Promise((r) => setTimeout(r, 12));
      }
      acc[at] = line;
      push();
    }
    setRunning(false);
  }

  const keyInputRef = useRef(key);
  keyInputRef.current = key;

  useEffect(() => {
    if (reduceMotion.current || autoPlayed.current || !screenRef.current) return;
    autoPlayed.current = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void play();
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(screenRef.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="demo" aria-label="Simulated demonstration">
      <p className="demo-label">One blind call, simulated in your browser. Nothing leaves this page.</p>
      <div className="demo-keyrow">
        <input
          id="demo-key"
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void play();
          }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Example key to redact"
        />
        <button id="demo-run" type="button" onClick={() => void play()} disabled={running}>
          Run blind call
        </button>
      </div>
      <div id="demo-screen" className="demo-screen" aria-live="polite" ref={screenRef}>
        {lines.map((line, i) => (
          <div key={i} className={line.cls}>
            {line.segs.map((s, j) => (
              <span key={j} className={[s.cls, s.bar ? "bar" : ""].filter(Boolean).join(" ") || undefined}>
                {s.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
