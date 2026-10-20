import { redirect } from "next/navigation";

// moved: the Figma sync is its own tool now (open to everyone)
export default function Page() {
  redirect("/figma");
}
