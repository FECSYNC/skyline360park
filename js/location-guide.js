/*! Skyline 360 Park — location guide (site-wide popup)
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  Precise GPS + biased place search + interactive map/park picker.
 *  Opens on any page so booking CTAs never force a trip back to home.
 */
(() => {
  const registry = window.SkylineParkRegistry;
  if (!registry?.parks?.length) return;

  const GUIDE_DISMISS_KEY = "skyline360_guide_dismissed";
  const SELECTED_PARK_KEY = registry.SELECTED_PARK_KEY || "skyline360_selected_park";
  const PENDING_PLAN_KEY = registry.PENDING_PLAN_KEY || "skyline360_pending_plan";
  const PLAN_INTENT_KEY = registry.PLAN_INTENT_KEY || "skyline360_plan_intent";
  const AWAITING_KEY = registry.AWAITING_KEY || "skyline360_awaiting_waiver_return";
  const GEOCODE_URL = "https://photon.komoot.io/api/";
  const REVERSE_URL = "https://photon.komoot.io/reverse";

  const PARKS = registry.parks;

  const root = document.documentElement;
  const isHome =
    document.body.dataset.page === "home" ||
    /(?:^|\/)(index\.html)?$/i.test(location.pathname);

  const ensureGuideMarkup = () => {
    if (document.getElementById("location-guide")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
  <div
    class="location-guide"
    id="location-guide"
    role="dialog"
    aria-modal="true"
    aria-labelledby="location-guide-title"
    hidden
  >
    <div class="guide-panel">
      <button type="button" class="guide-exit" data-guide-close aria-label="Close location guide">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="guide-visual" aria-hidden="true">
        <video
          class="guide-video"
          muted
          loop
          playsinline
          autoplay
          preload="none"
          poster="assets/hero-poster.webp"
          data-src-desktop="assets/skylinevideo-hero.mp4?v=2"
          data-src-mobile="assets/skylinevideo-hero-mobile.mp4?v=2"
        ></video>
        <picture class="guide-video-fallback">
          <source type="image/webp" srcset="assets/skylinepics/opt/s3-480.webp">
          <img src="assets/skylinepics/opt/s3-480.jpg" alt="" width="480" height="320" loading="lazy" decoding="async" fetchpriority="low">
        </picture>
      </div>
      <div class="guide-body">
        <div class="guide-top-row">
          <p class="guide-kicker">Skyline 360 Park</p>
          <div class="guide-top-actions">
            <a class="btn-stamp btn-stamp-party guide-waiver-btn" href="waiver.html?mode=walkin">
              <span class="btn-stamp-ico" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none"><path d="M8 4h11l5 5v19H8V4z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M19 4v5h5M11 15h10M11 20h10M11 25h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="btn-stamp-text">Waiver</span>
              <span class="btn-stamp-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M10 8l4 4-4 4" stroke="#1a0530" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </a>
            <a class="btn-stamp btn-stamp-visit guide-franchise-btn" href="franchise.html">
              <span class="btn-stamp-ico" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none"><path d="M4 26h24M6 26V12l10-7 10 7v14" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M13 26v-7h6v7" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 14h2M18 14h2M12 18h2M18 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </span>
              <span class="btn-stamp-text">Franchise With Us</span>
              <span class="btn-stamp-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M10 8l4 4-4 4" stroke="#1a0530" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
            </a>
          </div>
        </div>
        <h2 id="location-guide-title">Welcome to Skyline 360 Park</h2>
        <p class="guide-welcome">
          We will take you to the nearest Skyline park so you can book, sign a waiver, or plan your visit.
          If you would rather stay on this page, choose Close below or the close icon at the top.
        </p>
        <ol class="guide-steps" data-guide-steps aria-label="Finder steps">
          <li class="guide-step is-active" data-guide-step="1"><span>1</span> Locate you</li>
          <li class="guide-step" data-guide-step="2"><span>2</span> Choose a park</li>
          <li class="guide-step" data-guide-step="3"><span>3</span> Continue</li>
        </ol>
        <form data-guide-form>
          <label class="guide-label" for="guide-location-input">Enter your location</label>
          <div class="guide-search-row">
            <input
              id="guide-location-input"
              class="guide-input"
              type="search"
              name="location"
              autocomplete="off"
              placeholder="City, ZIP, street, or park name"
              aria-autocomplete="list"
              aria-controls="guide-suggest-list"
              data-guide-input
            >
            <button type="button" class="guide-locate" data-guide-locate>
              <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 28s-9-9.2-9-15a9 9 0 1 1 18 0c0 5.8-9 15-9 15z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="16" cy="13" r="3.2" stroke="currentColor" stroke-width="2.2"/></svg>
              Near me
            </button>
          </div>
          <div class="guide-suggest" id="guide-suggest-list" data-guide-suggest hidden role="listbox" aria-label="Place suggestions"></div>
          <div class="guide-here" data-guide-here hidden>
            <p class="guide-here-title">Your location</p>
            <p class="guide-here-address" data-guide-here-address></p>
            <div class="guide-accuracy-meter" data-guide-accuracy-meter hidden role="meter" aria-valuemin="0" aria-valuemax="100">
              <span class="guide-accuracy-fill" data-guide-accuracy-fill></span>
            </div>
            <ul class="guide-here-meta">
              <li data-guide-here-country></li>
              <li data-guide-here-coords></li>
              <li data-guide-here-accuracy></li>
              <li data-guide-here-device></li>
            </ul>
          </div>
          <div class="guide-travel" data-guide-travel hidden>
            <p class="guide-travel-title" data-guide-travel-title></p>
            <p class="guide-travel-body" data-guide-travel-body></p>
            <div class="guide-travel-actions" data-guide-travel-actions></div>
          </div>
          <p class="guide-status" data-guide-status hidden role="status" aria-live="polite"></p>
          <div class="guide-map-wrap">
            <div class="guide-map-tools">
              <button type="button" class="guide-map-tool" data-guide-map-locate>Locate me</button>
              <button type="button" class="guide-map-tool" data-guide-map-fit>Fit route</button>
            </div>
            <div class="guide-map" id="guide-map" data-guide-map role="img" aria-label="Live map of your location and Skyline parks"></div>
            <p class="guide-map-hint">Blue pin: you (drag to adjust) · Orange: parks · Tap the map to drop a pin · Tap a park to select it</p>
          </div>
          <div class="guide-results-head">
            <p class="guide-results-label">Skyline parks near you</p>
            <div class="guide-sort" role="group" aria-label="Sort parks">
              <button type="button" class="guide-sort-btn is-active" data-guide-sort="nearest" aria-pressed="true">Nearest</button>
              <button type="button" class="guide-sort-btn" data-guide-sort="name" aria-pressed="false">A–Z</button>
            </div>
          </div>
          <div class="guide-results" data-guide-results role="listbox" aria-label="Nearby parks"></div>
          <div class="guide-actions">
            <button type="submit" class="guide-submit" data-guide-submit disabled>Continue to this park</button>
            <button type="button" class="guide-close" data-guide-close>Close and stay on this page</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
    const node = wrap.firstElementChild;
    if (node) document.body.appendChild(node);
  };

  ensureGuideMarkup();

  const dialog = document.getElementById("location-guide");
  if (!dialog) return;

  const form = dialog.querySelector("[data-guide-form]");
  const input = dialog.querySelector("[data-guide-input]");
  const results = dialog.querySelector("[data-guide-results]");
  const status = dialog.querySelector("[data-guide-status]");
  const locateBtn = dialog.querySelector("[data-guide-locate]");
  const closeBtns = dialog.querySelectorAll("[data-guide-close]");
  const submitBtn = dialog.querySelector("[data-guide-submit]");
  const guideVideo = dialog.querySelector(".guide-video");
  const suggestBox = dialog.querySelector("[data-guide-suggest]");
  const hereCard = dialog.querySelector("[data-guide-here]");
  const hereAddress = dialog.querySelector("[data-guide-here-address]");
  const hereCountry = dialog.querySelector("[data-guide-here-country]");
  const hereCoords = dialog.querySelector("[data-guide-here-coords]");
  const hereAccuracy = dialog.querySelector("[data-guide-here-accuracy]");
  const hereDevice = dialog.querySelector("[data-guide-here-device]");
  const accuracyMeter = dialog.querySelector("[data-guide-accuracy-meter]");
  const accuracyFill = dialog.querySelector("[data-guide-accuracy-fill]");
  const travelCard = dialog.querySelector("[data-guide-travel]");
  const travelTitle = dialog.querySelector("[data-guide-travel-title]");
  const travelBody = dialog.querySelector("[data-guide-travel-body]");
  const travelActions = dialog.querySelector("[data-guide-travel-actions]");
  const mapEl = dialog.querySelector("[data-guide-map]");
  const mapLocateBtn = dialog.querySelector("[data-guide-map-locate]");
  const mapFitBtn = dialog.querySelector("[data-guide-map-fit]");
  const sortBtns = dialog.querySelectorAll("[data-guide-sort]");
  const stepEls = dialog.querySelectorAll("[data-guide-step]");

  const FAR_MILES = 200;
  const VERY_FAR_MILES = 800;
  const GPS_GOOD_M = 40;
  const GPS_EXCELLENT_M = 20;

  let selectedParkId = null;
  let lastOrigin = null;
  let lastRanked = [];
  let sortMode = "nearest";
  let searchTimer = null;
  let suggestTimer = null;
  let lastQuery = "";
  let abortController = null;
  let suggestController = null;
  let map = null;
  let userMarker = null;
  let accuracyCircle = null;
  let parkMarkers = {};
  let routeLine = null;
  let mapReady = false;
  let leafletWaitTries = 0;
  let leafletLoader = null;
  let suggestItems = [];
  let suggestActive = -1;
  let geoWatchId = null;
  let bestAccuracy = Infinity;
  let guideOpen = false;

  const isConstrainedNetwork = () => {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return false;
    if (conn.saveData) return true;
    const t = String(conn.effectiveType || "").toLowerCase();
    return t === "slow-2g" || t === "2g";
  };

  const loadLeaflet = () => {
    if (typeof window.L !== "undefined") return Promise.resolve();
    if (leafletLoader) return leafletLoader;

    leafletLoader = new Promise((resolve, reject) => {
      const preconnect = document.createElement("link");
      preconnect.rel = "preconnect";
      preconnect.href = "https://unpkg.com";
      preconnect.crossOrigin = "";
      document.head.appendChild(preconnect);

      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      css.crossOrigin = "";
      document.head.appendChild(css);

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.crossOrigin = "";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Leaflet failed to load"));
      document.head.appendChild(script);
    });

    return leafletLoader;
  };

  const parkCentroid = (() => {
    const lat = PARKS.reduce((s, p) => s + p.lat, 0) / PARKS.length;
    const lng = PARKS.reduce((s, p) => s + p.lng, 0) / PARKS.length;
    return { lat, lng };
  })();

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const haversineMiles = (aLat, aLng, bLat, bLng) => {
    const R = 3958.7613;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const bearingDeg = (aLat, aLng, bLat, bLng) => {
    const φ1 = toRad(aLat);
    const φ2 = toRad(bLat);
    const Δλ = toRad(bLng - aLng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  const bearingLabel = (deg) => {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(deg / 45) % 8];
  };

  const formatMiles = (miles) => {
    if (miles == null || Number.isNaN(miles)) return "";
    const km = miles * 1.609344;
    if (miles < 0.1) return `${Math.round(miles * 5280)} ft · ${Math.round(km * 1000)} m`;
    if (miles < 1) return `${miles.toFixed(2)} mi · ${(km * 1000).toFixed(0)} m`;
    if (miles < 10) return `${miles.toFixed(1)} mi · ${km.toFixed(1)} km`;
    if (miles < 100) return `${miles.toFixed(0)} mi · ${km.toFixed(0)} km`;
    return `${Math.round(miles)} mi · ${Math.round(km)} km`;
  };

  const formatDriveHint = (miles) => {
    if (miles == null || Number.isNaN(miles)) return "";
    if (miles > VERY_FAR_MILES) return "Flight / long-distance trip";
    if (miles > FAR_MILES) return "Long road trip";
    const hours = miles / 42;
    if (hours < 0.2) return "~10–15 min drive";
    if (hours < 1) return `~${Math.max(10, Math.round(hours * 60))} min drive`;
    if (hours < 10) return `~${hours.toFixed(1)} hr drive`;
    return `~${Math.round(hours)} hr drive`;
  };

  const directionsUrl = (origin, park) => {
    const dest = encodeURIComponent(`${park.lat},${park.lng}`);
    const destLabel = encodeURIComponent(park.address || park.name);
    if (origin?.lat != null && origin?.lng != null) {
      return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest}&travelmode=driving`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${destLabel}&travelmode=driving`;
  };

  const travelModeHint = (miles, outsideUs) => {
    if (outsideUs || miles > VERY_FAR_MILES) {
      return "For this distance, directions usually include a flight and local ground travel.";
    }
    if (miles > FAR_MILES) {
      return "Open driving directions, or compare flights if that better suits your trip.";
    }
    return "Open turn-by-turn directions from your location to this park.";
  };

  const detectDevice = () => {
    const ua = navigator.userAgent || "";
    let os = "Unknown OS";
    if (/Windows NT/i.test(ua)) os = "Windows PC";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/iPhone/i.test(ua)) os = "iPhone";
    else if (/iPad/i.test(ua)) os = "iPad";
    else if (/Mac OS X/i.test(ua)) os = "Mac";
    else if (/CrOS/i.test(ua)) os = "ChromeOS";
    else if (/Linux/i.test(ua)) os = "Linux";

    let formFactor = "Desktop";
    if (/iPad|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))) {
      formFactor = "Tablet";
    } else if (/Mobi|Android|iPhone|iPod/i.test(ua)) {
      formFactor = "Mobile phone";
    }

    let browser = "Browser";
    if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
    else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";

    const screenLabel =
      window.screen?.width && window.screen?.height
        ? `${window.screen.width}×${window.screen.height}`
        : "";

    return {
      summary: `${formFactor} · ${os} · ${browser}${screenLabel ? ` · ${screenLabel}` : ""}`,
    };
  };

  const formatPlaceLabel = (props = {}, fallback = "") => {
    const parts = [
      props.name,
      [props.housenumber, props.street].filter(Boolean).join(" "),
      props.district || props.suburb || props.neighbourhood,
      props.city || props.town || props.village || props.county,
      props.state,
      props.postcode,
      props.country,
    ]
      .filter(Boolean)
      .filter((part, i, arr) => arr.indexOf(part) === i);
    return parts.slice(0, 5).join(", ") || fallback;
  };

  const rankParks = (lat, lng) =>
    PARKS.map((park) => {
      const miles = haversineMiles(lat, lng, park.lat, park.lng);
      const bearing = bearingDeg(lat, lng, park.lat, park.lng);
      return {
        ...park,
        miles,
        bearing,
        bearingText: bearingLabel(bearing),
      };
    }).sort((a, b) => a.miles - b.miles);

  const sortParksList = (parks) => {
    const list = [...parks];
    if (sortMode === "name") {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } else if (list.some((p) => p.miles != null)) {
      list.sort((a, b) => (a.miles ?? Infinity) - (b.miles ?? Infinity));
    }
    return list;
  };

  const parkMatchScore = (park, query) => {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const tokens = q.split(/\s+/).filter(Boolean);
    const fields = [
      park.name,
      park.shortName,
      park.city,
      park.state,
      park.region,
      park.zip,
      park.address,
      ...(park.keywords || []),
    ]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());

    let score = 0;
    for (const token of tokens) {
      let best = 0;
      for (const field of fields) {
        if (field === token) best = Math.max(best, 100);
        else if (field.startsWith(token)) best = Math.max(best, 80);
        else if (field.includes(token)) best = Math.max(best, 55);
      }
      if (!best) return 0;
      score += best;
    }
    return score / tokens.length;
  };

  const matchParksByText = (query) => {
    const scored = PARKS.map((park) => ({ park, score: parkMatchScore(park, query) }))
      .filter((row) => row.score >= 55)
      .sort((a, b) => b.score - a.score);
    return scored.map((row) => row.park);
  };

  const setStatus = (message, tone = "") => {
    if (!status) return;
    status.textContent = message || "";
    status.dataset.tone = tone;
    status.hidden = !message;
  };

  const setGuideStep = (step) => {
    stepEls.forEach((el) => {
      const n = Number(el.dataset.guideStep);
      el.classList.toggle("is-active", n === step);
      el.classList.toggle("is-done", n < step);
    });
  };

  const updateSteps = () => {
    if (selectedParkId) setGuideStep(3);
    else if (lastOrigin) setGuideStep(2);
    else setGuideStep(1);
  };

  const accuracyTone = (meters) => {
    if (meters == null || Number.isNaN(meters)) return "search";
    if (meters <= GPS_EXCELLENT_M) return "excellent";
    if (meters <= GPS_GOOD_M) return "good";
    if (meters <= 100) return "fair";
    return "weak";
  };

  const updateAccuracyMeter = (accuracy) => {
    if (!accuracyMeter || !accuracyFill) return;
    if (accuracy == null || Number.isNaN(accuracy)) {
      accuracyMeter.hidden = true;
      return;
    }
    accuracyMeter.hidden = false;
    const tone = accuracyTone(accuracy);
    accuracyMeter.dataset.tone = tone;
    // Cap visual: 0m = 100%, 150m+ = ~8%
    const pct = Math.max(8, Math.min(100, Math.round(100 - (accuracy / 150) * 92)));
    accuracyFill.style.width = `${pct}%`;
    accuracyMeter.setAttribute("aria-label", `GPS accuracy ${Math.round(accuracy)} meters`);
  };

  const updateHereCard = ({ lat, lng, label, accuracy, country, countrycode, isGps }) => {
    if (!hereCard) return;
    hereCard.hidden = false;
    hereCard.dataset.source = isGps ? "gps" : "search";
    if (hereAddress) hereAddress.textContent = label || "Location from your device GPS";
    if (hereCountry) {
      const code = (countrycode || "").toUpperCase();
      hereCountry.textContent = country
        ? `Country: ${country}${code ? ` (${code})` : ""}`
        : code
          ? `Country code: ${code}`
          : "Country: detecting…";
    }
    if (hereCoords) {
      hereCoords.textContent = `Coordinates: ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    }
    if (hereAccuracy) {
      if (accuracy != null && !Number.isNaN(accuracy)) {
        const ft = accuracy * 3.28084;
        const tone = accuracyTone(accuracy);
        const labelMap = {
          excellent: "excellent",
          good: "good",
          fair: "fair",
          weak: "refining…",
        };
        hereAccuracy.textContent = `GPS accuracy: ±${Math.round(accuracy)} m (${labelMap[tone]} · ±${Math.round(ft)} ft)`;
      } else {
        hereAccuracy.textContent = "Based on the place you typed";
      }
    }
    updateAccuracyMeter(accuracy);
    if (hereDevice) hereDevice.textContent = `Device: ${detectDevice().summary}`;
  };

  const updateTravelNotice = ({ origin, nearest, selected } = {}) => {
    if (!travelCard) return;
    if (!origin || !nearest || nearest.miles == null) {
      travelCard.hidden = true;
      return;
    }

    const focus = selected && selected.miles != null ? selected : nearest;
    const outsideUs = Boolean(origin.countrycode && origin.countrycode !== "us");
    const far = outsideUs || nearest.miles >= FAR_MILES;
    const countryLabel = origin.country || (origin.countrycode || "").toUpperCase() || "your area";

    travelCard.hidden = false;
    travelCard.dataset.tone = far ? "far" : "near";

    if (travelTitle) {
      travelTitle.textContent = far
        ? outsideUs
          ? `You are in ${countryLabel}, outside Skyline’s current park regions`
          : `This location is far from every Skyline 360 Park`
        : `You are near a Skyline 360 Park`;
    }

    if (travelBody) {
      if (far) {
        travelBody.textContent = outsideUs
          ? `We found your location. The nearest park is ${nearest.name} — ${formatMiles(nearest.miles)} (${formatDriveHint(nearest.miles)}). You can check your location again, or choose any Skyline park below.`
          : `The nearest park is ${nearest.name} — ${formatMiles(nearest.miles)} (${formatDriveHint(nearest.miles)}). Please confirm the place you entered, or continue and choose any Skyline park.`;
      } else {
        travelBody.textContent = `The nearest park is ${nearest.name} — ${formatMiles(nearest.miles)} (${formatDriveHint(nearest.miles)}). You selected ${focus.name}${focus.bearingText ? ` · ${focus.bearingText}` : ""}. ${travelModeHint(focus.miles, outsideUs)}`;
      }
    }

    if (travelActions) {
      const dirs = directionsUrl(origin, focus);
      travelActions.innerHTML = `
        <a class="guide-travel-btn" href="${dirs}" target="_blank" rel="noopener noreferrer">Get directions to ${escapeHtml(focus.name || focus.shortName)}</a>
        <button type="button" class="guide-travel-btn guide-travel-btn-soft" data-guide-recheck>Check my location again</button>
      `;
      travelActions.querySelector("[data-guide-recheck]")?.addEventListener("click", () => {
        if (input) input.value = "";
        useMyLocation();
      });
    }
  };

  const hideSuggest = () => {
    if (!suggestBox) return;
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
    suggestItems = [];
    suggestActive = -1;
    input?.removeAttribute("aria-activedescendant");
  };

  const stopGeoWatch = () => {
    if (geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
  };

  const ensureMap = () => {
    if (!mapEl || mapReady) return Boolean(map);
    if (typeof window.L === "undefined") return false;

    map = window.L.map(mapEl, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
    }).setView([parkCentroid.lat, parkCentroid.lng], 5);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    PARKS.forEach((park) => {
      const icon = window.L.divIcon({
        className: "guide-park-marker",
        html: `<span class="guide-park-marker-dot" title="${escapeHtml(park.name)}"></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const marker = window.L.marker([park.lat, park.lng], { icon, title: park.name }).addTo(map);
      marker.bindPopup(
        `<div class="guide-map-popup"><strong>${escapeHtml(park.name)}</strong><br>${escapeHtml(park.address)}<br><button type="button" class="guide-map-popup-btn" data-map-select="${escapeHtml(park.id)}">Select this park</button></div>`
      );
      marker.on("click", () => setSelected(park.id, { fromMap: true }));
      marker.on("popupopen", () => {
        const btn = document.querySelector(`[data-map-select="${park.id}"]`);
        btn?.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            setSelected(park.id, { fromMap: true });
            marker.closePopup();
          },
          { once: true }
        );
      });
      parkMarkers[park.id] = marker;
    });

    // Tap map to set a custom origin pin (interactive precision)
    map.on("click", (e) => {
      const { lat, lng } = e.latlng;
      setStatus("Finding the place you tapped…", "busy");
      suggestFromOrigin(lat, lng, {
        label: "Map pin",
        isGps: false,
        accuracy: null,
      });
    });

    mapReady = true;
    window.setTimeout(() => map.invalidateSize(), 80);
    return true;
  };

  const waitForLeafletThenInit = (done) => {
    if (ensureMap()) {
      done?.();
      return;
    }
    if (leafletWaitTries > 40) {
      setStatus("The map is loading slowly. You can still choose a park from the list below.", "warn");
      done?.();
      return;
    }
    leafletWaitTries += 1;
    window.setTimeout(() => waitForLeafletThenInit(done), 120);
  };

  const drawRoute = (origin, park) => {
    if (!map || !window.L) return;
    if (routeLine) {
      map.removeLayer(routeLine);
      routeLine = null;
    }
    if (!origin || !park) return;
    routeLine = window.L.polyline(
      [
        [origin.lat, origin.lng],
        [park.lat, park.lng],
      ],
      {
        color: "#c8ff2e",
        weight: 3,
        opacity: 0.9,
        dashArray: "7 7",
        className: "guide-route-line",
      }
    ).addTo(map);
  };

  const bindUserMarkerDrag = () => {
    if (!userMarker || userMarker._skylineDragBound) return;
    userMarker._skylineDragBound = true;
    userMarker.on("dragend", () => {
      const pos = userMarker.getLatLng();
      setStatus("Updating from the pin you moved…", "busy");
      suggestFromOrigin(pos.lat, pos.lng, {
        label: "Adjusted map pin",
        isGps: false,
        accuracy: null,
      });
    });
  };

  const syncMap = ({ origin, parks, selectedId } = {}) => {
    if (!ensureMap() || !map) return;

    Object.entries(parkMarkers).forEach(([id, marker]) => {
      const el = marker.getElement();
      if (el) el.classList.toggle("is-selected", id === selectedId);
      const ranked = parks?.find?.((p) => p.id === id);
      if (ranked?.miles != null) {
        if (!marker.getTooltip()) {
          marker.bindTooltip("", { direction: "top", offset: [0, -18], opacity: 0.95 });
        }
        marker.setTooltipContent(
          `${ranked.name}<br>${formatMiles(ranked.miles)}${ranked.bearingText ? ` · ${ranked.bearingText}` : ""}`
        );
      }
    });

    if (origin) {
      const latLng = [origin.lat, origin.lng];
      if (!userMarker) {
        const youIcon = window.L.divIcon({
          className: "guide-you-marker",
          html: '<span class="guide-you-pulse"></span><span class="guide-you-dot"></span>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        userMarker = window.L.marker(latLng, {
          icon: youIcon,
          zIndexOffset: 600,
          draggable: true,
          title: "Drag to adjust your position",
        }).addTo(map);
        userMarker.bindPopup("<strong>You are here</strong><br>Drag the pin to adjust your position");
        bindUserMarkerDrag();
      } else {
        userMarker.setLatLng(latLng);
        if (!userMarker.dragging?.enabled()) userMarker.dragging.enable();
        bindUserMarkerDrag();
      }

      if (origin.accuracy != null && !Number.isNaN(origin.accuracy)) {
        if (!accuracyCircle) {
          accuracyCircle = window.L.circle(latLng, {
            radius: Math.max(origin.accuracy, 12),
            color: "#2ec4ff",
            weight: 1,
            fillColor: "#2ec4ff",
            fillOpacity: 0.15,
          }).addTo(map);
        } else {
          accuracyCircle.setLatLng(latLng);
          accuracyCircle.setRadius(Math.max(origin.accuracy, 12));
        }
      } else if (accuracyCircle) {
        map.removeLayer(accuracyCircle);
        accuracyCircle = null;
      }

      const selectedPark = PARKS.find((p) => p.id === selectedId) || parks?.[0];
      drawRoute(origin, selectedPark);

      if (selectedPark) {
        const bounds = window.L.latLngBounds([latLng, [selectedPark.lat, selectedPark.lng]]);
        const miles = haversineMiles(origin.lat, origin.lng, selectedPark.lat, selectedPark.lng);
        map.fitBounds(bounds.pad(miles > FAR_MILES ? 0.08 : 0.28), {
          maxZoom: miles > FAR_MILES ? 5 : miles < 5 ? 13 : 11,
          animate: true,
        });
      } else {
        map.setView(latLng, origin.accuracy && origin.accuracy < 80 ? 14 : 11, { animate: true });
      }
    } else {
      const group = window.L.featureGroup(Object.values(parkMarkers));
      map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 6, animate: true });
      drawRoute(null, null);
    }

    window.setTimeout(() => map.invalidateSize(), 60);
  };

  const persistSelectedPark = (parkId) => {
    const id = registry.setSelectedParkId?.(parkId) || parkId;
    if (!id) return;
    try {
      sessionStorage.setItem(SELECTED_PARK_KEY, id);
    } catch (_) {}
    window.dispatchEvent(new CustomEvent("skyline360:park-selected", { detail: { parkId: id } }));
  };

  const setSelected = (parkId, { fromMap } = {}) => {
    selectedParkId = parkId;
    if (submitBtn) submitBtn.disabled = !parkId;
    results?.querySelectorAll("[data-park-id]").forEach((card) => {
      const on = card.dataset.parkId === parkId;
      card.classList.toggle("is-selected", on);
      const btn = card.querySelector("[data-select-park]");
      if (btn) btn.setAttribute("aria-pressed", String(on));
    });

    const park = PARKS.find((p) => p.id === parkId);
    const ranked = lastOrigin ? rankParks(lastOrigin.lat, lastOrigin.lng) : lastRanked;
    const selectedRanked =
      ranked?.find((p) => p.id === parkId) ||
      (park && lastOrigin
        ? {
            ...park,
            miles: haversineMiles(lastOrigin.lat, lastOrigin.lng, park.lat, park.lng),
            bearing: bearingDeg(lastOrigin.lat, lastOrigin.lng, park.lat, park.lng),
            bearingText: bearingLabel(
              bearingDeg(lastOrigin.lat, lastOrigin.lng, park.lat, park.lng)
            ),
          }
        : park);

    if (park && lastOrigin) {
      const miles = selectedRanked.miles;
      const outsideUs = Boolean(lastOrigin.countrycode && lastOrigin.countrycode !== "us");
      setStatus(
        outsideUs || miles >= FAR_MILES
          ? `Selected ${park.name} from afar — ${formatMiles(miles)} away. You can still open this park and book ahead.`
          : `Selected ${park.name} — ${formatMiles(miles)} · ${selectedRanked.bearingText || ""} (${formatDriveHint(miles)}).`,
        "ok"
      );
      updateTravelNotice({
        origin: lastOrigin,
        nearest: ranked?.[0],
        selected: selectedRanked,
      });
    } else if (park) {
      setStatus(`You selected ${park.name}. Continue to open that park’s page.`, "ok");
    }

    persistSelectedPark(parkId);

    syncMap({
      origin: lastOrigin,
      parks: ranked?.length ? ranked : PARKS,
      selectedId: parkId,
    });
    updateSteps();

    if (fromMap && park) {
      const card = results?.querySelector(`[data-park-id="${park.id}"]`);
      card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  };

  const renderParks = (parks, { emptyMessage } = {}) => {
    if (!results) return;
    const sorted = sortParksList(parks);
    lastRanked = sorted;

    if (!sorted.length) {
      results.innerHTML = `<p class="guide-empty">${emptyMessage || "No matching parks yet. Try a city, ZIP, or park name."}</p>`;
      setSelected(null);
      updateSteps();
      return;
    }

    const maxMiles = Math.max(...sorted.map((p) => p.miles || 0), 1);

    results.innerHTML = sorted
      .map((park, index) => {
        const distance = park.miles != null ? formatMiles(park.miles) : "";
        const drive = park.miles != null ? formatDriveHint(park.miles) : "";
        const bearing =
          park.bearingText && park.miles != null
            ? `<span class="guide-bearing">${park.bearingText}</span>`
            : "";
        const badge =
          park.status === "opening-soon" ? `<span class="guide-badge">Opening soon</span>` : "";
        const nearest =
          sortMode === "nearest" && index === 0 && park.miles != null
            ? `<span class="guide-nearest">Closest</span>`
            : "";
        const rank = `<span class="guide-park-rank">${index + 1}</span>`;
        const barPct =
          park.miles != null ? Math.max(8, Math.round(100 - (park.miles / maxMiles) * 92)) : 0;
        const dirs = lastOrigin ? directionsUrl(lastOrigin, park) : directionsUrl(null, park);
        return `
          <article class="guide-park" data-park-id="${escapeHtml(park.id)}" style="--guide-rank-delay:${index * 40}ms">
            <button type="button" class="guide-park-main" data-select-park aria-pressed="false">
              ${rank}
              <span class="guide-park-pin" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none"><path d="M16 28s-9-9.2-9-15a9 9 0 1 1 18 0c0 5.8-9 15-9 15z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="16" cy="13" r="3.2" stroke="currentColor" stroke-width="2.2"/></svg>
              </span>
              <span class="guide-park-copy">
                <span class="guide-park-title">${escapeHtml(park.name)} ${nearest}</span>
                <span class="guide-park-meta">${escapeHtml(park.address)}</span>
                <span class="guide-park-row">${distance ? `<strong>${distance}</strong>` : ""}${bearing}${drive ? `<span class="guide-drive">${drive}</span>` : ""}${badge}</span>
                ${
                  park.miles != null
                    ? `<span class="guide-dist-bar" aria-hidden="true"><span style="width:${barPct}%"></span></span>`
                    : ""
                }
              </span>
            </button>
            <a class="guide-directions" href="${dirs}" target="_blank" rel="noopener noreferrer">Get directions</a>
          </article>
        `;
      })
      .join("");

    const preferred =
      (selectedParkId && sorted.some((p) => p.id === selectedParkId) && selectedParkId) ||
      sorted[0]?.id ||
      null;
    setSelected(preferred);

    results.querySelectorAll("[data-select-park]").forEach((btn) => {
      const card = btn.closest("[data-park-id]");
      btn.addEventListener("click", () => {
        const id = card?.dataset.parkId;
        if (id) setSelected(id);
      });
      btn.addEventListener("mouseenter", () => {
        const id = card?.dataset.parkId;
        const marker = id && parkMarkers[id];
        if (marker && map) {
          marker.openTooltip?.();
          const el = marker.getElement();
          el?.classList.add("is-hover");
        }
      });
      btn.addEventListener("mouseleave", () => {
        const id = card?.dataset.parkId;
        const marker = id && parkMarkers[id];
        if (marker) {
          marker.closeTooltip?.();
          marker.getElement()?.classList.remove("is-hover");
        }
      });
    });
  };

  const biasPoint = () => lastOrigin || parkCentroid;

  const scorePlace = (place) => {
    let score = 0;
    const code = (place.countrycode || "").toLowerCase();
    if (code === "us") score += 60;
    else if (code) score -= 25;

    const nearest = Math.min(
      ...PARKS.map((p) => haversineMiles(place.lat, place.lng, p.lat, p.lng))
    );
    score += Math.max(0, 120 - nearest);

    const props = place.props || {};
    const type = String(props.type || props.osm_value || "").toLowerCase();
    if (/(city|town|village|suburb|neighbourhood|residential|house|street)/.test(type)) score += 20;
    if (/(state|country|county)/.test(type) && !props.city) score -= 10;
    if (props.postcode) score += 8;
    return score;
  };

  const normalizePlaces = (features, query) => {
    const places = features
      .map((feature) => {
        if (!feature?.geometry?.coordinates) return null;
        const [lng, lat] = feature.geometry.coordinates;
        const props = feature.properties || {};
        return {
          lat: Number(lat),
          lng: Number(lng),
          label: formatPlaceLabel(props, props.name || query),
          country: props.country || "",
          countrycode: (props.countrycode || "").toLowerCase(),
          props,
        };
      })
      .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));

    // Deduplicate near-identical coordinates
    const unique = [];
    for (const place of places) {
      const dup = unique.some(
        (u) => haversineMiles(u.lat, u.lng, place.lat, place.lng) < 0.05
      );
      if (!dup) unique.push(place);
    }

    return unique
      .map((place) => ({ ...place, score: scorePlace(place) }))
      .sort((a, b) => b.score - a.score);
  };

  const geocodeQuery = async (query, { limit = 8, signal } = {}) => {
    const bias = biasPoint();
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", String(bias.lat));
    url.searchParams.set("lon", String(bias.lng));
    // Soft US focus (Photon bbox: minLon,minLat,maxLon,maxLat)
    url.searchParams.set("bbox", "-125,24,-66,50");

    const response = await fetch(url.toString(), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Geocode failed");
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return normalizePlaces(features, query);
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
    const props = feature.properties || {};
    return {
      label: formatPlaceLabel(props, "Your current location"),
      country: props.country || "",
      countrycode: (props.countrycode || "").toLowerCase(),
    };
  };

  const suggestFromOrigin = async (
    lat,
    lng,
    { label, accuracy, isGps, country, countrycode, keepWorseGps } = {}
  ) => {
    // Ignore GPS updates that are less accurate than what we already have
    if (
      isGps &&
      !keepWorseGps &&
      lastOrigin?.isGps &&
      accuracy != null &&
      lastOrigin.accuracy != null &&
      accuracy > lastOrigin.accuracy + 8
    ) {
      return;
    }

    let resolvedLabel = label;
    let resolvedCountry = country || "";
    let resolvedCode = (countrycode || "").toLowerCase();

    if (isGps || !resolvedCode) {
      try {
        const precise = await reverseGeocode(lat, lng);
        if (precise) {
          if (isGps || !resolvedLabel || resolvedLabel.startsWith("Your live") || resolvedLabel.startsWith("Refined") || resolvedLabel.startsWith("Custom") || resolvedLabel.startsWith("Adjusted")) {
            resolvedLabel = precise.label;
          }
          if (precise.country) resolvedCountry = precise.country;
          if (precise.countrycode) resolvedCode = precise.countrycode;
        }
      } catch (_) {
        resolvedLabel = resolvedLabel || "Your current location";
      }
    }

    lastOrigin = {
      lat,
      lng,
      label: resolvedLabel,
      accuracy,
      isGps: Boolean(isGps),
      country: resolvedCountry,
      countrycode: resolvedCode,
    };
    if (isGps && accuracy != null) bestAccuracy = Math.min(bestAccuracy, accuracy);

    updateHereCard(lastOrigin);

    const ranked = rankParks(lat, lng);
    const nearest = ranked[0];
    const outsideUs = Boolean(resolvedCode && resolvedCode !== "us");
    const far = outsideUs || nearest.miles >= FAR_MILES;

    setStatus(
      far
        ? `${isGps ? "Live GPS locked" : "Mapped"} in ${resolvedCountry || resolvedLabel}. Closest Skyline park is ${nearest.name} — ${formatMiles(nearest.miles)}. You can still choose any park below.`
        : `${isGps ? "Live GPS locked" : "Mapped"} near ${resolvedLabel}. Closest: ${nearest.name} (${formatMiles(nearest.miles)} · ${nearest.bearingText} · ${formatDriveHint(nearest.miles)}).`,
      far ? "warn" : "ok"
    );

    updateTravelNotice({ origin: lastOrigin, nearest, selected: nearest });
    renderParks(ranked);
    syncMap({ origin: lastOrigin, parks: ranked, selectedId: nearest.id });
    updateSteps();
  };

  const highlightSuggest = () => {
    if (!suggestBox) return;
    suggestBox.querySelectorAll(".guide-suggest-item").forEach((el, i) => {
      const on = i === suggestActive;
      el.classList.toggle("is-active", on);
      if (on) {
        el.id = "guide-suggest-active";
        input?.setAttribute("aria-activedescendant", "guide-suggest-active");
        el.scrollIntoView({ block: "nearest" });
      } else if (el.id === "guide-suggest-active") {
        el.removeAttribute("id");
      }
    });
  };

  const applySuggestion = (place) => {
    if (!place) return;
    if (input) input.value = place.label;
    hideSuggest();
    suggestFromOrigin(place.lat, place.lng, {
      label: place.label,
      isGps: false,
      country: place.country,
      countrycode: place.countrycode,
    });
  };

  const renderSuggestions = (places) => {
    if (!suggestBox) return;
    suggestItems = places.slice(0, 6);
    suggestActive = -1;
    if (!suggestItems.length) {
      hideSuggest();
      return;
    }
    suggestBox.hidden = false;
    suggestBox.innerHTML = suggestItems
      .map(
        (place, index) => `
        <button type="button" class="guide-suggest-item" role="option" id="guide-suggest-${index}" data-suggest-index="${index}">
          <strong>${escapeHtml(place.label)}</strong>
          <span>${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}${place.countrycode ? ` · ${place.countrycode.toUpperCase()}` : ""}</span>
        </button>`
      )
      .join("");

    suggestBox.querySelectorAll("[data-suggest-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        applySuggestion(suggestItems[Number(btn.dataset.suggestIndex)]);
      });
    });
  };

  const runSuggest = async (rawQuery) => {
    const query = rawQuery.trim();
    if (query.length < 2) {
      hideSuggest();
      return;
    }
    if (suggestController) suggestController.abort();
    suggestController = new AbortController();
    try {
      const places = await geocodeQuery(query, { limit: 8, signal: suggestController.signal });
      renderSuggestions(places);
    } catch (err) {
      if (err.name !== "AbortError") hideSuggest();
    }
  };

  const runSearch = async (rawQuery) => {
    const query = rawQuery.trim();
    lastQuery = query;

    if (!query) {
      hideSuggest();
      if (lastOrigin) {
        suggestFromOrigin(lastOrigin.lat, lastOrigin.lng, {
          label: lastOrigin.label,
          accuracy: lastOrigin.accuracy,
          isGps: lastOrigin.isGps,
          country: lastOrigin.country,
          countrycode: lastOrigin.countrycode,
          keepWorseGps: true,
        });
      } else {
        setStatus("Type a city, ZIP, or street, or tap Near me to use your location.", "");
        renderParks(PARKS);
        syncMap({ parks: PARKS });
        if (travelCard) travelCard.hidden = true;
        updateSteps();
      }
      return;
    }

    const localHits = matchParksByText(query);
    if (localHits.length) {
      hideSuggest();
      const ranked = lastOrigin
        ? localHits
            .map((park) => {
              const miles = haversineMiles(lastOrigin.lat, lastOrigin.lng, park.lat, park.lng);
              const bearing = bearingDeg(lastOrigin.lat, lastOrigin.lng, park.lat, park.lng);
              return { ...park, miles, bearing, bearingText: bearingLabel(bearing) };
            })
            .sort((a, b) => a.miles - b.miles)
        : localHits.map((park) => ({ ...park, miles: null }));
      setStatus(
        ranked.length === 1
          ? `We found ${ranked[0].name}. Select it to continue, or type a different place.`
          : `We found ${ranked.length} matching parks. Please choose the Skyline location you want.`,
        "ok"
      );
      renderParks(ranked);
      syncMap({ origin: lastOrigin, parks: ranked, selectedId: ranked[0]?.id });
      return;
    }

    setStatus("Finding that location…", "busy");
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      const places = await geocodeQuery(query, { limit: 8, signal: abortController.signal });
      if (query !== lastQuery) return;
      if (!places.length) {
        setStatus("We could not find that place. Try a nearby city, ZIP, or street name.", "warn");
        renderParks([], { emptyMessage: "No parks matched that search." });
        return;
      }
      renderSuggestions(places);
      const place = places[0];
      await suggestFromOrigin(place.lat, place.lng, {
        label: place.label,
        isGps: false,
        country: place.country,
        countrycode: place.countrycode,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      setStatus("Location lookup is taking longer than usual. Please try again, or choose a park below.", "warn");
      renderParks(PARKS);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setStatus("Your browser cannot share location. Type a city or ZIP instead.", "warn");
      return;
    }

    stopGeoWatch();
    bestAccuracy = Infinity;
    setStatus("Finding your location…", "busy");
    setGuideStep(1);
    if (locateBtn) {
      locateBtn.disabled = true;
      locateBtn.classList.add("is-busy");
    }

    const finishBusy = () => {
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.classList.remove("is-busy");
      }
    };

    const applyPosition = (pos, refined) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if (accuracy != null && accuracy > bestAccuracy + 8 && lastOrigin?.isGps) return;
      if (accuracy != null) bestAccuracy = Math.min(bestAccuracy, accuracy);
      if (input) input.value = "";
      hideSuggest();
      suggestFromOrigin(latitude, longitude, {
        label: refined ? "Updated GPS location" : "Your current location",
        accuracy,
        isGps: true,
      });
      if (accuracy != null && accuracy <= GPS_EXCELLENT_M) {
        stopGeoWatch();
        finishBusy();
      }
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyPosition(pos, false);
        finishBusy();

        // Keep watching briefly to refine accuracy
        geoWatchId = navigator.geolocation.watchPosition(
          (refined) => applyPosition(refined, true),
          () => stopGeoWatch(),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
        );
        window.setTimeout(() => {
          stopGeoWatch();
          finishBusy();
        }, 14000);
      },
      (err) => {
        finishBusy();
        stopGeoWatch();
        const tip =
          err?.code === 1
            ? "Location permission was blocked. Allow location for this site, or type your city or ZIP."
            : "We could not access your GPS yet. Type a city or ZIP, or choose a park below.";
        setStatus(tip, "warn");
        renderParks(PARKS);
        syncMap({ parks: PARKS });
        updateSteps();
      },
      { enableHighAccuracy: true, timeout: 18000, maximumAge: 0 }
    );
  };

  const startGuideVideo = () => {
    if (!guideVideo) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      guideVideo.removeAttribute("src");
      guideVideo.removeAttribute("autoplay");
      guideVideo.preload = "none";
      return;
    }

    const mobile = window.matchMedia("(max-width: 809.98px)").matches;
    const src = mobile
      ? guideVideo.dataset.srcMobile || guideVideo.dataset.srcDesktop
      : guideVideo.dataset.srcDesktop || guideVideo.dataset.srcMobile;
    if (!src) return;

    if (guideVideo.getAttribute("src") !== src) {
      guideVideo.muted = true;
      guideVideo.defaultMuted = true;
      guideVideo.playsInline = true;
      guideVideo.loop = true;
      guideVideo.preload = "metadata";
      guideVideo.setAttribute("muted", "");
      guideVideo.setAttribute("playsinline", "");
      guideVideo.setAttribute("loop", "");
      guideVideo.src = src;
      guideVideo.load();
    } else {
      guideVideo.loop = true;
      guideVideo.setAttribute("loop", "");
    }

    const play = () => {
      guideVideo.loop = true;
      const promise = guideVideo.play();
      if (promise && typeof promise.catch === "function") {
        promise
          .then(() => guideVideo.classList.add("is-playing"))
          .catch(() => {});
      } else {
        guideVideo.classList.add("is-playing");
      }
    };

    if (!guideVideo._skylineLoopBound) {
      guideVideo._skylineLoopBound = true;
      const restart = () => {
        try {
          guideVideo.currentTime = 0;
        } catch (_) {}
        play();
      };
      guideVideo.addEventListener("ended", restart);
      guideVideo.addEventListener("pause", () => {
        if (document.hidden || !guideVideo.src) return;
        const dur = guideVideo.duration;
        if (Number.isFinite(dur) && dur > 0 && guideVideo.currentTime >= dur - 0.35) {
          restart();
        }
      });
    }

    if (guideVideo.readyState >= 2) play();
    else guideVideo.addEventListener("loadeddata", play, { once: true });
  };

  const stopGuideVideo = () => {
    if (!guideVideo) return;
    guideVideo.pause();
    guideVideo.classList.remove("is-playing");
  };

  const openGuide = (options = {}) => {
    guideOpen = true;
    try {
      sessionStorage.removeItem(GUIDE_DISMISS_KEY);
    } catch (_) {}
    if (!selectedParkId) {
      selectedParkId = registry.getSelectedParkId?.() || null;
      if (submitBtn) submitBtn.disabled = !selectedParkId;
    }
    if (options.planId) {
      try {
        sessionStorage.setItem(
          PENDING_PLAN_KEY,
          JSON.stringify({ planId: String(options.planId).toLowerCase(), at: Date.now() })
        );
      } catch (_) {}
    }
    if (options.message) {
      setStatus(String(options.message), "ok");
    }
    dialog.hidden = false;
    requestAnimationFrame(() => dialog.classList.add("is-open"));
    document.body.classList.add("guide-open");
    updateSteps();

    if (hereCard) {
      hereCard.hidden = false;
      if (!lastOrigin) {
        if (hereAddress) hereAddress.textContent = "Finding your location…";
        if (hereCountry) hereCountry.textContent = "Country: detecting…";
        if (hereCoords) hereCoords.textContent = "Coordinates: waiting for GPS or search…";
        if (hereAccuracy) hereAccuracy.textContent = "GPS accuracy: detecting…";
        if (accuracyMeter) accuracyMeter.hidden = true;
      }
      if (hereDevice) hereDevice.textContent = `Device: ${detectDevice().summary}`;
    }

    startGuideVideo();
    loadLeaflet()
      .then(() => {
        waitForLeafletThenInit(() => {
          syncMap({
            origin: lastOrigin,
            parks: lastOrigin ? rankParks(lastOrigin.lat, lastOrigin.lng) : PARKS,
            selectedId: selectedParkId,
          });
        });
      })
      .catch(() => {
        setStatus("The map is unavailable right now. Please choose a park from the list below.", "warn");
      });
    const focusTarget = input || closeBtns[0];
    window.setTimeout(() => focusTarget?.focus(), 180);
  };

  const closeGuide = () => {
    guideOpen = false;
    dialog.classList.remove("is-open");
    document.body.classList.remove("guide-open");
    stopGuideVideo();
    stopGeoWatch();
    hideSuggest();
    try {
      sessionStorage.setItem(GUIDE_DISMISS_KEY, "1");
    } catch (_) {}
    if (selectedParkId) persistSelectedPark(selectedParkId);
    window.setTimeout(() => {
      dialog.hidden = true;
    }, 280);
  };

  const goToPark = (parkId) => {
    const park = PARKS.find((p) => p.id === parkId);
    if (!park) return;
    persistSelectedPark(park.id);
    try {
      sessionStorage.setItem("skyline360_from_guide", park.id);
    } catch (_) {}

    let planId = "";
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_PLAN_KEY) || "null");
      planId = String(pending?.planId || "").trim().toLowerCase();
      sessionStorage.removeItem(PENDING_PLAN_KEY);
    } catch (_) {
      planId = "";
    }

    if (planId && typeof registry.waiverHrefFor === "function") {
      // Active walk-in pass for this park: skip plan waiver and open that plan’s packages.
      if (registry.hasValidWalkinPass?.(park.id)) {
        try {
          sessionStorage.setItem(
            PLAN_INTENT_KEY,
            JSON.stringify({ parkId: park.id, planId, at: Date.now() })
          );
        } catch (_) {}
        const join = park.href.includes("?") ? "&" : "?";
        window.location.href = `${park.href}${join}from=walkin#plan-list-${encodeURIComponent(planId)}`;
        return;
      }
      try {
        sessionStorage.setItem(
          PLAN_INTENT_KEY,
          JSON.stringify({ parkId: park.id, planId, at: Date.now() })
        );
        sessionStorage.setItem(
          AWAITING_KEY,
          JSON.stringify({ parkId: park.id, planId, at: Date.now() })
        );
      } catch (_) {}
      window.location.href = registry.waiverHrefFor(planId, park.id);
      return;
    }

    window.location.href = `${park.href}#plans`;
  };

  window.SkylineOpenLocationGuide = (options) => {
    openGuide(options || {});
    if (!lastOrigin) {
      if (isConstrainedNetwork()) {
        window.setTimeout(() => useMyLocation(), 700);
      } else {
        useMyLocation();
      }
    }
  };

  closeBtns.forEach((btn) => {
    btn.addEventListener("click", closeGuide);
  });

  locateBtn?.addEventListener("click", useMyLocation);
  mapLocateBtn?.addEventListener("click", useMyLocation);
  mapFitBtn?.addEventListener("click", () => {
    syncMap({
      origin: lastOrigin,
      parks: lastOrigin ? rankParks(lastOrigin.lat, lastOrigin.lng) : lastRanked,
      selectedId: selectedParkId,
    });
  });

  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      sortMode = btn.dataset.guideSort || "nearest";
      sortBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      renderParks(lastRanked.length ? lastRanked : PARKS);
    });
  });

  input?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => runSuggest(input.value), 180);
    searchTimer = setTimeout(() => runSearch(input.value), 380);
  });

  input?.addEventListener("keydown", (e) => {
    if (!suggestBox || suggestBox.hidden || !suggestItems.length) {
      if (e.key === "Escape") hideSuggest();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      suggestActive = (suggestActive + 1) % suggestItems.length;
      highlightSuggest();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      suggestActive = (suggestActive - 1 + suggestItems.length) % suggestItems.length;
      highlightSuggest();
    } else if (e.key === "Enter" && suggestActive >= 0) {
      e.preventDefault();
      applySuggestion(suggestItems[suggestActive]);
    } else if (e.key === "Escape") {
      hideSuggest();
    }
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    hideSuggest();
    if (!selectedParkId) {
      setStatus("Please choose a Skyline park first.", "warn");
      setGuideStep(2);
      return;
    }
    goToPark(selectedParkId);
  });

  document.addEventListener("click", (e) => {
    if (!suggestBox || suggestBox.hidden) return;
    if (e.target.closest("[data-guide-suggest]") || e.target.closest("[data-guide-input]")) return;
    hideSuggest();
  });

  const wantsGuide = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("guide") === "1") return true;
    if ((window.location.hash || "").replace(/^#/, "") === "find-park") return true;
    return false;
  };

  const clearGuideQuery = () => {
    if (!wantsGuide()) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("guide");
      if (url.hash === "#find-park") url.hash = "";
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (_) {}
  };

  const waitForLoaderThenOpen = () => {
    if (wantsGuide()) {
      try {
        sessionStorage.removeItem(GUIDE_DISMISS_KEY);
      } catch (_) {}
    }

    const tryOpen = () => {
      if (root.classList.contains("is-loading") || root.classList.contains("has-loader")) {
        return false;
      }
      openGuide();
      // On constrained networks, delay GPS a beat so the guide UI paints first.
      if (isConstrainedNetwork()) {
        window.setTimeout(() => useMyLocation(), 700);
      } else {
        useMyLocation();
      }
      clearGuideQuery();
      return true;
    };

    if (tryOpen()) return;

    const observer = new MutationObserver(() => {
      if (tryOpen()) observer.disconnect();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    window.setTimeout(() => {
      observer.disconnect();
      if (!dialog.classList.contains("is-open")) {
        openGuide();
        if (isConstrainedNetwork()) {
          window.setTimeout(() => useMyLocation(), 700);
        } else {
          useMyLocation();
        }
        clearGuideQuery();
      }
    }, 1600);
  };

  // Pause GPS watch when tab hidden to save battery / avoid stale jumps
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopGeoWatch();
  });

  renderParks(PARKS);
  updateSteps();
  if (wantsGuide()) {
    let pendingPlan = "";
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_PLAN_KEY) || "null");
      pendingPlan = String(pending?.planId || "").trim().toLowerCase();
    } catch (_) {}
    setStatus(
      pendingPlan
        ? "Choose your Skyline park first. Next you will continue with that plan’s booking for the location you select."
        : "Please choose a park first. Next you will select a plan and sign that plan’s waiver.",
      "ok"
    );
  } else {
    setStatus("Allow location access, or type an address. You can also tap the map to drop a pin.", "");
  }

  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(GUIDE_DISMISS_KEY) === "1";
  } catch (_) {}
  // Auto-open only on the home page (first visit / ?guide=1).
  // On other pages the finder opens only when a booking button is clicked,
  // so guests are never yanked away from the page they were reading.
  if (isHome && (wantsGuide() || !dismissed)) {
    waitForLoaderThenOpen();
  } else if (!isHome && wantsGuide()) {
    waitForLoaderThenOpen();
  }
})();
