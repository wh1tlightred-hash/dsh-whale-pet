// Browser half of dsh-whale-pet: a 桌宠 section in DSH Settings (show switch and
// size slider) plus a show / hide row in the sidebar "更多" menu. Both write the
// Host entry's volatile config; the Host shows, hides or resizes the pet window
// when the value changes, without a restart.
//
// Hand-written in the shape the DSH module loader expects from a tsdown build:
// running this file only registers a factory; the body runs on first use.
window.__ModuleLoader__.load({
	id: "dsh-whale-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const { jsx, jsxs } = require("react/jsx-runtime");
		const { useEffect, useRef, useState } = require("react");
		const { Switch } = require("@deepseek-ai/dsh-client-ui-primitives");

		const css = ".dsh-whale-pet-section{display:flex;flex-direction:column;width:100%}.dsh-whale-pet-row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}.dsh-whale-pet-section>.dsh-whale-pet-row:last-child{border-bottom:none}.dsh-whale-pet-title{font-size:14px;line-height:20px}.dsh-whale-pet-description{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}.dsh-whale-pet-description[data-tone=error]{color:var(--dsw-alias-label-danger,#d64545)}.dsh-whale-pet-size{display:flex;align-items:center;gap:10px;flex:none}.dsh-whale-pet-size input{width:180px;accent-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4d6bfe);cursor:pointer}.dsh-whale-pet-size input:disabled{cursor:default;opacity:.5}.dsh-whale-pet-value{min-width:40px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}.dsh-whale-pet-reset{border:0;background:none;padding:2px 4px;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4d6bfe);cursor:pointer}.dsh-whale-pet-reset[hidden]{display:none}.dsh-whale-pet-name{width:180px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#d8dee8);border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}.dsh-whale-pet-name:focus{border-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4d6bfe)}.dsh-whale-pet-name:disabled{opacity:.5}";
		const tagId = "dsh-whale-pet/Settings.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-whale-pet";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Minimal observable store with the getSnapshot/subscribe shape slot hooks read. */
		function createStore(initial) {
			let snapshot = initial;
			const listeners = new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => { listeners.delete(listener); };
				},
				set(next) {
					snapshot = { ...snapshot, ...next };
					for (const listener of [...listeners]) listener();
				}
			};
		}

		/** Name rules; mirror the Host Config. */
		const NAME = { default: "蓝色大肥鱼", maxLength: 20 };

		/** Size range in percent; mirrors the Host Config (0.6 – 1.6, default 1). */
		const SIZE = { min: 60, max: 160, step: 5, default: 100 };

		/** Ordered writes; a refused or failed write leaves the accepted Host value on screen. */
		function createPreference(form) {
			const state = createStore({ busy: false, failed: false });
			const write = async (field, value) => {
				state.set({ busy: true, failed: false });
				let accepted = false;
				try {
					accepted = value === void 0 ? await form.unset(field) : await form.set(field, value);
				} catch (_error) {}
				state.set({ busy: false, failed: !accepted });
			};
			return {
				state,
				async setEnabled(enabled) {
					if (state.getSnapshot().busy) return;
					await write("enabled", enabled);
				},
				setScale: (percent) => write("scale", Math.round(percent) / 100),
				// An empty name clears the override, so the default name comes back.
				setName: (name) => { const trimmed = String(name).trim().slice(0, NAME.maxLength); return write("name", trimmed ? trimmed : void 0); }
			};
		}

		function SwitchRow({ pet, mutation, setEnabled, t }) {
			const ready = pet.status === "ready";
			const enabled = ready && pet.value?.enabled !== false;
			const description = mutation.failed ? t("failed") : ready ? t(enabled ? "on" : "off") : t("unavailable");
			return jsxs("div", {
				className: "dsh-whale-pet-row",
				children: [jsxs("div", { children: [jsx("div", {
					className: "dsh-whale-pet-title",
					children: t("title")
				}), jsx("div", {
					className: "dsh-whale-pet-description",
					"data-tone": mutation.failed ? "error" : void 0,
					children: description
				})] }), jsx(Switch, {
					checked: enabled,
					label: t("title"),
					disabled: mutation.busy || !ready || !pet.writable,
					onChange: (value) => { setEnabled(value); }
				})]
			});
		}

		/** The slider previews locally and writes once the hand rests, so dragging is not a stream of saves. */
		function SizeRow({ pet, setScale, t }) {
			const ready = pet.status === "ready";
			const saved = Math.round((Number(pet.value?.scale) || 1) * 100);
			const [draft, setDraft] = useState(saved);
			const timer = useRef(void 0);
			const pending = useRef(false);
			useEffect(() => { if (!pending.current) setDraft(saved); }, [saved]);
			useEffect(() => () => { if (timer.current !== void 0) clearTimeout(timer.current); }, []);
			const commit = (value, delay) => {
				pending.current = true;
				if (timer.current !== void 0) clearTimeout(timer.current);
				timer.current = setTimeout(() => {
					timer.current = void 0;
					pending.current = false;
					if (value !== saved) setScale(value);
				}, delay);
			};
			return jsxs("div", {
				className: "dsh-whale-pet-row",
				children: [jsxs("div", { children: [jsx("div", {
					className: "dsh-whale-pet-title",
					children: t("size")
				}), jsx("div", {
					className: "dsh-whale-pet-description",
					children: t("sizeHint")
				})] }), jsxs("div", {
					className: "dsh-whale-pet-size",
					children: [jsx("button", {
						type: "button",
						className: "dsh-whale-pet-reset",
						hidden: draft === SIZE.default,
						disabled: !ready || !pet.writable,
						onClick: () => { setDraft(SIZE.default); commit(SIZE.default, 0); },
						children: t("reset")
					}), jsx("input", {
						type: "range",
						min: SIZE.min,
						max: SIZE.max,
						step: SIZE.step,
						value: draft,
						disabled: !ready || !pet.writable,
						"aria-label": t("size"),
						onChange: (event) => { const value = Number(event.target.value); setDraft(value); commit(value, 250); }
					}), jsx("span", {
						className: "dsh-whale-pet-value",
						children: draft + "%"
					})]
				})]
			});
		}

		/** The name saves when the field is left or Enter is pressed; Escape restores the saved name. */
		function NameRow({ pet, setName, t }) {
			const ready = pet.status === "ready";
			const saved = typeof pet.value?.name === "string" && pet.value.name.trim() ? pet.value.name.trim() : NAME.default;
			const [draft, setDraft] = useState(saved);
			const editing = useRef(false);
			useEffect(() => { if (!editing.current) setDraft(saved); }, [saved]);
			const commit = () => {
				editing.current = false;
				const next = draft.trim();
				if (!next) setDraft(NAME.default);
				if ((next || NAME.default) !== saved) setName(next);
			};
			return jsxs("div", {
				className: "dsh-whale-pet-row",
				children: [jsxs("div", { children: [jsx("div", {
					className: "dsh-whale-pet-title",
					children: t("name")
				}), jsx("div", {
					className: "dsh-whale-pet-description",
					children: t("nameHint")
				})] }), jsx("input", {
					type: "text",
					className: "dsh-whale-pet-name",
					value: draft,
					maxLength: NAME.maxLength,
					placeholder: NAME.default,
					disabled: !ready || !pet.writable,
					"aria-label": t("name"),
					onFocus: () => { editing.current = true; },
					onChange: (event) => { setDraft(event.target.value); },
					onBlur: commit,
					onKeyDown: (event) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
						else if (event.key === "Escape") { editing.current = false; setDraft(saved); event.stopPropagation(); }
					}
				})]
			});
		}

		function PetSection({ usePet, useMutation, setEnabled, setScale, setName, t }) {
			const pet = usePet((value) => value);
			const mutation = useMutation((value) => value);
			return jsxs("div", {
				className: "dsh-whale-pet-section",
				children: [jsx(SwitchRow, { pet, mutation, setEnabled, t }), jsx(NameRow, { pet, setName, t }), jsx(SizeRow, { pet, setScale, t })]
			});
		}

		const zh = {
			nav: "桌宠",
			title: "显示桌宠",
			on: "桌宠显示在桌面上，汇总任务状态并可在桌宠中审批",
			off: "桌宠已隐藏，审批回到 dsh 原生界面",
			unavailable: "桌宠插件未运行",
			failed: "无法保存设置，请重试",
			name: "桌宠昵称",
			nameHint: "显示在桌宠的状态卡片和托盘提示中，清空恢复默认",
			size: "桌宠大小",
			sizeHint: "拖动调节，桌宠立即缩放",
			reset: "恢复默认"
		};
		const en = {
			nav: "Desktop pet",
			title: "Show desktop pet",
			on: "The pet shows task status on the desktop and can answer approvals",
			off: "The pet is hidden and approvals use the DSH dialog",
			unavailable: "The pet plugin is not running",
			failed: "Could not save the setting",
			name: "Pet name",
			nameHint: "Shown on the status bubble and tray tooltip; clear it to restore the default",
			size: "Pet size",
			sizeHint: "Drag to resize the pet right away",
			reset: "Reset"
		};

		/** Services used by the browser half. */
		const inject = ["slots", "locale", "configForms"];
		/** Host loader entry id of the pet row (see cordis.patch.yml). */
		const NAMESPACE = "desktop-whale-pet";

		function apply(ctx) {
			const locale = "dshWhalePet";
			ctx.effect(() => ctx.locale.register(locale, { zh, en }));
			const t = ctx.locale.bind(locale);
			const form = ctx.configForms.get(NAMESPACE);
			const preference = createPreference(form);
			ctx.effect(() => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "whale-pet",
				order: 50,
				label: () => t("nav"),
				locale,
				inject: () => ({
					hooks: { pet: form, mutation: preference.state },
					setEnabled: (enabled) => preference.setEnabled(enabled),
					setScale: (percent) => preference.setScale(percent),
					setName: (name) => preference.setName(name)
				})
			}, PetSection))));
			ctx.effect(() => installMoreMenuItem(form, preference));
		}

		// The sidebar "更多" / account menu has a fixed item list and no slot, so the
		// toggle is added to its DOM while it is open. The menu closes itself on any
		// click on a `button[role=menuitem]` inside it, the injected one included,
		// and re-measures its height every frame, so the extra row is positioned.
		const MENU_TEXT = {
			zh: { hide: "隐藏桌宠", show: "显示桌宠" },
			en: { hide: "Hide desktop pet", show: "Show desktop pet" }
		};
		const SETTINGS_LABELS = ["设置", "Settings"];
		const CONTACT_LABELS = { "意见反馈": "zh", "Feedback": "en" };
		const svg = (extra) => "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/>" + extra + "</svg>";
		const ICON_SHOW = svg("");
		const ICON_HIDE = svg("<path d=\"M2.5 2.5l11 11\"/>");

		/** Find the account menu by its own items: Settings plus Feedback. */
		function accountMenuAnchor(list) {
			const items = Array.from(list.querySelectorAll("button[role=\"menuitem\"]"));
			const contact = items.find((item) => Object.hasOwn(CONTACT_LABELS, (item.textContent ?? "").trim()));
			if (contact === void 0) return void 0;
			const hasSettings = items.some((item) => SETTINGS_LABELS.some((label) => (item.textContent ?? "").trim().startsWith(label)));
			return hasSettings ? contact : void 0;
		}

		/** Current pet state as the menu shows it; `undefined` until the Host value arrives. */
		function petEnabled(form) {
			const snapshot = form.getSnapshot();
			return snapshot.status === "ready" ? snapshot.value?.enabled !== false : void 0;
		}

		/**
		 * Bring an injected row in line with the current value. Writes only what
		 * changed: the menu observer sees every DOM write, so an unconditional
		 * write would rescan forever.
		 */
		function paintItem(clone, form, preference) {
			const enabled = petEnabled(form);
			const button = clone.querySelector("button[role=\"menuitem\"]");
			if (button === null || enabled === void 0) return;
			const state = enabled ? "on" : "off";
			if (clone.getAttribute("data-dsh-whale-pet-item") !== state) {
				clone.setAttribute("data-dsh-whale-pet-item", state);
				const spans = Array.from(button.children).filter((child) => child.tagName === "SPAN");
				const icon = spans.find((span) => span.querySelector("svg") !== null);
				const label = spans.find((span) => span !== icon) ?? button;
				if (icon !== void 0) icon.innerHTML = enabled ? ICON_HIDE : ICON_SHOW;
				label.textContent = MENU_TEXT[clone.getAttribute("data-lang")][enabled ? "hide" : "show"];
			}
			const disabled = !form.getSnapshot().writable || preference.state.getSnapshot().busy;
			if (button.disabled !== disabled) button.disabled = disabled;
		}

		function buildItem(contact, form, preference) {
			const wrap = contact.parentElement;
			if (petEnabled(form) === void 0 || wrap === null) return void 0;
			const clone = wrap.cloneNode(true);
			clone.setAttribute("data-dsh-whale-pet-item", "");
			clone.setAttribute("data-lang", CONTACT_LABELS[(contact.textContent ?? "").trim()]);
			for (const separator of clone.querySelectorAll("[role=\"separator\"]")) separator.remove();
			const button = clone.querySelector("button[role=\"menuitem\"]");
			if (button === null) return void 0;
			// Read the value at click time; the row can outlive several toggles.
			button.addEventListener("click", () => {
				const enabled = petEnabled(form);
				if (enabled !== void 0) preference.setEnabled(!enabled);
			});
			paintItem(clone, form, preference);
			return clone;
		}

		function installMoreMenuItem(form, preference) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
			const scan = () => {
				for (const list of document.querySelectorAll("[role=\"menu\"]")) {
					const existing = list.querySelector("[data-dsh-whale-pet-item]");
					if (existing !== null) {
						paintItem(existing, form, preference);
						continue;
					}
					const contact = accountMenuAnchor(list);
					if (contact === void 0) continue;
					const item = buildItem(contact, form, preference);
					if (item !== void 0) contact.parentElement.after(item);
				}
			};
			// Runs after React commits the opened menu and before the browser paints it.
			const observer = new MutationObserver(scan);
			observer.observe(document.body, { childList: true, subtree: true });
			const unsubscribeForm = form.subscribe(scan);
			const unsubscribeWrite = preference.state.subscribe(scan);
			scan();
			return () => {
				observer.disconnect();
				unsubscribeForm();
				unsubscribeWrite();
				for (const node of document.querySelectorAll("[data-dsh-whale-pet-item]")) node.remove();
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
