/**
 * db.js
 * ไฟล์นี้จัดการการเชื่อมต่อฐานข้อมูล MongoDB สำหรับทั้งโหมดพัฒนาและ production
 * มีไว้สำหรับ:
 * - เชื่อมต่อกับ MongoDB จริงหรือใช้ MongoMemoryReplSet ในโหมด dev
 * - ป้องกันปัญหาคล๊อกไฟล์จากการ stop/restart server บ่อยครั้ง
 * - จัดการการปิดการเชื่อมต่อเมื่อโปรแกรมหยุด
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
let local;

// connectDB: เปิดการเชื่อมต่อ MongoDB สำหรับ production หรือใช้ memory DB ใน dev
// ทำไมมีฟังก์ชันนี้: ช่วยให้ระบบเริ่มทำงานได้ทั้งในเครื่อง local และใน production โดยไม่ต้องกำหนดค่าเชื่อมต่อซ้ำ
export async function connectDB(uri=process.env.MONGODB_URI) {
 if (!uri) {
  if(process.env.NODE_ENV==='production') throw new Error('MONGODB_URI required in production');
  // Ephemeral dev DB avoids stale WiredTiger locks after a forced dev-server stop.
  local=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:'wiredTiger'}});
  uri=local.getUri('smart_itam');
  console.log('Development MongoDB (ephemeral memory instance)');
 }
 await mongoose.connect(uri);
}
// closeDB: ปิด MongoDB connection และ stop memory DB ถ้ามี
// ทำไมมีฟังก์ชันนี้: ใช้ตอนหยุด server หรือเมื่อต้อง cleanup เพื่อป้องกัน resource ค้างและ error จากการ restart
export async function closeDB(){await mongoose.disconnect();if(local)await local.stop({doCleanup:false});}
