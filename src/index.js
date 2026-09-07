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
      const { client_id, body } = await req.json();
      await db.prepare("INSERT INTO reports (client_id, staff_id, body) VALUES (?, ?, ?)").bind(client_id, user.id, body).run();
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

    // ---- Site content CMS (public reads; staff-only writes) ----

    const CONTENT_COLLECTIONS = new Set(["tracks", "events", "articles", "programmes", "certificates", "resources"]);

    const contentListMatch = url.pathname.match(/^\/api\/content\/([a-z]+)$/);
    if (contentListMatch && req.method === "GET") {
      const collection = contentListMatch[1];
      if (!CONTENT_COLLECTIONS.has(collection)) return json({ error: "unknown collection" }, 404);
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env, url);
    return env.ASSETS.fetch(req);
  },
};
