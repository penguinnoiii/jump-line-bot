// Live web grounding — the bridge to a real "Central Education Database"
// until one exists. When a question needs current facts (school names,
// admissions windows, tuition, scholarships), search the web and feed real
// results into the LLM so it answers from live sources instead of stale
// training data — with citations, not fabrication.
//
// Provider: Tavily (https://tavily.com) — free tier, built for LLM grounding.
// No TAVILY_API_KEY set → search is skipped and the bot falls back to its
// existing "verify at the source" disclaimer behavior. Swappable: replace the
// body of webSearch() to point at Serper/Brave/etc. — the rest of the app
// only depends on the {title, url, snippet} shape returned here.

const TAVILY_URL = 'https://api.tavily.com/search';

/**
 * Heuristic: does this message need fresh, specific facts (vs. general
 * conversation)? Errs toward searching — a wasted search is cheap; a
 * confident wrong answer about a real deadline is not.
 */
const FACT_KEYWORDS =
  /โรงเรียน|มหาวิทยาลัย|สถาบัน|หลักสูตร|ทุนการศึกษา|ทุน|ค่าเทอม|ค่าใช้จ่าย|กำหนดการ|รับสมัคร|สมัคร|เปิดรับ|ปิดรับ|สอบเข้า|เกณฑ์|คะแนน|รอบ|TCAS|กสพท|จุฬา|มหิดล|ธรรมศาสตร์|เกษตรศาสตร์|ราชภัฏ|ราชมงคล|พระจอมเกล้า|ปีการศึกษา|ล่าสุด|ตอนนี้|วันนี้|เดือนนี้|school|university|admission|scholarship|tuition|deadline|search|ค้นหา/i;

export function needsWebSearch(text) {
  return FACT_KEYWORDS.test(String(text));
}

/**
 * @param {string} query
 * @returns {Promise<{results: {title:string,url:string,snippet:string}[], skipped:boolean, reason?:string}>}
 */
export async function webSearch(query, { maxResults = 4, timeoutMs = 7000 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { results: [], skipped: true, reason: 'no_api_key' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { results: [], skipped: true, reason: `http_${res.status}` };
    const json = await res.json();
    const results = (json.results || []).slice(0, maxResults).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: (r.content || '').slice(0, 400),
    }));
    return { results, skipped: false };
  } catch (err) {
    console.error('[search] error:', err);
    return { results: [], skipped: true, reason: String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}
