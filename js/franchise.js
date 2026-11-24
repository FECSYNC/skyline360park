/*! Skyline 360 Park — franchise page
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  Market guide: type a city / state / country, match it to parks in
 *  SkylineParkRegistry, then tell the applicant what to do next.
 */
(() => {
  const GEOCODE_URL = "https://photon.komoot.io/api/";
  const REVERSE_URL = "https://photon.komoot.io/reverse";
  const OVERLAP_MILES = 40;
  const registry = window.SkylineParkRegistry;
  const parks = registry?.parks || [];

  const STATE_NAMES = {
    al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California",
    co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia",
    hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa",
    ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland",
    ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi",
    mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire",
    nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina",
    nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania",
    ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee",
    tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington",
    wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia",
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const toKey = (value) => String(value || "").trim().toLowerCase();

  const normalizeState = (value) => {
    const raw = toKey(value).replace(/\./g, "");
    if (!raw) return "";
    if (STATE_NAMES[raw]) return STATE_NAMES[raw];
    const fromName = Object.values(STATE_NAMES).find((name) => name.toLowerCase() === raw);
    return fromName || String(value || "").trim();
  };

  const haversineMiles = (aLat, aLng, bLat, bLng) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const formatMiles = (miles) => {
    if (miles == null || Number.isNaN(miles)) return "";
    if (miles < 1) return `${Math.round(miles * 5280)} ft`;
    if (miles < 10) return `${miles.toFixed(1)} mi`;
    return `${Math.round(miles)} mi`;
  };

  const formatPlaceLabel = (props = {}, fallback = "") => {
    const parts = [
      props.name,
      props.city || props.town || props.village,
      props.state,
      props.country,
    ]
      .filter(Boolean)
      .filter((part, i, arr) => arr.indexOf(part) === i);
    return parts.slice(0, 4).join(", ") || fallback;
  };

  const parkStates = () => {
    const seen = new Map();
    parks.forEach((park) => {
      const name = normalizeState(park.state || park.region);
      if (name) seen.set(name.toLowerCase(), name);
    });
    return [...seen.values()];
  };

  const rankParks = (lat, lng) =>
    parks
      .map((park) => {
        const miles =
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Number.isFinite(park.lat) &&
          Number.isFinite(park.lng)
            ? haversineMiles(lat, lng, park.lat, park.lng)
            : null;
        return { ...park, miles };
      })
      .sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));

  const sameStateParks = (state) => {
    const key = normalizeState(state).toLowerCase();
    if (!key) return [];
    return parks.filter((park) => {
      const parkState = normalizeState(park.state || park.region).toLowerCase();
      return parkState === key;
    });
  };

  const COUNTRY_ALIASES = {
    us: "United States",
    usa: "United States",
    "u s": "United States",
    "u s a": "United States",
    "united states": "United States",
    "united states of america": "United States",
    america: "United States",
    uk: "United Kingdom",
    "u k": "United Kingdom",
    "great britain": "United Kingdom",
    britain: "United Kingdom",
    england: "United Kingdom",
    uae: "United Arab Emirates",
    "south korea": "South Korea",
    korea: "South Korea",
  };

  const isUnitedStates = (place) => {
    const code = toKey(place.countrycode);
    const country = toKey(place.country);
    return code === "us" || country === "united states" || country === "usa" || country === "united states of america";
  };

  const normalizeCountry = (value) => {
    const raw = toKey(value).replace(/\./g, " ").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];
    return String(value || "").trim();
  };

  const isUsCountryName = (value) => normalizeCountry(value) === "United States";

  const isUsStateName = (value) => {
    const n = toKey(normalizeState(value));
    return Object.values(STATE_NAMES).some((name) => name.toLowerCase() === n);
  };

  const nearestHasCoords = (park) => park && Number.isFinite(park.lat) && Number.isFinite(park.lng);

  const isCityName = (value, country) => {
    const v = toKey(value);
    if (!v) return false;
    if (v === toKey(country) || v === "united states" || v === "usa" || v === "united states of america") return false;
    return true;
  };

  const analyzePlace = (place) => {
    const ranked = rankParks(place.lat, place.lng);
    const nearest = ranked[0] && nearestHasCoords(ranked[0]) ? ranked[0] : null;
    const stateParks = sameStateParks(place.state);
    const networkStates = parkStates();
    const us = isUnitedStates(place);
    const state = normalizeState(place.state) || place.state || "";
    const country = place.country || (us ? "United States" : "");
    const city = isCityName(place.city, country) ? place.city : "";
    const label = place.label || [city, state, country].filter(Boolean).join(", ");
    const outsideUs = toKey(state) === "not in united states";
    const realUsState = isUsStateName(state);

    if ((!us && (place.countrycode || place.country)) || (outsideUs && !realUsState)) {
      return {
        status: "international",
        title: `International interest — ${country && !isUsCountryName(country) ? country : "outside the U.S."}`,
        body: `Skyline parks are currently in the United States (${networkStates.join(" and ") || "select U.S. markets"}). ${country && !isUsCountryName(country) ? country : "This market"} would be an expansion discussion, not a local U.S. territory. Complete the form below and the franchise team will explain how international development works.`,
        next: "Please complete the inquiry so the team can follow up on expansion.",
        city,
        state: "Not in United States",
        country: country && !isUsCountryName(country) ? country : "International",
        nearest: null,
        stateParks,
        label,
      };
    }

    if (nearest && nearest.miles != null && nearest.miles <= OVERLAP_MILES) {
      const others = networkStates.filter(
        (name) => name.toLowerCase() !== normalizeState(nearest.state || nearest.region).toLowerCase()
      );
      return {
        status: "overlap",
        title: `This area already has a Skyline park`,
        body: `${nearest.name} is about ${formatMiles(nearest.miles)} from ${label}. That local market is likely already assigned to an operator. You may still inquire — ask about a nearby city, or a state that does not yet have a park${others.length ? ` (for example ${others.join(", ")})` : ""}.`,
        next: "Continue the form. In your message, name an alternate city if you have one.",
        city,
        state: state || normalizeState(nearest.state),
        country: country || "United States",
        nearest,
        stateParks,
        label,
      };
    }

    if (stateParks.length) {
      const names = stateParks.map((park) => park.name).join(" and ");
      const distance = nearest?.miles != null ? ` about ${formatMiles(nearest.miles)} from ${nearest.name}` : "";
      return {
        status: "same_state",
        title: `${state || "This state"} already has Skyline parks`,
        body: `${names} operate in ${state || "this state"}. ${city || "Your city"} is${distance || " farther from those parks"}, so it may still be an open territory. Complete the inquiry and the franchise team will confirm exclusivity before anyone is assigned.`,
        next: `Complete the inquiry for ${city || label}. The team will confirm whether this city is available.`,
        city,
        state,
        country: country || "United States",
        nearest,
        stateParks,
        label,
      };
    }

    if (us || realUsState) {
      const market = realUsState ? state : city || "this market";
      return {
        status: "new_us",
        title: `No Skyline park in ${market} yet`,
        body: `This appears to be a new U.S. market. Parks today are in ${networkStates.join(" and ") || "a few states"}. Complete the form below and the team will discuss territory, timeline, and how you would operate this location.`,
        next: "Please complete the form. This is the next step.",
        city,
        state: realUsState ? state : "",
        country: country || "United States",
        nearest,
        stateParks,
        label,
      };
    }

    return {
      status: "review",
      title: "We will review this market",
      body: "We could not fully identify that location, but you may still inquire. Please add as much city, state, and country detail as you can so the franchise team can guide you.",
      next: "Complete the rest of the form and send it.",
      city,
      state: state || city,
      country: country || "",
      nearest,
      stateParks,
      label,
    };
  };

  const markets = document.querySelector("[data-franchise-markets]");
  if (markets && parks.length) {
    markets.innerHTML = parks
      .map((park) => {
        const open = park.status === "open";
        const status = park.statusLabel || (open ? "Now Open" : "Opening Soon");
        const href = park.href || `location.html?id=${encodeURIComponent(park.id)}`;
        return `<article class="franchise-market-card">
          <p class="franchise-market-status">${escapeHtml(status)}</p>
          <h3>${escapeHtml(park.name)}</h3>
          <p>${escapeHtml(park.country || "United States")}</p>
          <p class="franchise-market-note">An independently operated location with its own hours, bookings, and local team.</p>
          <a class="btn btn-sm btn-ghost-light" href="${escapeHtml(href)}">View park</a>
        </article>`;
      })
      .join("");
  } else if (markets) {
    markets.innerHTML = `<p class="franchise-market-fallback">Katy, Texas · Fort Worth, Texas · Pennsylvania</p>`;
  }

  const form = document.querySelector("[data-franchise-form]");
  if (!form) return;

  const started = form.querySelector("[data-franchise-started]");
  const statusEl = form.querySelector("[data-franchise-status]");
  const submit = form.querySelector("[data-franchise-submit]");
  const success = document.querySelector("[data-franchise-success]");
  const queryInput = form.querySelector("[data-franchise-market-q]");
  const suggestBox = form.querySelector("[data-franchise-suggest]");
  const insight = form.querySelector("[data-franchise-insight]");
  const hint = form.querySelector("[data-franchise-guide-hint]");
  const locateBtn = form.querySelector("[data-franchise-locate]");
  const cityInput = form.querySelector("[data-franchise-city]");
  const stateInput = form.querySelector("[data-franchise-state]");
  const countryInput = form.querySelector("[data-franchise-country]");
  const zipInput = form.querySelector("[data-franchise-zip]");
  const addressInput = form.querySelector("[data-franchise-address]");
  const captchaBoard = form.querySelector("[data-franchise-captcha-board]");
  const captchaToken = form.querySelector("[data-franchise-captcha-token]");
  const captchaInput = form.querySelector("[data-franchise-captcha-input]");
  const captchaRefresh = form.querySelector("[data-franchise-captcha-refresh]");
  const progressBar = form.querySelector("[data-franchise-progress-bar]");
  const progressLabel = form.querySelector("[data-franchise-progress-label]");
  const params = new URLSearchParams(window.location.search);
  const CAPTCHA_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let captchaCode = "";
  let syncing = false;

  const flashField = (el) => {
    if (!el) return;
    const wrap = el.closest("label") || el;
    wrap.classList.remove("is-autofilled");
    el.classList.remove("is-autofilled");
    void wrap.offsetWidth;
    wrap.classList.add("is-autofilled");
    el.classList.add("is-autofilled");
    window.setTimeout(() => {
      wrap.classList.remove("is-autofilled");
      el.classList.remove("is-autofilled");
    }, 2800);
  };

  const writeField = (el, value, { highlight = true } = {}) => {
    if (!el) return false;
    const next = String(value ?? "").trim();
    if (!next) return false;
    if (el.value === next) return false;
    const sameIgnoreCase = toKey(el.value) === toKey(next);
    el.value = next;
    if (highlight && !sameIgnoreCase) flashField(el);
    return true;
  };

  const setStateValue = (stateName, { highlight = false } = {}) => {
    if (!stateInput) return;
    const normalized = normalizeState(stateName);
    const match = [...stateInput.options].find(
      (opt) => opt.value.toLowerCase() === String(normalized).toLowerCase()
    );
    if (match) {
      if (stateInput.value !== match.value) {
        stateInput.value = match.value;
        if (highlight) flashField(stateInput);
      }
      return;
    }
    const notUs = [...stateInput.options].find((opt) => opt.value === "Not in United States");
    if (notUs && stateInput.value !== notUs.value) {
      stateInput.value = notUs.value;
      if (highlight) flashField(stateInput);
    }
  };

  if (stateInput && stateInput.options.length < 3) {
    Object.values(STATE_NAMES)
      .sort((a, b) => a.localeCompare(b))
      .forEach((name) => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        stateInput.appendChild(opt);
      });
    const other = document.createElement("option");
    other.value = "Not in United States";
    other.textContent = "Not in United States";
    stateInput.appendChild(other);
  }

  const paintCaptcha = (code) => {
    captchaCode = String(code || "").toUpperCase();
    if (!captchaBoard) return;
    captchaBoard.replaceChildren();
    [...captchaCode].forEach((ch, i) => {
      const span = document.createElement("span");
      span.className = `franchise-captcha-ch is-${i % 4}`;
      span.textContent = ch;
      span.style.setProperty("--tilt", `${(Math.random() * 22 - 11).toFixed(1)}deg`);
      span.style.setProperty("--shift", `${(Math.random() * 8 - 4).toFixed(1)}px`);
      captchaBoard.appendChild(span);
    });
    if (captchaInput) {
      captchaInput.setAttribute("aria-label", `Enter the park code ${[...captchaCode].join(" ")}`);
    }
  };

  const localCaptcha = () => {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += CAPTCHA_ALPHA[Math.floor(Math.random() * CAPTCHA_ALPHA.length)];
    }
    return code;
  };

  const rollCaptcha = async () => {
    if (captchaInput) captchaInput.value = "";
    try {
      const response = await fetch("franchise-mail.php?captcha=1", {
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (data?.ok && data.code) {
        paintCaptcha(data.code);
        if (captchaToken) captchaToken.value = data.token || "";
        return;
      }
    } catch (_) {
      /* unique local code if PHP is not reachable */
    }
    paintCaptcha(localCaptcha());
    if (captchaToken) captchaToken.value = "";
  };
  rollCaptcha();
  captchaRefresh?.addEventListener("click", () => {
    rollCaptcha();
    captchaInput?.focus();
  });

  const updateProgress = () => {
    if (form.classList.contains("is-age-blocked")) {
      if (progressBar) progressBar.style.width = "0%";
      if (progressLabel) {
        progressLabel.textContent = "You must be 21 or older to continue this franchise inquiry.";
      }
      return;
    }
    const required = [...form.querySelectorAll("[required]")].filter(
      (el) => el.name !== "captcha" && !el.disabled
    );
    const filled = required.filter((el) => {
      if (el.type === "radio") return el.checked;
      return String(el.value || "").trim();
    }).length;
    const pct = required.length ? Math.round((filled / required.length) * 100) : 0;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (!progressLabel) return;
    if (pct >= 100) progressLabel.textContent = "Ready to send. Enter the park code and submit.";
    else if (pct >= 70) progressLabel.textContent = "Almost there. A few fields remain.";
    else if (pct >= 35) progressLabel.textContent = "You are making progress. Continue — we will complete what we can.";
    else progressLabel.textContent = "Begin with any field. We will highlight anything we complete for you.";
  };

  const ageInputs = form.querySelectorAll("[data-franchise-age]");
  const ageFeedback = form.querySelector("[data-franchise-age-feedback]");
  const ageGate = form.querySelector("[data-franchise-age-gate]");
  const submitZone = form.querySelector("[data-franchise-submit-zone]");
  const AGE_YES = "Yes, I am 21 years of age or older";
  const AGE_NO = "No, I am not";

  const getAgeValue = () => {
    const checked = form.querySelector('input[name="age"]:checked');
    return checked ? checked.value : "";
  };

  const setGateDisabled = (root, disabled) => {
    if (!root) return;
    root.querySelectorAll("input, select, textarea, button").forEach((el) => {
      if (el.name === "age") return;
      el.disabled = disabled;
      if (disabled && el.type !== "hidden") {
        if (el.type === "checkbox" || el.type === "radio") el.checked = false;
        else if ("value" in el && el.name !== "captcha_token") el.value = "";
      }
    });
  };

  const applyAgeGate = () => {
    const value = getAgeValue();
    const blocked = value === AGE_NO;
    const allowed = value === AGE_YES;

    form.classList.toggle("is-age-blocked", blocked);
    form.querySelectorAll(".franchise-age-choice").forEach((choice) => {
      const input = choice.querySelector('input[name="age"]');
      choice.classList.toggle("is-selected", Boolean(input?.checked));
    });

    setGateDisabled(ageGate, blocked);
    setGateDisabled(submitZone, blocked);
    if (captchaInput) captchaInput.disabled = blocked;
    if (captchaRefresh) captchaRefresh.disabled = blocked;
    if (submit) {
      submit.disabled = blocked;
      submit.setAttribute("aria-disabled", blocked ? "true" : "false");
      if (blocked) submit.textContent = "Age requirement not met";
      else submit.textContent = "Send my inquiry ›";
    }

    if (ageFeedback) {
      if (allowed) {
        ageFeedback.hidden = false;
        ageFeedback.className = "franchise-age-feedback is-ok";
        ageFeedback.textContent = "Great — you meet the age requirement. You may continue the form.";
      } else if (blocked) {
        ageFeedback.hidden = false;
        ageFeedback.className = "franchise-age-feedback is-warn";
        ageFeedback.textContent =
          "You must be 21 or older to continue. The rest of this form is locked. Please browse our parks, and return when you are eligible.";
        setStatus("Submission is locked. Franchise inquiries are only for adults 21 years of age and older.", "error");
      } else {
        ageFeedback.hidden = true;
        ageFeedback.textContent = "";
      }
    }

    if (!blocked && statusEl?.classList.contains("is-error") && /21 years/i.test(statusEl.textContent || "")) {
      setStatus("");
    }
    updateProgress();
  };

  ageInputs.forEach((input) => input.addEventListener("change", applyAgeGate));

  let suggestTimer = null;
  let suggestController = null;
  let suggestItems = [];
  let suggestActive = -1;

  const setStatus = (message, kind) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle("is-visible", Boolean(message));
    statusEl.classList.toggle("is-error", kind === "error");
  };

  applyAgeGate();

  const showSuccess = (viaEmailApp = false) => {
    form.hidden = true;
    if (success) {
      success.hidden = false;
      if (viaEmailApp) {
        const heading = success.querySelector("h3");
        const copy = success.querySelector("p");
        if (heading) heading.textContent = "Your email app is ready";
        if (copy) {
          copy.textContent =
            "Please press Send in your email app to deliver this inquiry. After you upload the site to cPanel, submissions will be sent automatically.";
        }
      }
    }
    success?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const setHidden = (selector, value) => {
    const el = form.querySelector(selector);
    if (el) el.value = value || "";
  };

  const renderInsight = (result, options = {}) => {
    if (!insight) return;
    const fill = options.fill !== false;
    const highlight = options.highlight !== false;
    const fillCity = options.fillCity !== false;
    const nearest = result.nearest;
    const showPark = nearest && (result.status === "overlap" || result.status === "same_state");
    const parkLink = showPark
      ? `<a href="${escapeHtml(nearest.href || `location.html?id=${nearest.id}`)}">View ${escapeHtml(nearest.name)}</a>`
      : "";
    insight.hidden = false;
    insight.className = `franchise-insight is-${result.status}`;
    insight.innerHTML = `
      <p class="franchise-insight-kicker">${escapeHtml(result.status.replace(/_/g, " "))}</p>
      <h3>${escapeHtml(result.title)}</h3>
      <p class="franchise-insight-next">${escapeHtml(result.next)}${parkLink ? ` · ${parkLink}` : ""}</p>
    `;
    if (hint) hint.hidden = true;

    if (fill) {
      if (cityInput) {
        if (result.city && (fillCity || !cityInput.value.trim() || toKey(cityInput.value) === toKey(result.city))) {
          writeField(cityInput, result.city, { highlight });
        } else if (!isCityName(cityInput.value, result.country)) {
          cityInput.value = "";
        }
      }
      if (stateInput && result.state) setStateValue(result.state, { highlight });
      if (countryInput && result.country) writeField(countryInput, result.country, { highlight });
      if (queryInput && result.label) queryInput.value = result.label;
    }

    setHidden("[data-franchise-market-label]", result.label);
    setHidden("[data-franchise-market-status]", result.status);
    setHidden("[data-franchise-nearest-park]", nearest?.name || "");
    setHidden(
      "[data-franchise-nearest-miles]",
      nearest?.miles != null ? String(Math.round(nearest.miles)) : ""
    );
    setHidden("[data-franchise-market-notes]", `${result.title}. ${result.body} ${result.next}`);
    updateProgress();
  };

  const cityFromProps = (props = {}) =>
    props.city ||
    props.town ||
    props.village ||
    props.municipality ||
    props.suburb ||
    props.district ||
    props.county ||
    "";

  const placeFromFeature = (feature, query) => {
    const [lng, lat] = feature?.geometry?.coordinates || [];
    const props = feature?.properties || {};
    const type = String(props.type || props.osm_value || "").toLowerCase();
    const city =
      cityFromProps(props) ||
      (/(city|town|village|suburb|neighbourhood|residential)/.test(type) ? props.name : "");
    return {
      lat: Number(lat),
      lng: Number(lng),
      name: props.name || "",
      city,
      state: props.state || "",
      country: props.country || "",
      countrycode: (props.countrycode || "").toLowerCase(),
      postcode: props.postcode || "",
      street: [props.housenumber, props.street].filter(Boolean).join(" "),
      label: formatPlaceLabel({ ...props, city: city || props.city }, query),
      type,
    };
  };

  const geocodeQuery = async (query, { signal, limit = 6 } = {}) => {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "en");
    const response = await fetch(url.toString(), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Geocode failed");
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .map((feature) => placeFromFeature(feature, query))
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
  };

  const reverseGeocode = async (lat, lng) => {
    const url = new URL(REVERSE_URL);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("lang", "en");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Reverse geocode failed");
    const data = await response.json();
    const feature = data?.features?.[0];
    if (!feature) return null;
    return placeFromFeature(feature, "Your location");
  };

  const nominatimReverse = async (lat, lng) => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Nominatim failed");
    const data = await response.json();
    const a = data?.address || {};
    const city =
      a.city || a.town || a.village || a.municipality || a.suburb || a.city_district || a.county || "";
    const state = a.state || a.region || a.state_district || "";
    const country = a.country || "";
    return {
      lat: Number(lat),
      lng: Number(lng),
      city,
      state,
      country,
      countrycode: (a.country_code || "").toLowerCase(),
      postcode: a.postcode || "",
      street: [a.house_number, a.road].filter(Boolean).join(" "),
      label: [city, state, country].filter(Boolean).join(", ") || "Your current location",
    };
  };

  const mergePlaces = (primary, secondary, lat, lng) => {
    const pick = (key) => (primary && primary[key]) || (secondary && secondary[key]) || "";
    const city = pick("city");
    const state = pick("state");
    const country = pick("country");
    return {
      lat,
      lng,
      city,
      state,
      country,
      countrycode: pick("countrycode"),
      postcode: pick("postcode"),
      street: pick("street"),
      label: pick("label") || [city, state, country].filter(Boolean).join(", ") || "Your current location",
    };
  };

  const resolveCoords = async (lat, lng) => {
    const [photon, nominatim] = await Promise.allSettled([
      reverseGeocode(lat, lng),
      nominatimReverse(lat, lng),
    ]);
    const a = photon.status === "fulfilled" ? photon.value : null;
    const b = nominatim.status === "fulfilled" ? nominatim.value : null;
    if (!a && !b) {
      return { lat, lng, city: "", state: "", country: "", countrycode: "", postcode: "", street: "", label: "Your current location" };
    }
    return mergePlaces(a, b, lat, lng);
  };

  const fillLocationFields = (place, { highlight = true, fillCity = true } = {}) => {
    const result = analyzePlace(place);
    renderInsight(result, { highlight, fillCity });
    if (place.street && addressInput && !addressInput.value.trim()) {
      writeField(addressInput, place.street, { highlight });
    }
    if (place.postcode && zipInput) writeField(zipInput, place.postcode, { highlight });
    else if (zipInput && result.status === "international" && !zipInput.value.trim()) {
      writeField(zipInput, "N/A", { highlight });
    }
    if (hint) {
      hint.hidden = false;
      const bits = [result.city, result.state === "Not in United States" ? "" : result.state, result.country].filter(Boolean);
      hint.textContent = bits.length
        ? `We completed ${bits.join(", ")} for you. Highlighted fields were filled automatically. You may edit anything before sending.`
        : "Location found. Please confirm city, state, and country below.";
    }
  };

  const applyPlace = (place) => {
    hideSuggest();
    fillLocationFields(place);
  };

  let geoWatchId = null;
  let locating = false;

  const stopGeoWatch = () => {
    if (geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
  };

  const locateCustomer = () => {
    if (!navigator.geolocation) {
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Location is not available in this browser. Please enter a city instead.";
      }
      return;
    }
    if (locating) return;
    locating = true;
    if (locateBtn) {
      locateBtn.disabled = true;
      locateBtn.textContent = "Finding your location…";
    }
    if (hint) {
      hint.hidden = false;
      hint.textContent = "Detecting your location…";
    }

    let best = null;
    let done = false;
    const consider = (pos) => {
      if (!pos?.coords) return;
      if (!best || (pos.coords.accuracy || 99999) < (best.coords.accuracy || 99999)) best = pos;
    };

    const finish = async () => {
      if (done) return;
      done = true;
      stopGeoWatch();
      locating = false;
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.textContent = "Use my location";
      }
      if (!best) {
        if (hint) hint.textContent = "We could not read your location. Please enter a city, state, or country instead.";
        return;
      }
      try {
        const place = await resolveCoords(best.coords.latitude, best.coords.longitude);
        applyPlace(place);
      } catch (_) {
        if (hint) hint.textContent = "We found your coordinates but could not identify the place. Please enter a city instead.";
      }
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        consider(pos);
        if ((pos.coords.accuracy || 99999) <= 40) {
          finish();
          return;
        }
        geoWatchId = navigator.geolocation.watchPosition(
          (refined) => {
            consider(refined);
            if ((refined.coords.accuracy || 99999) <= 40) finish();
          },
          () => finish(),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
        window.setTimeout(finish, 8000);
      },
      (err) => {
        locating = false;
        if (locateBtn) {
          locateBtn.disabled = false;
          locateBtn.textContent = "Use my location";
        }
        if (hint) {
          hint.hidden = false;
          hint.textContent =
            err?.code === 1
              ? "Location permission was blocked. Allow location for this site, or enter your city."
              : "We could not access GPS yet. Please enter a city, state, or country instead.";
        }
      },
      { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }
    );
  };

  const hideSuggest = () => {
    if (!suggestBox) return;
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
    suggestItems = [];
    suggestActive = -1;
  };

  const showSuggest = (places) => {
    if (!suggestBox) return;
    suggestItems = places.slice(0, 6);
    if (!suggestItems.length) {
      hideSuggest();
      return;
    }
    suggestBox.hidden = false;
    suggestBox.innerHTML = suggestItems
      .map(
        (place, index) =>
          `<button type="button" class="franchise-suggest-item" role="option" data-suggest-index="${index}">${escapeHtml(place.label)}</button>`
      )
      .join("");
    suggestBox.querySelectorAll("[data-suggest-index]").forEach((btn) => {
      btn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const place = suggestItems[Number(btn.dataset.suggestIndex)];
        if (place) applyPlace(place);
      });
    });
  };

  const searchMarket = async (query) => {
    const q = String(query || "").trim();
    if (q.length < 2) {
      hideSuggest();
      return;
    }
    suggestController?.abort();
    suggestController = new AbortController();
    try {
      const places = await geocodeQuery(q, { signal: suggestController.signal });
      showSuggest(places);
    } catch (error) {
      if (error?.name !== "AbortError") hideSuggest();
    }
  };

  const pickBestPlace = (places, { city, state, country }) => {
    if (!places.length) return null;
    const cityKey = toKey(city);
    const stateKey = toKey(normalizeState(state));
    const countryKey = toKey(normalizeCountry(country) || country);
    const scored = places.map((place) => {
      let score = 0;
      if (cityKey && toKey(place.city) === cityKey) score += 6;
      else if (cityKey && toKey(place.city).startsWith(cityKey)) score += 3;
      else if (cityKey && toKey(place.label).includes(cityKey)) score += 1;
      if (stateKey && toKey(normalizeState(place.state)) === stateKey) score += 4;
      if (countryKey && toKey(place.country) === countryKey) score += 2;
      if (isUsCountryName(country) && isUnitedStates(place)) score += 1;
      return { place, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].place;
  };

  const analyzeTypedFields = async (source = "fields") => {
    if (syncing) return;
    syncing = true;
    const city = cityInput?.value.trim() || "";
    const state = stateInput?.value.trim() || "";
    const countryRaw = countryInput?.value.trim() || "";
    const country = normalizeCountry(countryRaw) || countryRaw;
    const zip = zipInput?.value.trim() || "";

    try {
      if (country && countryInput && country !== countryRaw) {
        writeField(countryInput, country, { highlight: true });
      }

      if (source === "country" && country && !isUsCountryName(country)) {
        setStateValue("Not in United States", { highlight: true });
        if (zipInput && !zipInput.value.trim()) writeField(zipInput, "N/A", { highlight: true });
      }

      if (source === "state" && isUsStateName(state)) {
        writeField(countryInput, "United States", { highlight: true });
        flashField(stateInput);
        if (zipInput && toKey(zipInput.value) === "n/a") zipInput.value = "";
      }

      if (source === "state" && isUsStateName(state) && !city) {
        renderInsight(
          analyzePlace({
            city: "",
            state,
            country: "United States",
            countrycode: "us",
            label: `${state}, United States`,
          }),
          { fillCity: false, highlight: true }
        );
        return;
      }

      if (source === "country" && isUsCountryName(country) && !city && !isUsStateName(state)) {
        flashField(stateInput);
        renderInsight(
          analyzePlace({
            city: "",
            state: "",
            country: "United States",
            countrycode: "us",
            label: "United States",
          }),
          { fillCity: false, highlight: true }
        );
        return;
      }

      const query = [city, state === "Not in United States" ? "" : state, zip === "N/A" ? "" : zip, country]
        .filter(Boolean)
        .join(", ");
      if (query.length < 2) return;

      try {
        const places = await geocodeQuery(query, { limit: 4 });
        const place = pickBestPlace(places, { city, state, country });
        if (place) {
          fillLocationFields(
            {
              ...place,
              city: city || place.city,
              state: isUsStateName(state) ? state : place.state,
              country: country || place.country,
            },
            { fillCity: !city, highlight: true }
          );
        } else {
          renderInsight(
            analyzePlace({
              city,
              state,
              country,
              countrycode: isUsCountryName(country) ? "us" : "",
              label: query,
            }),
            { fillCity: false }
          );
        }
      } catch (_) {
        renderInsight(
          analyzePlace({
            city,
            state,
            country,
            label: query,
          }),
          { fillCity: false }
        );
      }
    } finally {
      syncing = false;
      updateProgress();
    }
  };

  queryInput?.addEventListener("input", () => {
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(() => searchMarket(queryInput.value), 280);
  });

  queryInput?.addEventListener("keydown", (event) => {
    if (!suggestItems.length || suggestBox?.hidden) {
      if (event.key === "Enter") {
        event.preventDefault();
        searchMarket(queryInput.value).then(() => {
          if (suggestItems[0]) applyPlace(suggestItems[0]);
        });
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      suggestActive = Math.min(suggestItems.length - 1, suggestActive + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      suggestActive = Math.max(0, suggestActive - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const place = suggestItems[Math.max(0, suggestActive)] || suggestItems[0];
      if (place) applyPlace(place);
    } else if (event.key === "Escape") {
      hideSuggest();
    }
    suggestBox?.querySelectorAll("[data-suggest-index]").forEach((btn, index) => {
      btn.classList.toggle("is-active", index === suggestActive);
    });
  });

  queryInput?.addEventListener("blur", () => {
    window.setTimeout(hideSuggest, 180);
  });

  const scheduleLocationSync = (source) => {
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(() => analyzeTypedFields(source), source === "city" ? 420 : 180);
  };

  cityInput?.addEventListener("input", () => {
    if ((cityInput.value.trim() || "").length < 3) return;
    scheduleLocationSync("city");
  });
  cityInput?.addEventListener("blur", () => scheduleLocationSync("city"));
  stateInput?.addEventListener("change", () => scheduleLocationSync("state"));
  countryInput?.addEventListener("input", () => {
    if ((countryInput.value.trim() || "").length < 3) return;
    scheduleLocationSync("country");
  });
  countryInput?.addEventListener("change", () => scheduleLocationSync("country"));
  countryInput?.addEventListener("blur", () => scheduleLocationSync("country"));
  zipInput?.addEventListener("blur", () => scheduleLocationSync("zip"));
  addressInput?.addEventListener("blur", () => {
    const q = addressInput.value.trim();
    if (q.length < 10) return;
    geocodeQuery(q, { limit: 1 })
      .then((places) => {
        if (places[0]) fillLocationFields(places[0], { fillCity: !cityInput?.value.trim(), highlight: true });
      })
      .catch(() => {});
  });

  locateBtn?.addEventListener("click", () => locateCustomer());

  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  updateProgress();

  const applySection = document.getElementById("apply");
  if (applySection && navigator.geolocation) {
    const startWhenVisible = () => {
      if (params.get("sent") === "1") return;
      locateCustomer();
    };
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          startWhenVisible();
        }
      }, { threshold: 0.15 });
      io.observe(applySection);
    } else {
      startWhenVisible();
    }
  }

  if (started) started.value = String(Math.floor(Date.now() / 1000));
  if (params.get("sent") === "1") showSuccess();
  if (params.get("error") === "1") {
    setStatus("We could not send that just now. Please try again or email franchise@skyline360park.com.", "error");
  }

  const FRANCHISE_INBOXES = ["franchise@skyline360park.com"];
  const INQUIRY_LABELS = {
    first_name: "First name",
    last_name: "Last name",
    email: "Email",
    phone: "Mobile number",
    contact_pref: "Preferred contact",
    address: "Address",
    city: "City",
    state: "State",
    zip: "Zip / postal code",
    country: "Country",
    timeline: "Investment timeline",
    age: "Age requirement",
    net_worth: "Net worth",
    capital: "Liquid capital",
    experience: "Experience",
    units: "Locations of interest",
    heard: "How they heard about Skyline",
    message: "Message",
  };

  /** Page-only guide fields — never include in email bodies. */
  const STRIP_FROM_MAIL = [
    "market_label",
    "market_status",
    "nearest_park",
    "nearest_miles",
    "market_notes",
  ];

  const customerOnlyFormData = (formEl) => {
    const data = new FormData(formEl);
    STRIP_FROM_MAIL.forEach((key) => data.delete(key));
    return data;
  };

  const inquiryPlainText = (formData) => {
    const lines = ["SKYLINE360PARK franchise inquiry", "--------------------------------", ""];
    Object.entries(INQUIRY_LABELS).forEach(([key, label]) => {
      const value = String(formData.get(key) || "").trim();
      if (value) lines.push(`${label}: ${value}`);
    });
    return lines.join("\r\n");
  };

  const sendViaEmailApp = async (formData) => {
    const email = String(formData.get("email") || "").trim();
    const fullName = `${formData.get("first_name") || ""} ${formData.get("last_name") || ""}`.trim();
    const place = [formData.get("city"), formData.get("state"), formData.get("country")].filter(Boolean).join(", ");
    const subject = `SKYLINE360PARK Franchise | ${fullName} | ${email} | ${place}`;
    const body = inquiryPlainText(formData);
    const to = FRANCHISE_INBOXES.join(",");
    const href = `mailto:${to}?cc=${encodeURIComponent(email)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (href.length < 1800) {
      window.location.href = href;
      return true;
    }
    const packed = `To: ${to}\nCc: ${email}\nSubject: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(packed);
      setStatus("The inquiry was copied. Paste it into an email to franchise@skyline360park.com and send.", "");
      return true;
    } catch (_) {
      return false;
    }
  };

  const phpDidRespond = (data) => data && typeof data === "object" && typeof data.ok === "boolean";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hp = form.querySelector('.hp-field input[name="website"]');
    if (hp && hp.value) {
      showSuccess();
      return;
    }

    if (!form.reportValidity()) return;

    if (getAgeValue() !== AGE_YES) {
      setStatus("Submission is locked. Franchise opportunities are available to adults 21 years of age and older.", "error");
      form.querySelector(".franchise-age-field")?.scrollIntoView({ behavior: "smooth", block: "center" });
      form.querySelector('input[name="age"]')?.focus();
      applyAgeGate();
      return;
    }

    const given = String(form.querySelector('input[name="captcha"]')?.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (given.length !== 6 || (captchaCode && given !== captchaCode)) {
      setStatus("Please type the park code exactly as shown. A new code is ready.", "error");
      rollCaptcha();
      captchaInput?.focus();
      return;
    }

    const payload = customerOnlyFormData(form);
    const mailUrl = new URL(form.getAttribute("action") || "franchise-mail.php", window.location.href).toString();
    const localFile = window.location.protocol === "file:";
    setStatus(localFile ? "Opening your email app…" : "Sending your application…");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Sending…";
    }

    const finishLocal = async () => {
      const opened = await sendViaEmailApp(payload);
      if (opened) showSuccess(true);
      else {
        setStatus("Please email franchise@skyline360park.com with your details. Automatic sending starts after you upload the site to cPanel.", "error");
      }
    };

    try {
      if (localFile) {
        await finishLocal();
        return;
      }

      const response = await fetch(mailUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "same-origin",
        body: payload,
      });
      const type = response.headers.get("content-type") || "";
      const data = type.includes("application/json") ? await response.json().catch(() => ({})) : {};
      if (phpDidRespond(data)) {
        if (!data.ok) {
          if (/park code|captcha/i.test(String(data.message || ""))) rollCaptcha();
          throw new Error(data.message || "We could not send the application.");
        }
        showSuccess();
        return;
      }
      await finishLocal();
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const unreachable = /failed to fetch|networkerror|load failed|network request failed/i.test(raw);
      if (unreachable || localFile) {
        await finishLocal();
        return;
      }
      setStatus(
        raw || "We could not send the application. Please email franchise@skyline360park.com.",
        "error"
      );
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Send my inquiry ›";
      }
    }
  });
})();
