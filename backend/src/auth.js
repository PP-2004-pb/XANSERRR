/**
 * auth.js
 * ไฟล์นี้เป็นชั้น Authentication และ Authorization ของระบบ
 * มีไว้สำหรับ:
 * - สร้าง JWT token เมื่อผู้ใช้เข้าสู่ระบบ
 * - ตรวจสอบ token ใน request ทุกครั้ง
 * - โหลดข้อมูลผู้ใช้ที่ล็อกอินอยู่
 * - จำกัดสิทธิ์การใช้งานตามบทบาท เช่น Admin / IT Staff / Department User
 */
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { User } from './models.js';
const configuredSecret=process.env.JWT_SECRET;
const secret=configuredSecret || (process.env.NODE_ENV==='production'?null:randomBytes(48).toString('hex'));
if(!secret || secret.length<32 || (process.env.NODE_ENV==='production' && configuredSecret?.startsWith('replace-with-')))throw new Error('JWT_SECRET must be a unique value with at least 32 characters');
// tokenFor: สร้าง JWT สำหรับผู้ใช้ที่เข้าสู่ระบบ
// ทำไมมีฟังก์ชันนี้: ใช้เพื่อให้ frontend ส่ง token กลับมาเมื่อเรียก API ที่ต้องการยืนยันตัวตน
export const tokenFor = user => jwt.sign({sub:String(user._id)},secret,{expiresIn:'8h'});

// auth: middleware ตรวจ token และโหลดข้อมูลผู้ใช้จากฐานข้อมูล
// ทำไมมีฟังก์ชันนี้: เป็นจุดกลางในการตรวจสิทธิ์ของทุก request ที่ต้อง login ก่อนใช้งาน
export async function auth(req,res,next){
 try {
	if(process.env.PUBLIC_DEMO==='true'){
	 const viewer=await User.findOne({role:'Management',isActive:{$ne:false}}).select('-passwordHash').lean();
	 if(!viewer)return res.status(503).json({error:'Public demo viewer is not configured'});
	 req.user=viewer;return next();
	}
	const token=req.headers.authorization?.replace(/^Bearer /,'');const claims=jwt.verify(token,secret,{algorithms:['HS256']});
 req.user=await User.findById(claims.sub).select('-passwordHash').lean();if(!req.user||req.user.isActive===false)throw new Error();next();
 } catch {res.status(401).json({error:'กรุณาเข้าสู่ระบบใหม่'});}
}
// roles: middleware จำกัดสิทธิ์ตามบทบาทของผู้ใช้
// ทำไมมีฟังก์ชันนี้: ให้ route ที่ต้องการ Admin หรือ IT Staff ใช้งานได้อย่างชัดเจนและปลอดภัย
export const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'คุณไม่มีสิทธิ์ดำเนินการนี้'});

// scope: กำหนดขอบเขตข้อมูลที่ Department User จะเห็นได้
// ทำไมมีฟังก์ชันนี้: จำกัดการเข้าถึงข้อมูลตามแผนก เพื่อให้ผู้ใช้เห็นเฉพาะสิ่งที่เกี่ยวข้องกับตน
export const scope=user=>user.role==='Department User'?{department:user.department}:{};

// staff: shortcut สำหรับ route ที่อนุญาตเฉพาะ Admin และ IT Staff
// ทำไมมีฟังก์ชันนี้: ลดการเขียนสิทธิ์ซ้ำและทำให้โค้ดอ่านง่าย
export const staff=roles('Admin','IT Staff');
