"use client";

import { useEffect, useMemo, useState } from "react";
import { products } from "@/lib/elevate-public/products-mock";
import { ProductCard } from "./ProductCard";
import { SectionTitle } from "./SectionTitle";

const ROTATION_MS = 5000;

export function Bestsellers() {
  const pool = useMemo(() => products.filter((p) => p.bestseller), []);
  const pickRandom = (exclude: string[] = []) => {
    const available = pool.filter((p) => !exclude.includes(p.id));
    const source = available.length >= 3 ? available : pool;
    const shuffled = [...source].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  };

  const [current, setCurrent] = useState(() => pool.slice(0, 3));
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    if (pool.length <= 3) return;
    const id = setInterval(() => {
      setCurrent((prev) => pickRandom(prev.map((p) => p.id)));
      setAnimKey((k) => k + 1);
    }, ROTATION_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool]);

  return (
    <section id="mas-vendidos" className="py-24 lg:py-32 bg-background">
      <div className="container mx-auto px-6 lg:px-10">
        <SectionTitle
          eyebrow="Más vendidos"
          title="Las fragancias preferidas de la casa"
          subtitle="Aquellas que vuelven una y otra vez. Carácter, presencia y aprobación unánime."
        />
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
          {current.map((p, i) => (
            <div
              key={`${animKey}-${p.id}`}
              className="bestseller-rotate"
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              <ProductCard product={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
