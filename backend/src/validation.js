/**
 * validation.js
 * ไฟล์นี้ทำหน้าที่ validate request body ก่อนบันทึกลงฐานข้อมูล
 * มีไว้สำหรับ:
 * - กำหนด schema สำหรับ Asset, Movement, PM, Repair
 * - ตรวจสอบรูปแบบข้อมูล เช่น วันที่, จำนวน, ข้อความ, enum
 * - ป้องกันข้อมูลผิดรูปแบบหรือขาดความครบถ้วนก่อนเข้าสู่ logic
 */
import { z } from 'zod';
import { TYPES,CATEGORIES,STATUSES,CLINICAL_AREAS,SAFETY_LEVELS } from './models.js';
const text=z.string().trim().max(500).default('');
const date=z.string().refine(v=>!v||!Number.isNaN(Date.parse(v)),'วันที่ไม่ถูกต้อง').transform(v=>v?new Date(v):undefined).optional();
// assetInput schema: กำหนดรูปแบบข้อมูลสำหรับการสร้าง/อัปเดตอุปกรณ์
// ทำไมมี schema นี้: ให้ frontend ส่งข้อมูลที่ถูกต้องและป้องกันค่าที่ผิดประเภทหรือขาดข้อมูลเข้ามา
export const assetInput=z.object({
 name:z.string().trim().min(1).max(200),category:z.string().trim().min(1).max(100).default('IT Equipment'),assetGroup:z.string().trim().regex(/^[A-Z]{2,8}$/).optional(),type:z.enum(TYPES),clinicalArea:z.enum(CLINICAL_AREAS).default('IT'),safetyLevel:z.enum(SAFETY_LEVELS).default('Medium'),brand:text,model:text,serialNumber:text,
 macAddress:text,cpu:text,ram:text,storage:text,os:text,purchaseDate:date,warrantyExpiration:date,
 floor:z.string().trim().min(1),department:z.string().trim().min(1),location:z.string().trim().min(1),
 responsible:text,status:z.enum(STATUSES).default('Available'),lastPMDate:date,nextPMDate:date,notes:text,
 storageHealth:z.coerce.number().min(0).max(100).default(100),ramUsage:z.coerce.number().min(0).max(100).default(30),
 cpuUsage:z.coerce.number().min(0).max(100).default(25),replacementCost:z.coerce.number().positive().default(30000),downtimeMinutes:z.coerce.number().int().min(0).default(0),tagId:text,
 photoUrl:z.string().max(5000000).optional(),serialPhotoUrl:z.string().max(5000000).optional(),photoName:text,photoMimeType:z.string().max(100).optional(),nextAction:z.string().trim().max(500).optional()
});
// movementInput schema: ตรวจสอบข้อมูลการเปลี่ยนสถานะ/การเคลื่อนย้ายของอุปกรณ์
// ทำไมมี schema นี้: เพราะ route movement มีความสำคัญและต้องมี reason, floor, department, location ที่ถูกต้องเสมอ
export const movementInput=z.object({action:z.enum(['Check-in','Check-out','Borrow','Return','Move','Assign','Missing']),
 responsible:z.string().trim().min(1).max(200),floor:z.string().trim().min(1),department:z.string().trim().min(1),
 location:z.string().trim().min(1),reason:z.string().trim().min(1).max(1000),method:z.enum(['QR','RFID','NFC','Manual']).default('Manual')});
// pmInput schema: ตรวจสอบข้อมูล PM ที่ต้องมีเรื่องวันที่, checklist และผลการทำงาน
// ทำไมมี schema นี้: เพื่อให้ PM entries ถูกต้องและสามารถคำนวณ nextPMDate ได้อย่างสม่ำเสมอ
export const pmInput=z.object({date:z.iso.date(),intervalDays:z.coerce.number().int().min(1).max(730).default(180),
 checklist:z.array(z.string().max(200)).min(1),issues:text,software:text,macAddress:text,hardware:text,
 result:z.enum(['Pass','Warning','Fail']),notes:text,storageHealth:z.coerce.number().min(0).max(100).optional()});
// repairInput schema: ตรวจสอบข้อมูลการซ่อมและค่าใช้จ่ายที่เกี่ยวข้อง
// ทำไมมี schema นี้: เพื่อให้ประวัติการซ่อมต่อเนื่องและมีรูปแบบเดียวกันในทุก route
export const repairInput=z.object({date:z.iso.date(),symptom:z.string().trim().min(1),cause:text,resolution:text,
 cost:z.coerce.number().min(0),status:z.enum(['Open','Completed']),vendor:z.string().trim().max(200).optional(),vendorContact:z.string().trim().max(200).optional(),notes:z.string().trim().max(1000).optional()});
// parse: helper สำหรับ validate request body ตาม schema ที่กำหนด
// ทำไมมีฟังก์ชันนี้: ลดการเขียนโค้ดซ้ำและทำให้ทุก route ใช้แนวทาง validation เดียวกัน
export function parse(schema,body){return schema.parse(body);}
