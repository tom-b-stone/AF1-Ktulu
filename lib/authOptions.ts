import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { accessFor, isAllowedEmail } from "./auth";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      // Same domain gate as UTM Studio (slash.digital), narrowed further to
      // the admin allowlist until ALLOW_ALL_SLASH_DIGITAL is turned on.
      if (!(await isAllowedEmail(user.email))) return false;
      return true;
    },
    async jwt({ token, account }) {
      // role and tool rights from the access board, re-read at most once a minute
      const now = Math.floor(Date.now() / 1000);
      if (account || !token.accessAt || now - (token.accessAt as number) > 60) {
        const a = await accessFor(token.email as string | undefined).catch(() => null);
        if (a) {
          token.role = a.role;
          token.tools = a.tools;
          token.accessAt = now;
        }
      }
      // Google Drive read access, only for users who connected it (GP Mini-Zine:
      // photos straight from SlashLens/Drive). Stays server-side in the JWT.
      if (account?.provider === "google" && account.scope?.includes("drive.readonly")) {
        token.gAccess = account.access_token;
        token.gExp = account.expires_at;
        if (account.refresh_token) token.gRefresh = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { tools?: string[] | null }).tools = (token.tools as string[] | null | undefined) ?? null;
      }
      return session;
    },
  },
};
