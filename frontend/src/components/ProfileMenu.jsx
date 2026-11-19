import React, { useEffect, useRef, useState } from "react";

export default function ProfileMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const publicDemo = import.meta.env.VITE_PUBLIC_DEMO === "true";

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="profile-menu-root" ref={root}>
      <button
        className="header-avatar profile-trigger"
        type="button"
        aria-label="เปิดเมนูบัญชีผู้ใช้"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {user?.name?.[0] || "?"}
      </button>
      {open && (
        <div className="profile-popover" role="menu">
          <div className="profile-popover-user">
            <b>{user?.name}</b>
            <span>{user?.role}</span>
          </div>
          {publicDemo ? (
            <p className="profile-readonly">Public demo · ดูข้อมูลได้อย่างเดียว</p>
          ) : (
            <button
              className="profile-signout"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              ออกจากระบบ
            </button>
          )}
        </div>
      )}
    </div>
  );
}
