import type { Metadata } from "next";
import GalleryList from "../../src/gallery/gallery-list";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Robots people built in LineLab: open one, fork it, make it yours.",
};

export default function GalleryPage() {
  return <GalleryList />;
}
