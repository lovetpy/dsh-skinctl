window.__ModuleLoader__.load({
	id: "dsh-skinctl",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let reactJsx = require("react/jsx-runtime");
		const { useState, useEffect, useCallback, Fragment } = react;
		const { jsx, jsxs } = reactJsx;

		//#region src/client/locales.ts
		const NS = "skinManager";
		const zh = {
			title: "皮肤管理",
			desc: "扫描已安装皮肤并切换激活皮肤。切换后页面会自动刷新生效。",
			official: "官方默认",
			officialDesc: "不启用任何皮肤，使用 dsh 原始外观",
			active: "当前",
			apply: "应用",
			applying: "应用中…",
			applyOfficial: "恢复默认",
			loading: "加载中…",
			reload: "刷新页面生效",
			error: "出错了",
			empty: "没有已安装的皮肤。用 dsh plugin --profile web add <皮肤包> 安装一个。",
			confirm: (name) => `切换到「${name}」？当前页面会刷新。`
		};
		const en = {
			title: "Skin Manager",
			desc: "Scans installed skins and switches the active one. The page reloads after switching.",
			official: "Official Default",
			officialDesc: "Enable no skin — the original dsh look",
			active: "Active",
			apply: "Apply",
			applying: "Applying…",
			applyOfficial: "Restore Default",
			loading: "Loading…",
			reload: "Reload to take effect",
			error: "Error",
			empty: "No installed skins. Install one with dsh plugin --profile web add <skin-package>.",
			confirm: (name) => `Switch to “${name}”? The current page will reload.`
		};
		//#endregion

		//#region src/client/controller.ts
		/**
		 * Minimal store the React panel subscribes to. The host half scans the
		 * Loader entries and serves /api/skin-manager/list; this controller just
		 * fetches, holds the snapshot, and posts the apply call.
		 */
		function createController(t) {
			let listeners = new Set();
			let state = { status: "idle", skins: [], officialActive: false, error: null, applying: null };
			const emit = () => { for (const l of listeners) try { l(); } catch {} };
			const set = (patch) => { state = { ...state, ...patch }; emit(); };
			const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
			const get = () => state;

			const load = async () => {
				set({ status: "loading", error: null });
				try {
					const r = await fetch("/api/skin-manager/list", { headers: { "Accept": "application/json" } });
					const j = await r.json();
					if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
					set({ status: "ready", skins: j.skins || [], officialActive: !!j.officialActive, error: null });
				} catch (e) {
					set({ status: "error", error: e?.message || String(e) });
				}
			};

			const applySkin = async (id) => {
				set({ applying: id });
				try {
					const r = await fetch("/api/skin-manager/apply", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(id ? { id } : {})
					});
					const j = await r.json();
					if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
					// The host wrote the profile patch; the DSH config watcher hot-reloads it
					// (usually ~1s; occasionally the file event is missed). Poll the live state
					// until the target is active; if stale after 6s, rewrite the patch once to
					// fire a fresh watcher event, then keep waiting. Reload only after the
					// state confirms — the browser picks up the new boot graph on reload.
					const reached = async () => {
						try {
							const lr = await fetch("/api/skin-manager/list", { headers: { "Accept": "application/json" } });
							const lj = await lr.json();
							if (!lr.ok || !lj.ok) return false;
							if (!id) return !!lj.officialActive;
							const target = (lj.skins || []).find((x) => x.id === id);
							return !!target && target.active === true;
						} catch { return false; }
					};
					const wait = (ms) => new Promise((res) => setTimeout(res, ms));
					let done = false;
					for (let round = 0; round < 2 && !done; round++) {
						for (let i = 0; i < 6 && !done; i++) {
							await wait(1000);
							done = await reached();
						}
						if (!done && round === 0) {
							// stale read — rewrite the same patch to retrigger the watcher
							try {
								await fetch("/api/skin-manager/apply", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify(id ? { id } : {})
								});
							} catch {}
						}
					}
					try { location.reload(); } catch {}
				} catch (e) {
					set({ applying: null, error: e?.message || String(e) });
				}
			};

			return { subscribe, get, load, applySkin };
		}
		//#endregion

		//#region src/client/SkinManagerPanel.tsx
		/** Inline styles scoped under the settings section content column. */
		const STYLES = `
.dsh-skin-mgr { display:flex; flex-direction:column; gap:16px; padding:4px 0 8px; max-width:760px; }
.dsh-skin-mgr__desc { color:var(--dsw-alias-text-secondary, #6b7280); font-size:13px; line-height:1.5; margin:0; }
.dsh-skin-mgr__grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
.dsh-skin-mgr__card { border:1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.12)); border-radius:10px; padding:14px; background:var(--dsw-alias-bg-elevated, rgba(255,255,255,.6)); display:flex; flex-direction:column; gap:8px; }
.dsh-skin-mgr__card--active { border-color:var(--dsw-alias-border-focus, #4d8fd4); box-shadow:0 0 0 1px var(--dsw-alias-border-focus, #4d8fd4) inset; }
.dsh-skin-mgr__head { display:flex; align-items:center; gap:8px; }
.dsh-skin-mgr__swatch { width:14px; height:14px; border-radius:4px; flex-shrink:0; border:1px solid rgba(0,0,0,.1); }
.dsh-skin-mgr__name { font-weight:600; font-size:14px; color:var(--dsw-alias-text-primary, #111); }
.dsh-skin-mgr__tagline { font-size:12px; color:var(--dsw-alias-text-tertiary, #9ca3af); line-height:1.4; margin:0; min-height:1.4em; }
.dsh-skin-mgr__badge { display:inline-flex; align-items:center; font-size:11px; font-weight:600; color:var(--dsw-alias-bg-elevated, #fff); background:var(--dsw-alias-border-focus, #4d8fd4); padding:2px 8px; border-radius:999px; align-self:flex-start; }
.dsh-skin-mgr__btn { align-self:flex-start; cursor:pointer; border:1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.12)); background:var(--dsw-alias-bg-elevated-strong, rgba(255,255,255,.9)); color:var(--dsw-alias-text-primary, #111); padding:6px 14px; border-radius:8px; font-size:13px; }
.dsh-skin-mgr__btn:hover { border-color:var(--dsw-alias-border-focus, #4d8fd4); }
.dsh-skin-mgr__btn:disabled { opacity:.55; cursor:default; }
.dsh-skin-mgr__btn--active { background:var(--dsw-alias-border-focus, #4d8fd4); color:#fff; border-color:transparent; }
.dsh-skin-mgr__err { color:var(--dsw-alias-text-danger, #dc2626); font-size:13px; }
.dsh-skin-mgr__empty { color:var(--dsw-alias-text-tertiary, #9ca3af); font-size:13px; }
`;

		function injectStyles() {
			if (typeof document === "undefined") return;
			const tagId = "dsh-skinctl/styles";
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-skinctl";
			tag.dataset.pluginCss = tagId;
			tag.textContent = STYLES;
			document.head.appendChild(tag);
		}

		function SkinCard({ skin, active, applying, onApply, t }) {
			const isApplying = applying === skin.id;
			const onClick = () => {
				if (active || isApplying) return;
				if (typeof t === "function" && t("confirm") && t("confirm") !== "confirm") {
					// t("confirm", name) style — but our locale stores a function under confirm
				}
				const msg = typeof t === "function" ? (() => { try { return t("confirm")(skin.name); } catch { return ""; } })() : "";
				if (msg && !window.confirm(msg)) return;
				onApply(skin.id);
			};
			return jsx("div", {
				className: "dsh-skin-mgr__card" + (active ? " dsh-skin-mgr__card--active" : ""),
				children: jsxs(Fragment, {
					children: [
						jsxs("div", { className: "dsh-skin-mgr__head", children: [
							jsx("span", { className: "dsh-skin-mgr__swatch", style: { background: skin.accent || "#4d8fd4" } }),
							jsx("span", { className: "dsh-skin-mgr__name", children: skin.name || skin.id })
						]}),
						skin.tagline ? jsx("p", { className: "dsh-skin-mgr__tagline", children: skin.tagline }) : null,
						active
							? jsx("span", { className: "dsh-skin-mgr__badge", children: t("active") })
							: jsx("button", {
								className: "dsh-skin-mgr__btn",
								disabled: isApplying,
								onClick,
								children: isApplying ? t("applying") : t("apply")
							})
					]
				})
			});
		}

		function OfficialCard({ active, applying, onApply, t }) {
			const isApplying = applying === "__official__";
			const onClick = () => {
				if (active || isApplying) return;
				const msg = typeof t === "function" ? (() => { try { return t("confirm")(t("official")); } catch { return ""; } })() : "";
				if (msg && !window.confirm(msg)) return;
				onApply(null);
			};
			return jsx("div", {
				className: "dsh-skin-mgr__card" + (active ? " dsh-skin-mgr__card--active" : ""),
				children: jsxs(Fragment, {
					children: [
						jsx("div", { className: "dsh-skin-mgr__head", children: [
							jsx("span", { className: "dsh-skin-mgr__swatch", style: { background: "transparent", border: "1px dashed var(--dsw-alias-border-subtle, #ccc)" } }),
							jsx("span", { className: "dsh-skin-mgr__name", children: t("official") })
						]}),
						jsx("p", { className: "dsh-skin-mgr__tagline", children: t("officialDesc") }),
						active
							? jsx("span", { className: "dsh-skin-mgr__badge", children: t("active") })
							: jsx("button", {
								className: "dsh-skin-mgr__btn",
								disabled: isApplying,
								onClick,
								children: isApplying ? t("applying") : t("applyOfficial")
							})
					]
				})
			});
		}

		function SkinManagerPanel({ t, controller }) {
			const [, force] = useState(0);
			const reRender = useCallback(() => force((n) => n + 1), []);
			useEffect(() => controller.subscribe(reRender), [controller, reRender]);
			useEffect(() => { injectStyles(); controller.load(); }, [controller]);
			const s = controller.get();
			const applying = s.applying;

			if (s.status === "loading" && s.skins.length === 0) {
				return jsx("div", { className: "dsh-skin-mgr", children: jsx("p", { className: "dsh-skin-mgr__empty", children: t("loading") }) });
			}
			return jsxs("div", {
				className: "dsh-skin-mgr",
				children: [
					jsx("p", { className: "dsh-skin-mgr__desc", children: t("desc") }),
					s.error ? jsx("p", { className: "dsh-skin-mgr__err", children: `${t("error")}: ${s.error}` }) : null,
					jsxs("div", {
						className: "dsh-skin-mgr__grid",
						children: [
							jsx(OfficialCard, {
								active: s.officialActive,
								applying,
								onApply: controller.applySkin,
								t
							}),
							s.skins.length === 0 && !s.officialActive
								? jsx("p", { className: "dsh-skin-mgr__empty", children: t("empty") })
								: s.skins.map((skin) => jsx(SkinCard, {
									key: skin.id,
									skin,
									active: skin.active,
									applying,
									onApply: controller.applySkin,
									t
								}))
						]
					})
				]
			});
		}
		//#endregion

		//#region src/client/index.ts
		/** Host services required by the browser half. */
		const inject = ["slots", "locale"];

		function apply(ctx) {
			// Register locale dictionaries (en/zh).
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-skinctl: dictionaries");

			// The settings section component receives { t, controller } — t is the
			// locale bound function (from PropsLocale), controller from our injected.
			const injected = () => ({
				controller: createController(ctx.locale.bind(NS))
			});

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skin-manager",
				order: 115,
				label: () => ctx.locale.bind(NS)("title"),
				locale: NS,
				inject: injected
			}, SkinManagerPanel));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.name = "ui-skinctl";
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
