/*! Skyline 360 Park — smart on-device OCR (orientation-aware Tesseract + ID/document parsers) */
(() => {
  const FIELD_KEYS = [
    "first_name",
    "last_name",
    "dob",
    "phone",
    "address",
    "city",
    "state",
    "zip",
    "emergency_name",
    "emergency_phone",
  ];

  const LABEL_PATTERNS = [
    { key: "first_name", re: /(?:^|\b)(?:first\s*name|given\s*name|forename)\s*[:\-.]?\s*(.+)$/i },
    { key: "last_name", re: /(?:^|\b)(?:last\s*name|surname|family\s*name|lastname)\s*[:\-.]?\s*(.+)$/i },
    {
      key: "dob_raw",
      re: /(?:^|\b)(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|dob|birth\s*date|born)\s*[:\-.]?\s*(.+)$/i,
    },
    {
      key: "emergency_name",
      re: /(?:^|\b)(?:emergency\s*contact(?:\s*name)?|emergency\s*name|next\s*of\s*kin(?:\s*name)?)\s*[:\-.]?\s*(.+)$/i,
    },
    {
      key: "emergency_phone",
      re: /(?:^|\b)(?:emergency\s*(?:contact\s*)?(?:phone|tel|mobile|number)|ice\s*(?:phone|contact))\s*[:\-.]?\s*(.+)$/i,
    },
    {
      key: "phone",
      re: /(?:^|\b)(?:phone(?:\s*number)?|mobile(?:\s*number)?|tel(?:ephone)?|cell(?:\s*phone)?)\s*[:\-.]?\s*(.+)$/i,
    },
    {
      key: "address",
      re: /(?:^|\b)(?:street\s*address|home\s*address|residential\s*address|address|addr)\s*[:\-.]?\s*(.+)$/i,
    },
    { key: "city", re: /(?:^|\b)(?:city|town)\s*[:\-.]?\s*(.+)$/i },
    { key: "state", re: /(?:^|\b)(?:state(?:\s*\/\s*province)?|province|fct)\s*[:\-.]?\s*(.+)$/i },
    {
      key: "zip",
      re: /(?:^|\b)(?:zip(?:\s*\/\s*postal)?(?:\s*code)?|postal(?:\s*code)?)\s*[:\-.]?\s*(.+)$/i,
    },
  ];

  const KEYWORD_RE =
    /\b(first\s*name|last\s*name|surname|date\s*of\s*birth|\bdob\b|phone|mobile|address|city|state|zip|postal|emergency|driver|licen[sc]e|federal|nigeria|abuja|lagos)\b/i;

  const normalizeOcrText = (raw) => {
    let text = String(raw || "");
    // Common OCR substitutions that break labels / dates
    text = text
      .replace(/[|¦]/g, "I")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/ﬂ/g, "fl")
      .replace(/ﬁ/g, "fi")
      .replace(/\u00A0/g, " ");
    // Soften frequent label OCR typos
    text = text
      .replace(/\bFlrst\b/gi, "First")
      .replace(/\bLst\s*name\b/gi, "Last name")
      .replace(/\bDate\s+ot\s+birth\b/gi, "Date of birth")
      .replace(/\bDute\s+of\s+birth\b/gi, "Date of birth")
      .replace(/\bAdress\b/gi, "Address")
      .replace(/\bPh0ne\b/gi, "Phone");
    return text;
  };

  const parseDob = (raw, preferDayFirst = false) => {
    let value = String(raw || "").trim();
    const empty = { dob: "", dob_month: "", dob_day: "", dob_year: "" };
    // OCR often swaps O/0 and l/1 inside dates
    value = value
      .replace(/[Oo]/g, "0")
      .replace(/[lI|]/g, "1")
      .replace(/\s+/g, "");
    let m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      const year = Number(m[3]);
      let month;
      let day;
      if (a > 12 && b <= 12) {
        day = a;
        month = b;
      } else if (b > 12 && a <= 12) {
        month = a;
        day = b;
      } else if (preferDayFirst) {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }
      if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return empty;
      return {
        dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        dob_month: String(month).padStart(2, "0"),
        dob_day: String(day).padStart(2, "0"),
        dob_year: String(year),
      };
    }
    m = value.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return empty;
      return {
        dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        dob_month: String(month).padStart(2, "0"),
        dob_day: String(day).padStart(2, "0"),
        dob_year: String(year),
      };
    }
    m = value.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (m) {
      let month;
      let day;
      const year = Number(m[3]);
      if (preferDayFirst) {
        day = Number(m[1]);
        month = Number(m[2]);
      } else {
        month = Number(m[1]);
        day = Number(m[2]);
      }
      if (month > 12 && day <= 12) {
        const tmp = month;
        month = day;
        day = tmp;
      }
      if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) return empty;
      return {
        dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        dob_month: String(month).padStart(2, "0"),
        dob_day: String(day).padStart(2, "0"),
        dob_year: String(year),
      };
    }
    return empty;
  };

  const cleanPhone = (raw) => {
    let compact = String(raw || "").replace(/[^\d+]/g, "");
    if (!compact) return "";
    if (compact.startsWith("+")) compact = compact.slice(1);
    if (compact.startsWith("00")) compact = compact.slice(2);
    if (/^1\d{10}$/.test(compact)) return compact.slice(1);
    if (/^234\d{7,11}$/.test(compact)) return `0${compact.slice(3)}`;
    return compact.slice(0, 40);
  };

  const titleCase = (value) => {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/[a-z]/.test(v)) return v;
    return v
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  };

  const packFields = (partial) => {
    const dob =
      partial.dob && partial.dob_month
        ? {
            dob: partial.dob,
            dob_month: partial.dob_month,
            dob_day: partial.dob_day,
            dob_year: partial.dob_year,
          }
        : parseDob(partial.dob_raw || "", !!partial.preferDayFirst);
    const fields = {
      first_name: titleCase(partial.first_name || "").slice(0, 80),
      last_name: titleCase(partial.last_name || "").slice(0, 80),
      dob: dob.dob,
      dob_month: dob.dob_month,
      dob_day: dob.dob_day,
      dob_year: dob.dob_year,
      phone: cleanPhone(partial.phone || "").slice(0, 40),
      address: titleCase(partial.address || "").slice(0, 160),
      city: titleCase(partial.city || "").slice(0, 80),
      state: (() => {
        const s = String(partial.state || "").trim();
        if (s.length === 2) return s.toUpperCase();
        return titleCase(s).slice(0, 80);
      })(),
      zip: String(partial.zip || "")
        .replace(/[^\dA-Za-z\-]/g, "")
        .slice(0, 20),
      emergency_name: titleCase(partial.emergency_name || "").slice(0, 120),
      emergency_phone: cleanPhone(partial.emergency_phone || "").slice(0, 40),
    };
    const filled = FIELD_KEYS.filter((k) => fields[k]).length;
    return {
      fields,
      filled,
      has_name: !!(fields.first_name && fields.last_name),
    };
  };

  const minorIdentityKey = (m) =>
    [
      String(m?.first_name || "")
        .trim()
        .toLowerCase(),
      String(m?.last_name || "")
        .trim()
        .toLowerCase(),
      String(m?.dob || m?.dob_year || "")
        .trim()
        .toLowerCase(),
    ].join("|");

  /** Combine minors from multiple pages; keep first hit and fill blank fields from later pages. */
  const mergeMinorLists = (a, b) => {
    const out = [];
    const indexByKey = new Map();
    const push = (m) => {
      if (!m || (!m.first_name && !m.last_name)) return;
      const key = minorIdentityKey(m);
      if (indexByKey.has(key)) {
        const i = indexByKey.get(key);
        const cur = out[i];
        out[i] = {
          first_name: cur.first_name || m.first_name || "",
          last_name: cur.last_name || m.last_name || "",
          dob: cur.dob || m.dob || "",
          dob_month: cur.dob_month || m.dob_month || "",
          dob_day: cur.dob_day || m.dob_day || "",
          dob_year: cur.dob_year || m.dob_year || "",
        };
        return;
      }
      if (out.length >= 15) return;
      indexByKey.set(key, out.length);
      out.push({
        first_name: m.first_name || "",
        last_name: m.last_name || "",
        dob: m.dob || "",
        dob_month: m.dob_month || "",
        dob_day: m.dob_day || "",
        dob_year: m.dob_year || "",
      });
    };
    (Array.isArray(a) ? a : []).forEach(push);
    (Array.isArray(b) ? b : []).forEach(push);
    return out;
  };

  const mergeParsed = (a, b) => {
    const merged = { ...(a?.fields || {}) };
    Object.keys(b?.fields || {}).forEach((k) => {
      if (!merged[k] && b.fields[k]) merged[k] = b.fields[k];
    });
    const filled = FIELD_KEYS.filter((k) => merged[k]).length;
    const minors = mergeMinorLists(a?.minors, b?.minors);
    return {
      fields: merged,
      filled,
      has_name: !!(merged.first_name && merged.last_name),
      confidence: Math.max(Number(a?.confidence) || 0, Number(b?.confidence) || 0),
      text: [a?.text, b?.text].filter(Boolean).join("\n"),
      minors,
    };
  };

  const scoreParsed = (parsed) => {
    if (!parsed) return -1;
    let score = (Number(parsed.filled) || 0) * 3;
    if (parsed.has_name) score += 12;
    if (parsed.fields?.dob) score += 6;
    if (parsed.fields?.phone) score += 3;
    if (parsed.fields?.emergency_name) score += 3;
    if (parsed.fields?.emergency_phone) score += 3;
    if (parsed.fields?.address) score += 3;
    if (parsed.fields?.city) score += 2;
    if (parsed.fields?.state) score += 2;
    if (parsed.fields?.zip) score += 2;
    // OCR quality / uprightness signals
    const conf = Number(parsed.confidence) || 0;
    score += Math.min(18, conf / 5);
    const text = String(parsed.text || "");
    if (KEYWORD_RE.test(text)) score += 4;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const junk = (text.match(/[^A-Za-z0-9\s,.\-:/']/g) || []).length;
    if (letters > 40) score += 2;
    if (junk > letters * 0.35) score -= 6;
    // Upside-down OCR often yields very few spaces / short token soup
    const words = text.split(/\s+/).filter((w) => w.length > 2);
    if (words.length >= 8) score += 2;
    return score;
  };

  const isStrongResult = (parsed) =>
    !!(parsed && parsed.has_name && Number(parsed.filled) >= 4 && Number(parsed.confidence) >= 55);

  const parseLabeledGuestText = (text) => {
    const cleaned = normalizeOcrText(text);
    const lines = cleaned
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const found = {};
    lines.forEach((line, idx) => {
      LABEL_PATTERNS.forEach(({ key, re }) => {
        if (found[key]) return;
        // Guest fields must not steal "Minor 1 first name" lines
        if (
          (key === "first_name" || key === "last_name" || key === "dob_raw") &&
          /(?:minor|child|kid)\s*#?\s*\d/i.test(line)
        ) {
          return;
        }
        // Don't treat "Emergency phone" as the guest phone field
        if (key === "phone" && /emergency|next\s*of\s*kin|ice\b/i.test(line)) return;
        const m = line.match(re);
        if (m && m[1]) {
          let val = m[1].trim();
          // Label-only line → value on next line
          if (!val || /^[:\-.\s]*$/.test(val)) {
            val = (lines[idx + 1] || "").trim();
          }
          // Skip if "value" looks like another label
          if (val && /^(?:first|last|date|phone|mobile|address|city|state|zip|emergency|minor|child)\b/i.test(val)) {
            return;
          }
          if (val) found[key] = val;
        }
      });
    });

    if (!found.first_name) {
      const nameRe = /first\s*name\s*[:\-.]?\s*([A-Za-z][A-Za-z'\-]+)/gi;
      let nm;
      while ((nm = nameRe.exec(cleaned))) {
        const ctx = cleaned.slice(Math.max(0, nm.index - 36), nm.index);
        if (/(?:minor|child|kid)\s*#?\s*\d/i.test(ctx)) continue;
        found.first_name = nm[1];
        break;
      }
    }
    if (!found.last_name) {
      const nameRe = /last\s*name\s*[:\-.]?\s*([A-Za-z][A-Za-z'\-]+)/gi;
      let nm;
      while ((nm = nameRe.exec(cleaned))) {
        const ctx = cleaned.slice(Math.max(0, nm.index - 36), nm.index);
        if (/(?:minor|child|kid)\s*#?\s*\d/i.test(ctx)) continue;
        found.last_name = nm[1];
        break;
      }
    }
    if (!found.emergency_name) {
      const m = cleaned.match(
        /emergency\s*contact(?:\s*name)?\s*[:\-.]?\s*([A-Za-z][A-Za-z'\-\s]{1,60})/i
      );
      if (m) found.emergency_name = m[1].trim();
    }
    if (!found.emergency_phone) {
      const m = cleaned.match(
        /emergency\s*(?:contact\s*)?(?:phone|tel|mobile|number)\s*[:\-.]?\s*([+\d][\d\s().\-]{6,}\d)/i
      );
      if (m) found.emergency_phone = m[1];
    }
    if (!found.phone) {
      const phoneRe = /(?:phone|mobile|tel|cell)\s*[:\-.]?\s*([+\d][\d\s().\-]{6,}\d)/gi;
      let pm;
      while ((pm = phoneRe.exec(cleaned))) {
        const ctx = cleaned.slice(Math.max(0, pm.index - 24), pm.index);
        if (/emergency|next\s*of\s*kin|\bice\b/i.test(ctx)) continue;
        found.phone = pm[1];
        break;
      }
    }

    return packFields({
      first_name: found.first_name,
      last_name: found.last_name,
      dob_raw: found.dob_raw,
      phone: found.phone,
      address: found.address,
      city: found.city,
      state: found.state,
      zip: found.zip,
      emergency_name: found.emergency_name,
      emergency_phone: found.emergency_phone,
      preferDayFirst: true,
    });
  };

  const parseIdGuestText = (text) => {
    const cleaned = normalizeOcrText(text);
    const lines = cleaned
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const blob = lines.join("\n");
    const preferDayFirst = /nigeria|nigerian|licence|federal republic|abuja|\bfct\b|lagos|driver.?s?\s+licen/i.test(
      blob
    );

    let first = "";
    let last = "";
    let dobRaw = "";
    let phone = "";
    let address = "";
    let city = "";
    let state = "";
    let zip = "";

    const skipChrome =
      /^(federal|republic|nigeria|national|united states|drivers?\s*licen|class of|endorsements?|index|blood group|glasses|facial|signature|private class|iss\.?$|exp\.?$|1st\s*iss|sex\b|height|weight|eye\b|hair\b|organ\s*donor)/i;

    lines.forEach((line, idx) => {
      if (!line || skipChrome.test(line)) return;
      if (/\b(class of licence|endorsements?|gross weight|omnibus|administrative fee)\b/i.test(line)) return;

      let m;
      if (!first && (m = line.match(/(?:^|\b)(?:first\s*name|given\s*name)\s*[:\-.]?\s*(.+)$/i))) {
        first = m[1].trim();
      }
      if (!last && (m = line.match(/(?:^|\b)(?:last\s*name|surname|family\s*name)\s*[:\-.]?\s*(.+)$/i))) {
        last = m[1].trim();
      }
      if (!dobRaw && (m = line.match(/(?:^|\b)(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|dob|birth\s*date)\s*[:\-.]?\s*(.+)$/i))) {
        const dm = m[1].match(/\b(\d{1,4}[\/\-.]?\d{1,2}[\/\-.]?\d{1,4})\b/);
        dobRaw = dm ? dm[1] : m[1].trim();
      }
      if (!phone && (m = line.match(/(?:^|\b)(?:phone(?:\s*number)?|mobile(?:\s*number)?|tel(?:ephone)?|cell)\s*[:\-.]?\s*(.+)$/i))) {
        phone = cleanPhone(m[1]);
      }
      if (!address && (m = line.match(/(?:^|\b)(?:street\s*address|address|residential\s*address)\s*[:\-.]?\s*(.+)$/i))) {
        address = m[1].trim();
      }
      if (!city && (m = line.match(/(?:^|\b)(?:city|town)\s*[:\-.]?\s*(.+)$/i))) city = m[1].trim();
      if (!state && (m = line.match(/(?:^|\b)(?:state(?:\s*\/\s*province)?|province|fct)\s*[:\-.]?\s*(.+)$/i))) {
        state = m[1].trim();
      }
      if (!zip && (m = line.match(/(?:^|\b)(?:zip(?:\s*\/\s*postal)?(?:\s*code)?|postal(?:\s*code)?)\s*[:\-.]?\s*(.+)$/i))) {
        zip = m[1].trim();
      }

      if (!phone && (m = line.match(/\b(?:phone|mobile|tel|telephone|cell)\b[:\s]*([+\d][\d\s().\-]{6,}\d)/i))) {
        phone = cleanPhone(m[1]);
      }
      if (!phone && (m = line.match(/(?:\+|00)?\d[\d\s().\-]{8,}\d/))) {
        if (/phone|mobile|tel|cell/i.test(line) || /^\+?\d/.test(line.trim())) {
          const candidate = cleanPhone(m[0]);
          if (candidate.replace(/\D/g, "").length >= 7) phone = candidate;
        }
      }

      // DL# / licence number lines are not names
      if (/\b(DLN?|LIC(?:ENCE|ENSE)?\s*#?|ID\s*#)\b/i.test(line)) return;

      if ((!first || !last) && (m = line.match(/^([A-Z][A-Z'\-]+),\s*([A-Z][A-Z'\-]+(?:\s+[A-Z][A-Z'\-]+)*)$/i))) {
        if (!last) last = m[1];
        if (!first) first = m[2];
      }
      if (
        (!first || !last) &&
        (m = line.match(/\b(?:name|surname|family name|full name)\b[:\s]*([A-Z][A-Z'\-]+)\s*,\s*([A-Z][A-Z'\-\s]+)/i))
      ) {
        if (!last) last = m[1].trim();
        if (!first) first = m[2].trim();
      }

      // US DL style: "1 SAMPLE" / "2 JOHN" sometimes OCR'd without numbers
      if (!last && (m = line.match(/^(?:1|LN|LAST)\s+([A-Z][A-Z'\-]+)$/i))) last = m[1];
      if (!first && (m = line.match(/^(?:2|FN|FIRST)\s+([A-Z][A-Z'\-]+(?:\s+[A-Z][A-Z'\-]+)?)$/i))) {
        first = m[1];
      }

      if (
        !dobRaw &&
        (m = line.match(
          /\b(?:dob|date of birth|birth ?date|d\.?o\.?b\.?)\b[:\s-]*([0-9]{1,4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,4})/i
        ))
      ) {
        dobRaw = m[1];
      }
      if (!dobRaw && (m = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/))) {
        if (/birth|dob|born/i.test(line)) dobRaw = m[1];
      }

      if (!zip && (m = line.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i))) {
        state = m[1].toUpperCase();
        zip = m[2];
        const cm = line.match(/^(.+?),\s*[A-Z]{2}\s+\d{5}/i) || line.match(/^(.+?)\s+[A-Z]{2}\s+\d{5}/i);
        if (cm) {
          const part = cm[1].trim();
          if (!/\d/.test(part)) city = city || part;
          else address = address || part;
        }
      }

      if (
        !address &&
        /^(?:NO\.?\s*)?\d+[\w\s.,'\-\/]*\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|court|ct|way|close|crescent|estate|district|avenue)\b/i.test(
          line
        )
      ) {
        address = line;
      }

      if ((!city || !state) && (m = line.match(/\b([A-Z][A-Za-z\s]+?),\s*(FCT|[A-Z]{2,}|[A-Z][A-Za-z]+(?:\s+STATE)?)\b/))) {
        if (!city && !/^\d/.test(m[1])) city = m[1].trim();
        if (!state) state = m[2].trim().replace(/\s+STATE$/i, "") || m[2].trim();
      }

      if (
        (!first || !last) &&
        (m = line.match(
          /\b(?:name|full name|patient|guest|applicant|holder)\b[:\s]+([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)+)/i
        ))
      ) {
        const parts = m[1].trim().split(/\s+/);
        if (parts.length >= 2) {
          if (!first) first = parts[0];
          if (!last) last = parts[parts.length - 1];
        }
      }

      if ((!first || !last) && /^(?:name|surname|family name)\b[:\s]*$/i.test(line)) {
        const next = lines[idx + 1] || "";
        if ((m = next.match(/^([A-Z][A-Z'\-]+),\s*([A-Z][A-Z'\-\s]+)$/i))) {
          if (!last) last = m[1];
          if (!first) first = m[2].trim();
        } else if (/^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)+$/.test(next)) {
          const parts = next.split(/\s+/);
          if (!first) first = parts[0];
          if (!last) last = parts[parts.length - 1];
        }
      }
      if (!address && /^(?:address|residential address|addr)\b[:\s]*$/i.test(line)) {
        const next = lines[idx + 1] || "";
        if (next.length > 8) address = next;
      }
      if (!dobRaw && /^(?:date of birth|dob|birth date)\b[:\s]*$/i.test(line)) {
        const next = lines[idx + 1] || "";
        if ((m = next.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/))) dobRaw = m[1];
      }
    });

    if (!first || !last) {
      for (const line of lines) {
        const m = line.match(/^([A-Z][A-Z'\-]+),\s*([A-Z][A-Z'\-]+(?:\s+[A-Z][A-Z'\-]+){0,3})$/);
        if (m) {
          if (!last) last = m[1];
          if (!first) first = m[2];
          break;
        }
      }
    }
    if (!first || !last) {
      for (const line of lines) {
        if (skipChrome.test(line)) continue;
        if (/^[A-Z][a-zA-Z'\-]+\s+[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)?$/.test(line)) {
          const parts = line.split(/\s+/);
          if (parts.length >= 2) {
            if (!first) first = parts[0];
            if (!last) last = parts[parts.length - 1];
            break;
          }
        }
      }
    }

    if (!dobRaw) {
      const thisYear = new Date().getFullYear();
      for (const line of lines) {
        if (/\b(iss|exp|issued|expires|valid)\b/i.test(line)) continue;
        const m = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/);
        if (!m) continue;
        const parsedTry = parseDob(m[1], preferDayFirst);
        const y = Number(parsedTry.dob_year || 0);
        if (parsedTry.dob && y >= 1920 && y <= thisYear - 5) {
          dobRaw = m[1];
          break;
        }
      }
    }

    if (address && (!city || !state)) {
      let m;
      if (!city && (m = address.match(/\b(ABUJA|LAGOS|KANO|IBADAN|PORT\s*HARCOURT)\b/i))) city = m[1];
      if (!state && (m = address.match(/\b(FCT|[A-Z]{2,}\s+STATE)\b/i))) {
        state = m[1].replace(/\s+STATE$/i, "").trim() || m[1].trim();
      }
    }

    return packFields({
      first_name: first,
      last_name: last,
      dob_raw: dobRaw,
      phone,
      address,
      city,
      state,
      zip,
      preferDayFirst,
    });
  };

  /**
   * Extract up to 15 minors from labeled document text.
   * Preferred labels:
   *   Minor 1 first name: Ana
   *   Minor 1 last name: Smith
   *   Minor 1 date of birth: 12-03-2014
   * Also accepts: Minor 1: Ana Smith, 12-03-2014
   */
  const parseMinorsFromText = (text) => {
    const cleaned = normalizeOcrText(text);
    const lines = cleaned
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const byNum = {};

    const ensure = (n) => {
      const key = String(n);
      if (!byNum[key]) byNum[key] = { first_name: "", last_name: "", dob_raw: "" };
      return byNum[key];
    };

    const bumpField = (n, field, value) => {
      const num = Number(n);
      if (!num || num < 1 || num > 15) return;
      const row = ensure(num);
      const val = String(value || "").trim();
      if (!val) return;
      if (!row[field]) row[field] = val;
    };

    lines.forEach((line, idx) => {
      let m;
      if (
        (m = line.match(
          /(?:minor|child|kid)\s*#?\s*(\d{1,2})\s*[:\-]?\s*(?:first\s*name|given\s*name)\s*[:\-.]?\s*(.+)$/i
        ))
      ) {
        let val = m[2].trim();
        if (!val || /^[:\-.\s]*$/.test(val)) val = lines[idx + 1] || "";
        bumpField(m[1], "first_name", val.replace(/[,.].*$/, "").trim());
        return;
      }
      if (
        (m = line.match(
          /(?:minor|child|kid)\s*#?\s*(\d{1,2})\s*[:\-]?\s*(?:last\s*name|surname|family\s*name)\s*[:\-.]?\s*(.+)$/i
        ))
      ) {
        let val = m[2].trim();
        if (!val || /^[:\-.\s]*$/.test(val)) val = lines[idx + 1] || "";
        bumpField(m[1], "last_name", val.replace(/[,.].*$/, "").trim());
        return;
      }
      if (
        (m = line.match(
          /(?:minor|child|kid)\s*#?\s*(\d{1,2})\s*[:\-]?\s*(?:date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|dob|birth\s*date)\s*[:\-.]?\s*(.+)$/i
        ))
      ) {
        let val = m[2].trim();
        if (!val || /^[:\-.\s]*$/.test(val)) val = lines[idx + 1] || "";
        const dm = val.match(/\b(\d{1,4}[\/\-.]?\d{1,2}[\/\-.]?\d{1,4})\b/);
        bumpField(m[1], "dob_raw", dm ? dm[1] : val);
        return;
      }

      // Minor 1: Ana Smith, 12-03-2014  OR  Minor 1 - Ana Smith DOB 12-03-2014
      if (
        (m = line.match(
          /(?:minor|child|kid)\s*#?\s*(\d{1,2})\s*[:\-]\s*([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)+)\s*[,;]?\s*(?:dob|date\s*of\s*birth|born)?\s*[:\-]?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})/i
        ))
      ) {
        const parts = m[2].trim().split(/\s+/);
        bumpField(m[1], "first_name", parts[0]);
        bumpField(m[1], "last_name", parts[parts.length - 1]);
        bumpField(m[1], "dob_raw", m[3]);
        return;
      }

      // Minor 1: Ana Smith (no date on same line)
      if (
        (m = line.match(
          /(?:minor|child|kid)\s*#?\s*(\d{1,2})\s*[:\-]\s*([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)+)\s*$/i
        ))
      ) {
        const parts = m[2].trim().split(/\s+/);
        bumpField(m[1], "first_name", parts[0]);
        bumpField(m[1], "last_name", parts[parts.length - 1]);
      }
    });

    // Numbered list under a Minors heading: "1. Ana Smith 12-03-2014"
    let inMinorsBlock = false;
    lines.forEach((line) => {
      if (/^(?:minors?|children|kids)\b/i.test(line) && !/(?:first|last|date|phone)/i.test(line)) {
        inMinorsBlock = true;
        return;
      }
      if (inMinorsBlock && /^(?:emergency|address|street|phone|guardian|adult|sign)/i.test(line)) {
        inMinorsBlock = false;
      }
      if (!inMinorsBlock) return;
      const m = line.match(
        /^(\d{1,2})[.)]\s*([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)+)\s*[,;]?\s*(?:dob|:)?\s*(\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4})?/i
      );
      if (!m) return;
      const parts = m[2].trim().split(/\s+/);
      bumpField(m[1], "first_name", parts[0]);
      bumpField(m[1], "last_name", parts[parts.length - 1]);
      if (m[3]) bumpField(m[1], "dob_raw", m[3]);
    });

    const out = [];
    for (let i = 1; i <= 15; i += 1) {
      const row = byNum[String(i)];
      if (!row) continue;
      const first = titleCase(row.first_name).slice(0, 80);
      const last = titleCase(row.last_name).slice(0, 80);
      if (!first && !last) continue;
      const dob = parseDob(row.dob_raw || "", true);
      out.push({
        first_name: first,
        last_name: last,
        dob: dob.dob,
        dob_month: dob.dob_month,
        dob_day: dob.dob_day,
        dob_year: dob.dob_year,
      });
    }
    return out;
  };

  /** Always merge labeled checklist + free-form ID parsers for max field coverage. */
  const parseGuestText = (text) => {
    const cleaned = normalizeOcrText(text);
    const labeled = parseLabeledGuestText(cleaned);
    const idLike = parseIdGuestText(cleaned);
    const merged = mergeParsed(labeled, idLike);
    const minors = parseMinorsFromText(cleaned);
    return { ...merged, minors };
  };

  let tesseractLoading = null;
  let workerPromise = null;

  const loadTesseract = () => {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractLoading) return tesseractLoading;
    tesseractLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error("Tesseract failed to load."));
      };
      script.onerror = () => reject(new Error("Could not load on-device OCR library."));
      document.head.appendChild(script);
    });
    return tesseractLoading;
  };

  const getWorker = async (mode) => {
    const Tesseract = await loadTesseract();
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("eng", 1, {
        // LSTM only — faster than legacy+LSTM combo
      }).then(async (worker) => {
        await worker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "220",
          tessedit_ocr_engine_mode: "1",
        });
        return worker;
      });
    }
    const worker = await workerPromise;
    // Document: single column. ID: sparse text block.
    const psm = mode === "document" ? "4" : "11";
    try {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
    } catch (_e) {
      /* ignore */
    }
    return worker;
  };

  /** Warm script + worker as soon as guest picks scan (hides first-load delay). */
  const warm = async () => {
    try {
      await getWorker("id");
    } catch (_e) {
      /* ignore */
    }
  };

  /**
   * Soft grayscale (no hard binary) — binary threshold often destroys ID holograms.
   */
  const toGrayscaleOcrDataUrl = (dataUrl) =>
    new Promise((resolve) => {
      if (!dataUrl) {
        resolve("");
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const sw = img.naturalWidth || img.width;
          const sh = img.naturalHeight || img.height;
          if (!sw || !sh) {
            resolve(dataUrl);
            return;
          }
          const maxSide = 1280;
          let w = sw;
          let h = sh;
          if (Math.max(w, h) > maxSide) {
            const s = maxSide / Math.max(w, h);
            w = Math.round(w * s);
            h = Math.round(h * s);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const d = imageData.data;
          let minL = 255;
          let maxL = 0;
          for (let i = 0; i < d.length; i += 128) {
            const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            if (g < minL) minL = g;
            if (g > maxL) maxL = g;
          }
          const range = Math.max(28, maxL - minL);
          const contrast = 255 / range;
          const brightness = -minL * contrast;
          for (let i = 0; i < d.length; i += 4) {
            let g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * contrast + brightness;
            g = g < 0 ? 0 : g > 255 ? 255 : g;
            d[i] = d[i + 1] = d[i + 2] = g;
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

  const recognizeDataUrl = async (dataUrl, onProgress, mode = "id") => {
    const worker = await getWorker(mode);
    const result = await worker.recognize(dataUrl);
    if (typeof onProgress === "function") onProgress(1);
    const text = normalizeOcrText(result?.data?.text || "");
    const confidence = Number(result?.data?.confidence) || 0;
    return { text, confidence };
  };

  const extractFromImageDataUrl = async (dataUrl, onProgress, mode = "id") => {
    const { text, confidence } = await recognizeDataUrl(dataUrl, onProgress, mode);
    const parsed = parseGuestText(text);
    return { ...parsed, text, confidence };
  };

  /**
   * OCR orientation candidates with early exit when the read is already strong.
   * Prefer extractPhotoSmart in waiver.js for single-photo flows.
   */
  const extractBestFromVariants = async (variants, onProgress, mode = "id") => {
    const list = (variants || []).filter(Boolean);
    let best = null;
    let bestSrc = "";

    for (let i = 0; i < list.length; i += 1) {
      if (typeof onProgress === "function") {
        onProgress(i / Math.max(1, list.length), i + 1, list.length);
      }
      let recognized;
      try {
        recognized = await recognizeDataUrl(
          list[i],
          (p) => {
            if (typeof onProgress === "function") {
              const overall = (i + Math.max(0, Math.min(1, Number(p) || 0))) / Math.max(1, list.length);
              onProgress(overall, i + 1, list.length);
            }
          },
          mode
        );
      } catch (_err) {
        continue;
      }
      const parsed = {
        ...parseGuestText(recognized.text),
        text: recognized.text,
        confidence: recognized.confidence,
      };
      if (!best || scoreParsed(parsed) > scoreParsed(best)) {
        best = parsed;
        bestSrc = list[i];
      } else {
        best = mergeParsed(best, parsed);
      }
      if (isStrongResult(best) || (best.has_name && best.fields?.dob && Number(best.filled) >= 4)) {
        if (typeof onProgress === "function") onProgress(1, i + 1, list.length);
        return best;
      }
    }

    if (bestSrc && best && !isStrongResult(best)) {
      try {
        const gray = await toGrayscaleOcrDataUrl(bestSrc);
        if (gray) {
          const recognized = await recognizeDataUrl(gray, null, mode);
          const parsed = {
            ...parseGuestText(recognized.text),
            text: recognized.text,
            confidence: recognized.confidence,
          };
          if (scoreParsed(parsed) > scoreParsed(best)) best = parsed;
          else best = mergeParsed(best, parsed);
        }
      } catch (_e) {
        /* keep best */
      }
    }

    if (typeof onProgress === "function") onProgress(1, list.length, list.length);
    return best;
  };

  window.SkylineLocalOcr = {
    parseLabeledGuestText,
    parseIdGuestText,
    parseMinorsFromText,
    parseGuestText,
    extractFromImageDataUrl,
    extractBestFromVariants,
    loadTesseract,
    warm,
    scoreParsed,
    mergeParsed,
    toGrayscaleOcrDataUrl,
    MAX_MINORS: 15,
  };

  // Prefetch OCR engine in the background so first Extract is much faster
  if (typeof window !== "undefined") {
    const kick = () => {
      try {
        warm();
      } catch (_e) {
        /* ignore */
      }
    };
    if (document.readyState === "complete") setTimeout(kick, 400);
    else window.addEventListener("load", () => setTimeout(kick, 400), { once: true });
  }
})();
