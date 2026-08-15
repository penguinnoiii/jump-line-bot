// Open house / activity notifications for the demo site — a static catalog
// matched against a student's interest so the demo can show "แจ้งเตือนตาม
// ความสนใจ" as a card message, the way a real LINE OA push message would.
// Demo-only content: fictional dates/events, not tied to any real store.

export const EVENTS = [
  {
    id: 'code-camp',
    icon: '💻',
    title: 'ค่ายเขียนโปรแกรมสำหรับน้องมัธยมต้น',
    date: '21-22 ก.ย. 2569',
    desc: 'เรียนเขียนโค้ดทำเกมง่าย ๆ ด้วย Python ฟรี 2 วัน ไม่ต้องมีพื้นฐานมาก่อน',
    tags: ['เขียนโปรแกรม', 'คอมพิวเตอร์', 'คอมพิว', 'เกม', 'it', 'คอมฯ', 'ไอที', 'หุ่นยนต์', 'โค้ด', 'โปรแกรมเมอร์'],
  },
  {
    id: 'sci-fair',
    icon: '🔬',
    title: 'Open House สายวิทย์-คณิต โรงเรียนสาธิต',
    date: '5 ต.ค. 2569',
    desc: 'ทดลองวิทย์สนุก ๆ พบรุ่นพี่สายวิทย์-คณิต ถามได้ทุกเรื่องก่อนเลือกสาย',
    tags: ['วิทยาศาสตร์', 'วิทย์', 'คณิต', 'เคมี', 'ชีวะ', 'ฟิสิกส์', 'วิทย์-คณิต', 'นักวิทยาศาสตร์'],
  },
  {
    id: 'art-fest',
    icon: '🎨',
    title: 'เทศกาลศิลปะและออกแบบเยาวชน',
    date: '12 ต.ค. 2569',
    desc: 'เวิร์กช็อปวาดภาพ ออกแบบ และศิลปะดิจิทัล เปิดรับน้อง ม.1-3',
    tags: ['ศิลปะ', 'วาดภาพ', 'วาดรูป', 'ออกแบบ', 'การ์ตูน', 'anime', 'อนิเมะ', 'ดีไซน์'],
  },
  {
    id: 'med-openhouse',
    icon: '🩺',
    title: 'ค่ายหมอน้อย เปิดโลกสายสุขภาพ',
    date: '18 ต.ค. 2569',
    desc: 'จำลองการตรวจคนไข้ ทำความรู้จักอาชีพหมอ พยาบาล เภสัชกรตัวจริง',
    tags: ['แพทย์', 'หมอ', 'พยาบาล', 'สุขภาพ', 'เภสัช', 'สาธารณสุข'],
  },
  {
    id: 'biz-camp',
    icon: '💼',
    title: 'ค่ายนักธุรกิจรุ่นเยาว์',
    date: '25 ต.ค. 2569',
    desc: 'ฝึกคิดไอเดียธุรกิจ แล้วลองขายของจริงในตลาดนัดวันปิดค่าย',
    tags: ['ธุรกิจ', 'การตลาด', 'ผู้ประกอบการ', 'ขายของ', 'ธุรกิจส่วนตัว'],
  },
  {
    id: 'sport-camp',
    icon: '⚽',
    title: 'ค่ายกีฬาและวิทยาศาสตร์การกีฬา',
    date: '1-2 พ.ย. 2569',
    desc: 'ฝึกทักษะกีฬาที่ชอบ พร้อมเรียนรู้เบื้องหลังวิทยาศาสตร์การกีฬา',
    tags: ['กีฬา', 'ฟุตบอล', 'บาสเกตบอล', 'ว่ายน้ำ', 'ออกกำลังกาย', 'นักกีฬา'],
  },
  {
    id: 'animal-camp',
    icon: '🐾',
    title: 'ค่ายรักสัตว์ สายสัตวแพทย์',
    date: '8 พ.ย. 2569',
    desc: 'เยี่ยมชมคลินิกสัตว์ เรียนรู้การดูแลสัตว์เบื้องต้นกับสัตวแพทย์จริง',
    tags: ['สัตว์', 'สัตวแพทย์', 'หมาแมว', 'สัตวบาล'],
  },
  {
    id: 'music-camp',
    icon: '🎵',
    title: 'ค่ายดนตรีและการแสดง',
    date: '15 พ.ย. 2569',
    desc: 'เวิร์กช็อปร้องเพลง เล่นดนตรี และฝึกการแสดงบนเวทีจริง',
    tags: ['ดนตรี', 'ร้องเพลง', 'การแสดง', 'เต้น', 'นักร้อง'],
  },
];

/**
 * Find the first event whose tags relate to the given interest text —
 * simple substring matching (either direction) rather than an LLM call, so
 * matching stays fast, free, and predictable for a live demo.
 * @param {string} interestText
 * @param {string[]} [excludeIds] event ids already shown this session
 * @returns {object|null}
 */
export function findMatchingEvent(interestText, excludeIds = []) {
  const text = String(interestText || '').trim();
  if (!text) return null;
  for (const event of EVENTS) {
    if (excludeIds.includes(event.id)) continue;
    const hit = event.tags.some((tag) => text.includes(tag) || tag.includes(text));
    if (hit) return event;
  }
  return null;
}

/** Shape sent to the demo frontend for rendering as a notification card. */
export function buildEventCard(event, matchedInterest = null) {
  return {
    icon: event.icon,
    title: event.title,
    date: event.date,
    desc: event.desc,
    matchedInterest,
  };
}
