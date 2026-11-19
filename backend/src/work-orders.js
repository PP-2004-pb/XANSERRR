import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Asset, Audit, Counter, PM, Repair, WorkOrder } from './models.js';
import { scope, staff } from './auth.js';

export const workOrders = Router();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const checklistEntry = z.object({ task: z.string().trim().min(1).max(200), completed: z.boolean().default(false) });
const workOrderInput = z.object({
    assetId: z.string().trim().min(1),
    type: z.enum(['PM', 'REPAIR', 'WARRANTY', 'INSPECTION']),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(1000).optional().default(''),
    priority: z.enum(['Low', 'Medium', 'High', 'Critical']).default('Medium'),
    assignedTo: z.string().trim().max(200).optional().default(''),
    dueDate: z.iso.datetime().optional(),
    sourceAlert: z.string().trim().max(40).optional().default('manual'),
    checklist: z.array(checklistEntry).min(1).max(30)
});
const workOrderPatch = z.object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']).optional(),
    assignedTo: z.string().trim().max(200).optional(),
    dueDate: z.iso.datetime().nullable().optional(),
    checklist: z.array(checklistEntry).max(30).optional(),
    checklistItem: z.object({ index: z.coerce.number().int().min(0).max(29), completed: z.boolean() }).optional(),
    actualCost: z.coerce.number().min(0).max(100000000).optional(),
    resolution: z.string().trim().max(2000).optional(),
    completionResult: z.enum(['Pass', 'Warning', 'Fail']).optional(),
    pmIntervalDays: z.coerce.number().int().min(1).max(730).optional()
}).strict();
const transitions = {
    OPEN: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['BLOCKED', 'COMPLETED', 'CANCELLED'],
    BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: []
};

workOrders.get('/', async (req, res) => {
    const assets = await Asset.find(scope(req.user)).select('_id').lean();
    const filter = { asset: { $in: assets.map(asset => asset._id) } };
    if (req.query.status && ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'].includes(req.query.status)) {
        filter.status = req.query.status;
    }
    res.json(await WorkOrder.find(filter).sort({ createdAt: -1 }).limit(300).lean());
});

workOrders.post('/', staff, async (req, res) => {
    const input = workOrderInput.parse(req.body);
    let created;
    await mongoose.connection.transaction(async session => {
        const asset = await Asset.findOne({ assetId: input.assetId, ...scope(req.user) }).session(session);
        if (!asset) throw fail('ไม่พบ Asset หรือไม่มีสิทธิ์เข้าถึง', 404);
        const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
        const counter = await Counter.findOneAndUpdate(
            { _id: `WO-${day}` },
            { $inc: { value: 1 } },
            { upsert: true, new: true, session }
        );
        const workOrderId = `WO-${day}-${String(counter.value).padStart(3, '0')}`;
        [created] = await WorkOrder.create([{
            ...input,
            asset: asset._id,
            workOrderId,
            createdBy: req.user.name,
            dueDate: input.dueDate ? new Date(input.dueDate) : undefined
        }], { session });
        await Audit.create([{
            actor: req.user.name,
            action: 'Create work order',
            assetId: asset.assetId,
            after: { workOrderId, type: input.type, title: input.title, dueDate: input.dueDate }
        }], { session });
    });
    res.status(201).json(created.toObject());
});

workOrders.patch('/:workOrderId', staff, async (req, res) => {
    const input = workOrderPatch.parse(req.body);
    if (!Object.keys(input).length) throw fail('ไม่มีข้อมูลสำหรับอัปเดต');
    let updated;
    await mongoose.connection.transaction(async session => {
        const order = await WorkOrder.findOne({ workOrderId: req.params.workOrderId }).session(session);
        if (!order) throw fail('ไม่พบ Work Order', 404);
        const asset = await Asset.findById(order.asset).session(session);
        if (!asset) throw fail('ไม่พบ Asset', 404);
        const before = order.toObject();
        if (input.status && input.status !== order.status && !transitions[order.status].includes(input.status)) {
            throw fail(`เปลี่ยนสถานะจาก ${order.status} เป็น ${input.status} ไม่ได้`, 409);
        }
        if (input.status === 'COMPLETED') {
            if (!input.resolution?.trim()) throw fail('กรุณาระบุผลการดำเนินงานก่อนปิดงาน');
            const checklist = input.checklist || order.checklist;
            if (!checklist.length || checklist.some(item => !item.completed)) throw fail('กรุณาทำ Checklist ให้ครบก่อนปิดงาน');
            const completedAt = new Date();
            if (order.type === 'PM') {
                const intervalDays = input.pmIntervalDays || order.pmIntervalDays || 180;
                const nextPMDate = new Date(completedAt.getTime() + intervalDays * 86400000);
                const result = input.completionResult || 'Pass';
                await PM.create([{
                    asset: asset._id,
                    assetId: asset.assetId,
                    date: completedAt,
                    operator: input.assignedTo || order.assignedTo || req.user.name,
                    checklist: checklist.map(item => item.task),
                    result,
                    notes: input.resolution,
                    nextPMDate
                }], { session });
                asset.lastPMDate = completedAt;
                asset.nextPMDate = nextPMDate;
                await asset.save({ session });
                order.pmIntervalDays = intervalDays;
                order.completionResult = result;
            } else if (order.type === 'REPAIR') {
                await Repair.create([{
                    asset: asset._id,
                    assetId: asset.assetId,
                    date: completedAt,
                    symptom: order.title,
                    resolution: input.resolution,
                    cost: input.actualCost ?? order.actualCost,
                    operator: input.assignedTo || order.assignedTo || req.user.name,
                    status: 'Completed'
                }], { session });
                asset.repairCount += 1;
                if (asset.status === 'Repair') {
                    asset.status = 'Available';
                    asset.nextAction = 'Ready for use';
                }
                await asset.save({ session });
            }
            order.completedAt = completedAt;
        }
        for (const [key, value] of Object.entries(input)) {
            if (key === 'checklistItem') {
                if (value.index >= order.checklist.length) throw fail('ไม่พบ Checklist item');
                order.checklist[value.index].completed = value.completed;
            } else {
                order[key] = value;
            }
        }
        await order.save({ session });
        await Audit.create([{
            actor: req.user.name,
            action: input.status === 'COMPLETED' ? 'Complete work order' : 'Update work order',
            assetId: asset.assetId,
            before,
            after: order.toObject()
        }], { session });
        updated = order.toObject();
    });
    res.json(updated);
});