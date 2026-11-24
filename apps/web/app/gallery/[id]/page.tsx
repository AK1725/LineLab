import type { Metadata } from "next";
import GalleryView from "../../../src/gallery/gallery-view";

export const metadata: Metadata = {
  title: "Robot",
  description: "A robot from the LineLab gallery.",
};

export default async function GalleryItemPage({ params }: { params: Promise<{ id: string }> }) {
  return <GalleryView id={(await params).id} />;
}
