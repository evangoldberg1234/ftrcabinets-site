(function () {
  const STATUSES = ["New", "Contacted", "Meeting", "Bidding", "Won", "Lost", "Dead"];
  const cfg = window.FTR_CRM;
  if (!cfg || !window.supabase) {
    console.error("Missing Supabase config or SDK");
    return;
  }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const $ = (id) => document.getElementById(id);
  const authScreen = $("auth-screen");
  const crmScreen = $("crm-screen");
  const authMsg = $("auth-msg");
  const cardsEl = $("cards");
  const leadCount = $("lead-count");
  const emptyMsg = $("empty-msg");
  const userLabel = $("user-label");
  const btnSignout = $("btn-signout");
  const notesDialog = $("notes-dialog");
  let leads = [];
  let currentUser = null;
  let notesLeadId = null;

  function bestContact(lead) {
    const gcPhone = (lead.gc_phone || "").trim();
    const gcEmail = (lead.gc_email || "").trim();
    const hasGc = lead.gc_contact_name || gcPhone || gcEmail;
    if (hasGc) {
      return {
        name: lead.gc_contact_name || lead.gc_company || lead.gc || "GC contact",
        title: lead.gc_contact_title || (lead.gc_company ? "GC" : "General contractor"),
        phone: firstPhone(gcPhone),
        email: firstEmail(gcEmail),
      };
    }
    return {
      name: lead.dev_contact_name || lead.developer || "Developer",
      title: lead.dev_contact_title || "Developer",
      phone: firstPhone(lead.dev_phone || ""),
      email: firstEmail(lead.dev_email || ""),
    };
  }

  function firstPhone(s) {
    const m = String(s).match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
    return m ? m[1].replace(/[^\d+]/g, "").replace(/^1(\d{10})$/, "+1$1") : "";
  }
  function firstEmail(s) {
    const m = String(s).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : "";
  }
  function dialHref(phone) {
    if (!phone) return "";
    const digits = phone.replace(/[^\d+]/g, "");
    return "tel:" + digits;
  }
  function badgeClass(rating) {
    const r = (rating || "").toLowerCase();
    if (r === "hot") return "badge-hot";
    if (r === "warm") return "badge-warm";
    return "badge-cold";
  }
  const TIMING_STAGES = ["Bidding", "Under construction", "Cabinets likely ordered", "Stale"];
  function timingClass(stage) {
    const t = (stage || "").toLowerCase();
    if (t === "bidding") return "tbadge-bidding";
    if (t === "under construction") return "tbadge-uc";
    if (t === "cabinets likely ordered") return "tbadge-ordered";
    if (t === "stale") return "tbadge-stale";
    return "tbadge-none";
  }
  function fmtShortDate(d) {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(d);
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m[2] - 1];
    return mon + " " + (+m[3]);
  }
  function timingHtml(l) {
    if (!l.timing_stage) return "";
    const urg = l.timing_urgency ? ` · urgency ${esc(l.timing_urgency)}/5` : "";
    const checked = l.timing_checked ? ` · checked ${esc(fmtShortDate(l.timing_checked))}` : "";
    const bid = l.bid_due_date
      ? `<span class="bid-due">Bid due ${esc(fmtShortDate(l.bid_due_date))}</span>`
      : "";
    const src = l.timing_source && /^https?:/i.test(l.timing_source)
      ? ` <a href="${esc(l.timing_source)}" target="_blank" rel="noopener">timing source</a>`
      : "";
    return `<div class="timing-row">
        <span class="tbadge ${timingClass(l.timing_stage)}">${esc(l.timing_stage)}</span>
        <span class="meta">${urg.replace(/^ · /, "")}${checked}</span>${bid}
      </div>
      ${l.timing_evidence ? `<div class="timing-evidence">${esc(l.timing_evidence)}${src}</div>` : ""}`;
  }
  function ensureTimingFilter() {
    if ($("filter-timing")) return;
    const row = document.querySelector(".toolbar-row.filters");
    if (!row) return;
    const label = document.createElement("label");
    label.textContent = "Timing";
    const sel = document.createElement("select");
    sel.id = "filter-timing";
    sel.innerHTML = '<option value="">All</option><option value="__hit">Hit now (Bidding + Under construction)</option>' +
      TIMING_STAGES.map((t) => `<option>${t}</option>`).join("");
    label.appendChild(sel);
    const sortLabel = row.querySelector(".sort-label");
    row.insertBefore(label, sortLabel || null);
  }
  ensureTimingFilter();

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showAuth() {
    authScreen.classList.remove("hidden");
    crmScreen.classList.add("hidden");
    userLabel.classList.add("hidden");
    btnSignout.classList.add("hidden");
  }
  function showCrm(session) {
    currentUser = session.user;
    authScreen.classList.add("hidden");
    crmScreen.classList.remove("hidden");
    userLabel.textContent = session.user.email || "";
    userLabel.classList.remove("hidden");
    btnSignout.classList.remove("hidden");
  }

  async function loadLeads() {
    const { data, error } = await sb
      .from("leads")
      .select("*")
      .order("score", { ascending: false });
    if (error) {
      authMsg.textContent = "Could not load leads: " + error.message;
      showAuth();
      return;
    }
    leads = data || [];
    fillStateFilter();
    render();
  }

  function fillStateFilter() {
    const sel = $("filter-state");
    const cur = sel.value;
    const states = [...new Set(leads.map((l) => l.state).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All</option>' + states.map((s) => `<option>${esc(s)}</option>`).join("");
    sel.value = cur;
  }

  function filtered() {
    const q = ($("search").value || "").trim().toLowerCase();
    const st = $("filter-state").value;
    const rating = $("filter-rating").value;
    const status = $("filter-status").value;
    const sort = $("sort-by").value;
    const timing = $("filter-timing") ? $("filter-timing").value : "";
    let rows = leads.filter((l) => {
      if (st && l.state !== st) return false;
      if (rating && l.rating !== rating) return false;
      if (status && (l.status || "New") !== status) return false;
      if (timing === "__hit" && !["Bidding", "Under construction"].includes(l.timing_stage)) return false;
      if (timing && timing !== "__hit" && l.timing_stage !== timing) return false;
      if (!q) return true;
      const blob = [
        l.project_name_address, l.town, l.state, l.developer, l.gc, l.gc_company,
        l.dev_contact_name, l.gc_contact_name, l.notes, l.stage, l.timing_stage, l.timing_evidence,
      ].join(" ").toLowerCase();
      return blob.includes(q);
    });
    rows.sort((a, b) => {
      if (sort === "score-asc") return (a.score || 0) - (b.score || 0);
      if (sort === "name") return String(a.project_name_address || "").localeCompare(b.project_name_address || "");
      if (sort === "status") return String(a.status || "").localeCompare(b.status || "");
      return (b.score || 0) - (a.score || 0);
    });
    return rows;
  }

  function render() {
    const rows = filtered();
    leadCount.textContent = String(rows.length);
    emptyMsg.classList.toggle("hidden", rows.length > 0);
    cardsEl.innerHTML = rows.map(cardHtml).join("");
    cardsEl.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("change", onCardChange);
      el.addEventListener("click", onCardClick);
    });
    cardsEl.querySelectorAll("button[data-action]").forEach((el) => {
      el.addEventListener("click", onCardClick);
    });
  }

  function cardHtml(l) {
    const c = bestContact(l);
    const statusOpts = STATUSES.map(
      (s) => `<option value="${s}" ${(l.status || "New") === s ? "selected" : ""}>${s}</option>`
    ).join("");
    const phone = c.phone
      ? `<a href="${esc(dialHref(c.phone))}">${esc(c.phone)}</a>`
      : "";
    const email = c.email
      ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`
      : "";
    const source = l.source_url
      ? `<a href="${esc(l.source_url)}" target="_blank" rel="noopener">Source</a>`
      : "";
    return `<article class="card" data-id="${l.id}">
      <div class="card-top">
        <div>
          <h2>${esc(l.project_name_address || "Untitled")}</h2>
          <div class="meta">${esc(l.town || "")}${l.town && l.state ? ", " : ""}${esc(l.state || "")}
            · ${esc(l.units || "?")} units
            · <span class="score">Score ${esc(l.score != null ? l.score : "—")}</span>
          </div>
        </div>
        <span class="badge ${badgeClass(l.rating)}">${esc(l.rating || "Cold")}</span>
      </div>
      <div class="meta">Stage: ${esc(l.stage || "—")}</div>
      ${timingHtml(l)}
      <div class="contact">
        <div class="name">${esc(c.name)}</div>
        <div class="title">${esc(c.title || "")}</div>
        <div>${phone}${email}${source}</div>
      </div>
      <div class="status-row">
        <span>Status</span>
        <select data-action="status" data-id="${l.id}">${statusOpts}</select>
      </div>
      <div class="next-row">
        <div class="field-wrap">
          <span>Next step</span>
          <input data-action="next_step" data-id="${l.id}" value="${esc(l.next_step || "")}" placeholder="Call GC / send leave-behind…" />
        </div>
        <div class="field-wrap">
          <span>Date</span>
          <input type="date" data-action="next_step_date" data-id="${l.id}" value="${esc(l.next_step_date || "")}" />
        </div>
      </div>
      <div class="card-actions">
        <button type="button" class="btn btn-ghost" data-action="notes" data-id="${l.id}">Notes</button>
      </div>
    </article>`;
  }

  async function onCardChange(e) {
    const el = e.target;
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id");
    if (!action || !id) return;
    if (action === "status" || action === "next_step" || action === "next_step_date") {
      const patch = {
        [action]: el.value || null,
        last_touch: new Date().toISOString(),
        updated_by: currentUser && currentUser.email,
      };
      if (action === "next_step" && !el.value) patch.next_step = null;
      const { error } = await sb.from("leads").update(patch).eq("id", id);
      if (error) {
        alert("Save failed: " + error.message);
        return;
      }
      const row = leads.find((x) => String(x.id) === String(id));
      if (row) Object.assign(row, patch);
    }
  }

  let nextStepTimer = null;
  function onCardClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    const id = el.getAttribute("data-id");
    if (action === "notes") openNotes(id);
  }

  // Debounce text next_step on input
  cardsEl.addEventListener("input", (e) => {
    const el = e.target;
    if (el.getAttribute("data-action") !== "next_step") return;
    clearTimeout(nextStepTimer);
    nextStepTimer = setTimeout(() => onCardChange({ target: el }), 450);
  });

  async function openNotes(leadId) {
    notesLeadId = leadId;
    const lead = leads.find((x) => String(x.id) === String(leadId));
    $("notes-title").textContent = "Notes — " + (lead ? lead.project_name_address : leadId);
    $("notes-list").innerHTML = "<p class='muted'>Loading…</p>";
    notesDialog.showModal();
    const { data, error } = await sb
      .from("lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    if (error) {
      $("notes-list").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
      return;
    }
    if (!data || !data.length) {
      $("notes-list").innerHTML = "<p class='muted'>No notes yet.</p>";
      return;
    }
    $("notes-list").innerHTML = data
      .map(
        (n) => `<div class="note"><div class="who">${esc(n.author || "—")} · ${esc(n.created_at || "")}</div>${esc(n.body)}</div>`
      )
      .join("");
  }

  $("note-save").addEventListener("click", async () => {
    const body = ($("note-body").value || "").trim();
    if (!body || !notesLeadId) return;
    const { error } = await sb.from("lead_notes").insert({
      lead_id: notesLeadId,
      body,
      author: currentUser && currentUser.email,
    });
    if (error) {
      alert("Note failed: " + error.message);
      return;
    }
    $("note-body").value = "";
    openNotes(notesLeadId);
    await sb.from("leads").update({
      last_touch: new Date().toISOString(),
      updated_by: currentUser && currentUser.email,
    }).eq("id", notesLeadId);
  });

  
  $("phone-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = ($("login-phone").value || "").trim();
    if (!phone) {
      authMsg.textContent = "Enter your phone number.";
      return;
    }
    authMsg.textContent = "Signing in…";
    try {
      const res = await fetch(cfg.url + "/functions/v1/phone-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.anonKey,
          Authorization: "Bearer " + cfg.anonKey,
        },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        authMsg.textContent = data.error || "Phone login failed.";
        return;
      }
      if (!data.access_token || !data.refresh_token) {
        authMsg.textContent = "Phone login failed.";
        return;
      }
      const { error } = await sb.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (error) {
        authMsg.textContent = error.message;
        return;
      }
      authMsg.textContent = "";
    } catch (err) {
      authMsg.textContent = "Network error. Try again.";
    }
  });

$("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = ($("login-email").value || "").trim().toLowerCase();
    authMsg.textContent = "Sending magic link…";
    const redirectTo = window.location.href.split("#")[0];
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (error) {
      authMsg.textContent = error.message;
      return;
    }
    authMsg.textContent = "Check your email for the magic link. Only allowlisted emails can see leads.";
  });

  btnSignout.addEventListener("click", async () => {
    await sb.auth.signOut();
    leads = [];
    showAuth();
  });

  ["search", "filter-state", "filter-rating", "filter-status", "filter-timing", "sort-by"].forEach((id) => {
    if (!$(id)) return;
    $(id).addEventListener("input", render);
    $(id).addEventListener("change", render);
  });

  sb.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      showCrm(session);
      await loadLeads();
    } else {
      showAuth();
    }
  });

  sb.auth.getSession().then(({ data }) => {
    if (data.session) {
      showCrm(data.session);
      loadLeads();
    } else {
      showAuth();
    }
  });
})();
