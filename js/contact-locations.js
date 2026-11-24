/*! Skyline 360 Park — contact page multi-location cards
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  Fills Contact Information, message CTA, and map from SkylineParkRegistry.
 *  Each park uses its own form URL and map pin — never shared across locations.
 */
(() => {
  const registry = window.SkylineParkRegistry;
  if (!registry?.parks?.length) return;

  const root = document.querySelector("[data-contact-locations]");
  if (!root) return;

  const tabs = root.querySelector("[data-contact-tabs]");
  const grid = document.querySelector("[data-contact-grid]");
  const sub = document.querySelector("[data-contact-sub]");
  const pending = root.querySelector("[data-contact-pending]");
  const messageBtn = document.querySelector("[data-contact-message]");
  const messageBody = document.querySelector("[data-contact-message-body]");
  const messageTitle = document.querySelector("[data-contact-message-title]");
  const heroMessage = document.querySelector("[data-contact-hero-message]");
  const heroCall = document.querySelector("[data-contact-hero-call]");
  const heroLead = document.querySelector("[data-contact-hero-lead]");
  const mapFrame = document.querySelector("[data-contact-map]");
  const connectSub = document.querySelector("[data-contact-connect-sub]");
  if (!tabs || !grid) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get("park") || "").trim().toLowerCase();
  let activeId =
    (fromQuery && registry.getPark(fromQuery)?.id) ||
    registry.parks[0]?.id ||
    "";

  const icons = {
    phone: `<svg viewBox="0 0 48 48" fill="none"><path d="M14 10h8l3 9-5 3a22 22 0 0 0 10 10l3-5 9 3v8c0 1.5-1.2 3-3 3C22 41 7 26 7 13c0-1.8 1.5-3 3-3z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
    email: `<svg viewBox="0 0 48 48" fill="none"><rect x="8" y="12" width="32" height="24" rx="4" stroke="currentColor" stroke-width="2.5"/><path d="M10 16l14 11L38 16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    visit: `<svg viewBox="0 0 48 48" fill="none"><path d="M24 42s14-12.5 14-22a14 14 0 1 0-28 0c0 9.5 14 22 14 22z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="20" r="5" stroke="currentColor" stroke-width="2.5"/></svg>`,
    hours: `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2.5"/><path d="M24 14v11l7 4" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  const renderTabs = () => {
    tabs.innerHTML = registry.parks
      .map((park) => {
        const on = park.id === activeId;
        return `<button type="button" class="contact-loc-tab${on ? " is-active" : ""}" data-contact-park="${escapeHtml(park.id)}" aria-pressed="${on}">${escapeHtml(park.name)}</button>`;
      })
      .join("");

    tabs.querySelectorAll("[data-contact-park]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeId = btn.dataset.contactPark;
        render();
      });
    });
  };

  const renderCards = (park) => {
    const c = registry.getParkContact(park);
    const mapsUrl = `https://maps.google.com/maps?q=${encodeURIComponent(c.mapsQuery)}`;
    const parkPage = park.href || `location.html?id=${park.id}`;

    grid.innerHTML = `
      <article class="contact-info-card">
        <div class="contact-info-icon" aria-hidden="true">${icons.phone}</div>
        <p class="contact-info-label">Phone</p>
        <h3>Call the Park</h3>
        <p class="contact-info-detail"><a href="tel:${escapeHtml(c.phoneTel)}">${escapeHtml(c.phone)}</a></p>
        <p class="contact-info-note">${escapeHtml(c.phoneNote)}</p>
      </article>

      <article class="contact-info-card">
        <div class="contact-info-icon" aria-hidden="true">${icons.email}</div>
        <p class="contact-info-label">Email</p>
        <h3>Drop a Line</h3>
        <p class="contact-info-detail"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></p>
        <p class="contact-info-note">${escapeHtml(c.emailNote)}</p>
      </article>

      <article class="contact-info-card">
        <div class="contact-info-icon" aria-hidden="true">${icons.visit}</div>
        <p class="contact-info-label">Visit</p>
        <h3>Find the Park</h3>
        <p class="contact-info-detail">${c.addressHtml}</p>
        <p class="contact-info-note"><a href="${mapsUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.directionsLabel || "Get directions")}</a></p>
      </article>

      <article class="contact-info-card">
        <div class="contact-info-icon" aria-hidden="true">${icons.hours}</div>
        <p class="contact-info-label">Hours</p>
        <h3>When We&rsquo;re Open</h3>
        <p class="contact-info-detail">${c.hoursHtml}</p>
        <p class="contact-info-note"><a href="${escapeHtml(c.hoursNoteHref || parkPage)}">${escapeHtml(c.hoursNoteLabel || c.hoursNote || "Full hours & map")}</a></p>
      </article>
    `;
  };

  const syncMessageAndMap = (park, contact) => {
    if (messageBtn) {
      messageBtn.href = contact.messageFormUrl;
      messageBtn.setAttribute("aria-label", `Send a message to Skyline 360 Park ${park.name}`);
      messageBtn.dataset.parkId = park.id;
    }
    if (heroMessage) {
      heroMessage.href = contact.messageFormUrl;
      heroMessage.setAttribute("aria-label", `Send a message to Skyline 360 Park ${park.name}`);
      heroMessage.dataset.parkId = park.id;
    }
    if (heroCall) {
      heroCall.href = `tel:${contact.phoneTel}`;
      heroCall.setAttribute("aria-label", `Call Skyline 360 Park ${park.name} at ${contact.phone}`);
    }
    if (heroLead) {
      heroLead.textContent = `Questions about parties, tickets, groups, memberships, or your next visit to ${park.name}? Reach out any way you like - our friendly team is ready to help you plan the perfect adventure.`;
    }
    if (messageTitle) {
      messageTitle.textContent = `Want to Send Us a Message?`;
    }
    if (messageBody) {
      messageBody.textContent = `Tell us about birthday parties, group bookings, corporate events, memberships, or anything else for ${park.name}. Tap below to open this location's message form.`;
    }
    if (connectSub) {
      connectSub.textContent = `Be the first to hear about upcoming events, special promotions, and exclusive offers at ${park.name}.`;
    }
    if (mapFrame) {
      const embed = contact.mapEmbedUrl;
      const wrap = mapFrame.closest(".map-frame");
      mapFrame.dataset.src = embed;
      mapFrame.title = `Map to Skyline 360 Park - ${park.name}`;
      wrap?.classList.add("is-loading");
      wrap?.classList.remove("is-ready");
      mapFrame.setAttribute("loading", "eager");
      mapFrame.setAttribute("src", embed);
      const markReady = () => {
        wrap?.classList.remove("is-loading");
        wrap?.classList.add("is-ready");
      };
      mapFrame.addEventListener("load", markReady, { once: true });
      window.setTimeout(markReady, 2500);
    }
  };

  const render = () => {
    const park = registry.getPark(activeId) || registry.parks[0];
    if (!park) return;
    activeId = park.id;
    const contact = registry.getParkContact(park);

    renderTabs();
    renderCards(park);
    syncMessageAndMap(park, contact);

    if (sub) {
      sub.textContent = `Reach Skyline 360 Park - ${park.name}.`;
    }
    if (pending) {
      pending.hidden = !contact.isPlaceholder;
      pending.textContent = contact.isPlaceholder
        ? `Some details for ${park.name} are still being finalized. Shared contact info is shown until this location's full details are ready.`
        : "";
    }

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("park", park.id);
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  };

  render();
})();
