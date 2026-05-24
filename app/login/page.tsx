import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — JobRadar",
};

export default async function LoginPage() {
  // Already logged in → go home
  const session = await getSession();
  if (session) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">JobRadar</h1>
          <p className="text-sm text-gray-400 mt-1">Sign in to your dashboard</p>
        </div>

        <LoginForm />
      </div>
    </div>
  );
}
