"use client";

import { useState, useCallback } from "react";
import { PRIMARY_TITLES, HIDDEN_TITLES, SKILL_CATEGORIES } from "@/lib/onboarding-presets";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OnboardingData {
  // Step 1 — account confirmation
  fullName: string;
  // Step 2 — job goal
  jobGoalLevels: string[];
  employmentTypes: string[];
  // Step 3 — target roles
  selectedTitles: string[];
  hiddenTitles: string[];
  customTitles: string[];
  // Step 4 — locations
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
  // Step 5 — work auth
  needsSponsorship: boolean;
  // Step 6 — skills
  selectedSkills: string[];
  niceHaveKeywords: string[];
  negativeKeywords: string[];
  // Step 7 — resume / links
  resumeUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  portfolioUrl: string;
  // Step 8 — job filters
  minScore: number;
  blockedCompanies: string[];
  excludeSeniorOnlyRoles: boolean;
  excludePrincipalStaffRoles: boolean;
  excludeSecurityClearanceRequired: boolean;
  excludeUnpaidInternships: boolean;
  excludeCommissionOnly: boolean;
  excludeDoorToDoorSales: boolean;
  excludeMedicalClinicalRoles: boolean;
  excludeNonTechPureSales: boolean;
  // Step 9 — apply strategy
  applyStrategyMode: string;
  dailyTargetApplications: number;
}

const TOTAL_STEPS = 10;

const JOB_LEVELS  = ["Entry", "Mid", "Senior", "Staff", "Principal", "Lead", "Manager"];
const EMP_TYPES   = ["Full-time", "Contract", "Part-time"];
const US_CITIES   = [
  "New York, NY", "San Francisco, CA", "Seattle, WA", "Austin, TX",
  "Chicago, IL", "Boston, MA", "Los Angeles, CA", "Denver, CO",
  "Atlanta, GA", "Miami, FL", "Washington, DC", "Philadelphia, PA",
];

// ── Shared components ────────────────────────────────────────────────────────

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle?: string }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">
        Step {step} of {TOTAL_STEPS}
      </p>
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      {subtitle && <p className="text-gray-400 mt-1 text-sm">{subtitle}</p>}
    </div>
  );
}

function ToggleChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all
        ${selected
          ? "bg-blue-600 border-blue-500 text-white"
          : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white"
        }
      `}
    >
      {label}
    </button>
  );
}

function TagInput({
  label, placeholder, tags, onChange,
}: {
  label: string; placeholder: string; tags: string[]; onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  function add() {
    const v = input.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  }
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="button"
          onClick={add}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-2.5 py-1 rounded-full">
              {tag}
              <button
                type="button"
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="text-gray-500 hover:text-red-400 transition-colors ml-0.5"
                aria-label={`Remove ${tag}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NavButtons({
  onBack, onNext, nextLabel = "Continue", nextDisabled = false, loading = false,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="flex gap-3 mt-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white text-sm font-medium transition-colors"
        >
          Back
        </button>
      )}
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled || loading}
          className="ml-auto px-8 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
        >
          {loading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {nextLabel}
        </button>
      )}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({
  initialName,
  initialEmail,
}: {
  initialName: string;
  initialEmail: string;
}) {
  const [step, setStep]       = useState(1);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [data, setData] = useState<OnboardingData>({
    fullName:      initialName,
    jobGoalLevels: ["Entry", "Mid", "Senior"],
    employmentTypes: ["Full-time"],
    selectedTitles: [],
    hiddenTitles:   [],
    customTitles:   [],
    remoteOk:  true,
    hybridOk:  true,
    onsiteOk:  true,
    targetCities: [],
    needsSponsorship: true,
    selectedSkills:   [],
    niceHaveKeywords: [],
    negativeKeywords: [],
    resumeUrl:    "",
    linkedinUrl:  "",
    githubUrl:    "",
    portfolioUrl: "",
    minScore: 40,
    blockedCompanies: [],
    excludeSeniorOnlyRoles:           true,
    excludePrincipalStaffRoles:       true,
    excludeSecurityClearanceRequired: true,
    excludeUnpaidInternships:         true,
    excludeCommissionOnly:            true,
    excludeDoorToDoorSales:           true,
    excludeMedicalClinicalRoles:      true,
    excludeNonTechPureSales:          true,
    applyStrategyMode:          "emergency",
    dailyTargetApplications:    50,
  });

  const patch = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  function toggle(key: keyof OnboardingData, item: string) {
    const arr = data[key] as string[];
    patch({ [key]: arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item] } as Partial<OnboardingData>);
  }

  async function finish() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/onboarding", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ data }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const body = await res.json() as { error?: string };
        setSaveError(body.error ?? "Failed to save preferences");
      }
    } catch {
      setSaveError("Network error — try again");
    } finally {
      setSaving(false);
    }
  }

  const progress = Math.round(((step - 1) / (TOTAL_STEPS - 1)) * 100);

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-lg font-bold text-white">JobRadar</span>
        <div className="ml-auto text-sm text-gray-400">{step} / {TOTAL_STEPS}</div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-10">
        <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {step === 1 && (
        <Step1Account
          name={data.fullName}
          email={initialEmail}
          onChange={(v) => patch({ fullName: v })}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <Step2JobGoal
          levels={data.jobGoalLevels}
          empTypes={data.employmentTypes}
          onToggleLevel={(l) => toggle("jobGoalLevels", l)}
          onToggleEmp={(e) => toggle("employmentTypes", e)}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <Step3Roles
          selectedTitles={data.selectedTitles}
          hiddenTitles={data.hiddenTitles}
          customTitles={data.customTitles}
          onToggleTitle={(t) => toggle("selectedTitles", t)}
          onToggleHidden={(t) => toggle("hiddenTitles", t)}
          onChangeCustom={(titles) => patch({ customTitles: titles })}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <Step4Locations
          remoteOk={data.remoteOk}
          hybridOk={data.hybridOk}
          onsiteOk={data.onsiteOk}
          targetCities={data.targetCities}
          onPatch={(p) => patch(p)}
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}
      {step === 5 && (
        <Step5WorkAuth
          needsSponsorship={data.needsSponsorship}
          onChange={(v) => patch({ needsSponsorship: v })}
          onNext={() => setStep(6)}
          onBack={() => setStep(4)}
        />
      )}
      {step === 6 && (
        <Step6Skills
          selectedSkills={data.selectedSkills}
          niceHave={data.niceHaveKeywords}
          negative={data.negativeKeywords}
          onToggleSkill={(s) => toggle("selectedSkills", s)}
          onChangeNice={(kws) => patch({ niceHaveKeywords: kws })}
          onChangeNeg={(kws) => patch({ negativeKeywords: kws })}
          onNext={() => setStep(7)}
          onBack={() => setStep(5)}
        />
      )}
      {step === 7 && (
        <Step7Resume
          resumeUrl={data.resumeUrl}
          linkedinUrl={data.linkedinUrl}
          githubUrl={data.githubUrl}
          portfolioUrl={data.portfolioUrl}
          onPatch={(p) => patch(p)}
          onNext={() => setStep(8)}
          onBack={() => setStep(6)}
        />
      )}
      {step === 8 && (
        <Step8Filters
          data={data}
          onPatch={(p) => patch(p)}
          onNext={() => setStep(9)}
          onBack={() => setStep(7)}
        />
      )}
      {step === 9 && (
        <Step9Strategy
          mode={data.applyStrategyMode}
          daily={data.dailyTargetApplications}
          onPatch={(p) => patch(p)}
          onNext={() => setStep(10)}
          onBack={() => setStep(8)}
        />
      )}
      {step === 10 && (
        <Step10Review
          data={data}
          saving={saving}
          saveError={saveError}
          onFinish={finish}
          onBack={() => setStep(9)}
          onJumpTo={(s) => setStep(s)}
        />
      )}
    </div>
  );
}

// ── Step 1: Account confirmation ─────────────────────────────────────────────

function Step1Account({
  name, email, onChange, onNext,
}: {
  name: string; email: string; onChange: (v: string) => void; onNext: () => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mb-6">
          <span className="text-3xl">🎯</span>
        </div>
        <h2 className="text-3xl font-bold text-white mb-3">
          Welcome{name ? `, ${name.split(" ")[0]}` : ""}!
        </h2>
        <p className="text-gray-400 text-base leading-relaxed">
          Let&apos;s set up your job search profile. It takes about 3 minutes and
          helps JobRadar surface the most relevant opportunities for you.
        </p>
      </div>

      {/* Account info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">Email (from registration)</p>
          <p className="text-sm text-gray-300 font-medium">{email || "—"}</p>
        </div>
        <div>
          <label htmlFor="onb-name" className="block text-xs text-gray-500 mb-1">
            Display name
          </label>
          <input
            id="onb-name"
            type="text"
            value={name}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Jane Smith"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {[
          { icon: "⭐", text: "Personalized job recommendations scored just for you" },
          { icon: "🚫", text: "Auto-filter irrelevant roles and companies" },
          { icon: "🔔", text: "Alerts when your ideal job lands" },
        ].map(({ icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-gray-300 text-sm">
            <span className="text-lg">{icon}</span>
            {text}
          </div>
        ))}
      </div>

      <NavButtons onNext={onNext} nextLabel="Get started →" nextDisabled={name.trim().length < 2} />
    </div>
  );
}

// ── Step 2: Job goal ─────────────────────────────────────────────────────────

function Step2JobGoal({
  levels, empTypes, onToggleLevel, onToggleEmp, onNext, onBack,
}: {
  levels: string[]; empTypes: string[];
  onToggleLevel: (l: string) => void; onToggleEmp: (e: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={2} title="What level are you targeting?" subtitle="Select all that apply." />
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-gray-400 mb-3">Seniority level</p>
          <div className="flex flex-wrap gap-2">
            {JOB_LEVELS.map((l) => (
              <ToggleChip key={l} label={l} selected={levels.includes(l)} onClick={() => onToggleLevel(l)} />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-400 mb-3">Employment type</p>
          <div className="flex flex-wrap gap-2">
            {EMP_TYPES.map((t) => (
              <ToggleChip key={t} label={t} selected={empTypes.includes(t)} onClick={() => onToggleEmp(t)} />
            ))}
          </div>
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={levels.length === 0 || empTypes.length === 0} />
    </div>
  );
}

// ── Step 3: Target roles ─────────────────────────────────────────────────────

function Step3Roles({
  selectedTitles, hiddenTitles, customTitles,
  onToggleTitle, onToggleHidden, onChangeCustom,
  onNext, onBack,
}: {
  selectedTitles: string[]; hiddenTitles: string[]; customTitles: string[];
  onToggleTitle: (t: string) => void; onToggleHidden: (t: string) => void;
  onChangeCustom: (titles: string[]) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const totalSelected = selectedTitles.length + hiddenTitles.length + customTitles.length;

  return (
    <div>
      <StepHeader step={3} title="Which roles are you targeting?" subtitle="Select all titles that match what you apply for." />

      <div className="flex flex-wrap gap-2 mb-4">
        {PRIMARY_TITLES.map((title) => (
          <ToggleChip
            key={title}
            label={title}
            selected={selectedTitles.includes(title)}
            onClick={() => onToggleTitle(title)}
          />
        ))}
      </div>

      {/* Hidden / alias titles toggle */}
      <button
        type="button"
        onClick={() => setShowHidden((v) => !v)}
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors mb-4 flex items-center gap-1.5"
      >
        <svg className={`w-4 h-4 transition-transform ${showHidden ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {showHidden ? "Hide" : "Show"} hidden / alias titles
        {hiddenTitles.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">{hiddenTitles.length}</span>
        )}
      </button>

      {showHidden && (
        <div className="flex flex-wrap gap-2 mb-4 p-4 bg-gray-900/60 rounded-xl border border-gray-800">
          <p className="w-full text-xs text-gray-500 mb-2">
            These are non-obvious job designations — useful for ATS searches. Check any you want JobRadar to also match.
          </p>
          {HIDDEN_TITLES.map((title) => (
            <ToggleChip
              key={title}
              label={title}
              selected={hiddenTitles.includes(title)}
              onClick={() => onToggleHidden(title)}
            />
          ))}
        </div>
      )}

      <div className="mb-2">
        <TagInput
          label="Custom titles (optional)"
          placeholder="e.g. Platform Architect, Tech Lead"
          tags={customTitles}
          onChange={onChangeCustom}
        />
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={totalSelected === 0} />
    </div>
  );
}

// ── Step 4: Locations ────────────────────────────────────────────────────────

function Step4Locations({
  remoteOk, hybridOk, onsiteOk, targetCities, onPatch, onNext, onBack,
}: {
  remoteOk: boolean; hybridOk: boolean; onsiteOk: boolean; targetCities: string[];
  onPatch: (p: Partial<OnboardingData>) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [cityInput, setCityInput] = useState("");
  function addCity(city: string) {
    const c = city.trim();
    if (c && !targetCities.includes(c)) onPatch({ targetCities: [...targetCities, c] });
    setCityInput("");
  }

  return (
    <div>
      <StepHeader step={4} title="Where do you want to work?" subtitle="Choose work arrangements and target cities." />
      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-gray-400 mb-3">Work arrangement</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "remoteOk",  label: "🌐 Remote",   val: remoteOk },
              { key: "hybridOk",  label: "🏢 Hybrid",   val: hybridOk },
              { key: "onsiteOk",  label: "📍 On-site",  val: onsiteOk },
            ].map(({ key, label, val }) => (
              <ToggleChip
                key={key}
                label={label}
                selected={val}
                onClick={() => onPatch({ [key]: !val } as Partial<OnboardingData>)}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-gray-400 mb-3">Specific cities (optional)</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {US_CITIES.map((city) => (
              <button
                key={city}
                type="button"
                onClick={() => {
                  if (targetCities.includes(city)) {
                    onPatch({ targetCities: targetCities.filter((c) => c !== city) });
                  } else {
                    onPatch({ targetCities: [...targetCities, city] });
                  }
                }}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  targetCities.includes(city)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white"
                }`}
              >
                {city}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={cityInput}
              onChange={(e) => setCityInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCity(cityInput); } }}
              placeholder="Add another city…"
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="button" onClick={() => addCity(cityInput)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Add</button>
          </div>
          {targetCities.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {targetCities.map((city) => (
                <span key={city} className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-2.5 py-1 rounded-full">
                  {city}
                  <button type="button" onClick={() => onPatch({ targetCities: targetCities.filter((c) => c !== city) })} className="text-gray-500 hover:text-red-400 ml-0.5">&times;</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!remoteOk && !hybridOk && !onsiteOk} />
    </div>
  );
}

// ── Step 5: Work authorization ────────────────────────────────────────────────

function Step5WorkAuth({
  needsSponsorship, onChange, onNext, onBack,
}: {
  needsSponsorship: boolean; onChange: (v: boolean) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={5} title="Work authorization" subtitle="Helps filter roles that do or do not sponsor visas." />
      <div className="space-y-3">
        {[
          { value: false, label: "No sponsorship needed", desc: "I am authorized to work without visa sponsorship (citizen, green card, etc.)" },
          { value: true,  label: "Sponsorship required",  desc: "I need visa sponsorship (H-1B, OPT, TN, etc.) to work in the US" },
        ].map(({ value, label, desc }) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => onChange(value)}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              needsSponsorship === value
                ? "bg-blue-900/40 border-blue-500"
                : "bg-gray-800/50 border-gray-700 hover:border-gray-500"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-4 h-4 rounded-full border-2 transition-all ${needsSponsorship === value ? "border-blue-400 bg-blue-400" : "border-gray-600"}`} />
              <div>
                <p className="font-medium text-white text-sm">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ── Step 6: Skills & experience ───────────────────────────────────────────────

function Step6Skills({
  selectedSkills, niceHave, negative,
  onToggleSkill, onChangeNice, onChangeNeg,
  onNext, onBack,
}: {
  selectedSkills: string[]; niceHave: string[]; negative: string[];
  onToggleSkill: (s: string) => void;
  onChangeNice: (kws: string[]) => void;
  onChangeNeg: (kws: string[]) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div>
      <StepHeader
        step={6}
        title="Skills &amp; experience"
        subtitle="Select your main skills — these become the must-have keywords for your profile."
      />

      <div className="space-y-5 mb-6">
        {SKILL_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat.label}</p>
            <div className="flex flex-wrap gap-2">
              {cat.skills.map((skill) => (
                <ToggleChip
                  key={skill}
                  label={skill}
                  selected={selectedSkills.includes(skill)}
                  onClick={() => onToggleSkill(skill)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-800 pt-5 space-y-5">
        <TagInput
          label="Also nice-to-have (boosts match score)"
          placeholder="e.g. kafka, kubernetes, redis"
          tags={niceHave}
          onChange={onChangeNice}
        />
        <TagInput
          label="Suppress / avoid (lowers score)"
          placeholder="e.g. wordpress, php, intern"
          tags={negative}
          onChange={onChangeNeg}
        />
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ── Step 7: Resume / profile links ───────────────────────────────────────────

function Step7Resume({
  resumeUrl, linkedinUrl, githubUrl, portfolioUrl,
  onPatch, onNext, onBack,
}: {
  resumeUrl: string; linkedinUrl: string; githubUrl: string; portfolioUrl: string;
  onPatch: (p: Partial<OnboardingData>) => void;
  onNext: () => void; onBack: () => void;
}) {
  const fields = [
    { key: "resumeUrl",    label: "Resume URL",         placeholder: "https://drive.google.com/file/…" },
    { key: "linkedinUrl",  label: "LinkedIn profile",   placeholder: "https://linkedin.com/in/yourname" },
    { key: "githubUrl",    label: "GitHub profile",     placeholder: "https://github.com/yourname" },
    { key: "portfolioUrl", label: "Portfolio / website", placeholder: "https://yoursite.dev" },
  ] as const;

  const values: Record<string, string> = { resumeUrl, linkedinUrl, githubUrl, portfolioUrl };

  return (
    <div>
      <StepHeader step={7} title="Resume &amp; profile links" subtitle="All fields are optional — skip any that don't apply." />
      <div className="space-y-4">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>
            <input
              type="url"
              value={values[key]}
              onChange={(e) => onPatch({ [key]: e.target.value } as Partial<OnboardingData>)}
              placeholder={placeholder}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ── Step 8: Job filters ──────────────────────────────────────────────────────

const FILTER_OPTIONS: Array<{ key: keyof OnboardingData; label: string }> = [
  { key: "excludeSeniorOnlyRoles",           label: "Exclude senior-only roles (Staff+)" },
  { key: "excludePrincipalStaffRoles",       label: "Exclude principal / staff / distinguished roles" },
  { key: "excludeSecurityClearanceRequired", label: "Exclude roles requiring security clearance" },
  { key: "excludeUnpaidInternships",         label: "Exclude unpaid internships" },
  { key: "excludeCommissionOnly",            label: "Exclude commission-only positions" },
  { key: "excludeDoorToDoorSales",           label: "Exclude door-to-door sales" },
  { key: "excludeMedicalClinicalRoles",      label: "Exclude medical / clinical roles" },
  { key: "excludeNonTechPureSales",          label: "Exclude non-tech pure sales roles" },
];

function Step8Filters({
  data, onPatch, onNext, onBack,
}: {
  data: OnboardingData;
  onPatch: (p: Partial<OnboardingData>) => void;
  onNext: () => void; onBack: () => void;
}) {
  const scoreLabel =
    data.minScore <= 35 ? "Show almost everything"
    : data.minScore <= 50 ? "Balanced filter"
    : data.minScore <= 65 ? "Strict — quality over quantity"
    : "Very strict";

  return (
    <div>
      <StepHeader step={8} title="Job filters" subtitle="Set quality thresholds and role exclusions." />

      {/* Min score slider */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">Minimum recommendation score</label>
          <span className="text-blue-400 font-semibold text-sm">{data.minScore}</span>
        </div>
        <input
          type="range"
          min={20}
          max={80}
          step={5}
          value={data.minScore}
          onChange={(e) => onPatch({ minScore: Number(e.target.value) })}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>20 — show most</span>
          <span className="text-gray-300 font-medium">{scoreLabel}</span>
          <span>80 — very strict</span>
        </div>
      </div>

      {/* Filter checkboxes */}
      <div className="space-y-3 mb-6">
        {FILTER_OPTIONS.map(({ key, label }) => {
          const checked = data[key] as boolean;
          return (
            <label key={key} className="flex items-center gap-3 cursor-pointer group">
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                  checked ? "bg-blue-600 border-blue-600" : "border-gray-600 group-hover:border-gray-400"
                }`}
                onClick={() => onPatch({ [key]: !checked } as Partial<OnboardingData>)}
              >
                {checked && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span
                className="text-sm text-gray-300 group-hover:text-white transition-colors"
                onClick={() => onPatch({ [key]: !checked } as Partial<OnboardingData>)}
              >
                {label}
              </span>
            </label>
          );
        })}
      </div>

      {/* Blocked companies */}
      <TagInput
        label="Blocked companies (never show their jobs)"
        placeholder="e.g. Acme Corp"
        tags={data.blockedCompanies}
        onChange={(companies) => onPatch({ blockedCompanies: companies })}
      />

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ── Step 9: Apply strategy ────────────────────────────────────────────────────

const STRATEGY_OPTIONS = [
  {
    id: "emergency",
    label: "🚨 Emergency mode",
    desc: "Apply to everything that qualifies. Maximize volume now.",
    daily: 50,
  },
  {
    id: "active",
    label: "⚡ Active search",
    desc: "Targeted applications — quality and quantity balanced.",
    daily: 20,
  },
  {
    id: "passive",
    label: "🎯 Passive / selective",
    desc: "Only apply to standout matches. Lower volume, higher intent.",
    daily: 5,
  },
];

function Step9Strategy({
  mode, daily, onPatch, onNext, onBack,
}: {
  mode: string; daily: number;
  onPatch: (p: Partial<OnboardingData>) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={9} title="Apply strategy" subtitle="How aggressively do you want to apply right now?" />

      <div className="space-y-3 mb-6">
        {STRATEGY_OPTIONS.map(({ id, label, desc, daily: suggestedDaily }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPatch({ applyStrategyMode: id, dailyTargetApplications: suggestedDaily })}
            className={`w-full text-left p-4 rounded-xl border transition-all ${
              mode === id
                ? "bg-blue-900/40 border-blue-500"
                : "bg-gray-800/50 border-gray-700 hover:border-gray-500"
            }`}
          >
            <p className="font-medium text-white text-sm mb-0.5">{label}</p>
            <p className="text-xs text-gray-400">{desc}</p>
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">Daily application target</label>
          <span className="text-blue-400 font-semibold text-sm">{daily} / day</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={daily}
          onChange={(e) => onPatch({ dailyTargetApplications: Number(e.target.value) })}
          className="w-full accent-blue-500"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1</span>
          <span>100</span>
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// ── Step 10: Review ──────────────────────────────────────────────────────────

function Step10Review({
  data, saving, saveError, onFinish, onBack, onJumpTo,
}: {
  data: OnboardingData;
  saving: boolean;
  saveError: string | null;
  onFinish: () => void;
  onBack: () => void;
  onJumpTo: (step: number) => void;
}) {
  const allTitles = [...data.selectedTitles, ...data.hiddenTitles, ...data.customTitles];
  const locationParts = [
    data.remoteOk && "Remote",
    data.hybridOk && "Hybrid",
    data.onsiteOk && "On-site",
  ].filter(Boolean).join(", ");

  const strategyOption = STRATEGY_OPTIONS.find((s) => s.id === data.applyStrategyMode);

  const rows: Array<{ label: string; value: string; step: number }> = [
    { label: "Name",           value: data.fullName || "—",                             step: 1 },
    { label: "Seniority",      value: data.jobGoalLevels.join(", ") || "—",             step: 2 },
    { label: "Employment",     value: data.employmentTypes.join(", ") || "—",           step: 2 },
    { label: "Roles",          value: allTitles.slice(0, 5).join(", ") + (allTitles.length > 5 ? ` +${allTitles.length - 5} more` : "") || "—", step: 3 },
    { label: "Locations",      value: [locationParts, ...data.targetCities].filter(Boolean).join(", ") || "—", step: 4 },
    { label: "Sponsorship",    value: data.needsSponsorship ? "Required" : "Not needed", step: 5 },
    { label: "Skills",         value: data.selectedSkills.slice(0, 6).join(", ") + (data.selectedSkills.length > 6 ? ` +${data.selectedSkills.length - 6} more` : "") || "None selected", step: 6 },
    { label: "Min score",      value: String(data.minScore),                             step: 8 },
    { label: "Strategy",       value: strategyOption?.label ?? data.applyStrategyMode,  step: 9 },
    { label: "Daily target",   value: `${data.dailyTargetApplications} applications`,   step: 9 },
  ];

  return (
    <div>
      <StepHeader step={10} title="Review your profile" subtitle="Everything look right? You can change these any time in Settings." />

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        {rows.map(({ label, value, step }, i) => (
          <div key={label} className={`flex items-start gap-4 px-4 py-3 ${i !== rows.length - 1 ? "border-b border-gray-800" : ""}`}>
            <span className="text-xs font-medium text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
            <span className="text-sm text-gray-200 flex-1 leading-relaxed">{value}</span>
            <button type="button" onClick={() => onJumpTo(step)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0">
              Edit
            </button>
          </div>
        ))}
      </div>

      {saveError && (
        <div className="flex items-start gap-2 bg-red-950/60 border border-red-800 rounded-lg px-3 py-2.5 mb-4">
          <p className="text-sm text-red-300">{saveError}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white text-sm font-medium transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={saving}
          className="ml-auto px-8 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving…
            </>
          ) : "Finish setup →"}
        </button>
      </div>
    </div>
  );
}
