import { redirect } from "next/navigation";

// Jobs now live as a tab inside Templates (/settings/template). Keep this route
// as a redirect so any old links/bookmarks still land in the right place.
export default function JobsPage() {
  redirect("/settings/template");
}
