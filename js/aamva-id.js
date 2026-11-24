/*! Skyline 360 Park — fast on-device AAMVA PDF417 helpers for US ID backs */
(() => {
  const AAMVA_KEYS = {
    DAC: "first_name",
    DAD: "middle_name",
    DCS: "last_name",
    DCT: "first_name", // older first name
    DAA: "full_name",
    DBB: "dob",
    DAG: "address",
    DAI: "city",
    DAJ: "state",
    DAK: "zip",
  };

  const parseAamva = (raw) => {
    const text = String(raw || "");
    if (!text || (text.indexOf("ANSI ") === -1 && text.indexOf("AAMVA") === -1 && !/\bD[A-Z]{2}/.test(text))) {
      return null;
    }
    const fields = {
      first_name: "",
      last_name: "",
      dob: "",
      dob_month: "",
      dob_day: "",
      dob_year: "",
      address: "",
      city: "",
      state: "",
      zip: "",
    };
    const lines = text.split(/\r\n|\r|\n/);
    lines.forEach((line) => {
      const m = line.match(/^([A-Z]{3})(.*)$/);
      if (!m) return;
      const key = AAMVA_KEYS[m[1]];
      if (!key) return;
      const value = String(m[2] || "").trim();
      if (!value) return;
      if (key === "full_name") {
        const parts = value.split(/[, ]+/).filter(Boolean);
        if (parts.length >= 2 && !fields.last_name) {
          // Often "LAST,FIRST MIDDLE"
          if (value.includes(",")) {
            fields.last_name = parts[0];
            fields.first_name = parts[1] || fields.first_name;
          } else {
            fields.first_name = fields.first_name || parts[0];
            fields.last_name = fields.last_name || parts[parts.length - 1];
          }
        }
        return;
      }
      if (key === "middle_name") {
        const mid = value.trim();
        if (mid && fields.first_name && !fields.first_name.includes(mid)) {
          fields.first_name = `${fields.first_name} ${mid}`.trim();
        } else if (mid && !fields.first_name) {
          fields.first_name = mid;
        }
        return;
      }
      if (key === "dob") {
        // MMDDYYYY common on AAMVA
        let month = "";
        let day = "";
        let year = "";
        if (/^\d{8}$/.test(value)) {
          month = value.slice(0, 2);
          day = value.slice(2, 4);
          year = value.slice(4, 8);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          year = value.slice(0, 4);
          month = value.slice(5, 7);
          day = value.slice(8, 10);
        } else if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value)) {
          const p = value.split(/[\/\-]/);
          month = p[0].padStart(2, "0");
          day = p[1].padStart(2, "0");
          year = p[2].length === 2 ? `19${p[2]}` : p[2];
        }
        if (month && day && year) {
          fields.dob_month = month;
          fields.dob_day = day;
          fields.dob_year = year;
          fields.dob = `${year}-${month}-${day}`;
        }
        return;
      }
      if (key === "zip") {
        fields.zip = value.replace(/\D/g, "").slice(0, 5) || value.slice(0, 20);
        return;
      }
      if (!fields[key]) fields[key] = value;
    });

    const filled = ["first_name", "last_name", "dob", "address", "city", "state", "zip"].filter(
      (k) => fields[k]
    ).length;
    if (filled < 2 || !fields.first_name || !fields.last_name) return null;
    return fields;
  };

  const dataUrlToImage = (dataUrl) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image for barcode scan."));
      img.src = dataUrl;
    });

  const rotateImageToCanvas = (img, turnsCw) => {
    const turns = ((turnsCw % 4) + 4) % 4;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (turns % 2 === 1) {
      canvas.width = h;
      canvas.height = w;
    } else {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.save();
    if (turns === 1) {
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
    } else if (turns === 2) {
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
    } else if (turns === 3) {
      ctx.translate(0, w);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    return canvas;
  };

  const decodeFromCanvas = async (canvas, reader) => {
    try {
      // Prefer decodeFromImageElement when possible; canvas works via toDataURL fallback
      if (typeof reader.decodeFromCanvas === "function") {
        return await reader.decodeFromCanvas(canvas);
      }
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const img = await dataUrlToImage(dataUrl);
      return await reader.decodeFromImageElement(img);
    } catch (_err) {
      return null;
    }
  };

  const decodePdf417FromDataUrl = async (dataUrl) => {
    const ZXing = window.ZXing;
    if (!ZXing || !dataUrl) return null;
    try {
      const img = await dataUrlToImage(dataUrl);
      const hints = new Map();
      if (ZXing.DecodeHintType && ZXing.BarcodeFormat) {
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.PDF_417]);
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      }
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      // Try upright + rotated frames — phone photos of ID backs are often sideways
      for (let turns = 0; turns < 4; turns += 1) {
        const canvas = rotateImageToCanvas(img, turns);
        if (!canvas) continue;
        const result = await decodeFromCanvas(canvas, reader);
        const text = result?.getText?.() || result?.text || "";
        const parsed = parseAamva(text);
        if (parsed) return parsed;
      }
      return null;
    } catch (_err) {
      return null;
    }
  };

  window.SkylineIdBarcode = {
    parseAamva,
    decodePdf417FromDataUrl,
  };
})();
