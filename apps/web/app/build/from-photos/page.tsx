import type { Metadata } from "next";
import PhotoWizard from "../../../src/photos/photo-wizard";

export const metadata: Metadata = {
  title: "Robot from photos",
  description: "Start a LineLab design from photos of your real robot.",
};

export default function FromPhotosPage() {
  return <PhotoWizard />;
}
