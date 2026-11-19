import React, { useEffect, useState } from "react";
import { Check, ClipboardList, Pause, Play, Plus } from "lucide-react";

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:4000/api" : "/api");
const types = ["PM", "REPAIR", "WARRANTY", "INSPECTION"];
const priorities = ["Low", "Medium", "High", "Critical"];
const statusLabels = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("itam-token")}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};

const dueDateDefault = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16);
const emptyForm = () => ({
  assetId: "",
  type: "PM",
  title: "",
  description: "",
  priority: "Medium",
  assignedTo: "",
  dueDate: dueDateDefault(),
  checklist: "Inspect equipment\nTest operation\nRecord findings",
});

export default function WorkOrders({ user, draft, onDraftConsumed }) {
  const [orders, setOrders] = useState([]);
  const [closeoutDrafts, setCloseoutDrafts] = useState({});
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canManage = ["Admin", "IT Staff"].includes(user?.role);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request(`/work-orders${filter ? `?status=${encodeURIComponent(filter)}` : ""}`)
      .then((data) => {
        if (active) setOrders(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filter]);

  useEffect(() => {
    if (!draft) return;
    const type = draft.kind === "pm" ? "PM" : draft.kind === "warranty" ? "WARRANTY" : "INSPECTION";
    setForm({
      ...emptyForm(),
      assetId: draft.assetId || "",
      type,
      title: `${type} follow-up · ${draft.assetId || "Asset"}`,
      description: draft.message || "Created from an asset notification.",
      priority: draft.severity === "high" ? "High" : "Medium",
    });
    setCreateOpen(true);
    onDraftConsumed?.();
  }, [draft, onDraftConsumed]);

  const createOrder = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const checklist = form.checklist
        .split(/\r?\n/)
        .map((task) => task.trim())
        .filter(Boolean)
        .map((task) => ({ task, completed: false }));
      const created = await request("/work-orders", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
          checklist,
          sourceAlert: draft?.kind || "manual",
        }),
      });
      setOrders((current) => [created, ...current]);
      setFilter("");
      setCreateOpen(false);
      setForm(emptyForm());
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateOrder = async (order, patch) => {
    setError("");
    if (patch.checklistItem) {
      const { index, completed } = patch.checklistItem;
      setOrders((current) => current.map((item) => item.workOrderId === order.workOrderId
        ? { ...item, checklist: item.checklist.map((entry, itemIndex) => itemIndex === index ? { ...entry, completed } : entry) }
        : item));
    }
    try {
      const updated = await request(`/work-orders/${order.workOrderId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setOrders((current) => current.map((item) => item.workOrderId === updated.workOrderId
        ? { ...updated, checklist: item.checklist }
        : item));
    } catch (updateError) {
      setError(updateError.message);
      request(`/work-orders${filter ? `?status=${encodeURIComponent(filter)}` : ""}`).then(setOrders).catch(() => {});
    }
  };

  const editLocal = (workOrderId, patch) => {
    setOrders((current) => current.map((order) => order.workOrderId === workOrderId ? { ...order, ...patch } : order));
  };

  const editCloseout = (workOrderId, patch) => {
    setCloseoutDrafts((current) => ({ ...current, [workOrderId]: { ...current[workOrderId], ...patch } }));
  };

  const complete = (order) => {
    const closeout = closeoutDrafts[order.workOrderId] || {};
    return updateOrder(order, {
    status: "COMPLETED",
    resolution: closeout.resolution ?? order.resolution,
    actualCost: Number(closeout.actualCost ?? order.actualCost ?? 0),
    checklist: order.checklist,
    completionResult: closeout.completionResult ?? order.completionResult ?? "Pass",
    pmIntervalDays: Number(closeout.pmIntervalDays ?? order.pmIntervalDays ?? 180),
    }).then((updated) => {
      setCloseoutDrafts((current) => {
        const next = { ...current };
        delete next[order.workOrderId];
        return next;
      });
      return updated;
    });
  };

  const activeCount = orders.filter((order) => !["COMPLETED", "CANCELLED"].includes(order.status)).length;

  return (
    <div className="work-orders-page">
      <div className="section-intro">
        <div>
          <p className="eyebrow cyan-text">MAINTENANCE OPERATIONS</p>
          <h3>Work orders</h3>
          <p className="muted">Turn asset alerts into assigned work with a clear due date and closeout record.</p>
        </div>
        <div className="work-order-toolbar">
          <label className="work-order-filter">
            Status
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {canManage && <button className="primary" type="button" onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}><Plus size={16} /> Create work order</button>}
        </div>
      </div>
      <div className="work-order-summary"><ClipboardList size={16} /><span>{activeCount} active</span><span>{orders.length} shown</span></div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="loading">Loading work orders...</p> : orders.length ? (
        <div className="work-order-list">
          {orders.map((order) => {
            const terminal = ["COMPLETED", "CANCELLED"].includes(order.status);
            const allChecked = order.checklist.length > 0 && order.checklist.every((item) => item.completed);
            const overdue = order.dueDate && new Date(order.dueDate) < new Date() && !terminal;
            return (
              <article className="panel work-order-card" key={order.workOrderId}>
                <div className="work-order-heading">
                  <div className="work-order-tags">
                    <span className={`work-order-state state-${order.status.toLowerCase().replaceAll("_", "-")}`}>{statusLabels[order.status]}</span>
                    <span className={`work-order-priority priority-${order.priority.toLowerCase()}`}>{order.priority}</span>
                    <span className="work-order-type">{order.type}</span>
                  </div>
                  <b className="work-order-id">{order.workOrderId}</b>
                </div>
                <h4>{order.title}</h4>
                {order.description && <p className="muted">{order.description}</p>}
                <div className="work-order-meta">
                  <span>Asset <b>{order.assetId}</b></span>
                  <label>Assignee
                    {canManage && !terminal ? <input value={order.assignedTo || ""} placeholder="Assign technician" onChange={(event) => editLocal(order.workOrderId, { assignedTo: event.target.value })} onBlur={() => updateOrder(order, { assignedTo: order.assignedTo || "" })} /> : <b>{order.assignedTo || "Unassigned"}</b>}
                  </label>
                  <span className={overdue ? "work-order-overdue" : ""}>Due <b>{order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "No due date"}</b></span>
                </div>
                <div className="work-order-checklist">
                  <div className="work-order-checklist-head"><b>Checklist</b><small>{order.checklist.filter((item) => item.completed).length}/{order.checklist.length} complete</small></div>
                  {order.checklist.map((item, index) => (
                    <label className="work-order-check" key={`${order.workOrderId}-${index}`}>
                      <input type="checkbox" checked={item.completed} disabled={!canManage || terminal} onChange={() => updateOrder(order, { checklistItem: { index, completed: !item.completed } })} />
                      <span>{item.task}</span>
                    </label>
                  ))}
                </div>
                {canManage && !terminal && (
                  <div className="work-order-closeout">
                    <label>Closeout notes<input value={closeoutDrafts[order.workOrderId]?.resolution ?? order.resolution ?? ""} placeholder="What was checked or repaired?" onChange={(event) => editCloseout(order.workOrderId, { resolution: event.target.value })} /></label>
                    <label>Parts / labor cost<input type="number" min="0" step="0.01" value={closeoutDrafts[order.workOrderId]?.actualCost ?? order.actualCost ?? 0} onChange={(event) => editCloseout(order.workOrderId, { actualCost: event.target.value })} /></label>
                    {order.type === "PM" && <label>PM result<select value={closeoutDrafts[order.workOrderId]?.completionResult ?? order.completionResult ?? "Pass"} onChange={(event) => editCloseout(order.workOrderId, { completionResult: event.target.value })}><option>Pass</option><option>Warning</option><option>Fail</option></select></label>}
                  </div>
                )}
                {order.resolution && terminal && <p className="work-order-resolution"><Check size={15} /> {order.resolution}{order.actualCost > 0 && <span> · {Number(order.actualCost).toLocaleString()} cost</span>}</p>}
                {canManage && !terminal && (
                  <div className="form-actions work-order-actions">
                    {order.status === "OPEN" && <button className="ghost" type="button" onClick={() => updateOrder(order, { status: "IN_PROGRESS" })}><Play size={14} /> Start</button>}
                    {order.status === "IN_PROGRESS" && <button className="ghost" type="button" onClick={() => updateOrder(order, { status: "BLOCKED" })}><Pause size={14} /> Block</button>}
                    {order.status === "BLOCKED" && <button className="ghost" type="button" onClick={() => updateOrder(order, { status: "IN_PROGRESS" })}><Play size={14} /> Resume</button>}
                    <button className="primary" type="button" disabled={order.status !== "IN_PROGRESS" || !(closeoutDrafts[order.workOrderId]?.resolution ?? order.resolution)?.trim() || !allChecked} onClick={() => complete(order)}><Check size={15} /> Complete work order</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : <section className="panel empty-work-orders"><ClipboardList size={22} /><b>No work orders yet</b><span>Create one from an asset alert or start a planned PM task.</span></section>}

      {createOpen && canManage && (
        <div className="modal-backdrop" onClick={() => !saving && setCreateOpen(false)}>
          <form className="modal asset-form work-order-modal" role="dialog" aria-modal="true" aria-labelledby="work-order-create-title" onClick={(event) => event.stopPropagation()} onSubmit={createOrder}>
            <button type="button" className="close" aria-label="Close" onClick={() => setCreateOpen(false)}>×</button>
            <p className="eyebrow">ASSIGNED MAINTENANCE</p>
            <h3 id="work-order-create-title">Create work order</h3>
            <div className="form-grid">
              <label>Asset ID<input required value={form.assetId} onChange={(event) => setForm({ ...form, assetId: event.target.value })} placeholder="AST-001" /></label>
              <label>Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="work-order-full">Title<input required minLength={3} maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
              <label>Priority<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{priorities.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
              <label>Assignee<input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} placeholder="Technician name" /></label>
              <label>Due date<input type="datetime-local" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></label>
              <label className="work-order-full">Description<textarea rows="2" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <label className="work-order-full">Checklist <small>One task per line</small><textarea rows="4" required value={form.checklist} onChange={(event) => setForm({ ...form, checklist: event.target.value })} /></label>
            </div>
            {error && <p className="error">{error}</p>}
            <div className="form-actions"><button className="ghost" type="button" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Creating..." : "Create work order"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
