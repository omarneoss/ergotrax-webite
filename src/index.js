// Ergotrax — merged Worker: static site (via ASSETS) + /api/* accounts backend (D1)
//
// Routes handled here:
//   POST /api/register        { email, password, name }              -> creates a CLIENT account
//   POST /api/login           { email, password }                    -> { token, role, name }
//   GET  /api/me              (Authorization: Bearer <token>)        -> current user
//   POST /api/logout          (Authorization: Bearer <token>)
//   GET  /api/clients         staff only
//   POST /api/clients         staff only  { company_name, contact, track }
//   DELETE /api/clients/:id   staff only
//   POST /api/reports         staff only  { client_id, body }
//   GET  /api/reports/:clientId  staff or the client who owns it
//   GET  /api/bookings        staff or own client
//   POST /api/bookings        staff only  { client_id, event_title, track_name, venue }
//   PATCH /api/bookings/:id   staff only  { status }
//
// Everything else falls through to the static site (env.ASSETS).

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

const enc = new TextEncoder();
function randomHex(len = 16) {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, saltHex) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  const hashHex = [...new Uint8Array(bits)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const saltOut = [...salt].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { hash: hashHex, salt: saltOut };
}

function extFromName(name) {
  const m = /\.[a-zA-Z0-9]+$/.exec(name || "");
  return m ? m[0].toLowerCase() : "";
}

async function getUserFromToken(db, req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const row = await db
    .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > datetime('now')")
    .bind(token)
    .first();
  return row || null;
}

async function handleApi(req, env, url) {
  const db = env.DB;
  if (req.method === "OPTIONS") return json({}, 204);

  try {
    if (url.pathname === "/api/register" && req.method === "POST") {
      const { email, password, name, company_name, contact, track } = await req.json();
      if (!email || !password || !name) return json({ error: "email, password, name required" }, 400);
      const exists = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (exists) return json({ error: "email already registered" }, 409);
      const { hash, salt } = await hashPassword(password);
      const res = await db
        .prepare("INSERT INTO users (email, password_hash, password_salt, role, name) VALUES (?, ?, ?, 'client', ?)")
        .bind(email, hash, salt, name)
        .run();
      const userId = res.meta.last_row_id;
      await db
        .prepare("INSERT INTO clients (user_id, company_name, contact, track) VALUES (?, ?, ?, ?)")
        .bind(userId, company_name || name, contact || email, track || null)
        .run();
      const token = randomHex(24);
      await db
        .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))")
        .bind(token, userId)
        .run();
      return json({ token, role: "client", name });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      const { email, password } = await req.json();
      const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
      if (!user) return json({ error: "invalid credentials" }, 401);
      const { hash } = await hashPassword(password, user.password_salt);
      if (hash !== user.password_hash) return json({ error: "invalid credentials" }, 401);
      const token = randomHex(24);
      await db
        .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))")
        .bind(token, user.id)
        .run();
      return json({ token, role: user.role, name: user.name });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      const auth = req.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const user = await getUserFromToken(db, req);
      if (!user) return json({ error: "unauthorized" }, 401);
      let client_id = null;
      if (user.role === "client") {
        const client = await db.prepare("SELECT id FROM clients WHERE user_id = ?").bind(user.id).first();
        client_id = client ? client.id : null;
      }
      return json({ id: user.id, email: user.email, name: user.name, role: user.role, client_id });
    }

    const user = await getUserFromToken(db, req);

    if (url.pathname === "/api/clients" && req.method === "GET") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { results } = await db.prepare("SELECT * FROM clients ORDER BY created_at DESC").all();
      return json(results);
    }

    if (url.pathname === "/api/clients" && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { company_name, contact, track } = await req.json();
      const res = await db
        .prepare("INSERT INTO clients (company_name, contact, track, created_by_staff_id) VALUES (?, ?, ?, ?)")
        .bind(company_name, contact || null, track || null, user.id)
        .run();
      return json({ id: res.meta.last_row_id });
    }

    const clientDeleteMatch = url.pathname.match(/^\/api\/clients\/(\d+)$/);
    if (clientDeleteMatch && req.method === "DELETE") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      await db.prepare("DELETE FROM clients WHERE id = ?").bind(clientDeleteMatch[1]).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/reports" && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { client_id, title, body, pdf_key, file_name } = await req.json();
      if (!client_id) return json({ error: "client_id required" }, 400);
      await db
        .prepare("INSERT INTO reports (client_id, staff_id, title, body, pdf_key, file_name) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(client_id, user.id, title || null, body || null, pdf_key || null, file_name || null)
        .run();
      return json({ ok: true });
    }

    const reportsMatch = url.pathname.match(/^\/api\/reports\/(\d+)$/);
    if (reportsMatch && req.method === "GET") {
      if (!user) return json({ error: "unauthorized" }, 401);
      const clientId = reportsMatch[1];
      if (user.role !== "staff") {
        const owns = await db.prepare("SELECT id FROM clients WHERE id = ? AND user_id = ?").bind(clientId, user.id).first();
        if (!owns) return json({ error: "forbidden" }, 403);
      }
      const { results } = await db.prepare("SELECT * FROM reports WHERE client_id = ? ORDER BY created_at DESC").bind(clientId).all();
      return json(results);
    }

    const reportFileMatch = url.pathname.match(/^\/api\/reports\/file\/(\d+)$/);
    if (reportFileMatch && req.method === "GET") {
      if (!user) return json({ error: "unauthorized" }, 401);
      const report = await db.prepare("SELECT * FROM reports WHERE id = ?").bind(reportFileMatch[1]).first();
      if (!report || !report.pdf_key) return json({ error: "not found" }, 404);
      if (user.role !== "staff") {
        const owns = await db.prepare("SELECT id FROM clients WHERE id = ? AND user_id = ?").bind(report.client_id, user.id).first();
        if (!owns) return json({ error: "forbidden" }, 403);
      }
      const obj = await env.MEDIA.get(report.pdf_key);
      if (!obj) return json({ error: "file missing" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${(report.file_name || "report.pdf").replace(/"/g, "")}"`,
        },
      });
    }

    if (url.pathname === "/api/bookings" && req.method === "GET") {
      if (!user) return json({ error: "unauthorized" }, 401);
      if (user.role === "staff") {
        const { results } = await db.prepare("SELECT * FROM bookings ORDER BY created_at DESC").all();
        return json(results);
      }
      const client = await db.prepare("SELECT id FROM clients WHERE user_id = ?").bind(user.id).first();
      if (!client) return json([]);
      const { results } = await db.prepare("SELECT * FROM bookings WHERE client_id = ? ORDER BY created_at DESC").bind(client.id).all();
      return json(results);
    }

    if (url.pathname === "/api/bookings" && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { client_id, event_title, track_name, venue } = await req.json();
      const res = await db
        .prepare("INSERT INTO bookings (client_id, event_title, track_name, venue) VALUES (?, ?, ?, ?)")
        .bind(client_id || null, event_title, track_name || null, venue || null)
        .run();
      return json({ id: res.meta.last_row_id });
    }

    const bookingPatchMatch = url.pathname.match(/^\/api\/bookings\/(\d+)$/);
    if (bookingPatchMatch && req.method === "PATCH") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { status } = await req.json();
      await db.prepare("UPDATE bookings SET status = ? WHERE id = ?").bind(status, bookingPatchMatch[1]).run();
      return json({ ok: true });
    }

    // ---- Account management (staff only creates/lists/removes; anyone changes their own password) ----

    if (url.pathname === "/api/users" && req.method === "GET") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { results } = await db.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC").all();
      return json(results);
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const { email, password, name, role, company_name, contact, track } = await req.json();
      if (!email || !password || !name || !role) return json({ error: "email, password, name, role required" }, 400);
      if (role !== "staff" && role !== "client") return json({ error: "role must be staff or client" }, 400);
      if (password.length < 8) return json({ error: "password must be at least 8 characters" }, 400);
      const exists = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (exists) return json({ error: "email already registered" }, 409);
      const { hash, salt } = await hashPassword(password);
      const res = await db
        .prepare("INSERT INTO users (email, password_hash, password_salt, role, name) VALUES (?, ?, ?, ?, ?)")
        .bind(email, hash, salt, role, name)
        .run();
      const userId = res.meta.last_row_id;
      if (role === "client") {
        await db
          .prepare("INSERT INTO clients (user_id, company_name, contact, track, created_by_staff_id) VALUES (?, ?, ?, ?, ?)")
          .bind(userId, company_name || name, contact || email, track || null, user.id)
          .run();
      }
      return json({ id: userId, email, name, role });
    }

    const userDeleteMatch = url.pathname.match(/^\/api\/users\/(\d+)$/);
    if (userDeleteMatch && req.method === "DELETE") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const targetId = Number(userDeleteMatch[1]);
      if (targetId === user.id) return json({ error: "cannot delete your own account" }, 400);
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId).run();
      await db.prepare("DELETE FROM clients WHERE user_id = ?").bind(targetId).run();
      await db.prepare("DELETE FROM users WHERE id = ?").bind(targetId).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/change-password" && req.method === "POST") {
      if (!user) return json({ error: "unauthorized" }, 401);
      const { current_password, new_password } = await req.json();
      if (!current_password || !new_password) return json({ error: "current_password, new_password required" }, 400);
      if (new_password.length < 8) return json({ error: "new password must be at least 8 characters" }, 400);
      const { hash: currentHash } = await hashPassword(current_password, user.password_salt);
      if (currentHash !== user.password_hash) return json({ error: "current password is incorrect" }, 401);
      const { hash, salt } = await hashPassword(new_password);
      await db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, user.id).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ? AND token != ?").bind(user.id, (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")).run();
      return json({ ok: true });
    }

    // ---- File uploads (staff only) — stored in R2, served back from /media/:key ----

    if (url.pathname === "/api/upload" && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const form = await req.formData();
      const file = form.get("file");
      const folder = String(form.get("folder") || "uploads").replace(/[^a-z0-9_-]/gi, "");
      if (!file || typeof file === "string") return json({ error: "file required" }, 400);
      const ext = extFromName(file.name) || "";
      const key = `${folder}/${Date.now()}-${randomHex(6)}${ext}`;
      await env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "application/octet-stream" } });
      return json({ key, url: `/media/${key}`, file_name: file.name });
    }

    // ---- Certificate verification (public) ----

    if (url.pathname === "/api/verify-certificate" && req.method === "GET") {
      const code = (url.searchParams.get("code") || "").trim().toUpperCase();
      if (!code) return json({ error: "code required" }, 400);
      const row = await db.prepare("SELECT data_json FROM content_items WHERE collection = 'certificates' AND slug = ?").bind(code).first();
      if (!row) return json({ found: false });
      const data = JSON.parse(row.data_json);
      delete data.cert_code;
      delete data.email;
      delete data.whatsapp;
      return json({ found: true, code, data });
    }

    // ---- Site content CMS (public reads; staff-only writes) ----

    const CONTENT_COLLECTIONS = new Set(["tracks", "events", "articles", "programmes", "certificates", "resources"]);

    const contentBulkMatch = url.pathname.match(/^\/api\/content\/([a-z]+)\/bulk$/);
    if (contentBulkMatch && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const collection = contentBulkMatch[1];
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      const { items } = await req.json();
      if (!Array.isArray(items) || !items.length) return json({ error: "items array required" }, 400);
      let count = 0;
      for (const it of items) {
        if (!it || !it.slug || typeof it.data !== "object" || it.data === null) continue;
        await db
          .prepare("INSERT INTO content_items (collection, slug, data_json, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(collection, slug) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at")
          .bind(collection, String(it.slug), JSON.stringify(it.data))
          .run();
        count++;
      }
      return json({ ok: true, count });
    }

    const contentListMatch = url.pathname.match(/^\/api\/content\/([a-z]+)$/);
    if (contentListMatch && req.method === "GET") {
      const collection = contentListMatch[1];
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      if (collection === "certificates" && (!user || user.role !== "staff")) return json({ error: "forbidden" }, 403);
      const { results } = await db
        .prepare("SELECT slug, data_json, updated_at FROM content_items WHERE collection = ? ORDER BY updated_at DESC")
        .bind(collection)
        .all();
      return json(results.map((r) => ({ slug: r.slug, updated_at: r.updated_at, data: JSON.parse(r.data_json) })));
    }

    if (contentListMatch && req.method === "POST") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const collection = contentListMatch[1];
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      const { slug, data } = await req.json();
      if (!slug || typeof data !== "object" || data === null) return json({ error: "slug and data required" }, 400);
      const exists = await db.prepare("SELECT id FROM content_items WHERE collection = ? AND slug = ?").bind(collection, slug).first();
      if (exists) return json({ error: "slug already exists in this collection" }, 409);
      await db
        .prepare("INSERT INTO content_items (collection, slug, data_json) VALUES (?, ?, ?)")
        .bind(collection, slug, JSON.stringify(data))
        .run();
      return json({ ok: true, slug });
    }

    const contentItemMatch = url.pathname.match(/^\/api\/content\/([a-z]+)\/([^/]+)$/);
    if (contentItemMatch && req.method === "GET") {
      const [, collection, slug] = contentItemMatch;
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      if (collection === "certificates" && (!user || user.role !== "staff")) return json({ error: "forbidden" }, 403);
      const row = await db.prepare("SELECT slug, data_json, updated_at FROM content_items WHERE collection = ? AND slug = ?").bind(collection, decodeURIComponent(slug)).first();
      if (!row) return json({ error: "not found" }, 404);
      return json({ slug: row.slug, updated_at: row.updated_at, data: JSON.parse(row.data_json) });
    }

    if (contentItemMatch && req.method === "PUT") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const [, collection, slug] = contentItemMatch;
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      const { data } = await req.json();
      if (typeof data !== "object" || data === null) return json({ error: "data required" }, 400);
      const res = await db
        .prepare("UPDATE content_items SET data_json = ?, updated_at = datetime('now') WHERE collection = ? AND slug = ?")
        .bind(JSON.stringify(data), collection, decodeURIComponent(slug))
        .run();
      if (!res.meta.changes) return json({ error: "not found" }, 404);
      return json({ ok: true });
    }

    if (contentItemMatch && req.method === "DELETE") {
      if (!user || user.role !== "staff") return json({ error: "forbidden" }, 403);
      const [, collection, slug] = contentItemMatch;
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
      await db.prepare("DELETE FROM content_items WHERE collection = ? AND slug = ?").bind(collection, decodeURIComponent(slug)).run();
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}

// ---- Live content injection: swap the site's built-in const data for the latest
// database content on every request for "/" and "/index.html", so dashboard edits
// show up on the public site without a rebuild/redeploy. ----

function findValueEnd(text, startIdx) {
  let i = startIdx;
  while (i < text.length && /\s/.test(text[i])) i++;
  const open = text[i];
  if (open !== "[" && open !== "{") return -1;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inString = c; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function replaceConst(text, name, value) {
  const marker = `const ${name} = `;
  const start = text.indexOf(marker);
  if (start === -1) return text;
  const valueStart = start + marker.length;
  const valueEnd = findValueEnd(text, valueStart);
  if (valueEnd === -1) return text;
  const serialized = JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/<\//g, "<\\/");
  return text.slice(0, valueStart) + serialized + text.slice(valueEnd);
}

async function injectLiveContent(html, db) {
  const collections = ["tracks", "events", "articles", "programmes", "certificates", "resources"];
  const results = await Promise.all(
    collections.map((c) =>
      db.prepare("SELECT slug, data_json FROM content_items WHERE collection = ? ORDER BY id ASC").bind(c).all()
    )
  );
  const byCollection = {};
  collections.forEach((c, i) => {
    byCollection[c] = results[i].results.map((r) => ({ slug: r.slug, data: JSON.parse(r.data_json) }));
  });

  let out = html;
  out = replaceConst(out, "TRACKS", byCollection.tracks.map((r) => r.data));
  out = replaceConst(out, "EVENTS", byCollection.events.map((r) => r.data));
  out = replaceConst(out, "ARTICLES", byCollection.articles.map((r) => r.data));
  out = replaceConst(out, "PROGRAMMES", byCollection.programmes.map((r) => r.data));
  out = replaceConst(out, "RESOURCES", byCollection.resources.map((r) => r.data));
  const certsObj = {};
  for (const r of byCollection.certificates) {
    const copy = Object.assign({}, r.data);
    delete copy.cert_code;
    delete copy.email;
    delete copy.whatsapp;
    certsObj[r.slug] = copy;
  }
  out = replaceConst(out, "CERTS", certsObj);
  return out;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);

    const mediaMatch = url.pathname.match(/^\/media\/(.+)$/);
    if (mediaMatch) {
      const obj = await env.MEDIA.get(decodeURIComponent(mediaMatch[1]));
      if (!obj) return new Response("not found", { status: 404 });
      const headers = new Headers();
      if (obj.httpMetadata && obj.httpMetadata.contentType) headers.set("content-type", obj.httpMetadata.contentType);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      return new Response(obj.body, { headers });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const assetRes = await env.ASSETS.fetch(req);
      if (assetRes.ok) {
        const html = await assetRes.text();
        const injected = await injectLiveContent(html, env.DB);
        return new Response(injected, {
          status: assetRes.status,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return assetRes;
    }

    return env.ASSETS.fetch(req);
  },
};
