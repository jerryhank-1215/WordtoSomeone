(() => {
  "use strict";

  const SUPABASE_URL = "https://tmktgmoqdvsdenffsolt.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I";
  const callbackParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const isPasswordSetupCallback = ["invite", "recovery"].includes(callbackParams.get("type")) ||
    callbackParams.has("access_token") || new URLSearchParams(window.location.search).has("code");

  if (isPasswordSetupCallback) document.body.classList.add("owner-auth-pending");

  if (!window.supabase?.createClient) {
    console.error("[OwnerAuth] Supabase JS did not load.");
    return;
  }

  const authClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const panel = document.getElementById("owner-auth-panel");
  const launch = document.getElementById("owner-auth-launch");
  const form = document.getElementById("owner-auth-form");
  const emailInput = document.getElementById("owner-auth-email");
  const passwordInput = document.getElementById("owner-auth-password");
  const confirmInput = document.getElementById("owner-auth-confirm");
  const status = document.getElementById("owner-auth-status");
  const title = document.getElementById("owner-auth-title");
  const help = document.getElementById("owner-auth-help");
  const submit = document.getElementById("owner-auth-submit");
  let currentSession = null;

  function openPanel() { panel.hidden = false; }
  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove("owner-auth-pending");
  }
  function showPasswordForm(user) {
    currentSession = user;
    title.textContent = "Set your owner password";
    help.textContent = "Choose a password for this website account.";
    emailInput.value = user?.email || "";
    emailInput.readOnly = Boolean(user?.email);
    passwordInput.autocomplete = "new-password";
    confirmInput.hidden = false;
    submit.textContent = "Save password";
    panel.hidden = false;
    status.textContent = "";
  }

  launch.addEventListener("click", async () => {
    status.textContent = "";
    const { data, error } = await authClient.auth.getSession();
    if (error) {
      openPanel();
      status.textContent = error.message;
      return;
    }
    if (data.session?.user) {
      showPasswordForm(data.session.user);
      return;
    }
    title.textContent = "Owner login";
    help.textContent = "Sign in with the email and password you set for this website.";
    emailInput.readOnly = false;
    passwordInput.autocomplete = "current-password";
    confirmInput.hidden = true;
    confirmInput.required = false;
    submit.textContent = "Sign in";
    panel.hidden = false;
  });

  document.getElementById("owner-auth-cancel").addEventListener("click", closePanel);
  panel.addEventListener("click", (event) => { if (event.target === panel) closePanel(); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    submit.disabled = true;
    try {
      if (currentSession) {
        if (passwordInput.value.length < 8) throw new Error("Use at least 8 characters.");
        if (passwordInput.value !== confirmInput.value) throw new Error("The passwords do not match.");
        const { error } = await authClient.auth.updateUser({ password: passwordInput.value });
        if (error) throw error;
        form.reset();
        status.textContent = "Password saved. You can now sign in with your email and password.";
        currentSession = null;
        confirmInput.hidden = true;
        confirmInput.required = false;
        passwordInput.autocomplete = "current-password";
        submit.textContent = "Sign in";
        title.textContent = "Owner login";
        help.textContent = "Your password has been set. Sign in to verify it.";
      } else {
        const { data, error } = await authClient.auth.signInWithPassword({
          email: emailInput.value.trim(),
          password: passwordInput.value
        });
        if (error) throw error;
        form.reset();
        status.textContent = `Signed in as ${data.user.email}.`;
      }
    } catch (error) {
      status.textContent = error.message || "Could not complete authentication.";
    } finally {
      submit.disabled = false;
      passwordInput.value = "";
      confirmInput.value = "";
    }
  });

  (async () => {
    try {
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      if (isPasswordSetupCallback && data.session?.user) {
        showPasswordForm(data.session.user);
        // Remove one-time callback tokens from the visible URL after the SDK consumes them.
        const cleanUrl = new URL(window.location.href);
        cleanUrl.hash = "#/";
        window.history.replaceState({}, document.title, cleanUrl);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else if (isPasswordSetupCallback) {
        panel.hidden = false;
        status.textContent = "The invitation link may have expired or already been used. Ask Supabase to send a new invitation.";
      } else {
        launch.hidden = false;
      }
    } catch (error) {
      panel.hidden = false;
      status.textContent = error.message || "Could not check the sign-in session.";
    } finally {
      document.body.classList.remove("owner-auth-pending");
    }
  })();
})();
