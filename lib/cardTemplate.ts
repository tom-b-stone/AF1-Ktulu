// Stand-in artwork for a Team Card whose image is not defined yet: the card
// format (4:5, graphite) with a clear "not defined yet" note, so previews,
// journeys and the table never show an empty slot or the generic back side.
// Returns an SVG data URI (works in <img>, in the preview iframe and in CSS).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// long names wrap onto two lines of ~18 characters
function lines(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 18 && cur) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  if (out.length > 2) out[1] = out.slice(1).join(" ").slice(0, 17) + "…";
  return out.slice(0, 2);
}

export function cardTemplate(name?: string, lang: "en" | "de" = "en"): string {
  const de = lang === "de";
  const title = lines(name || (de ? "Team Card" : "Team Card"));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="400" height="500">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3D3A3A"/><stop offset="1" stop-color="#1F1D1D"/></linearGradient>
<pattern id="p" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="14" stroke="#F5F2F2" stroke-opacity=".05" stroke-width="2"/></pattern>
</defs>
<rect width="400" height="500" rx="22" fill="url(#g)"/>
<rect width="400" height="500" rx="22" fill="url(#p)"/>
<rect x="16" y="16" width="368" height="468" rx="14" fill="none" stroke="#F5F2F2" stroke-opacity=".35" stroke-width="2" stroke-dasharray="10 8"/>
<text x="40" y="58" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="2.4" fill="#F5F2F2" fill-opacity=".7">TEAM CARD</text>
<rect x="250" y="40" width="110" height="26" rx="13" fill="#FF2D00"/>
<text x="305" y="58" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#FFFFFF">${de ? "VORLAGE" : "TEMPLATE"}</text>
<g transform="translate(200 210)" fill="none" stroke="#F5F2F2" stroke-opacity=".55" stroke-width="3">
<rect x="-34" y="-42" width="68" height="84" rx="8"/>
<path d="M-20 18 L-4 -2 L8 12 L14 6 L22 18"/>
<circle cx="10" cy="-18" r="6"/>
</g>
<text x="200" y="296" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#F5F2F2">${de ? "Kartenbild" : "Card image"}</text>
<text x="200" y="322" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#F5F2F2" fill-opacity=".7">${de ? "noch nicht definiert" : "not defined yet"}</text>
${title.map((t, i) => `<text x="40" y="${428 + i * 30 - (title.length - 1) * 30}" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#F5F2F2">${esc(t)}</text>`).join("")}
<text x="40" y="460" font-family="Helvetica, Arial, sans-serif" font-size="13" letter-spacing="1.2" fill="#F5F2F2" fill-opacity=".5">AUDI REVOLUT F1® TEAM</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const NOT_DEFINED = { en: "Not defined yet", de: "Noch nicht definiert" };
