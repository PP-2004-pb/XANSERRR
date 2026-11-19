import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Asset, Audit, Counter, Movement, Transaction, TransactionItem, User } from './models.js';
import { roles, scope } from './auth.js';

export const transactions = Router();
const location = z.object({ floor: z.string().trim().min(1), department: z.string().trim().min(1), location: z.string().trim().min(1) });
const checkoutInput = z.object({
  assetIds: z.array(z.string().trim().min(1)).min(1).max(100), destination: location,
  purpose: z.string().trim().min(1).max(1000), dueDate: z.string().datetime().optional(), borrowerId: z.string().optional()
});
const returnInput = z.object({ transactionId: z.string().trim().min(1), assetIds: z.array(z.string().trim().min(1)).min(1).max(100), destination: location.optional(), reason: z.string().trim().min(1).max(1000).default('คืนอุปกรณ์') });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function nextTransactionId(session) {
  const now = new Date();
  const prefix = `TRX-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const counter = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { value: 1 } }, { upsert: true, new: true, session });
  return `${prefix}-${String(counter.value).padStart(3, '0')}`;
}
const currentLocation = asset => ({ floor: asset.floor, department: asset.department, location: asset.location });

transactions.get('/', async (req, res) => {
  const rows = await Transaction.find(req.user.role === 'Department User' ? { borrower: req.user._id } : {}).sort({ createdAt: -1 }).limit(200).lean();
  res.json(rows);
});

transactions.get('/:id', async (req, res) => {
  const trx = await Transaction.findOne({ transactionId: req.params.id }).lean();
  if (!trx) throw fail('ไม่พบ Transaction', 404);
  if(req.user.role==='Department User'&&String(trx.borrower)!==String(req.user._id))throw fail('ไม่มีสิทธิ์เข้าถึง Transaction',403);
  const items = await TransactionItem.find({ transaction: trx._id }).lean();
  res.json({ ...trx, items });
});

transactions.post('/checkout', roles('Admin', 'IT Staff', 'Department User'), async (req, res) => {
  const input = checkoutInput.parse(req.body);
  const ids = [...new Set(input.assetIds)];
  if(ids.length!==input.assetIds.length)throw fail('มี Asset ซ้ำในรายการ');
  if(req.user.role==='Department User'&&ids.length!==1)throw fail('ผู้ใช้งานแผนกยืมได้ครั้งละ 1 Asset',403);
  let result;
  await mongoose.connection.transaction(async session => {
    const query = { assetId: { $in: ids }, ...scope(req.user) };
    const assets = await Asset.find(query).session(session);
    if (assets.length !== ids.length) throw fail('มี Asset ไม่พบหรือไม่มีสิทธิ์เข้าถึง', 404);
    if (assets.some(a => a.status !== 'Available')) throw fail('Asset บางรายการไม่พร้อมให้ยืม', 409);
    const borrower = input.borrowerId ? await User.findById(input.borrowerId).session(session) : req.user;
    if (!borrower||borrower.isActive===false) throw fail('ไม่พบผู้รับผิดชอบ', 404);
    if(req.user.role==='Department User'&&(String(borrower._id)!==String(req.user._id)||input.destination.department!==req.user.department))throw fail('ไม่สามารถยืมหรือย้ายข้ามแผนก',403);
    const transactionId = await nextTransactionId(session);
    const source = currentLocation(assets[0]);
    const [trx] = await Transaction.create([{ transactionId, type: 'CHECKOUT', borrower: borrower._id, borrowerName: borrower.name, actor: req.user.name, source, destination: input.destination, purpose: input.purpose, dueDate: input.dueDate ? new Date(input.dueDate) : undefined, assetCount: assets.length }], { session });
    await TransactionItem.insertMany(assets.map(asset => ({ transaction: trx._id, asset: asset._id, assetId: asset.assetId })), { session });
    for (const asset of assets) {
      const from = currentLocation(asset);
      asset.status = 'Borrowed'; asset.nextAction='Waiting for return'; Object.assign(asset, input.destination, { responsible: borrower.name }); asset.version++;
      await asset.save({ session });
      await Movement.create([{ asset: asset._id, assetId: asset.assetId, action: 'CHECKOUT', method: 'QR', actor: req.user.name, responsible: borrower.name, from, to: input.destination, reason: input.purpose, status: asset.status, transactionId: trx._id }], { session });
      await Audit.create([{ actor: req.user.name, action: 'CHECKOUT', assetId: asset.assetId, after: { transactionId, destination: input.destination, responsible: borrower.name }}], { session });
    }
    result = await Transaction.findById(trx._id).session(session).lean();
  });
  res.status(201).json(result);
});

transactions.post('/return', roles('Admin', 'IT Staff', 'Department User'), async (req, res) => {
  const input = returnInput.parse(req.body);
  if(req.user.role==='Department User'&&input.assetIds.length!==1)throw fail('ผู้ใช้งานแผนกคืนได้ครั้งละ 1 Asset',403);
  let result;
  await mongoose.connection.transaction(async session => {
    const original = await Transaction.findOne({ transactionId: input.transactionId }).session(session);
    if (!original||original.type!=='CHECKOUT') throw fail('ไม่พบ Transaction ต้นทาง', 404);
    if(req.user.role==='Department User'&&String(original.borrower)!==String(req.user._id))throw fail('ไม่มีสิทธิ์คืน Transaction นี้',403);
    if(req.user.role==='Department User'&&input.destination&&input.destination.department!==req.user.department&&input.destination.department!==original.source?.department)throw fail('ไม่สามารถคืนไปแผนกอื่น',403);
    const items = await TransactionItem.find({ transaction: original._id, assetId: { $in: [...new Set(input.assetIds)] }, status: 'CHECKED_OUT' }).session(session);
    if (items.length !== new Set(input.assetIds).size) throw fail('Asset บางรายการไม่ได้อยู่ใน Transaction หรือถูกคืนแล้ว', 409);
    const assets = await Asset.find({ _id: { $in: items.map(i => i.asset) } }).session(session);
    if (assets.length !== items.length||assets.some(a=>a.status!=='Borrowed'||req.user.role==='Department User'&&a.department!==req.user.department)) throw fail('Asset ไม่อยู่ในสถานะยืมหรือไม่มีสิทธิ์คืน', 409);
    const returnId = await nextTransactionId(session);
    const [returnTrx] = await Transaction.create([{ transactionId: returnId, type: 'RETURN', borrower: original.borrower, borrowerName: original.borrowerName, actor: req.user.name, source: original.destination, destination: input.destination || original.source, purpose: input.reason, assetCount: assets.length, returnedCount: assets.length, status: 'COMPLETED' }], { session });
    for (const item of items) {
      const asset = assets.find(a => String(a._id) === String(item.asset));
      const from = currentLocation(asset); const to = input.destination || original.source;
      asset.status = 'Available';asset.nextAction='Ready for use'; Object.assign(asset, to, { responsible: '' }); asset.version++; await asset.save({ session });
      item.status = 'RETURNED'; item.returnedAt = new Date(); await item.save({ session });
      await Movement.create([{ asset: asset._id, assetId: asset.assetId, action: 'RETURN', method: 'QR', actor: req.user.name, responsible: original.borrowerName, from, to, reason: input.reason, status: asset.status, transactionId: returnTrx._id }], { session });
      await Audit.create([{ actor: req.user.name, action: 'RETURN', assetId: asset.assetId, after: { transactionId: returnId, originalTransactionId: original.transactionId }}], { session });
    }
    original.returnedCount += items.length; original.status = original.returnedCount >= original.assetCount ? 'COMPLETED' : 'PARTIALLY_RETURNED'; await original.save({ session });
    await TransactionItem.insertMany(items.map(item=>({transaction:returnTrx._id,asset:item.asset,assetId:item.assetId,status:'RETURNED',returnedAt:new Date()})),{session});
    result = { transaction: await Transaction.findById(returnTrx._id).session(session).lean(), originalTransaction: original.toObject(), items: items.map(i => i.assetId) };
  });
  res.status(201).json(result);
});
