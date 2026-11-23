import type { Metadata } from "next";
import ImportTrack from "../../../src/tracks/import-track";

export const metadata: Metadata = { title: "Import track" };

export default function ImportPage() {
  return <ImportTrack />;
}
