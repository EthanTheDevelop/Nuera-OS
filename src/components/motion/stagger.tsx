import { Children, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type BuildLayer = "frame" | "header" | "content" | "data";

const LAYER_CLASS: Record<BuildLayer, string> = {
  frame: "anim-frame",
  header: "anim-header",
  content: "anim-content",
  data: "anim-data",
};

/** Rang dans une cascade : la variable `--i` multiplie l'écart de la couche. */
export function staggerIndex(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/**
 * Élément qui entre avec sa couche (fondu, flou qui se dissipe, 6 px vers le haut).
 * Compatible serveur : tout passe par le CSS.
 */
export function Build({
  layer = "content",
  index = 0,
  className,
  children,
}: {
  layer?: BuildLayer;
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(LAYER_CLASS[layer], className)} style={staggerIndex(index)}>
      {children}
    </div>
  );
}

/**
 * Liste en cascade. Chaque enfant entre avec sa couche, 60 ms d'écart pour `content`
 * (25 ms pour `data`, 30 ms pour `frame`). Compatible serveur.
 *
 * `as` et `itemAs` : `<Stagger as="ul" itemAs="li">` donne une vraie liste.
 */
export function Stagger({
  as: Root = "div",
  itemAs: Item = "div",
  layer = "content",
  className,
  itemClassName,
  children,
}: {
  as?: "div" | "ul" | "ol" | "section";
  itemAs?: "div" | "li";
  layer?: BuildLayer;
  className?: string;
  itemClassName?: string;
  children: ReactNode;
}) {
  return (
    <Root className={className}>
      {Children.toArray(children).map((child, index) => (
        <Item
          key={index}
          className={cn(LAYER_CLASS[layer], itemClassName)}
          style={staggerIndex(index)}
        >
          {child}
        </Item>
      ))}
    </Root>
  );
}
