import { About } from "@/components/elevate-public/About";

export const metadata = {
  title: "Quiénes somos · Elevate",
  description: "La historia y filosofía detrás de Elevate Maison de Parfum.",
};

export default function NosotrosPage() {
  return (
    <>
      <div className="pt-20" />
      <About />
    </>
  );
}
