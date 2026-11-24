/*! Skyline 360 Park — multi-step waiver wizard
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 */
(() => {
  /** Production: required identity, agreement checkboxes, drawn signature, and typed legal name. */
  const WAIVER_TEST_MODE = false;

  const form = document.querySelector("[data-waiver-form]");
  if (!form) return;

  const registry = window.SkylineParkRegistry;
  const parks = registry?.parks || [];
  const params = new URLSearchParams(window.location.search);
  const walkinMode = String(params.get("mode") || "").trim().toLowerCase() === "walkin";

  const started = form.querySelector("[data-waiver-started]");
  const parkIdInput = form.querySelector("[data-waiver-park-id]");
  const planIdInput = form.querySelector("[data-waiver-plan-id]");
  const modeInput = form.querySelector("[data-waiver-mode]");
  const minorsJson = form.querySelector("[data-waiver-minors-json]");
  const parkSelect = form.querySelector("[data-waiver-park-select]");
  const planSelect = form.querySelector("[data-waiver-plan-select]");
  const statusEl = form.querySelector("[data-waiver-status]");
  const success = document.querySelector("[data-waiver-success]");
  const progress = document.querySelector("[data-waiver-progress]");
  const progressText = document.querySelector("[data-waiver-progress-text]");
  const captchaBoard = form.querySelector("[data-waiver-captcha-board]");
  const captchaInput = form.querySelector("[data-waiver-captcha-input]");
  const captchaToken = form.querySelector("[data-waiver-captcha-token]");
  const captchaRefresh = form.querySelector("[data-waiver-captcha-refresh]");
  const minorsList = form.querySelector("[data-waiver-minors-list]");
  const minorsWrap = form.querySelector("[data-waiver-minors-wrap]");
  const dobHidden = form.querySelector("[data-waiver-dob]");
  const phoneWrap = form.querySelector("[data-waiver-phone]");
  const dialToggle = form.querySelector("[data-waiver-dial-toggle]");
  const dialPanel = form.querySelector("[data-waiver-dial-panel]");
  const dialSearch = form.querySelector("[data-waiver-dial-search]");
  const dialList = form.querySelector("[data-waiver-dial-list]");
  const dialFlag = form.querySelector("[data-waiver-dial-flag]");
  const dialCodeLabel = form.querySelector("[data-waiver-dial-code]");
  const countryCodeInput = form.querySelector("[data-waiver-country-code]");
  const countryIsoInput = form.querySelector("[data-waiver-country-iso]");

  let step = "location";
  let captchaCode = "";
  let captchaTokenValue = "";
  let minorCount = 0;
  const MAX_MINORS = 15;
  /** Minors last read from a document scan — reapplied when guest picks “Me and minor(s)”. */
  let lastScannedMinors = [];
  let selectedDial = { iso: "US", name: "United States", dial: "+1", flag: "🇺🇸" };
  /** Shared ?park=&plan= link: require explicit confirm before leaving Location. */
  let deepLinkActive = false;
  let deepLinkConfirmed = false;
  let deepLinkParkId = "";
  let deepLinkPlanId = "";

  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const dialCountries = () => window.SkylineCountryDial?.countries || [];

  const setDialCountry = (country) => {
    if (!country) return;
    selectedDial = country;
    if (dialFlag) dialFlag.textContent = country.flag || "";
    if (dialCodeLabel) dialCodeLabel.textContent = country.dial || "";
    if (countryCodeInput) countryCodeInput.value = country.dial || "";
    if (countryIsoInput) countryIsoInput.value = country.iso || "";
    if (dialToggle) {
      dialToggle.setAttribute(
        "aria-label",
        `Country code ${country.name} ${country.dial}`
      );
    }
  };

  const closeDialPanel = () => {
    if (!dialPanel) return;
    dialPanel.hidden = true;
    dialToggle?.setAttribute("aria-expanded", "false");
    phoneWrap?.classList.remove("is-open");
  };

  const openDialPanel = () => {
    if (!dialPanel) return;
    dialPanel.hidden = false;
    dialToggle?.setAttribute("aria-expanded", "true");
    phoneWrap?.classList.add("is-open");
    if (dialSearch) {
      dialSearch.value = "";
      renderDialList("");
      window.requestAnimationFrame(() => dialSearch.focus());
    }
  };

  const renderDialList = (query = "") => {
    if (!dialList) return;
    const q = String(query || "").trim().toLowerCase();
    const items = dialCountries().filter((c) => !q || c.search.includes(q));
    if (!items.length) {
      dialList.innerHTML = `<li class="waiver-dial-empty">No countries match “${query}”</li>`;
      return;
    }
    dialList.innerHTML = items
      .map(
        (c) => `<li>
        <button type="button" class="waiver-dial-option" data-iso="${c.iso}" role="option">
          <span class="waiver-dial-option-flag">${c.flag}</span>
          <span class="waiver-dial-option-name">${c.name}</span>
          <span class="waiver-dial-option-code">${c.dial}</span>
        </button>
      </li>`
      )
      .join("");
  };

  const initCountryDial = () => {
    const list = dialCountries();
    if (!list.length || !dialToggle) return;
    const us = list.find((c) => c.iso === "US") || list[0];
    setDialCountry(us);
    renderDialList("");

    dialToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (dialPanel?.hidden) openDialPanel();
      else closeDialPanel();
    });

    dialSearch?.addEventListener("input", () => {
      renderDialList(dialSearch.value);
    });

    dialList?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-iso]");
      if (!btn) return;
      const country = list.find((c) => c.iso === btn.dataset.iso);
      if (!country) return;
      setDialCountry(country);
      closeDialPanel();
      form.querySelector('[name="phone"]')?.focus();
    });

    document.addEventListener("click", (event) => {
      if (!phoneWrap || phoneWrap.contains(event.target)) return;
      closeDialPanel();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDialPanel();
    });
  };

  /** Live address suggestions (Photon) for search + manual fields */
  const GEOCODE_URL = "https://photon.komoot.io/api/";
  const addrSearchInput = form.querySelector("[data-waiver-address-search]");
  const addrStreetInput = form.querySelector("[data-waiver-address]");
  const addrCityInput = form.querySelector("[data-waiver-city]");
  const addrStateInput = form.querySelector("[data-waiver-state]");
  const addrZipInput = form.querySelector("[data-waiver-zip]");
  const manualFields = form.querySelector("[data-waiver-manual-fields]");
  const manualToggle = form.querySelector("[data-waiver-manual-address]");

  let addrTimer = null;
  let addrController = null;
  let addrActiveKey = "";
  let addrItems = [];

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const hideAllAddrSuggest = () => {
    form.querySelectorAll("[data-waiver-addr-suggest]").forEach((box) => {
      box.hidden = true;
      box.innerHTML = "";
    });
    addrItems = [];
    addrActiveKey = "";
  };

  const suggestBoxFor = (key) =>
    form.querySelector(`[data-waiver-addr-suggest="${key}"]`);

  const parsePhotonFeature = (feature) => {
    const props = feature?.properties || {};
    const street = [props.housenumber, props.street || props.name].filter(Boolean).join(" ").trim();
    const city = props.city || props.town || props.village || props.county || "";
    const state = props.state || props.county || "";
    const zip = props.postcode || "";
    const country = props.country || "";
    const label = [street || props.name, city, state, zip, country].filter(Boolean).join(", ");
    return { street: street || props.name || "", city, state, zip, country, label };
  };

  const geocodeAddress = async (query, { signal, layer } = {}) => {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("lang", "en");
    if (layer === "city") url.searchParams.set("layer", "city");
    if (layer === "state") url.searchParams.set("osm_tag", "place:state");
    if (layer === "zip") url.searchParams.set("osm_tag", "place:postcode");
    const response = await fetch(url.toString(), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("geocode failed");
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return features.map(parsePhotonFeature).filter((p) => p.label);
  };

  const applyAddressPlace = (place, sourceKey) => {
    if (!place) return;
    if (manualToggle && !manualToggle.checked) {
      manualToggle.checked = true;
      if (manualFields) manualFields.hidden = false;
    }
    if (addrSearchInput && (sourceKey === "search" || !addrSearchInput.value.trim())) {
      addrSearchInput.value = place.label;
    }
    if (addrStreetInput && (place.street || sourceKey === "street" || sourceKey === "search")) {
      addrStreetInput.value = place.street || place.label.split(",")[0] || addrStreetInput.value;
    }
    if (addrCityInput && place.city) addrCityInput.value = place.city;
    if (addrStateInput && place.state) addrStateInput.value = place.state;
    if (addrZipInput && place.zip) addrZipInput.value = place.zip;
    hideAllAddrSuggest();
    if (typeof paintCurrentMissing === "function") paintCurrentMissing();
  };

  const showAddrSuggest = (key, places) => {
    const box = suggestBoxFor(key);
    if (!box) return;
    addrItems = places.slice(0, 7);
    addrActiveKey = key;
    if (!addrItems.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = addrItems
      .map(
        (place, index) =>
          `<button type="button" class="waiver-addr-suggest-item" role="option" data-addr-index="${index}">
            <strong>${escapeHtml(place.label.split(",")[0] || place.label)}</strong>
            <span>${escapeHtml(place.label)}</span>
          </button>`
      )
      .join("");
    box.querySelectorAll("[data-addr-index]").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const place = addrItems[Number(btn.dataset.addrIndex)];
        applyAddressPlace(place, key);
      });
    });
  };

  const runAddrSuggest = async (key, rawQuery) => {
    const q = String(rawQuery || "").trim();
    if (q.length < 2) {
      hideAllAddrSuggest();
      return;
    }
    // Build smarter query from sibling fields when typing city/state/zip
    let query = q;
    let layer;
    if (key === "city") {
      layer = "city";
      const state = addrStateInput?.value.trim();
      if (state) query = `${q}, ${state}`;
    } else if (key === "state") {
      layer = "state";
    } else if (key === "zip") {
      layer = "zip";
      const city = addrCityInput?.value.trim();
      const state = addrStateInput?.value.trim();
      query = [q, city, state].filter(Boolean).join(", ");
    } else if (key === "street") {
      const city = addrCityInput?.value.trim();
      const state = addrStateInput?.value.trim();
      query = [q, city, state].filter(Boolean).join(", ");
    }

    addrController?.abort();
    addrController = new AbortController();
    try {
      const places = await geocodeAddress(query, {
        signal: addrController.signal,
        layer,
      });
      // Prefer places that match the typed fragment
      const filtered =
        key === "city"
          ? places.filter((p) => p.city)
          : key === "state"
            ? places.filter((p) => p.state)
            : key === "zip"
              ? places.filter((p) => p.zip || p.label.includes(q))
              : places;
      showAddrSuggest(key, filtered.length ? filtered : places);
    } catch (error) {
      if (error?.name !== "AbortError") hideAllAddrSuggest();
    }
  };

  const bindAddrSuggestInput = (input, key) => {
    if (!input) return;
    input.addEventListener("input", () => {
      window.clearTimeout(addrTimer);
      addrTimer = window.setTimeout(() => runAddrSuggest(key, input.value), 280);
    });
    input.addEventListener("focus", () => {
      if (String(input.value || "").trim().length >= 2) {
        runAddrSuggest(key, input.value);
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideAllAddrSuggest();
      if (event.key === "Enter" && addrActiveKey === key && addrItems[0]) {
        event.preventDefault();
        applyAddressPlace(addrItems[0], key);
      }
    });
  };

  const initAddressSuggest = () => {
    bindAddrSuggestInput(addrSearchInput, "search");
    bindAddrSuggestInput(addrStreetInput, "street");
    bindAddrSuggestInput(addrCityInput, "city");
    bindAddrSuggestInput(addrStateInput, "state");
    bindAddrSuggestInput(addrZipInput, "zip");

    document.addEventListener("click", (event) => {
      if (event.target.closest(".waiver-suggest-field")) return;
      hideAllAddrSuggest();
    });
  };

  const setStatus = (message, kind = "") => {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", kind === "error");
    statusEl.classList.toggle("is-visible", Boolean(message));
  };

  const kickDeliverMail = async (jobId) => {
    const id = String(jobId || "").trim();
    if (!id) return false;
    const url = `waiver-mail.php?deliver=${encodeURIComponent(id)}`;
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url);
      }
    } catch (_) {}
    try {
      fetch(url, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      return true;
    } catch (_) {
      return false;
    }
  };

  /** Kick mail delivery now and again shortly — guest copies can lag a few seconds. */
  const scheduleDeliverRetries = (jobId) => {
    const id = String(jobId || "").trim();
    if (!id) return;
    kickDeliverMail(id);
    window.setTimeout(() => kickDeliverMail(id), 1500);
    window.setTimeout(() => kickDeliverMail(id), 4000);
  };

  const currentPark = () => registry?.getPark?.(parkIdInput?.value) || null;
  const currentPlan = () => {
    if (walkinMode) {
      return {
        id: "walkin",
        label: "Walk-in",
        bookingUrl: "",
      };
    }
    const park = currentPark();
    return park?.plans?.find((p) => p.id === planIdInput?.value) || null;
  };

  const fillDobSelects = (root = form) => {
    initDobPickers(root);
  };

  const dobOptionsFor = (kind) => {
    if (kind === "month") {
      return MONTHS.map((name, i) => ({
        value: String(i + 1).padStart(2, "0"),
        label: name,
        search: `${name} ${i + 1} ${String(i + 1).padStart(2, "0")}`.toLowerCase(),
      }));
    }
    if (kind === "day") {
      return Array.from({ length: 31 }, (_, i) => {
        const n = i + 1;
        const value = String(n).padStart(2, "0");
        return { value, label: String(n), search: `${n} ${value}`.toLowerCase() };
      });
    }
    const now = new Date().getFullYear();
    return Array.from({ length: 101 }, (_, i) => {
      const y = String(now - i);
      return { value: y, label: y, search: y };
    });
  };

  const closeDobPanels = (except = null) => {
    form.querySelectorAll("[data-dob-pick]").forEach((pick) => {
      if (except && pick === except) return;
      const panel = pick.querySelector("[data-dob-panel]");
      const toggle = pick.querySelector("[data-dob-toggle]");
      if (panel) panel.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
      pick.classList.remove("is-open");
    });
  };

  const renderDobList = (pick, query = "") => {
    const kind = pick.dataset.dobPick;
    const list = pick.querySelector("[data-dob-list]");
    if (!list || !kind) return;
    const q = String(query || "").trim().toLowerCase();
    const options = dobOptionsFor(kind).filter((opt) => !q || opt.search.includes(q));
    if (!options.length) {
      list.innerHTML = `<li class="waiver-dial-empty">No matches</li>`;
      return;
    }
    const current = pick.querySelector("input[type='hidden']")?.value || "";
    list.innerHTML = options
      .map(
        (opt) => `<li>
        <button type="button" class="waiver-dob-option${opt.value === current ? " is-selected" : ""}" data-dob-value="${opt.value}" role="option">
          ${opt.label}
        </button>
      </li>`
      )
      .join("");
  };

  const setDobPickValue = (pick, value, label) => {
    const hidden = pick.querySelector("input[type='hidden']");
    const labelEl = pick.querySelector("[data-dob-label]");
    if (hidden) hidden.value = value || "";
    if (labelEl) {
      if (value) {
        labelEl.textContent = label || value;
        labelEl.classList.add("has-value");
      } else {
        const kind = pick.dataset.dobPick;
        labelEl.textContent = kind === "month" ? "Month*" : kind === "day" ? "Day*" : "Year*";
        labelEl.classList.remove("has-value");
      }
    }
    composeDob();
    if (typeof paintCurrentMissing === "function") paintCurrentMissing();
  };

  const wireDobPick = (pick) => {
    if (!pick || pick.dataset.dobReady === "1") return;
    pick.dataset.dobReady = "1";
    const toggle = pick.querySelector("[data-dob-toggle]");
    const panel = pick.querySelector("[data-dob-panel]");
    const search = pick.querySelector("[data-dob-search]");
    const list = pick.querySelector("[data-dob-list]");
    const kind = pick.dataset.dobPick;
    const placeholder = kind === "month" ? "Search month…" : kind === "day" ? "Search day…" : "Search year…";
    if (search) search.placeholder = placeholder;

    toggle?.addEventListener("click", (event) => {
      event.preventDefault();
      const open = panel && !panel.hidden;
      closeDobPanels();
      if (!open && panel) {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        pick.classList.add("is-open");
        if (search) {
          search.value = "";
          renderDobList(pick, "");
          window.requestAnimationFrame(() => search.focus());
        } else {
          renderDobList(pick, "");
        }
      }
    });

    search?.addEventListener("input", () => renderDobList(pick, search.value));

    list?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-dob-value]");
      if (!btn) return;
      setDobPickValue(pick, btn.dataset.dobValue, btn.textContent.trim());
      closeDobPanels();
    });
  };

  const initDobPickers = (root = form) => {
    root.querySelectorAll("[data-dob-pick]").forEach(wireDobPick);
  };

  const dobPickMarkup = (kind, attrs = "") => {
    const title = kind === "month" ? "Month*" : kind === "day" ? "Day*" : "Year*";
    const searchPh = kind === "month" ? "Search month…" : kind === "day" ? "Search day…" : "Search year…";
    const hiddenAttrs =
      kind === "month"
        ? `data-waiver-dob-month data-minor-month ${attrs}`
        : kind === "day"
          ? `data-waiver-dob-day data-minor-day ${attrs}`
          : `data-waiver-dob-year data-minor-year ${attrs}`;
    return `<div class="waiver-dob-pick" data-dob-pick="${kind}">
      <input type="hidden" ${hiddenAttrs} value="">
      <button type="button" class="waiver-dob-toggle" data-dob-toggle aria-haspopup="listbox" aria-expanded="false">
        <span data-dob-label>${title}</span>
        <span class="waiver-phone-caret" aria-hidden="true">▾</span>
      </button>
      <div class="waiver-dob-panel" data-dob-panel hidden>
        <input type="search" class="waiver-dob-search" data-dob-search placeholder="${searchPh}" autocomplete="off">
        <ul class="waiver-dob-list" data-dob-list role="listbox"></ul>
      </div>
    </div>`;
  };

  const composeDob = () => {
    const group = form.querySelector("[data-waiver-dob-group]") || form;
    const m = group.querySelector("[data-waiver-dob-month]")?.value || "";
    const d = group.querySelector("[data-waiver-dob-day]")?.value || "";
    const y = group.querySelector("[data-waiver-dob-year]")?.value || "";
    if (dobHidden) dobHidden.value = m && d && y ? `${y}-${m}-${d}` : "";
    return dobHidden?.value || "";
  };

  const populateParks = () => {
    if (!parkSelect) return;
    parks.forEach((park) => {
      const opt = document.createElement("option");
      opt.value = park.id;
      opt.textContent = park.name;
      parkSelect.appendChild(opt);
    });
  };

  const populatePlans = (parkId) => {
    if (!planSelect) return;
    planSelect.innerHTML = '<option value="">Choose a plan…</option>';
    const park = registry?.getPark?.(parkId);
    (park?.plans || []).forEach((plan) => {
      const opt = document.createElement("option");
      opt.value = plan.id;
      opt.textContent = plan.label;
      planSelect.appendChild(opt);
    });
  };

  const syncTitles = () => {
    const park = currentPark();
    const plan = currentPlan();
    const parkName = park ? park.name || park.shortName : "";
    const planName = plan?.label || "";
    const title = park
      ? planName
        ? `${parkName} · ${planName}`
        : `${parkName} Waiver`
      : "Sign your waiver";
    const fullLabel = park
      ? `${parkName} Waiver${planName ? ` · ${planName}` : ""}`
      : "Waiver";

    document.querySelectorAll("[data-waiver-loc-title], [data-waiver-legal-back]").forEach((el) => {
      el.textContent = fullLabel;
    });

    document.querySelectorAll("[data-waiver-context-title]").forEach((el) => {
      el.textContent = title;
    });

    document.querySelectorAll("[data-waiver-plan-label]").forEach((el) => {
      if (!planName) {
        el.hidden = true;
        el.textContent = "";
        return;
      }
      el.hidden = false;
      el.textContent = `Signing for: ${planName}`;
    });

    const entity = document.querySelector("[data-waiver-legal-entity]");
    if (entity && park) {
      entity.textContent = `SKYLINE 360 PARK — ${String(park.name).toUpperCase()} (“SKYLINE”)`;
    }

    document.title = park
      ? `Sign Waiver | ${parkName}${planName ? ` · ${planName}` : ""} | Skyline 360 Park`
      : "Sign Waiver | Skyline 360 Park";
  };

  const showStep = (name) => {
    const prevStep = step;
    step = name;
    form.querySelectorAll("[data-waiver-step]").forEach((section) => {
      section.hidden = section.dataset.waiverStep !== name;
    });
    // Progress rail stays 4 dots; "method" maps onto Details
    const railOrder = ["location", "email", "details", "legal"];
    const railName = name === "method" ? "details" : name;
    const idx = railOrder.indexOf(railName);
    document.querySelectorAll("[data-rail]").forEach((dot) => {
      const i = railOrder.indexOf(dot.dataset.rail);
      const active = i === idx;
      let isDone = false;
      if (name === "email") isDone = i === 0;
      else if (name === "method") isDone = i <= 1;
      else if (name === "details") isDone = i <= 1;
      else if (name === "legal") isDone = i <= 2;
      dot.classList.toggle("is-active", active);
      dot.classList.toggle("is-done", isDone && !active);
      const canGo =
        (name === "location" && i === 0) ||
        (name === "email" && i <= 1) ||
        (name === "method" && i <= 1) ||
        (name === "details" && i <= 2) ||
        (name === "legal" && i <= 3);
      dot.disabled = !canGo;
      dot.style.cursor = canGo ? "pointer" : "default";
    });
    if (progress) progress.hidden = name !== "legal";
    // Only reset capture UI when entering method from another step (not when rail re-selects method).
    if (name === "method" && prevStep !== "method" && typeof resetMethodStep === "function") {
      resetMethodStep();
    }
    if (name === "legal") {
      // Smart: carry scanned/typed name into the legal signature name field if empty
      if (typeof prefillsLegalNameFromGuest === "function") {
        prefillsLegalNameFromGuest();
      }
      updateProgress();
      if (!captchaCode || !captchaTokenValue) {
        rollCaptcha();
      }
      window.requestAnimationFrame(() => {
        resizeSignatureCanvas();
      });
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyMode = (mode) => {
    if (modeInput) modeInput.value = mode;
    form.querySelectorAll("[data-waiver-mode-btn]").forEach((btn) => {
      const on = btn.dataset.waiverModeBtn === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    const kicker = document.querySelector("[data-waiver-details-kicker]");
    if (kicker) {
      kicker.textContent = mode === "minors" ? "Your details (guardian)" : "Your details";
    }
    if (minorsWrap) minorsWrap.hidden = mode !== "minors";
    if (mode === "self") {
      // Just me: keep adult fields, drop minors so submit stays clean
      minorCount = 0;
      if (minorsList) minorsList.innerHTML = "";
      if (minorsJson) minorsJson.value = "[]";
    } else if (mode === "minors") {
      if (lastScannedMinors.length) {
        applyScannedMinors(lastScannedMinors, { silent: true });
      } else if (!minorsList?.querySelector(".waiver-minor")) {
        addMinor();
      }
    }
  };

  const fillMinorBlock = (block, preset) => {
    if (!block || !preset) return;
    const firstEl = block.querySelector("[data-minor-first]");
    const lastEl = block.querySelector("[data-minor-last]");
    if (firstEl && preset.first_name) {
      firstEl.value = String(preset.first_name).slice(0, 80);
      firstEl.classList.add("is-id-filled");
    }
    if (lastEl && preset.last_name) {
      lastEl.value = String(preset.last_name).slice(0, 80);
      lastEl.classList.add("is-id-filled");
    }
    const monthPick = block.querySelector('[data-dob-pick="month"]');
    const dayPick = block.querySelector('[data-dob-pick="day"]');
    const yearPick = block.querySelector('[data-dob-pick="year"]');
    if (preset.dob_month && monthPick) {
      const label = MONTHS[Number(preset.dob_month) - 1] || preset.dob_month;
      setDobPickValue(monthPick, preset.dob_month, label);
      monthPick.classList.add("is-id-filled");
    }
    if (preset.dob_day && dayPick) {
      setDobPickValue(dayPick, preset.dob_day, String(Number(preset.dob_day)));
      dayPick.classList.add("is-id-filled");
    }
    if (preset.dob_year && yearPick) {
      setDobPickValue(yearPick, preset.dob_year, preset.dob_year);
      yearPick.classList.add("is-id-filled");
    }
  };

  const addMinor = (preset) => {
    if (!minorsList) return null;
    const existing = minorsList.querySelectorAll(".waiver-minor").length;
    if (existing >= MAX_MINORS) return null;
    minorCount += 1;
    const id = minorCount;
    const block = document.createElement("div");
    block.className = "waiver-minor";
    block.dataset.minorId = String(id);
    block.innerHTML = `
      <div class="waiver-minor-head">
        <strong>Minor ${id}</strong>
        <button type="button" class="waiver-remove" data-remove-minor>✕ Remove</button>
      </div>
      <div class="waiver-row-2">
        <label class="waiver-input-wrap"><input type="text" data-minor-first maxlength="80" placeholder="First name*"></label>
        <label class="waiver-input-wrap"><input type="text" data-minor-last maxlength="80" placeholder="Last name*"></label>
      </div>
      <p class="waiver-mini-label">Date of birth</p>
      <div class="waiver-dob">
        ${dobPickMarkup("month")}
        ${dobPickMarkup("day")}
        ${dobPickMarkup("year")}
      </div>`;
    minorsList.appendChild(block);
    initDobPickers(block);
    if (preset) fillMinorBlock(block, preset);
    renumberMinors();
    syncAddMinorButton();
    return block;
  };

  const syncAddMinorButton = () => {
    const btn = form.querySelector("[data-waiver-add-minor]");
    if (!btn || !minorsList) return;
    const count = minorsList.querySelectorAll(".waiver-minor").length;
    btn.disabled = count >= MAX_MINORS;
    btn.textContent = count >= MAX_MINORS ? `Maximum ${MAX_MINORS} minors` : "+ Add a minor";
  };

  /**
   * Rebuild minor rows from a scanned document list (max 15).
   * Only used when mode is “Me and minor(s)”.
   */
  const applyScannedMinors = (minors, opts = {}) => {
    if (!minorsList || !Array.isArray(minors) || !minors.length) return 0;
    const usable = minors
      .filter((m) => m && (m.first_name || m.last_name))
      .slice(0, MAX_MINORS);
    if (!usable.length) return 0;
    minorsList.innerHTML = "";
    minorCount = 0;
    usable.forEach((m) => addMinor(m));
    if (minorsJson) minorsJson.value = JSON.stringify(collectMinors());
    syncAddMinorButton();
    if (!opts.silent && minorsWrap) {
      setHiddenEl(minorsWrap, false);
    }
    return usable.length;
  };

  const renumberMinors = () => {
    if (!minorsList) return;
    [...minorsList.querySelectorAll(".waiver-minor")].forEach((el, i) => {
      const head = el.querySelector(".waiver-minor-head strong");
      if (head) head.textContent = `Minor ${i + 1}`;
    });
  };

  const collectMinors = () => {
    if (modeInput?.value !== "minors" || !minorsList) return [];
    return [...minorsList.querySelectorAll(".waiver-minor")].map((el) => {
      const first = el.querySelector("[data-minor-first]")?.value.trim() || "";
      const last = el.querySelector("[data-minor-last]")?.value.trim() || "";
      const m = el.querySelector("[data-minor-month]")?.value || "";
      const d = el.querySelector("[data-minor-day]")?.value || "";
      const y = el.querySelector("[data-minor-year]")?.value || "";
      return {
        first_name: first,
        last_name: last,
        dob: m && d && y ? `${y}-${m}-${d}` : "",
      };
    });
  };

  const checkboxNodes = () => [...form.querySelectorAll("[data-waiver-cb]")];

  let showMissing = false;

  const missingBox = (el) => {
    if (!el) return null;
    if (el.matches("[data-waiver-cb]")) return el.closest(".waiver-legal-check") || el;
    if (el.closest("[data-waiver-phone]") && (el.name === "phone" || el.hasAttribute("data-waiver-phone"))) {
      return el.closest("[data-waiver-phone]");
    }
    if (el.closest("[data-dob-pick]")) return el.closest("[data-dob-pick]");
    if (el.closest("[data-waiver-sign-pad]")) return el.closest("[data-waiver-sign-pad]");
    if (el.matches("[data-waiver-captcha-input]")) return el.closest(".franchise-captcha-row") || el;
    if (el.matches("select")) return el;
    return el.closest(".waiver-input-wrap") || el;
  };

  const markMissing = (el, missing) => {
    if (!el) return;
    const box = missingBox(el);
    box?.classList.toggle("is-missing", !!missing);
    if (el !== box) el.classList.toggle("is-missing", !!missing);
    if (el.matches?.("input, select, textarea")) {
      el.setAttribute("aria-invalid", missing ? "true" : "false");
    }
  };

  const scrollToMissing = () => {
    const section = form.querySelector("[data-waiver-step]:not([hidden])");
    const el = section?.querySelector(".is-missing");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = el.matches("input, select, textarea, button")
      ? el
      : el.querySelector("input:not([type='hidden']), select, textarea, button, [data-dob-toggle]");
    try {
      focusable?.focus({ preventScroll: true });
    } catch (_) {
      focusable?.focus();
    }
  };

  const highlightDobGroup = (root) => {
    if (!root) return true;
    let ok = true;
    root.querySelectorAll("[data-dob-pick]").forEach((pick) => {
      const hidden = pick.querySelector("input[type='hidden']");
      const bad = !String(hidden?.value || "").trim();
      markMissing(pick, bad);
      if (bad) ok = false;
    });
    return ok;
  };

  const highlightLocation = () => {
    const parkBad = !parkSelect?.value;
    const planBad = walkinMode ? false : !planSelect?.value;
    markMissing(parkSelect, parkBad);
    markMissing(planSelect, planBad);
    return !parkBad && !planBad;
  };

  const highlightEmail = () => {
    const input = form.querySelector("[data-waiver-email]");
    const value = String(input?.value || "").trim();
    const bad = !value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    markMissing(input, bad);
    return !bad;
  };

  const highlightDetails = () => {
    const first = form.querySelector('[name="first_name"]');
    const last = form.querySelector('[name="last_name"]');
    const phone = form.querySelector('[name="phone"]');
    const search = form.querySelector("[data-waiver-address-search]");
    const address = form.querySelector("[data-waiver-address]");
    const city = form.querySelector("[data-waiver-city]");
    const state = form.querySelector("[data-waiver-state]");
    const zip = form.querySelector("[data-waiver-zip]");
    const emergencyName = form.querySelector('[name="emergency_name"]');
    const emergencyPhone = form.querySelector('[name="emergency_phone"]');
    const manual = form.querySelector("[data-waiver-manual-address]")?.checked;
    const guestDob = form.querySelector("[data-waiver-dob-group]");

    let ok = true;
    const need = (el, bad) => {
      markMissing(el, bad);
      if (bad) ok = false;
    };

    need(first, !String(first?.value || "").trim());
    need(last, !String(last?.value || "").trim());
    need(phone, !String(phone?.value || "").trim());
    if (!highlightDobGroup(guestDob)) ok = false;

    const searchVal = String(search?.value || "").trim();
    const addressVal = String(address?.value || "").trim();
    const cityVal = String(city?.value || "").trim();
    const stateVal = String(state?.value || "").trim();
    const zipVal = String(zip?.value || "").trim();

    if (manual) {
      need(search, false);
      need(address, !addressVal);
      need(city, !cityVal);
      need(state, !stateVal);
      need(zip, !zipVal);
    } else {
      need(search, !searchVal);
      if (searchVal && address && !addressVal) address.value = searchVal;
      if (searchVal && (!cityVal || !stateVal || !zipVal)) {
        const manualBox = form.querySelector("[data-waiver-manual-address]");
        const manualFields = form.querySelector("[data-waiver-manual-fields]");
        if (manualBox) manualBox.checked = true;
        if (manualFields) manualFields.hidden = false;
        need(city, !cityVal);
        need(state, !stateVal);
        need(zip, !zipVal);
      } else {
        need(address, false);
        need(city, false);
        need(state, false);
        need(zip, false);
      }
    }

    need(emergencyName, !String(emergencyName?.value || "").trim());
    need(emergencyPhone, !String(emergencyPhone?.value || "").trim());

    if (modeInput?.value === "minors") {
      const blocks = [...(minorsList?.querySelectorAll(".waiver-minor") || [])];
      if (!blocks.length) ok = false;
      blocks.forEach((block) => {
        need(block.querySelector("[data-minor-first]"), !String(block.querySelector("[data-minor-first]")?.value || "").trim());
        need(block.querySelector("[data-minor-last]"), !String(block.querySelector("[data-minor-last]")?.value || "").trim());
        if (!highlightDobGroup(block.querySelector(".waiver-dob"))) ok = false;
      });
    }

    return ok;
  };

  const highlightLegal = () => {
    let ok = true;
    checkboxNodes().forEach((box) => {
      const bad = !box.checked;
      markMissing(box, bad);
      if (bad) ok = false;
    });
    const pad = form.querySelector("[data-waiver-sign-pad]");
    const drawn = typeof hasDrawnSignature === "function" && hasDrawnSignature();
    if (pad) {
      pad.classList.toggle("is-missing", !drawn);
      if (!drawn) ok = false;
    }
    const signature = form.querySelector('[name="signature"]');
    const first = String(form.querySelector('[name="first_name"]')?.value || "").trim();
    const last = String(form.querySelector('[name="last_name"]')?.value || "").trim();
    const typed = String(signature?.value || "").trim();
    const nameBad = !typed || typed.toLowerCase() !== `${first} ${last}`.toLowerCase();
    markMissing(signature, nameBad);
    if (nameBad) ok = false;

    if (window.location.protocol !== "file:") {
      const given = String(captchaInput?.value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const captchaBad =
        given.length !== 6 ||
        !captchaCode ||
        !captchaTokenValue ||
        given !== captchaCode;
      markMissing(captchaInput, captchaBad);
      if (captchaBad) ok = false;
    } else {
      markMissing(captchaInput, false);
    }
    return ok;
  };

  const updateProgress = () => {
    const boxes = checkboxNodes();
    const total = boxes.length;
    const done = boxes.filter((b) => b.checked).length;
    if (progressText) {
      progressText.textContent = `Scroll down. ${done} / ${total} checkboxes complete`;
    }
    if (progress) progress.classList.toggle("is-done", done === total && total > 0);
  };

  const paintCaptcha = (code) => {
    if (!captchaBoard) return;
    captchaBoard.innerHTML = "";
    String(code || "")
      .split("")
      .forEach((ch, i) => {
        const span = document.createElement("span");
        span.className = `franchise-captcha-ch is-${(i % 3) + 1}`;
        span.textContent = ch;
        captchaBoard.appendChild(span);
      });
  };

  const rollCaptcha = async () => {
    if (window.location.protocol === "file:") {
      captchaCode = "SKY360";
      captchaTokenValue = "";
      paintCaptcha(captchaCode);
      if (captchaToken) captchaToken.value = "";
      return true;
    }
    try {
      const response = await fetch(`waiver-mail.php?captcha=1&t=${Date.now()}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json();
      if (!data?.ok || !data.code || !data.token) throw new Error("captcha");
      captchaCode = String(data.code).toUpperCase();
      captchaTokenValue = String(data.token || "");
      paintCaptcha(captchaCode);
      if (captchaToken) captchaToken.value = captchaTokenValue;
      if (captchaInput) captchaInput.value = "";
      return true;
    } catch (_) {
      captchaCode = "";
      captchaTokenValue = "";
      paintCaptcha("------");
      if (captchaToken) captchaToken.value = "";
      return false;
    }
  };

  const validateLocation = () => {
    if (WAIVER_TEST_MODE) {
      if (walkinMode) {
        if (!parkSelect?.value && parkSelect?.options?.length > 1) {
          parkSelect.selectedIndex = 1;
        }
        parkIdInput.value = parkSelect?.value || parks[0]?.id || "katy";
        if (parkSelect && !parkSelect.value) parkSelect.value = parkIdInput.value;
        planIdInput.value = "walkin";
        syncTitles();
        return true;
      }
      if (!parkSelect?.value && parkSelect?.options?.length > 1) {
        parkSelect.selectedIndex = 1;
        populatePlans(parkSelect.value);
      }
      if (!planSelect?.value && planSelect?.options?.length > 1) {
        planSelect.selectedIndex = 1;
      }
      parkIdInput.value = parkSelect?.value || parks[0]?.id || "katy";
      planIdInput.value = planSelect?.value || "general";
      if (parkSelect && !parkSelect.value) parkSelect.value = parkIdInput.value;
      if (planSelect && !planSelect.value) {
        populatePlans(parkIdInput.value);
        planSelect.value = planIdInput.value;
      }
      syncTitles();
      return true;
    }
    showMissing = true;
    const err = document.querySelector("[data-waiver-loc-error]");
    const ok = highlightLocation();
    if (!ok) {
      if (err) {
        err.hidden = false;
        err.textContent = walkinMode
          ? "Please select a park to continue."
          : "Please select a park and plan to continue.";
      }
      scrollToMissing();
      return false;
    }
    if (deepLinkActive && !deepLinkConfirmed) {
      if (err) {
        err.hidden = false;
        err.textContent =
          "Please confirm this is your park (or choose a different location) before continuing.";
      }
      document.querySelector("[data-waiver-link-confirm]")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return false;
    }
    if (err) err.hidden = true;
    parkIdInput.value = parkSelect.value;
    if (walkinMode) {
      planIdInput.value = "walkin";
      if (planSelect) planSelect.value = "";
    } else {
      planIdInput.value = planSelect.value;
    }
    syncTitles();
    return true;
  };

  const validateEmail = () => {
    showMissing = true;
    const input = form.querySelector("[data-waiver-email]");
    const err = document.querySelector("[data-waiver-email-error]");
    const ok = highlightEmail();
    if (!ok) {
      if (err) {
        err.hidden = false;
        err.textContent = "Enter a valid email so we can send your confirmation copy.";
      }
      scrollToMissing();
      return false;
    }
    if (input) input.value = String(input.value || "").trim().toLowerCase();
    if (err) err.hidden = true;
    return true;
  };

  const validateDetails = () => {
    if (WAIVER_TEST_MODE) {
      composeDob();
      if (minorsJson) minorsJson.value = JSON.stringify(collectMinors());
      return true;
    }
    showMissing = true;
    composeDob();
    const err = document.querySelector("[data-waiver-details-error]");
    const ok = highlightDetails();
    if (!ok) {
      if (err) {
        err.hidden = false;
        err.textContent = "Please complete the highlighted fields.";
      }
      if (minorsJson) minorsJson.value = JSON.stringify(collectMinors());
      scrollToMissing();
      return false;
    }
    if (modeInput?.value === "minors") {
      if (minorsJson) minorsJson.value = JSON.stringify(collectMinors());
    } else if (minorsJson) {
      minorsJson.value = "[]";
    }
    if (err) err.hidden = true;
    return true;
  };

  const validateLegal = () => {
    if (WAIVER_TEST_MODE) {
      composeDob();
      syncSignatureData();
      return true;
    }
    showMissing = true;
    const err = document.querySelector("[data-waiver-legal-error]");
    const ok = highlightLegal();
    if (!ok) {
      const unchecked = checkboxNodes().some((b) => !b.checked);
      const drawn = typeof hasDrawnSignature === "function" && hasDrawnSignature();
      const typed = String(form.querySelector('[name="signature"]')?.value || "").trim();
      let msg = "Please complete the highlighted fields before accepting.";
      if (unchecked) {
        msg = "Please tick every highlighted box in the Agreement, then sign.";
      } else if (!drawn || !typed) {
        msg = "Please draw your signature and type your full legal name.";
      }
      if (err) {
        err.hidden = false;
        err.textContent = msg;
      }
      const given = String(captchaInput?.value || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      if (given && captchaCode && given !== captchaCode) {
        rollCaptcha();
        markMissing(captchaInput, true);
      }
      scrollToMissing();
      return false;
    }
    if (err) err.hidden = true;
    composeDob();
    syncSignatureData();
    return true;
  };

  const signPad = form.querySelector("[data-waiver-sign-pad]");
  const signCanvas = form.querySelector("[data-waiver-sign-canvas]");
  const signClear = form.querySelector("[data-waiver-sign-clear]");
  const signDataInput = form.querySelector("[data-waiver-sign-data]");
  const signPlaceholder = form.querySelector("[data-waiver-sign-placeholder]");
  const signStatus = form.querySelector("[data-waiver-sign-status]");

  let signCtx = null;
  let signDrawing = false;
  let signDirty = false;
  let signLast = null;
  let signPointerId = null;
  let signRect = null;
  let signCssWidth = 0;
  let signCssHeight = 200;
  let signRatio = 1;

  const hasDrawnSignature = () => signDirty && !!signDataInput?.value;

  const updateSignUi = () => {
    signPad?.classList.toggle("has-ink", signDirty);
    if (showMissing) signPad?.classList.toggle("is-missing", !signDirty);
    if (signPlaceholder) signPlaceholder.hidden = signDirty;
    if (signStatus) {
      signStatus.textContent = signDirty ? "Signature captured" : "Not signed yet";
      signStatus.classList.toggle("is-ready", signDirty);
    }
  };

  const syncSignatureData = () => {
    if (!signCanvas || !signDataInput) return;
    if (!signDirty) {
      signDataInput.value = "";
      return;
    }
    try {
      // Compact JPEG so the drawn pad can appear inline in email.
      const maxW = 320;
      const scale = Math.min(1, maxW / Math.max(signCanvas.width, 1));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(signCanvas.width * scale));
      out.height = Math.max(1, Math.round(signCanvas.height * scale));
      const octx = out.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(signCanvas, 0, 0, out.width, out.height);
      let quality = 0.55;
      let data = out.toDataURL("image/jpeg", quality);
      while (data.length > 55000 && quality > 0.28) {
        quality -= 0.07;
        data = out.toDataURL("image/jpeg", quality);
      }
      signDataInput.value = data.length > 80000 ? "" : data;
    } catch (_) {
      signDataInput.value = "";
    }
  };

  const cacheSignRect = () => {
    if (!signCanvas) return;
    signRect = signCanvas.getBoundingClientRect();
  };

  const pointFromClient = (clientX, clientY) => {
    const rect = signRect || signCanvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const applyStrokeStyle = () => {
    if (!signCtx) return;
    signCtx.lineCap = "round";
    signCtx.lineJoin = "round";
    signCtx.strokeStyle = "#2e1054";
    signCtx.fillStyle = "#2e1054";
    signCtx.lineWidth = 2.35;
    signCtx.miterLimit = 2;
  };

  const clearSignature = () => {
    if (!signCanvas || !signCtx) return;
    signCtx.save();
    signCtx.setTransform(1, 0, 0, 1, 0, 0);
    signCtx.clearRect(0, 0, signCanvas.width, signCanvas.height);
    signCtx.restore();
    applyStrokeStyle();
    signDirty = false;
    signDrawing = false;
    signLast = null;
    signPointerId = null;
    syncSignatureData();
    updateSignUi();
  };

  const resizeSignatureCanvas = () => {
    if (!signCanvas || !signPad) return;
    signRatio = Math.min(window.devicePixelRatio || 1, 2);
    signCssWidth = Math.max(signPad.clientWidth - 4, 280);
    signCssHeight = 200;
    const prev = signDirty ? signCanvas.toDataURL("image/png") : "";
    signCanvas.width = Math.floor(signCssWidth * signRatio);
    signCanvas.height = Math.floor(signCssHeight * signRatio);
    signCanvas.style.width = `${signCssWidth}px`;
    signCanvas.style.height = `${signCssHeight}px`;
    signCtx =
      signCanvas.getContext("2d", { alpha: true, desynchronized: true }) ||
      signCanvas.getContext("2d");
    signCtx.setTransform(signRatio, 0, 0, signRatio, 0, 0);
    applyStrokeStyle();
    cacheSignRect();
    if (prev) {
      const img = new Image();
      img.onload = () => {
        signCtx.drawImage(img, 0, 0, signCssWidth, signCssHeight);
        signDirty = true;
        syncSignatureData();
        updateSignUi();
      };
      img.src = prev;
    } else {
      updateSignUi();
    }
  };

  const initSignaturePad = () => {
    if (!signCanvas || !signPad) return;
    resizeSignatureCanvas();

    const markInk = () => {
      if (signDirty) return;
      signDirty = true;
      if (signPlaceholder) signPlaceholder.hidden = true;
      signPad.classList.add("has-ink");
      if (signStatus) {
        signStatus.textContent = "Signing…";
        signStatus.classList.remove("is-ready");
      }
    };

    signCanvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        cacheSignRect();
        signPointerId = event.pointerId;
        signDrawing = true;
        signLast = pointFromClient(event.clientX, event.clientY);
        try {
          signCanvas.setPointerCapture(event.pointerId);
        } catch (_) {}
        if (signCtx && signLast) {
          signCtx.beginPath();
          signCtx.arc(signLast.x, signLast.y, 1.1, 0, Math.PI * 2);
          signCtx.fill();
        }
        markInk();
      },
      { passive: false }
    );

    signCanvas.addEventListener(
      "pointermove",
      (event) => {
        if (!signDrawing || event.pointerId !== signPointerId || !signCtx || !signLast) return;
        event.preventDefault();

        // Use every sample the browser captured between frames (keeps ink on the tip).
        const samples =
          typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : null;
        const list = samples && samples.length ? samples : [event];

        signCtx.beginPath();
        signCtx.moveTo(signLast.x, signLast.y);
        for (let i = 0; i < list.length; i += 1) {
          const sample = list[i];
          const next = pointFromClient(sample.clientX, sample.clientY);
          signCtx.lineTo(next.x, next.y);
          signLast = next;
        }
        signCtx.stroke();
      },
      { passive: false }
    );

    const endStroke = (event) => {
      if (signPointerId != null && event.pointerId !== signPointerId) return;
      event.preventDefault();
      signDrawing = false;
      signLast = null;
      signPointerId = null;
      try {
        if (event.pointerId != null) signCanvas.releasePointerCapture(event.pointerId);
      } catch (_) {}
      syncSignatureData();
      updateSignUi();
    };

    signCanvas.addEventListener("pointerup", endStroke, { passive: false });
    signCanvas.addEventListener("pointercancel", endStroke, { passive: false });
    signCanvas.addEventListener("lostpointercapture", () => {
      if (!signDrawing) return;
      signDrawing = false;
      signLast = null;
      signPointerId = null;
      syncSignatureData();
      updateSignUi();
    });

    // Block page scroll / pull-to-refresh while signing.
    const blockPadScroll = (event) => {
      if (signDrawing || event.target === signCanvas) event.preventDefault();
    };
    signPad.addEventListener("touchstart", blockPadScroll, { passive: false });
    signPad.addEventListener("touchmove", blockPadScroll, { passive: false });
    signCanvas.addEventListener("touchstart", blockPadScroll, { passive: false });
    signCanvas.addEventListener("touchmove", blockPadScroll, { passive: false });

    signClear?.addEventListener("click", clearSignature);
    window.addEventListener("resize", () => {
      window.clearTimeout(signCanvas._resizeTimer);
      signCanvas._resizeTimer = window.setTimeout(resizeSignatureCanvas, 120);
    });
    window.addEventListener("scroll", () => {
      if (signDrawing) cacheSignRect();
    }, { passive: true });
  };

  const paintCurrentMissing = () => {
    if (!showMissing || WAIVER_TEST_MODE) return;
    if (step === "location") {
      if (highlightLocation()) {
        const err = document.querySelector("[data-waiver-loc-error]");
        if (err) err.hidden = true;
      }
      return;
    }
    if (step === "email") {
      if (highlightEmail()) {
        const err = document.querySelector("[data-waiver-email-error]");
        if (err) err.hidden = true;
      }
      return;
    }
    if (step === "details") {
      if (highlightDetails()) {
        const err = document.querySelector("[data-waiver-details-error]");
        if (err) err.hidden = true;
      }
      return;
    }
    if (step === "legal") {
      if (highlightLegal()) {
        const err = document.querySelector("[data-waiver-legal-error]");
        if (err) err.hidden = true;
      }
    }
  };

  const goNext = (target) => {
    if (step === "location" && !validateLocation()) return;
    if (step === "email" && !validateEmail()) return;
    if (step === "details" && !validateDetails()) return;
    showStep(target);
  };

  const goBack = () => {
    if (step === "email") showStep("location");
    else if (step === "method") showStep("email");
    else if (step === "details") showStep("method");
    else if (step === "legal") showStep("details");
  };

  // Init
  if (started) started.value = String(Math.floor(Date.now() / 1000));
  if (WAIVER_TEST_MODE) {
    form.querySelectorAll("[required]").forEach((el) => el.removeAttribute("required"));
    form.setAttribute("novalidate", "novalidate");
    document.body.classList.add("waiver-test-mode");
  }
  populateParks();
  fillDobSelects();
  initCountryDial();
  initAddressSuggest();
  initSignaturePad();

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-dob-pick]")) return;
    closeDobPanels();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDobPanels();
  });

  const linkConfirmEl = form.querySelector("[data-waiver-link-confirm]");
  const linkConfirmParkEl = form.querySelector("[data-waiver-link-confirm-park]");
  const linkConfirmPlanEl = form.querySelector("[data-waiver-link-confirm-plan]");
  const linkConfirmPlanWrap = form.querySelector("[data-waiver-link-confirm-plan-wrap]");
  const linkConfirmYesBtn = form.querySelector("[data-waiver-link-confirm-yes]");
  const linkConfirmChangeBtn = form.querySelector("[data-waiver-link-confirm-change]");

  const refreshLinkConfirmPanel = () => {
    if (!linkConfirmEl) return;
    if (!deepLinkActive) {
      linkConfirmEl.hidden = true;
      linkConfirmEl.classList.remove("is-confirmed");
      return;
    }
    const park = registry?.getPark?.(parkSelect?.value || deepLinkParkId);
    const planId = planSelect?.value || deepLinkPlanId;
    const plan = (park?.plans || []).find((p) => p.id === planId);
    if (linkConfirmParkEl) {
      linkConfirmParkEl.textContent = park?.name || park?.shortName || "this park";
    }
    if (linkConfirmPlanWrap && linkConfirmPlanEl) {
      if (!walkinMode && plan?.label) {
        linkConfirmPlanWrap.hidden = false;
        linkConfirmPlanEl.textContent = plan.label;
      } else {
        linkConfirmPlanWrap.hidden = true;
        linkConfirmPlanEl.textContent = "";
      }
    }
    linkConfirmEl.hidden = false;
    linkConfirmEl.classList.toggle("is-confirmed", deepLinkConfirmed);
    if (linkConfirmYesBtn) {
      linkConfirmYesBtn.textContent = deepLinkConfirmed
        ? "Confirmed — continue below"
        : "Yes, this is my park";
    }
  };

  const refreshWalkinUi = () => {
    const planField = form.querySelector("[data-waiver-plan-field]");
    const walkinBanner = form.querySelector("[data-waiver-walkin-banner]");
    const walkinLead = form.querySelector("[data-waiver-walkin-lead]");
    const passActions = form.querySelector("[data-waiver-walkin-pass-actions]");
    const bannerH1 = form.querySelector(".waiver-loc-banner h1");
    const bannerLead = form.querySelector(".waiver-banner-lead");
    if (!walkinMode) {
      if (planField) planField.hidden = false;
      if (walkinBanner) walkinBanner.hidden = true;
      if (planSelect) planSelect.required = true;
      return;
    }
    if (planField) planField.hidden = true;
    if (planSelect) {
      planSelect.required = false;
      planSelect.value = "";
    }
    if (planIdInput) planIdInput.value = "walkin";
    if (walkinBanner) walkinBanner.hidden = false;
    if (bannerH1) bannerH1.textContent = "Choose your park, then sign once";
    if (bannerLead) {
      bannerLead.textContent =
        "Walk-in: after you sign, you’ll pick any plan at this park. Pass lasts 1.5 hours.";
    }
    const parkId = String(parkSelect?.value || parkIdInput?.value || "").trim().toLowerCase();
    const hasPass = parkId && registry?.hasValidWalkinPass?.(parkId);
    if (passActions) passActions.hidden = !hasPass;
    if (walkinLead) {
      if (hasPass) {
        const mins = Math.max(1, Math.round((registry.walkinPassRemainingMs?.(parkId) || 0) / 60000));
        walkinLead.textContent = `A waiver pass is already active for this park (~${mins} min left). Continue to plans, or tap New guest for the next customer.`;
      } else {
        walkinLead.textContent =
          "Sign once for this park, then choose any plan to book. No plan selection needed here.";
      }
    }
  };

  const clearDeepLinkFromUrl = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("park");
      url.searchParams.delete("plan");
      if (walkinMode) url.searchParams.set("mode", "walkin");
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", next);
    } catch (_e) {
      /* ignore */
    }
  };

  const prePark = String(params.get("park") || "").trim().toLowerCase();
  const prePlan = String(params.get("plan") || "").trim().toLowerCase();
  if (prePark && registry?.getPark?.(prePark)) {
    parkSelect.value = prePark;
    populatePlans(prePark);
    if (!walkinMode && prePlan) planSelect.value = prePlan;
    parkIdInput.value = prePark;
    if (walkinMode) {
      planIdInput.value = "walkin";
      deepLinkPlanId = "walkin";
    } else {
      planIdInput.value = prePlan || planSelect.value || "";
      if (!planIdInput.value && planSelect.options.length > 1) {
        planSelect.selectedIndex = 1;
        planIdInput.value = planSelect.value;
      }
      deepLinkPlanId = planIdInput.value || prePlan || "";
    }
    deepLinkActive = true;
    deepLinkConfirmed = false;
    deepLinkParkId = prePark;
    syncTitles();
    refreshLinkConfirmPanel();
  }
  refreshWalkinUi();
  showStep("location");

  applyMode("minors");

  parkSelect?.addEventListener("change", () => {
    populatePlans(parkSelect.value);
    parkIdInput.value = parkSelect.value;
    planIdInput.value = walkinMode ? "walkin" : planSelect?.value || "";
    if (deepLinkActive) {
      // Changing away from the shared link requires a fresh confirm (or “different park”).
      deepLinkConfirmed = false;
      if (parkSelect.value !== deepLinkParkId) {
        deepLinkParkId = parkSelect.value;
        deepLinkPlanId = walkinMode ? "walkin" : planSelect?.value || "";
      }
      refreshLinkConfirmPanel();
    }
    refreshWalkinUi();
    syncTitles();
  });
  planSelect?.addEventListener("change", () => {
    if (walkinMode) return;
    planIdInput.value = planSelect.value;
    if (deepLinkActive) {
      deepLinkConfirmed = false;
      deepLinkPlanId = planSelect.value;
      refreshLinkConfirmPanel();
    }
    syncTitles();
  });

  linkConfirmYesBtn?.addEventListener("click", () => {
    if (!deepLinkActive) return;
    if (!parkSelect?.value || (!walkinMode && !planSelect?.value)) {
      const err = document.querySelector("[data-waiver-loc-error]");
      if (err) {
        err.hidden = false;
        err.textContent = walkinMode
          ? "Select a park, then confirm."
          : "Select a park and plan, then confirm.";
      }
      return;
    }
    deepLinkConfirmed = true;
    deepLinkParkId = parkSelect.value;
    deepLinkPlanId = walkinMode ? "walkin" : planSelect.value;
    parkIdInput.value = parkSelect.value;
    planIdInput.value = deepLinkPlanId;
    const err = document.querySelector("[data-waiver-loc-error]");
    if (err) err.hidden = true;
    refreshLinkConfirmPanel();
    refreshWalkinUi();
    syncTitles();
  });

  linkConfirmChangeBtn?.addEventListener("click", () => {
    deepLinkActive = false;
    deepLinkConfirmed = false;
    deepLinkParkId = "";
    deepLinkPlanId = "";
    clearDeepLinkFromUrl();
    if (parkSelect) parkSelect.value = "";
    if (planSelect) {
      planSelect.innerHTML = '<option value="">Choose a plan…</option>';
    }
    if (parkIdInput) parkIdInput.value = "";
    if (planIdInput) planIdInput.value = walkinMode ? "walkin" : "";
    refreshLinkConfirmPanel();
    refreshWalkinUi();
    syncTitles();
    const err = document.querySelector("[data-waiver-loc-error]");
    if (err) err.hidden = true;
    parkSelect?.focus();
  });

  form.querySelector("[data-waiver-walkin-continue-plans]")?.addEventListener("click", () => {
    const parkId = String(parkSelect?.value || parkIdInput?.value || "").trim().toLowerCase();
    if (!parkId || !registry?.hasValidWalkinPass?.(parkId)) {
      refreshWalkinUi();
      return;
    }
    window.location.href = `location.html?id=${encodeURIComponent(parkId)}&from=walkin#plans`;
  });

  form.querySelector("[data-waiver-walkin-new-guest]")?.addEventListener("click", () => {
    const parkId = String(parkSelect?.value || parkIdInput?.value || "").trim().toLowerCase();
    registry?.clearWalkinPass?.(parkId || undefined);
    refreshWalkinUi();
  });

  document.querySelector("[data-waiver-success-new-guest]")?.addEventListener("click", () => {
    const parkId = String(parkIdInput?.value || parkSelect?.value || "").trim().toLowerCase();
    registry?.clearWalkinPass?.(parkId || undefined);
    window.location.href = parkId
      ? `waiver.html?mode=walkin&park=${encodeURIComponent(parkId)}`
      : "waiver.html?mode=walkin";
  });

  form.querySelectorAll("[data-waiver-next]").forEach((btn) => {
    btn.addEventListener("click", () => goNext(btn.dataset.waiverNext));
  });
  form.querySelectorAll("[data-waiver-back]").forEach((btn) => {
    btn.addEventListener("click", goBack);
  });
  document.querySelectorAll("[data-rail]").forEach((dot) => {
    dot.addEventListener("click", () => {
      if (dot.disabled) return;
      const target = dot.dataset.rail;
      const railOrder = ["location", "email", "details", "legal"];
      const currentRail = step === "method" ? "details" : step;
      if (railOrder.indexOf(target) <= railOrder.indexOf(currentRail)) {
        if (target === "details" && step === "legal") showStep("details");
        else if (target === "details" && (step === "method" || step === "details")) showStep(step === "method" ? "method" : "details");
        else showStep(target);
      }
    });
  });
  document.querySelector("[data-waiver-exit]")?.addEventListener("click", () => {
    window.location.href = "location.html";
  });

  form.querySelectorAll("[data-waiver-mode-btn]").forEach((btn) => {
    btn.addEventListener("click", () => applyMode(btn.dataset.waiverModeBtn));
  });

  form.querySelector("[data-waiver-add-minor]")?.addEventListener("click", () => addMinor());
  minorsList?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove-minor]");
    if (!btn) return;
    btn.closest(".waiver-minor")?.remove();
    renumberMinors();
    syncAddMinorButton();
    if (!minorsList.querySelector(".waiver-minor")) minorCount = 0;
  });

  form.querySelector("[data-waiver-manual-address]")?.addEventListener("change", (event) => {
    const fields = form.querySelector("[data-waiver-manual-fields]");
    if (fields) fields.hidden = !event.target.checked;
  });

  form.querySelector("[data-waiver-address-search]")?.addEventListener("change", (event) => {
    const val = String(event.target.value || "").trim();
    const addr = form.querySelector("[data-waiver-address]");
    if (addr && val && !addr.value) addr.value = val;
  });

  form.addEventListener("input", () => {
    paintCurrentMissing();
  });
  form.addEventListener("change", (event) => {
    if (event.target.matches("[data-waiver-cb]")) updateProgress();
    paintCurrentMissing();
  });

  captchaRefresh?.addEventListener("click", () => {
    rollCaptcha();
    captchaInput?.focus();
  });

  const grantWalkinPassNow = () => {
    if (!walkinMode) return;
    const parkId = String(parkIdInput?.value || parkSelect?.value || "").trim().toLowerCase();
    if (!parkId) return;
    try {
      registry?.grantWalkinPass?.(parkId);
      registry?.setSelectedParkId?.(parkId);
      // Clear plan-waiver "awaiting return" so hub doesn't open a stale plan panel.
      sessionStorage.removeItem(
        registry?.AWAITING_KEY || "skyline360_awaiting_waiver_return"
      );
    } catch (_e) {
      /* ignore */
    }
  };

  const showSuccessAndRedirect = (redirectUrl) => {
    form.querySelectorAll("[data-waiver-step]").forEach((s) => {
      s.hidden = true;
    });
    if (progress) progress.hidden = true;
    const successCopy = document.querySelector("[data-waiver-success-copy]");
    const successWalkin = document.querySelector("[data-waiver-success-walkin]");
    const park = currentPark();
    const parkId = String(parkIdInput?.value || parkSelect?.value || "").trim().toLowerCase();

    // Grant as early as possible once success UI is shown (also granted on server-ok below).
    if (walkinMode && parkId) {
      grantWalkinPassNow();
      if (successCopy) {
        successCopy.textContent =
          "Your confirmation copy is being sent to your email. Opening this park’s plans so you can choose what to book…";
      }
      if (successWalkin) successWalkin.hidden = false;
    } else if (successWalkin) {
      successWalkin.hidden = true;
    }

    if (success) {
      success.hidden = false;
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const plan = currentPlan();
    const target = walkinMode && parkId
      ? `location.html?id=${encodeURIComponent(parkId)}&from=walkin#plans`
      : redirectUrl ||
        plan?.bookingUrl ||
        (park?.href ? `${park.href}#plans` : "location.html");
    // Give the confirmation a few seconds to leave the server (and the guest time to read the tip).
    window.setTimeout(() => {
      window.location.href = target;
    }, walkinMode ? 3200 : 4500);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateLocation()) {
      showStep("location");
      scrollToMissing();
      return;
    }
    if (!validateEmail()) {
      showStep("email");
      scrollToMissing();
      return;
    }
    if (!validateDetails()) {
      showStep("details");
      scrollToMissing();
      return;
    }
    if (!validateLegal()) return;

    const hp = form.querySelector('.hp-field input[name="website"]');
    if (hp?.value) {
      showSuccessAndRedirect(currentPlan()?.bookingUrl);
      return;
    }

    const submit = form.querySelector("[data-waiver-submit]");
    const submitHtml = submit?.innerHTML || "";
    const restoreSubmit = () => {
      if (!submit) return;
      submit.disabled = false;
      if (submitHtml) submit.innerHTML = submitHtml;
    };

    try {
      // Keep hidden park/plan in sync right before POST (mobile back/forward can desync).
      if (parkSelect?.value && parkIdInput) parkIdInput.value = parkSelect.value;
      if (walkinMode) {
        if (planIdInput) planIdInput.value = "walkin";
      } else if (planSelect?.value && planIdInput) {
        planIdInput.value = planSelect.value;
      }
      composeDob();
      syncSignatureData();
      if (minorsJson) minorsJson.value = JSON.stringify(collectMinors());
    } catch (_) {
      // Never block submit on signature export quirks (common on mobile Safari).
    }

    const payload = new FormData(form);
    if (walkinMode) {
      payload.set("plan_id", "walkin");
      payload.set("park_id", String(parkIdInput?.value || parkSelect?.value || ""));
    }
    const givenCode = String(captchaInput?.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    payload.set("captcha", givenCode);
    payload.set("captcha_token", captchaTokenValue || captchaToken?.value || "");
    const sigRaw = String(payload.get("signature_data") || "");
    if (sigRaw.length > 100000) {
      // Keep a smaller recompress if possible instead of dropping the pad entirely.
      syncSignatureData();
      const again = String(form.querySelector('[name="signature_data"]')?.value || "");
      payload.set("signature_data", again.length > 100000 ? "" : again);
    }
    const national = String(payload.get("phone") || "").trim();
    const dial = String(payload.get("country_code") || selectedDial.dial || "").trim();
    if (national) {
      payload.set("phone", `${dial} ${national}`.trim());
    }
    const minors = collectMinors();
    if (minors.length) {
      payload.set(
        "participants",
        minors.map((m) => `${m.first_name} ${m.last_name} (DOB ${m.dob})`).join("\n")
      );
    }

    const localFile = window.location.protocol === "file:";
    setStatus(localFile ? "Preview mode — upload to cPanel to email." : "Submitting your waiver…");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Submitting…";
    }

    if (localFile) {
      grantWalkinPassNow();
      showSuccessAndRedirect(currentPlan()?.bookingUrl);
      return;
    }

    try {
      const endpoint = form.getAttribute("action") || "waiver-mail.php";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "same-origin",
        body: payload,
      });

      const type = response.headers.get("content-type") || "";
      let data = {};
      if (type.includes("application/json")) {
        data = await response.json().catch(() => ({}));
      } else {
        const raw = await response.text().catch(() => "");
        if (response.status === 404) {
          throw new Error(
            "waiver-mail.php was not found on the server (404). Upload waiver-mail.php, waiver-parks.php, waiver-smtp-config.php, and waiver-smtp-lib.php into the same public_html folder as waiver.html."
          );
        }
        if (!response.ok) {
          throw new Error(
            raw
              ? `Server error (${response.status}). Please try again.`
              : `Server error (${response.status}). Upload waiver-mail.php and try again.`
          );
        }
        grantWalkinPassNow();
        showSuccessAndRedirect(currentPlan()?.bookingUrl);
        return;
      }

      if (data && typeof data.ok === "boolean") {
        if (!data.ok) {
          if (/park code|captcha|email/i.test(String(data.message || ""))) rollCaptcha();
          throw new Error(data.message || "We could not send the waiver.");
        }
        // Grant pass as soon as the server accepts — before retries / redirect animation.
        if (walkinMode || String(data.plan || data.plan_id || "").toLowerCase() === "walkin") {
          const okPark = String(data.park || data.park_id || parkIdInput?.value || "").trim().toLowerCase();
          if (okPark && parkIdInput) parkIdInput.value = okPark;
          grantWalkinPassNow();
        }
        if (data.job) {
          scheduleDeliverRetries(data.job);
        }
        setStatus(walkinMode ? "Waiver signed. Opening park plans…" : "Waiver signed. Opening booking…");
        showSuccessAndRedirect(data.redirect || currentPlan()?.bookingUrl);
        return;
      }
      throw new Error("Unexpected server response. Please refresh and try again.");
    } catch (err) {
      let msg = err?.message || "We could not send the waiver. Please try again.";
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        msg =
          "Could not reach waiver-mail.php. Upload waiver-mail.php, waiver-parks.php, waiver-smtp-config.php, and waiver-smtp-lib.php to the same folder as waiver.html, then try again.";
      }
      setStatus(msg, "error");
      restoreSubmit();
    }
  });

  // --- ID / document scan autofill (local Tesseract primary; AWS optional backup) ---
  const fillMethodInput = form.querySelector("[data-waiver-fill-method]");
  const idScanWrap = form.querySelector("[data-waiver-id-scan]");
  const methodNav = form.querySelector("[data-waiver-method-nav]");
  const idScanError = form.querySelector("[data-waiver-id-scan-error]");
  const idScanStatus = form.querySelector("[data-waiver-id-scan-status]");
  const idExtractLoader = form.querySelector("[data-waiver-id-extract-loader]");
  const idExtractTitle = form.querySelector("[data-waiver-id-extract-title]");
  const idExtractDetail = form.querySelector("[data-waiver-id-extract-detail]");
  const idReviewBanner = form.querySelector("[data-waiver-id-review]");
  const idCoach = form.querySelector("[data-waiver-id-coach]");
  const idCoachList = form.querySelector("[data-waiver-id-coach-list]");
  const idCameraPanel = form.querySelector("[data-waiver-id-camera-panel]");
  const idVideo = form.querySelector("[data-waiver-id-video]");
  const idImages = { front: "", back: "" };
  const fillChoiceGroup = form.querySelector("[data-waiver-fill-choice-group]") || form.querySelector(".waiver-fill-choice");
  const methodIntro = form.querySelector("[data-waiver-method-intro]");
  let idCameraSide = "";
  let idStream = null;
  let idScanAssisted = false;
  /** @type {"id"|"document"} */
  let scanKind = "id";
  let idScanBusy = false;
  /** Bumped to ignore stale OCR / barcode results after cancel or method switch. */
  let scanGen = 0;
  /** @type {AbortController|null} */
  let scanAbort = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let autoExtractTimer = null;
  let extractFailedOnce = false;
  /** Last attributed fill path written to the form (`manual`|`scan`|`document`). */
  let committedFillMethod = "manual";
  /** @type {ReturnType<typeof setInterval>|null} */
  let extractTicker = null;

  const EXTRACT_TICK_MESSAGES = [
    "Sharpening the photo for clearer text…",
    "Reading name, date of birth, and address…",
    "Checking the image from multiple angles…",
    "Almost done — please keep this screen open…",
  ];

  const invalidateScanWork = () => {
    scanGen += 1;
    if (autoExtractTimer) {
      clearTimeout(autoExtractTimer);
      autoExtractTimer = null;
    }
    if (scanAbort) {
      try {
        scanAbort.abort();
      } catch (_e) {
        /* ignore */
      }
      scanAbort = null;
    }
    idScanBusy = false;
    if (typeof stopExtractLoader === "function") stopExtractLoader();
  };

  const setExtractSubmitLabel = (failed) => {
    const submitLabel = form.querySelector("[data-waiver-scan-submit-label]");
    if (!submitLabel) return;
    submitLabel.textContent = failed ? "Retry extract" : "Extract details";
  };

  const prefillsLegalNameFromGuest = () => {
    const sig = form.querySelector('[name="signature"]');
    if (!sig) return;
    if (String(sig.value || "").trim()) return;
    const first = String(form.querySelector('[name="first_name"]')?.value || "").trim();
    const last = String(form.querySelector('[name="last_name"]')?.value || "").trim();
    const full = `${first} ${last}`.trim();
    if (!full) return;
    sig.value = full;
    if (idScanAssisted) sig.classList.add("is-id-filled");
  };

  const focusWaiverTarget = (selector) => {
    const el = form.querySelector(selector);
    if (!el) return;
    const focusEl =
      el.matches("input, select, textarea, button")
        ? el
        : el.querySelector("input:not([type='hidden']), select, textarea, button, [data-dob-toggle]") || el;
    focusEl.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      try {
        focusEl.focus({ preventScroll: true });
      } catch (_e) {
        focusEl.focus?.();
      }
      if (focusEl.matches?.("[data-dob-toggle]")) {
        focusEl.click?.();
      }
    }, 280);
  };

  const collectRemainingDetailTargets = () => {
    const items = [];
    const first = String(form.querySelector('[name="first_name"]')?.value || "").trim();
    const last = String(form.querySelector('[name="last_name"]')?.value || "").trim();
    const phone = String(form.querySelector('[name="phone"]')?.value || "").trim();
    const dob = String(form.querySelector("[data-waiver-dob]")?.value || "").trim();
    const address = String(form.querySelector("[data-waiver-address]")?.value || "").trim();
    const city = String(form.querySelector("[data-waiver-city]")?.value || "").trim();
    const state = String(form.querySelector("[data-waiver-state]")?.value || "").trim();
    const zip = String(form.querySelector("[data-waiver-zip]")?.value || "").trim();
    const search = String(form.querySelector("[data-waiver-address-search]")?.value || "").trim();
    const emergencyName = String(form.querySelector('[name="emergency_name"]')?.value || "").trim();
    const emergencyPhone = String(form.querySelector('[name="emergency_phone"]')?.value || "").trim();
    const manual = !!form.querySelector("[data-waiver-manual-address]")?.checked;

    if (!first) items.push({ label: "First name", selector: '[name="first_name"]' });
    if (!last) items.push({ label: "Last name", selector: '[name="last_name"]' });
    if (!dob) items.push({ label: "Date of birth", selector: "[data-waiver-dob-group]" });
    if (!phone) items.push({ label: "Phone number", selector: '[name="phone"]' });

    const addressOk = manual
      ? !!(address && city && state && zip)
      : !!(search || (address && city && state && zip));
    if (!addressOk) {
      if (manual) {
        if (!address) items.push({ label: "Street address", selector: "[data-waiver-address]" });
        if (!city) items.push({ label: "City", selector: "[data-waiver-city]" });
        if (!state) items.push({ label: "State", selector: "[data-waiver-state]" });
        if (!zip) items.push({ label: "ZIP / postal code", selector: "[data-waiver-zip]" });
      } else {
        items.push({ label: "Address", selector: "[data-waiver-address-search]" });
      }
    }

    if (!emergencyName) {
      items.push({ label: "Emergency contact name", selector: '[name="emergency_name"]' });
    }
    if (!emergencyPhone) {
      items.push({ label: "Emergency phone", selector: '[name="emergency_phone"]' });
    }

    if (modeInput?.value === "minors") {
      const minors = collectMinors();
      if (!minors.length) {
        items.push({ label: "Add at least one minor", selector: "[data-waiver-add-minor]" });
      }
    }

    return items;
  };

  const renderIdCoach = () => {
    if (!idCoach || !idCoachList) return;
    if (!idScanAssisted) {
      setHiddenEl(idCoach, true);
      idCoachList.innerHTML = "";
      return;
    }
    const items = collectRemainingDetailTargets();
    if (!items.length) {
      setHiddenEl(idCoach, true);
      idCoachList.innerHTML = "";
      if (idReviewBanner) {
        setHiddenEl(idReviewBanner, false);
        const source =
          committedFillMethod === "document" ||
          scanKind === "document" ||
          fillMethodInput?.value === "document"
            ? "document"
            : "ID";
        idReviewBanner.textContent =
          `${source === "document" ? "Document" : "ID"} details look complete on this step. Review them, then continue to the agreement and signature — we’ll prefill your typed legal name from your name fields.`;
      }
      return;
    }
    setHiddenEl(idCoach, false);
    idCoachList.innerHTML = items
      .map(
        (item, i) => `<li>
          <button type="button" class="waiver-id-coach-btn" data-waiver-coach-jump="${encodeURIComponent(item.selector)}">
            <span class="waiver-id-coach-num">${i + 1}</span>
            <span class="waiver-id-coach-label">${item.label}</span>
            <span class="waiver-id-coach-go">Go</span>
          </button>
        </li>`
      )
      .join("");
  };

  const setFillMethod = (method, { commit = true } = {}) => {
    const next =
      method === "scan" || method === "document" ? method : "manual";
    if (fillMethodInput) fillMethodInput.value = next;
    if (commit) committedFillMethod = next;
  };

  const restoreCommittedFillMethod = () => {
    setFillMethod(committedFillMethod, { commit: false });
  };

  const docChecklistModal = document.querySelector("[data-waiver-doc-checklist-modal]");
  let docChecklistLastFocus = null;

  // Keep modal on <body> so card overflow / backdrop-filter cannot clip it
  if (docChecklistModal && docChecklistModal.parentElement !== document.body) {
    document.body.appendChild(docChecklistModal);
  }

  const closeDocChecklistModal = () => {
    if (!docChecklistModal || docChecklistModal.hidden) return;
    setHiddenEl(docChecklistModal, true);
    document.body.classList.remove("waiver-doc-modal-open");
    if (docChecklistLastFocus && typeof docChecklistLastFocus.focus === "function") {
      try {
        docChecklistLastFocus.focus();
      } catch (_e) {
        /* ignore */
      }
    }
    docChecklistLastFocus = null;
  };

  const openDocChecklistModal = () => {
    if (!docChecklistModal) return;
    docChecklistLastFocus = document.activeElement;
    if (docChecklistModal.parentElement !== document.body) {
      document.body.appendChild(docChecklistModal);
    }
    setHiddenEl(docChecklistModal, false);
    document.body.classList.add("waiver-doc-modal-open");
    window.requestAnimationFrame(() => {
      const closeBtn =
        docChecklistModal.querySelector(".waiver-doc-modal-done") ||
        docChecklistModal.querySelector("[data-waiver-doc-checklist-close]");
      closeBtn?.focus?.();
      const body = docChecklistModal.querySelector(".waiver-doc-modal-body");
      if (body) body.scrollTop = 0;
    });
  };

  form.querySelector("[data-waiver-doc-checklist-open]")?.addEventListener("click", openDocChecklistModal);
  docChecklistModal?.querySelectorAll("[data-waiver-doc-checklist-close]").forEach((el) => {
    el.addEventListener("click", closeDocChecklistModal);
  });

  const exampleBox = docChecklistModal?.querySelector("[data-waiver-doc-example]");
  const exampleToggle = docChecklistModal?.querySelector("[data-waiver-doc-example-toggle]");
  const exampleCopy = docChecklistModal?.querySelector("[data-waiver-doc-example-copy]");
  const exampleText = docChecklistModal?.querySelector("[data-waiver-doc-example-text]");

  exampleToggle?.addEventListener("click", () => {
    if (!exampleBox) return;
    const collapsed = exampleBox.classList.toggle("is-collapsed");
    exampleToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  });

  exampleCopy?.addEventListener("click", async () => {
    const text = String(exampleText?.textContent || "").trim();
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (_e) {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch (_e2) {
        ok = false;
      }
    }
    if (ok) {
      exampleCopy.classList.add("is-copied");
      exampleCopy.textContent = "Copied — paste into your document";
      window.setTimeout(() => {
        exampleCopy.classList.remove("is-copied");
        exampleCopy.textContent = "Copy example text";
      }, 2200);
    } else {
      exampleCopy.textContent = "Select the sample and copy manually";
      window.setTimeout(() => {
        exampleCopy.textContent = "Copy example text";
      }, 2200);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDocChecklistModal();
  });

  const configureScanKind = (kind) => {
    scanKind = kind === "document" ? "document" : "id";
    const title = form.querySelector("[data-waiver-scan-title]");
    const hint = form.querySelector("[data-waiver-scan-hint]");
    const note = form.querySelector("[data-waiver-scan-note]");
    const docChecklist = form.querySelector("[data-waiver-doc-checklist]");
    const labelFront = form.querySelector('[data-waiver-slot-label="front"]');
    const labelBack = form.querySelector('[data-waiver-slot-label="back"]');
    const slotBack = form.querySelector("[data-waiver-slot-back]");
    const scanGrid = form.querySelector(".waiver-id-scan-grid");
    const coachLead = form.querySelector(".waiver-id-coach-lead");

    if (scanKind === "document") {
      if (title) title.textContent = "Document photo";
      // Long how-to lives in “View what to include” — keep the page clean
      if (hint) {
        hint.textContent = "";
        setHiddenEl(hint, true);
      }
      if (docChecklist) setHiddenEl(docChecklist, false);
      if (note) {
        note.textContent =
          "Add your document photo, then an Extra page if needed. Tap Extract details when you’re ready — it won’t start on its own.";
        setHiddenEl(note, false);
      }
      if (labelFront) labelFront.textContent = "Document page*";
      if (labelBack) labelBack.textContent = "Extra page (optional)";
      if (slotBack) {
        slotBack.classList.add("is-optional");
        setHiddenEl(slotBack, false);
      }
      scanGrid?.classList.remove("is-single");
      setExtractSubmitLabel(extractFailedOnce);
      if (coachLead) {
        coachLead.textContent =
          "Add emergency contact on your typed page to autofill it too. Tap an item to jump to any remaining field.";
      }
      try {
        window.SkylineLocalOcr?.warm?.();
      } catch (_e) {
        /* ignore */
      }
    } else {
      if (title) title.textContent = "ID or document photo";
      if (hint) {
        hint.textContent =
          "Take a clear photo of an ID card or a typed details page in good light. Avoid blur and glare.";
        setHiddenEl(hint, false);
      }
      if (docChecklist) setHiddenEl(docChecklist, true);
      closeDocChecklistModal();
      if (note) {
        note.textContent = "";
        setHiddenEl(note, true);
      }
      if (labelFront) labelFront.textContent = "Photo*";
      // Front-only slot; Extra page stays on the dedicated Document option.
      idImages.back = "";
      showIdSlot("back");
      if (slotBack) {
        slotBack.classList.remove("is-optional");
        setHiddenEl(slotBack, true);
      }
      scanGrid?.classList.add("is-single");
      setExtractSubmitLabel(extractFailedOnce);
      if (coachLead) {
        coachLead.textContent =
          "Some fields may still need a quick check. Tap an item to jump there — including fields lower on this page.";
      }
    }
    syncIdScanSubmitState();
  };

  const setHiddenEl = (el, hide) => {
    if (!el) return;
    el.hidden = !!hide;
    el.classList.toggle("waiver-is-hidden", !!hide);
    el.setAttribute("aria-hidden", hide ? "true" : "false");
    // Belt-and-suspenders against stale CSS that ignores [hidden]
    el.style.display = hide ? "none" : "";
  };

  const stopIdCamera = () => {
    if (idStream) {
      idStream.getTracks().forEach((t) => t.stop());
      idStream = null;
    }
    if (idVideo) idVideo.srcObject = null;
    setHiddenEl(idCameraPanel, true);
    idCameraSide = "";
  };

  const showIdSlot = (side) => {
    const slot = form.querySelector(`[data-waiver-id-slot="${side}"]`);
    if (!slot) return;
    const preview = slot.querySelector("[data-waiver-id-preview]");
    const empty = slot.querySelector("[data-waiver-id-empty]");
    let img = slot.querySelector("[data-waiver-id-img]");
    const clearBtn = slot.querySelector("[data-waiver-id-clear]");
    const has = !!idImages[side];
    setHiddenEl(empty, has);
    if (has) {
      if (!img && preview) {
        img = document.createElement("img");
        img.setAttribute("data-waiver-id-img", "");
        img.alt = side === "front" ? "Captured front photo" : "Captured back photo";
        img.decoding = "async";
        preview.appendChild(img);
      }
      if (img) {
        img.hidden = false;
        img.classList.remove("waiver-is-hidden");
        img.style.display = "block";
        img.src = idImages[side];
      }
    } else if (img) {
      img.removeAttribute("src");
      img.remove();
    }
    setHiddenEl(clearBtn, !has);
    preview?.classList.toggle("has-photo", has);
    syncIdScanSubmitState();
    if (has) queueMicrotask(() => {
      scheduleAutoExtractAfterCapture();
    });
  };

  const photosReadyForExtract = () => !!idImages.front;

  const scheduleAutoExtractAfterCapture = () => {
    if (autoExtractTimer) {
      clearTimeout(autoExtractTimer);
      autoExtractTimer = null;
    }
    if (idScanBusy) return;

    // Document mode: wait for the guest to add an optional Extra page, then tap Extract.
    // Do not auto-start OCR — they control when extraction begins.
    if (scanKind === "document") {
      if (!idImages.front) return;
      try {
        window.SkylineLocalOcr?.warm?.();
      } catch (_e) {
        /* ignore */
      }
      if (idImages.back) {
        setIdScanStatus("Both pages ready. Tap Extract details when you’re ready.");
      } else {
        setIdScanStatus(
          "Document photo ready. Add an Extra page if you need one, then tap Extract details."
        );
      }
      return;
    }

    if (!photosReadyForExtract()) return;
    maybeAutoExtractAfterCapture();
  };

  const maybeAutoExtractAfterCapture = async () => {
    // Document photos are extracted only when the guest taps Extract details.
    if (scanKind === "document") return;
    if (idScanBusy || !photosReadyForExtract()) return;
    const myGen = scanGen;
    // Local OCR starts immediately after the front photo (no back required).
    submitIdScan({ auto: true });
  };

  const clearIdSide = (side) => {
    idImages[side] = "";
    showIdSlot(side);
  };

  const syncIdScanSubmitState = () => {
    const btn = form.querySelector("[data-waiver-id-scan-submit]");
    if (!btn) return;
    const ready = !!idImages.front;
    btn.disabled = !ready;
    btn.setAttribute("aria-disabled", ready ? "false" : "true");
    btn.title = ready
      ? scanKind === "document"
        ? "Extract typed details from your document"
        : "Extract details from your ID or typed photo"
      : scanKind === "document"
        ? "Add a clear document photo first"
        : "Add a clear photo of your ID or typed page first";
  };

  const setIdScanError = (msg) => {
    if (!idScanError) return;
    if (!msg) {
      idScanError.textContent = "";
      setHiddenEl(idScanError, true);
      return;
    }
    idScanError.textContent = msg;
    setHiddenEl(idScanError, false);
  };

  const setIdScanStatus = (msg) => {
    if (!idScanStatus) return;
    if (!msg) {
      idScanStatus.textContent = "";
      setHiddenEl(idScanStatus, true);
      return;
    }
    idScanStatus.textContent = msg;
    setHiddenEl(idScanStatus, false);
  };

  const stopExtractLoader = () => {
    if (extractTicker) {
      clearInterval(extractTicker);
      extractTicker = null;
    }
    idScanWrap?.classList.remove("is-extracting");
    if (idExtractLoader) {
      idExtractLoader.setAttribute("aria-busy", "false");
      setHiddenEl(idExtractLoader, true);
    }
    const btn = form.querySelector("[data-waiver-id-scan-submit]");
    if (btn && !idScanBusy) {
      btn.classList.remove("is-busy");
      setExtractSubmitLabel(extractFailedOnce);
      syncIdScanSubmitState();
    }
  };

  const startExtractLoader = (title, detail) => {
    idScanWrap?.classList.add("is-extracting");
    if (idExtractTitle) idExtractTitle.textContent = title || "Extracting details…";
    if (idExtractDetail) {
      idExtractDetail.textContent =
        detail || "Please wait — do not tap Extract again.";
    }
    if (idExtractLoader) {
      idExtractLoader.setAttribute("aria-busy", "true");
      setHiddenEl(idExtractLoader, false);
    }
    setIdScanStatus(title || "Extracting details…");
    if (extractTicker) clearInterval(extractTicker);
    let tick = 0;
    extractTicker = setInterval(() => {
      tick += 1;
      const msg = EXTRACT_TICK_MESSAGES[tick % EXTRACT_TICK_MESSAGES.length];
      if (idExtractDetail) idExtractDetail.textContent = msg;
      setIdScanStatus(msg);
    }, 2800);
  };

  /**
   * Fast OCR prep: resize + contrast only (no per-pixel unsharp — that was a major delay).
   */
  const enhanceIdImageForOcr = (dataUrl) =>
    new Promise((resolve) => {
      if (!dataUrl) {
        resolve("");
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const srcW = img.naturalWidth || img.width;
          const srcH = img.naturalHeight || img.height;
          if (!srcW || !srcH) {
            resolve(dataUrl);
            return;
          }
          const longSide = Math.max(srcW, srcH);
          // Cap ~1280px: Tesseract stays accurate and much faster than 2000px
          const target = 1280;
          let scale = 1;
          if (longSide < 900) scale = Math.min(1.6, 1100 / longSide);
          else if (longSide > target) scale = target / longSide;
          const w = Math.max(1, Math.round(srcW * scale));
          const h = Math.max(1, Math.round(srcH * scale));

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, w, h);

          const imageData = ctx.getImageData(0, 0, w, h);
          const d = imageData.data;
          const n = d.length;

          let minL = 255;
          let maxL = 0;
          for (let i = 0; i < n; i += 160) {
            const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (l < minL) minL = l;
            if (l > maxL) maxL = l;
          }
          const range = Math.max(32, maxL - minL);
          const contrast = 255 / range;
          const brightness = -minL * contrast;
          const punch = 1.1;

          for (let i = 0; i < n; i += 4) {
            let r = (d[i] * contrast + brightness) * punch;
            let g = (d[i + 1] * contrast + brightness) * punch;
            let b = (d[i + 2] * contrast + brightness) * punch;
            d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
            d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
            d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
          }

          ctx.putImageData(imageData, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.86));
        } catch (_err) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  const rotateDataUrlCw = (dataUrl, turnsCw) =>
    new Promise((resolve) => {
      const turns = ((turnsCw % 4) + 4) % 4;
      if (!dataUrl || turns === 0) {
        resolve(dataUrl || "");
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const sw = img.naturalWidth || img.width;
          const sh = img.naturalHeight || img.height;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx || !sw || !sh) {
            resolve("");
            return;
          }
          if (turns % 2 === 1) {
            canvas.width = sh;
            canvas.height = sw;
          } else {
            canvas.width = sw;
            canvas.height = sh;
          }
          if (turns === 1) {
            ctx.translate(sh, 0);
            ctx.rotate(Math.PI / 2);
          } else if (turns === 2) {
            ctx.translate(sw, sh);
            ctx.rotate(Math.PI);
          } else if (turns === 3) {
            ctx.translate(0, sw);
            ctx.rotate(-Math.PI / 2);
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "medium";
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.86));
        } catch (_err) {
          resolve("");
        }
      };
      img.onerror = () => resolve("");
      img.src = dataUrl;
    });

  /**
   * Orientation plan: likeliest upright first. Remaining 90° turns only if OCR is weak.
   * Returns turn counts (0–3), always covering all four eventually when needed.
   */
  const getOrientationTurnPlan = async (enhancedDataUrl) => {
    const img = await new Promise((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = enhancedDataUrl || "";
    });
    const w = img ? img.naturalWidth || img.width : 0;
    const h = img ? img.naturalHeight || img.height : 0;
    const portrait = h > w * 1.02;
    // Documents are usually upright; IDs on phones are often sideways.
    if (scanKind === "document") return portrait ? [0, 1, 3, 2] : [0, 1, 3, 2];
    return portrait ? [1, 3, 0, 2] : [0, 1, 3, 2];
  };

  /**
   * Build up to four variants lazily via turn plan (used by cloud backup).
   */
  const buildOrientationVariants = async (dataUrl) => {
    if (!dataUrl) return [];
    const enhanced = (await enhanceIdImageForOcr(dataUrl)) || dataUrl;
    const turnOrder = await getOrientationTurnPlan(enhanced);
    const out = [];
    for (const turns of turnOrder) {
      const variant = turns === 0 ? enhanced : await rotateDataUrlCw(enhanced, turns);
      if (variant) out.push(variant);
    }
    if (!out.length && enhanced) return [enhanced];
    return out;
  };

  /** Stop as soon as name + key details look solid (speed without killing accuracy). */
  const isFastOcrSuccess = (parsed) => {
    if (!parsed?.has_name) return false;
    const f = parsed.fields || {};
    const rich = !!(f.dob && (f.address || f.city || f.phone));
    const filled = Number(parsed.filled) || 0;
    const conf = Number(parsed.confidence) || 0;
    if (rich && filled >= 4) return true;
    if (filled >= 5 && conf >= 45) return true;
    if (f.dob && f.address && filled >= 4) return true;
    return false;
  };

  /**
   * Fast path: OCR likeliest angle first; only rotate further when needed.
   */
  const extractPhotoSmart = async (dataUrl, mode, onProgress, myGen) => {
    if (!dataUrl || !window.SkylineLocalOcr?.extractFromImageDataUrl) return null;
    const enhanced = (await enhanceIdImageForOcr(dataUrl)) || dataUrl;
    if (myGen !== scanGen) return null;
    const turnOrder = await getOrientationTurnPlan(enhanced);
    let best = null;
    let bestSrc = "";

    for (let i = 0; i < turnOrder.length; i += 1) {
      if (myGen !== scanGen) return null;
      const turns = turnOrder[i];
      const variant = turns === 0 ? enhanced : await rotateDataUrlCw(enhanced, turns);
      if (!variant) continue;
      if (typeof onProgress === "function") {
        onProgress(i / turnOrder.length, i + 1, turnOrder.length);
      }
      let parsed;
      try {
        parsed = await window.SkylineLocalOcr.extractFromImageDataUrl(
          variant,
          (p) => {
            if (typeof onProgress === "function") {
              onProgress((i + Math.max(0, Math.min(1, Number(p) || 0))) / turnOrder.length, i + 1, turnOrder.length);
            }
          },
          mode
        );
      } catch (_e) {
        continue;
      }
      if (!best || (window.SkylineLocalOcr.scoreParsed?.(parsed) || 0) > (window.SkylineLocalOcr.scoreParsed?.(best) || 0)) {
        best = parsed;
        bestSrc = variant;
      } else if (parsed && window.SkylineLocalOcr.mergeParsed) {
        // Keep unique fields from a weaker angle only if it found name pieces we lack
        const merged = window.SkylineLocalOcr.mergeParsed(best, parsed);
        if ((window.SkylineLocalOcr.scoreParsed?.(merged) || 0) >= (window.SkylineLocalOcr.scoreParsed?.(best) || 0)) {
          best = merged;
        }
      }
      if (isFastOcrSuccess(best)) {
        if (typeof onProgress === "function") onProgress(1, i + 1, turnOrder.length);
        return best;
      }
    }

    // One grayscale rescue on the best angle only (not every orientation)
    if (bestSrc && best && !isFastOcrSuccess(best) && window.SkylineLocalOcr.toGrayscaleOcrDataUrl) {
      try {
        if (typeof onProgress === "function") onProgress(0.92, turnOrder.length, turnOrder.length);
        const gray = await window.SkylineLocalOcr.toGrayscaleOcrDataUrl(bestSrc);
        if (gray) {
          const parsed = await window.SkylineLocalOcr.extractFromImageDataUrl(gray, null, mode);
          if (parsed) {
            if ((window.SkylineLocalOcr.scoreParsed?.(parsed) || 0) > (window.SkylineLocalOcr.scoreParsed?.(best) || 0)) {
              best = parsed;
            } else if (window.SkylineLocalOcr.mergeParsed) {
              best = window.SkylineLocalOcr.mergeParsed(best, parsed);
            }
          }
        }
      } catch (_e) {
        /* keep best */
      }
    }
    if (typeof onProgress === "function") onProgress(1, turnOrder.length, turnOrder.length);
    return best;
  };

  const canvasToJpegDataUrl = (source, sw, sh, rotateCw90 = false) => {
    const maxSide = 2000;
    let w = sw;
    let h = sh;
    if (w > maxSide || h > maxSide) {
      const scale = maxSide / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    if (rotateCw90) {
      canvas.width = h;
      canvas.height = w;
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
    } else {
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, 0, 0, sw, sh, 0, 0, w, h);
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  /**
   * Keep capture orientation as-is for the preview.
   * Server OCR already tries 0° / 90° / 270° — client rotate often flips Nigerian IDs upside-down.
   */
  const normalizeCapturedIdImage = (source, sw, sh) =>
    canvasToJpegDataUrl(source, sw, sh, false);

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      if (!file || !/^image\//i.test(file.type || "")) {
        reject(new Error("Please choose a photo (JPEG or PNG)."));
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        reject(new Error("That photo is too large. Use a smaller image under 6 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const dataUrl = normalizeCapturedIdImage(img, img.width, img.height);
          if (!dataUrl) {
            reject(new Error("Could not read that image."));
            return;
          }
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error("Could not read that image."));
        img.src = String(reader.result || "");
      };
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });

  const openIdCamera = async (side) => {
    setIdScanError("");
    stopIdCamera();
    idCameraSide = side;
    // getUserMedia requires HTTPS (or localhost). On plain HTTP many mobiles block it.
    const secure =
      window.isSecureContext ||
      location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    if (!secure) {
      setIdScanError(
        "Camera needs a secure (https) page. Please use Upload, or open this waiver on https://www.skyline360park.com."
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setIdScanError("Camera is not available on this device. Please use Upload instead.");
      return;
    }
    try {
      idStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (idVideo) {
        idVideo.setAttribute("playsinline", "true");
        idVideo.muted = true;
        idVideo.srcObject = idStream;
        await idVideo.play?.();
        // Wait until we have real frames before enabling capture
        if (!idVideo.videoWidth) {
          await new Promise((resolve) => {
            const done = () => {
              idVideo.removeEventListener("loadeddata", done);
              resolve();
            };
            idVideo.addEventListener("loadeddata", done);
            window.setTimeout(resolve, 1200);
          });
        }
      }
      if (idCameraPanel) setHiddenEl(idCameraPanel, false);
      window.requestAnimationFrame(() => {
        idCameraPanel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (_err) {
      setIdScanError(
        "Could not open the camera. Allow camera permission in your browser, or use Upload instead."
      );
      stopIdCamera();
    }
  };

  const captureIdFrame = () => {
    if (!idVideo || !idCameraSide) return;
    const w = idVideo.videoWidth;
    const h = idVideo.videoHeight;
    if (!w || !h) {
      setIdScanError("Camera is still starting. Wait a moment, then tap Capture photo again.");
      return;
    }
    const dataUrl = normalizeCapturedIdImage(idVideo, w, h);
    if (!dataUrl) {
      setIdScanError("Could not capture that frame. Please try Upload instead.");
      return;
    }
    idImages[idCameraSide] = dataUrl;
    showIdSlot(idCameraSide);
    stopIdCamera();
    setIdScanError("");
  };

  const applyIdFields = (fields) => {
    if (!fields || typeof fields !== "object") return;
    form.querySelectorAll(".is-id-filled").forEach((el) => el.classList.remove("is-id-filled"));

    const first = form.querySelector('[name="first_name"]');
    const last = form.querySelector('[name="last_name"]');
    if (first && fields.first_name) first.value = fields.first_name;
    if (last && fields.last_name) last.value = fields.last_name;

    const monthPick = form.querySelector('[data-dob-pick="month"]');
    const dayPick = form.querySelector('[data-dob-pick="day"]');
    const yearPick = form.querySelector('[data-dob-pick="year"]');
    if (fields.dob_month && monthPick) {
      const label = MONTHS[Number(fields.dob_month) - 1] || fields.dob_month;
      setDobPickValue(monthPick, fields.dob_month, label);
    }
    if (fields.dob_day && dayPick) {
      setDobPickValue(dayPick, fields.dob_day, String(Number(fields.dob_day)));
    }
    if (fields.dob_year && yearPick) {
      setDobPickValue(yearPick, fields.dob_year, fields.dob_year);
    }
    composeDob();

    const hasAddress =
      fields.address || fields.city || fields.state || fields.zip;
    if (hasAddress) {
      const manualBox = form.querySelector("[data-waiver-manual-address]");
      const manualFields = form.querySelector("[data-waiver-manual-fields]");
      if (manualBox) manualBox.checked = true;
      if (manualFields) manualFields.hidden = false;
      if (addrStreetInput && fields.address) addrStreetInput.value = fields.address;
      if (addrCityInput && fields.city) addrCityInput.value = fields.city;
      if (addrStateInput && fields.state) addrStateInput.value = fields.state;
      if (addrZipInput && fields.zip) addrZipInput.value = fields.zip;
      if (addrSearchInput) {
        addrSearchInput.value = [fields.address, fields.city, fields.state, fields.zip]
          .filter(Boolean)
          .join(", ");
      }
    }

    const phoneEl = form.querySelector('[name="phone"]');
    if (phoneEl && fields.phone && !String(phoneEl.value || "").trim()) {
      phoneEl.value = String(fields.phone).replace(/[^\d]/g, "").slice(0, 20);
      phoneEl.classList.add("is-id-filled");
    }

    const emergencyNameEl = form.querySelector('[name="emergency_name"]');
    const emergencyPhoneEl = form.querySelector('[name="emergency_phone"]');
    if (emergencyNameEl && fields.emergency_name && !String(emergencyNameEl.value || "").trim()) {
      emergencyNameEl.value = String(fields.emergency_name).trim().slice(0, 120);
      emergencyNameEl.classList.add("is-id-filled");
    }
    if (emergencyPhoneEl && fields.emergency_phone && !String(emergencyPhoneEl.value || "").trim()) {
      emergencyPhoneEl.value = String(fields.emergency_phone).replace(/[^\d+]/g, "").slice(0, 40);
      emergencyPhoneEl.classList.add("is-id-filled");
    }

    const filledLabels = [];
    if (String(first?.value || "").trim()) filledLabels.push("first name");
    if (String(last?.value || "").trim()) filledLabels.push("last name");
    if (String(form.querySelector("[data-waiver-dob]")?.value || "").trim()) {
      filledLabels.push("date of birth");
    }
    if (String(phoneEl?.value || "").trim()) filledLabels.push("phone");
    if (
      String(addrStreetInput?.value || "").trim() ||
      String(addrCityInput?.value || "").trim()
    ) {
      filledLabels.push("address");
    }
    if (String(emergencyNameEl?.value || "").trim()) filledLabels.push("emergency contact");
    if (String(emergencyPhoneEl?.value || "").trim()) filledLabels.push("emergency phone");

    // Remember minors from the document; apply only when “Me and minor(s)” is selected
    const scannedMinors = Array.isArray(fields.minors)
      ? fields.minors.filter((m) => m && (m.first_name || m.last_name)).slice(0, MAX_MINORS)
      : [];
    lastScannedMinors = scannedMinors;
    let minorsApplied = 0;
    if (modeInput?.value === "minors" && scannedMinors.length) {
      minorsApplied = applyScannedMinors(scannedMinors, { silent: true });
      if (minorsApplied) filledLabels.push(`${minorsApplied} minor${minorsApplied === 1 ? "" : "s"}`);
    }

    ["first_name", "last_name", "emergency_name", "emergency_phone"].forEach((name) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el?.value) el.classList.add("is-id-filled");
    });
    form.querySelectorAll("[data-dob-pick]").forEach((pick) => {
      if (pick.querySelector("input[type='hidden']")?.value) {
        pick.classList.add("is-id-filled");
      }
    });
    [addrStreetInput, addrCityInput, addrStateInput, addrZipInput, addrSearchInput].forEach(
      (el) => {
        if (el?.value) el.classList.add("is-id-filled");
      }
    );

    // Remaining required fields (e.g. signature) stay for the guest to finish.
    idScanAssisted = true;

    // Smart: also prepare the LAST-step typed legal name now (field lives on Sign step)
    prefillsLegalNameFromGuest();

    const sourceLabel =
      committedFillMethod === "document" ||
      scanKind === "document" ||
      fillMethodInput?.value === "document"
        ? "your printed document"
        : "your ID";

    if (idReviewBanner) {
      setHiddenEl(idReviewBanner, false);
      let filledText = filledLabels.length
        ? `Filled from ${sourceLabel}: ${filledLabels.join(", ")}.`
        : `We could only read part of ${sourceLabel}.`;
      if (scannedMinors.length && modeInput?.value === "self") {
        filledText += ` We also saw ${scannedMinors.length} child/minor name${
          scannedMinors.length === 1 ? "" : "s"
        } on the page — switch to “Me and minor(s)” if you want those added. “Just me” keeps only your details.`;
      } else if (minorsApplied) {
        filledText += ` Child/minor rows were created automatically — please review each one.`;
      }
      idReviewBanner.textContent = `${filledText} Use “Finish these next” below to jump to any remaining required field.`;
    }

    renderIdCoach();
    showMissing = true;
    highlightDetails();
    window.requestAnimationFrame(() => {
      const remaining = collectRemainingDetailTargets();
      if (remaining[0]) focusWaiverTarget(remaining[0].selector);
      else scrollToMissing();
    });
  };

  const showScanUi = (on) => {
    if (!on) {
      stopExtractLoader();
      closeDocChecklistModal();
    }
    setHiddenEl(idScanWrap, !on);
    setHiddenEl(methodNav, !!on);
    setHiddenEl(fillChoiceGroup, !!on);
    setHiddenEl(methodIntro, !!on);
    if (on) {
      showIdSlot("front");
      showIdSlot("back");
      syncIdScanSubmitState();
    } else {
      stopIdCamera();
      setIdScanError("");
      setIdScanStatus("");
    }
  };

  const resetMethodStep = () => {
    invalidateScanWork();
    stopIdCamera();
    idImages.front = "";
    idImages.back = "";
    showIdSlot("front");
    showIdSlot("back");
    showScanUi(false);
    setIdScanError("");
    setIdScanStatus("");
    extractFailedOnce = false;
    setExtractSubmitLabel(false);
    // Keep committed fill_method (scan/document/manual) so email attribution stays accurate
    // when the guest revisits this step after a successful extract.
    restoreCommittedFillMethod();
    form.querySelectorAll("[data-waiver-fill-choice]").forEach((btn) => {
      btn.classList.remove("is-active");
    });
  };

  const chooseFillMethod = (method) => {
    invalidateScanWork();
    form.querySelectorAll("[data-waiver-fill-choice]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.waiverFillChoice === method);
    });
    if (method === "scan" || method === "document") {
      // Do not commit fill_method until extract succeeds.
      restoreCommittedFillMethod();
      configureScanKind(method === "document" ? "document" : "id");
      extractFailedOnce = false;
      setExtractSubmitLabel(false);
      idImages.front = "";
      idImages.back = "";
      showIdSlot("front");
      showIdSlot("back");
      showScanUi(true);
      // Warm on-device OCR so Extract feels faster
      try {
        window.SkylineLocalOcr?.warm?.() || window.SkylineLocalOcr?.loadTesseract?.();
      } catch (_e) {
        /* ignore */
      }
    } else {
      // Explicit manual entry: commit "manual" only when there was no prior successful extract.
      // If the guest already autofilled via scan/document and is coming back to edit, keep attribution.
      if (!idScanAssisted) {
        setFillMethod("manual");
        if (idReviewBanner) {
          idReviewBanner.textContent = "";
          setHiddenEl(idReviewBanner, true);
        }
        if (idCoach) {
          setHiddenEl(idCoach, true);
          if (idCoachList) idCoachList.innerHTML = "";
        }
        form.querySelectorAll(".is-id-filled").forEach((el) => el.classList.remove("is-id-filled"));
      } else {
        restoreCommittedFillMethod();
      }
      showScanUi(false);
      showStep("details");
      if (idScanAssisted) {
        renderIdCoach();
      }
    }
  };

  const finishScanSuccess = (fields, method) => {
    extractFailedOnce = false;
    setExtractSubmitLabel(false);
    setFillMethod(method === "document" ? "document" : method === "scan" ? "scan" : scanKind === "document" ? "document" : "scan");
    applyIdFields(fields || {});
    idImages.front = "";
    idImages.back = "";
    showIdSlot("front");
    showIdSlot("back");
    stopExtractLoader();
    setIdScanStatus("");
    showScanUi(false);
    showStep("details");
  };

  const localOcrUsable = (parsed) =>
    !!(
      parsed &&
      (parsed.has_name === true ||
        (Number(parsed.filled) >= 3 && parsed.fields?.first_name && parsed.fields?.last_name))
    );

  const localOcrStrong = (parsed) =>
    !!(
      localOcrUsable(parsed) &&
      parsed.fields?.dob &&
      Number(parsed.filled) >= 4 &&
      Number(parsed.confidence) >= 50
    );

  const packLocalFields = (parsed, method) => {
    if (!localOcrUsable(parsed)) return null;
    return {
      ...(parsed.fields || {}),
      minors: Array.isArray(parsed.minors) ? parsed.minors : [],
      _fillMethod: method === "document" ? "document" : "scan",
    };
  };

  /**
   * Read one photo with a given OCR layout mode (id card vs typed page).
   */
  const extractFrontWithMode = async (ocrMode, myGen, progressLabel) => {
    if (idExtractDetail && progressLabel) {
      idExtractDetail.textContent = progressLabel;
    }
    return extractPhotoSmart(
      idImages.front,
      ocrMode,
      (p, angle, total) => {
        if (myGen !== scanGen) return;
        if (idExtractDetail) {
          const pct = Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 100);
          const modeTip = ocrMode === "document" ? "typed layout" : "ID layout";
          idExtractDetail.textContent =
            angle && total
              ? `${modeTip}: ${pct}% (orientation ${angle}/${total})`
              : `${modeTip}: ${pct}%`;
        }
      },
      myGen
    );
  };

  /**
   * Primary path: on-device OCR.
   * Document choice → typed layout only.
   * Scan my ID → try ID layout, then typed-document layout; keep/merge the best.
   */
  const runLocalOcrPrimary = async (myGen) => {
    if (!window.SkylineLocalOcr?.extractFromImageDataUrl) {
      return null;
    }
    const scoreParsed = window.SkylineLocalOcr.scoreParsed || (() => 0);
    const mergeParsed = window.SkylineLocalOcr.mergeParsed || ((a, b) => b || a);

    if (scanKind === "document") {
      startExtractLoader(
        "Reading your document…",
        "Fast on-device read — stops as soon as name and key details are clear…"
      );
      setIdScanStatus("Reading document on your device…");

      let best = await extractFrontWithMode("document", myGen, "Reading typed page…");
      if (myGen !== scanGen) return null;

      if (idImages.back) {
        if (idExtractDetail) idExtractDetail.textContent = "Reading extra page…";
        const second = await extractPhotoSmart(idImages.back, "document", null, myGen);
        if (myGen !== scanGen) return null;
        if (second) best = mergeParsed(best, second);
      }

      return packLocalFields(best, "document");
    }

    // Hybrid: ID card or typed document in the same upload slot
    startExtractLoader(
      "Reading your photo…",
      "Checking ID layout first, then typed-page layout if needed…"
    );
    setIdScanStatus("Reading photo on your device…");

    let idBest = await extractFrontWithMode("id", myGen, "Trying ID card layout…");
    if (myGen !== scanGen) return null;

    let docBest = null;
    if (!localOcrStrong(idBest)) {
      setIdScanStatus("Trying typed-document layout…");
      docBest = await extractFrontWithMode("document", myGen, "Trying typed-document layout…");
      if (myGen !== scanGen) return null;
    }

    let best = idBest;
    let method = "scan";
    if (docBest) {
      const idScore = scoreParsed(idBest);
      const docScore = scoreParsed(docBest);
      if (!idBest) {
        best = docBest;
        method = "document";
      } else {
        best = mergeParsed(idBest, docBest);
        method = docScore > idScore ? "document" : "scan";
      }
    }

    // Optional second image (legacy / unused for front-only UI)
    if (idImages.back) {
      if (idExtractDetail) idExtractDetail.textContent = "Reading second page…";
      const second = await extractPhotoSmart(
        idImages.back,
        method === "document" ? "document" : "id",
        null,
        myGen
      );
      if (myGen !== scanGen) return null;
      if (second) best = mergeParsed(best, second);
    }

    return packLocalFields(best, method);
  };

  /** Optional backup when local OCR is weak and the cloud endpoint is reachable. */
  const postAwsOcr = async (mode, frontPrimary, backPrimary, frontVariants, backVariants, signal) => {
    const response = await fetch("waiver-id-scan.php", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        mode,
        front: frontPrimary,
        back: backPrimary,
        front_variants: frontVariants.slice(0, 2),
        back_variants: backVariants.slice(0, 2),
        website: "",
      }),
      signal,
    });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (_e) {
      data = null;
    }
    const usable =
      response.ok &&
      data?.ok &&
      (data.has_name === true ||
        (Number(data.filled_count) >= 2 && data.fields?.first_name && data.fields?.last_name));
    if (!usable) return null;
    return {
      ...(data.fields || {}),
      _fillMethod: mode === "document" ? "document" : "scan",
    };
  };

  const tryAwsOcrBackup = async (myGen, signal) => {
    if (window.location.protocol === "file:") return null;
    const frontVariants = await buildOrientationVariants(idImages.front);
    const backVariants = idImages.back ? await buildOrientationVariants(idImages.back) : [];
    if (myGen !== scanGen) return null;
    const frontPrimary = frontVariants[0] || idImages.front;
    const backPrimary = backVariants[0] || idImages.back || "";

    if (scanKind === "document") {
      if (idExtractDetail) idExtractDetail.textContent = "Trying cloud reading as a backup…";
      setIdScanStatus("Cloud backup: analyzing document…");
      return postAwsOcr(
        "document",
        frontPrimary,
        backPrimary,
        frontVariants,
        backVariants,
        signal
      );
    }

    if (idExtractDetail) idExtractDetail.textContent = "Trying cloud ID reading…";
    setIdScanStatus("Cloud backup: analyzing as ID…");
    let fields = await postAwsOcr(
      "id",
      frontPrimary,
      backPrimary,
      frontVariants,
      backVariants,
      signal
    );
    if (myGen !== scanGen) return null;
    if (fields) return fields;

    if (idExtractDetail) idExtractDetail.textContent = "Trying cloud document reading…";
    setIdScanStatus("Cloud backup: analyzing as typed document…");
    return postAwsOcr(
      "document",
      frontPrimary,
      backPrimary,
      frontVariants,
      backVariants,
      signal
    );
  };

  const submitIdScan = async (opts = {}) => {
    setIdScanError("");
    if (idScanBusy) return;
    if (scanKind === "document") {
      if (!idImages.front) {
        setIdScanError("Please add a clear photo of your typed or printed document.");
        return;
      }
    } else if (!idImages.front) {
      setIdScanError("Please add a clear photo of your ID or typed details page.");
      return;
    }

    const btn = form.querySelector("[data-waiver-id-scan-submit]");
    const myGen = scanGen;
    idScanBusy = true;
    scanAbort = new AbortController();
    const timeoutMs = 90000;
    const timeoutId = window.setTimeout(() => {
      try {
        scanAbort?.abort();
      } catch (_e) {
        /* ignore */
      }
    }, timeoutMs);
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-busy");
      const label = btn.querySelector("[data-waiver-scan-submit-label]");
      if (label) label.textContent = "Extracting…";
    }
    startExtractLoader(
      opts.auto
        ? scanKind === "document"
          ? "Extracting typed details…"
          : "Extracting details…"
        : scanKind === "document"
          ? "Reading your document…"
          : "Reading your photo…",
      "Preparing a clear photo, then reading on this device…"
    );
    try {
      if (idExtractDetail) {
        idExtractDetail.textContent = "Sharpening photo for a fast read…";
      }

      const takeFillMethod = (fields) => {
        const method =
          fields?._fillMethod || (scanKind === "document" ? "document" : "scan");
        if (fields && Object.prototype.hasOwnProperty.call(fields, "_fillMethod")) {
          delete fields._fillMethod;
        }
        return method;
      };

      // 1) Local OCR first — likeliest orientation first, stops when details are clear
      let localFields = null;
      try {
        localFields = await runLocalOcrPrimary(myGen);
      } catch (_localErr) {
        localFields = null;
      }
      if (myGen !== scanGen) return;
      if (localFields) {
        finishScanSuccess(localFields, takeFillMethod(localFields));
        return;
      }

      // 2) Optional Amazon backup (short timeout so a dead Textract account doesn’t hang)
      try {
        const cloudAbort = new AbortController();
        const cloudTimer = window.setTimeout(() => {
          try {
            cloudAbort.abort();
          } catch (_e) {
            /* ignore */
          }
        }, 12000);
        const onAbort = () => {
          try {
            cloudAbort.abort();
          } catch (_e) {
            /* ignore */
          }
        };
        scanAbort.signal.addEventListener("abort", onAbort, { once: true });
        let cloudFields = null;
        try {
          cloudFields = await tryAwsOcrBackup(myGen, cloudAbort.signal);
        } finally {
          window.clearTimeout(cloudTimer);
          scanAbort.signal.removeEventListener("abort", onAbort);
        }
        if (myGen !== scanGen) return;
        if (cloudFields) {
          finishScanSuccess(cloudFields, takeFillMethod(cloudFields));
          return;
        }
      } catch (cloudErr) {
        if (cloudErr?.name === "AbortError") {
          // Local already failed; don't treat short cloud timeout as a hard cancel of the whole scan
        }
        // Cloud unavailable — fall through
      }

      extractFailedOnce = true;
      setExtractSubmitLabel(true);
      stopExtractLoader();
      setIdScanError(
        scanKind === "document"
          ? "We could not read that document on this device. Use a clearer typed/printed page (not handwriting), good lighting, or fill manually."
          : "We could not read that photo. Use a clearer ID or typed details page (not handwriting), good lighting, or fill manually."
      );
      setIdScanStatus("");
    } catch (err) {
      if (myGen !== scanGen || err?.name === "AbortError") {
        if (err?.name === "AbortError" && myGen === scanGen) {
          extractFailedOnce = true;
          setExtractSubmitLabel(true);
          stopExtractLoader();
          setIdScanError(
            "The scan timed out or was cancelled. Try clearer photos, or fill manually."
          );
          setIdScanStatus("");
        }
        return;
      }
      extractFailedOnce = true;
      setExtractSubmitLabel(true);
      stopExtractLoader();
      setIdScanError(
        scanKind === "document"
          ? "Could not finish document reading. Try again with a clearer photo, or fill manually."
          : "Could not finish ID reading. Try again with clearer photos, or fill manually."
      );
      setIdScanStatus("");
    } finally {
      window.clearTimeout(timeoutId);
      if (myGen === scanGen) {
        idScanBusy = false;
        scanAbort = null;
        if (btn) {
          btn.classList.remove("is-busy");
          syncIdScanSubmitState();
          setExtractSubmitLabel(extractFailedOnce);
        }
      }
    }
  };

  form.querySelectorAll("[data-waiver-fill-choice]").forEach((btn) => {
    btn.addEventListener("click", () => chooseFillMethod(btn.dataset.waiverFillChoice));
  });

  form.querySelectorAll("[data-waiver-id-file]").forEach((input) => {
    input.addEventListener("change", async () => {
      const side = input.dataset.waiverIdFile;
      const file = input.files?.[0];
      input.value = "";
      if (!side || !file) return;
      setIdScanError("");
      try {
        idImages[side] = await fileToDataUrl(file);
        showIdSlot(side);
      } catch (err) {
        setIdScanError(err?.message || "Could not use that photo.");
      }
    });
  });

  form.querySelectorAll("[data-waiver-id-camera]").forEach((btn) => {
    btn.addEventListener("click", () => openIdCamera(btn.dataset.waiverIdCamera));
  });
  form.querySelectorAll("[data-waiver-id-clear]").forEach((btn) => {
    btn.addEventListener("click", () => clearIdSide(btn.dataset.waiverIdClear));
  });
  form.querySelector("[data-waiver-id-capture]")?.addEventListener("click", captureIdFrame);
  form.querySelector("[data-waiver-id-camera-cancel]")?.addEventListener("click", stopIdCamera);
  form.querySelector("[data-waiver-id-scan-submit]")?.addEventListener("click", submitIdScan);
  form.querySelector("[data-waiver-id-scan-cancel]")?.addEventListener("click", () => {
    // Return to Scan vs Manual choice (do not skip ahead to details).
    invalidateScanWork();
    idImages.front = "";
    idImages.back = "";
    showIdSlot("front");
    showIdSlot("back");
    showScanUi(false);
    form.querySelectorAll("[data-waiver-fill-choice]").forEach((btn) => {
      btn.classList.remove("is-active");
    });
    restoreCommittedFillMethod();
  });

  idCoachList?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-waiver-coach-jump]");
    if (!btn) return;
    const selector = decodeURIComponent(btn.dataset.waiverCoachJump || "");
    if (!selector) return;
    // Open manual address panel if jumping to an address part
    if (
      selector.includes("address") ||
      selector.includes("city") ||
      selector.includes("state") ||
      selector.includes("zip")
    ) {
      const manualBox = form.querySelector("[data-waiver-manual-address]");
      const manualFields = form.querySelector("[data-waiver-manual-fields]");
      if (manualBox) manualBox.checked = true;
      if (manualFields) manualFields.hidden = false;
    }
    focusWaiverTarget(selector);
  });

  // Keep the coach list fresh as the guest fills remaining required fields
  form.addEventListener("input", () => {
    if (!idScanAssisted || step !== "details") return;
    renderIdCoach();
  });
  form.addEventListener("change", () => {
    if (!idScanAssisted || step !== "details") return;
    renderIdCoach();
  });
})();
