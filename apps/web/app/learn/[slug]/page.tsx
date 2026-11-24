import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LessonView from "../../../src/learn/lesson-view";
import { LESSONS } from "../../../src/learn/lessons";

export function generateStaticParams() {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const l = LESSONS.find((x) => x.slug === slug);
  return l ? { title: l.title, description: l.summary } : {};
}

export default async function LessonPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  if (!LESSONS.some((l) => l.slug === slug)) notFound();
  return <LessonView slug={slug} />;
}
