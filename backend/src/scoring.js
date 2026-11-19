/**
 * scoring.js
 * ไฟล์นี้ใช้คำนวณคะแนนสุขภาพและความเสี่ยงของอุปกรณ์
 * มีไว้สำหรับ:
 * - ประเมินอายุอุปกรณ์, ประกัน, PM, ซ่อม, storage health, CPU/RAM usage
 * - คำนวณ health score, risk score, levels และ priority
 * - สร้าง replacement plan ตาม budget และความเสี่ยง
 * - ทำให้ dashboard และ recommendations ใช้ข้อมูลเดียวกันได้
 */
const DAY = 86400000;
// analyze: คำนวณ health score, risk score และปัจจัยที่ทำให้ score ต่ำ
// ทำไมมีฟังก์ชันนี้: ใช้อธิบายสถานะอุปกรณ์แบบเป็นตัวเลขเพื่อให้ dashboard, maintenance และ recommendations อ่านได้ง่าย
export function analyze(asset, now = new Date()) {
 const age = asset.purchaseDate ? Math.max(0,(now-new Date(asset.purchaseDate))/(365.25*DAY)) : 0;
 const warrantyExpired = !!asset.warrantyExpiration && new Date(asset.warrantyExpiration)<now;
 const overdueDays = asset.nextPMDate ? Math.max(0,Math.floor((now-new Date(asset.nextPMDate))/DAY)) : 0;
 const pmDue = !asset.nextPMDate || new Date(asset.nextPMDate)<=new Date(+now+30*DAY);
 const factors = [
  {reason:`อายุอุปกรณ์ ${age.toFixed(1)} ปี`,penalty:Math.min(25,Math.max(0,age-2)*5)},
  {reason:`ซ่อมสะสม ${asset.repairCount||0} ครั้ง`,penalty:Math.min(20,(asset.repairCount||0)*4)},
  {reason:`Storage Health ${asset.storageHealth ?? 100}%`,penalty:(100-(asset.storageHealth??100))*.25},
  {reason:'หมดระยะรับประกัน',penalty:warrantyExpired?8:0},
  {reason:`PM เกินกำหนด ${overdueDays} วัน`,penalty:Math.min(12,overdueDays/10)},
  {reason:'CPU / RAM ใช้งานสูง',penalty:Math.max(0,Math.max(asset.cpuUsage||0,asset.ramUsage||0)-70)*.2},
  {reason:`ปัญหาที่แจ้งสะสม ${asset.issueCount||0} รายการ`,penalty:Math.min(8,(asset.issueCount||0)*2)},
  {reason:`พื้นที่ใช้งานสำคัญระดับ ${asset.safetyLevel||'Medium'}`,penalty:{Low:0,Medium:2,High:6,Critical:12}[asset.safetyLevel||'Medium']},
  {reason:`Downtime สะสม ${asset.downtimeMinutes||0} นาที`,penalty:Math.min(8,(asset.downtimeMinutes||0)/120)}
 ];
 const health = Math.max(0,Math.round(100-factors.reduce((s,f)=>s+f.penalty,0)));
 const risk = Math.min(100,Math.round((100-health)*1.1));
 const reasons = factors.filter(f=>f.penalty>0).sort((a,b)=>b.penalty-a.penalty).map(f=>f.reason);
 const priority = risk>=80?'Critical':risk>=60?'High':risk>=35?'Medium':'Low';
 return {age:Number(age.toFixed(1)),health,risk,level:health>=80?'Healthy':health>=50?'Warning':'Critical',
  priority,reasons,warrantyExpired,overdueDays,pmDue,
  replace:risk>=70,pmPriority:Math.min(100,risk*.6+Math.min(30,overdueDays/3)+(pmDue?10:0)),
  dataQuality:asset.purchaseDate&&asset.nextPMDate?'Recorded':'Incomplete',
  scoreModel:'rules-v1',disclaimer:'คะแนนตามกฎ ไม่ใช่ความน่าจะเป็นการเสียที่ผ่านการสอบเทียบ; ค่า Hardware เป็นข้อมูลที่บันทึก ไม่ใช่ Telemetry สด'};
}
// enrich: เพิ่ม analysis field เข้าไปใน object ของอุปกรณ์
// ทำไมมีฟังก์ชันนี้: ทำให้ API 返回อุปกรณ์พร้อมข้อมูลผ่านการประเมินได้ในครั้งเดียว
export const enrich = asset => ({...asset,analysis:analyze(asset)});

// replacementPlan: จัดลำดับและเลือกอุปกรณ์ที่ควรเปลี่ยนตาม budget
// ทำไมมีฟังก์ชันนี้: ให้ team ใช้ข้อมูล risk-score มาจัดสรรงบประมาณได้แบบคาดการณ์ได้และเป็นเหตุผลชัดเจน
export function replacementPlan(assets,budget=Infinity) {
 let remaining=budget;
 const ranked=assets.filter(a=>a.analysis.replace&&a.status!=='Retired').sort((a,b)=>b.analysis.risk-a.analysis.risk);
 const selected=[];
 for(const a of ranked) if(a.replacementCost>0&&a.replacementCost<=remaining){selected.push(a);remaining-=a.replacementCost;}
 return {ranked,selected,totalCost:selected.reduce((s,a)=>s+a.replacementCost,0),remaining:Number.isFinite(remaining)?remaining:null,
  strategy:'จัดลำดับความเสี่ยงสูงก่อน แล้วเลือกเครื่องที่อยู่ในงบ ไม่ใช่การหาผลัพธ์เหมาะที่สุดทางคณิตศาสตร์'};
}
