import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { isAllowedEmail, roleOf } from "./auth";

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
      if (!isAllowedEmail(user.email)) return false;
      return true;
    },
    async jwt({ token, account }) {
      token.role = roleOf(token.email as string | undefined);
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
      }
      return session;
    },
  },
};
