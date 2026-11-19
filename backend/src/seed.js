/**
 * seed.js
 * ไฟล์นี้ใช้สำหรับสร้างข้อมูลตัวอย่าง (demo data)
 * มีไว้สำหรับ:
 * - สร้างบัญชีผู้ใช้ 4 บทบาท
 * - สร้างอุปกรณ์ 500 รายการครบทุกหมวด พร้อม PM, Repair, Movement
 * - ใช้สำหรับสาธิตฟีเจอร์ได้ทันทีโดยไม่ต้องโหลดข้อมูลจริง
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { Asset, User, Counter, PM, Repair, Movement, Audit, Transaction, TransactionItem,AssetGroup,AssetCategory,Department,Location } from './models.js';
import { connectDB, closeDB } from './db.js';
const daysAgo = n => new Date(Date.now() - n * 86400000);
// seedDemo: สร้างข้อมูลตัวอย่างสำหรับ demo environment
// ทำไมมีฟังก์ชันนี้: ใช้ให้เริ่มต้นระบบได้ทันที โดยไม่ต้องมีข้อมูลจริงก่อนและช่วยให้การสาธิตทำงานได้คงที่
export async function seedDemo() {
    if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
    const currentAssets = await Asset.countDocuments();
    const reset = process.argv.includes('--reset') || process.env.RESET_DEMO_DATA === 'true' || (process.env.DEMO_SEED === 'true' && currentAssets > 0 && currentAssets < 500);
    if (reset) {
        await Promise.all([User.deleteMany({}), Asset.deleteMany({}), Counter.deleteMany({}), PM.deleteMany({}), Repair.deleteMany({}), Movement.deleteMany({}), Transaction.deleteMany({}), TransactionItem.deleteMany({}), Audit.deleteMany({}),AssetGroup.deleteMany({}),AssetCategory.deleteMany({}),Department.deleteMany({}),Location.deleteMany({})]);
        console.log('Cleared existing demo data.');
    } else if (await User.countDocuments() || currentAssets) return;
    await AssetGroup.insertMany([{prefix:'AST',name:'IT Asset'},{prefix:'FAC',name:'Facility Asset'}]);
    await AssetCategory.insertMany(['IT Equipment','Medical Equipment','Facility Equipment','Other','Computer','Notebook','Monitor','Printer','Projector','Camera','Storage','Network Device','Scanner','Server','Other IT Equipment'].map(name=>({name})));
    await Department.insertMany(['IT','Accounting','HR','OPD','Marketing','Nursing','Emergency','ICU','Operating Room','Laboratory','Radiology','Pharmacy','Facilities','Management'].map(name=>({name})));
    await Location.insertMany([{name:'IT Department',building:'WMC Hospital',floor:'6',department:'IT'},{name:'Accounting',building:'WMC Hospital',floor:'21',department:'Accounting'},{name:'Meeting Room',building:'WMC Hospital',floor:'6',department:'IT'}]);
    const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'SmartDemo2026!', 12);
    await User.insertMany([
        { name: 'Admin Demo', email: 'admin@smartitam.local', role: 'Admin', department: 'IT', passwordHash },
        { name: 'IT Staff Demo', email: 'staff@smartitam.local', role: 'IT Staff', department: 'IT', passwordHash },
        { name: 'Accounting Demo', email: 'user@smartitam.local', role: 'Department User', department: 'Accounting', passwordHash },
        { name: 'Management Demo', email: 'manager@smartitam.local', role: 'Management', department: 'Management', passwordHash }
    ]);
    const definitions = [
        ['IT Equipment','Computer','PC','Dell OptiPlex'],['IT Equipment','Laptop','NB','Lenovo ThinkPad'],['IT Equipment','Monitor','MON','Dell Monitor'],['IT Equipment','Printer','PRN','HP LaserJet'],
        ['IT Equipment','Network Device','NET','Cisco Catalyst'],['IT Equipment','Server','SRV','Dell PowerEdge'],['IT Equipment','UPS','UPS','APC Smart-UPS'],
        ['Medical Equipment','Infusion Pump','MED-IP','B. Braun Infusomat'],['Medical Equipment','Patient Monitor','MED-PM','Philips IntelliVue'],['Medical Equipment','Ventilator','MED-VT','Drager Savina'],
        ['Medical Equipment','Defibrillator','MED-DF','ZOLL AED'],['Medical Equipment','ECG Machine','MED-ECG','Philips PageWriter'],['Medical Equipment','Ultrasound','MED-US','GE Voluson'],['Medical Equipment','X-Ray Machine','MED-XR','Siemens Mobilett'],
        ['Medical Equipment','CT Scanner','MED-CT','GE Revolution CT'],['Medical Equipment','Operating Table','MED-OT','Steris Operating Table'],['Medical Equipment','Syringe Pump','MED-SP','Terumo TE-331'],['Medical Equipment','Medical Refrigerator','MED-MR','Haier Medical'],
        ['Facility Equipment','Other','FAC','Facility Equipment'],['Other','Other','AST','General Asset']
    ];
    const counters = Object.fromEntries(definitions.map(([, , prefix]) => [prefix, 0]));
    const areas = ['OPD','ER','ICU','OR','Ward','Laboratory','Radiology','Pharmacy','Administration','IT'];
    const departments = ['OPD','Emergency','ICU','Operating Room','Nursing','Laboratory','Radiology','Pharmacy','IT','Facilities'];
    const locations = ['Reception','Nurse Station','Treatment Room','Equipment Store','Control Room','Main Office'];
    for (let i = 0; i < 500; i++) {
        const [category,type,prefix,baseName] = definitions[i % definitions.length];
        const number = ++counters[prefix], old = i % 13 === 0;
        const clinicalArea = category === 'Medical Equipment' ? areas[i % 8] : areas[(i + 3) % areas.length];
        const safetyLevel = category === 'Medical Equipment' ? (i % 17 === 0 ? 'Critical' : i % 5 === 0 ? 'High' : 'Medium') : (i % 11 === 0 ? 'High' : 'Low');
        const asset = await Asset.create({
            assetId: `${prefix}-${String(number).padStart(3, '0')}`,assetGroup:prefix, category, type, clinicalArea, safetyLevel,
            name: `${baseName} ${2020 + (i % 6)}-${String(number).padStart(3, '0')}`, brand: baseName.split(' ')[0], model: `Demo ${2020 + (i % 6)}`,
            serialNumber: `DEMO-SN-${String(10000 + i)}`, macAddress: category === 'IT Equipment' ? `02:00:00:00:${Math.floor(i / 256).toString(16).padStart(2, '0')}:${(i % 256).toString(16).padStart(2, '0')}` : '',
            cpu: category === 'IT Equipment' ? 'Intel Core i5' : '', ram: category === 'IT Equipment' ? '16 GB' : '', storage: category === 'IT Equipment' ? '512 GB SSD' : '', os: category === 'IT Equipment' ? 'Windows 11 Pro' : 'Firmware',
            purchaseDate: daysAgo(old ? 2555 : 180 + i * 4), warrantyExpiration: daysAgo(old ? 500 : -180 + i * 2),
            floor: ['1','2','3','6','12','21'][i % 6], department: departments[i % departments.length], location: locations[i % locations.length],
            responsible: ['Somchai','Nattapong','Suda','Anan','เจ้าหน้าที่เวร'][i % 5], status: ['In Use','Available','In Use','Borrowed','Repair','Available'][i % 6],
            lastPMDate: daysAgo(old ? 360 : 30 + (i % 60)), nextPMDate: daysAgo(old ? 120 : -30 + (i % 120)), repairCount: old ? 4 : i % 19 === 0 ? 1 : 0,
            storageHealth: old ? 35 : 90 + (i % 10), ramUsage: old ? 88 : 35 + (i % 30), cpuUsage: old ? 82 : 20 + (i % 35), downtimeMinutes: old ? 480 : i % 7 * 15,
            replacementCost: category === 'Medical Equipment' ? 50000 + (i % 10) * 25000 : category === 'IT Equipment' ? 18000 + (i % 6) * 5000 : 12000,
            notes: 'ข้อมูลสาธิต 500 รายการ ไม่ใช่ทรัพย์สินจริง', tagId: `RFID-${10000 + i}`
        });
        await PM.create({ asset: asset._id, assetId: asset.assetId, date: asset.lastPMDate, operator: 'IT Staff Demo', checklist: ['ตรวจสอบสภาพภายนอก','ทดสอบการทำงาน','ตรวจสอบความปลอดภัย'], result: old ? 'Warning' : 'Pass', nextPMDate: asset.nextPMDate });
        if (old) await Repair.create({ asset: asset._id, assetId: asset.assetId, date: daysAgo(45), symptom: 'ประสิทธิภาพลดลง', cause: 'อายุการใช้งาน', resolution: 'ตรวจสอบและเปลี่ยนอะไหล่', cost: 2500, operator: 'IT Staff Demo', status: 'Completed' });
        await Movement.create({ asset: asset._id, assetId: asset.assetId, action: 'Check-out', method: 'QR', actor: 'IT Staff Demo', responsible: asset.responsible, from: { floor: '6', department: 'IT', location: 'Stock Room' }, to: { floor: asset.floor, department: asset.department, location: asset.location }, reason: 'ข้อมูลสาธิตการติดตั้ง', status: asset.status });
    }

    // สร้างประวัติ Transaction จำลองจาก Asset และ User ที่ seed ไว้จริง
    // เพื่อให้หน้า Transactions มีข้อมูลสำหรับสาธิต โดยไม่ใช้ข้อมูลลอยหรือ asset ปลอม
    const demoUsers = await User.find().sort({ email: 1 }).lean();
    const demoAssets = await Asset.find().sort({ assetId: 1 }).limit(12).lean();
    const demoDate = daysAgo;
    for (let i = 0; i < 6; i++) {
        const asset = demoAssets[i];
        const borrower = demoUsers[i % demoUsers.length];
        const createdAt = demoDate(2 + i * 5);
        const transactionId = `TRX-DEMO-${String(i + 1).padStart(3, '0')}`;
        const source = { floor: '6', department: 'IT', location: 'Stock Room' };
        const destination = { floor: asset.floor, department: borrower.department, location: ['Accounting', 'Meeting Room', 'Nurse Station'][i % 3] };
        const [transaction] = await Transaction.create([{
            transactionId, type: 'CHECKOUT', borrower: borrower._id, borrowerName: borrower.name,
            actor: 'IT Staff Demo', source, destination, purpose: ['ประชุมประจำเดือน', 'ติดตั้งหน้างาน', 'สำรองใช้งาน'][i % 3],
            dueDate: new Date(createdAt.getTime() + 7 * 86400000), assetCount: 1,
            status: i < 2 ? 'OPEN' : 'COMPLETED', returnedCount: i < 2 ? 0 : 1,
            createdAt, updatedAt: createdAt
        }]);
        await TransactionItem.create({ transaction: transaction._id, asset: asset._id, assetId: asset.assetId, status: i < 2 ? 'CHECKED_OUT' : 'RETURNED', returnedAt: i < 2 ? undefined : new Date(createdAt.getTime() + 2 * 86400000) });
    }
    await Transaction.create({
        transactionId: 'TRX-DEMO-007', type: 'RETURN', borrower: demoUsers[1]._id, borrowerName: demoUsers[1].name,
        actor: 'IT Staff Demo', source: { floor: '21', department: 'Accounting', location: 'Accounting' },
        destination: { floor: '6', department: 'IT', location: 'Stock Room' }, purpose: 'คืนหลังใช้งาน', assetCount: 1, returnedCount: 1,
        status: 'COMPLETED', createdAt: demoDate(1), updatedAt: demoDate(1)
    });
    await Counter.insertMany(Object.entries(counters).map(([prefix,value]) => ({ _id: prefix, value })));
    await Audit.create({ actor: 'System', action: 'Seed demo', after: { assets: 500, transactions: 7, categories: 4, description: 'Synthetic hospital IT and medical equipment data' } });
    console.log('Seeded 500 demo assets across IT, medical, facility and other categories, plus 4 role accounts.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await connectDB(); try { await seedDemo(); } finally { await closeDB(); }
}
