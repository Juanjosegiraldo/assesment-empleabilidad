/**
 * The product mark. A rounded orange tile with the initial, used in the header and on the
 * sign in screen so both read as the same product.
 */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const dimensions = size === "lg" ? "h-11 w-11 text-xl rounded-2xl" : "h-8 w-8 text-sm rounded-xl";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-brand font-bold text-white shadow-sm ${dimensions}`}
    >
      R
    </span>
  );
}

/**
 * A small curated palette instead of a computed hue.
 *
 * Deriving a hue arithmetically is tempting and produces greens and cyans that fight the
 * brand orange. These six were picked to sit with it: five warm, and one teal so a busy
 * channel still has contrast.
 */
const AVATAR_COLOURS = [
  "#b45309", // amber
  "#9a3412", // burnt orange
  "#a16207", // ochre
  "#7c2d12", // chestnut
  "#0f766e", // teal, the one cool note
  "#78716c", // warm grey
];

/**
 * An initial in a colour derived from the person's name.
 *
 * The index comes from the characters themselves, so the same person is always the same
 * colour without anything being stored.
 */
export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const seed = [...name].reduce((total, character) => total + character.charCodeAt(0), 0);
  const colour = AVATAR_COLOURS[seed % AVATAR_COLOURS.length];
  const dimensions = size === "lg" ? "h-12 w-12 text-lg" : "h-7 w-7 text-[11px]";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dimensions}`}
      style={{ backgroundColor: colour }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
