import Image from "next/image";

export function FoodPhoto({ name, source, hero = false }: { name: string; source: string; hero?: boolean }) {
  const file = source === "demo" ? ({ "样例鸡肉主食": "chicken", "样例牛肉主食": "beef" } as Record<string, string>)[name] : undefined;
  if (!file) return null;
  return <figure className={hero ? "food-photo hero-photo" : "food-photo"}>
    <Image src={`/images/demo-${file}.png`} width={1024} height={1024} preload={hero} sizes={hero ? "(max-width: 640px) 220px, 360px" : "(max-width: 640px) 88px, 120px"} alt={`${name}的 AI 示意图，非实物照片`} />
    <figcaption><span>AI 示意</span> · <span>非实物照片</span></figcaption>
  </figure>;
}
