/**
 * insights.js
 * ไฟล์นี้สร้าง API สำหรับ dashboard, analytics, recommendations และ assistant
 * มีไว้สำหรับ:
 * - สรุปสถานะอุปกรณ์และสถิติต่าง ๆ
 * - แสดงรายการ PM, repair, movement, notifications
 * - ให้คำแนะนำเรื่อง replacement plan และรายการที่ควรเปลี่ยน
 * - รองรับคำถามแบบ rule-based สำหรับถามข้อมูลจากฐานข้อมูล
 */
import { Router } from 'express';
import { Asset,Movement,PM,Repair,Audit,Transaction,TransactionItem } from './models.js';
import { scope,roles } from './auth.js';
import { enrich,replacementPlan } from './scoring.js';
export const insights=Router();

// readAssets: ดึงข้อมูลอุปกรณ์ที่ผู้ใช้สามารถเข้าถึงได้แล้ว enrich พร้อม analysis
// ทำไมมีฟังก์ชันนี้: ใช้ร่วมกันในหลาย endpoint ของ dashboard / notifications / recommendations
const readAssets=async user=>(await Asset.find(scope(user)).lean()).map(enrich);
// group: helper สำหรับรวมข้อมูลตามคีย์ เช่น type, floor, department, status
// ทำไมมีฟังก์ชันนี้: ใช้สร้าง chart data ให้ dashboard ได้ง่ายและสม่ำเสมอ
const group=(items,key)=>Object.entries(items.reduce((acc,a)=>{const k=typeof key==='function'?key(a):a[key]||'ไม่ระบุ';acc[k]=(acc[k]||0)+1;return acc;},{})).map(([name,value])=>({name,value}));

// GET /api/dashboard: สรุปข้อมูลภาพรวมสำหรับหน้า dashboard
// ทำไมมี route นี้: ให้ UI แสดงจำนวนอุปกรณ์, risk, PM, repair และ charts ในครั้งเดียว
insights.get('/dashboard',async(req,res)=>{
 const all=await readAssets(req.user);const ids=all.map(a=>a._id);
 const [pm,repairs,movements]=await Promise.all([PM.find({asset:{$in:ids}}).lean(),Repair.find({asset:{$in:ids}}).lean(),Movement.find({asset:{$in:ids}}).sort({createdAt:-1}).limit(8).lean()]);
 res.json({total:all.length,health:Math.round(all.reduce((s,a)=>s+a.analysis.health,0)/(all.length||1)),
 averageAge:Number((all.reduce((s,a)=>s+a.analysis.age,0)/(all.length||1)).toFixed(1)),
 inUse:all.filter(a=>a.status==='In Use').length,borrowed:all.filter(a=>a.status==='Borrowed').length,
 available:all.filter(a=>a.status==='Available').length,repair:all.filter(a=>a.status==='Repair').length,
 highRisk:all.filter(a=>a.analysis.risk>=60).length,pmDue:all.filter(a=>a.analysis.pmDue).length,
 replacement:all.filter(a=>a.analysis.replace).length,
 charts:{category:group(all,'category'),type:group(all,'type'),floor:group(all,'floor'),department:group(all,'department'),clinicalArea:group(all,'clinicalArea'),safetyLevel:group(all,'safetyLevel'),status:group(all,'status'),risk:group(all,a=>a.analysis.priority),
 pm:group(pm,a=>a.date.toISOString().slice(0,7)),repair:group(repairs,a=>a.date.toISOString().slice(0,7)),age:all.map(a=>({name:a.assetId,value:a.analysis.age}))},
 priority:all.filter(a=>a.analysis.risk>=35).sort((a,b)=>b.analysis.risk-a.analysis.risk).slice(0,5),movements,updatedAt:new Date()});
});
// GET /api/movements: คืน movement history ล่าสุด
// ทำไมมี route นี้: ใช้สำหรับหน้า activity log หรือ timeline ที่ต้องเห็นการเปลี่ยนแปลงของอุปกรณ์
insights.get('/movements',async(req,res)=>{const all=await readAssets(req.user);res.json(await Movement.find({asset:{$in:all.map(a=>a._id)}}).sort({createdAt:-1}).limit(500).lean());});
// GET /api/maintenance: คืนรายการอุปกรณ์ที่ควรมีการ PM หรือต้องดูแลก่อน
// ทำไมมี route นี้: ให้ทีม IT รู้ว่าควรทำอะไรก่อนและเรียงตามความสำคัญ
insights.get('/maintenance',async(req,res)=>{
 const all=await readAssets(req.user),assets=all.filter(a=>a.analysis.pmDue||a.analysis.risk>=60).sort((a,b)=>b.analysis.pmPriority-a.analysis.pmPriority);
 const ids=assets.map(a=>a._id),repairs=await Repair.find({asset:{$in:ids}}).sort({date:-1,createdAt:-1}).lean(),vendorByAsset=new Map();
 for(const repair of repairs)if(!vendorByAsset.has(String(repair.asset)))vendorByAsset.set(String(repair.asset),repair.vendor||'—');
 res.json(assets.map(a=>({...a,vendor:vendorByAsset.get(String(a._id))||'—'})));
});
// GET /api/clinical-summary: สรุปอุปกรณ์ตามพื้นที่ทางคลินิกและระดับผลกระทบต่อความปลอดภัยผู้ป่วย
insights.get('/clinical-summary',async(req,res)=>{
 const all=await readAssets(req.user);
 res.json({areas:group(all,'clinicalArea'),safety:group(all,'safetyLevel'),critical:all.filter(a=>a.safetyLevel==='Critical').sort((a,b)=>b.analysis.risk-a.analysis.risk).slice(0,10),updatedAt:new Date()});
});
// GET /api/recommendations: คำนวณแผน replacement ตาม budget
// ทำไมมี route นี้: ใช้สำหรับหน้าข้อเสนอแนะหรือ dashboard ที่ต้องมีแผนการเปลี่ยนอุปกรณ์แบบมีงบประมาณ
insights.get('/recommendations',async(req,res)=>{
 const budget=req.query.budget===undefined?Infinity:Number(req.query.budget);
 if(Number.isNaN(budget)||budget<0)return res.status(400).json({error:'งบประมาณไม่ถูกต้อง'});
 res.json(replacementPlan(await readAssets(req.user),budget));
});
// GET /api/audit: คืน audit log สำหรับ Admin
// ทำไมมี route นี้: ให้ดูประวัติการเปลี่ยนแปลงของระบบเพื่อ tracing หรือการสอบสวน
insights.get('/audit',roles('Admin'),async(req,res)=>res.json(await Audit.find().sort({createdAt:-1}).limit(500).lean()));
// GET /api/notifications: สร้าง notification list จาก rule-based analysis
// ทำไมมี route นี้: ให้ UI แสดง warning, overdue PM, warranty ending และ missing asset เป็นลิสต์ที่อ่านง่าย
insights.get('/notifications',async(req,res)=>{
 const all=await readAssets(req.user),items=[],now=new Date(),assetIds=all.map(asset=>asset._id);
 for(const a of all){
  const push=(kind,message,severity)=>items.push({id:`${a.assetId}-${kind}`,assetId:a.assetId,kind,message,severity});
  if(a.analysis.overdueDays)push('pm',`PM เกินกำหนด ${a.analysis.overdueDays} วัน`,'high');
  else if(a.analysis.pmDue)push('pm','PM ใกล้ถึงกำหนด / ยังไม่กำหนด','medium');
  if(a.analysis.warrantyExpired)push('warranty','หมดระยะรับประกัน','medium');
  else if(a.warrantyExpiration&&new Date(a.warrantyExpiration)-new Date()<30*86400000)push('warranty','ประกันจะหมดภายใน 30 วัน','medium');
  if(a.analysis.risk>=60)push('risk',`ความเสี่ยงสูง ${a.analysis.risk}%`,'high');
  if(a.analysis.health<50)push('health',`สุขภาพต่ำ ${a.analysis.health}/100`,'high');
  if(a.status==='Missing')push('missing','อุปกรณ์สูญหาย / ไม่พบ','high');
 }
 const openItems=await TransactionItem.find({asset:{$in:assetIds},status:'CHECKED_OUT'}).lean();
 const transactionQuery={_id:{$in:openItems.map(item=>item.transaction)},type:'CHECKOUT',status:{$ne:'COMPLETED'},dueDate:{$lt:now}};
 if(req.user.role==='Department User')transactionQuery.borrower=req.user._id;
 const overdueTransactions=await Transaction.find(transactionQuery).lean(),transactionsById=new Map(overdueTransactions.map(transaction=>[String(transaction._id),transaction]));
 const assetsById=new Map(all.map(asset=>[String(asset._id),asset]));
 for(const item of openItems){
  const transaction=transactionsById.get(String(item.transaction)),asset=assetsById.get(String(item.asset));
  if(!transaction||!asset||asset.status!=='Borrowed')continue;
  const daysOverdue=Math.max(1,Math.floor((now-new Date(transaction.dueDate))/86400000));
  items.push({id:`overdue-${transaction.transactionId}-${item.assetId}`,assetId:item.assetId,kind:'overdue',message:`คืนเกินกำหนด ${daysOverdue} วัน · ${transaction.transactionId}`,severity:'high',transactionId:transaction.transactionId,dueDate:transaction.dueDate,daysOverdue});
 }
 const moves=await Movement.find({asset:{$in:assetIds},createdAt:{$gte:new Date(Date.now()-7*86400000)}}).sort({createdAt:-1}).limit(30).lean();
 moves.forEach(m=>items.push({id:String(m._id),assetId:m.assetId,kind:'movement',message:`${m.action}: ${m.from.location} → ${m.to.location}`,severity:'info'}));
 res.json(items);
});
// POST /api/assistant: รับคำถามจากผู้ใช้แล้วตอบด้วยข้อมูลจริงจาก MongoDB ตามสิทธิ์ของผู้ถาม
// ทำไมมี route นี้: เป็น rule-based assistant ที่ใช้ข้อมูลในระบบจริง ไม่ invent หรือ query มาจาก AI model อื่น
// และสื่อว่าระบบนี้เป็น deterministic assistant แบบ grounded data เท่านั้น
insights.post('/assistant',async(req,res)=>{
 const question=String(req.body.question||'').trim();if(!question||question.length>1000)return res.status(400).json({error:'กรุณาพิมพ์คำถามไม่เกิน 1,000 ตัวอักษร'});
 const all=await readAssets(req.user);let selected=[],answer='',plan;
 const floor=question.match(/(?:ชั้น|floor)\s*(\d+)/i)?.[1];
 const budgetText=question.match(/(?:งบ(?:ประมาณ)?|budget)\s*([\d,]+)/i)?.[1];
 if(budgetText){plan=replacementPlan(all,Number(budgetText.replaceAll(',','')));selected=plan.selected;answer=`แนะนำ ${selected.length} เครื่อง รวม ${plan.totalCost.toLocaleString()} บาท เหลืองบ ${plan.remaining.toLocaleString()} บาท โดยเรียงความเสี่ยงสูงก่อน`;}
 else if(/ชั้น.*ปัญหา|floor.*problem/i.test(question)){
  const g=group(all,a=>a.floor).map(g=>({...g,issues:all.filter(a=>a.floor===g.name).reduce((s,a)=>s+(a.issueCount||0)+(a.repairCount||0),0)})).sort((a,b)=>b.issues-a.issues);
  answer=g.length?`ชั้น ${g[0].name} มีปัญหาและการซ่อมสะสมมากที่สุด ${g[0].issues} รายการ`:'ยังไม่มีข้อมูลอุปกรณ์';selected=all.filter(a=>a.floor===g[0]?.name);
 } else if(floor){selected=all.filter(a=>a.floor===floor&&(!/คอม|computer/i.test(question)||a.type==='Computer'));answer=`ชั้น ${floor} พบ ${selected.length} เครื่อง ตามสิทธิ์การเข้าถึงของคุณ`;}
 else if(/ประกัน|warranty/i.test(question)){selected=all.filter(a=>a.analysis.warrantyExpired);answer=`พบอุปกรณ์หมดประกัน ${selected.length} เครื่อง`;}
 else if(/PM|บำรุง|maintenance/i.test(question)){const monthly=/เดือนนี้/.test(question),now=new Date();selected=all.filter(a=>monthly?(!a.nextPMDate||new Date(a.nextPMDate)<new Date(now.getFullYear(),now.getMonth()+1,1)):a.analysis.pmDue).sort((a,b)=>b.analysis.pmPriority-a.analysis.pmPriority);answer=`แนะนำ PM ${selected.length} เครื่อง รวมรายการเกินกำหนด เรียงตามความเร่งด่วน`;}
 else if(/เปลี่ยน|replace/i.test(question)){selected=replacementPlan(all).ranked;answer=`แนะนำเปลี่ยน ${selected.length} เครื่องที่ Risk ≥ 70%`;}
 else if(/เสี่ยง|risk/i.test(question)){selected=all.filter(a=>a.analysis.risk>=60).sort((a,b)=>b.analysis.risk-a.analysis.risk);answer=`พบความเสี่ยงสูง ${selected.length} เครื่อง`;}
 else answer='รองรับคำถามเรื่องจำนวนเครื่องตามชั้น, ความเสี่ยง, ประกัน, PM, การเปลี่ยนเครื่อง และงบประมาณ เช่น “ถ้ามีงบ 300,000 บาท ควรเปลี่ยนเครื่องไหน?”';
 res.json({answer,assets:selected,source:'MongoDB / ข้อมูลตามสิทธิ์ ณ เวลาที่ถาม',engine:'Rule-based · rules-v1 (ไม่ใช่ LLM)',generatedAt:new Date(),strategy:plan?.strategy});
});

// Date-filtered movement insight, derived from persisted movements and open checkout items.
insights.get('/movement-insight',async(req,res)=>{
 const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 const periods={today:[today,now],yesterday:[new Date(today.getTime()-86400000),today],week:[new Date(today.getTime()-6*86400000),now],month:[new Date(today.getTime()-29*86400000),now]};
 const [start,end]=req.query.period==='custom'?[new Date(req.query.start),new Date(req.query.end)]:periods[req.query.period||'week']||[];
 if(!start||!end||!Number.isFinite(+start)||!Number.isFinite(+end)||start>end)return res.status(400).json({error:'ช่วงวันที่ไม่ถูกต้อง'});
 if(req.query.period==='custom')end.setHours(23,59,59,999);
 const all=await Asset.find(scope(req.user)).lean(),ids=all.map(a=>a._id),byId=new Map(all.map(a=>[a.assetId,a]));
 const [moves,openItems,repairs]=await Promise.all([Movement.find({asset:{$in:ids},createdAt:{$gte:start,$lte:end}}).sort({createdAt:-1}).lean(),TransactionItem.find({asset:{$in:ids},status:'CHECKED_OUT'}).lean(),Repair.find({asset:{$in:ids},date:{$gte:start,$lte:end}}).lean()]);
 const transactions=await Transaction.find({_id:{$in:openItems.map(i=>i.transaction)},type:'CHECKOUT'}).lean(),trxById=new Map(transactions.map(t=>[String(t._id),t]));
 const borrowed=openItems.filter(i=>trxById.has(String(i.transaction))&&byId.get(i.assetId)?.status==='Borrowed').map(i=>({assetId:i.assetId,name:byId.get(i.assetId)?.name,dueDate:trxById.get(String(i.transaction)).dueDate,transactionId:trxById.get(String(i.transaction)).transactionId}));
 const tally=(list,key)=>group(list,key).sort((a,b)=>b.value-a.value);
 const usage=moves.filter(m=>['CHECKOUT','Borrow','Check-out'].includes(m.action)),category=tally(usage,m=>byId.get(m.assetId)?.category||'Other');
 const movementByAsset=tally(moves,'assetId'),byDepartment=tally(moves,m=>m.to?.department||'Unknown'),byLocation=tally(moves,m=>m.to?.location||'Unknown');
 const lastMovementByAsset=new Map();for(const move of moves){if(!lastMovementByAsset.has(move.assetId))lastMovementByAsset.set(move.assetId,move);}
 const lastCheckoutByAsset=new Map();for(const move of moves)if(['CHECKOUT','Borrow','Check-out'].includes(move.action)&&!lastCheckoutByAsset.has(move.assetId))lastCheckoutByAsset.set(move.assetId,move);
 const enrichChartRows=rows=>rows.map(row=>{const matching=all.filter(asset=>String((asset.category||'Other')===row.name||(asset.department||'Unknown')===row.name||(asset.location||'Unknown')===row.name||(asset.status||'')===row.name||asset.assetId===row.name||asset.type===row.name));const history=matching.map(asset=>lastMovementByAsset.get(asset.assetId)).filter(Boolean);return {...row,assetIds:matching.map(asset=>asset.assetId),departments:[...new Set(matching.map(asset=>asset.department).filter(Boolean))],locations:[...new Set(matching.map(asset=>asset.location).filter(Boolean))],statuses:[...new Set(matching.map(asset=>asset.status).filter(Boolean))],categoryNames:[...new Set(matching.map(asset=>asset.category).filter(Boolean))],typeNames:[...new Set(matching.map(asset=>asset.type).filter(Boolean))],movementDates:[...new Set(history.map(move=>new Date(move.createdAt).toISOString().slice(0,10)))],hours:[...new Set(matching.map(asset=>lastCheckoutByAsset.get(asset.assetId)).filter(Boolean).map(move=>`${String(new Date(move.createdAt).getHours()).padStart(2,'0')}:00`))]};});
 const categoryUsage=tally(usage,m=>byId.get(m.assetId)?.category||'Other').map(row=>({...row,assetIds:[...new Set(usage.filter(move=>(byId.get(move.assetId)?.category||'Other')===row.name).map(move=>move.assetId))]}));
 const movementByAssetDetailed=movementByAsset.map(row=>({...row,assetIds:[row.name]}));
 const byDepartmentDetailed=byDepartment.map(row=>({...row,assetIds:[...new Set(moves.filter(move=>(move.to?.department||'Unknown')===row.name).map(move=>move.assetId))]}));
 const byLocationDetailed=byLocation.map(row=>({...row,assetIds:[...new Set(moves.filter(move=>(move.to?.location||'Unknown')===row.name).map(move=>move.assetId))]}));
 const byTrend=tally(moves,move=>new Date(move.createdAt).toISOString().slice(0,10)).sort((a,b)=>a.name.localeCompare(b.name)).map(row=>({...row,assetIds:[...new Set(moves.filter(move=>new Date(move.createdAt).toISOString().slice(0,10)===row.name).map(move=>move.assetId))]}));
 const hoursDetailed=tally(usage,move=>`${String(new Date(move.createdAt).getHours()).padStart(2,'0')}:00`).map(row=>({...row,assetIds:[...new Set(usage.filter(move=>`${String(new Date(move.createdAt).getHours()).padStart(2,'0')}:00`===row.name).map(move=>move.assetId))]}));
 const frequentRepairs=tally(repairs,r=>r.assetId).filter(r=>r.value>=2);
 const groupCounts=Object.values(all.reduce((acc,a)=>{const name=a.assetGroup||a.assetId.split('-')[0],row=acc[name]||(acc[name]={name,total:0,available:0,borrowed:0,inUse:0,repair:0,retired:0,unavailable:[]});row.total++;if(a.status==='Available')row.available++;else{row.unavailable.push(a.assetId);if(a.status==='Borrowed')row.borrowed++;else if(a.status==='In Use')row.inUse++;else if(a.status==='Repair')row.repair++;else if(a.status==='Retired')row.retired++;}return acc;},{}));
 const statusCounts=Object.fromEntries(['Available','Borrowed','In Use','Repair','Retired'].map(s=>[s,all.filter(a=>a.status===s).length]));
 const recommendations=[];
 if(category[0]?.value>=3)recommendations.push(`${category[0].name} มีการใช้งาน ${category[0].value} ครั้งในช่วงนี้ ควรพิจารณาเตรียมอุปกรณ์สำรอง`);
 if(movementByAsset[0]?.value>=3)recommendations.push(`${movementByAsset[0].name} ถูกเคลื่อนย้าย ${movementByAsset[0].value} ครั้ง ควรทบทวนจุดจัดวาง`);
 if(frequentRepairs.length)recommendations.push(`${frequentRepairs[0].name} ซ่อม ${frequentRepairs[0].value} ครั้ง ควรประเมินการเปลี่ยนทดแทน`);
 res.json({period:{start,end},summary:{total:all.length,...statusCounts,inUse:statusCounts['In Use'],todayMovement:moves.filter(m=>new Date(m.createdAt)>=today).length,overdue:borrowed.filter(b=>b.dueDate&&new Date(b.dueDate)<now).length},groups:groupCounts,charts:{department:byDepartmentDetailed,assets:movementByAssetDetailed,trend:byTrend,status:tally(all,'status').map(row=>({...row,assetIds:all.filter(asset=>asset.status===row.name).map(asset=>asset.assetId)})),category:categoryUsage,location:byLocationDetailed,hours:hoursDetailed,type:enrichChartRows(tally(all,'type'))},borrowed,recommendations,movements:moves.slice(0,10)});
});
