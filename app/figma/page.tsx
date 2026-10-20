import { redirect } from "next/navigation";

// Figma Sync lives in Team Cards
export default function Page() {
  redirect("/teamcards/figma");
}
