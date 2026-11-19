/**
 * models.js
 * ไฟล์นี้กำหนด schema และ model ของ MongoDB สำหรับ Smart ITAM
 * มีไว้สำหรับ:
 * - บันทึกข้อมูลอุปกรณ์, ผู้ใช้, movement, PM, repair, audit, counter
 * - ทำให้ backend และ frontend ใช้ข้อมูลเชิงโครงสร้างเดียวกัน
 * - รองรับการค้นหา, การย้ายข้อมูลและการอัปเดตแบบมีประวัติได้ง่าย
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const options = { timestamps: true };

// TYPES และ STATUSES: กำหนดค่า enum ที่ใช้ร่วมกันในหลายส่วนของระบบ
// ทำไมมีค่าดังกล่าว: เพื่อให้ประเภทและสถานะของอุปกรณ์มีรูปแบบเดียวกันทุกที่และลดความผิดพลาดจากการพิมพ์คำต่างกัน
export const CATEGORIES = ['IT Equipment','Medical Equipment','Facility Equipment','Other'];
export const TYPES = ['Computer','Laptop','Monitor','Printer','Network Device','Server','UPS','Infusion Pump','Patient Monitor','Ventilator','Defibrillator','ECG Machine','Ultrasound','X-Ray Machine','CT Scanner','Operating Table','Syringe Pump','Medical Refrigerator','Other'];
export const CLINICAL_AREAS = ['OPD','ER','ICU','OR','Ward','Laboratory','Radiology','Pharmacy','Administration','IT'];
export const SAFETY_LEVELS = ['Low','Medium','High','Critical'];
export const STATUSES = ['Available','In Use','Borrowed','Checked Out','In Transit','Under Maintenance','Under Repair','Repair','Lost','Missing','Retired'];
const assetSchema = new Schema({
 assetId: { type:String, unique:true, required:true }, name:{type:String,required:true},
 category:{type:String,default:'IT Equipment'}, type:{type:String,enum:TYPES,required:true}, clinicalArea:{type:String,enum:CLINICAL_AREAS,default:'IT'}, safetyLevel:{type:String,enum:SAFETY_LEVELS,default:'Medium'},
 brand:String, model:String,
 serialNumber:{type:String,index:true}, macAddress:String, cpu:String, ram:String, storage:String, os:String,
 purchaseDate:Date, warrantyExpiration:Date, floor:String, department:String, location:String,
 responsible:String, status:{type:String,enum:STATUSES,default:'Available'},
 lastPMDate:Date, nextPMDate:Date, repairCount:{type:Number,default:0}, notes:String,
 storageHealth:{type:Number,default:100,min:0,max:100}, ramUsage:{type:Number,default:30,min:0,max:100},
 cpuUsage:{type:Number,default:25,min:0,max:100}, issueCount:{type:Number,default:0},
 replacementCost:{type:Number,default:30000,min:0}, downtimeMinutes:{type:Number,default:0,min:0}, tagId:{type:String,index:true},
 photoUrl:{type:String,maxlength:5000000},photoName:String,photoMimeType:String,
 serialPhotoUrl:{type:String,maxlength:5000000},assetGroup:{type:String,default:'AST'},nextAction:String,
 retiredReason:String,retiredAt:Date,retiredBy:String,
 version:{type:Number,default:0}
}, options);
export const Asset = model('Asset',assetSchema);
export const User = model('User',new Schema({
 name:String,email:{type:String,unique:true},passwordHash:String,
 role:{type:String,enum:['Admin','IT Staff','Department User','Management']},department:String,
 isActive:{type:Boolean,default:true}
},options));
export const Movement = model('Movement',new Schema({
  asset:{type:Schema.Types.ObjectId,ref:'Asset',required:true}, assetId:String,
  action:String,method:String,actor:String,responsible:String,
  from:{floor:String,department:String,location:String},
  to:{floor:String,department:String,location:String},reason:String,status:String,
  transactionId:{type:Schema.Types.ObjectId,ref:'Transaction'}
 },options));
export const Transaction = model('Transaction',new Schema({
  transactionId:{type:String,unique:true,index:true}, type:{type:String,enum:['CHECKOUT','RETURN','MOVE'],required:true},
  borrower:{type:Schema.Types.ObjectId,ref:'User'}, borrowerName:String, actor:String,
  source:{floor:String,department:String,location:String}, destination:{floor:String,department:String,location:String},
  purpose:String, dueDate:Date, status:{type:String,enum:['OPEN','PARTIALLY_RETURNED','COMPLETED'],default:'OPEN'},
  assetCount:{type:Number,default:0}, returnedCount:{type:Number,default:0}
 },options));
export const TransactionItem = model('TransactionItem',new Schema({
  transaction:{type:Schema.Types.ObjectId,ref:'Transaction',required:true,index:true}, asset:{type:Schema.Types.ObjectId,ref:'Asset',required:true}, assetId:String,
  status:{type:String,enum:['CHECKED_OUT','RETURNED'],default:'CHECKED_OUT'}, returnedAt:Date
 },options));
export const PM = model('PM',new Schema({
 asset:{type:Schema.Types.ObjectId,ref:'Asset',required:true},assetId:String,date:Date,
 operator:String,checklist:[String],issues:String,software:String,macAddress:String,
 hardware:String,result:String,notes:String,nextPMDate:Date
},options));
export const Repair = model('Repair',new Schema({
 asset:{type:Schema.Types.ObjectId,ref:'Asset',required:true},assetId:String,date:Date,
 symptom:String,cause:String,resolution:String,cost:Number,operator:String,status:String,vendor:String,vendorContact:String,notes:String
},options));
const workOrderChecklistSchema = new Schema({ task:{type:String,required:true}, completed:{type:Boolean,default:false} },{_id:false});
export const WorkOrder = model('WorkOrder',new Schema({
 workOrderId:{type:String,unique:true,required:true,index:true},asset:{type:Schema.Types.ObjectId,ref:'Asset',required:true,index:true},assetId:{type:String,required:true,index:true},
 type:{type:String,enum:['PM','REPAIR','WARRANTY','INSPECTION'],required:true},title:{type:String,required:true},description:String,
 priority:{type:String,enum:['Low','Medium','High','Critical'],default:'Medium'},status:{type:String,enum:['OPEN','IN_PROGRESS','BLOCKED','COMPLETED','CANCELLED'],default:'OPEN'},
 assignedTo:String,dueDate:Date,checklist:[workOrderChecklistSchema],actualCost:{type:Number,default:0,min:0},resolution:String,
 completionResult:{type:String,enum:['Pass','Warning','Fail']},pmIntervalDays:{type:Number,min:1,max:730},sourceAlert:String,createdBy:String,completedAt:Date
},options));
export const Audit = model('Audit',new Schema({
 actor:String,action:String,assetId:String,before:Schema.Types.Mixed,after:Schema.Types.Mixed
},options));
export const Counter = model('Counter',new Schema({_id:String,value:Number}));
export const AssetGroup = model('AssetGroup',new Schema({prefix:{type:String,unique:true,required:true},name:{type:String,required:true}},options));
export const AssetCategory = model('AssetCategory',new Schema({name:{type:String,unique:true,required:true}},options));
export const Department = model('Department',new Schema({name:{type:String,unique:true,required:true}},options));
export const Location = model('Location',new Schema({name:{type:String,required:true},building:String,floor:String,department:String},options));
