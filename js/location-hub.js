/*! Skyline 360 Park — location park hub (plans → waiver → plan list)
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  Reads this park's plans from SkylineParkRegistry so each location can
 *  keep different prices/waivers without changing the page layout.
 */
(() => {
  const hub = document.querySelector("[data-park-hub]");
  if (!hub) return;

  const parkId = hub.dataset.parkId;
  const registry = window.SkylineParkRegistry;
  const park = registry?.getPark?.(parkId) || null;
  const plans = Array.isArray(park?.plans) && park.plans.length
    ? park.plans
    : registry?.defaultPlans || [];

  const SELECTED_PARK_KEY = registry?.SELECTED_PARK_KEY || "skyline360_selected_park";
  const PLAN_INTENT_KEY = registry?.PLAN_INTENT_KEY || "skyline360_plan_intent";
  const FROM_GUIDE_KEY = registry?.FROM_GUIDE_KEY || "skyline360_from_guide";
  const AWAITING_KEY = registry?.AWAITING_KEY || "skyline360_awaiting_waiver_return";

  const hasWalkinPass = () => Boolean(registry?.hasValidWalkinPass?.(parkId));

  const refreshWalkinPassBanner = () => {
    const head = hub.querySelector(".park-hub-head");
    if (!head) return;
    let banner = hub.querySelector("[data-walkin-pass-banner]");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "park-walkin-pass-banner";
      banner.setAttribute("data-walkin-pass-banner", "");
      head.insertAdjacentElement("afterend", banner);
    }
    const lead = head.querySelector("p:not(.eyebrow)");
    if (!hasWalkinPass()) {
      banner.hidden = true;
      banner.innerHTML = "";
      if (lead && lead.dataset.defaultCopy) {
        lead.textContent = lead.dataset.defaultCopy;
      }
      return;
    }
    if (lead) {
      if (!lead.dataset.defaultCopy) lead.dataset.defaultCopy = lead.textContent || "";
      lead.textContent =
        "Walk-in waiver pass is active. Tap a plan to choose packages and book — no second waiver needed until the pass expires.";
    }
    const mins = Math.max(
      1,
      Math.round((Number(registry.walkinPassRemainingMs?.(parkId)) || 0) / 60000)
    );
    banner.hidden = false;
    banner.innerHTML = `
      <p><strong>Waiver pass active</strong> for this park (~${mins} min left). Choose any plan below — you don’t need to sign again until it expires.</p>
      <button type="button" class="waiver-link-confirm-change" data-walkin-new-guest>New guest (clear pass)</button>
    `;
    banner.querySelector("[data-walkin-new-guest]")?.addEventListener("click", () => {
      registry?.clearWalkinPass?.(parkId);
      refreshWalkinPassBanner();
      window.location.href =
        registry?.walkinWaiverHref?.(parkId) ||
        `waiver.html?mode=walkin&park=${encodeURIComponent(parkId)}`;
    });
  };

  const PLAN_DETAILS = Object.fromEntries(
    plans.map((plan) => [
      plan.id,
      {
        id: plan.id,
        title: plan.label || plan.title || plan.id,
        intro: plan.intro || plan.blurb || "",
        waiver: plan.waiver,
        bookingUrl: plan.bookingUrl || "",
        options: plan.options || [],
        localHref: plan.localHref || "",
        compareHref: plan.compareHref || "index.html#rates",
        compareLabel: plan.compareLabel || "Compare all rates",
        from: plan.from || "",
        blurb: plan.blurb || "",
      },
    ])
  );

  try {
    if (parkId) sessionStorage.setItem(SELECTED_PARK_KEY, parkId);
  } catch (_) {}

  let arrivedFromGuide = false;
  try {
    arrivedFromGuide = sessionStorage.getItem(FROM_GUIDE_KEY) === parkId;
    if (arrivedFromGuide) sessionStorage.removeItem(FROM_GUIDE_KEY);
  } catch (_) {}

  if (arrivedFromGuide || window.location.hash === "#plans") {
    window.requestAnimationFrame(() => {
      hub.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const eyebrow = hub.querySelector(".park-hub-head .eyebrow");
  if (eyebrow && park?.name) {
    eyebrow.textContent = `Your park · ${park.name}`;
  }

  const renderHub = () => {
    const grid = hub.querySelector(".park-plan-grid");
    const lists = hub.querySelector("[data-plan-lists]");
    if (!grid || !lists || !plans.length) return;

    grid.innerHTML = plans
      .map(
        (plan) => `
      <button type="button" class="park-plan-btn" data-plan-id="${plan.id}" aria-pressed="false">
        <strong>${plan.label}</strong>
        <span>${plan.blurb || ""}</span>
        <em>${plan.from || ""}</em>
      </button>`
      )
      .join("");

    lists.innerHTML = plans
      .map((plan) => {
        const options = (plan.options || [])
          .map((opt) => `<li><span>${opt.name}</span><strong>${opt.price}</strong></li>`)
          .join("");
        const secondaryHref = plan.localHref || plan.compareHref || "index.html#rates";
        const secondaryLabel = plan.localHref
          ? plan.compareLabel || "View party packages"
          : plan.compareLabel || "Compare all rates";
        return `
      <article class="park-plan-panel" id="plan-list-${plan.id}" data-plan-panel="${plan.id}" hidden>
        <h3>${plan.label} packages</h3>
        <p>${plan.intro || plan.blurb || ""}</p>
        <ul class="park-plan-options">${options}</ul>
        <div class="park-plan-cta">
          <a class="btn" href="${plan.waiver}">Sign / reopen waiver</a>
          <a class="btn btn-ghost-light" href="${secondaryHref}">${secondaryLabel}</a>
        </div>
      </article>`;
      })
      .join("");
  };

  renderHub();

  const buttons = hub.querySelectorAll("[data-plan-id]");
  const panels = hub.querySelectorAll("[data-plan-panel]");
  const stage = hub.querySelector("[data-plan-stage]");
  const stageTitle = hub.querySelector("[data-plan-stage-title]");
  const stageBody = hub.querySelector("[data-plan-stage-body]");

  const isLocalWaiver = (href) => {
    const raw = String(href || "");
    return /waiver\.html/i.test(raw) || raw.startsWith("waiver.html");
  };

  const waiverReturnUrl = (planId) => {
    const url = new URL(window.location.href.split("#")[0]);
    url.searchParams.set("from", "waiver");
    url.hash = `plan-list-${planId}`;
    return url.toString();
  };

  const buildWaiverUrl = (base, planId) => {
    if (isLocalWaiver(base)) {
      try {
        const url = new URL(base, window.location.href);
        if (parkId && !url.searchParams.get("park")) url.searchParams.set("park", parkId);
        if (planId && !url.searchParams.get("plan")) url.searchParams.set("plan", planId);
        return url.pathname.split("/").pop() + url.search + url.hash;
      } catch (_) {
        return base;
      }
    }
    try {
      const url = new URL(base);
      const ret = waiverReturnUrl(planId);
      url.searchParams.set("return_url", ret);
      url.searchParams.set("redirect_url", ret);
      url.searchParams.set("redirect", ret);
      return url.toString();
    } catch (_) {
      return base;
    }
  };

  const readJson = (key) => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const showPlanList = (planId, { fromWaiverReturn = false, walkinPass = false } = {}) => {
    const detail = PLAN_DETAILS[planId];
    if (!detail) return;
    const passOk = walkinPass || hasWalkinPass();

    panels.forEach((panel) => {
      const on = panel.dataset.planPanel === planId;
      panel.hidden = !on;
      panel.classList.toggle("is-active", on);
    });

    buttons.forEach((btn) => {
      const on = btn.dataset.planId === planId;
      btn.classList.toggle("is-selected", on);
      btn.setAttribute("aria-pressed", String(on));
    });

    if (stage) {
      stage.hidden = false;
      if (stageTitle) {
        stageTitle.textContent = passOk
          ? `Waiver done — choose your ${detail.title} package`
          : fromWaiverReturn
            ? `Welcome back — choose your ${detail.title} package`
            : `Choose your ${detail.title} package`;
      }
      if (stageBody) {
        stageBody.textContent = passOk
          ? "Your walk-in waiver covers this park. Pick a package below to book — no second waiver needed while your pass is active."
          : fromWaiverReturn
            ? "If you finished the waiver, pick the option that suits your pocket below. You can also reopen the waiver if needed."
            : "Next you’ll sign this plan’s waiver. After that, return here to pick the package that suits your pocket.";
      }
    }

    const activePanel = hub.querySelector(`#plan-list-${planId}`);
    const primaryCta = activePanel?.querySelector(".park-plan-cta a.btn:not(.btn-ghost-light)");
    if (primaryCta && detail) {
      if (passOk && detail.bookingUrl) {
        primaryCta.setAttribute("href", detail.bookingUrl);
        primaryCta.textContent = "Book this plan";
        primaryCta.target = "_blank";
        primaryCta.rel = "noopener noreferrer";
      } else if (detail.waiver) {
        primaryCta.setAttribute("href", buildWaiverUrl(detail.waiver, planId));
        primaryCta.textContent = "Sign / reopen waiver";
        primaryCta.removeAttribute("target");
      }
    }

    const target = activePanel || hub.querySelector("[data-plan-lists]");
    window.requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goToWaiver = (planId) => {
    const detail = PLAN_DETAILS[planId];
    if (!detail) return;
    // Walk-in / navbar pass: skip waiver and open packages for this plan.
    if (hasWalkinPass()) {
      showPlanList(planId, { fromWaiverReturn: true, walkinPass: true });
      return;
    }
    if (!detail.waiver) return;
    try {
      sessionStorage.setItem(
        PLAN_INTENT_KEY,
        JSON.stringify({ parkId, planId, at: Date.now() })
      );
      sessionStorage.setItem(
        AWAITING_KEY,
        JSON.stringify({ parkId, planId, at: Date.now() })
      );
    } catch (_) {}
    window.location.href = buildWaiverUrl(detail.waiver, planId);
  };

  panels.forEach((panel) => {
    const planId = panel.dataset.planPanel;
    const detail = PLAN_DETAILS[planId];
    if (!detail?.waiver) return;
    panel.querySelectorAll("a[href*='booking.skyline360park.com'], a.btn:not(.btn-ghost-light)").forEach((link) => {
      if (!/waiver|booking\.skyline360park\.com/i.test(link.getAttribute("href") || "") &&
          !/waiver/i.test(link.textContent || "")) {
        return;
      }
      link.setAttribute("href", buildWaiverUrl(detail.waiver, planId));
      link.removeAttribute("target");
      link.rel = "noopener noreferrer";
      if (/waiver/i.test(link.textContent || "")) {
        link.textContent = "Sign / reopen waiver";
      }
      link.addEventListener("click", (event) => {
        // If a walk-in pass is active, showPlanList may have rewritten this to booking —
        // do not stamp waiver intent for a booking click.
        const href = link.getAttribute("href") || "";
        if (hasWalkinPass() && detail.bookingUrl && href === detail.bookingUrl) {
          return;
        }
        if (/waiver\.html/i.test(href) === false && !/waiver/i.test(link.textContent || "")) {
          return;
        }
        try {
          sessionStorage.setItem(
            PLAN_INTENT_KEY,
            JSON.stringify({ parkId, planId, at: Date.now() })
          );
          sessionStorage.setItem(
            AWAITING_KEY,
            JSON.stringify({ parkId, planId, at: Date.now() })
          );
        } catch (_) {}
      });
    });
  });

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.planId;
      const mode = btn.dataset.planAction || "waiver";
      if (mode === "list") {
        showPlanList(id);
        return;
      }
      goToWaiver(id);
    });
  });

  const resolveReturnPlan = () => {
    const params = new URLSearchParams(window.location.search);
    const hash = (window.location.hash || "").replace(/^#/, "");
    const hashPlan = hash.startsWith("plan-list-") ? hash.slice("plan-list-".length) : null;
    const fromWaiver = params.get("from") === "waiver";
    const fromWalkin = params.get("from") === "walkin";
    const intent = readJson(PLAN_INTENT_KEY);
    const awaiting = readJson(AWAITING_KEY);

    const intentPlan =
      intent?.parkId === parkId && intent?.planId && PLAN_DETAILS[intent.planId]
        ? intent.planId
        : null;
    const awaitingPlan =
      awaiting?.parkId === parkId && awaiting?.planId && PLAN_DETAILS[awaiting.planId]
        ? awaiting.planId
        : null;

    // Explicit package deep-link (incl. guide → walk-in pass skip).
    if (hashPlan && PLAN_DETAILS[hashPlan]) {
      return {
        planId: hashPlan,
        fromWaiverReturn: fromWaiver || fromWalkin || Boolean(awaitingPlan),
      };
    }

    // After walk-in sign we land on #plans (all plans). Do not reopen a stale
    // plan-waiver "awaiting" panel from an earlier unfinished home-flow visit.
    if (fromWalkin) {
      try {
        sessionStorage.removeItem(AWAITING_KEY);
      } catch (_) {}
      return null;
    }

    if (fromWaiver && intentPlan) {
      return { planId: intentPlan, fromWaiverReturn: true };
    }
    if (awaitingPlan) {
      return { planId: awaitingPlan, fromWaiverReturn: true };
    }
    return null;
  };

  const applyReturnState = () => {
    const resolved = resolveReturnPlan();
    if (!resolved) return false;
    showPlanList(resolved.planId, {
      fromWaiverReturn: resolved.fromWaiverReturn,
      walkinPass: hasWalkinPass(),
    });
    try {
      sessionStorage.removeItem(AWAITING_KEY);
    } catch (_) {}
    return true;
  };

  refreshWalkinPassBanner();
  applyReturnState();

  const paramsNow = new URLSearchParams(window.location.search);
  if (paramsNow.get("from") === "walkin" || window.location.hash === "#plans") {
    window.requestAnimationFrame(() => {
      hub.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  window.addEventListener("pageshow", () => {
    refreshWalkinPassBanner();
    applyReturnState();
  });

  hub.querySelectorAll("[data-show-plan-list]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showPlanList(link.dataset.showPlanList);
    });
  });

  // "Also coming soon" links — same layout, filled from other parks in the registry
  const more = document.querySelector(".soon-more-links");
  if (more && registry?.parks?.length) {
    const others = registry.parks.filter((p) => p.id !== parkId);
    if (others.length) {
      more.innerHTML = others.map((p) => `<a href="${p.href}">${p.name}</a>`).join("\n            ");
    }
  }
})();
