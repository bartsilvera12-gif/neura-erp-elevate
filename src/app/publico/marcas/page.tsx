import { Brands } from "@/components/elevate-public/Brands";

export const metadata = {
  title: "Marcas · Elevate",
  description: "Maisons que elegimos: nicho, ultranicho, diseñador y árabe premium.",
};

export default function MarcasPage() {
  return (
    <>
      <div className="pt-20" />
      <Brands />
    </>
  );
}
