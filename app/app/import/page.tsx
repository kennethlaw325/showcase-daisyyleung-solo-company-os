import { redirect } from "next/navigation";

/**
 * Compatibility entry point for bookmarks and older links.
 * Guided intake now lives alongside manual entry on the New case page.
 */
export default function ImportPage() {
  redirect("/app/new?mode=guided");
}
