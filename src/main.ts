import "./style.css";
import snapshot from "./github-snapshot.json";
import { OUTPUTS, type Line } from "./outputs.ts";
import type { GitHubData, Release, Repo } from "./types.ts";

// ---------------------------------------------------------------- helpers
type Child = Node | string | null | undefined | false;

function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "class") el.className = v;
		else el.setAttribute(k, v);
	}
	for (const c of children) if (c) el.append(c);
	return el;
}

const $ = (id: string) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = window.matchMedia("(max-width: 1023px)");
const utcDay = (iso: string) => iso.slice(0, 10);
const utcTime = (iso: string) => iso.slice(11, 16);
const longDay = (iso: string) =>
	new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const bytes = (n: number) => `${n.toLocaleString("en-GB")} bytes`;

function ago(iso: string): string {
	const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
	const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"]];
	for (const [size, name] of units) {
		const n = Math.floor(seconds / size);
		if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
	}
	return "just now";
}

function listing(lines: Line[]): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const segs of lines) {
		const line = h("span", { class: "ln" });
		for (const [text, cls] of segs) line.append(cls ? h("span", { class: `o-${cls}` }, text) : text);
		frag.append(line);
	}
	return frag;
}

/** The first sentence of a release note, without Markdown emphasis. */
function firstSentence(text: string): string {
	const plain = text.replace(/\*\*|__|`/g, "").trim();
	const cut = plain.search(/[.!?](\s|$)/);
	return cut > 0 ? plain.slice(0, cut + 1) : plain;
}

// ------------------------------------------------------------------ theme
function initTheme() {
	const root = document.documentElement;
	const button = $("theme") as HTMLButtonElement | null;
	if (!button) return;
	// Ink is the site's default; paper is the visitor's choice, remembered.
	const current = () => root.dataset.theme ?? "ink";
	const sync = () => {
		const next = current() === "ink" ? "paper" : "ink";
		button.textContent = next === "ink" ? "Dark" : "Light";
		button.setAttribute("aria-label", `Switch to the ${next === "ink" ? "dark" : "light"} theme`);
	};
	button.addEventListener("click", () => {
		const theme = current() === "ink" ? "paper" : "ink";
		root.dataset.theme = theme;
		try { localStorage.setItem("theme", theme); } catch { /* private mode */ }
		sync();
	});
	sync();
}

// ------------------------------------------------- hero: the words rise once
function introHero() {
	const title = document.querySelector<HTMLElement>(".hero h1");
	const hero = document.querySelector<HTMLElement>(".hero");
	if (!title || !hero || reduceMotion) return;
	const words = (title.textContent ?? "").split(/\s+/).filter(Boolean);
	title.setAttribute("aria-label", words.join(" "));
	title.replaceChildren(...words.flatMap((w, i) => {
		const inner = h("span", {}, w.replace(/ /g, " "));
		inner.style.setProperty("--i", String(i));
		const word = h("span", { class: "h-word", "aria-hidden": "true" }, inner);
		return i < words.length - 1 ? [word, " "] : [word];
	}));
	hero.querySelectorAll<HTMLElement>(".hero-text > *, .dies").forEach((el, i) => el.style.setProperty("--i", String(i)));
	hero.classList.add("is-loading");
	// A timer rather than requestAnimationFrame: frames don't run in a background tab, timers still do.
	window.setTimeout(() => hero.classList.remove("is-loading"), 40);
}

// --------------------------------------- hero picture: the x86 line, slowly
function initDies() {
	const frame = document.querySelector<HTMLElement>(".dies-frame");
	const caption = $("dies-caption");
	const credit = $("dies-credit") as HTMLAnchorElement | null;
	if (!frame || !caption || !credit || reduceMotion) return;
	const pictures = [...frame.querySelectorAll<HTMLImageElement>("img")];
	let at = 0;
	let timer = 0;
	let visible = true;
	const show = (i: number) => {
		pictures[at].classList.remove("is-on");
		at = i;
		const pic = pictures[at];
		pic.loading = "eager";
		pic.classList.add("is-on");
		caption.textContent = pic.dataset.caption ?? "";
		credit.href = pic.dataset.src ?? credit.href;
	};
	const tick = () => show((at + 1) % pictures.length);
	const run = () => {
		window.clearInterval(timer);
		if (visible && !document.hidden) timer = window.setInterval(tick, 5600);
	};
	// Warm the next pictures once the first has painted.
	window.addEventListener("load", () => pictures.forEach((p) => { p.loading = "eager"; }), { once: true });
	document.addEventListener("visibilitychange", run);
	new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(frame);
}

// -------------------------------------------------------- tools + preview
interface Tool { lang: string; url: string; highlight: string }
const TOOLS: Record<string, Tool> = {
	"unwind-map": { lang: "Rust", url: "https://github.com/sheratonc/unwind-map", highlight: "Recovers function boundaries from stripped Linux ELF binaries using the .eh_frame unwind tables. In my tests it found every function that has unwind info without a false start, and its output goes straight back into objcopy to give a stripped binary its symbols again." },
	"pe-walker": { lang: "C++", url: "https://github.com/sheratonc/pe-walker", highlight: "Headers, sections, imports and exports of any PE file, read on Windows, Linux or macOS." },
	"pe-diff": { lang: "C++", url: "https://github.com/sheratonc/pe-diff", highlight: "Shows what changed between two builds and exits 1 when anything did, so it can gate a CI pipeline." },
	"rtti-dump": { lang: "C++", url: "https://github.com/sheratonc/rtti-dump", highlight: "Rebuilds inheritance trees from stripped MSVC binaries and can write them out as Mermaid class diagrams." },
	"vtable-dump": { lang: "C++", url: "https://github.com/sheratonc/vtable-dump", highlight: "Finds every vtable through its RTTI back-reference and lists the code in each slot. It pairs with rtti-dump." },
	"pattern-scan": { lang: "C++", url: "https://github.com/sheratonc/pattern-scan", highlight: "A single header for IDA-style byte signatures, plus the patscan command-line tool. It came out about 11× faster than a byte-by-byte scan in my benchmark." },
	Panda: { lang: "Electron", url: "https://github.com/sheratonc/Panda", highlight: "A Windows app that reads each launcher’s own files to list games from Steam, Epic, GOG, Ubisoft, EA, Battle.net, Riot and Rockstar in one Steam-style library, then hands launching back to the real client." },
	"opencode-discord-rpc": { lang: "JavaScript", url: "https://github.com/sheratonc/opencode-discord-rpc", highlight: "Shows your model, project and live context size in Discord while you code with OpenCode V2. It talks to Discord’s local IPC pipe directly, so there are no dependencies and no build step." },
};
const repos = new Map<string, Repo>();

function renderPreview(name: string) {
	const pane = $("preview");
	const tool = TOOLS[name];
	if (!pane || !tool) return;
	const repo = repos.get(name);
	const latest = repo?.releases[0];
	const meta: Child[] = [tool.lang];
	if (repo) {
		meta.push(", ", latest ? h("a", { href: latest.url }, latest.tag) : "no release yet", `, updated ${ago(repo.pushed)}`);
	}
	const out = OUTPUTS[name];
	const parts: Child[] = [
		h("header", { class: "preview-head" }, h("h3", {}, name), h("p", { class: "preview-meta" }, ...meta)),
		h("p", { class: "preview-desc" }, tool.highlight),
		out ? h("pre", { class: "term", "data-ui": "", tabindex: "0", "aria-label": `${name}: a real run` }, listing(out)) : null,
		h("p", { class: "preview-foot" },
			h("span", {}, name === "Panda" || name === "opencode-discord-rpc" ? "What its README documents." : "A real run on its test binaries."),
			h("a", { href: tool.url }, "Source on GitHub"),
		),
	];
	pane.replaceChildren(...parts.filter((c): c is Node => Boolean(c)));
}

function initTools() {
	const ledger = $("ledger");
	const pane = $("preview");
	const grid = document.querySelector<HTMLElement>(".tools-grid");
	if (!ledger || !pane || !grid) return;
	// Each row becomes a button that shows its tool; without script, rows stay links to GitHub.
	const rows = [...ledger.querySelectorAll<HTMLAnchorElement>("a.row")].map((a) => {
		const b = h("button", { class: "row", type: "button", "data-tool": a.dataset.tool ?? "", "aria-controls": "preview", "aria-pressed": "false" });
		b.append(...a.childNodes);
		a.replaceWith(b);
		return b as HTMLButtonElement;
	});
	let current = "";
	const place = () => {
		const row = rows.find((r) => r.dataset.tool === current);
		if (narrow.matches && row) row.after(pane);
		else if (pane.parentElement !== grid) grid.append(pane);
	};
	const select = (name: string, focus = false) => {
		if (name === current) return;
		current = name;
		for (const r of rows) {
			const on = r.dataset.tool === name;
			r.classList.toggle("is-on", on);
			r.setAttribute("aria-pressed", String(on));
			if (on && focus) r.focus();
		}
		renderPreview(name);
		place();
	};
	rows.forEach((r, i) => {
		const name = r.dataset.tool!;
		r.addEventListener("click", () => select(name));
		r.addEventListener("focus", () => { if (!narrow.matches) select(name); });
		r.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !narrow.matches) select(name); });
		r.addEventListener("keydown", (e) => {
			const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
			if (!step) return;
			e.preventDefault();
			const next = rows[(i + step + rows.length) % rows.length];
			if (narrow.matches) next.focus(); else select(next.dataset.tool!, true);
		});
	});
	narrow.addEventListener("change", place);
	select("unwind-map");
}

// ------------------------------------------------ the map, as an instrument
const MIN_SIZES = [0, 64, 128, 256, 512, 1024, 2048, 4096];
interface Fn { el: SVGGeometryElement; name: string; start: number; startHex: string; endHex: string; size: number; kind: string }

async function initMap() {
	const plate = $("plate");
	const readout = $("readout");
	if (!plate || !readout) return;
	let svg: SVGSVGElement;
	try {
		const text = await (await fetch("/fig-unwind-map.svg")).text();
		const doc = new DOMParser().parseFromString(text, "image/svg+xml");
		if (doc.documentElement.nodeName !== "svg") return;
		svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
	} catch {
		return; // the <img> already in the plate stays as the fallback
	}
	svg.classList.add("fig-svg");
	svg.setAttribute("aria-hidden", "true");
	svg.removeAttribute("role");

	// Small functions are drawn as dots with a <title>; give them the same data as the traces.
	for (const c of svg.querySelectorAll<SVGCircleElement>("circle")) {
		const title = c.querySelector("title");
		const m = title?.textContent?.match(/^(\S+) (0x[0-9a-f]+)-(0x[0-9a-f]+) \((\d+) bytes\)/i);
		title?.remove();
		if (m) c.dataset.f = `${m[1]}|${m[2]}|${m[3]}|${m[4]}|f`;
	}
	const all: Fn[] = [...svg.querySelectorAll<SVGGeometryElement>("[data-f]")].map((el) => {
		const [name, startHex, endHex, size, kind] = (el.dataset.f ?? "").split("|");
		if (kind === "g") el.classList.add("is-gap");
		return { el, name, start: parseInt(startHex, 16) || 0, startHex, endHex, size: Number(size) || 0, kind };
	});
	const fns = all.filter((f) => f.kind === "f" || f.kind === "l").sort((a, b) => a.start - b.start);
	plate.replaceChildren(svg);

	// Hovering lifts one trace out of the map with a dark outline.
	const overlay = document.createElementNS(SVGNS, "g");
	overlay.setAttribute("class", "fig-overlay");
	const halo = document.createElementNS(SVGNS, "polyline");
	halo.setAttribute("class", "fig-halo");
	const lift = document.createElementNS(SVGNS, "polyline");
	lift.setAttribute("class", "fig-lift");
	const dot = document.createElementNS(SVGNS, "circle");
	overlay.append(halo, lift, dot);
	svg.append(overlay);

	const idle = readout.textContent ?? "";
	let hot: Fn | null = null;
	const show = (f: Fn | null) => {
		hot = f;
		if (!f) {
			overlay.classList.remove("on");
			readout.textContent = idle;
			return;
		}
		const isDot = f.el instanceof SVGCircleElement;
		const points = isDot ? "" : f.el.getAttribute("points") ?? "";
		halo.setAttribute("points", points);
		lift.setAttribute("points", points);
		lift.setAttribute("stroke", f.el.getAttribute("stroke") ?? "#fff");
		if (isDot) {
			dot.setAttribute("cx", f.el.getAttribute("cx") ?? "0");
			dot.setAttribute("cy", f.el.getAttribute("cy") ?? "0");
			dot.setAttribute("r", "1.4");
			dot.setAttribute("fill", f.el.getAttribute("fill") ?? "#fff");
		} else dot.setAttribute("r", "0");
		overlay.classList.add("on");
		const what = f.kind === "u" ? "Past the end of the code"
			: f.kind === "g" ? `No unwind info, ${f.startHex}–${f.endHex}, ${bytes(f.size)}`
			: null;
		readout.replaceChildren(...(what
			? [h("b", {}, what)]
			: [h("b", {}, f.name), ` ${f.startHex}–${f.endHex}, ${bytes(f.size)}${f.kind === "l" ? ", has landing pads" : ""}`]));
	};

	// The traces are thin, so pointing goes by grid cell: every cell of the 128 × 128 curve belongs to one trace.
	const SIDE = 128;
	const cells: (Fn | undefined)[] = new Array(SIDE * SIDE);
	const claim = (x: number, y: number, f: Fn) => {
		if (x >= 0 && y >= 0 && x < SIDE && y < SIDE) cells[Math.floor(y) * SIDE + Math.floor(x)] = f;
	};
	for (const f of all) {
		if (f.el instanceof SVGCircleElement) { claim(Number(f.el.getAttribute("cx")), Number(f.el.getAttribute("cy")), f); continue; }
		const pts = (f.el.getAttribute("points") ?? "").trim().split(/\s+/).map((p) => p.split(",").map(Number));
		for (let i = 0; i < pts.length; i++) {
			const [x1, y1] = pts[i];
			const [x0, y0] = pts[i - 1] ?? pts[i];
			const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
			for (let s = 0; s <= steps; s++) claim(x0 + ((x1 - x0) * s) / (steps || 1), y0 + ((y1 - y0) * s) / (steps || 1), f);
		}
	}
	const cellAt = (e: PointerEvent): Fn | undefined => {
		const r = svg.getBoundingClientRect();
		const x = Math.floor(((e.clientX - r.left) / r.width) * SIDE);
		const y = Math.floor(((e.clientY - r.top) / r.height) * SIDE);
		const f = x >= 0 && y >= 0 && x < SIDE && y < SIDE ? cells[y * SIDE + x] : undefined;
		return f && !f.el.classList.contains("is-dim") ? f : undefined;
	};
	const point = (e: PointerEvent) => {
		const f = cellAt(e);
		if (f && f !== hot) show(f);
	};
	svg.addEventListener("pointermove", point);
	svg.addEventListener("pointerdown", point);
	svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") show(null); });

	// The filters dim what they leave out; the arrow keys step through what's left.
	const range = $("min-size") as HTMLInputElement | null;
	const rangeOut = $("min-size-value");
	const onlyLp = $("only-lp") as HTMLInputElement | null;
	const gaps = $("show-gaps") as HTMLInputElement | null;
	const count = $("shown-count");
	const visible = () => fns.filter((f) => !f.el.classList.contains("is-dim"));
	const apply = () => {
		const min = MIN_SIZES[Number(range?.value ?? 0)];
		const lp = onlyLp?.checked ?? false;
		let n = 0;
		for (const f of fns) {
			const out = f.size < min || (lp && f.kind !== "l");
			f.el.classList.toggle("is-dim", out);
			if (!out) n++;
		}
		// While a filter is on, the code that isn't a function steps back too, unless it's being marked.
		for (const f of all) if (f.kind === "g" || f.kind === "u") f.el.classList.toggle("is-dim", (min > 0 || lp) && !(gaps?.checked ?? false));
		const label = min ? `${bytes(min)} or more` : "Any size";
		if (rangeOut) rangeOut.textContent = label;
		range?.setAttribute("aria-valuetext", label);
		if (count) count.textContent = min || lp ? `${n} function${n === 1 ? "" : "s"}` : "All 578";
		svg.classList.toggle("gaps-on", gaps?.checked ?? false);
		if (hot && hot.el.classList.contains("is-dim")) show(null);
	};
	range?.addEventListener("input", apply);
	onlyLp?.addEventListener("change", apply);
	gaps?.addEventListener("change", () => {
		apply();
		const gap = all.find((f) => f.kind === "g" && f.size > 100);
		if (gaps.checked && gap) show(gap);
		else if (!gaps.checked && hot?.kind === "g") show(null);
	});
	apply();

	plate.addEventListener("keydown", (e) => {
		const list = visible();
		if (!list.length) return;
		const at = hot ? list.indexOf(hot) : -1;
		let next = -2;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = at + 1 >= list.length ? 0 : at + 1;
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = at <= 0 ? list.length - 1 : at - 1;
		else if (e.key === "PageDown") next = Math.min(list.length - 1, at + 10);
		else if (e.key === "PageUp") next = Math.max(0, at - 10);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = list.length - 1;
		else if (e.key === "Escape") { show(null); return; }
		if (next < -1) return;
		e.preventDefault();
		show(list[next]);
	});

	// Trace the curve like a pen, in address order, the first time the map comes into view.
	if (reduceMotion) return;
	const traces = [...svg.querySelectorAll<SVGPolylineElement>("polyline")].filter((t) => !overlay.contains(t));
	const lens = traces.map((t) => (t.getAttribute("points") ?? "").trim().split(/\s+/).length);
	const total = lens.reduce((a, b) => a + b, 0);
	for (const t of traces) { t.setAttribute("pathLength", "1"); t.style.strokeDasharray = "0 1"; }
	const io = new IntersectionObserver(([e]) => {
		if (!e.isIntersecting) return;
		io.disconnect();
		const T = 1900;
		let acc = 0;
		const drawing = traces.map((t, i) => {
			const a = t.animate(
				[{ strokeDasharray: "0 1" }, { strokeDasharray: "1 0" }],
				{ duration: Math.max(12, (lens[i] / total) * T), delay: 120 + (acc / total) * T, easing: "linear", fill: "both" },
			);
			acc += lens[i];
			a.finished.then(() => { a.cancel(); t.style.strokeDasharray = ""; }).catch(() => {});
			return a;
		});
		svg.addEventListener("pointerenter", () => drawing.forEach((a) => a.finish()), { once: true });
	}, { threshold: 0.35 });
	io.observe(plate);
}

// -------------------------------------------------------- releases + month
type Rel = Release & { repo: string };

function renderReleases(rels: Rel[]) {
	const list = $("rel-list");
	if (!list || !rels.length) return;
	const shown = rels.slice(0, 14);
	const days = new Map<string, Rel[]>();
	for (const r of shown) days.set(utcDay(r.date), [...(days.get(utcDay(r.date)) ?? []), r]);
	list.replaceChildren(...[...days].flatMap(([d, items]) => [
		h("h3", { class: "group" }, h("time", { datetime: d }, longDay(items[0].date))),
		h("ul", {}, ...items.map((r, i) => h("li", {},
			h("a", { href: r.url },
				h("span", { class: `dot${r.repo === "Panda" ? " dot-panda" : TOOLS[r.repo]?.lang === "JavaScript" ? " dot-js" : ""}`, "aria-hidden": "true" }),
				h("span", { class: "rel-name" }, `${r.repo} ${r.tag}`),
				// A note repeated word for word on the same day is shown once.
				r.summary && (i === 0 || firstSentence(items[i - 1].summary) !== firstSentence(r.summary))
					? h("span", { class: "rel-note" }, firstSentence(r.summary)) : null,
			),
			h("time", { datetime: r.date }, utcTime(r.date)),
		))),
	]));
	revealRows(list);
}

function renderCalendar(rels: Rel[]) {
	const fig = $("calendar");
	if (!fig || !rels.length) return;
	const month = rels[0].date.slice(0, 7);
	const inMonth = rels.filter((r) => r.date.startsWith(month));
	const perDay = new Map<number, number>();
	for (const r of inMonth) perDay.set(Number(r.date.slice(8, 10)), (perDay.get(Number(r.date.slice(8, 10))) ?? 0) + 1);
	const [y, m] = month.split("-").map(Number);
	const first = new Date(Date.UTC(y, m - 1, 1));
	const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const lead = (first.getUTCDay() + 6) % 7; // Monday first
	const monthName = first.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
	const peak = [...perDay].sort((a, b) => b[1] - a[1])[0];

	const cells: HTMLElement[] = [];
	for (let i = 0; i < lead; i++) cells.push(h("td", { class: "out" }));
	for (let d = 1; d <= daysIn; d++) {
		const n = perDay.get(d) ?? 0;
		const label = `${d} ${monthName}${n ? `: ${n} release${n > 1 ? "s" : ""}` : ""}`;
		cells.push(n
			? h("td", { class: d === peak[0] ? "has peak" : "has", "aria-label": label }, String(d), h("b", { "aria-hidden": "true" }, String(n)))
			: h("td", { "aria-label": label }, String(d)));
	}
	while (cells.length % 7) cells.push(h("td", { class: "out" }));
	const weeks: HTMLElement[] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(h("tr", {}, ...cells.slice(i, i + 7)));

	const total = inMonth.length;
	const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
	const caption = `${total} release${total > 1 ? "s" : ""} in ${monthName}` +
		(peak && peak[1] > 1 && peak[1] < total ? `, ${peak[1]} of them on the ${ord(peak[0])}.` : ".");

	fig.replaceChildren(
		h("h3", { id: "calendar-title" }, `${monthName} ${y}`),
		h("table", {},
			h("thead", {}, h("tr", {}, ...["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("th", { scope: "col" }, d)))),
			h("tbody", {}, ...weeks)),
		h("figcaption", {}, caption),
	);
	if (reduceMotion) return;
	fig.classList.add("is-waiting");
	fig.querySelectorAll<HTMLElement>("td.has").forEach((td, i) => { td.style.transitionDelay = `${200 + i * 160}ms`; });
	const io = new IntersectionObserver(([e]) => {
		if (!e.isIntersecting) return;
		io.disconnect();
		fig.classList.remove("is-waiting");
	}, { threshold: 0.4 });
	io.observe(fig);
}

function render(data: GitHubData) {
	repos.clear();
	for (const r of data.repos) repos.set(r.name, r);
	const current = document.querySelector<HTMLElement>(".row.is-on")?.dataset.tool;
	if (current) renderPreview(current);

	const rels: Rel[] = data.repos.flatMap((r) => r.releases.map((rel) => ({ repo: r.name, ...rel })))
		.sort((a, b) => b.date.localeCompare(a.date));
	renderReleases(rels);
	renderCalendar(rels);

	const latest = $("latest");
	if (latest && rels[0]) {
		latest.replaceChildren("Latest release: ", h("a", { href: rels[0].url }, `${rels[0].repo} ${rels[0].tag}`), `, ${ago(rels[0].date)}`);
	}
	const note = $("source-note");
	if (note) note.textContent = data.source === "live"
		? `Fetched ${ago(data.fetchedAt)}; times are UTC.`
		: `This is a saved copy from ${longDay(data.fetchedAt)}, as the live API is busy; times are UTC.`;
}

async function loadProjects() {
	try {
		const res = await fetch("/api/github");
		if (!res.ok) throw new Error(String(res.status));
		render((await res.json()) as GitHubData);
	} catch {
		render({ ...(snapshot as GitHubData), source: "snapshot" });
	}
}

// ------------------------------------------------------------ navigation
function initNav() {
	const links = new Map([...document.querySelectorAll<HTMLAnchorElement>(".nav a")].map((a) => [a.hash.slice(1), a]));
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			for (const [id, a] of links) a.classList.toggle("is-here", id === e.target.id);
		}
	}, { rootMargin: "-45% 0px -50% 0px" });
	for (const id of links.keys()) { const s = $(id); if (s) io.observe(s); }
}

// ------------------------------------------------- entrances, in reading order
let rowObserver: IntersectionObserver | null = null;

function revealRows(root: HTMLElement) {
	if (!rowObserver) return;
	root.querySelectorAll<HTMLElement>("ul").forEach((ul) => {
		ul.querySelectorAll<HTMLElement>(":scope > li").forEach((li, i) => {
			li.classList.add("rv-row");
			li.style.setProperty("--i", String(Math.min(i, 10)));
		});
		rowObserver!.observe(ul);
	});
}

function initReveal() {
	if (reduceMotion || !("IntersectionObserver" in window)) return;
	const io = new IntersectionObserver((entries) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			e.target.classList.add("in");
			e.target.querySelectorAll(".rv-row").forEach((r) => r.classList.add("in"));
			io.unobserve(e.target);
		}
	}, { rootMargin: "0px 0px -10% 0px" });
	rowObserver = io;
	const groups = [
		".tools .sec-head > *", ".preview",
		".map .sec-head > *", ".instrument",
		".releases .sec-head > *", ".calendar",
		".letter > *",
		".contact-row > *",
	];
	for (const sel of groups) {
		document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
			el.classList.add("rv");
			el.style.setProperty("--i", String(i));
			io.observe(el);
		});
	}
	revealRows($("ledger")!);
	revealRows($("rel-list")!);
}

// ------------------------------------------------------------------- boot
$("year")!.textContent = String(new Date().getFullYear());
initTheme();
introHero();
initDies();
initTools();
initReveal();
initNav();
initMap();
loadProjects();
