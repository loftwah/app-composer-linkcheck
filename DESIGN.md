# Design

Reviewed 13 October 2026; artwork and recovery reviewed 17 October 2026. Link Check is an Operate surface within App Composer’s existing visual identity: charcoal/ivory, signal orange, self-hosted Space Grotesk headings and native sans controls. Preserve native forms, predictable keyboard focus, saved themes and useful density.

Artwork, reviewed 17 October 2026. The hero, the default social card and the app icon are the reviewed App Composer cut-paper screenprint set: a teal paper magnifier over an ivory page card with one burnt-orange landscape panel and two graphite rules, on warm ivory paper with graphite ink. `public/brand/linkcheck-art-v3-master.png` is the editable master; the 480/960 WebP hero renders in a reserved 1:1 box with a 1px hairline border, and the 1200 × 630 JPEG share card is the same file the Composer catalogue ships. `public/brand/mark.svg` is authored geometry and `public/brand/icon.png` is its 512px flat ivory apple-touch rendering. No vendor icon, platform logo or inspected page is ever drawn into the artwork. Provenance: `public/brand/linkcheck-art-v3.PROVENANCE.txt`.

The display font is preloaded from `/space.woff2`, which is the declared source of the one bundled face that headings ask for, so the early request is consumed rather than wasted.

Inspect one public URL, then present site identity and actual share-image preview together before the detailed findings. Fixes and reviews stay visible; passed checks collapse. Optional platform guidance is progressive disclosure. Image failures remain visible and exported. Phone layout follows the same information order in one column; no sticky or hidden inner scroll panels.

Findings and recovery, reviewed 17 October 2026. Every failed inspection states what to do next — a wrong address, a temporary origin error, an oversized or non-HTML response and an unreachable host each name their own step — and the message carries the weight of the form that produced it. A new or failed run clears the previous report from the document so stale numbers can never be read as current, while a filter that hides everything says what it hid instead of showing an empty list.

Follow App Composer’s UNSLOP.md minimum standard. Inspect both themes at phone and desktop sizes and real controls before claiming acceptance.
