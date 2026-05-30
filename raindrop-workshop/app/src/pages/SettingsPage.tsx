import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, Trash2, Cpu, Key, FlaskConical } from "lucide-react";
import { C } from "../utils/colors";
import { LocalAgentSetupCTA } from "../components/LocalAgentSetupCTA";
import { SecretInput } from "../components/SecretInput";
import { useWorkshopEvent } from "../hooks/use-workshop-ws";

type Tab = "agents" | "keys" | "debug";

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "keys",         label: "API Keys",            icon: Key },
  { id: "agents",       label: "Agent Endpoints",     icon: Cpu },
  { id: "debug",        label: "Debug",               icon: FlaskConical },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("keys");

  const sectionMap: Record<Tab, () => ReactNode> = {
    agents: () => <AgentEndpointsSection />,
    keys: () => <KeysSection />,
    debug: () => <DebugSection />,
  };

  return (
    <div className="h-full flex">
      <div className="w-48 flex-shrink-0 p-6 pr-0">
        <h1
          className="text-[22px] mb-6 pl-3"
          style={{ fontFamily: '"AlphaLyrae", sans-serif', color: C.fg4 }}
        >
          settings
        </h1>
        <nav className="flex flex-col gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150"
              style={{
                color: tab === id ? C.fg4 : C.fg0,
                background: tab === id ? "rgba(255,255,255,0.06)" : "transparent",
              }}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ opacity: tab === id ? 0.9 : 0.4 }} />
              <span className="text-[12px]">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto sb p-6 pl-8">
        <div className="max-w-xl pb-16">
          {sectionMap[tab]()}
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ id, title, description, children }: { id: Tab; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`}>
      <h2 className="text-[14px] font-medium mb-0.5" style={{ color: C.fg4 }}>{title}</h2>
      {description && <p className="text-[11px] mb-5 leading-relaxed" style={{ color: C.fg0 }}>{description}</p>}
      {!description && <div className="mb-4" />}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function AgentEndpointsSection() {
  const [agents, setAgents] = useState<Record<string, { url: string; contextFromTrace?: Record<string, string> }>>({});
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [health, setHealth] = useState<Record<string, "online" | "offline" | "checking">>({});

  const reload = useCallback(() => {
    fetch("/api/agents").then(r => r.json()).then(setAgents).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Live updates: server broadcasts `agents_updated` after any external
  // write — `/add-replay` finishing in another window,
  // a manual curl-refresh, or the PUT below. Lets the Settings list match
  // disk in real time without a 15s wait or a page reload.
  useWorkshopEvent("agents_updated", (data: { agents?: typeof agents }) => {
    if (data?.agents) setAgents(data.agents);
  });

  useEffect(() => {
    if (Object.keys(agents).length === 0) return;
    const check = () => {
      for (const name of Object.keys(agents)) setHealth(h => ({ ...h, [name]: "checking" }));
      fetch("/api/agents/health")
        .then(r => r.json())
        .then((results: Record<string, "online" | "offline">) => setHealth(results))
        .catch(() => {
          const offline: Record<string, "offline"> = {};
          for (const name of Object.keys(agents)) offline[name] = "offline";
          setHealth(offline);
        });
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [agents]);

  const save = useCallback((config: typeof agents) => {
    fetch("/api/agents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) })
      .then(() => setAgents(config))
      .catch(() => {});
  }, []);

  const addAgent = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    save({ ...agents, [newName.trim()]: { url: newUrl.trim() } });
    setNewName("");
    setNewUrl("");
  };

  const removeAgent = (name: string) => {
    const updated = { ...agents };
    delete updated[name];
    save(updated);
  };

  return (
    <SectionBlock
      id="agents"
      title="Agent Endpoints"
      description='Register local endpoints to replay agent runs with real tools. Adds "Local Agent" mode to Replay.'
    >
      <LocalAgentSetupCTA
        title="Register a new agent endpoint"
        description={
          <>
            Wire your agent into Workshop&rsquo;s Local Agent replay mode. Pick
            the path that matches your coding tool — the Claude Code option
            installs the Raindrop plugin if you don&rsquo;t have it yet.
          </>
        }
      />

      {Object.keys(agents).length > 0 && (
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          {Object.entries(agents).map(([name, config], i) => {
            const status = health[name] ?? "checking";
            return (
              <div
                key={name}
                className="flex items-center gap-3 px-3 py-2.5 group"
                style={{ borderTop: i > 0 ? `1px solid ${C.border}` : undefined }}
              >
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "online" ? "pulse-dot" : ""}`}
                  title={status === "online" ? "Online" : status === "checking" ? "Checking..." : "Offline"}
                  style={{
                    background: status === "online" ? C.green : status === "checking" ? C.fg0 : C.red,
                    opacity: status === "checking" ? 0.4 : 0.8,
                  }}
                />
                <span className="text-[12px] font-medium min-w-[80px]" style={{ color: C.fg3 }}>{name}</span>
                <span className="text-[11px] font-mono flex-1 truncate" style={{ color: C.fg0 }}>{config.url}</span>
                <span className="text-[10px] flex-shrink-0 min-w-[40px] text-right" style={{ color: status === "online" ? C.green : C.fg0 }}>
                  {status === "online" ? "online" : status === "checking" ? "..." : "offline"}
                </span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
                  onClick={() => removeAgent(name)}
                >
                  <Trash2 className="h-3 w-3" style={{ color: C.fg0 }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-1.5">
        <input
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono outline-none transition-colors focus:ring-1 focus:ring-white/20"
          style={{ background: "rgba(255,255,255,0.05)", color: C.fg3, border: `1px solid ${C.border}` }}
          placeholder="agent-name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAgent()}
        />
        <input
          className="flex-[2] min-w-0 px-2.5 py-1.5 rounded-md text-[12px] font-mono outline-none transition-colors focus:ring-1 focus:ring-white/20"
          style={{ background: "rgba(255,255,255,0.05)", color: C.fg3, border: `1px solid ${C.border}` }}
          placeholder="http://localhost:5860/replay"
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAgent()}
        />
        <button
          className="px-2.5 py-1.5 rounded-md text-[12px] transition-colors hover:bg-white/10 flex-shrink-0"
          style={{ background: "rgba(255,255,255,0.05)", color: C.fg2, border: `1px solid ${C.border}` }}
          onClick={addAgent}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </SectionBlock>
  );
}

function KeysSection() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("rd_api_key") ?? "");
  const [openaiKey, setOpenaiKey] = useState(() => localStorage.getItem("rd_openai_key") ?? "");
  const [raindropKey, setRaindropKey] = useState(() => localStorage.getItem("rd_raindrop_key") ?? "");
  const [queryKey, setQueryKey] = useState(() => localStorage.getItem("rd_query_key") ?? "");

  const persist = useCallback((key: string, val: string, setter: (v: string) => void) => {
    setter(val);
    if (val.trim()) localStorage.setItem(key, val.trim());
    else localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent("workshop:api-key-change", { detail: { key } }));
  }, []);

  return (
    <SectionBlock id="keys" title="API Keys" description="Stored in your browser's local storage. Never sent to Raindrop servers.">
      <SecretInput label="Anthropic" placeholder="sk-ant-..." description="Used for replay and Ask chat." value={apiKey} saved={!!apiKey} onChange={v => persist("rd_api_key", v, setApiKey)} getKeyUrl="https://console.anthropic.com/settings/keys" />
      <SecretInput label="OpenAI" placeholder="sk-..." description="Used for replay with GPT models." value={openaiKey} saved={!!openaiKey} onChange={v => persist("rd_openai_key", v, setOpenaiKey)} getKeyUrl="https://platform.openai.com/api-keys" />
      <SecretInput label="Raindrop" placeholder="rk_..." description="Write key for trace shipping." value={raindropKey} saved={!!raindropKey} onChange={v => persist("rd_raindrop_key", v, setRaindropKey)} getKeyUrl="https://app.raindrop.ai" />
      <SecretInput label="Query API" placeholder="your-query-api-key" description="Key for searching events in the Search tab." value={queryKey} saved={!!queryKey} onChange={v => persist("rd_query_key", v, setQueryKey)} getKeyUrl="https://auth.raindrop.ai/org/api_keys" />
    </SectionBlock>
  );
}

function DebugSection() {
  const [reset, setReset] = useState(false);

  const resetChatOnboarding = useCallback(() => {
    try {
      localStorage.removeItem("workshop:messagePane:providerIntroSeen");
    } catch {}
    window.dispatchEvent(new CustomEvent("workshop:messagePane:resetOnboarding"));
    setReset(true);
    window.setTimeout(() => setReset(false), 1400);
  }, []);

  return (
    <SectionBlock id="debug" title="Debug" description="Tools for resetting in-progress local chat UI state.">
      <div className="flex items-center justify-between gap-4 py-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="text-[12px]" style={{ color: C.fg3 }}>Claude Code chat onboarding</span>
          <span className="text-[11px] mt-0.5" style={{ color: C.fg0 }}>
            Show the local coding agent connection screen again.
          </span>
        </div>
        <button
          className="text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors hover:bg-white/10 flex-shrink-0"
          style={{
            color: reset ? C.green : C.fg2,
            background: reset ? "rgba(96,227,109,0.08)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${reset ? "rgba(96,227,109,0.15)" : C.border}`,
          }}
          onClick={resetChatOnboarding}
        >
          {reset ? "done" : "reset"}
        </button>
      </div>
    </SectionBlock>
  );
}
