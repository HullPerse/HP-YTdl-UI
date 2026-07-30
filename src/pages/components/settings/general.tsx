import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { Loader2, Check, AlertCircle, RefreshCw } from "lucide-react";

const LS_KEYS = {
  filenameTemplate: "filenameTemplate",
  defaultQuality: "defaultQuality",
  maxConcurrent: "maxConcurrent",
  outputDir: "outputDir",
};

function GeneralSettings() {
  const [template, setTemplate] = useState(() => localStorage.getItem(LS_KEYS.filenameTemplate) || "{artist} - {title}{misc}");
  const [quality, setQuality] = useState(() => localStorage.getItem(LS_KEYS.defaultQuality) || "720");
  const [concurrent, setConcurrent] = useState(() => parseInt(localStorage.getItem(LS_KEYS.maxConcurrent) || "2", 10));
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem(LS_KEYS.outputDir) || "");

  const [cookiesExist, setCookiesExist] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [cookieInspect, setCookieInspect] = useState<string>("");
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState<string>("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    fetch("/api/cookies").then(r => r.json()).then(d => setCookiesExist(d.exists)).catch(() => {});
    loadCookieInspect();
  }, []);

  function loadCookieInspect() {
    fetch("/api/cookies/inspect").then(r => r.json()).then(d => {
      if (d.exists) setCookieInspect(`${d.total_cookies} cookies, ${d.domains?.join(", ") || ""}`);
      else setCookieInspect("No cookies file");
    }).catch(() => setCookieInspect("Failed to load"));
  }

  async function saveCookies() {
    if (!cookieText.trim()) return;
    await fetch("/api/cookies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: cookieText }) });
    setCookiesExist(true);
    loadCookieInspect();
    setCookieText("");
  }

  async function deleteCookies() {
    await fetch("/api/cookies", { method: "DELETE" });
    setCookiesExist(false);
    setCookieInspect("No cookies file");
  }

  async function detectCookies() {
    setDetecting(true);
    setDetectResult("");
    const res = await fetch("/api/cookies/detect", { method: "POST" });
    const d = await res.json();
    setDetectResult(d.found ? `Found from ${d.source}: ${d.youtube_cookies} YouTube cookies` : d.detail);
    setDetecting(false);
    loadCookieInspect();
  }

  async function signIn() {
    setSigningIn(true);
    setDetectResult("Waiting for sign-in... Complete login in the opened browser window.");
    await fetch("/api/cookies/signin", { method: "POST" });
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const res = await fetch("/api/cookies/signin/status");
      const d = await res.json();
      if (d.done || attempts > 60) {
        clearInterval(poll);
        setSigningIn(false);
        if (d.result?.success) {
          setDetectResult("Sign-in successful!");
          loadCookieInspect();
        } else {
          setDetectResult(d.result?.error || "Timed out");
        }
      }
    }, 1000);
  }

  async function cancelSignIn() {
    await fetch("/api/cookies/signin/cancel", { method: "POST" });
    setSigningIn(false);
    setDetectResult("Sign-in cancelled");
  }

  const saveTemplate = useCallback((v: string) => { setTemplate(v); localStorage.setItem(LS_KEYS.filenameTemplate, v); }, []);
  const saveQuality = useCallback((v: string) => { setQuality(v); localStorage.setItem(LS_KEYS.defaultQuality, v); }, []);
  const saveConcurrent = useCallback((v: number) => { setConcurrent(v); localStorage.setItem(LS_KEYS.maxConcurrent, String(v)); fetch("/api/queue/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max_concurrent: v }) }).catch(() => {}); }, []);
  const saveOutputDir = useCallback((v: string) => { setOutputDir(v); localStorage.setItem(LS_KEYS.outputDir, v); }, []);

  return (
    <div className="flex flex-col gap-4">
      <Section title="Filename Template">
        <Input value={template} onChange={e => saveTemplate(e.target.value)} />
        <p className="text-muted text-xs mt-1">
          Variables: {'{artist}'} {'{title}'} {'{misc}'} {'{channel}'} {'{id}'} {'{ext}'} {'{playlist}'} {'{quality}'} {'{source_title}'}
        </p>
      </Section>

      <Section title="Default Quality">
        <select value={quality} onChange={e => saveQuality(e.target.value)} className="bg-accent text-text p-2 border border-border w-full">
          {["144", "360", "480", "720", "1080", "2160"].map(q => <option key={q} value={q}>{q}p{q === "2160" ? " (4K)" : ""}</option>)}
        </select>
      </Section>

      <Section title="Max Concurrent Downloads">
        <input type="number" min={0} max={5} value={concurrent} onChange={e => saveConcurrent(parseInt(e.target.value) || 2)} className="bg-accent text-text p-2 border border-border w-20" />
        <p className="text-muted text-xs mt-1">0 = unlimited</p>
      </Section>

      <Section title="Output Folder (optional)">
        <Input value={outputDir} onChange={e => saveOutputDir(e.target.value)} placeholder="Leave empty for default" />
      </Section>

      <Section title="Cookies">
        <div className="flex flex-row gap-2 items-center">
          <span className={cookiesExist ? "text-success" : "text-error"}>
            {cookiesExist ? <Check className="size-4 inline" /> : <AlertCircle className="size-4 inline" />}
            {cookiesExist ? " Cookies file exists" : " No cookies file"}
          </span>
          {cookiesExist && <Button variant="error" size="sm" onClick={deleteCookies}>Delete</Button>}
        </div>
        {cookieInspect && <p className="text-muted text-xs">{cookieInspect}</p>}

        <div className="flex flex-row gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={detectCookies} disabled={detecting}>
            {detecting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Detect from Browser
          </Button>
          {signingIn ? (
            <Button variant="error" size="sm" onClick={cancelSignIn}>
              <Loader2 className="size-4 animate-spin" />
              Cancel Sign-In
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={signIn}>
              Sign In to YouTube
            </Button>
          )}
        </div>
        {detectResult && <p className="text-xs mt-1 text-muted">{detectResult}</p>}

        <div className="flex flex-col gap-2 mt-2">
          <textarea
            value={cookieText}
            onChange={e => setCookieText(e.target.value)}
            placeholder="Paste cookies.txt content here..."
            className="bg-accent text-text p-2 border border-border h-20 resize-none font-mono text-xs"
          />
          <Button variant="accent" size="sm" onClick={saveCookies} disabled={!cookieText.trim()}>Save Cookies</Button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border p-3 rounded">
      <h3 className="font-bold text-sm mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default GeneralSettings;
