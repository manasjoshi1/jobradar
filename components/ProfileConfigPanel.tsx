"use client";

import { useEffect, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ConfigStatus = {
  user: { id: string; name: string | null; email: string | null; fullName: string | null };
  preferences: {
    configured: boolean;
    targetRoles: string[];
    targetLocations: string[];
    minScore: number;
    requiresSponsorship: boolean;
    preferredCompanies: string[];
    blockedCompanies: string[];
  };
  roleProfiles: {
    total: number;
    enabled: number;
    items: RoleProfileItem[];
  };
  sources: {
    total: number;
    enabled: number;
    items: SourceItem[];
  };
};

type RoleProfileItem = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  minScore: number;
  requiresSponsorship: boolean;
  preferredTitles: string[];
  mustHaveKeywords: string[];
  niceHaveKeywords: string[];
  negativeKeywords: string[];
  preferredLocations: string[];
};

type SourceItem = {
  id: string;
  sourceId: string;
  company: string;
  provider: string;
  boardToken: string | null;
  url: string;
  enabled: boolean;
  priority: number;
  tags: string[];
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function lines(arr: string[]): string { return arr.join("\n"); }
function fromLines(s: string): string[] { return s.split("\n").map((l) => l.trim()).filter(Boolean); }

async function downloadExport(type: string) {
  const res = await fetch(`/api/profile/config/export?type=${type}`);
  const text = await res.text();
  const blob = new Blob([text], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jobradar-config-${type}.yml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "text-blue-300/70 hover:text-white hover:bg-slate-700/60"
      }`}
    >
      {label}
    </button>
  );
}

// ── Preferences Tab ───────────────────────────────────────────────────────────

function PreferencesTab({ config, onRefresh }: { config: ConfigStatus; onRefresh: () => void }) {
  const p = config.preferences;
  const [targetRoles, setTargetRoles] = useState(lines(p.targetRoles));
  const [targetLocations, setTargetLocations] = useState(lines(p.targetLocations));
  const [preferredCompanies, setPreferredCompanies] = useState(lines(p.preferredCompanies));
  const [blockedCompanies, setBlockedCompanies] = useState(lines(p.blockedCompanies));
  const [minScore, setMinScore] = useState(p.minScore);
  const [requiresSponsorship, setRequiresSponsorship] = useState(p.requiresSponsorship);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRoles: fromLines(targetRoles),
          targetLocations: fromLines(targetLocations),
          preferredCompanies: fromLines(preferredCompanies),
          blockedCompanies: fromLines(blockedCompanies),
          minScore,
          requiresSponsorship,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg("Preferences saved.");
      onRefresh();
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "Target Roles (one per line)", value: targetRoles, onChange: setTargetRoles },
          { label: "Target Locations (one per line)", value: targetLocations, onChange: setTargetLocations },
          { label: "Preferred Companies (one per line)", value: preferredCompanies, onChange: setPreferredCompanies },
          { label: "Blocked Companies (one per line)", value: blockedCompanies, onChange: setBlockedCompanies },
        ].map(({ label, value, onChange }) => (
          <div key={label}>
            <label className="block text-xs text-blue-300/60 mb-1">{label}</label>
            <textarea
              className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg p-2 text-sm text-white placeholder-slate-500 resize-none h-28 focus:outline-none focus:border-blue-500/50"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-6">
        <div>
          <label className="block text-xs text-blue-300/60 mb-1">Min Score (0–100)</label>
          <input
            type="number"
            min={0}
            max={100}
            className="bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-1.5 text-sm text-white w-24 focus:outline-none focus:border-blue-500/50"
            value={minScore}
            onChange={(e) => setMinScore(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="sponsorship"
            checked={requiresSponsorship}
            onChange={(e) => setRequiresSponsorship(e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
          <label htmlFor="sponsorship" className="text-sm text-blue-300/80">Requires Sponsorship (OPT/H1B)</label>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? "Saving…" : "Save Preferences"}
        </button>
        {msg && <span className={`text-sm ${msg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{msg}</span>}
      </div>
    </div>
  );
}

// ── Role Profiles Tab ─────────────────────────────────────────────────────────

function RoleProfilesTab({ config, onRefresh }: { config: ConfigStatus; onRefresh: () => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<RoleProfileItem>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  async function toggleEnabled(profile: RoleProfileItem) {
    setActionMsg(null);
    try {
      const res = await fetch(`/api/profile/role-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !profile.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function saveEdit(id: string) {
    setActionMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      if ("minScore" in editData) payload.minScore = editData.minScore;
      if ("priority" in editData) payload.priority = editData.priority;
      if ("requiresSponsorship" in editData) payload.requiresSponsorship = editData.requiresSponsorship;
      if ("mustHaveKeywords" in editData) payload.mustHaveKeywords = editData.mustHaveKeywords;
      if ("niceHaveKeywords" in editData) payload.niceHaveKeywords = editData.niceHaveKeywords;
      if ("negativeKeywords" in editData) payload.negativeKeywords = editData.negativeKeywords;
      if ("preferredTitles" in editData) payload.preferredTitles = editData.preferredTitles;
      if ("preferredLocations" in editData) payload.preferredLocations = editData.preferredLocations;

      const res = await fetch(`/api/profile/role-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingId(null);
      setEditData({});
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function softDelete(id: string) {
    setActionMsg(null);
    try {
      const res = await fetch(`/api/profile/role-profiles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function addProfile() {
    if (!newName.trim()) return;
    setAdding(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/profile/role-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), enabled: true, priority: 0, minScore: 50 }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowAddForm(false);
      setNewName("");
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(p: RoleProfileItem) {
    setEditingId(p.id);
    setEditData({
      minScore: p.minScore,
      priority: p.priority,
      requiresSponsorship: p.requiresSponsorship,
      mustHaveKeywords: [...p.mustHaveKeywords],
      niceHaveKeywords: [...p.niceHaveKeywords],
      negativeKeywords: [...p.negativeKeywords],
      preferredTitles: [...p.preferredTitles],
      preferredLocations: [...p.preferredLocations],
    });
  }

  return (
    <div className="space-y-3">
      {actionMsg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${actionMsg.startsWith("Error") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
          {actionMsg}
        </p>
      )}

      {config.roleProfiles.items.map((p) => (
        <div key={p.id} className={`rounded-xl border p-4 transition-colors ${p.enabled ? "bg-slate-800/60 border-blue-500/20" : "bg-slate-900/40 border-slate-700/20 opacity-60"}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => toggleEnabled(p)}
                title={p.enabled ? "Disable" : "Enable"}
                className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 relative ${p.enabled ? "bg-emerald-500" : "bg-slate-600"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${p.enabled ? "left-5" : "left-0.5"}`} />
              </button>
              <span className="text-sm font-medium text-white truncate">{p.name}</span>
              <span className="text-xs text-blue-300/50 shrink-0">p{p.priority} · min {p.minScore}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20"
              >
                {expandedId === p.id ? "Collapse" : "Expand"}
              </button>
              {editingId !== p.id && (
                <button
                  onClick={() => startEdit(p)}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700/50 hover:bg-slate-600/50"
                >
                  Edit
                </button>
              )}
              <button
                onClick={() => softDelete(p.id)}
                className="text-xs text-red-400/70 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20"
              >
                Disable
              </button>
            </div>
          </div>

          {expandedId === p.id && editingId !== p.id && (
            <div className="mt-3 pt-3 border-t border-slate-700/40 grid grid-cols-2 gap-3 text-xs">
              {[
                { label: "Must Have", val: p.mustHaveKeywords },
                { label: "Nice to Have", val: p.niceHaveKeywords },
                { label: "Negative", val: p.negativeKeywords },
                { label: "Preferred Titles", val: p.preferredTitles },
                { label: "Preferred Locations", val: p.preferredLocations },
              ].map(({ label, val }) => (
                <div key={label} className="col-span-1">
                  <p className="text-blue-300/50 mb-1">{label}</p>
                  <div className="flex flex-wrap gap-1">
                    {val.length === 0
                      ? <span className="text-slate-600">—</span>
                      : val.slice(0, 12).map((kw) => (
                          <span key={kw} className="bg-slate-700/60 text-slate-300 px-1.5 py-0.5 rounded">{kw}</span>
                        ))}
                    {val.length > 12 && <span className="text-slate-500">+{val.length - 12}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {editingId === p.id && (
            <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-3">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-blue-300/50 mb-1">Min Score</label>
                  <input
                    type="number"
                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-white focus:outline-none"
                    value={editData.minScore ?? p.minScore}
                    onChange={(e) => setEditData((d) => ({ ...d, minScore: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="block text-blue-300/50 mb-1">Priority</label>
                  <input
                    type="number"
                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-white focus:outline-none"
                    value={editData.priority ?? p.priority}
                    onChange={(e) => setEditData((d) => ({ ...d, priority: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    checked={editData.requiresSponsorship ?? p.requiresSponsorship}
                    onChange={(e) => setEditData((d) => ({ ...d, requiresSponsorship: e.target.checked }))}
                    className="w-3.5 h-3.5 accent-blue-500"
                  />
                  <label className="text-blue-300/60">Sponsorship</label>
                </div>
              </div>

              {[
                { label: "Must Have Keywords", key: "mustHaveKeywords" as const },
                { label: "Nice to Have Keywords", key: "niceHaveKeywords" as const },
                { label: "Negative Keywords", key: "negativeKeywords" as const },
                { label: "Preferred Titles", key: "preferredTitles" as const },
                { label: "Preferred Locations", key: "preferredLocations" as const },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs text-blue-300/50 mb-1">{label} (one per line)</label>
                  <textarea
                    className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-xs text-white resize-none h-20 focus:outline-none"
                    value={lines((editData[key] as string[] | undefined) ?? p[key])}
                    onChange={(e) => setEditData((d) => ({ ...d, [key]: fromLines(e.target.value) }))}
                  />
                </div>
              ))}

              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(p.id)}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setEditingId(null); setEditData({}); }}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showAddForm ? (
        <div className="rounded-xl bg-slate-800/60 border border-blue-500/20 p-4 space-y-3">
          <p className="text-sm font-medium text-white">Add Role Profile</p>
          <input
            type="text"
            placeholder="Profile name"
            className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addProfile(); }}
          />
          <div className="flex gap-2">
            <button
              onClick={addProfile}
              disabled={adding}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setShowAddForm(false); setNewName(""); }}
              className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm px-3 py-1.5 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full rounded-xl border border-dashed border-blue-500/30 text-blue-400/70 hover:text-blue-300 hover:border-blue-500/50 py-3 text-sm transition-colors"
        >
          + Add Profile
        </button>
      )}
    </div>
  );
}

// ── Sources Tab ───────────────────────────────────────────────────────────────

function SourcesTab({ config, onRefresh }: { config: ConfigStatus; onRefresh: () => void }) {
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ company: "", provider: "GREENHOUSE", boardToken: "", url: "", enabled: true, priority: 0 });
  const [adding, setAdding] = useState(false);

  async function toggleEnabled(s: SourceItem) {
    setActionMsg(null);
    try {
      const res = await fetch(`/api/profile/sources/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function disableSource(id: string) {
    setActionMsg(null);
    try {
      const res = await fetch(`/api/profile/sources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function addSource() {
    if (!addForm.company.trim()) return;
    setAdding(true);
    setActionMsg(null);
    try {
      const body: Record<string, unknown> = {
        company: addForm.company.trim(),
        provider: addForm.provider,
        enabled: addForm.enabled,
        priority: addForm.priority,
      };
      if (addForm.boardToken.trim()) body.boardToken = addForm.boardToken.trim();
      if (addForm.url.trim()) body.url = addForm.url.trim();

      const res = await fetch("/api/profile/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowAddForm(false);
      setAddForm({ company: "", provider: "GREENHOUSE", boardToken: "", url: "", enabled: true, priority: 0 });
      onRefresh();
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  function providerBadgeColor(provider: string) {
    switch (provider) {
      case "GREENHOUSE": return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
      case "LEVER": return "bg-blue-500/10 text-blue-300 border-blue-500/20";
      case "ASHBY": return "bg-purple-500/10 text-purple-300 border-purple-500/20";
      default: return "bg-slate-500/10 text-slate-300 border-slate-500/20";
    }
  }

  return (
    <div className="space-y-3">
      {actionMsg && (
        <p className={`text-sm px-3 py-2 rounded-lg ${actionMsg.startsWith("Error") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
          {actionMsg}
        </p>
      )}

      {config.sources.items.map((s) => (
        <div key={s.id} className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${s.enabled ? "bg-slate-800/60 border-blue-500/20" : "bg-slate-900/40 border-slate-700/20 opacity-50"}`}>
          <button
            onClick={() => toggleEnabled(s)}
            className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 relative ${s.enabled ? "bg-emerald-500" : "bg-slate-600"}`}
            title={s.enabled ? "Disable" : "Enable"}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.enabled ? "left-5" : "left-0.5"}`} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white truncate">{s.company}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded border ${providerBadgeColor(s.provider)}`}>
                {s.provider}
              </span>
            </div>
            <p className="text-xs text-slate-500 truncate mt-0.5">{s.url}</p>
            {s.lastSyncStatus && (
              <p className={`text-xs mt-0.5 ${s.lastSyncStatus.startsWith("OK") ? "text-emerald-400/60" : "text-red-400/60"}`}>
                {s.lastSyncStatus.slice(0, 60)}{s.lastSyncStatus.length > 60 ? "…" : ""}
                {s.lastSyncAt && <span className="ml-1 text-slate-600">· {new Date(s.lastSyncAt).toLocaleDateString()}</span>}
              </p>
            )}
          </div>

          {s.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap shrink-0">
              {s.tags.slice(0, 3).map((t) => (
                <span key={t} className="text-xs bg-slate-700/60 text-slate-400 px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}

          <button
            onClick={() => disableSource(s.id)}
            className="text-xs text-red-400/70 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 shrink-0"
          >
            Disable
          </button>
        </div>
      ))}

      {showAddForm ? (
        <div className="rounded-xl bg-slate-800/60 border border-blue-500/20 p-4 space-y-3">
          <p className="text-sm font-medium text-white">Add Source</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-blue-300/50 mb-1">Company *</label>
              <input
                type="text"
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                value={addForm.company}
                onChange={(e) => setAddForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-blue-300/50 mb-1">Provider</label>
              <select
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                value={addForm.provider}
                onChange={(e) => setAddForm((f) => ({ ...f, provider: e.target.value }))}
              >
                {["GREENHOUSE", "LEVER", "ASHBY", "CUSTOM"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-blue-300/50 mb-1">Board Token</label>
              <input
                type="text"
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                value={addForm.boardToken}
                onChange={(e) => setAddForm((f) => ({ ...f, boardToken: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-blue-300/50 mb-1">URL (if no board token)</label>
              <input
                type="text"
                className="w-full bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
                value={addForm.url}
                onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={addForm.enabled} onChange={(e) => setAddForm((f) => ({ ...f, enabled: e.target.checked }))} className="accent-blue-500" />
              <label className="text-xs text-blue-300/60">Enabled</label>
            </div>
            <div>
              <label className="text-xs text-blue-300/50 mr-2">Priority</label>
              <input type="number" className="w-16 bg-slate-700/50 border border-slate-600/50 rounded px-2 py-1 text-xs text-white focus:outline-none" value={addForm.priority} onChange={(e) => setAddForm((f) => ({ ...f, priority: parseInt(e.target.value) || 0 }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addSource} disabled={adding} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded-lg transition-colors">
              {adding ? "Adding…" : "Add Source"}
            </button>
            <button onClick={() => setShowAddForm(false)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm px-3 py-1.5 rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAddForm(true)} className="w-full rounded-xl border border-dashed border-blue-500/30 text-blue-400/70 hover:text-blue-300 hover:border-blue-500/50 py-3 text-sm transition-colors">
          + Add Source
        </button>
      )}
    </div>
  );
}

// ── Import/Export Tab ─────────────────────────────────────────────────────────

type SourceImportResult = {
  ok: boolean;
  preview?: boolean;
  summary?: { created: number; updated: number; skipped: number; invalid: number };
  rows?: unknown[];
  errors?: Array<{ row: number; field: string; message: string }>;
  parseErrors?: string[];
  error?: string;
};

function ImportExportTab({ onRefresh }: { onRefresh: () => void }) {
  const [yamlText, setYamlText]     = useState("");
  const [importType, setImportType] = useState<"user" | "companies" | "all">("user");
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; imported?: Record<string, unknown>; errors?: string[] } | null>(null);

  // Source file upload state
  const [sourceFile, setSourceFile]           = useState<File | null>(null);
  const [sourcePreviewing, setSourcePreviewing] = useState(false);
  const [sourceSaving, setSourceSaving]         = useState(false);
  const [sourceResult, setSourceResult]         = useState<SourceImportResult | null>(null);

  async function handleImport() {
    if (!yamlText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/profile/config/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlText, type: importType }),
      });
      const data = await res.json() as { ok: boolean; imported?: Record<string, unknown>; errors?: string[] };
      setImportResult(data);
      if (data.ok) { onRefresh(); }
    } catch (e) {
      setImportResult({ ok: false, errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setImporting(false);
    }
  }

  function handleYamlFileLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setYamlText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  }

  async function uploadSourceFile(preview: boolean) {
    if (!sourceFile) return;
    if (preview) { setSourcePreviewing(true); } else { setSourceSaving(true); }
    setSourceResult(null);
    try {
      const fd = new FormData();
      fd.append("file", sourceFile);
      const url = preview ? "/api/sources/import?preview=true" : "/api/sources/import";
      const res = await fetch(url, { method: "POST", body: fd });
      const data = await res.json() as SourceImportResult;
      setSourceResult(data);
      if (!preview && data.ok) onRefresh();
    } catch (e) {
      setSourceResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (preview) { setSourcePreviewing(false); } else { setSourceSaving(false); }
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Source file upload ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-800/60 border border-blue-500/20 p-5 space-y-4">
        <div>
          <h3 className="text-white font-semibold">Upload Source List</h3>
          <p className="text-xs text-blue-300/50 mt-0.5">
            Upload a YAML or CSV file to bulk-import company job sources.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-blue-300/60">
            File (.yml / .yaml / .csv)
          </label>
          <input
            type="file"
            accept=".yml,.yaml,.csv"
            onChange={(e) => { setSourceFile(e.target.files?.[0] ?? null); setSourceResult(null); }}
            className="text-sm text-blue-300/70 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
          />
          {sourceFile && (
            <p className="text-xs text-slate-400">{sourceFile.name} · {(sourceFile.size / 1024).toFixed(1)} KB</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => uploadSourceFile(true)}
            disabled={!sourceFile || sourcePreviewing || sourceSaving}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            {sourcePreviewing ? "Previewing…" : "Preview"}
          </button>
          <button
            onClick={() => uploadSourceFile(false)}
            disabled={!sourceFile || sourcePreviewing || sourceSaving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            {sourceSaving ? "Importing…" : "Import Sources"}
          </button>
        </div>

        {sourceResult && (
          <div
            role="status"
            className={`rounded-lg p-3 text-xs space-y-2 ${sourceResult.ok ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}
          >
            {sourceResult.error && <p className="text-red-400 font-medium">{sourceResult.error}</p>}
            {sourceResult.parseErrors?.map((e, i) => <p key={i} className="text-red-300">{e}</p>)}

            {sourceResult.summary && (
              <div className="grid grid-cols-4 gap-2 text-center">
                {(["created", "updated", "skipped", "invalid"] as const).map((k) => (
                  <div key={k} className={`rounded-lg p-2 ${k === "invalid" && (sourceResult.summary?.[k] ?? 0) > 0 ? "bg-red-500/20" : "bg-slate-700/60"}`}>
                    <p className="text-lg font-bold text-white">{sourceResult.summary?.[k] ?? 0}</p>
                    <p className="text-blue-300/60 capitalize">{k}</p>
                  </div>
                ))}
              </div>
            )}

            {sourceResult.preview && sourceResult.rows && sourceResult.rows.length > 0 && (
              <div>
                <p className="text-emerald-400 font-medium mb-1">Preview — {sourceResult.rows.length} valid rows (not saved yet)</p>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {(sourceResult.rows as Array<{ company: string; provider: string; url: string | null }>).map((r, i) => (
                    <p key={i} className="text-slate-300 font-mono">{r.company} · {r.provider} · {r.url ?? "—"}</p>
                  ))}
                </div>
              </div>
            )}

            {sourceResult.errors && sourceResult.errors.length > 0 && (
              <div>
                <p className="text-amber-400 font-medium">Row errors:</p>
                {sourceResult.errors.map((e, i) => (
                  <p key={i} className="text-amber-300">Row {e.row}: [{e.field}] {e.message}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-slate-600">
          YAML format: <code className="text-slate-400">sources: [{"{"}company, provider, boardToken, enabled{"}"}]</code>
          &nbsp;·&nbsp;
          CSV columns: <code className="text-slate-400">company,provider,boardToken,url,enabled,priority,tags</code>
        </p>
      </div>

      {/* ── User config YAML import ────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-800/60 border border-blue-500/20 p-5 space-y-4">
        <h3 className="text-white font-semibold">Import Config (YAML)</h3>

        <div className="flex items-center gap-3">
          <label className="text-xs text-blue-300/60">Type:</label>
          {(["user", "companies", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setImportType(t)}
              className={`text-xs px-3 py-1 rounded-lg transition-colors ${importType === t ? "bg-blue-600 text-white" : "bg-slate-700/50 text-blue-300/60 hover:text-white"}`}
            >
              {t === "user" ? "User Profile" : t === "companies" ? "Company Sources" : "All"}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-blue-300/60 mb-1">Load from file</label>
          <input
            type="file"
            accept=".yml,.yaml"
            onChange={handleYamlFileLoad}
            className="text-sm text-blue-300/70 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
          />
        </div>

        <div>
          <label className="block text-xs text-blue-300/60 mb-1">Or paste YAML</label>
          <textarea
            className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg p-3 text-xs text-white font-mono resize-none h-40 focus:outline-none focus:border-blue-500/50"
            placeholder="Paste YAML here…"
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
          />
        </div>

        <button
          onClick={handleImport}
          disabled={importing || !yamlText.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {importing ? "Importing…" : "Import"}
        </button>

        {importResult && (
          <div
            role="status"
            className={`rounded-lg p-3 text-xs space-y-1 ${importResult.ok ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-red-500/10 border border-red-500/20"}`}
          >
            {importResult.ok && (
              <p data-testid="profile-config-import-success" className="text-emerald-400 font-medium">
                Import successful
              </p>
            )}
            {importResult.imported && (
              <pre className="text-slate-300">{JSON.stringify(importResult.imported, null, 2)}</pre>
            )}
            {importResult.errors && importResult.errors.length > 0 && (
              <div>
                <p className="text-red-400 font-medium">Errors:</p>
                {importResult.errors.map((e, i) => <p key={i} className="text-red-300">{e}</p>)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Export ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-800/60 border border-blue-500/20 p-5 space-y-4">
        <h3 className="text-white font-semibold">Export Config</h3>
        <div className="flex flex-wrap gap-3">
          {[
            { label: "Export User Profile", type: "user" },
            { label: "Export Company Sources", type: "companies" },
            { label: "Export All", type: "all" },
          ].map(({ label, type }) => (
            <button
              key={type}
              onClick={() => downloadExport(type)}
              className="bg-slate-700/60 hover:bg-slate-600/60 border border-slate-600/40 text-blue-300 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Dangerous Actions Tab ─────────────────────────────────────────────────────

type ResetMode = "prefs" | "onboarding" | "sources" | "jobs" | "workspace";

const RESET_ACTIONS: Array<{
  mode: ResetMode;
  label: string;
  desc: string;
  color: "amber" | "red";
  requiresConfirm?: boolean;
}> = [
  {
    mode: "prefs",
    label: "Reset preferences",
    desc: "Restores UserJobPreference to defaults. Keeps account, sources, and jobs.",
    color: "amber",
  },
  {
    mode: "onboarding",
    label: "Reset onboarding",
    desc: "Marks onboarding as incomplete. You will be sent back to the setup wizard on next load.",
    color: "amber",
  },
  {
    mode: "sources",
    label: "Clear my source configs",
    desc: "Removes your per-user source selections. Global sources remain; sync will fall back to all enabled sources.",
    color: "amber",
  },
  {
    mode: "jobs",
    label: "Clear job state",
    desc: "Deletes your saved/applied/seen job statuses and all recommendation history. Does not delete global jobs.",
    color: "red",
  },
  {
    mode: "workspace",
    label: "Full workspace reset",
    desc: "Resets preferences, onboarding, source configs, role profiles, and all job state. Type RESET to confirm.",
    color: "red",
    requiresConfirm: true,
  },
];

function DangerousActionsTab() {
  const [pending, setPending]   = useState<ResetMode | null>(null);
  const [confirm, setConfirm]   = useState("");
  const [result, setResult]     = useState<{ ok: boolean; reset?: string[]; error?: string } | null>(null);
  const [working, setWorking]   = useState(false);

  function startReset(mode: ResetMode) {
    setPending(mode);
    setConfirm("");
    setResult(null);
  }

  function cancel() {
    setPending(null);
    setConfirm("");
    setResult(null);
  }

  async function execReset() {
    if (!pending) return;
    setWorking(true);
    setResult(null);
    try {
      const body: Record<string, string> = { mode: pending };
      if (pending === "workspace") body.confirm = confirm;

      const res = await fetch("/api/profile/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; reset?: string[]; error?: string };
      setResult(data);
      if (data.ok) {
        setTimeout(() => {
          if (pending === "onboarding" || pending === "workspace") {
            window.location.href = "/onboarding";
          } else {
            setPending(null);
          }
        }, 1200);
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setWorking(false);
    }
  }

  const action = RESET_ACTIONS.find((a) => a.mode === pending);
  const canSubmit = pending !== "workspace" || confirm === "RESET";

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4">
        <p className="text-red-400 text-sm font-semibold mb-1">⚠ Danger Zone</p>
        <p className="text-red-300/60 text-xs">
          These actions are irreversible. Read each description carefully before proceeding.
        </p>
      </div>

      {RESET_ACTIONS.map((a) => {
        const colors = a.color === "red"
          ? "border-red-500/20 bg-red-500/5 hover:bg-red-500/10"
          : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10";
        const btnColors = a.color === "red"
          ? "bg-red-700/60 hover:bg-red-600 text-red-200"
          : "bg-amber-700/60 hover:bg-amber-600 text-amber-200";
        return (
          <div key={a.mode} className={`rounded-xl border p-4 transition-colors ${colors}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">{a.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{a.desc}</p>
              </div>
              <button
                onClick={() => startReset(a.mode)}
                className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${btnColors}`}
              >
                {a.label.split(" ")[0]}
              </button>
            </div>
          </div>
        );
      })}

      {/* Confirmation modal */}
      {pending && action && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div>
              <p className="text-lg font-bold text-white">{action.label}</p>
              <p className="text-sm text-slate-400 mt-1">{action.desc}</p>
            </div>

            {action.requiresConfirm && (
              <div>
                <label className="block text-xs text-red-400 mb-1.5">
                  Type <strong>RESET</strong> to confirm
                </label>
                <input
                  autoFocus
                  type="text"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                  placeholder="RESET"
                />
              </div>
            )}

            {result && (
              <div className={`rounded-lg px-3 py-2 text-xs ${result.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                {result.ok ? `Reset complete: ${result.reset?.join(", ")}` : result.error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={cancel}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={execReset}
                disabled={working || !canSubmit}
                className="flex-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {working ? "Resetting…" : "Confirm reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ProfileConfigPanel() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"preferences" | "roleProfiles" | "sources" | "importExport" | "danger">("preferences");

  const [refreshKey, setRefreshKey] = useState(0);
  const fetchConfig = useCallback(() => { setRefreshKey((k) => k + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/profile/config/status")
      .then((res) => res.ok ? res.json() as Promise<ConfigStatus> : Promise.reject(res.status))
      .then((data) => { if (!cancelled) setConfig(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return <p className="text-red-400 text-sm">Failed to load config.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 pb-2 border-b border-slate-700/50">
        <TabBtn label="Preferences" active={activeTab === "preferences"} onClick={() => setActiveTab("preferences")} />
        <TabBtn
          label={`Role Profiles (${config.roleProfiles.enabled}/${config.roleProfiles.total})`}
          active={activeTab === "roleProfiles"}
          onClick={() => setActiveTab("roleProfiles")}
        />
        <TabBtn
          label={`Sources (${config.sources.enabled}/${config.sources.total})`}
          active={activeTab === "sources"}
          onClick={() => setActiveTab("sources")}
        />
        <TabBtn label="Import / Export" active={activeTab === "importExport"} onClick={() => setActiveTab("importExport")} />
        <TabBtn label="⚠ Reset" active={activeTab === "danger"} onClick={() => setActiveTab("danger")} />
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "preferences" && <PreferencesTab config={config} onRefresh={fetchConfig} />}
        {activeTab === "roleProfiles" && <RoleProfilesTab config={config} onRefresh={fetchConfig} />}
        {activeTab === "sources" && <SourcesTab config={config} onRefresh={fetchConfig} />}
        {activeTab === "importExport" && <ImportExportTab onRefresh={fetchConfig} />}
        {activeTab === "danger" && <DangerousActionsTab />}
      </div>
    </div>
  );
}
