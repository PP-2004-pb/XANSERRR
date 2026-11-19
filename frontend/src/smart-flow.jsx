import React, { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import {
  Camera,
  Check,
  ClipboardList,
  MapPin,
  PackageCheck,
  Trash2,
} from "lucide-react";

const apiRequest = async (path, options = {}) => {
  const token = localStorage.getItem("itam-token");
  const r = await fetch(
    (import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api") + path,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || "Request failed");
  return d;
};
const assetIdFromCode = (value) =>
  String(value || "").match(/\/asset\/([^/?#]+)/i)?.[1] ||
  String(value || "").trim();
export function Scanner({ onFound }) {
  const video = useRef(null),
    readerRef = useRef(null),
    [error, setError] = useState(""),
    [active, setActive] = useState(false);
  const stop = () => {
    readerRef.current?.reset();
    readerRef.current = null;
    video.current?.srcObject?.getTracks().forEach((track) => track.stop());
    if (video.current) video.current.srcObject = null;
    setActive(false);
  };
  const start = async () => {
    setError("");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera needs HTTPS or localhost");
      }
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      setActive(true);
      await reader.decodeFromVideoDevice(
        null,
        video.current,
        (result) => {
          if (result) {
            onFound(assetIdFromCode(result.getText()));
            stop();
          }
        },
      );
    } catch (e) {
      readerRef.current?.reset();
      readerRef.current = null;
      setActive(false);
      const messages = {
        NotAllowedError: "กรุณาอนุญาตให้ใช้กล้องในเบราว์เซอร์ แล้วลองอีกครั้ง",
        NotFoundError: "ไม่พบกล้องบนอุปกรณ์นี้",
        NotReadableError: "กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่",
      };
      setError(messages[e?.name] || "เปิดกล้องไม่ได้ กรุณาตรวจสิทธิ์กล้อง หรือกรอกรหัส Asset เอง");
    }
  };
  useEffect(() => () => stop(), []);
  return (
    <div className="scanner-box">
      <video
        ref={video}
        className={active ? "scanner-video" : "scanner-video idle"}
        muted
        playsInline
      />
      <div className="scanner-controls">
        <button className="primary" onClick={active ? stop : start}>
          <Camera size={17} />
          {active ? "หยุดกล้อง" : "เปิดกล้องสแกน QR"}
        </button>
        <small>ต้องใช้ HTTPS หรือ localhost เพื่อขอสิทธิ์กล้อง</small>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function SmartCheckout({user}) {
  const [ids, setIds] = useState([]),
    [departments, setDepartments] = useState([]),
    [assets, setAssets] = useState([]),
    [destination, setDestination] = useState({
      floor: "6",
      department: user?.department || "IT",
      location: user?.department || "IT Department",
    }),
    [purpose, setPurpose] = useState("ใช้งานประชุม"),
    [dueDate, setDueDate] = useState(""),
      [message, setMessage] = useState(""),[search,setSearch]=useState(''),[matches,setMatches]=useState([]);
    useEffect(()=>{apiRequest('/catalog/departments').then(setDepartments).catch(()=>{})},[]);
    useEffect(()=>{if(!search.trim()){setMatches([]);return}const t=setTimeout(()=>apiRequest(`/assets?q=${encodeURIComponent(search)}${user?.role==='Department User'?`&department=${encodeURIComponent(user.department)}`:''}`).then(d=>setMatches(d.slice(0,8))).catch(e=>setMessage(e.message)),250);return()=>clearTimeout(t)},[search,user]);
    const add = async (code) => {
    const id = assetIdFromCode(code);
    if (!id || ids.includes(id)) return;
    try {
      const asset = await apiRequest(`/assets/${encodeURIComponent(id)}`);
      if (user?.role === "Department User" && asset.department !== user.department)
        throw Error("คุณยืมได้เฉพาะอุปกรณ์ในแผนกของคุณ");
      if (asset.status !== "Available")
        throw Error(`${id} ไม่พร้อมให้ยืม (${asset.status})`);
      setSearch('');setMatches([]);
      setIds((x) => [...x, id]);
      setAssets((x) => [...x, asset]);
      setMessage("เพิ่ม Asset เข้า Cart แล้ว");
    } catch (e) {
      setMessage(e.message);
    }
  };
  const checkout = async () => {
    try {
      const d = await apiRequest("/transactions/checkout", {
        method: "POST",
        body: JSON.stringify({
          assetIds: ids,
          destination,
          purpose,
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        }),
      });
      setMessage(`✓ Checkout สำเร็จ · ${d.transactionId || d._id || 'สำเร็จ'}`);
      setIds([]);
      setAssets([]);
    } catch (e) {
      setMessage(e.message);
    }
  };
  return (
    <div className="smart-flow">
      <div className="flow-intro">
        <div>
          <p className="eyebrow cyan-text">SCAN → TAKE → MOVE → TRACK</p>
          <h3>Smart checkout</h3>
          <p className="muted">
            สแกนต่อเนื่องเพื่อสร้างรายการยืมหลาย Asset ใน Transaction เดียว
          </p>
        </div>
        <span className="cart-count">
          <PackageCheck size={17} /> {ids.length} Assets
        </span>
      </div>
      <Scanner onFound={add} />
      <label className="manual-scan">
      Asset ID / Serial Number / QR value
          <input placeholder="Asset ID, serial or asset name" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add(matches[0]?.assetId||search)}}}/>
        </label>{matches.length>0&&<div className="scan-results">{matches.map(a=><button key={a.assetId} onClick={()=>add(a.assetId)}>{a.photoUrl&&<img src={a.photoUrl} alt=""/>}<b>{a.assetId}</b> · {a.name} · {a.serialNumber} · {a.location} · {a.department} · {a.status}</button>)}</div>}
      <section className="cart-panel">
        <div className="panel-head">
          <div>
            <h4>Checkout Cart</h4>
            <small>
              {ids.length
                ? `${ids.length} Assets Ready to Checkout`
                : "ยังไม่มี Asset ใน Cart"}
            </small>
          </div>
          <ClipboardList size={20} />
        </div>
        {assets.map((a) => (
          <div className="cart-item" key={a.assetId}>
            <div>
              <b>{a.assetId}</b>
              <small>
                {a.name} · {a.serialNumber||'No serial'} · {a.floor} · {a.location} · {a.department} · {a.status}
              </small>
            </div>
            <button
              className="ghost"
              onClick={() => {
                setIds((x) => x.filter((id) => id !== a.assetId));
                setAssets((x) => x.filter((x) => x.assetId !== a.assetId));
              }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <div className="checkout-fields">
          <label>
            ปลายทาง
            <input
              value={destination.location}
              onChange={(e) =>
                setDestination({ ...destination, location: e.target.value })
              }
            />
          </label>
          <label>
            ชั้น
            <input
              value={destination.floor}
              onChange={(e) =>
                setDestination({ ...destination, floor: e.target.value })
              }
            />
          </label>
          <label>
            แผนก
            {user?.role === "Department User" ? <input value={user.department} readOnly /> : <select value={destination.department} onChange={(e) => setDestination({ ...destination, department: e.target.value })}>{departments.map((d) => <option key={d._id} value={d.name}>{d.name}</option>)}</select>}
          </label>
          <label>
            เหตุผล
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>
          <label>
            กำหนดคืน (ถ้ามี)
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
        {message && <div className="flow-message">{message}</div>}
        <button
          className="primary wide-flow"
          disabled={!ids.length}
          onClick={checkout}
        >
          <Check size={17} /> Confirm Checkout · {ids.length} Assets
        </button>
      </section>
    </div>
  );
}

export function SmartReturn({initialTransactionId=''}){const [transactionId,setTransactionId]=useState(initialTransactionId),[ids,setIds]=useState([]),[message,setMessage]=useState(''),[transactions,setTransactions]=useState([]),[original,setOriginal]=useState(null);useEffect(()=>{apiRequest('/transactions').then(d=>setTransactions(d.filter(t=>t.type==='CHECKOUT'&&t.status!=='COMPLETED'))).catch(e=>setMessage(e.message))},[]);useEffect(()=>{if(initialTransactionId){setTransactionId(initialTransactionId);setIds([])}},[initialTransactionId]);useEffect(()=>{if(!transactionId){setOriginal(null);return}apiRequest(`/transactions/${encodeURIComponent(transactionId)}`).then(setOriginal).catch(e=>{setOriginal(null);setMessage(e.message)})},[transactionId]);const add=code=>{const id=assetIdFromCode(code);if(!original?.items.some(i=>i.assetId===id&&i.status==='CHECKED_OUT')){setMessage('Asset ไม่อยู่ในรายการยืมที่ยังเปิดอยู่');return}if(id&&!ids.includes(id))setIds(x=>[...x,id])};const submit=async()=>{try{const d=await apiRequest('/transactions/return',{method:'POST',body:JSON.stringify({transactionId,assetIds:ids,reason:'คืนอุปกรณ์'})});setMessage(`✓ Return completed · ${d.transaction?.transactionId||'สำเร็จ'}`);setIds([]);setOriginal(await apiRequest(`/transactions/${encodeURIComponent(transactionId)}`))}catch(e){setMessage(e.message)}};return <div className="smart-flow"><div className="flow-intro"><div><p className="eyebrow cyan-text">SCAN → VERIFY → RETURN</p><h3>Smart return</h3><p className="muted">ระบุ Transaction ต้นทาง แล้วสแกนคืนทั้งหมดหรือเลือกคืนบาง Asset</p></div></div><label className="manual-scan">Original Transaction ID<select value={transactionId} onChange={e=>{setTransactionId(e.target.value);setIds([])}}><option value="">Choose checkout transaction</option>{transactions.map(t=><option key={t.transactionId} value={t.transactionId}>{t.transactionId} · {t.borrowerName} · {t.assetCount-t.returnedCount} outstanding</option>)}</select></label>{original&&<div className="cart-panel"><p>Borrower: {original.borrowerName} · Due: {original.dueDate?new Date(original.dueDate).toLocaleString('th-TH'):'—'} · From: {original.destination?.location} · Return to: {original.source?.location}</p><div className="quick-actions"><button className="ghost" onClick={()=>setIds(original.items.filter(i=>i.status==='CHECKED_OUT').map(i=>i.assetId))}>Return all</button></div>{original.items.filter(i=>i.status==='CHECKED_OUT').map(i=><label key={i.assetId} className="return-choice"><input type="checkbox" checked={ids.includes(i.assetId)} onChange={()=>setIds(x=>x.includes(i.assetId)?x.filter(v=>v!==i.assetId):[...x,i.assetId])}/>{i.assetId}</label>)}</div>}<Scanner onFound={add}/><label className="manual-scan">Asset ID หรือ QR value<input placeholder="เช่น PC-001" onKeyDown={e=>{if(e.key==='Enter'){add(e.currentTarget.value);e.currentTarget.value=''}}}/></label><section className="cart-panel"><div className="panel-head"><div><h4>Return Cart</h4><small>{ids.length} Assets selected</small></div><PackageCheck size={20}/></div>{ids.map(id=><div className="cart-item" key={id}><b>{id}</b><button className="ghost" onClick={()=>setIds(x=>x.filter(v=>v!==id))}><Trash2 size={15}/></button></div>)}{message&&<div className="flow-message">{message}</div>}<button className="primary wide-flow" disabled={!transactionId||!ids.length} onClick={submit}><Check size={17}/> Return Selected Assets</button></section></div>}

export function Transactions() {
  const [rows, setRows] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    apiRequest("/transactions")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="section-intro">
        <div>
          <p className="eyebrow cyan-text">CHAIN OF CUSTODY</p>
          <h3>Transactions</h3>
          <p className="muted">
            ติดตามว่าใครนำอะไรออกไป จากที่ไหน ไปที่ไหน และคืนแล้วกี่รายการ
          </p>
        </div>
        <span className="status">{rows.length} records</span>
      </div>
      {error && <div className="error">{error}</div>}
      <Panel
        title="Checkout & return history"
        subtitle="Multi-asset transactions"
      >
        <div className="transaction-list">
          {rows.map((t) => (
            <article className="transaction-card" key={t._id}>
              <div>
                <b>{t.transactionId}</b>
                <span className="pill">{t.type}</span>
                <small>{new Date(t.createdAt).toLocaleString("th-TH")}</small>
              </div>
              <div>
                <b>{t.borrowerName || t.actor}</b>
                <small>
                  {t.assetCount} Assets · {t.returnedCount || 0} returned
                </small>
              </div>
              <div className="transaction-route">
                <MapPin size={15} />
                {t.source?.location || "—"} → {t.destination?.location || "—"}
              </div>
              <span className="status">{t.status}</span>
            </article>
          ))}
        </div>
      </Panel>
    </>
  );
}
function Panel({ title, subtitle, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h4>{title}</h4>
          <small>{subtitle}</small>
        </div>
      </div>
      {children}
    </section>
  );
}
