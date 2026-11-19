/**
 * app.js ไงครับ
 * หน้าที่หลักของไฟล์นี้คือกำหนด Express API server สำหรับ Smart ITAM
 * มีไว้สำหรับ:
 * - เปิดใช้งาน middleware ความปลอดภัย (helmet), CORS, JSON parsing
 * - สร้าง route หลักสำหรับ login, auth, users, assets, insights
 * - ให้ endpoint /api/health สำหรับเช็กสถานะระบบ
 * - จัดการ 404 และ error handling ให้ตอบกลับแบบเดียวกันทุก request
 * - ให้บริการ frontend build ใน production
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { User,Audit } from './models.js';
import { auth,tokenFor,roles } from './auth.js';
import { assets } from './assets.js';
import { insights } from './insights.js';
import { transactions } from './transactions.js';
import { catalog } from './catalog.js';
import { workOrders } from './work-orders.js';
export const app=express();

// Middleware ส่วนบน: ตั้งค่าความปลอดภัยและรูปแบบ request ให้พร้อมรับ API จาก frontend
// ทำไมมีบล็อกนี้: เพื่อให้ app รู้ว่าให้ใช้ Helmet, CORS และ parse JSON body จาก request
// คนที่เข้ามาแก้ไขต่อจะเห็นได้ทันทีว่าทั้งสามส่วนนี้เป็น "การตั้งค่าเริ่มต้นของ server"
app.use(helmet({contentSecurityPolicy:process.env.NODE_ENV==='production'?undefined:false}));
app.use(cors({origin:process.env.CLIENT_ORIGIN||process.env.RENDER_EXTERNAL_URL||'http://127.0.0.1:5173'}));
app.use(express.json({limit:'8mb'}));

// Health check endpoint: ใช้เช็กว่าระบบ backend ยังทำงานได้หรือไม่
// ทำไมมีบล็อกนี้: ช่วยให้ dev / ops / QA ตรวจสอบสถานะของ API ได้แบบรวดเร็ว
app.get('/api/health',(_req,res)=>res.json({status:'ok',mode:'rules-v1'}));
// Login API: ตรวจข้อมูล login และคืน token ให้ frontend ใช้งานต่อ
// ทำไมมีบล็อกนี้: เมื่อผู้ใช้กรอก email/password ถูกต้อง ระบบจะสร้าง token เพื่อใช้ต่อกับ route ที่ต้อง auth
// ถ้าต้องการแก้ไข login flow เช่น เพิ่ม captcha, เปลี่ยนการ validate, หรือเปลี่ยน token expiry ให้ดูที่บล็อกนี้
app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:50,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
 if(process.env.PUBLIC_DEMO==='true')return res.status(403).json({error:'Public demo is read-only'});
 const input=z.object({email:z.email(),password:z.string().min(1).max(200)}).parse(req.body);
 const user=await User.findOne({email:input.email.toLowerCase()});
 if(!user||user.isActive===false||!await bcrypt.compare(input.password,user.passwordHash))return res.status(401).json({error:'อีเมลหรือรหัสผ่านไม่ถูกต้อง'});
 const safe={id:user._id,name:user.name,email:user.email,role:user.role,department:user.department,isActive:user.isActive!==false};
 res.json({token:tokenFor(user),user:safe});
});

// Auth middleware สำหรับทุก route ที่อยู่ใต้ /api
// ทำไมมีบล็อกนี้: บอก Express ว่า route หลังจากนี้ทุกอันต้องตรวจ token ก่อนถึง logic จริง
// ถ้าต้องการเปลี่ยนการยืนยันตัวตนหรือเพิ่มสิทธิ์พิเศษ ให้แก้ที่ auth.js ไม่ใช่ route แต่ route นี้เป็นการเปิดใช้งาน
app.use('/api',auth);

// Route ที่ใช้ข้อมูลผู้ใช้ปัจจุบัน
// ทำไมมีบล็อกนี้: frontend สามารถโหลดข้อมูลตัวเองหลัง login ได้โดยไม่ต้องส่ง email/password ใหม่
app.get('/api/auth/me',(req,res)=>res.json(req.user));

// Route สำหรับดู/สร้างผู้ใช้ในระบบ (เฉพาะ Admin)
// ทำไมมีบล็อกนี้: คุมการสร้างบัญชีและดูรายชื่อผู้ใช้ด้วยสิทธิ์ Admin เท่านั้น
const userRoles=['Admin','IT Staff','Department User','Management'];
const ensureAdminRemains=async(user,next)=>{
 if(user.role==='Admin'&&(next.role&&next.role!=='Admin'||next.isActive===false)){
  const admins=await User.countDocuments({role:'Admin',isActive:{$ne:false}});
  if(admins<=1){const error=new Error('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี');error.status=400;throw error;}
 }
};
app.get('/api/users',roles('Admin'),async(_req,res)=>res.json(await User.find().select('-passwordHash').sort({name:1}).lean()));
app.post('/api/users',roles('Admin'),async(req,res)=>{
 const data=z.object({name:z.string().trim().min(1),email:z.email(),password:z.string().min(12).max(100),role:z.enum(userRoles),department:z.string().trim().min(1),isActive:z.boolean().optional()}).parse(req.body);
 const user=await User.create({...data,email:data.email.toLowerCase(),passwordHash:await bcrypt.hash(data.password,12)});
 await Audit.create({actor:req.user.name,action:'Create user',after:{name:user.name,email:user.email,role:user.role}});
 res.status(201).json(await User.findById(user._id).select('-passwordHash').lean());
});
app.patch('/api/users/:id',roles('Admin'),async(req,res)=>{
 const data=z.object({name:z.string().trim().min(1).optional(),email:z.email().optional(),password:z.string().min(12).max(100).optional(),role:z.enum(userRoles).optional(),department:z.string().trim().min(1).optional(),isActive:z.boolean().optional()}).strict().parse(req.body);
 const user=await User.findById(req.params.id);
 if(!user){const error=new Error('ไม่พบผู้ใช้งาน');error.status=404;throw error;}
 await ensureAdminRemains(user,data);
 const before={name:user.name,email:user.email,role:user.role,department:user.department,isActive:user.isActive!==false};
 if(data.name!==undefined)user.name=data.name;
 if(data.email!==undefined)user.email=data.email.toLowerCase();
 if(data.role!==undefined)user.role=data.role;
 if(data.department!==undefined)user.department=data.department;
 if(data.isActive!==undefined)user.isActive=data.isActive;
 if(data.password!==undefined)user.passwordHash=await bcrypt.hash(data.password,12);
 await user.save();
 const after={name:user.name,email:user.email,role:user.role,department:user.department,isActive:user.isActive};
 await Audit.create({actor:req.user.name,action:'Update user',before,after});
 res.json(await User.findById(user._id).select('-passwordHash').lean());
});

// การต่อ route จากไฟล์แยกต่าง ๆ เข้ากับ app หลัก
// ทำไมมีบล็อกนี้: แยก logic ออกเป็น assets.js และ insights.js ให้ code อ่านง่ายและแก้ไขแยกส่วน
// ถ้าเพิ่ม feature ใหม่ ให้ต่อ route ที่นี่แทนการเขียนเมือกทั้งไฟล์ใหญ่
app.use('/api/assets',assets);app.use('/api/transactions',transactions);app.use('/api/catalog',catalog);app.use('/api/work-orders',workOrders);app.use('/api',insights);

// 404 handler สำหรับ API ที่ไม่มี route
// ทำไมมีบล็อกนี้: ให้ client ได้ error ที่สม่ำเสมอ เมื่อเรียก API ที่ไม่มีอยู่จริง
app.use('/api',(_req,res)=>res.status(404).json({error:'ไม่พบ API'}));

// การให้บริการ frontend build ใน production
// ทำไมมีบล็อกนี้: เมื่อ deploy แล้ว frontend build อยู่ใน folder dist ระบบจะส่งไฟล์ static ให้ browser
// route /{*path} ใช้เพื่อให้ SPA route เช่น /dashboard /assets ได้โหลดหน้า index.html ได้ถูกต้อง
const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../frontend/dist');
app.use(express.static(dist));
app.get('/{*path}',(_req,res)=>res.sendFile(path.join(dist,'index.html')));

// Global error handler: จัดการ error ที่เกิดจาก Zod, duplicate key, validation และ unexpected errors
// ทำไมมีบล็อกนี้: เพื่อให้อ่านและแก้ error ได้ง่ายและให้ client ได้ response ที่เข้าใจได้
// ถ้าอยากเพิ่ม error code ใหม่ ให้เพิ่มเงื่อนไขตรงนี้ก่อนส่ง response
app.use((error,_req,res,_next)=>{
 if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
 if(error.code===11000)return res.status(409).json({error:'ข้อมูลซ้ำในระบบ'});
 if(error.name==='ValidationError')return res.status(400).json({error:error.message});
 if(!error.status)console.error(error);
 res.status(error.status||500).json({error:error.status?error.message:'ระบบเกิดข้อผิดพลาด กรุณาลองอีกครั้ง'});
});
