import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-jwt-secret-value-with-more-than-32-characters';
delete process.env.MONGODB_URI;

const [{ app }, { tokenFor }, { closeDB, connectDB }, { Asset, Audit, Movement, PM, Repair, Transaction, TransactionItem, User, WorkOrder }] = await Promise.all([
    import('../src/app.js'),
    import('../src/auth.js'),
    import('../src/db.js'),
    import('../src/models.js')
]);

const users = {};
const tokens = {};

before(async () => {
    await connectDB();
    const createdUsers = await User.create([
        { name: 'Test Admin', email: 'admin@test.local', role: 'Admin', department: 'IT' },
        { name: 'Accounting User', email: 'accounting@test.local', role: 'Department User', department: 'Accounting' },
        { name: 'HR User', email: 'hr@test.local', role: 'Department User', department: 'HR' },
        { name: 'Public Viewer', email: 'viewer@test.local', role: 'Management', department: 'Management' }
    ]);
    [users.admin, users.accounting, users.hr, users.viewer] = createdUsers;
    for (const [role, user] of Object.entries(users)) tokens[role] = tokenFor(user);
    await Asset.create([
        { assetId: 'AST-ACC-001', name: 'Accounting laptop', type: 'Laptop', department: 'Accounting', floor: '2', location: 'Store', status: 'Available' },
        { assetId: 'AST-HR-001', name: 'HR laptop', type: 'Laptop', department: 'HR', floor: '3', location: 'Store', status: 'Available' }
    ]);
});

after(async () => {
    await closeDB();
});

const asUser = role => `Bearer ${tokens[role]}`;

test('department users only see assets from their own department', async () => {
    const response = await request(app)
        .get('/api/assets')
        .set('Authorization', asUser('accounting'))
        .expect(200);

    assert.deepEqual(response.body.map(asset => asset.assetId), ['AST-ACC-001']);
});

test('asset listing filters and paginates on the server without widening department scope', async () => {
    const firstPage = await request(app)
        .get('/api/assets?page=1&limit=1')
        .set('Authorization', asUser('accounting'))
        .expect(200);

    assert.equal(firstPage.body.total, 1);
    assert.equal(firstPage.body.pages, 1);
    assert.equal(firstPage.body.items.length, 1);
    assert.equal(firstPage.body.items[0].assetId, 'AST-ACC-001');

    const adminFirstPage = await request(app)
        .get('/api/assets?page=1&limit=1')
        .set('Authorization', asUser('admin'))
        .expect(200);
    const adminSecondPage = await request(app)
        .get('/api/assets?page=2&limit=1')
        .set('Authorization', asUser('admin'))
        .expect(200);
    assert.equal(adminFirstPage.body.total, 2);
    assert.equal(adminFirstPage.body.pages, 2);
    assert.equal(adminSecondPage.body.items.length, 1);
    assert.notEqual(adminFirstPage.body.items[0].assetId, adminSecondPage.body.items[0].assetId);

    const literalSearch = await request(app)
        .get('/api/assets?q=.*&page=1&limit=1')
        .set('Authorization', asUser('accounting'))
        .expect(200);
    assert.equal(literalSearch.body.total, 0);
    assert.deepEqual(literalSearch.body.items, []);
});

test('asset listing supports database-side text filters and retains legacy array response', async () => {
    const filtered = await request(app)
        .get('/api/assets?q=Accounting&category=IT%20Equipment&page=1&limit=10')
        .set('Authorization', asUser('accounting'))
        .expect(200);
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.items[0].assetId, 'AST-ACC-001');

    const legacy = await request(app)
        .get('/api/assets?q=Accounting')
        .set('Authorization', asUser('accounting'))
        .expect(200);
    assert.ok(Array.isArray(legacy.body));
    assert.deepEqual(legacy.body.map(asset => asset.assetId), ['AST-ACC-001']);
});

test('public demo grants anonymous read-only access as Management', async () => {
    const previousPublicDemo = process.env.PUBLIC_DEMO;
    process.env.PUBLIC_DEMO = 'true';
    try {
        const me = await request(app).get('/api/auth/me').expect(200);
        assert.equal(me.body.email, 'viewer@test.local');
        assert.equal(me.body.role, 'Management');

        const assets = await request(app).get('/api/assets').expect(200);
        assert.equal(assets.body.length, 2);

        await request(app).post('/api/assets').send({}).expect(403);
        await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'anything' }).expect(403);
    } finally {
        if (previousPublicDemo === undefined) delete process.env.PUBLIC_DEMO;
        else process.env.PUBLIC_DEMO = previousPublicDemo;
    }
});

test('notification alerts cover PM, warranty, overdue checkout and department scope', async () => {
    const expiresSoon = new Date(Date.now() + 10 * 86400000);
    const asset = await Asset.findOne({ assetId: 'AST-ACC-001' });
    await Asset.updateMany({}, { $set: { nextPMDate: expiresSoon, warrantyExpiration: expiresSoon } });
    asset.status = 'Borrowed';
    await asset.save();
    const [overdueTransaction] = await Transaction.create([{
        transactionId: 'TRX-OVERDUE-TEST', type: 'CHECKOUT', borrower: users.accounting._id,
        borrowerName: users.accounting.name, actor: users.accounting.name, dueDate: new Date(Date.now() - 3 * 86400000),
        assetCount: 1, returnedCount: 0, status: 'OPEN'
    }]);
    await TransactionItem.create({ transaction: overdueTransaction._id, asset: asset._id, assetId: asset.assetId });

    const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', asUser('accounting'))
        .expect(200);

    assert.deepEqual([...new Set(response.body.map(alert => alert.assetId))], ['AST-ACC-001']);
    assert.ok(response.body.some(alert => alert.kind === 'pm' && alert.assetId === 'AST-ACC-001'));
    assert.ok(response.body.some(alert => alert.kind === 'warranty' && alert.assetId === 'AST-ACC-001'));
    const overdueAlert = response.body.find(alert => alert.kind === 'overdue');
    assert.equal(overdueAlert.transactionId, 'TRX-OVERDUE-TEST');
    assert.equal(overdueAlert.daysOverdue, 3);

    const hrResponse = await request(app).get('/api/notifications').set('Authorization', asUser('hr')).expect(200);
    assert.equal(hrResponse.body.some(alert => alert.kind === 'overdue'), false);
    asset.status = 'Available';
    await asset.save();
    await TransactionItem.deleteMany({ transaction: overdueTransaction._id });
    await Transaction.deleteOne({ _id: overdueTransaction._id });
});

test('department users cannot create assets or access another department asset', async () => {
    await request(app)
        .post('/api/assets')
        .set('Authorization', asUser('accounting'))
        .send({})
        .expect(403);

    await request(app)
        .get('/api/assets/AST-HR-001')
        .set('Authorization', asUser('accounting'))
        .expect(404);

    await request(app)
        .post('/api/transactions/checkout')
        .set('Authorization', asUser('accounting'))
        .send({
            assetIds: ['AST-HR-001'],
            destination: { floor: '2', department: 'Accounting', location: 'Desk' },
            purpose: 'Cross-department access test'
        })
        .expect(404);

    await request(app)
        .post('/api/transactions/checkout')
        .set('Authorization', asUser('accounting'))
        .send({
            assetIds: ['AST-ACC-001'],
            destination: { floor: '3', department: 'HR', location: 'Desk' },
            purpose: 'Cross-department destination test'
        })
        .expect(403);
});

test('asset import preview validates every row and commit is atomic', async () => {
    const validRow = {
        assetGroup: 'AST', name: 'Imported test laptop', category: 'IT Equipment', type: 'Laptop',
        clinicalArea: 'IT', safetyLevel: 'Medium', serialNumber: 'IMPORT-TEST-001', tagId: 'IMPORT-TAG-001',
        floor: '2', department: 'Accounting', location: 'Import room', status: 'Available'
    };
    const invalidRow = { ...validRow, name: 'Invalid imported asset', type: 'Unknown' };
    const beforeCount = await Asset.countDocuments();

    await request(app)
        .post('/api/assets/import/preview')
        .set('Authorization', asUser('accounting'))
        .send({ rows: [validRow] })
        .expect(403);

    const preview = await request(app)
        .post('/api/assets/import/preview')
        .set('Authorization', asUser('admin'))
        .send({ rows: [validRow, invalidRow] })
        .expect(200);
    assert.equal(preview.body.rowCount, 2);
    assert.equal(preview.body.validRows, 1);
    assert.equal(preview.body.errors[0].row, 3);

    const rejected = await request(app)
        .post('/api/assets/import')
        .set('Authorization', asUser('admin'))
        .send({ rows: [validRow, invalidRow] })
        .expect(400);
    assert.equal(rejected.body.issues[0].row, 3);
    assert.equal(await Asset.countDocuments(), beforeCount);

    const imported = await request(app)
        .post('/api/assets/import')
        .set('Authorization', asUser('admin'))
        .send({ rows: [validRow] })
        .expect(201);
    assert.equal(imported.body.count, 1);
    assert.match(imported.body.created[0].assetId, /^AST-/);
    assert.equal(await Asset.countDocuments(), beforeCount + 1);
    assert.equal(await Audit.countDocuments({ assetId: imported.body.created[0].assetId, action: 'Import asset' }), 1);
});

test('work orders enforce scope and close PM/repair work with audit side effects', async () => {
    await request(app)
        .post('/api/work-orders')
        .set('Authorization', asUser('accounting'))
        .send({ assetId: 'AST-ACC-001', type: 'PM', title: 'Unauthorized PM', checklist: [{ task: 'Inspect' }] })
        .expect(403);

    const createdPM = await request(app)
        .post('/api/work-orders')
        .set('Authorization', asUser('admin'))
        .send({
            assetId: 'AST-ACC-001',
            type: 'PM',
            title: 'Quarterly inspection',
            priority: 'High',
            assignedTo: 'IT Staff Demo',
            dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
            checklist: [{ task: 'Inspect device' }, { task: 'Test safety' }]
        })
        .expect(201);
    const pmOrderId = createdPM.body.workOrderId;

    const accountingOrders = await request(app)
        .get('/api/work-orders')
        .set('Authorization', asUser('accounting'))
        .expect(200);
    assert.ok(accountingOrders.body.some(order => order.workOrderId === pmOrderId));
    const hrOrders = await request(app)
        .get('/api/work-orders')
        .set('Authorization', asUser('hr'))
        .expect(200);
    assert.equal(hrOrders.body.some(order => order.workOrderId === pmOrderId), false);

    await request(app)
        .patch(`/api/work-orders/${pmOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ status: 'IN_PROGRESS', assignedTo: 'Assigned Technician' })
        .expect(200);
    await request(app)
        .patch(`/api/work-orders/${pmOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ checklistItem: { index: 0, completed: true } })
        .expect(200);
    await request(app)
        .patch(`/api/work-orders/${pmOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ status: 'COMPLETED', resolution: 'Inspection completed' })
        .expect(400);
    const secondChecklistUpdate = await request(app)
        .patch(`/api/work-orders/${pmOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ checklistItem: { index: 1, completed: true } })
        .expect(200);
    assert.deepEqual(secondChecklistUpdate.body.checklist.map(item => item.completed), [true, true]);

    const completedPM = await request(app)
        .patch(`/api/work-orders/${pmOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({
            status: 'COMPLETED',
            resolution: 'Inspection completed; safety tests passed',
            completionResult: 'Pass',
            pmIntervalDays: 180
        })
        .expect(200);
    assert.equal(completedPM.body.status, 'COMPLETED');
    assert.equal(await PM.countDocuments({ assetId: 'AST-ACC-001' }), 1);
    assert.ok((await Asset.findOne({ assetId: 'AST-ACC-001' })).nextPMDate > new Date());
    assert.equal(await Audit.countDocuments({ assetId: 'AST-ACC-001', action: 'Complete work order' }), 1);

    const repairAsset = await Asset.findOne({ assetId: 'AST-HR-001' });
    repairAsset.status = 'Repair';
    await repairAsset.save();
    const repair = await request(app)
        .post('/api/work-orders')
        .set('Authorization', asUser('admin'))
        .send({ assetId: 'AST-HR-001', type: 'REPAIR', title: 'Replace failed power supply', checklist: [{ task: 'Replace part' }] })
        .expect(201);
    await request(app)
        .patch(`/api/work-orders/${repair.body.workOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
    await request(app)
        .patch(`/api/work-orders/${repair.body.workOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ checklistItem: { index: 0, completed: true } })
        .expect(200);
    await request(app)
        .patch(`/api/work-orders/${repair.body.workOrderId}`)
        .set('Authorization', asUser('admin'))
        .send({ status: 'COMPLETED', resolution: 'Power supply replaced', actualCost: 1250 })
        .expect(200);
    assert.equal(await Repair.countDocuments({ assetId: 'AST-HR-001', cost: 1250 }), 1);
    assert.equal((await Asset.findOne({ assetId: 'AST-HR-001' })).status, 'Available');
    assert.equal(await WorkOrder.countDocuments({ status: 'COMPLETED' }), 2);
});

test('checkout and return update asset, transaction, movement, and audit records', async () => {
    const checkout = await request(app)
        .post('/api/transactions/checkout')
        .set('Authorization', asUser('accounting'))
        .send({
            assetIds: ['AST-ACC-001'],
            destination: { floor: '2', department: 'Accounting', location: 'Accounts desk' },
            purpose: 'Workflow integration test'
        })
        .expect(201);

    assert.equal(checkout.body.type, 'CHECKOUT');
    assert.equal(checkout.body.status, 'OPEN');
    assert.equal(checkout.body.assetCount, 1);

    await request(app)
        .get(`/api/transactions/${checkout.body.transactionId}`)
        .set('Authorization', asUser('hr'))
        .expect(403);

    const checkedOutAsset = await Asset.findOne({ assetId: 'AST-ACC-001' }).lean();
    assert.equal(checkedOutAsset.status, 'Borrowed');

    const returned = await request(app)
        .post('/api/transactions/return')
        .set('Authorization', asUser('accounting'))
        .send({
            transactionId: checkout.body.transactionId,
            assetIds: ['AST-ACC-001'],
            reason: 'Workflow integration test return'
        })
        .expect(201);

    assert.equal(returned.body.originalTransaction.status, 'COMPLETED');
    assert.equal(returned.body.originalTransaction.returnedCount, 1);
    assert.equal((await Asset.findOne({ assetId: 'AST-ACC-001' })).status, 'Available');
    assert.equal(await TransactionItem.countDocuments({ assetId: 'AST-ACC-001', status: 'RETURNED' }), 2);
    assert.deepEqual(
        (await Movement.find({ assetId: 'AST-ACC-001' }).sort({ createdAt: 1 }).distinct('action')),
        ['CHECKOUT', 'RETURN']
    );
    const auditActions = await Audit.find({ assetId: 'AST-ACC-001' }).distinct('action');
    assert.ok(auditActions.includes('CHECKOUT'));
    assert.ok(auditActions.includes('RETURN'));

    const original = await Transaction.findOne({ transactionId: checkout.body.transactionId }).lean();
    assert.equal(original.status, 'COMPLETED');
});

test('the last active admin cannot deactivate their account', async () => {
    await request(app)
        .patch(`/api/users/${users.admin._id}`)
        .set('Authorization', asUser('admin'))
        .send({ isActive: false })
        .expect(400);

    const admin = await User.findById(users.admin._id).lean();
    assert.equal(admin.isActive, true);
});