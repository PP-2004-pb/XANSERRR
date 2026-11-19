/**
 * server.js
 * ไฟล์นี้เป็น entry point ของ backend server
 * มีไว้สำหรับ:
 * - โหลด environment variables
 * - เชื่อมต่อฐานข้อมูลก่อนเริ่มรับ request
 * - seed ข้อมูลตัวอย่างถ้าเปิดสวิตช์ DEMO_SEED
 * - เริ่ม Express app บน port ที่กำหนด
 */
import 'dotenv/config';
import { app } from './app.js';
import { connectDB } from './db.js';
import { seedDemo } from './seed.js';
const port = Number(process.env.PORT || 4000);

if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED === 'true') {
	throw new Error('DEMO_SEED must be disabled in production');
}
if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_DEMO === 'true' && process.env.PUBLIC_DEMO_DATA_CONFIRMATION !== 'synthetic-only') {
	throw new Error('Public demo requires confirmation that its database contains synthetic data only');
}

// connectDB: เปิด connection ก่อนรับ request
// ทำไมมีบล็อกนี้: ให้ app เริ่มจากฐานข้อมูลก่อนทำงาน เพราะ API หลาย route อิงข้อมูล MongoDB
await connectDB();

// seedDemo: โหลดข้อมูลสาธิตถ้าเปิดใช้งาน
// ทำไมมีบล็อกนี้: ช่วยให้ dev หรือ demo environment มีข้อมูลพร้อมใช้งานทันที โดยไม่ต้องยิง script แยก
if (process.env.DEMO_SEED === 'true') await seedDemo();

// app.listen: เริ่ม backend server
// ทำไมมีบล็อกนี้: เป็นจุดเริ่มต้นจริง ๆ ของระบบ โดยจะเปิด port ที่กำหนดและรอ request เข้ามา
app.listen(port, () => console.log(`Smart ITAM API listening on http://127.0.0.1:${port}`));
