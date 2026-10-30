// Applies a saved colour theme before first paint, and marks the page as
// scripted so the parts that need JavaScript can show. It lives in its own
// file because the site's Content-Security-Policy forbids inline scripts.
document.documentElement.classList.replace("no-js", "js");
try {
	var theme = localStorage.getItem("theme");
	if (theme === "paper" || theme === "ink") document.documentElement.dataset.theme = theme;
} catch (e) {}
