import { createAuthClient } from "better-auth/react";
import { env as clientEnv } from "@/env/client";

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? window.location.origin
      : clientEnv.NEXT_PUBLIC_SERVER_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
