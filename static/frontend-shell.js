const shellElements = {
  authView: document.getElementById("auth-view"),
  dashboardView: document.getElementById("dashboard-view"),
  loginTab: document.getElementById("login-tab"),
  registerTab: document.getElementById("register-tab"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  previewDashboardButton: document.getElementById("preview-dashboard"),
  logoutButton: document.getElementById("logout-button"),
  welcomeTitle: document.getElementById("welcome-title"),
};

function initializeFrontendShell() {
  attachShellEvents();
  showLoginView();
}

function attachShellEvents() {
  shellElements.loginTab.addEventListener("click", showLoginView);
  shellElements.registerTab.addEventListener("click", showRegisterView);
  shellElements.loginForm.addEventListener("submit", handleLoginSubmit);
  shellElements.registerForm.addEventListener("submit", handleRegisterSubmit);
  shellElements.previewDashboardButton.addEventListener("click", showDashboardView);
  shellElements.logoutButton.addEventListener("click", handleLogout);
}

function showLoginView() {
  shellElements.loginTab.classList.add("active");
  shellElements.registerTab.classList.remove("active");
  shellElements.loginForm.classList.remove("hidden");
  shellElements.registerForm.classList.add("hidden");
  shellElements.authView.classList.remove("hidden");
  shellElements.dashboardView.classList.add("hidden");
  shellElements.logoutButton.classList.add("hidden");
  shellElements.welcomeTitle.textContent = "Sign in to continue";
}

function showRegisterView() {
  shellElements.loginTab.classList.remove("active");
  shellElements.registerTab.classList.add("active");
  shellElements.loginForm.classList.add("hidden");
  shellElements.registerForm.classList.remove("hidden");
}

function showDashboardView() {
  shellElements.authView.classList.add("hidden");
  shellElements.dashboardView.classList.remove("hidden");
  shellElements.logoutButton.classList.remove("hidden");
  shellElements.welcomeTitle.textContent = "Frontend preview dashboard";
}

function handleLoginSubmit(event) {
  event.preventDefault();
  showDashboardView();
}

function handleRegisterSubmit(event) {
  event.preventDefault();
  showDashboardView();
}

function handleLogout() {
  showLoginView();
}

function pullPredictionsPlaceholder() {
  // TODO: fetch predictions from backend or another source.
}

function renderPredictionsPlaceholder() {
  // TODO: render pulled prediction data into the market list.
}

function createPredictionPlaceholder() {
  // TODO: submit a new prediction using the create market form.
}

function placeBetPlaceholder() {
  // TODO: handle bet submission for any supported market type.
}

function handleYesNoBetPlaceholder() {
  // TODO: place a bet on the Yes/No side of a market.
}

function handleHighLowBetPlaceholder() {
  // TODO: place a bet on the High/Low side of a market.
}

function refreshBalancePlaceholder() {
  // TODO: refresh wallet balance and open position totals.
}

initializeFrontendShell();
