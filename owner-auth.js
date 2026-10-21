(() => {
  "use strict";
  const SUPABASE_URL = "https://tmktgmoqdvsdenffsolt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I";
  const callbackParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const isSetupCallback = ["invite", "recovery"].includes(callbackParams.get("type")) || callbackParams.has("access_token") || new URLSearchParams(location.search).has("code");
  if (isSetupCallback) document.body.classList.add("owner-auth-pending");
  if (!window.supabase?.createClient) { console.error("[OwnerAuth] Supabase JS did not load."); return; }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const panel = document.getElementById("owner-auth-panel");
  const accountEmail = document.getElementById("owner-account-email");
  const openButton = document.getElementById("owner-auth-open");
  const logoutButton = document.getElementById("owner-auth-logout");
  const form = document.getElementById("owner-auth-form");
  const email = document.getElementById("owner-auth-email");
  const password = document.getElementById("owner-auth-password");
  const passwordLabel = document.getElementById("owner-auth-password-label");
  const confirm = document.getElementById("owner-auth-confirm");
  const confirmLabel = document.getElementById("owner-auth-confirm-label");
  const status = document.getElementById("owner-auth-status");
  const title = document.getElementById("owner-auth-title");
  const help = document.getElementById("owner-auth-help");
  const submit = document.getElementById("owner-auth-submit");
  const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
  let mode = "login";
  let setupUser = null;

  function updateAccountBar(user) {
    const signedInUser = user && !user.is_anonymous ? user : null;
    accountEmail.textContent = signedInUser?.email ? `Signed in: ${signedInUser.email}` : "Not signed in";
    openButton.hidden = Boolean(signedInUser);
    logoutButton.hidden = !signedInUser;
  }
  function openPanel() { panel.hidden = false; }
  function closePanel() { panel.hidden = true; document.body.classList.remove("owner-auth-pending"); }
  function setMode(next) {
    mode = next;
    setupUser = null;
    modeButtons.forEach(button => { button.hidden = false; button.setAttribute("aria-pressed", String(button.dataset.authMode === mode)); });
    title.textContent = mode === "register" ? "Create account" : "Login";
    help.textContent = mode === "register" ? "Create an account with your email and password. Registration alone does not grant upload permissions." : "Sign in with your email and password.";
    passwordLabel.textContent = mode === "register" ? "Create password" : "Password";
    password.autocomplete = mode === "register" ? "new-password" : "current-password";
    confirm.hidden = mode !== "register";
    confirmLabel.hidden = mode !== "register";
    confirm.required = mode === "register";
    email.readOnly = false;
    submit.textContent = mode === "register" ? "Register" : "Login";
    status.textContent = "";
  }
  function showPasswordSetup(user) {
    mode = "set-password";
    setupUser = user;
    email.value = user.email || "";
    email.readOnly = Boolean(user.email);
    passwordLabel.textContent = "New password";
    password.autocomplete = "new-password";
    confirm.hidden = false;
    confirmLabel.hidden = false;
    confirm.required = true;
    submit.textContent = "Save password";
    help.textContent = "Invitation verified. Set a password, or use the Login / Register controls.";
    modeButtons.forEach(button => { button.hidden = false; button.setAttribute("aria-pressed", "false"); });
    openPanel();
  }

  openButton.addEventListener("click", () => { setMode("login"); openPanel(); });
  logoutButton.addEventListener("click", async () => { const { error } = await client.auth.signOut(); if (error) status.textContent = error.message; });
  modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.authMode)));
  document.getElementById("owner-auth-cancel").addEventListener("click", closePanel);
  panel.addEventListener("click", event => { if (event.target === panel) closePanel(); });
  client.auth.onAuthStateChange((_event, session) => updateAccountBar(session?.user || null));

  form.addEventListener("submit", async event => {
    event.preventDefault(); status.textContent = ""; submit.disabled = true;
    try {
      if (password.value.length < 8) throw new Error("Please use at least 8 characters.");
      if (mode === "set-password" && setupUser) {
        if (password.value !== confirm.value) throw new Error("The passwords do not match.");
        const { error } = await client.auth.updateUser({ password: password.value });
        if (error) throw error;
        setupUser = null; form.reset(); email.readOnly = false; setMode("login");
        status.textContent = "Password saved. You can now log in with your email and password.";
      } else if (mode === "register") {
        if (password.value !== confirm.value) throw new Error("The passwords do not match.");
        const { data, error } = await client.auth.signUp({ email: email.value.trim(), password: password.value, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        status.textContent = data.session ? "Account created and signed in." : "Registration started. Check your email to confirm the account.";
        form.reset();
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        status.textContent = `Logged in as ${data.user.email}.`;
      }
    } catch (error) { status.textContent = error.message || "Could not complete authentication."; }
    finally { submit.disabled = false; password.value = ""; confirm.value = ""; }
  });

  (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      updateAccountBar(data.session?.user || null);
      if (isSetupCallback && data.session?.user && !data.session.user.is_anonymous) {
        showPasswordSetup(data.session.user);
        const clean = new URL(location.href); clean.searchParams.delete("code"); clean.hash = "#/";
        history.replaceState({}, document.title, clean); window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else if (isSetupCallback) { openPanel(); status.textContent = "No active invitation session was found. The link may have expired or already been used."; }
    } catch (error) { openPanel(); status.textContent = error.message || "Could not check the sign-in session."; }
    finally { document.body.classList.remove("owner-auth-pending"); }
  })();
})();
