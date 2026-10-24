import { BrandForm } from "@/components/brand-form";
import { Flash, PageHeader } from "@/components/ui";
import { requireCtx } from "@/server/session";

export const metadata = { title: "Add brand" };

export default async function NewBrand({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireCtx();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Add brand" />
      <Flash sp={sp} />
      <BrandForm />
    </>
  );
}
