// Turns a guidance reply (headline + bullet points, per the format enforced
// in src/prompts.js) into a LINE Flex Message bubble — a proper Rich
// Message card instead of a wall of plain text. Falls back gracefully to
// null (caller sends plain text instead) whenever the model didn't follow
// the expected shape, so a formatting slip never breaks the reply.

const BRAND = { primary: '#2f4bd6', line: '#06C755', muted: '#8592a3', ink: '#16202e' };

/** Split a guidance reply into a headline + up to 5 bullet points. Points
 * are lines starting with "•" or "-"; anything else after the first line
 * is ignored (kept out of the card rather than guessed at). */
export function parseGuidanceStructure(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const headline = lines[0].replace(/^[•\-]\s*/, '').trim();
  if (!headline) return null;

  const points = lines
    .slice(1)
    .filter((l) => /^[•\-]/.test(l))
    .map((l) => l.replace(/^[•\-]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  return { headline, points };
}

/**
 * Build a LINE Flex Message for a guidance reply. Returns null (caller
 * should fall back to a plain text message) if the reply didn't parse into
 * a usable headline.
 * @param {string} text  raw guidance reply from generateGuidance()
 * @param {{title:string,url:string}[]} [sources]
 * @returns {{type:'flex', altText:string, contents:object}|null}
 */
export function buildGuidanceFlexMessage(text, sources = []) {
  const structure = parseGuidanceStructure(text);
  if (!structure) return null;
  const { headline, points } = structure;

  const bodyContents = [
    { type: 'text', text: headline, weight: 'bold', size: 'md', wrap: true, color: BRAND.ink },
  ];

  if (points.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'lg' });
    points.forEach((point) => {
      bodyContents.push({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        margin: 'lg',
        contents: [
          { type: 'text', text: '•', color: BRAND.line, flex: 0, weight: 'bold' },
          { type: 'text', text: point, wrap: true, size: 'sm', flex: 1, color: BRAND.ink },
        ],
      });
    });
  }

  const footerContents = [];
  if (sources.length > 0) {
    footerContents.push({ type: 'separator' });
    sources.slice(0, 3).forEach((s, i) => {
      footerContents.push({
        type: 'box',
        layout: 'vertical',
        margin: 'md',
        action: { type: 'uri', uri: s.url, label: 'open' },
        contents: [
          {
            type: 'text',
            text: `📎 ${i + 1}. ${s.title}`,
            size: 'xs',
            color: BRAND.primary,
            wrap: true,
          },
        ],
      });
    });
  }

  const contents = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: BRAND.line,
      paddingAll: '12px',
      contents: [{ type: 'text', text: '🎓 Numpa', color: '#ffffff', size: 'sm', weight: 'bold' }],
    },
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: bodyContents },
    ...(footerContents.length > 0
      ? { footer: { type: 'box', layout: 'vertical', paddingAll: '14px', spacing: 'sm', contents: footerContents } }
      : {}),
  };

  return {
    type: 'flex',
    // altText is what shows in notifications / chat list preview — keep it
    // short and plain, no markup.
    altText: headline.length > 80 ? headline.slice(0, 77) + '...' : headline,
    contents,
  };
}
