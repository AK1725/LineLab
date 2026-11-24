import type { Metadata } from "next";
import { Suspense } from "react";
import SignIn from "../../src/gallery/sign-in";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to publish robots to the gallery.",
};

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignIn />
    </Suspense>
  );
}
