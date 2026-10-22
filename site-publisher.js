(() => {
  "use strict";
  const OWNER_EMAIL = "jerryandhank1215@gmail.com";
  const ARTICLE_TABLE = "site_articles";
  const IMAGE_BUCKET = "site-article-images";
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const supabaseClient = window.annotationSupabaseClient || window.supabase.createClient(
    "https://tmktgmoqdvsdenffsolt.supabase.co",
    "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I"
  );

  const accountEmail = document.getElementById("owner-account-email");
  const authOpen = document.getElementById("owner-auth-open");
  const logoutButton = document.getElementById("owner-auth-logout");
  const uploadOpen = document.getElementById("article-upload-open");
  const authDialog = document.getElementById("owner-auth-dialog");
  const authForm = document.getElementById("owner-auth-form");
  const authStatus = document.getElementById("owner-auth-status");
  const authModes = [...document.querySelectorAll("[data-auth-mode]")];
  const authEmail = document.getElementById("owner-auth-email");
  const authPassword = document.getElementById("owner-auth-password");
  const authConfirm = document.getElementById("owner-auth-confirm");
  const authConfirmLabel = document.getElementById("owner-auth-confirm-label");
  const authTitle = document.getElementById("owner-auth-title");
  const authHelp = document.getElementById("owner-auth-help");
  const authSubmit = document.getElementById("owner-auth-submit");
  const setPasswordLabel = document.getElementById("owner-auth-password-label");
  const accountDetails = document.getElementById("owner-auth-account-details");
  const uploadDialog = document.getElementById("article-upload-dialog");
  const uploadForm = document.getElementById("article-upload-form");
  const uploadStatus = document.getElementById("article-upload-status");
  let authMode = "login";
  let inviteUser = null;
  let currentUser = null;

  function isSiteOwner(user) {
    return Boolean(user && !user.is_anonymous && user.email?.toLowerCase() === OWNER_EMAIL);
  }
  function updateAccount(user) {
    const verifiedUser = user && !user.is_anonymous ? user : null;
    accountEmail.textContent = verifiedUser?.email || "Not signed in";
    authOpen.textContent = verifiedUser ? "Account" : "Login / Register";
    authOpen.hidden = false;
    logoutButton.hidden = !verifiedUser;
    uploadOpen.hidden = !isSiteOwner(verifiedUser);
    renderArticleMenu();
  }
  function openAuth() {
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) { authStatus.textContent = error.message; }
      if (data?.session?.user && !data.session.user.is_anonymous) {
        authMode = "account";
        authTitle.textContent = "Account";
        authHelp.textContent = isSiteOwner(data.session.user) ? "You are signed in as the site owner." : "You are signed in.";
        authModes.forEach(button => button.hidden = true);
        authForm.hidden = true;
        accountDetails.hidden = false;
        accountDetails.textContent = data.session.user.email || "Signed in";
      } else {
        setAuthMode("login");
      }
      authDialog.showModal();
    }).catch(error => { authStatus.textContent = error.message; authDialog.showModal(); });
  }
  function setAuthMode(mode) {
    authMode = mode;
    inviteUser = null;
    authForm.hidden = false;
    accountDetails.hidden = true;
    authModes.forEach(button => {
      button.hidden = false;
      button.setAttribute("aria-pressed", String(button.dataset.authMode === mode));
    });
    authTitle.textContent = mode === "register" ? "Create account" : "Login";
    authHelp.textContent = mode === "register"
      ? "Create an account with email and password. Registration alone does not grant publishing access."
      : "Sign in with your email and password.";
    setPasswordLabel.textContent = mode === "register" ? "Create password" : "Password";
    authPassword.autocomplete = mode === "register" ? "new-password" : "current-password";
    authEmail.readOnly = false;
    authConfirm.hidden = mode !== "register";
    authConfirmLabel.hidden = mode !== "register";
    authConfirm.required = mode === "register";
    authSubmit.textContent = mode === "register" ? "Register" : "Login";
    authStatus.textContent = "";
  }
  authOpen.addEventListener("click", openAuth);
  logoutButton.addEventListener("click", async () => {
    const { error } = await supabaseClient.auth.signOut();
    if (error) authStatus.textContent = error.message;
  });
  authModes.forEach(button => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
  authForm.addEventListener("submit", async event => {
    event.preventDefault();
    authStatus.textContent = "";
    authSubmit.disabled = true;
    try {
      if (authMode === "set-password") {
        if (!inviteUser) throw new Error("The invitation session expired. Open the invitation link again.");
        if (authPassword.value !== authConfirm.value) throw new Error("The passwords do not match.");
        const { data, error } = await supabaseClient.auth.updateUser({ password: authPassword.value });
        if (error) throw error;
        updateAccount(data.user);
        authStatus.textContent = "Password saved. You can now publish articles.";
        setTimeout(() => authDialog.close(), 700);
        return;
      }
      if (authPassword.value.length < 8) throw new Error("Use a password with at least 8 characters.");
      if (authMode === "register" && authPassword.value !== authConfirm.value) throw new Error("The passwords do not match.");
      const result = authMode === "register"
        ? await supabaseClient.auth.signUp({ email: authEmail.value.trim(), password: authPassword.value, options: { emailRedirectTo: location.origin + location.pathname } })
        : await supabaseClient.auth.signInWithPassword({ email: authEmail.value.trim(), password: authPassword.value });
      if (result.error) throw result.error;
      if (authMode === "register" && !result.data.session) authStatus.textContent = "Registration started. Check your email to confirm the account.";
      else {
        authStatus.textContent = authMode === "register" ? "Account created." : `Logged in as ${result.data.user.email}.`;
        setTimeout(() => authDialog.close(), 500);
      }
    } catch (error) { authStatus.textContent = error.message || "Authentication failed."; }
    finally { authSubmit.disabled = false; authPassword.value = ""; authConfirm.value = ""; }
  });
  document.getElementById("owner-auth-close").addEventListener("click", () => authDialog.close());

  const callbackParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const isInviteCallback = ["invite", "recovery"].includes(callbackParams.get("type")) || callbackParams.has("access_token");
  (async () => {
    try {
      const { data } = await supabaseClient.auth.getSession();
      currentUser = data?.session?.user || null;
      updateAccount(currentUser);
      if (isInviteCallback && data?.session?.user && !data.session.user.is_anonymous) {
        inviteUser = data.session.user;
        authMode = "set-password";
        authTitle.textContent = "Set your password";
        authHelp.textContent = "Your invitation is confirmed. Set a password to finish setup.";
        authEmail.value = inviteUser.email || "";
        authEmail.readOnly = Boolean(inviteUser.email);
        authConfirm.hidden = false;
        authConfirmLabel.hidden = false;
        authConfirm.required = true;
        setPasswordLabel.textContent = "New password";
        authPassword.autocomplete = "new-password";
        authSubmit.textContent = "Save password";
        authModes.forEach(button => button.setAttribute("aria-pressed", "false"));
        authDialog.showModal();
      }
    } catch (error) { console.error("[Publisher] Could not read auth session:", error); }
  })();
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAccount(currentUser);
  });

  // Article pages use a real static Docsify route, /published, with the article slug in its query.
  function requestedSlug() {
    const route = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = route.split("?");
    return path === "published" ? new URLSearchParams(query).get("slug") : null;
  }
  async function listArticles() {
    const { data, error } = await supabaseClient.from(ARTICLE_TABLE).select("slug,title").order("title");
    if (error) throw error;
    return data || [];
  }
  async function renderArticleMenu() {
    const nav = document.querySelector(".sidebar-nav");
    if (!nav) return;
    let section = document.getElementById("uploaded-articles-menu");
    if (!section) { section = document.createElement("li"); section.id = "uploaded-articles-menu"; nav.appendChild(section); }
    section.replaceChildren();
    const heading = document.createElement("span"); heading.className = "uploaded-articles-heading"; heading.textContent = "Published articles"; section.appendChild(heading);
    try {
      const articles = await listArticles();
      const list = document.createElement("ul");
      articles.forEach(article => {
        const item = document.createElement("li"), link = document.createElement("a");
        link.href = `#/published?slug=${encodeURIComponent(article.slug)}`;
        link.textContent = article.title;
        item.appendChild(link);
        if (isSiteOwner(currentUser)) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "article-delete-button";
          remove.textContent = "Delete";
          remove.setAttribute("aria-label", `Delete article ${article.title}`);
          remove.addEventListener("click", async event => {
            event.preventDefault();
            event.stopPropagation();
            if (!window.confirm(`Delete “${article.title}”?`)) return;
            remove.disabled = true;
            let articleContent;
            try {
              const { data: articleRecord, error: readError } = await supabaseClient.from(ARTICLE_TABLE).select("content").eq("slug", article.slug).maybeSingle();
              if (readError) throw readError;
              articleContent = articleRecord?.content || "";
              const { error } = await supabaseClient.from(ARTICLE_TABLE).delete().eq("slug", article.slug);
              if (error) throw error;
            } catch (error) {
              remove.disabled = false;
              window.alert(`Could not delete article: ${error.message}`);
              return;
            }
            await renderArticleMenu();
            if (requestedSlug() === article.slug) location.hash = "/";
            try {
              await removeArticleImages(article.slug, articleContent);
            } catch (error) {
              console.warn("[Publisher] Article deleted, but image cleanup failed:", error);
              window.alert(`The article was deleted, but some stored images could not be removed: ${error.message}`);
            }
          });
          item.appendChild(remove);
        }
        list.appendChild(item);
      });
      section.appendChild(list);
      if (!articles.length) { const empty = document.createElement("small"); empty.textContent = "No uploaded articles yet."; section.appendChild(empty); }
    } catch (error) { const message = document.createElement("small"); message.textContent = `Could not load articles: ${error.message}`; section.appendChild(message); }
  }

  async function removeArticleImages(slug, content) {
    const objectPaths = new Set();
    for (const match of content.matchAll(/https?:\/\/[^\s)]+/g)) {
      try {
        const url = new URL(match[0]);
        const bucketPrefix = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
        if (!url.pathname.includes(bucketPrefix)) continue;
        const objectPath = decodeURIComponent(url.pathname.split(bucketPrefix)[1]);
        if (objectPath.startsWith(`${slug}/`) && !objectPath.split("/").includes("..")) objectPaths.add(objectPath);
      } catch { /* Ignore non-URL text in the Markdown. */ }
    }
    if (!objectPaths.size) return;
    const { error } = await supabaseClient.storage.from(IMAGE_BUCKET).remove([...objectPaths]);
    if (error) throw error;
  }

  const docsifyPlugin = function (hook) {
    hook.beforeEach((markdown, next) => {
      const slug = requestedSlug();
      if (!slug) return next(markdown);
      supabaseClient.from(ARTICLE_TABLE).select("title,content").eq("slug", slug).maybeSingle()
        .then(({ data, error }) => {
          if (error) next(`# Article could not be loaded\n\n${error.message}`);
          else if (!data) next("# Article not found\n\nThis article may have been removed.");
          else {
            const content = data.content || "";
            const firstHeading = content.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
            const alreadyHasTitle = firstHeading && firstHeading[1].trim().toLocaleLowerCase() === data.title.trim().toLocaleLowerCase();
            next(alreadyHasTitle ? content : `# ${data.title}\n\n${content}`);
          }
        }).catch(error => next(`# Article could not be loaded\n\n${error.message}`));
    });
    hook.doneEach(() => renderArticleMenu());
  };
  window.$docsify = window.$docsify || {};
  window.$docsify.plugins = [...(window.$docsify.plugins || []), docsifyPlugin];

  uploadOpen.addEventListener("click", () => {
    uploadStatus.textContent = "";
    uploadForm.reset();
    uploadDialog.showModal();
  });
  document.getElementById("article-upload-close").addEventListener("click", () => uploadDialog.close());
  document.getElementById("article-markdown-file").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      document.getElementById("article-content").value = await file.text();
      uploadStatus.textContent = `Loaded ${file.name}. Attach any referenced images below.`;
    } catch (error) {
      uploadStatus.textContent = `Could not read Markdown file: ${error.message}`;
    }
  });
  uploadForm.addEventListener("submit", async event => {
    event.preventDefault(); uploadStatus.textContent = "Saving…";
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!isSiteOwner(user)) { uploadStatus.textContent = "Only the authorized site owner can publish."; return; }
    const title = document.getElementById("article-title").value.trim();
    const slug = document.getElementById("article-slug").value.trim().toLowerCase();
    const body = document.getElementById("article-content").value;
    const images = [...document.getElementById("article-image").files];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { uploadStatus.textContent = "Use a URL slug with lowercase letters, numbers, and single hyphens."; return; }
    if (!title || !body.trim()) { uploadStatus.textContent = "Enter an article title and Markdown content."; return; }
    if (images.some(image => !image.type.startsWith("image/") || image.size > MAX_IMAGE_BYTES)) { uploadStatus.textContent = "Each attachment must be an image no larger than 5 MB."; return; }
    const saveButton = document.getElementById("article-save"); saveButton.disabled = true;
    try {
      let content = body;
      for (const image of images) {
        const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const imagePath = `${slug}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabaseClient.storage.from(IMAGE_BUCKET).upload(imagePath, image, { contentType: image.type, upsert: false });
        if (uploadError) throw uploadError;
        const imageUrl = supabaseClient.storage.from(IMAGE_BUCKET).getPublicUrl(imagePath).data.publicUrl;
        const escapedImageName = [...image.name].map(character => ".*+?^${}()|[]\\".includes(character) ? `\\${character}` : character).join("");
        const reference = new RegExp(`(!\\[[^\\]]*\\]\\()${escapedImageName}(\\))`, "g");
        if (reference.test(content)) {
          reference.lastIndex = 0;
          content = content.replace(reference, (_match, prefix, suffix) => `${prefix}${imageUrl}${suffix}`);
        } else {
          content += `\n\n![${image.name.replace(/[\[\]]/g, "")}](${imageUrl})`;
        }
      }
      const { error } = await supabaseClient.from(ARTICLE_TABLE).upsert({ slug, title, content, updated_at: new Date().toISOString() }, { onConflict: "slug" });
      if (error) throw error;
      await renderArticleMenu();
      uploadDialog.close();
      location.hash = `/published?slug=${encodeURIComponent(slug)}`;
    } catch (error) { uploadStatus.textContent = `Could not publish: ${error.message}`; }
    finally { saveButton.disabled = false; }
  });
})();
