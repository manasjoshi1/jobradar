"use client";

import { useState, useCallback } from "react";
import { ROLE_PRESETS } from "@/lib/onboarding-presets";

// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingData {
  fullName: string;
  jobGoalLevels: string[];
  employmentTypes: string[];
  selectedPresets: string[];
  customTitles: string[];
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
  needsSponsorship: boolean;
  mustHaveKeywords: string[];
  niceHaveKeywords: string[];
  negativeKeywords: string[];
  minScore: number;
  blockedCompanies: string[];
}

const TOTAL_STEPS = 10;

const JOB_LEVELS = ["Entry", "Mid", "Senior", "Staff", "Principal", "Lead", "Manager"];
const EMP_TYPES  = ["Full-time", "Contract", "Part-time"];
const US_CITIES  = [
  "New York, NY", "San Francisco, CA", "Seattle, WA", "Austin, TX",
  "Chicago, IL", "Boston, MA", "Los Angeles, CA", "Denver, CO",
  "Atlanta, GA", "Miami, FL", "Washington, DC", "Philadelphia, PA",
];

// ── Sub-components ───────────────────────────────────────────────────────────

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

function ToggleChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
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
  label,
  placeholder,
  tags,
  onChange,
}: {
  label: string;
  placeholder: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput("");
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          }}
          placeholder={placeholder}
          className="
            flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
            text-white placeholder-gray-500 text-sm
            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          "
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
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs px-2.5 py-1 rounded-full"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                className="text-gray-500 hover:text-red-400 transition-colors ml-0.5"
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────

export function OnboardingWizard({ initialName }: { initialName: string }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [data, setData] = useState<OnboardingData>({
    fullName:          initialName,
    jobGoalLevels:     ["Senior"],
    employmentTypes:   ["Full-time"],
    selectedPresets:   [],
    customTitles:      [],
    remoteOk:          true,
    hybridOk:          true,
    onsiteOk:          false,
    targetCities:      [],
    needsSponsorship:  false,
    mustHaveKeywords:  [],
    niceHaveKeywords:  [],
    negativeKeywords:  [],
    minScore:          45,
    blockedCompanies:  [],
  });

  const patch = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  function toggleItem<K extends keyof OnboardingData>(
    key: K,
    item: string,
  ) {
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
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </div>
        <span className="text-lg font-bold text-white">JobRadar</span>
        <div className="ml-auto text-sm text-gray-400">{step} / {TOTAL_STEPS}</div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-10">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      {step === 1 && <Step1Welcome name={data.fullName} onNext={() => setStep(2)} />}

      {step === 2 && (
        <Step2Name
          value={data.fullName}
          onChange={(v) => patch({ fullName: v })}
          onNext={() => setStep(3)}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && (
        <Step3JobGoal
          levels={data.jobGoalLevels}
          empTypes={data.employmentTypes}
          onToggleLevel={(l) => toggleItem("jobGoalLevels", l)}
          onToggleEmp={(e) => toggleItem("employmentTypes", e)}
          onNext={() => setStep(4)}
          onBack={() => setStep(2)}
        />
      )}

      {step === 4 && (
        <Step4Roles
          selectedPresets={data.selectedPresets}
          customTitles={data.customTitles}
          onTogglePreset={(id) => toggleItem("selectedPresets", id)}
          onChangeCustom={(titles) => patch({ customTitles: titles })}
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}

      {step === 5 && (
        <Step5Locations
          remoteOk={data.remoteOk}
          hybridOk={data.hybridOk}
          onsiteOk={data.onsiteOk}
          targetCities={data.targetCities}
          onPatch={(p) => patch(p)}
          onNext={() => setStep(6)}
          onBack={() => setStep(4)}
        />
      )}

      {step === 6 && (
        <Step6WorkAuth
          needsSponsorship={data.needsSponsorship}
          onChange={(v) => patch({ needsSponsorship: v })}
          onNext={() => setStep(7)}
          onBack={() => setStep(5)}
        />
      )}

      {step === 7 && (
        <Step7MustHave
          keywords={data.mustHaveKeywords}
          onChange={(kws) => patch({ mustHaveKeywords: kws })}
          onNext={() => setStep(8)}
          onBack={() => setStep(6)}
        />
      )}

      {step === 8 && (
        <Step8Keywords
          niceHave={data.niceHaveKeywords}
          negative={data.negativeKeywords}
          onChangeNice={(kws) => patch({ niceHaveKeywords: kws })}
          onChangeNeg={(kws) => patch({ negativeKeywords: kws })}
          onNext={() => setStep(9)}
          onBack={() => setStep(7)}
        />
      )}

      {step === 9 && (
        <Step9Score
          minScore={data.minScore}
          blockedCompanies={data.blockedCompanies}
          onChange={(score) => patch({ minScore: score })}
          onChangeBlocked={(companies) => patch({ blockedCompanies: companies })}
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

// ── Step components ──────────────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  loading = false,
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
          className="
            ml-auto px-8 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500
            disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed
            text-white text-sm font-medium transition-colors flex items-center gap-2
          "
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

// Step 1: Welcome
function Step1Welcome({ name, onNext }: { name: string; onNext: () => void }) {
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
          Let&apos;s set up your job search profile. It takes about 3 minutes and helps JobRadar surface
          the most relevant opportunities for you — and filter out everything that doesn&apos;t fit.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {[
          { icon: "⭐", text: "Personalized job recommendations scored just for you" },
          { icon: "🚫", text: "Auto-filter out irrelevant roles and companies" },
          { icon: "🔔", text: "Get notified when your ideal job lands" },
        ].map(({ icon, text }) => (
          <div key={text} className="flex items-center gap-3 text-gray-300 text-sm">
            <span className="text-lg">{icon}</span>
            {text}
          </div>
        ))}
      </div>

      <NavButtons onNext={onNext} nextLabel="Get started →" />
    </div>
  );
}

// Step 2: Your name
function Step2Name({
  value, onChange, onNext, onBack,
}: {
  value: string; onChange: (v: string) => void; onNext: () => void; onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={2} title="What's your name?" subtitle="Used to personalise your dashboard." />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Jane Smith"
        autoFocus
        className="
          w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3
          text-white placeholder-gray-500 text-base
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
        "
      />
      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={value.trim().length < 2} />
    </div>
  );
}

// Step 3: Job goal
function Step3JobGoal({
  levels, empTypes, onToggleLevel, onToggleEmp, onNext, onBack,
}: {
  levels: string[];
  empTypes: string[];
  onToggleLevel: (l: string) => void;
  onToggleEmp: (e: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={3} title="What level are you targeting?" subtitle="Select all that apply." />

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

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={levels.length === 0 || empTypes.length === 0}
      />
    </div>
  );
}

// Step 4: Target roles
function Step4Roles({
  selectedPresets, customTitles, onTogglePreset, onChangeCustom, onNext, onBack,
}: {
  selectedPresets: string[];
  customTitles: string[];
  onTogglePreset: (id: string) => void;
  onChangeCustom: (titles: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={4} title="What kind of roles are you after?" subtitle="Pick all presets that fit — or describe your own." />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {ROLE_PRESETS.map((preset) => {
          const selected = selectedPresets.includes(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onTogglePreset(preset.id)}
              className={`
                text-left p-4 rounded-xl border transition-all
                ${selected
                  ? "bg-blue-900/40 border-blue-500 text-white"
                  : "bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-800"
                }
              `}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">{preset.emoji}</span>
                <span className="font-medium text-sm">{preset.label}</span>
                {selected && (
                  <span className="ml-auto text-blue-400">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {preset.mustHave.join(", ")}
              </p>
            </button>
          );
        })}
      </div>

      <TagInput
        label="Additional job titles (optional)"
        placeholder="e.g. Platform Architect, Tech Lead"
        tags={customTitles}
        onChange={onChangeCustom}
      />

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={selectedPresets.length === 0 && customTitles.length === 0}
      />
    </div>
  );
}

// Step 5: Locations
function Step5Locations({
  remoteOk, hybridOk, onsiteOk, targetCities, onPatch, onNext, onBack,
}: {
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
  onPatch: (p: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [cityInput, setCityInput] = useState("");

  function addCity(city: string) {
    const c = city.trim();
    if (c && !targetCities.includes(c)) {
      onPatch({ targetCities: [...targetCities, c] });
    }
    setCityInput("");
  }

  const anyLocationSelected = remoteOk || hybridOk || onsiteOk;

  return (
    <div>
      <StepHeader step={5} title="Where do you want to work?" subtitle="Choose work arrangements and locations." />

      <div className="space-y-6">
        <div>
          <p className="text-sm font-medium text-gray-400 mb-3">Work arrangement</p>
          <div className="flex flex-wrap gap-2">
            {[
              { key: "remoteOk", label: "🌐 Remote" },
              { key: "hybridOk", label: "🏢 Hybrid" },
              { key: "onsiteOk", label: "📍 On-site" },
            ].map(({ key, label }) => (
              <ToggleChip
                key={key}
                label={label}
                selected={key === "remoteOk" ? remoteOk : key === "hybridOk" ? hybridOk : onsiteOk}
                onClick={() => onPatch({ [key]: !(key === "remoteOk" ? remoteOk : key === "hybridOk" ? hybridOk : onsiteOk) } as Partial<OnboardingData>)}
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
                className={`
                  text-xs px-3 py-1.5 rounded-full border transition-all
                  ${targetCities.includes(city)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white"
                  }
                `}
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
              className="
                flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                text-white placeholder-gray-500 text-sm
                focus:outline-none focus:ring-2 focus:ring-blue-500
              "
            />
            <button
              type="button"
              onClick={() => addCity(cityInput)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!anyLocationSelected} />
    </div>
  );
}

// Step 6: Work auth
function Step6WorkAuth({
  needsSponsorship, onChange, onNext, onBack,
}: {
  needsSponsorship: boolean;
  onChange: (v: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={6} title="Work authorization" subtitle="This helps filter roles that require sponsorship." />

      <div className="space-y-3">
        {[
          {
            value: false,
            label: "No sponsorship needed",
            desc: "I am authorized to work without a visa sponsorship (citizen, GC, etc.)",
          },
          {
            value: true,
            label: "Sponsorship required",
            desc: "I need visa sponsorship (H-1B, OPT, TN, etc.) to work in the US",
          },
        ].map(({ value, label, desc }) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => onChange(value)}
            className={`
              w-full text-left p-4 rounded-xl border transition-all
              ${needsSponsorship === value
                ? "bg-blue-900/40 border-blue-500"
                : "bg-gray-800/50 border-gray-700 hover:border-gray-500"
              }
            `}
          >
            <div className="flex items-center gap-3">
              <div className={`
                w-4 h-4 rounded-full border-2 transition-all
                ${needsSponsorship === value
                  ? "border-blue-400 bg-blue-400"
                  : "border-gray-600"
                }
              `} />
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

// Step 7: Must-have keywords
function Step7MustHave({
  keywords, onChange, onNext, onBack,
}: {
  keywords: string[];
  onChange: (kws: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader
        step={7}
        title="Must-have skills"
        subtitle="Keywords that MUST appear in a job listing for it to be recommended. Leave blank if you rely on your role presets."
      />

      <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-4 mb-4 text-xs text-gray-400">
        <strong className="text-gray-300">Tip:</strong> If you selected role presets in step 4,
        they already include must-have keywords (e.g. &quot;java&quot;, &quot;react&quot;). Only add extras here if
        you have additional hard requirements.
      </div>

      <TagInput
        label="Must-have keywords"
        placeholder="Type a keyword and press Enter"
        tags={keywords}
        onChange={onChange}
      />

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 8: Nice-to-have + avoid
function Step8Keywords({
  niceHave, negative, onChangeNice, onChangeNeg, onNext, onBack,
}: {
  niceHave: string[];
  negative: string[];
  onChangeNice: (kws: string[]) => void;
  onChangeNeg: (kws: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <StepHeader step={8} title="Fine-tune your matches" subtitle="Boost scores for desired tech, suppress anything you want to avoid." />

      <div className="space-y-6">
        <TagInput
          label="Nice-to-have (boost score)"
          placeholder="e.g. aws, kafka, kubernetes"
          tags={niceHave}
          onChange={onChangeNice}
        />

        <TagInput
          label="Avoid / negative keywords (suppress jobs)"
          placeholder="e.g. wordpress, php, intern"
          tags={negative}
          onChange={onChangeNeg}
        />
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 9: Score + blocked companies
function Step9Score({
  minScore, blockedCompanies, onChange, onChangeBlocked, onNext, onBack,
}: {
  minScore: number;
  blockedCompanies: string[];
  onChange: (score: number) => void;
  onChangeBlocked: (companies: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const scoreLabel = minScore <= 35 ? "Show almost everything"
    : minScore <= 50 ? "Balanced filter"
    : minScore <= 65 ? "Strict — quality over quantity"
    : "Very strict";

  return (
    <div>
      <StepHeader step={9} title="Quality filter" subtitle="Set how selective the recommendations should be." />

      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-300">Minimum recommendation score</label>
            <span className="text-blue-400 font-semibold text-sm">{minScore}</span>
          </div>
          <input
            type="range"
            min={20}
            max={80}
            step={5}
            value={minScore}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>20 — show most</span>
            <span className="text-gray-300 font-medium">{scoreLabel}</span>
            <span>80 — very strict</span>
          </div>
        </div>

        <TagInput
          label="Blocked companies (never show their jobs)"
          placeholder="e.g. Acme Corp"
          tags={blockedCompanies}
          onChange={onChangeBlocked}
        />
      </div>

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  );
}

// Step 10: Review + finish
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
  const selectedPresetLabels = data.selectedPresets
    .map((id) => ROLE_PRESETS.find((p) => p.id === id)?.label)
    .filter(Boolean)
    .join(", ");

  const locationParts = [
    data.remoteOk && "Remote",
    data.hybridOk && "Hybrid",
    data.onsiteOk && "On-site",
  ].filter(Boolean).join(", ");

  const rows: Array<{ label: string; value: string; step: number }> = [
    { label: "Name", value: data.fullName || "—", step: 2 },
    {
      label: "Seniority",
      value: data.jobGoalLevels.join(", ") || "—",
      step: 3,
    },
    {
      label: "Employment",
      value: data.employmentTypes.join(", ") || "—",
      step: 3,
    },
    {
      label: "Role presets",
      value: selectedPresetLabels || (data.customTitles.join(", ") || "—"),
      step: 4,
    },
    {
      label: "Locations",
      value: [locationParts, ...data.targetCities].filter(Boolean).join(", ") || "—",
      step: 5,
    },
    {
      label: "Sponsorship",
      value: data.needsSponsorship ? "Needed" : "Not needed",
      step: 6,
    },
    {
      label: "Must-have",
      value: data.mustHaveKeywords.join(", ") || "From presets",
      step: 7,
    },
    {
      label: "Nice-to-have",
      value: data.niceHaveKeywords.join(", ") || "From presets",
      step: 8,
    },
    {
      label: "Avoid",
      value: data.negativeKeywords.join(", ") || "From presets",
      step: 8,
    },
    {
      label: "Min score",
      value: String(data.minScore),
      step: 9,
    },
    {
      label: "Blocked companies",
      value: data.blockedCompanies.join(", ") || "None",
      step: 9,
    },
  ];

  return (
    <div>
      <StepHeader step={10} title="Review your profile" subtitle="Everything look right? You can change these any time in settings." />

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
        {rows.map(({ label, value, step }, i) => (
          <div
            key={label}
            className={`flex items-start gap-4 px-4 py-3 ${i !== rows.length - 1 ? "border-b border-gray-800" : ""}`}
          >
            <span className="text-xs font-medium text-gray-500 w-32 shrink-0 pt-0.5">{label}</span>
            <span className="text-sm text-gray-200 flex-1 leading-relaxed">{value}</span>
            <button
              type="button"
              onClick={() => onJumpTo(step)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0"
            >
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
          className="
            ml-auto px-8 py-2.5 rounded-lg bg-green-600 hover:bg-green-500
            disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed
            text-white text-sm font-semibold transition-colors flex items-center gap-2
          "
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
