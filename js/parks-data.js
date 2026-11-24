/*! Skyline 360 Park — shared parks registry
 *  Design & front-end engineering: Steve Ubangha Ewa
 *  https://nazarng.com/steve.html
 *
 *  HOW TO ADD A NEW PARK LATER
 *  1. Copy one park object below and change id, name, address, lat/lng, etc.
 *  2. Set href to "location.html?id=your-id" (must match the id).
 *  3. Set booking.waivers to local waiver.html?park=ID&plan=PLAN links.
 *     Set booking.bookingPages to that park’s WordPress booking URLs (post-waiver redirect).
 *     Set booking.notifyEmail / fromEmail for THAT location only (never share across parks).
 *  4. Mirror the same notify + redirect values in waiver-parks.php (server whitelist).
 *  5. Optional: contact { phone, email, hoursHtml, messageFormUrl, ... } — missing phone/email/hours use contactDefaults.
 *     Always set messageFormUrl to THAT park’s own contact-form page (never reuse another park’s form).
 *  6. Optional: lead, hero, video, gallery — only that park will show them.
 *  7. Upload parks-data.js, waiver-parks.php, waiver-mail.php, waiver.html, js/waiver.js (and bump ?v=).
 *     You do NOT need a new HTML file per park.
 *
 *  Park sites (post-waiver booking / contact):
 *    Katy, Texas              → https://booking.skyline360park.com/
 *    Fort Worth, Texas        → https://texasfortworth.skyline360park.com/
 *    Pennsylvania            → https://pennsylvaniapa.skyline360park.com/
 *  Mailboxes are created on the main domain (e.g. katy@skyline360park.com), not on the park subdomains.
 *
 *  IMPORTANT: Each park has its own notify inbox and plan booking URLs.
 */
(() => {
  const SELECTED_PARK_KEY = "skyline360_selected_park";
  const FROM_GUIDE_KEY = "skyline360_from_guide";
  const PLAN_INTENT_KEY = "skyline360_plan_intent";
  const AWAITING_KEY = "skyline360_awaiting_waiver_return";
  /** Plan clicked before the visitor chooses a park in the location guide. */
  const PENDING_PLAN_KEY = "skyline360_pending_plan";
  /** Walk-in / navbar waiver pass (per park). Expires after 1.5 hours. */
  const WALKIN_PASS_KEY = "skyline360_walkin_waiver_pass";
  const WALKIN_PASS_MS = Math.round(1.5 * 60 * 60 * 1000);

  /** Shared contact placeholders until a park has its own details.
   *  Do NOT put a shared messageFormUrl here — each park must set its own form link. */
  const contactDefaults = {
    phone: "(469) 922-3788",
    phoneTel: "+14699223788",
    phoneNote: "Mon–Sun during open hours",
    email: "info@skyline360park.com",
    emailNote: "We reply within 1 business day",
    hoursHtml: "Mon–Thu 9am–9pm<br>Fri–Sat 9am–10pm<br>Sun 8:30am–9pm",
    hoursNote: "Typical hours — confirm for this location",
    hoursNoteHref: "index.html#hours",
    hoursNoteLabel: "Full hours & map",
    addressPending: "Address coming soon",
    directionsLabel: "Get directions",
  };

  /** Local waiver form URL for one park + plan (hosted on this site). */
  const localWaiverHref = (parkId, planId) =>
    `waiver.html?park=${encodeURIComponent(parkId)}&plan=${encodeURIComponent(planId)}`;

  /**
   * Build plans for ONE park.
   * waiver → local form; bookingUrl → that location’s WordPress booking page after submit.
   */
  const buildParkPlans = (parkId, waivers = {}, bookingPages = {}) => [
    {
      id: "general",
      label: "General Visit",
      blurb: "Open jump sessions",
      from: "$24",
      waiver: waivers.general || localWaiverHref(parkId, "general"),
      bookingUrl: bookingPages.general || "",
      intro: "Pick the open-jump package that fits your day.",
      options: [
        { name: "1.5 Hour", price: "$24" },
        { name: "2 Hours", price: "$29" },
        { name: "All Day", price: "$32" },
      ],
      compareHref: "index.html#rates",
    },
    {
      id: "kids",
      label: "Kids & Family",
      blurb: "Fun for all ages",
      from: "$20",
      waiver: waivers.kids || localWaiverHref(parkId, "kids"),
      bookingUrl: bookingPages.kids || "",
      intro: "Family-friendly packages for little jumpers and grown-ups.",
      options: [
        { name: "1.5 Hours", price: "$20" },
        { name: "2 Hours", price: "$25" },
        { name: "All Day", price: "$28" },
      ],
      compareHref: "index.html#rates",
    },
    {
      id: "membership",
      label: "Membership",
      blurb: "Unlimited fun all year",
      from: "$89",
      waiver: waivers.membership || localWaiverHref(parkId, "membership"),
      bookingUrl: bookingPages.membership || "",
      intro: "Choose a membership that matches how often you play.",
      options: [
        { name: "Starter Membership", price: "from $89" },
        { name: "Member discounts", price: "Included" },
        { name: "Priority bookings", price: "Included" },
        { name: "Birthday rewards", price: "Included" },
      ],
      compareHref: "index.html#rates",
    },
    {
      id: "groups",
      label: "Groups",
      blurb: "Schools, teams & more",
      from: "$22",
      waiver: waivers.groups || localWaiverHref(parkId, "groups"),
      bookingUrl: bookingPages.groups || "",
      intro: "School, team, and crew packages with simple planning.",
      options: [
        { name: "2 Hour Session", price: "$22 / guest" },
        { name: "All Day Option", price: "$27 / guest" },
        { name: "Group Host", price: "Yes" },
      ],
      compareHref: "contact.html",
      compareLabel: "Talk to our team",
    },
    {
      id: "party",
      label: "Party Packages",
      blurb: "Birthdays & celebrations",
      from: "Packages",
      waiver: waivers.party || localWaiverHref(parkId, "party"),
      bookingUrl: bookingPages.party || "",
      intro: "Birthday and celebration packages — pick what fits your guest list.",
      options: [
        { name: "Party packages", price: "See options" },
        { name: "Private spaces & hosts", price: "Included" },
        { name: "Food & decorations", price: "Available" },
      ],
      localHref: "book-party.html",
      compareHref: "book-party.html",
      compareLabel: "View party packages",
    },
  ];

  const parks = [
    {
      id: "katy",
      name: "Katy, Texas",
      shortName: "Katy, Texas",
      region: "Texas",
      city: "Katy",
      state: "TX",
      country: "United States",
      countrycode: "us",
      zip: "77450",
      address: "923 S. Mason Road, Suite A, Katy, TX 77450",
      lat: 29.78578,
      lng: -95.82452,
      href: "location.html?id=katy",
      status: "opening-soon",
      lead: "Something big is landing in Katy, Texas. Be first to know when doors open — thrills, parties, and 360° of fun are on the way.",
      keywords: ["katy", "houston", "mason", "77450", "texas", "tx", "sugar land", "richmond", "fulshear"],
      contact: {
        phone: "(469) 922-3788",
        phoneTel: "+14699223788",
        phoneNote: "Mon–Sun during open hours",
        email: "katy@skyline360park.com",
        emailNote: "We reply within 1 business day",
        addressHtml: "923 S. Mason Road, Suite A<br>Katy, TX 77450",
        mapsQuery: "923 S. Mason Road, Suite A, Katy, TX 77450",
        // Katy-only contact form (live)
        messageFormUrl: "https://www.booking.skyline360park.com/contact-us/",
        hoursHtml: "Mon–Thu 9am–9pm<br>Fri–Sat 9am–10pm<br>Sun 8:30am–9pm",
        hoursNote: "Full hours & map",
        hoursNoteHref: "index.html#hours",
        hoursNoteLabel: "Full hours & map",
      },
      booking: {
        // Each location manages its own inbox — create this mailbox (or forwarder) in cPanel.
        notifyEmail: "katy@skyline360park.com",
        fromEmail: "katy@skyline360park.com",
        fromName: "Skyline 360 Park — Katy, Texas",
        // Local waiver forms (this site)
        waivers: {
          general: "waiver.html?park=katy&plan=general",
          kids: "waiver.html?park=katy&plan=kids",
          membership: "waiver.html?park=katy&plan=membership",
          groups: "waiver.html?park=katy&plan=groups",
          party: "waiver.html?park=katy&plan=party",
        },
        // WooCommerce booking categories after a successful waiver (Katy)
        bookingPages: {
          general: "https://www.booking.skyline360park.com/product-category/general-visit/",
          kids: "https://www.booking.skyline360park.com/product-category/kids-family/",
          membership: "https://www.booking.skyline360park.com/product-category/membership-plan/",
          groups: "https://www.booking.skyline360park.com/product-category/groups-plan/",
          party: "https://www.booking.skyline360park.com/product-category/party-packages/",
        },
      },
      // Optional media example (uncomment / fill to show on Katy only):
      // video: "assets/skylinevideo-hero.mp4",
      // videoPoster: "assets/skylinepics/opt/s1-800.webp",
      // gallery: [
      //   { src: "assets/skylinepics/opt/s1-800.webp", alt: "Skyline 360 Park Katy" },
      //   { src: "assets/skylinepics/opt/s5-800.webp", alt: "Indoor attractions" },
      // ],
    },
    {
      id: "fort-worth",
      name: "Fort Worth, Texas",
      shortName: "Fort Worth, Texas",
      region: "Texas",
      city: "Fort Worth",
      state: "TX",
      country: "United States",
      countrycode: "us",
      zip: "",
      address: "Fort Worth, Texas (address coming soon)",
      lat: 32.7555,
      lng: -97.3308,
      href: "location.html?id=fort-worth",
      status: "opening-soon",
      lead: "Something big is landing in Fort Worth, Texas. Be first to know when doors open — thrills, parties, and 360° of fun are on the way.",
      keywords: ["fort worth", "fortworth", "dfw", "dallas", "arlington", "texas", "tx", "76102"],
      // Missing fields fall back to contactDefaults until you fill them in
      contact: {
        addressHtml: "Fort Worth, Texas<br>Address coming soon",
        mapsQuery: "Fort Worth, Texas",
        email: "fortworth@skyline360park.com",
        // Fort Worth park site (update path when contact page is live)
        messageFormUrl: "https://texasfortworth.skyline360park.com/contact-us/",
      },
      booking: {
        notifyEmail: "fortworth@skyline360park.com",
        fromEmail: "fortworth@skyline360park.com",
        fromName: "Skyline 360 Park — Fort Worth, Texas",
        waivers: {
          general: "waiver.html?park=fort-worth&plan=general",
          kids: "waiver.html?park=fort-worth&plan=kids",
          membership: "waiver.html?park=fort-worth&plan=membership",
          groups: "waiver.html?park=fort-worth&plan=groups",
          party: "waiver.html?park=fort-worth&plan=party",
        },
        bookingPages: {
          general: "https://texasfortworth.skyline360park.com/product-category/general-visit/",
          kids: "https://texasfortworth.skyline360park.com/product-category/kids-family/",
          membership: "https://texasfortworth.skyline360park.com/product-category/membership-plan/",
          groups: "https://texasfortworth.skyline360park.com/product-category/groups-plan/",
          party: "https://texasfortworth.skyline360park.com/product-category/party-packages/",
        },
      },
    },
    {
      id: "pennsylvania",
      name: "Pennsylvania",
      shortName: "Pennsylvania",
      region: "Pennsylvania",
      city: "Pennsylvania",
      state: "PA",
      country: "United States",
      countrycode: "us",
      zip: "",
      address: "Pennsylvania (address coming soon)",
      lat: 41.3254,
      lng: -75.7896,
      href: "location.html?id=pennsylvania",
      status: "opening-soon",
      lead: "Something big is landing in Pennsylvania. Be first to know when doors open — thrills, parties, and 360° of fun are on the way.",
      keywords: ["pennsylvania", "pa", "wilkes-barre", "scranton", "wyoming valley", "harrisburg", "philadelphia", "pittsburgh"],
      contact: {
        addressHtml: "Pennsylvania<br>Address coming soon",
        mapsQuery: "Pennsylvania",
        email: "pennsylvania@skyline360park.com",
        // Pennsylvania park site (update path when contact page is live)
        messageFormUrl: "https://pennsylvaniapa.skyline360park.com/contact-us/",
      },
      booking: {
        notifyEmail: "pennsylvania@skyline360park.com",
        fromEmail: "pennsylvania@skyline360park.com",
        fromName: "Skyline 360 Park — Pennsylvania",
        waivers: {
          general: "waiver.html?park=pennsylvania&plan=general",
          kids: "waiver.html?park=pennsylvania&plan=kids",
          membership: "waiver.html?park=pennsylvania&plan=membership",
          groups: "waiver.html?park=pennsylvania&plan=groups",
          party: "waiver.html?park=pennsylvania&plan=party",
        },
        bookingPages: {
          general: "https://pennsylvaniapa.skyline360park.com/product-category/general-visit/",
          kids: "https://pennsylvaniapa.skyline360park.com/product-category/kids-family/",
          membership: "https://pennsylvaniapa.skyline360park.com/product-category/membership-plan/",
          groups: "https://pennsylvaniapa.skyline360park.com/product-category/groups-plan/",
          party: "https://pennsylvaniapa.skyline360park.com/product-category/party-packages/",
        },
      },
    },
  ];

  parks.forEach((park) => {
    const booking = park.booking || {};
    park.plans = buildParkPlans(park.id, booking.waivers || {}, booking.bookingPages || {});
  });

  const getPark = (id) => parks.find((park) => park.id === id) || null;

  /** Merge park.contact with defaults so Contact page always has complete cards. */
  const getParkContact = (parkOrId) => {
    const park = typeof parkOrId === "string" ? getPark(parkOrId) : parkOrId;
    if (!park) return { ...contactDefaults };
    const c = park.contact || {};
    const addressHtml =
      c.addressHtml ||
      (park.address && !/coming soon/i.test(park.address)
        ? String(park.address).replace(/,\s*/g, "<br>")
        : `${park.city || park.shortName || park.name}<br>${contactDefaults.addressPending}`);
    const mapsQuery = c.mapsQuery || park.address || `${park.name} Skyline 360 Park`;

    // Each park must use its own form URL — never silently reuse another park’s form.
    const messageFormUrl =
      c.messageFormUrl ||
      `https://www.booking.skyline360park.com/${park.id}/contact-us/`;

    const mapEmbedUrl =
      c.mapEmbedUrl ||
      (park.lat != null && park.lng != null
        ? `https://maps.google.com/maps?q=${park.lat},${park.lng}&z=14&ie=UTF8&output=embed`
        : `https://maps.google.com/maps?q=${encodeURIComponent(mapsQuery)}&z=12&ie=UTF8&output=embed`);

    return {
      ...contactDefaults,
      ...c,
      addressHtml,
      mapsQuery,
      messageFormUrl,
      mapEmbedUrl,
      isPlaceholder: !c.phone || !c.email || !c.hoursHtml || /coming soon/i.test(addressHtml),
    };
  };

  const getSelectedParkId = () => {
    try {
      const id = String(sessionStorage.getItem(SELECTED_PARK_KEY) || "").trim().toLowerCase();
      return getPark(id)?.id || "";
    } catch (_) {
      return "";
    }
  };

  const setSelectedParkId = (parkId) => {
    const id = getPark(parkId)?.id || "";
    if (!id) return "";
    try {
      sessionStorage.setItem(SELECTED_PARK_KEY, id);
    } catch (_) {}
    return id;
  };

  const locationHrefFor = (parkId) => {
    const park = getPark(parkId || getSelectedParkId());
    return park?.href || "index.html?guide=1";
  };

  const walkinWaiverHref = (parkId = "") => {
    const id = String(parkId || "").trim().toLowerCase();
    if (id && getPark(id)) {
      return `waiver.html?mode=walkin&park=${encodeURIComponent(id)}`;
    }
    return "waiver.html?mode=walkin";
  };

  const readWalkinPasses = () => {
    try {
      const raw = localStorage.getItem(WALKIN_PASS_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === "object" ? data : {};
    } catch (_e) {
      return {};
    }
  };

  const writeWalkinPasses = (data) => {
    try {
      localStorage.setItem(WALKIN_PASS_KEY, JSON.stringify(data || {}));
    } catch (_e) {
      /* ignore quota / private mode */
    }
  };

  const grantWalkinPass = (parkId) => {
    const id = String(parkId || "").trim().toLowerCase();
    if (!id || !getPark(id)) return null;
    const passes = readWalkinPasses();
    const expiresAt = Date.now() + WALKIN_PASS_MS;
    passes[id] = { parkId: id, expiresAt, at: Date.now() };
    writeWalkinPasses(passes);
    return passes[id];
  };

  const clearWalkinPass = (parkId = "") => {
    const id = String(parkId || "").trim().toLowerCase();
    // Require an explicit park id so "New guest" never wipes every park by accident.
    if (!id || id === "*") {
      if (id === "*") writeWalkinPasses({});
      return;
    }
    const passes = readWalkinPasses();
    delete passes[id];
    writeWalkinPasses(passes);
  };

  const getWalkinPass = (parkId) => {
    const id = String(parkId || "").trim().toLowerCase();
    if (!id) return null;
    const row = readWalkinPasses()[id];
    if (!row || typeof row !== "object") return null;
    const expiresAt = Number(row.expiresAt) || 0;
    if (expiresAt <= Date.now()) {
      clearWalkinPass(id);
      return null;
    }
    return { parkId: id, expiresAt, at: Number(row.at) || 0 };
  };

  const hasValidWalkinPass = (parkId) => Boolean(getWalkinPass(parkId));

  const walkinPassRemainingMs = (parkId) => {
    const pass = getWalkinPass(parkId);
    if (!pass) return 0;
    return Math.max(0, pass.expiresAt - Date.now());
  };

  const waiverHrefFor = (planId, parkId) => {
    const id = getPark(parkId || getSelectedParkId())?.id || "";
    const plan = String(planId || "").trim().toLowerCase();
    if (!id) return "index.html?guide=1";
    if (!plan) return localWaiverHref(id, "general");
    const match = (getPark(id)?.plans || []).find((item) => item.id === plan);
    return match?.waiver || localWaiverHref(id, plan);
  };

  const getParkByHref = (href = "") => {
    const raw = String(href).trim();
    const leaf = raw.split("/").pop() || raw;
    const exact = parks.find((park) => park.href === leaf || park.href === raw);
    if (exact) return exact;

    const qIndex = leaf.indexOf("?");
    if (qIndex !== -1) {
      const id = new URLSearchParams(leaf.slice(qIndex + 1).split("#")[0]).get("id");
      if (id) return getPark(String(id).toLowerCase());
    }

    const file = leaf.split("?")[0].split("#")[0];
    return parks.find((park) => park.href.split("?")[0] === file) || null;
  };

  const defaultPlans = [
    { id: "general", label: "General Visit", blurb: "Open jump sessions", from: "$24" },
    { id: "kids", label: "Kids & Family", blurb: "Fun for all ages", from: "$20" },
    { id: "membership", label: "Membership", blurb: "Unlimited fun all year", from: "$89" },
    { id: "groups", label: "Groups", blurb: "Schools, teams & more", from: "$22" },
    { id: "party", label: "Party Packages", blurb: "Birthdays & celebrations", from: "Packages" },
  ];

  window.SkylineParkRegistry = {
    parks,
    getPark,
    getParkByHref,
    getParkContact,
    getSelectedParkId,
    setSelectedParkId,
    locationHrefFor,
    waiverHrefFor,
    walkinWaiverHref,
    grantWalkinPass,
    clearWalkinPass,
    getWalkinPass,
    hasValidWalkinPass,
    walkinPassRemainingMs,
    contactDefaults,
    defaultPlans,
    SELECTED_PARK_KEY,
    FROM_GUIDE_KEY,
    PLAN_INTENT_KEY,
    AWAITING_KEY,
    PENDING_PLAN_KEY,
    WALKIN_PASS_KEY,
    WALKIN_PASS_MS,
  };

  window.SkylineParks = {
    PARKS: parks,
    PLANS: defaultPlans,
    SELECTED_PARK_KEY,
  };
})();
