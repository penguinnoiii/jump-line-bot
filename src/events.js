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
    location: 'ห้องคอมพิวเตอร์ อาคาร 4 โรงเรียนสาธิต',
    detail:
      'ค่าย 2 วันเต็ม สอนเขียนโปรแกรมภาษา Python ตั้งแต่พื้นฐานจนทำเกมง่าย ๆ ได้เอง ' +
      'มีพี่เลี้ยงดูแลใกล้ชิด ไม่ต้องมีพื้นฐานมาก่อนก็เข้าร่วมได้ รับจำนวนจำกัด 30 คน แจกใบประกาศนียบัตรเมื่อจบค่าย',
    tags: ['เขียนโปรแกรม', 'คอมพิวเตอร์', 'คอมพิว', 'เกม', 'it', 'คอมฯ', 'ไอที', 'หุ่นยนต์', 'โค้ด', 'โปรแกรมเมอร์'],
  },
  {
    id: 'sci-fair',
    icon: '🔬',
    title: 'Open House สายวิทย์-คณิต โรงเรียนสาธิต',
    date: '5 ต.ค. 2569',
    desc: 'ทดลองวิทย์สนุก ๆ พบรุ่นพี่สายวิทย์-คณิต ถามได้ทุกเรื่องก่อนเลือกสาย',
    location: 'หอประชุมใหญ่ โรงเรียนสาธิต',
    detail:
      'เปิดห้องแล็บให้ทดลองวิทยาศาสตร์จริงกับรุ่นพี่สายวิทย์-คณิต พร้อมบูธแนะแนวตอบทุกคำถามเรื่อง ' +
      'การเลือกสายเรียน เกณฑ์การสอบเข้า และวิชาที่ควรเตรียมตัว เข้าร่วมฟรี ไม่ต้องลงทะเบียนล่วงหน้า',
    tags: ['วิทยาศาสตร์', 'วิทย์', 'คณิต', 'เคมี', 'ชีวะ', 'ฟิสิกส์', 'วิทย์-คณิต', 'นักวิทยาศาสตร์'],
  },
  {
    id: 'art-fest',
    icon: '🎨',
    title: 'เทศกาลศิลปะและออกแบบเยาวชน',
    date: '12 ต.ค. 2569',
    desc: 'เวิร์กช็อปวาดภาพ ออกแบบ และศิลปะดิจิทัล เปิดรับน้อง ม.1-3',
    location: 'ลานกิจกรรม อาคารศิลปะ โรงเรียนสาธิต',
    detail:
      'รวมเวิร์กช็อปวาดภาพสีน้ำ ออกแบบกราฟิก และศิลปะดิจิทัลเบื้องต้น สอนโดยศิษย์เก่าสายศิลป์ ' +
      'ผลงานที่ทำในงานสามารถนำกลับบ้านได้ เปิดรับนักเรียน ม.1-3 ไม่มีค่าใช้จ่าย',
    tags: ['ศิลปะ', 'วาดภาพ', 'วาดรูป', 'ออกแบบ', 'การ์ตูน', 'anime', 'อนิเมะ', 'ดีไซน์'],
  },
  {
    id: 'med-openhouse',
    icon: '🩺',
    title: 'ค่ายหมอน้อย เปิดโลกสายสุขภาพ',
    date: '18 ต.ค. 2569',
    desc: 'จำลองการตรวจคนไข้ ทำความรู้จักอาชีพหมอ พยาบาล เภสัชกรตัวจริง',
    location: 'ศูนย์การเรียนรู้สุขภาพ โรงเรียนสาธิต',
    detail:
      'ฐานกิจกรรมจำลองการตรวจคนไข้ ปฐมพยาบาลเบื้องต้น และพูดคุยกับพี่ ๆ ที่เรียนสายแพทย์ พยาบาล ' +
      'และเภสัชกรรมจริง เหมาะสำหรับน้องที่อยากรู้ว่าชีวิตสายสุขภาพเป็นอย่างไรก่อนตัดสินใจเลือกสาย',
    tags: ['แพทย์', 'หมอ', 'พยาบาล', 'สุขภาพ', 'เภสัช', 'สาธารณสุข'],
  },
  {
    id: 'biz-camp',
    icon: '💼',
    title: 'ค่ายนักธุรกิจรุ่นเยาว์',
    date: '25 ต.ค. 2569',
    desc: 'ฝึกคิดไอเดียธุรกิจ แล้วลองขายของจริงในตลาดนัดวันปิดค่าย',
    location: 'ลานอเนกประสงค์ โรงเรียนสาธิต',
    detail:
      'ทำงานเป็นทีมคิดไอเดียธุรกิจตั้งแต่ต้นจนจบ วางแผนต้นทุน-กำไร แล้วเปิดร้านขายจริงในตลาดนัดวันสุดท้ายของค่าย ' +
      'ทีมที่ขายดีที่สุดได้รับรางวัลพิเศษ เหมาะกับน้องที่สนใจธุรกิจหรือการตลาด',
    tags: ['ธุรกิจ', 'การตลาด', 'ผู้ประกอบการ', 'ขายของ', 'ธุรกิจส่วนตัว'],
  },
  {
    id: 'sport-camp',
    icon: '⚽',
    title: 'ค่ายกีฬาและวิทยาศาสตร์การกีฬา',
    date: '1-2 พ.ย. 2569',
    desc: 'ฝึกทักษะกีฬาที่ชอบ พร้อมเรียนรู้เบื้องหลังวิทยาศาสตร์การกีฬา',
    location: 'สนามกีฬา โรงเรียนสาธิต',
    detail:
      'เลือกฝึกทักษะกีฬาที่สนใจกับโค้ชมืออาชีพ พร้อมเรียนรู้พื้นฐานวิทยาศาสตร์การกีฬา เช่น โภชนาการ ' +
      'และการป้องกันการบาดเจ็บ เหมาะกับน้องที่รักกีฬาและอยากรู้จักสายวิทยาศาสตร์การกีฬา',
    tags: ['กีฬา', 'ฟุตบอล', 'บาสเกตบอล', 'ว่ายน้ำ', 'ออกกำลังกาย', 'นักกีฬา'],
  },
  {
    id: 'animal-camp',
    icon: '🐾',
    title: 'ค่ายรักสัตว์ สายสัตวแพทย์',
    date: '8 พ.ย. 2569',
    desc: 'เยี่ยมชมคลินิกสัตว์ เรียนรู้การดูแลสัตว์เบื้องต้นกับสัตวแพทย์จริง',
    location: 'คลินิกสัตว์เพื่อการศึกษา ใกล้โรงเรียนสาธิต',
    detail:
      'เยี่ยมชมคลินิกสัตว์จริง เรียนรู้การดูแลสัตว์เบื้องต้นและพูดคุยกับสัตวแพทย์เกี่ยวกับเส้นทางการเรียนสายนี้ ' +
      'เหมาะสำหรับน้องที่รักสัตว์และอยากรู้ว่าจะเป็นสัตวแพทย์ได้อย่างไร',
    tags: ['สัตว์', 'สัตวแพทย์', 'หมาแมว', 'สัตวบาล'],
  },
  {
    id: 'music-camp',
    icon: '🎵',
    title: 'ค่ายดนตรีและการแสดง',
    date: '15 พ.ย. 2569',
    desc: 'เวิร์กช็อปร้องเพลง เล่นดนตรี และฝึกการแสดงบนเวทีจริง',
    location: 'หอดนตรี โรงเรียนสาธิต',
    detail:
      'เวิร์กช็อปร้องเพลง เล่นเครื่องดนตรีที่สนใจ และฝึกการแสดงสดบนเวที ปิดท้ายด้วยการแสดงจริงให้ผู้ปกครองชม ' +
      'ในวันสุดท้ายของค่าย ไม่จำเป็นต้องมีพื้นฐานดนตรีมาก่อน',
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

/** Shape sent to the demo frontend for rendering as a notification card —
 * includes location/detail so the frontend can show them in a popup when
 * the card is tapped, without a separate lookup call. */
export function buildEventCard(event, matchedInterest = null) {
  return {
    icon: event.icon,
    title: event.title,
    date: event.date,
    desc: event.desc,
    location: event.location,
    detail: event.detail,
    matchedInterest,
  };
}
