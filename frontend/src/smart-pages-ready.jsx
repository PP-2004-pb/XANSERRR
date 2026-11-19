import React, { useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Download, FileUp } from "lucide-react";
import Papa from "papaparse";
import { QRCodeSVG } from "qrcode.react";
const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api";
export async function api(path, options = {}) {
  const r = await fetch(API + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("itam-token")}`,
      },
    }),
    d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
}
const displayDate = (d) => (d ? new Date(d).toLocaleString("th-TH") : "—"),
  next = {
    Available: "Ready for use",
    Borrowed: "Waiting for return",
    "In Use": "Continue assigned use",
    Repair: "Waiting for vendor / repair completion",
    Retired: "Dispose / decommission",
  };
export function Badge({ status }) {
  return (
    <span
      className={
        "asset-badge badge-" +
        String(status || "unknown")
          .toLowerCase()
          .replaceAll(" ", "-")
      }
    >
      {status}
    </span>
  );
}
export function AssetDetail({ id, onClose, onCheckout, onReturn, staff }) {
  const [asset, setAsset] = useState(null),
    [events, setEvents] = useState([]),
    [tab, setTab] = useState(false),
    [error, setError] = useState(""),
    [action, setAction] = useState(""),
    [reason, setReason] = useState(""),
    [vendor, setVendor] = useState("");
  const reload = () =>
    api(`/assets/${encodeURIComponent(id)}`)
      .then(setAsset)
      .catch((e) => setError(e.message));
  useEffect(() => {
    reload();
  }, [id]);
  useEffect(() => {
    if (tab)
      api(`/assets/${encodeURIComponent(id)}/history`)
        .then(setEvents)
        .catch((e) => setError(e.message));
  }, [id, tab]);
  const save = async (e) => {
    e.preventDefault();
    try {
      const path =
          action === "Retire"
            ? "retire"
            : action === "Repair"
              ? "repairs"
              : "movements",
        data =
          action === "Retire"
            ? { reason }
            : action === "Repair"
              ? {
                  date: new Date().toISOString().slice(0, 10),
                  symptom: reason,
                  status: "Open",
                  cost: 0,
                  vendor,
                }
              : {
                  action: "Move",
                  floor: asset.floor,
                  department: asset.department,
                  location: reason,
                  responsible: asset.responsible || "IT",
                  reason,
                  method: "Manual",
                };
      await api(`/assets/${encodeURIComponent(id)}/${path}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setAction("");
      setReason("");
      reload();
    } catch (x) {
      setError(x.message);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal smart-detail" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        {error && <p className="error">{error}</p>}
        {!asset ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="detail-top">
              <div>
                <p className="eyebrow">ASSET IDENTITY</p>
                <h3>
                  {asset.assetId} · {asset.name}
                </h3>
                <Badge status={asset.status} />
              </div>
              <QRCodeSVG
                value={`${location.origin}/asset/${asset.assetId}`}
                size={80}
              />
            </div>
            <div className="detail-tabs">
              <button onClick={() => setTab(false)}>Information</button>
              <button onClick={() => setTab(true)}>View history</button>
            </div>
            {!tab ? (
              <>
                <div className="detail-pictures">
                  {asset.photoUrl ? (
                    <img src={asset.photoUrl} alt="Asset" />
                  ) : (
                    <div className="photo-placeholder">No photo</div>
                  )}
                  {asset.serialPhotoUrl && (
                    <img src={asset.serialPhotoUrl} alt="Serial area" />
                  )}
                </div>
                <div className="detail-grid">
                  {[
                    [
                      "Asset group",
                      asset.assetGroup || asset.assetId.split("-")[0],
                    ],
                    ["Category", asset.category],
                    [
                      "Brand / model",
                      [asset.brand, asset.model].filter(Boolean).join(" "),
                    ],
                    ["Serial number", asset.serialNumber],
                    [
                      "Location",
                      `${asset.floor || ""} ${asset.location || ""}`,
                    ],
                    ["Department", asset.department],
                    ["Current user", asset.responsible],
                    ["Status", asset.status],
                    ["Next action", asset.nextAction || next[asset.status]],
                    ["Purchase date", displayDate(asset.purchaseDate)],
                    ["Warranty", displayDate(asset.warrantyExpiration)],
                    ["Retirement reason", asset.retiredReason],
                  ].map(([k, v]) => (
                    <span key={k}>
                      {k}
                      <b>{v || "—"}</b>
                    </span>
                  ))}
                </div>
                <div className="quick-actions">
                  <button
                    className="primary"
                    disabled={asset.status !== "Available"}
                    onClick={() => onCheckout(asset)}
                  >
                    Checkout
                  </button>
                  <button
                    className="ghost"
                    disabled={asset.status !== "Borrowed"}
                    onClick={() => onReturn(asset)}
                  >
                    Return
                  </button>
                  {staff && (
                    <>
                      <button
                        className="ghost"
                        disabled={asset.status === "Retired"}
                        onClick={() => {
                          setAction("Move");
                          setReason(asset.location || "");
                        }}
                      >
                        Move
                      </button>
                      <button
                        className="ghost"
                        disabled={["Retired", "Borrowed"].includes(
                          asset.status,
                        )}
                        onClick={() => setAction("Repair")}
                      >
                        Repair
                      </button>
                      <button
                        className="ghost"
                        disabled={["Retired", "Borrowed"].includes(
                          asset.status,
                        )}
                        onClick={() => setAction("Retire")}
                      >
                        Retire
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="asset-history">
                {events.length ? (
                  events.map((x, i) => (
                    <article key={x._id || i}>
                      <small>{displayDate(x.date)}</small>
                      <b>{x.action || x.kind}</b>
                      <p>
                        {x.from?.location || "—"} → {x.to?.location || "—"} ·{" "}
                        {x.to?.department || asset.department}
                      </p>
                      <small>
                        {x.actor || x.operator || "—"} · {x.transactionId || ""}{" "}
                        · {x.reason || x.symptom || ""}
                      </small>
                    </article>
                  ))
                ) : (
                  <p>No history yet.</p>
                )}
              </div>
            )}
            {action && (
              <form className="action-form" onSubmit={save}>
                <h4>
                  {action} {asset.assetId}
                </h4>
                {action === "Repair" && (
                  <label>
                    Vendor
                    <input
                      required
                      value={vendor}
                      onChange={(e) => setVendor(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  {action === "Retire"
                    ? "Retirement reason"
                    : action === "Move"
                      ? "New location"
                      : "Problem description"}
                  <input
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button className="primary">Confirm {action}</button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setAction("")}
                >
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
export function Inventory({ user, onCheckout, onReturn }) {
  const [items, setItems] = useState([]),
    [groups, setGroups] = useState([]),
    [categories, setCategories] = useState([]),
    [filters, setFilters] = useState({
      q: "",
      group: "",
      category: "",
      department: "",
      location: "",
      filter: "",
    }),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [importReview, setImportReview] = useState(null),
    [importBusy, setImportBusy] = useState(false),
    [sortBy, setSortBy] = useState("assetId"),
    [sortDirection, setSortDirection] = useState("asc");
  const importInput = useRef(null);
  const staff = ["Admin", "IT Staff"].includes(user.role);
  useEffect(() => {
    api("/assets?" + new URLSearchParams(filters))
      .then(setItems)
      .catch((e) => setError(e.message));
  }, [JSON.stringify(filters)]);
  useEffect(() => {
    Promise.all([api("/catalog/groups"), api("/catalog/categories")])
      .then(([g, c]) => {
        setGroups(g);
        setCategories(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  const set = (e) =>
    setFilters((f) => ({ ...f, [e.target.name]: e.target.value }));
  const sortedItems = [...items].sort((a, b) => {
    const leftValue = sortBy === "group" ? a.assetGroup || a.assetId.split("-")[0] : a[sortBy];
    const rightValue = sortBy === "group" ? b.assetGroup || b.assetId.split("-")[0] : b[sortBy];
    const left = String(leftValue ?? "").toLocaleLowerCase();
    const right = String(rightValue ?? "").toLocaleLowerCase();
    return left.localeCompare(right, undefined, { numeric: true }) * (sortDirection === "asc" ? 1 : -1);
  });
  const exportCsv = () => {
    const fields = [
      "assetId", "assetGroup", "name", "category", "type", "clinicalArea", "safetyLevel",
      "brand", "model", "serialNumber", "macAddress", "cpu", "ram", "storage", "os",
      "purchaseDate", "warrantyExpiration", "floor", "department", "location", "responsible",
      "status", "lastPMDate", "nextPMDate", "storageHealth", "ramUsage", "cpuUsage",
      "replacementCost", "downtimeMinutes", "tagId", "notes"
    ];
    const data = sortedItems.map((asset) =>
      Object.fromEntries(fields.map((field) => [field, asset[field] ?? ""]))
    );
    const csv = Papa.unparse({ fields, data }, { escapeFormulae: true });
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `smart-itam-assets-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const previewImport = (file) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("CSV file must be 5 MB or smaller");
      return;
    }
    setError("");
    setImportBusy(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim(),
      complete: async ({ data, errors: parseErrors }) => {
        if (parseErrors.length) {
          setError(parseErrors[0].message);
          setImportBusy(false);
          return;
        }
        const rows = data.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
        try {
          const preview = await api("/assets/import/preview", {
            method: "POST",
            body: JSON.stringify({ rows }),
          });
          setImportReview({ fileName: file.name, rows, ...preview });
        } catch (importError) {
          setError(importError.message);
        } finally {
          setImportBusy(false);
        }
      },
    });
  };
  const commitImport = async () => {
    if (!importReview || importReview.errors.length || !importReview.validRows) return;
    setImportBusy(true);
    try {
      await api("/assets/import", {
        method: "POST",
        body: JSON.stringify({ rows: importReview.rows }),
      });
      setImportReview(null);
      setItems(await api("/assets?" + new URLSearchParams(filters)));
    } catch (importError) {
      setError(importError.message);
    } finally {
      setImportBusy(false);
    }
  };
  const sort = (key) => {
    if (sortBy === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortBy(key); setSortDirection("asc"); }
  };
  return (
    <>
      <div className="section-intro">
        <div>
          <p className="eyebrow cyan-text">ASSET REGISTER</p>
          <h3>Asset inventory</h3>
          <p className="muted">
            {items.length} assets · Borrowed means checked out; In Use means
            assigned
          </p>
        </div>
        <div className="form-actions">
          {staff && (
            <>
              <input
                ref={importInput}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) previewImport(file);
                }}
              />
              <button className="ghost" type="button" onClick={() => importInput.current?.click()} disabled={importBusy}>
                <FileUp size={16} /> {importBusy ? "Checking CSV..." : "Import CSV"}
              </button>
            </>
          )}
          <button className="ghost" type="button" onClick={exportCsv} disabled={!items.length}>
            <Download size={16} /> Export CSV
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="inventory-filters">
        <input
          name="q"
          placeholder="Search ID, serial, name"
          value={filters.q}
          onChange={set}
        />
        {[
          ["group", "All groups", groups.map((x) => x.prefix)],
          ["category", "All categories", categories.map((x) => x.name)],
          [
            "department",
            "All departments",
            [...new Set(items.map((x) => x.department))],
          ],
          [
            "location",
            "All locations",
            [...new Set(items.map((x) => x.location))],
          ],
          [
            "filter",
            "All statuses",
            ["Available", "Borrowed", "In Use", "Repair", "Retired"],
          ],
        ].map(([key, label, values]) => (
          <select key={key} name={key} value={filters[key]} onChange={set}>
            <option value="">{label}</option>
            {values.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        ))}
      </div>
      <section className="panel">
        <div className="table-wrap">
          <p className="muted">เลือกหัวตารางเพื่อเรียงข้อมูล</p>
          <table className="inventory-table">
            <thead>
              <tr>
                {[
                  "Asset ID",
                  "Group",
                  "Category",
                  "Name / Type",
                  "Serial Number",
                  "Location",
                  "Department",
                  "Status",
                  "Next action",
                  "Actions",
                ].map((x, index) => {
                  const keys = ["assetId", "group", "category", "name", "serialNumber", "location", "department", "status", "nextAction", "actions"];
                  const key = keys[index];
                  return <th key={x}>{key === "actions" ? x : <button type="button" className="table-sort" onClick={() => sort(key)}>{x}{sortBy === key ? (sortDirection === "asc" ? " ↑" : " ↓") : " ↕"}</button>}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((a) => (
                <tr key={a.assetId}>
                  <td>
                    <b>{a.assetId}</b>
                  </td>
                  <td>{a.assetGroup || a.assetId.split("-")[0]}</td>
                  <td>{a.category}</td>
                  <td>
                    {a.name}
                    <small>{a.type}</small>
                  </td>
                  <td>{a.serialNumber || "—"}{a.serialPhotoUrl && <img className="serial-thumb" src={a.serialPhotoUrl} alt={`Serial label for ${a.assetId}`} />}</td>
                  <td>
                    {a.floor} · {a.location}
                  </td>
                  <td>{a.department}</td>
                  <td>
                    <Badge status={a.status} />
                  </td>
                  <td>{a.nextAction || next[a.status] || "—"}</td>
                  <td>
                    <button
                      className="ghost"
                      onClick={() => setSelected(a.assetId)}
                    >
                      Detail / History
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length && <p className="empty-state">No assets found</p>}
        </div>
      </section>
      {selected && (
        <AssetDetail
          id={selected}
          staff={staff}
          onCheckout={onCheckout}
          onReturn={onReturn}
          onClose={() => setSelected(null)}
        />
      )}
      {importReview && (
        <div className="modal-backdrop" onClick={() => !importBusy && setImportReview(null)}>
          <section className="modal csv-import-review" role="dialog" aria-modal="true" aria-labelledby="csv-import-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close" aria-label="Close preview" onClick={() => setImportReview(null)} disabled={importBusy}>×</button>
            <p className="eyebrow cyan-text">CSV IMPORT PREVIEW</p>
            <h3 id="csv-import-title">{importReview.fileName}</h3>
            <p>{importReview.rowCount} rows · {importReview.validRows} valid</p>
            {importReview.errors.length ? (
              <div className="error">
                <b>{importReview.errors.length} issue(s) must be fixed before import</b>
                <ul>{importReview.errors.slice(0, 8).map((issue) => <li key={`${issue.row}-${issue.message}`}>Row {issue.row}: {issue.message}</li>)}</ul>
                {importReview.errors.length > 8 && <small>And {importReview.errors.length - 8} more</small>}
              </div>
            ) : <p className="muted">All rows passed validation. Asset IDs will be assigned by the system.</p>}
            <div className="form-actions">
              <button className="ghost" type="button" onClick={() => setImportReview(null)} disabled={importBusy}>Cancel</button>
              <button className="primary" type="button" onClick={commitImport} disabled={importBusy || !!importReview.errors.length || !importReview.validRows}>
                {importBusy ? "Importing..." : `Import ${importReview.validRows} assets`}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
export function InsightDashboard({ onStatusSelect }) {
  const [statusAssets, setStatusAssets] = useState(null),
  [chartFilters, setChartFilters] = useState({}),
    [period, setPeriod] = useState("week"),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    api("/assets").then(setStatusAssets).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setChartFilters({});
    if (period === "custom" && (!start || !end)) return;
    api("/movement-insight?" + new URLSearchParams({ period, start, end }))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [period, start, end]);
  const filteredAssets = statusAssets
    ? statusAssets.filter((asset) => {
        return Object.entries(chartFilters).every(([key, selected]) => {
          const ids = selected.assetIds || [];
          if (ids.length) return ids.includes(asset.assetId);
          const value = key === "department" ? asset.department
            : key === "location" ? asset.location
              : key === "status" ? asset.status
                : key === "category" ? asset.category
                  : key === "assets" ? asset.assetId
                    : key === "type" ? asset.type
                      : null;
          return value !== undefined && value !== null && String(value) === String(selected.name);
        });
      })
    : [];
  const activeChartFilters = Object.entries(chartFilters).filter(([, selected]) => selected);
  const activeAssetIds = activeChartFilters.reduce((ids, [, selected]) => {
    const selectedIds = selected.assetIds || [];
    return ids === null ? new Set(selectedIds) : new Set([...ids].filter((id) => selectedIds.includes(id)));
  }, null);
  const chartRows = (key) => (data?.charts?.[key] || []).filter((row) =>
    !activeAssetIds || (row.assetIds || []).some((id) => activeAssetIds.has(id))
  );
  const selectStatus = (label) => {
    const records = filteredAssets.filter((asset) => asset.status === label);
    onStatusSelect?.(label, records);
  };
  return (
    <>
      <div className="section-intro">
        <div>
          <p className="eyebrow cyan-text">LIVE MOVEMENT INTELLIGENCE</p>
          <h3>Track, analyze, recommend</h3>
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {[
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["week", "Last 7 days"],
            ["month", "Last 30 days"],
            ["custom", "Custom date range"],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {period === "custom" && <div className="flow-fields"><label>From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>}
      {error && <p className="error">{error}</p>}
      {period === "custom" && (!start || !end) ? <p className="loading">Select a start and end date.</p> : !data ? (
        <p className="loading">Loading insight…</p>
      ) : (
        <>
          <div className="stat-grid clickable-status-cards">
            {[['In Use','inUse'],['Borrowed','borrowed'],['Available','available'],['Repair','repair']].map(([label,key])=>{const count=statusAssets?filteredAssets.filter(asset=>asset.status===label).length:(data.summary[key]??(key==='inUse'?data.summary['In Use']:0));return <button type="button" className={`stat-card ${key} status-card-button`} key={key} onClick={()=>selectStatus(label)}><div><small>{label}</small><strong>{count}</strong></div><span aria-hidden="true">→</span><small>คลิกเพื่อดูรายการ Asset</small></button>})}
          </div>
          <div className="insight-grid">
            {[
              ["Movement by department", "department"],
              ["Most moved assets", "assets"],
              ["Movement trend", "trend"],
              ["Asset status", "status"],
              ["Usage by category", "category"],
              ["Movement by location", "location"],
              ["Checkout hour", "hours"],
            ].map(([title, key]) => (
              <section className="panel" key={key}>
                <h4>{title}</h4>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={chartRows(key)}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill={chartFilters[key] ? "#0b6f78" : "#1697a4"} style={{ cursor: "pointer" }} onClick={(entry) => { const row = entry.payload || entry, name = entry.name || row.name; setChartFilters((current) => ({ ...current, [key]: current[key]?.name === name ? undefined : { name, assetIds: row.assetIds || [] } })); }} />
                  </BarChart>
                </ResponsiveContainer>
                <small className="muted">คลิกแท่งกราฟเพื่อดูรายการที่เกี่ยวข้อง</small>
              </section>
            ))}
          </div>
          {activeChartFilters.length > 0 && <section className="panel"><div className="panel-head"><div><h4>ผลลัพธ์จากตัวกรองกราฟ</h4><small>{activeChartFilters.map(([key,selected])=>`${key}: ${selected.name}`).join(" · ")} · {filteredAssets.length} Asset</small></div><button className="ghost" onClick={() => setChartFilters({})}>ล้างตัวกรอง</button></div><div className="group-unavailable">{filteredAssets.slice(0, 12).map((asset) => <div key={asset.assetId}><b>{asset.assetId}</b><span className={`asset-badge badge-${String(asset.status || "unknown").toLowerCase().replaceAll(" ", "-")}`}>{asset.status}</span></div>)}</div></section>}
          <section className="panel">
            <h4>Rule-based recommendations</h4>
            {data.recommendations.map((x, i) => (
              <p key={i}>{x}</p>
            ))}
            {!data.recommendations.length && (
              <p>No activity recommendations yet.</p>
            )}
          </section>
          {data.groups?.length > 0 && <section className="panel"><h4>Asset availability by group</h4><div className="group-summary">{data.groups.map((g) => <article key={g.name}><b>{g.name}</b><span>Total {g.total} · Available {g.available} · Unavailable {g.total-g.available}</span><small>Borrowed {g.borrowed} · In use {g.inUse} · Repair {g.repair} · Retired {g.retired}</small>{g.unavailable.length>0&&<small>{g.unavailable.join(" · ")}</small>}</article>)}</div></section>}
          <section className="panel">
            <h4>Currently borrowed</h4>
            {data.borrowed.map((x) => (
              <p key={x.assetId}>
                {x.assetId} · {x.name} · {x.transactionId} · Due{" "}
                {displayDate(x.dueDate)}
              </p>
            ))}
            {!data.borrowed.length && <p>No open checkouts</p>}
          </section>
        </>
      )}
    </>
  );
}
export function CatalogManager() {
  const [tab, setTab] = useState("groups"),
    [rows, setRows] = useState([]),
    [name, setName] = useState(""),
    [prefix, setPrefix] = useState(""),
    [error, setError] = useState("");
  const load = () =>
    api("/catalog/" + tab)
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [tab]);
  const add = async (e) => {
    e.preventDefault();
    try {
      await api("/catalog/" + tab, {
        method: "POST",
        body: JSON.stringify(tab === "groups" ? { name, prefix } : { name }),
      });
      setName("");
      setPrefix("");
      load();
    } catch (x) {
      setError(x.message);
    }
  };
  return (
    <section className="panel">
      <h3>Catalog management</h3>
      <div className="quick-actions">
        {["groups", "categories", "departments", "locations"].map((x) => (
          <button
            key={x}
            className={tab === x ? "primary" : "ghost"}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="catalog-list">
        {rows.map((x) => (
          <span key={x._id}>
            {x.prefix ? x.prefix + " · " : ""}
            {x.name}
          </span>
        ))}
      </div>
      <form className="flow-fields" onSubmit={add}>
        {tab === "groups" && (
          <label>
            Prefix
            <input
              required
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            />
          </label>
        )}
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="primary">Add</button>
      </form>
    </section>
  );
}
export function AuditPage() {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/audit")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <h3>Audit log</h3>
      {error && <p className="error">{error}</p>}
      {rows.map((x) => (
        <article className="audit-entry" key={x._id}>
          <b>{x.assetId || x.action}</b> · {x.action} · {x.actor}
          <small>{displayDate(x.createdAt)}</small>
        </article>
      ))}
    </section>
  );
}
