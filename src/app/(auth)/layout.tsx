import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { auth } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Tecknode
          </Link>
          <p className="text-sm text-muted-foreground">
            Marketing intelligence for search, AI, and mentions
          </p>
        </div>

        <div className="flex w-full flex-col items-center">{children}</div>
      </div>
      <Toaster richColors position="top-center" />
    </div>
  );
}
