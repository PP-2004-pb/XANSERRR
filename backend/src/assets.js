/**
 * assets.js
 * ไฟล์นี้เป็น API router สำหรับจัดการทรัพย์สินอุปกรณ์ทั้งหมด
 * มีไว้สำหรับ:
 * - ดูรายการอุปกรณ์/รายละเอียดอุปกรณ์
 * - สร้าง อัปเดต ย้าย/เช็กอิน-เอาท์ และลบอุปกรณ์
 * - บันทึก movement, PM, repair, issue และ audit log แบบ transaction
 * - รักษาความถูกต้องของข้อมูลเมื่อมีการแก้ไขพร้อมกันหลาย request
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Asset,Counter,Movement,PM,Repair,Audit,Transaction,TransactionItem,AssetGroup,AssetCategory } from './models.js';
import { staff,scope,roles } from './auth.js';
import { enrich } from './scoring.js';
import { assetInput,movementInput,pmInput,repairInput,parse } from './validation.js';
export const assets=Router();
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const assetImportInput=z.object({rows:z.array(z.record(z.string(),z.unknown())).min(1).max(500)});

async function validateImportRows(rows,session){
 const errors=[],parsed=[];
 const [groups,categories]=await Promise.all([
  AssetGroup.find().select('prefix').session(session||null).lean(),
  AssetCategory.find().select('name').session(session||null).lean()
 ]);
 const groupNames=new Set(groups.map(group=>group.prefix)),categoryNames=new Set(categories.map(category=>category.name));
 rows.forEach((row,index)=>{
  const {assetId:_assetId,...values}=row;
  const result=assetInput.safeParse(values);
  if(!result.success){errors.push({row:index+2,message:result.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ')});return;}
  if(result.data.assetGroup&&groups.length&&!groupNames.has(result.data.assetGroup))errors.push({row:index+2,message:`ไม่พบ Asset Group ${result.data.assetGroup}`});
  if(categories.length&&!categoryNames.has(result.data.category))errors.push({row:index+2,message:`ไม่พบ Category ${result.data.category}`});
  parsed.push({row:index+2,data:result.data});
 });
 const repeated=(field,label)=>{
  const occurrences=new Map();
  for(const entry of parsed){const value=entry.data[field];if(value){const normalized=value.trim().toLowerCase();occurrences.set(normalized,[...(occurrences.get(normalized)||[]),entry]);}}
  for(const [value,entries] of occurrences){
   if(entries.length>1)for(const entry of entries)errors.push({row:entry.row,message:`${label} ซ้ำในไฟล์: ${value}`});
  }
 };
 repeated('serialNumber','Serial Number');repeated('tagId','Tag ID');
 const serialNumbers=parsed.map(entry=>entry.data.serialNumber).filter(Boolean);
 const tagIds=parsed.map(entry=>entry.data.tagId).filter(Boolean);
 const duplicateQuery=[];
 if(serialNumbers.length)duplicateQuery.push({serialNumber:{$in:serialNumbers}});
 if(tagIds.length)duplicateQuery.push({tagId:{$in:tagIds}});
 if(duplicateQuery.length){
  const existing=await Asset.find({$or:duplicateQuery}).select('serialNumber tagId').session(session||null).lean();
  const existingSerials=new Set(existing.map(asset=>asset.serialNumber).filter(Boolean).map(value=>value.toLowerCase()));
  const existingTags=new Set(existing.map(asset=>asset.tagId).filter(Boolean).map(value=>value.toLowerCase()));
  for(const entry of parsed){
   if(entry.data.serialNumber&&existingSerials.has(entry.data.serialNumber.toLowerCase()))errors.push({row:entry.row,message:`Serial Number มีอยู่แล้ว: ${entry.data.serialNumber}`});
   if(entry.data.tagId&&existingTags.has(entry.data.tagId.toLowerCase()))errors.push({row:entry.row,message:`Tag ID มีอยู่แล้ว: ${entry.data.tagId}`});
  }
 }
 return {parsed,errors};
}

// getAsset: โหลดอุปกรณ์ตาม assetId พร้อมตรวจสิทธิ์ตามบทบาทของผู้ใช้
// ทำไมมีฟังก์ชันนี้: ใช้ร่วมกันในหลาย route เพื่อให้การค้นหาอุปกรณ์และการตรวจ permissions เป็นที่เดียวกัน
export async function getAsset(id,user,session){
 const asset=await Asset.findOne({assetId:id,...scope(user)}).session(session||null);
 if(!asset)throw fail('ไม่พบอุปกรณ์ หรือไม่มีสิทธิ์เข้าถึง',404);return asset;
}
// mutate: ทำการเปลี่ยนแปลงอุปกรณ์และบันทึก audit history ใน transaction เดียวกัน
// ทำไมมีฟังก์ชันนี้: เพื่อป้องกันกรณีสอง request เขียนข้อมูลพร้อมกัน แล้วทำให้ version และ history ไม่สอดคล้อง
async function mutate(req,action,work){
 let result;
 await mongoose.connection.transaction(async session=>{
  const asset=await getAsset(req.params.id,req.user,session);const before=asset.toObject();
  await work(asset,session);asset.version++;await asset.save({session});
  await Audit.create([{actor:req.user.name,action,assetId:asset.assetId,before,after:asset.toObject()}],{session});
  result=enrich(asset.toObject());
 });return result;
}
// GET /api/assets: คืนรายการอุปกรณ์พร้อม enrich analysis สำหรับแสดงบน dashboard และ list page
// ทำไมมี route นี้: ให้ frontend ดึงข้อมูลทั้งหมดแบบ searchable / filterable โดยไม่ต้องเขียน query ซ้ำในหลายหน้า
assets.get('/',async(req,res)=>{
 const q=String(req.query.q||'').trim(),filter=req.query.filter,category=req.query.category;
 const query={...scope(req.user)};
 if(q){const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const search=new RegExp(escaped,'i');query.$or=['assetId','name','serialNumber','macAddress','brand','model','floor','department','responsible','status','category','type'].map(field=>({[field]:search}));}
 if(category)query.category=category;
 if(req.query.group)query.assetGroup=req.query.group;
 if(req.user.role==='Department User')query.department=req.user.department;
 else if(req.query.department)query.department=req.query.department;
 if(req.query.location)query.location=req.query.location;
 const paginated=req.query.page!==undefined||req.query.limit!==undefined;
 const page=Math.max(1,Number.parseInt(req.query.page,10)||1),pageSize=Math.min(100,Math.max(1,Number.parseInt(req.query.limit,10)||50));
 const postFilter=['Healthy','Warning','Critical','PM Due','PM Overdue','High Risk','Warranty Expired'].includes(filter);
 if(filter&&!postFilter)query.status=filter;
 let cursor=Asset.find(query).sort({assetId:1});
 if(paginated&&!postFilter)cursor=cursor.skip((page-1)*pageSize).limit(pageSize);
 let rows=(await cursor.lean()).map(enrich);
 if(postFilter)rows=rows.filter(a=>({Healthy:a.analysis.level==='Healthy',Warning:a.analysis.level==='Warning',Critical:a.analysis.level==='Critical','PM Due':a.analysis.pmDue,'PM Overdue':a.analysis.overdueDays>0,'High Risk':a.analysis.risk>=60,'Warranty Expired':a.analysis.warrantyExpired}[filter]));
 if(!paginated)return res.json(rows);
 const total=postFilter?rows.length:await Asset.countDocuments(query);
 if(postFilter)rows=rows.slice((page-1)*pageSize,page*pageSize);
 res.json({items:rows,total,pageSize,pages:Math.ceil(total/pageSize)});
});
assets.post('/import/preview',staff,async(req,res)=>{
 const {rows}=assetImportInput.parse(req.body);
 const {parsed,errors}=await validateImportRows(rows);
 const invalidRows=new Set(errors.map(issue=>issue.row));
 res.json({rowCount:rows.length,validRows:rows.length-invalidRows.size,errors});
});
assets.post('/import',staff,async(req,res)=>{
 const {rows}=assetImportInput.parse(req.body);let created=[];
 try{
  await mongoose.connection.transaction(async session=>{
   const {parsed,errors}=await validateImportRows(rows,session);
   if(errors.length)throw Object.assign(new Error('ตรวจพบข้อมูลที่นำเข้าไม่ได้'),{status:400,importErrors:errors});
   const counts=new Map();
   for(const {data} of parsed){const prefix=data.assetGroup||'AST';counts.set(prefix,(counts.get(prefix)||0)+1);}
   const nextValues=new Map();
   for(const [prefix,count] of counts){
    const counter=await Counter.findOneAndUpdate({_id:prefix},{$inc:{value:count}},{upsert:true,new:true,session});
    nextValues.set(prefix,counter.value-count+1);
   }
   const documents=parsed.map(({data})=>{
    const prefix=data.assetGroup||'AST',value=nextValues.get(prefix);
    nextValues.set(prefix,value+1);
    return {...data,assetGroup:prefix,assetId:`${prefix}-${String(value).padStart(3,'0')}`};
   });
   created=await Asset.insertMany(documents,{session});
   await Audit.insertMany(created.map(asset=>({actor:req.user.name,action:'Import asset',assetId:asset.assetId,after:asset.toObject()})),{session});
  });
 }catch(error){
  if(error.importErrors)return res.status(400).json({error:error.message,issues:error.importErrors});
  throw error;
 }
 res.status(201).json({created:created.map(asset=>enrich(asset.toObject())),count:created.length});
});
// POST /api/assets: สร้างอุปกรณ์ใหม่พร้อมเลข assetId ที่ auto-increment จาก Counter
// ทำไมมี route นี้: ใช้สำหรับการเพิ่มครุภัณฑ์ใหม่ โดยให้ระบบจัดการ ID และประวัติการสร้างอัตโนมัติ
assets.post('/',staff,async(req,res)=>{
 const input=parse(assetInput,req.body);let created;
 await mongoose.connection.transaction(async session=>{
    const prefix=input.assetGroup||'AST';
    if(input.assetGroup&&!await AssetGroup.exists({prefix}).session(session))throw fail('ไม่พบ Asset Group');
  if(await AssetCategory.countDocuments().session(session)&&!await AssetCategory.exists({name:input.category}).session(session))throw fail('ไม่พบ Category');
    const count=await Counter.findOneAndUpdate({_id:prefix},{$inc:{value:1}},{upsert:true,new:true,session});
    [created]=await Asset.create([{...input,assetGroup:prefix,assetId:`${prefix}-${String(count.value).padStart(3,'0')}`}],{session});
  await Audit.create([{actor:req.user.name,action:'Create asset',assetId:created.assetId,after:created.toObject()}],{session});
 });res.status(201).json(enrich(created.toObject()));
});
// GET /api/assets/:id: คืนข้อมูลอุปกรณ์พร้อม movement, PM และ repair history
// ทำไมมี route นี้: เพื่อให้หน้า detail ดูข้อมูลย้อนหลังและความสัมพันธ์ของอุปกรณ์ได้ครบในครั้งเดียว
assets.get('/:id',async(req,res)=>{
 const a=await getAsset(req.params.id,req.user);const [movements,pm,repairs]=await Promise.all([
 Movement.find({asset:a._id}).sort({createdAt:-1}).lean(),PM.find({asset:a._id}).sort({date:-1}).lean(),Repair.find({asset:a._id}).sort({date:-1}).lean()]);
 res.json({...enrich(a.toObject()),movements,pm,repairs});
});
// PATCH /api/assets/:id: อัปเดตข้อมูลพื้นฐานของอุปกรณ์
// ทำไมมี route นี้: สำหรับแก้ไขข้อมูลทั่วไป เช่น name, model, brand แต่ไม่ให้ใช้แทนการทำ smart check-in/out
assets.patch('/:id',staff,async(req,res)=>{
 const input=parse(assetInput.partial(),req.body);
 if(['assetGroup','floor','department','location','responsible','status'].some(k=>k in input))throw fail('กรุณาใช้ Movement สำหรับสถานะ ผู้รับผิดชอบ และสถานที่');
 if(input.category&&await AssetCategory.countDocuments()&&!await AssetCategory.exists({name:input.category}))throw fail('ไม่พบ Category');
 res.json(await mutate(req,'Update asset',a=>Object.assign(a,input)));
});
// POST /api/assets/:id/movements: บันทึกการย้าย/เช็กอิน/เช็กเอาท์/ยืม/คืน/หาย
// ทำไมมี route นี้: เป็น core flow ของระบบ ITAM เพราะทุกการเปลี่ยนสถานะอุปกรณ์ต้องมีประวัติและผลกระทบต่อ dashboard
assets.post('/:id/movements',staff,async(req,res)=>{
 const input=parse(movementInput,req.body);
 res.json(await mutate(req,input.action,async(a,session)=>{
  const allowed={'Check-out':['Available'],Borrow:['Available'],'Check-in':['In Use','Missing'],Return:['Borrowed','In Use'],Move:['Available','In Use','Borrowed','Repair'],Assign:['Available','In Use','Borrowed'],Missing:['Available','In Use','Borrowed']};
  if(input.action==='Return'&&await TransactionItem.exists({asset:a._id,status:'CHECKED_OUT'}).session(session))throw fail('กรุณาคืนผ่าน Transaction ต้นทาง',409);
  if(!allowed[input.action].includes(a.status))throw fail(`ไม่สามารถ ${input.action} จากสถานะ ${a.status}`,409);
  const from={floor:a.floor,department:a.department,location:a.location};
  const to={floor:input.floor,department:input.department,location:input.location};
  a.status=({'Check-out':'In Use',Borrow:'Borrowed','Check-in':'Available',Return:'Available',Missing:'Missing'})[input.action]||a.status;
  Object.assign(a,to,{responsible:input.responsible});
  const day=new Date().toISOString().slice(0,10).replaceAll('-','');
  const counter=await Counter.findOneAndUpdate({_id:`TRX-${day}`},{$inc:{value:1}},{upsert:true,new:true,session});
  const transactionId=`TRX-${day}-${String(counter.value).padStart(3,'0')}`;
  const [trx]=await Transaction.create([{transactionId,type:'MOVE',actor:req.user.name,borrowerName:input.responsible,source:from,destination:to,purpose:input.reason,status:'COMPLETED',assetCount:1}],{session});
  await Movement.create([{...input,asset:a._id,assetId:a.assetId,actor:req.user.name,from,to,status:a.status,transactionId:trx._id}],{session});
 }));
});
// POST /api/assets/:id/pm: บันทึก PM และคำนวณวัน PM ครั้งถัดไป
// ทำไมมี route นี้: ช่วยให้ระบบติดตาม maintenance schedule และคำนวณความเสี่ยง/ความพร้อมของอุปกรณ์
assets.post('/:id/pm',staff,async(req,res)=>{
 const input=parse(pmInput,req.body);
 if(new Date(input.date)>new Date())throw fail('วันที่ PM ต้องไม่อยู่ในอนาคต');
 res.json(await mutate(req,'Record PM',async(a,session)=>{
  if(a.lastPMDate&&new Date(input.date)<a.lastPMDate)throw fail('วันที่ PM ต้องไม่เก่ากว่าครั้งล่าสุด');
  const nextPMDate=new Date(new Date(input.date).getTime()+input.intervalDays*86400000);
  await PM.create([{...input,asset:a._id,assetId:a.assetId,operator:req.user.name,nextPMDate}],{session});
  a.lastPMDate=new Date(input.date);a.nextPMDate=nextPMDate;
  if(input.macAddress)a.macAddress=input.macAddress;
  if(input.storageHealth!==undefined)a.storageHealth=input.storageHealth;
 }));
});
// POST /api/assets/:id/repairs: บันทึกการซ่อมและอัปเดตสถานะอุปกรณ์
// ทำไมมี route นี้: ใช้สำหรับ track repair history และให้หน้า maintenance / dashboard มองเห็นปัญหาและค่าใช้จ่าย
assets.post('/:id/repairs',staff,async(req,res)=>{
 const input=parse(repairInput,req.body);
 if(new Date(input.date)>new Date())throw fail('วันที่ซ่อมต้องไม่อยู่ในอนาคต');
 res.json(await mutate(req,'Record repair',async(a,session)=>{
  if(a.status==='Retired'||a.status==='Borrowed')throw fail('ไม่สามารถซ่อม Asset สถานะนี้',409);
  await Repair.create([{...input,asset:a._id,assetId:a.assetId,operator:req.user.name}],{session});
  a.repairCount++;a.status=input.status==='Open'?'Repair':'Available';a.nextAction=input.status==='Open'?`ส่งซ่อมกับ ${input.vendor||'ไม่ระบุ Vendor'}`:'Ready for use';
  await Movement.create([{asset:a._id,assetId:a.assetId,action:input.status==='Open'?'REPAIR':'REPAIR COMPLETED',actor:req.user.name,from:{floor:a.floor,department:a.department,location:a.location},to:{floor:a.floor,department:a.department,location:a.location},reason:input.symptom,status:a.status}],{session});
 }));
});
// POST /api/assets/:id/issues: บันทึกปัญหาที่ผู้ใช้รายงานจากอุปกรณ์
// ทำไมมี route นี้: เปิดช่องทางให้ผู้ใช้งานแจ้งปัญหาโดยไม่ต้องเป็นเจ้าหน้าที่ IT เพื่อให้มี issueCount ใน dashboard
assets.post('/:id/issues',roles('Admin','IT Staff','Department User'),async(req,res)=>{
 const reason=String(req.body.reason||'').trim();if(!reason||reason.length>1000)throw fail('กรุณาระบุปัญหา 1-1000 ตัวอักษร');
 res.json(await mutate(req,'Report issue',async(a,session)=>{
  a.issueCount++;
  await Repair.create([{asset:a._id,assetId:a.assetId,date:new Date(),symptom:reason,cost:0,operator:req.user.name,status:'Reported'}],{session});
 }));
});
// DELETE /api/assets/:id: ลบอุปกรณ์พร้อมลบ related records ทั้งหมด
// ทำไมมี route นี้: ใช้สำหรับจัดการทรัพย์สินที่สิ้นสุดการใช้งานหรือผิดพลาดในระบบ โดยต้องล้างประวัติที่เกี่ยวข้องให้ครบ
assets.delete('/:id',staff,async(req,res)=>{
 let removed;
 await mongoose.connection.transaction(async session=>{
  const asset=await getAsset(req.params.id,req.user,session);
  if(await TransactionItem.exists({asset:asset._id}).session(session))throw fail('มีประวัติ Transaction กรุณา Retire แทนการลบ',409);
  removed=asset.toObject();
  await Promise.all([
   Movement.deleteMany({asset:asset._id},{session}),
   PM.deleteMany({asset:asset._id},{session}),
   Repair.deleteMany({asset:asset._id},{session}),
   Asset.deleteOne({_id:asset._id},{session})
  ]);
  await Audit.create([{actor:req.user.name,action:'Delete asset',assetId:asset.assetId,before:removed}],{session});
 });
 res.json({deleted:true,assetId:removed.assetId});
});

// Explicit lifecycle transition; retirement is never a destructive delete.
assets.post('/:id/retire',staff,async(req,res)=>{
 const reason=String(req.body.reason||'').trim();if(!reason||reason.length>500)throw fail('กรุณาระบุเหตุผลการปลดระวาง');
 res.json(await mutate(req,'Retire asset',async(a,session)=>{
  if(['Borrowed','Retired'].includes(a.status)||await TransactionItem.exists({asset:a._id,status:'CHECKED_OUT'}).session(session))throw fail('ไม่สามารถปลดระวาง Asset นี้',409);
  a.status='Retired';a.retiredReason=reason;a.retiredAt=new Date();a.retiredBy=req.user.name;a.nextAction='Dispose / decommission';
  await Movement.create([{asset:a._id,assetId:a.assetId,action:'RETIRE',actor:req.user.name,from:{floor:a.floor,department:a.department,location:a.location},to:{floor:a.floor,department:a.department,location:a.location},reason,status:a.status}],{session});
 }));
});
assets.get('/:id/history',async(req,res)=>{
 const a=await getAsset(req.params.id,req.user);
 const [movements,pm,repairs,audit]=await Promise.all([Movement.find({asset:a._id}).populate('transactionId','transactionId').lean(),PM.find({asset:a._id}).lean(),Repair.find({asset:a._id}).lean(),Audit.find({assetId:a.assetId}).lean()]);
 res.json([...movements.map(m=>({...m,kind:'MOVEMENT',date:m.createdAt,transactionId:m.transactionId?.transactionId})),...pm.map(p=>({...p,kind:'PM',date:p.date,action:'PM'})),...repairs.map(r=>({...r,kind:'REPAIR',action:'REPAIR',date:r.date})),...audit.map(a=>({...a,kind:'AUDIT',date:a.createdAt}))].sort((a,b)=>new Date(b.date)-new Date(a.date)));
});
