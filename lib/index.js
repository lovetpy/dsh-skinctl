//#region src/index.ts
/**
 * dsh-skinctl — lightweight skin manager (host half).
 *
 * Scans installed skins at RUNTIME from the Cordis Loader entries (no hardcoded
 * list), exposes them over `/api/skin-manager/*`, and writes the active-skin
 * mutual-exclusion patch into the profile's cordis.patch.yml (hot-reloaded by
 * the DSH config watcher, no restart).
 *
 * Browser half (lib/client.js) renders the settings section UI.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "ui-skinctl";
/** The webserver service must exist before we can mount routes. */
const inject = ["webServer"];

/** Managed patch-section delimiters — the single authority for skin rows. */
const MANAGED_START = "# --- dsh-skin-manager managed (auto-generated; do not edit) ---";
const MANAGED_END = "# --- end dsh-skin-manager managed ---";
/** Legal npm package name (scoped or unscoped). */
const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** Legal cordis loader entry id for a skin insert row. */
const WIRING_ID_RE = /^ui-skin-[a-z0-9-]+$/;
/** Legal skin id. */
const SKIN_ID_RE = /^[a-z0-9-]+$/;

/**
 * Resolve the harness home: injected HOME mapped to <home>/.dsh, else a
 * trimmed non-empty $DSH_HOME (used as-is), else ~/.dsh.
 */
function resolveHarnessHome() {
	const envHome = process.env.HOME;
	if (envHome && envHome.trim()) {
		const candidate = join(envHome, ".dsh");
		if (existsSync(candidate)) return candidate;
	}
	const dshHome = process.env.DSH_HOME;
	if (dshHome && dshHome.trim()) return dshHome.trim();
	return join(homedir(), ".dsh");
}

/**
 * Resolve the active profile name: explicit $DSH_SKIN_PROFILE, then
 * $DSH_PROFILE, then a cwd that sits directly under <home>/profiles/<name>,
 * finally "web".
 */
function resolveProfileName(home) {
	const sp = process.env.DSH_SKIN_PROFILE;
	if (sp && sp.trim()) return sp.trim();
	const dp = process.env.DSH_PROFILE;
	if (dp && dp.trim()) return dp.trim();
	const profilesRoot = join(home, "profiles");
	const cwd = process.cwd();
	if (cwd.startsWith(profilesRoot + sep)) {
		const rest = cwd.slice(profilesRoot.length + 1);
		const name = rest.split(sep)[0];
		if (name) return name;
	}
	return "web";
}

/**
 * Parse the switch-relevant + display fields of one skin.json. Returns null
 * for anything that is not a valid skin (so it is simply skipped).
 */
function readSkinMeta(absDir) {
	try {
		const meta = JSON.parse(readFileSync(join(absDir, "skin.json"), "utf8"));
		if (typeof meta !== "object" || meta === null) return null;
		if (typeof meta.id !== "string" || !SKIN_ID_RE.test(meta.id)) return null;
		if (typeof meta.package !== "string" || !NPM_PACKAGE_NAME_RE.test(meta.package)) return null;
		const wiring = typeof meta.wiring === "object" && meta.wiring !== null ? meta.wiring : null;
		if (wiring === null || typeof wiring.id !== "string" || !WIRING_ID_RE.test(wiring.id)) return null;
		return {
			id: meta.id,
			name: typeof meta.name === "string" ? meta.name : meta.id,
			nameEn: typeof meta.nameEn === "string" ? meta.nameEn : meta.id,
			tagline: typeof meta.tagline === "string" ? meta.tagline : "",
			description: typeof meta.description === "string" ? meta.description : "",
			accent: typeof meta.accent === "string" ? meta.accent : "#4d8fd4",
			bodyAttr: typeof meta.bodyAttr === "string" ? meta.bodyAttr : `data-dsh-skin-${meta.id}`,
			package: meta.package,
			wiring: { id: wiring.id, bundleWired: wiring.bundleWired === true },
			order: typeof meta.order === "number" ? meta.order : 999
		};
	} catch {
		return null;
	}
}

/**
 * Scan the profile's node_modules tree for installed skin packages (any
 * package directory carrying a skin.json). Walling the walk to the profile
 * tree mirrors how `dsh plugin add <skin>` actually installs them, and a
 * package without skin.json — the manager itself, ordinary plugins, leftover
 * dirs — is skipped by construction.
 *
 * enabled/active are taken from the live Loader entries keyed by wiring id
 * (the same ids this plugin writes during apply), so the list always matches
 * the running `window.__DSH_BOOT__` module graph.
 */
function scanSkins(ctx) {
	const skins = [];
	const entryById = new Map();
	for (const entry of ctx.loader.entries()) {
		if (entry.options.group) continue;
		// key by the RAW id (entry.options.id) — the `entry.id` getter prefixes
		// nested ids with an ancestor (`parent/ui-skin-*`), which would never
		// match skin.json's wiring.id and wrongly report every skin as inactive.
		if (entry.options.id) entryById.set(entry.options.id, entry);
	}
	const home = resolveHarnessHome();
	const profile = resolveProfileName(home);
	const nm = join(home, "profiles", profile, "node_modules");
	const seenIds = new Set();
	const candidates = [];
	try {
		for (const dir of readdirSync(nm)) {
			const full = join(nm, dir);
			// scoped dir: @scope/pkg
			if (dir.startsWith("@")) {
				if (!existsSync(full)) continue;
				for (const sub of readdirSync(full)) {
					const pkg = join(full, sub);
					if (!existsSync(join(pkg, "skin.json"))) continue;
					candidates.push({ pkg, name: `${dir}/${sub}` });
				}
			} else {
				if (!existsSync(join(full, "skin.json"))) continue;
				candidates.push({ pkg: full, name: dir });
			}
		}
	} catch {
		// profile node_modules absent/unreadable — treat as no skins
	}
	for (const { pkg, name } of candidates) {
		const meta = readSkinMeta(pkg);
		if (meta === null || seenIds.has(meta.id)) continue;
		seenIds.add(meta.id);
		// resolve enabled state from the live loader entry for this wiring id.
		// Absent an entry, treat as inactive (not enabled by this deployment).
		const entry = entryById.get(meta.wiring.id);
		const enabled = entry ? !entry.disabled : false;
		skins.push({
			...meta,
			package: meta.package || name,
			entryId: entry ? entry.options.id : meta.wiring.id,
			enabled,
			active: enabled
		});
	}
	skins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	const anyActive = skins.some((s) => s.active);
	return { skins, officialActive: !anyActive };
}

/**
 * Read & parse the existing profile patch YAML, returning the raw text and the
 * lines outside the managed section (preserving comments & user rows). Falls
 * back to an empty-root `[]` when the file is absent.
 */
function readPatchParts(patchPath) {
	const raw = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "[]\n";
	const lines = raw.split(/\r?\n/);
	let inManaged = false;
	let pre = [];
	let post = [];
	let managedLines = [];
	for (const line of lines) {
		if (line.trim() === MANAGED_START) { inManaged = true; managedLines.push(line); continue; }
		if (line.trim() === MANAGED_END) { inManaged = false; managedLines.push(line); continue; }
		if (inManaged) { managedLines.push(line); continue; }
		if (managedLines.length === 0) pre.push(line); else post.push(line);
	}
	return { raw, pre, post };
}

/** Quote a YAML string value safely (single-quoted, doubled inner quotes). */
function yq(s) {
	return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Build the managed section YAML: a list of TOP-LEVEL loader patch rows, each
 * targeting one skin's wiring id and overriding its `disabled` state.
 *
 * Skins are already registered by their bundle patches (each skin's
 * cordis.patch.yml inserts its dsh.client row), so the profile layer must NOT
 * re-insert them — that would double-register the same id. Instead it writes
 * id-targeted disable rows, exactly like dsh-web-app disables rows and like
 * the community skin-center does for bundle-wired skins. The active skin gets
 * `disabled: false` (to lift any stale disable left by a previous switch); the
 * rest get `disabled: true`. Empty id => every skin `disabled: true`.
 */
function buildManagedSection(ctx, skins, targetId) {
	const rows = [];
	for (const skin of skins) {
		if (targetId && skin.id === targetId) {
			rows.push(`- id: ${skin.wiring.id}`);
			rows.push(`  disabled: false`);
		} else {
			rows.push(`- id: ${skin.wiring.id}`);
			rows.push(`  disabled: true`);
		}
	}
	const out = [];
	out.push(MANAGED_START);
	out.push(...rows);
	out.push(MANAGED_END);
	return out.join("\n");
}

/**
 * Strip any bare `[]` empty-root lines from the pre-section lines (the DSH
 * default patch root). Leaving one alongside a later `- insert:` block would
 * make the same YAML document hold a flow root AND a block sequence, which the
 * DSH loader rejects ("Unexpected seq-item-ind token"). Comment lines are
 * preserved; only the empty flow root is removed.
 */
function stripDefaultRoot(pre) {
	return pre.filter((l) => l.trim() !== "[]");
}

/**
 * Write the patch by truncating-and-overwriting the target file IN PLACE.
 *
 * Must NOT use a temp-dir + rename ("atomic"): the DSH config watcher
 * (cordis-plugin-hmr, chokidar) compares the reported change path against the
 * exact resolved target with a strict `!==`. On Windows a temp-dir + rename is
 * reported as a different/child path and the event is silently dropped, so the
 * loader never hot-reloads and only a process restart picks up the change.
 * A plain in-place write is the change the watcher reliably detects.
 */
function writePatchAtomic(patchPath, text) {
	writeFileSync(patchPath, text, "utf8");
}

/** JSON helper for route handlers. */
function sendJson(res, status, body) {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Content-Length": Buffer.byteLength(text)
	});
	res.end(text);
}

/** Read a JSON request body (length-capped). Rejects on parse error. */
function readJsonBody(req, limit = 65536) {
	return new Promise((resolve, reject) => {
		let len = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			len += chunk.length;
			if (len > limit) { reject(new Error("body too large")); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			if (!raw.trim()) { resolve({}); return; }
			try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
		});
		req.on("error", reject);
	});
}

/**
 * Apply the skin switch: rewrite the profile patch's managed section and let
 * the DSH config watcher hot-reload it. Returns { ok, reload } or an error.
 */
async function applySkin(ctx, skins, id) {
	const home = resolveHarnessHome();
	const profile = resolveProfileName(home);
	const patchPath = join(home, "profiles", profile, "cordis.patch.yml");
	if (!existsSync(dirname(patchPath))) {
		return { ok: false, error: `profile directory not found: ${dirname(patchPath)}` };
	}
	// validate id
	if (id && !skins.some((s) => s.id === id)) {
		return { ok: false, error: `unknown skin id: ${id}` };
	}
	const { pre, post } = readPatchParts(patchPath);
	const cleanPre = stripDefaultRoot(pre);
	const managed = buildManagedSection(ctx, skins, id || null);
	const text = [...cleanPre, managed, ...post].filter((l, i, arr) =>
		// drop leading blank lines & collapse trailing blanks
		!(i === 0 && l.trim() === "") && !(i === arr.length - 1 && l.trim() === "")
	).join("\n") + "\n";
	try {
		writePatchAtomic(patchPath, text);
	} catch (e) {
		return { ok: false, error: `failed to write patch: ${e?.message ?? e}` };
	}
	return { ok: true, reload: true, profile };
}

/**
 * Mount the skin-manager API routes under /api/skin-manager/*. Failure is
 * logged, never thrown — the web shell fails the whole boot when a plugin
 * apply throws, and the skin manager must not take the GUI down.
 */
function applyImpl(ctx) {
	const disposers = [];
	// capture config-reload failures so the debug route can show the real cause
	let lastConfigError = null;
	try { disposers.push(ctx.on("hmr/config-update-failed", (filename, error) => {
		lastConfigError = { filename: String(filename), error: String(error?.stack ?? error) };
	})); } catch {}
	try {
		disposers.push(ctx.webServer.register({
			kind: "exact",
			path: "/api/skin-manager/list",
			handler: async (_req, res) => {
				try {
					const { skins, officialActive } = scanSkins(ctx);
					sendJson(res, 200, { ok: true, skins, officialActive });
				} catch (e) {
					sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
				}
			}
		}));
		disposers.push(ctx.webServer.register({
			kind: "exact",
			path: "/api/skin-manager/apply",
			handler: async (req, res) => {
				try {
					let body = {};
					try { body = await readJsonBody(req); } catch { body = {}; }
					const id = typeof body.id === "string" ? body.id.trim() : "";
					const { skins } = scanSkins(ctx);
					const result = await applySkin(ctx, skins, id);
					sendJson(res, result.ok ? 200 : 400, result);
				} catch (e) {
					sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
				}
			}
		}));
		disposers.push(ctx.webServer.register({
			kind: "exact",
			path: "/api/skin-manager/debug",
			handler: async (_req, res) => {
				try {
					const entries = [];
					for (const entry of ctx.loader.entries()) {
						entries.push({
							entryId: entry.id,
							name: entry.options.name,
							disabled: entry.disabled,
							group: entry.options.group === true,
							fiberState: entry.fiber === void 0 ? null : entry.fiber.state
						});
					}
					sendJson(res, 200, { ok: true, entries, lastConfigError });
				} catch (e) {
					sendJson(res, 500, { ok: false, error: e?.message ?? String(e) });
				}
			}
		}));
		disposers.push(ctx.webServer.register({
			kind: "exact",
			path: "/api/skin-manager/import-test",
			handler: async (_req, res) => {
				const out = {};
				for (const name of ["dsh-client-ui-skin-gdx", "@linxin666/dsh-client-ui-skin-whale-song"]) {
					try {
						const m = await import(name);
						out[name] = "OK apply=" + typeof m.apply;
					} catch (e) {
						out[name] = "FAIL " + (e?.message ?? String(e)).split("\n")[0];
					}
				}
				// also test via the loader's own internal importer (the real path)
				const viaLoader = {};
				try {
					const internal = ctx.loader.internal;
					const baseUrl = ctx.baseUrl;
					viaLoader.baseUrl = String(baseUrl);
					viaLoader.hasInternal = typeof internal?.import === "function";
					if (viaLoader.hasInternal) {
						for (const name of ["dsh-client-ui-skin-gdx", "@linxin666/dsh-client-ui-skin-whale-song"]) {
							try {
								const m = await internal.import(name, baseUrl, {});
								viaLoader[name] = "OK apply=" + typeof m?.apply;
							} catch (e) {
								viaLoader[name] = "FAIL " + (e?.message ?? String(e)).split("\n")[0];
							}
						}
					}
				} catch (e) {
					viaLoader.error = (e?.message ?? String(e)).split("\n")[0];
				}
				sendJson(res, 200, { ok: true, imports: out, viaLoader });
			}
		}));
	} catch (error) {
		for (const d of disposers) try { d(); } catch {}
		console.error("[ui-skinctl] route registration failed:", error);
		return;
	}
	ctx.effect(() => () => {
		for (const d of disposers) try { d(); } catch {}
	}, "ui-skinctl: routes");
}

const apply = applyImpl;

export { apply, name, inject };
//#endregion
