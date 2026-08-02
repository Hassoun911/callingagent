(() => {
  const API = "/api";
  let lastPath = "";
  let panel = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function companyIdFromUrl() {
    const match = window.location.pathname.match(/^\/companies\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function portalCompanyId() {
    const value = new URLSearchParams(window.location.search).get("company");
    return value ? Number(value) : null;
  }

  async function jsonFetch(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || "Request failed");
    return body;
  }

  function ensureStyles() {
    if (document.getElementById("portal-user-tools-style")) return;
    const style = document.createElement("style");
    style.id = "portal-user-tools-style";
    style.textContent = `
      .put-btn{display:inline-flex;align-items:center;justify-content:center;gap:.35rem;border:1px solid rgba(148,163,184,.28);border-radius:.4rem;padding:.38rem .65rem;font-size:.75rem;font-weight:600;color:#cbd5e1;background:rgba(15,23,42,.55);cursor:pointer}
      .put-btn:hover{background:rgba(30,41,59,.9);color:#fff}.put-btn-primary{border-color:rgba(14,165,233,.4);color:#38bdf8}.put-btn-danger{border-color:rgba(239,68,68,.35);color:#f87171}
      .put-overlay{position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,.76);display:flex;align-items:center;justify-content:center;padding:1rem}
      .put-modal{width:min(680px,96vw);max-height:90vh;overflow:auto;background:#0f172a;border:1px solid #26334a;border-radius:.75rem;box-shadow:0 24px 80px rgba(0,0,0,.55);color:#e2e8f0}
      .put-head{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.15rem;border-bottom:1px solid #26334a}.put-title{font-size:1rem;font-weight:700}.put-close{border:0;background:none;color:#94a3b8;font-size:1.5rem;cursor:pointer}
      .put-body{padding:1rem 1.15rem}.put-row{display:flex;gap:.75rem;align-items:center;padding:.8rem 0;border-bottom:1px solid rgba(51,65,85,.65)}.put-row:last-child{border-bottom:0}.put-main{min-width:0;flex:1}.put-name{font-weight:700}.put-meta{font-size:.75rem;color:#94a3b8;margin-top:.15rem}.put-actions{display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end}
      .put-form{display:grid;gap:.8rem}.put-label{display:grid;gap:.35rem;font-size:.75rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em}.put-input,.put-select{width:100%;box-sizing:border-box;border:1px solid #334155;border-radius:.4rem;background:#1e293b;color:#f8fafc;padding:.65rem .75rem;font-size:.9rem}.put-footer{display:flex;justify-content:flex-end;gap:.55rem;margin-top:.35rem}.put-error{padding:.6rem .75rem;border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.09);color:#fca5a5;border-radius:.4rem;font-size:.8rem}.put-note{font-size:.8rem;color:#94a3b8;line-height:1.5}.put-success{padding:.6rem .75rem;border:1px solid rgba(16,185,129,.35);background:rgba(16,185,129,.09);color:#6ee7b7;border-radius:.4rem;font-size:.8rem}
      #put-manage-users{margin-left:.5rem}
      #put-forgot-password{display:block;width:100%;margin-top:.85rem;border:0;background:none;color:#34d399;font-size:.8rem;text-decoration:underline;cursor:pointer}
    `;
    document.head.appendChild(style);
  }

  function closePanel() {
    panel?.remove();
    panel = null;
  }

  function showModal(title, html) {
    closePanel();
    ensureStyles();
    panel = document.createElement("div");
    panel.className = "put-overlay";
    panel.innerHTML = `<div class="put-modal" role="dialog" aria-modal="true"><div class="put-head"><div class="put-title">${escapeHtml(title)}</div><button class="put-close" aria-label="Close">×</button></div><div class="put-body">${html}</div></div>`;
    panel.addEventListener("click", (event) => {
      if (event.target === panel || event.target.closest(".put-close")) closePanel();
    });
    document.body.appendChild(panel);
    return panel;
  }

  async function openUserManager(companyId) {
    const modal = showModal("Portal Users", '<div class="put-note">Loading users…</div>');
    try {
      const users = await jsonFetch(`${API}/platform-users?companyId=${companyId}`);
      const body = modal.querySelector(".put-body");
      if (!users.length) {
        body.innerHTML = '<div class="put-note">No portal users have been created for this company.</div>';
        return;
      }
      body.innerHTML = users.map((user) => `
        <div class="put-row" data-user-id="${user.id}">
          <div class="put-main"><div class="put-name">${escapeHtml(user.username)}</div><div class="put-meta">${escapeHtml(user.email || "No email")} · ${escapeHtml(user.role === "company_admin" ? "Admin" : "User")} · ${user.isActive ? "Active" : "Disabled"}</div></div>
          <div class="put-actions"><button class="put-btn put-edit">Edit</button><button class="put-btn put-btn-primary put-reset">Reset password</button></div>
        </div>`).join("");
      body.addEventListener("click", (event) => {
        const row = event.target.closest("[data-user-id]");
        if (!row) return;
        const user = users.find((item) => item.id === Number(row.dataset.userId));
        if (!user) return;
        if (event.target.closest(".put-edit")) openEditUser(user, companyId);
        if (event.target.closest(".put-reset")) openResetPassword(user, companyId);
      });
    } catch (error) {
      modal.querySelector(".put-body").innerHTML = `<div class="put-error">${escapeHtml(error.message)}</div>`;
    }
  }

  function openEditUser(user, companyId) {
    const modal = showModal(`Edit ${user.username}`, `
      <form id="put-edit-form" class="put-form">
        <label class="put-label">Username<input class="put-input" name="username" value="${escapeHtml(user.username)}" required /></label>
        <label class="put-label">Email<input class="put-input" name="email" type="email" value="${escapeHtml(user.email || "")}" placeholder="user@company.com" /></label>
        <label class="put-label">Role<select class="put-select" name="role"><option value="company_user" ${user.role === "company_user" ? "selected" : ""}>User</option><option value="company_admin" ${user.role === "company_admin" ? "selected" : ""}>Admin</option></select></label>
        <div id="put-edit-message"></div>
        <div class="put-footer"><button type="button" class="put-btn put-cancel">Cancel</button><button type="submit" class="put-btn put-btn-primary">Save changes</button></div>
      </form>`);
    modal.querySelector(".put-cancel").addEventListener("click", () => openUserManager(companyId));
    modal.querySelector("#put-edit-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const message = modal.querySelector("#put-edit-message");
      try {
        await jsonFetch(`${API}/platform-users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ username: String(form.get("username") || "").trim(), email: String(form.get("email") || "").trim() || null, role: String(form.get("role") || "company_user") }),
        });
        message.innerHTML = '<div class="put-success">User updated successfully.</div>';
        setTimeout(() => openUserManager(companyId), 600);
      } catch (error) {
        message.innerHTML = `<div class="put-error">${escapeHtml(error.message)}</div>`;
      }
    });
  }

  function openResetPassword(user, companyId) {
    const modal = showModal(`Reset password for ${user.username}`, `
      <form id="put-reset-form" class="put-form">
        <label class="put-label">New password<input class="put-input" name="password" type="password" minlength="8" autocomplete="new-password" required /></label>
        <label class="put-label">Confirm password<input class="put-input" name="confirm" type="password" minlength="8" autocomplete="new-password" required /></label>
        <div class="put-note">The old password stops working immediately after you save the new one.</div>
        <div id="put-reset-message"></div>
        <div class="put-footer"><button type="button" class="put-btn put-cancel">Cancel</button><button type="submit" class="put-btn put-btn-primary">Reset password</button></div>
      </form>`);
    modal.querySelector(".put-cancel").addEventListener("click", () => openUserManager(companyId));
    modal.querySelector("#put-reset-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const password = String(form.get("password") || "");
      const confirm = String(form.get("confirm") || "");
      const message = modal.querySelector("#put-reset-message");
      if (password.length < 8) {
        message.innerHTML = '<div class="put-error">Password must be at least 8 characters.</div>';
        return;
      }
      if (password !== confirm) {
        message.innerHTML = '<div class="put-error">Passwords do not match.</div>';
        return;
      }
      try {
        await jsonFetch(`${API}/platform-users/${user.id}`, { method: "PATCH", body: JSON.stringify({ password }) });
        message.innerHTML = '<div class="put-success">Password reset successfully. The user can sign in with the new password now.</div>';
      } catch (error) {
        message.innerHTML = `<div class="put-error">${escapeHtml(error.message)}</div>`;
      }
    });
  }

  function addCompanyControls() {
    const companyId = companyIdFromUrl();
    if (!companyId || document.getElementById("put-manage-users")) return;
    const headings = [...document.querySelectorAll("span,div,h1,h2,h3")];
    const heading = headings.find((node) => node.textContent?.trim() === "Portal Users");
    if (!heading) return;
    const header = heading.closest("div.flex") || heading.parentElement;
    if (!header) return;
    const button = document.createElement("button");
    button.id = "put-manage-users";
    button.className = "put-btn put-btn-primary";
    button.type = "button";
    button.textContent = "Edit / Reset Users";
    button.addEventListener("click", () => openUserManager(companyId));
    const rightSide = header.parentElement?.querySelector("button")?.parentElement;
    if (rightSide && rightSide !== header) rightSide.prepend(button);
    else header.appendChild(button);
  }

  function addForgotPassword() {
    const companyId = portalCompanyId();
    if (!companyId || document.getElementById("put-forgot-password")) return;
    const submit = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim().toLowerCase() === "sign in");
    if (!submit) return;
    const button = document.createElement("button");
    button.id = "put-forgot-password";
    button.type = "button";
    button.textContent = "Forgot password?";
    button.addEventListener("click", () => {
      showModal("Reset your password", '<div class="put-note">Contact your company administrator and ask them to open <strong>Portal Users → Edit / Reset Users</strong>. They can set a new password immediately. Email self-service reset links will be added separately once the company email delivery service is configured.</div>');
    });
    submit.insertAdjacentElement("afterend", button);
  }

  function run() {
    ensureStyles();
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== lastPath) {
      lastPath = current;
      closePanel();
    }
    addCompanyControls();
    addForgotPassword();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", run);
  setInterval(run, 1200);
  run();
})();
