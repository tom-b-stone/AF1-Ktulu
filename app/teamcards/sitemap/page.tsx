import { redirect } from "next/navigation";

// moved: Figma Sync is under Team Cards now
export default function Page() {
  redirect("/teamcards/figma");
}
