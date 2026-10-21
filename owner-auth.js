(() => {
  "use strict";

  const SUPABASE_URL = "https://tmktgmoqdvsdenffsolt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I";
  const callbackParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const callbackType = callbackParams.get("type");
  const isSetupCallback = ["invite", "recovery"].includes(callbackType) || callbackParams.has("access_token") || new URLSearchParams(location.search).has("code");
  if (isSetupCallback) document.body.classList.add("owner-auth-pending");
  if (!window.supabase?.createClient) { console.error("[OwnerAuth] Supabase JS did not load."); return; }

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const panel = document.getElementById("owner-auth-panel");
  const launch = document.getElementById("owner-auth-launch");
  const form = document.getElementById("owner-auth-form");
  const email = document.getElementById("owner-auth-email");
  const password = document.getElementById("owner-auth-password");
  const confirm = document.getElementById("owner-auth-confirm");
  const status = document.getElementById("owner-auth-status");
  const title = document.getElementById("owner-auth-title");
  const help = document.getElementById("owner-auth-help");
  const submit = document.getElementById("owner-auth-submit");
  const passwordLabel = document.getElementById("owner-auth-password-label");
  const modeButtons = [...document.querySelectorAll("[data-auth-mode]")];
  let authenticatedUser = null;
  let mode = "login";

  function open() { panel.hidden = false; }
  function close() { panel.hidden = true; document.body.classList.remove("owner-auth-pending"); }
  function setMode(next) {
    mode = next;
    modeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.authMode === mode)));
    title.textContent = mode === "login" ? "Owner login" : "Create account";
    help.textContent = mode === "login" ? "Sign in with your email and password." : "Create an account with your email and a password. Registration does not grant owner upload permissions.";
    confirm.hidden = mode !== "register";
    confirm.required = mode === "register";
    email.readOnly = false;
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    passwordLabel.textContent = mode === "login" ? "Password" : "Create password";
    submit.textContent = mode === "login" ? "Login" : "Register";
    status.textContent = "";
  }
  function showPasswordSetup(user) {
    authenticatedUser = user;
    modeButtons.forEach(button => button.hidden = true);
    title.textContent = "Set your password";
    help.textContent = "Your invitation is verified. Choose a password for this website account.";
    email.value = user.email || "";
    email.readOnly = Boolean(user.email);
    password.autocomplete = "new-password";
    confirm.hidden = false;
    confirm.required = true;
    submit.textContent = "Save password";
    open();
  }

  modeButtons.forEach(button => button.addEventListener("click", () => setMode(button.dataset.authMode)));
  launch.addEventListener("click", async () => {
    status.textContent = "";
    const { data, error } = await client.auth.getSession();
    if (error) { open(); status.textContent = error.message; return; }
    if (data.session?.user && !data.session.user.is_anonymous) { showPasswordSetup(data.session.user); return; }
    modeButtons.forEach(button => button.hidden = false);
    setMode("login");
    open();
  });
  document.getElementById("owner-auth-cancel").addEventListener("click", close);
  panel.addEventListener("click", event => { if (event.target === panel) close(); });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    status.textContent = "";
    submit.disabled = true;
    try {
      if (password.value.length < 8) throw new Error("Please use at least 8 characters.");
      if (authenticatedUser) {
        if (password.value !== confirm.value) throw new Error("The passwords do not match.");
        const { error } = await client.auth.updateUser({ password: password.value });
        if (error) throw error;
        authenticatedUser = null;
        form.reset();
        email.readOnly = false;
        modeButtons.forEach(button => button.hidden = false);
        setMode("login");
        status.textContent = "Password saved. You can now log in with your email and password.";
      } else if (mode === "register") {
        if (password.value !== confirm.value) throw new Error("The passwords do not match.");
        const { data, error } = await client.auth.signUp({ email: email.value.trim(), password: password.value, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
        if (error) throw error;
        status.textContent = data.session ? "Account created and signed in." : "Registration started. Check your email to confirm the account.";
        form.reset();
      } else {
        const { data, error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        status.textContent = `Logged in as ${data.user.email}.`;
      }
    } catch (error) {
      status.textContent = error.message || "Could not complete authentication.";
    } finally {
      submit.disabled = false;
      password.value = "";
      confirm.value = "";
    }
  });

  (async () => {
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (isSetupCallback && data.session?.user) {
        showPasswordSetup(data.session.user);
        const clean = new URL(location.href);
        clean.searchParams.delete("code");
        clean.hash = "#/";
        history.replaceState({}, document.title, clean);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else if (isSetupCallback) {
        modeButtons.forEach(button => button.hidden = true);
        open();
        status.textContent = "No active invitation session was found. The link may have expired or already been used; request a new invitation.";
      } else {
        launch.hidden = false;
      }
    } catch (error) {
      open();
      status.textContent = error.message || "Could not check the sign-in session.";
    } finally {
      document.body.classList.remove("owner-auth-pending");
    }
  })();
})();
