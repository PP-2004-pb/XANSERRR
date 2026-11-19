import React, { useState } from "react";
import { Bell, RefreshCw } from "lucide-react";

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://127.0.0.1:4000/api" : "/api");
const labels = {
  pm: "Preventive maintenance",
  warranty: "Warranty",
  risk: "Risk",
  health: "Health",
  missing: "Missing asset",
  movement: "Movement",
  overdue: "Overdue checkout",
};

export default function NotificationBell({ onSelect, onCreateWorkOrder }) {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAlerts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("itam-token")}` },
      });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || "Could not load alerts");
      setAlerts(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) loadAlerts();
  };

  return (
    <div className="notification-anchor">
      <button
        className="icon-button"
        type="button"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={toggle}
      >
        <Bell size={18} />
        {alerts.length > 0 && <span className="notification-count">{alerts.length > 99 ? "99+" : alerts.length}</span>}
      </button>
      {open && (
        <section className="notifications-panel" role="dialog" aria-label="Active alerts">
          <div className="notifications-head">
            <div>
              <b>Active alerts</b>
              <small>{alerts.length} items</small>
            </div>
            <button type="button" className="icon-button" aria-label="Refresh alerts" onClick={loadAlerts} disabled={loading}>
              <RefreshCw size={15} />
            </button>
          </div>
          {loading ? <p className="notification-empty">Loading alerts...</p> : error ? <p className="notification-error">{error}</p> : alerts.length === 0 ? (
            <p className="notification-empty">No active alerts</p>
          ) : alerts.slice(0, 40).map((alert) => (
            <article className={`notification-item severity-${alert.severity}`} key={alert.id}>
              <button
                type="button"
                className="notification-main"
                onClick={() => {
                  setOpen(false);
                  if (alert.transactionId) onSelect(alert.assetId, alert.transactionId);
                  else onSelect(alert.assetId);
                }}
              >
                <span>{labels[alert.kind] || "Asset alert"}</span>
                <b>{alert.assetId}</b>
                <small>{alert.message}</small>
              </button>
              {onCreateWorkOrder && ["pm", "warranty", "risk", "health", "missing"].includes(alert.kind) && (
                <button type="button" className="notification-create" onClick={() => { setOpen(false); onCreateWorkOrder(alert); }}>
                  Create work order
                </button>
              )}
            </article>
          ))}
          {alerts.length > 40 && <p className="notification-empty">Showing the first 40 alerts</p>}
        </section>
      )}
    </div>
  );
}