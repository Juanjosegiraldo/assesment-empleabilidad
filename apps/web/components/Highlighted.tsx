"use client";

/**
 * Renders the <mark> markers that ts_headline puts around a matched term.
 *
 * The string coming from the database is a message somebody typed, wrapped in markers.
 * Setting it with innerHTML would execute anything a colleague felt like writing into a
 * chat, which is stored XSS with extra steps.
 *
 * So the string is split on the markers and each piece is rendered as text. React escapes
 * it, the highlight still shows, and no markup from the message can ever reach the DOM.
 */
export function Highlighted({ text }: { text: string }) {
  const pieces = text.split(/(<mark>.*?<\/mark>)/g);

  return (
    <>
      {pieces.map((piece, index) =>
        piece.startsWith("<mark>") ? (
          <mark key={index} className="rounded bg-brand-ring/70 px-0.5 font-semibold text-stone-900">
            {piece.slice("<mark>".length, -"</mark>".length)}
          </mark>
        ) : (
          <span key={index}>{piece}</span>
        ),
      )}
    </>
  );
}
