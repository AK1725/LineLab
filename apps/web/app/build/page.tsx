import type { Metadata } from "next";
import BuildHome from "../../src/editor/build-home";

export const metadata: Metadata = {
  title: "Build",
  description: "Assemble a line-following robot in 3D on a chassis template or your own chassis.",
};

export default function BuildPage() {
  return <BuildHome />;
}
