import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingWizard } from "./OnboardingWizard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up your profile — JobRadar",
};

export default async function OnboardingPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Already onboarded — send home
  if ((session.onboardingCompleted ?? true) === true) {
    redirect("/");
  }

  // Fetch email for the account-confirmation step
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true },
  });

  return (
    <div className="min-h-screen bg-gray-950">
      <OnboardingWizard
        initialName={session.name ?? ""}
        initialEmail={user?.email ?? ""}
      />
    </div>
  );
}
