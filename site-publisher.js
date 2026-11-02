(() => {
  "use strict";
  const OWNER_EMAIL = "jerryandhank1215@gmail.com";
  const ARTICLE_TABLE = "site_articles";
  const IMAGE_BUCKET = "site-article-images";
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_ARTICLE_IMAGES = 5;
  const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
  const supabaseClient = window.annotationSupabaseClient || window.supabase.createClient(
    "https://tmktgmoqdvsdenffsolt.supabase.co",
    "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I",
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
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
  let articleMenuRevision = 0;
  let articleMenuRenderedRevision = 0;
  let articleMenuRenderPromise = null;
  let articleMenuSignature = "";
  let articleMenuHost = null;
  let cachedArticles = null;
  let cachedArticlesRevision = -1;
  let articleDataRevision = 0;
  let articleListRequest = null;

  function isSiteOwner(user) {
    return Boolean(user && !user.is_anonymous && user.email?.trim().toLowerCase() === OWNER_EMAIL);
  }
  function updateAccount(user) {
    const verifiedUser = user && !user.is_anonymous ? user : null;
    accountEmail.textContent = verifiedUser?.email || "Not signed in";
    authOpen.textContent = verifiedUser ? "Account" : "Login / Register";
    authOpen.hidden = false;
    logoutButton.hidden = !verifiedUser;
    uploadOpen.hidden = !isSiteOwner(verifiedUser);
  }
  function openAuth() {
    supabaseClient.auth.getSession().then(({ data, error }) => {
      if (error) { authStatus.textContent = error.message; }
      if (data?.session?.user && !data.session.user.is_anonymous) {
        authMode = "account";
        authTitle.textContent = "Account";
        authHelp.textContent = isSiteOwner(data.session.user)
          ? `已登录管理员账号：${data.session.user.email}`
          : `当前登录邮箱是 ${data.session.user.email || "未知"}。只有 ${OWNER_EMAIL} 可以发布文章。`;
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
      if (authMode === "register" && !result.data.session) {
        authStatus.textContent = "Registration started. Check your email to confirm the account.";
      } else {
        currentUser = result.data.user || result.data.session?.user || null;
        updateAccount(currentUser);
        renderArticleMenu();
        const owner = isSiteOwner(currentUser);
        authStatus.textContent = authMode === "login"
          ? (owner ? `已登录管理员账号：${currentUser.email}` : `已登录 ${currentUser?.email || "账号"}，但该邮箱没有发布权限。`)
          : "Account created.";
        if (authMode === "register" && !owner) {
          authHelp.textContent = `新账号不会自动获得发布权限；只有 ${OWNER_EMAIL} 可以发布。`;
        }
        if (authMode !== "login" || owner) setTimeout(() => authDialog.close(), 700);
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
    renderArticleMenu();
  });

  // Article pages use a real static Docsify route, /published, with the article slug in its query.
  function requestedSlug() {
    const route = location.hash.replace(/^#\/?/, "");
    const [path, query = ""] = route.split("?");
    return path === "published" ? new URLSearchParams(query).get("slug") : null;
  }
  async function listArticles() {
    const revision = articleDataRevision;
    if (cachedArticlesRevision === revision) return cachedArticles;
    if (articleListRequest?.revision === revision) return articleListRequest.promise;
    const request = { revision, promise: null };
    request.promise = (async () => {
      const { data, error } = await supabaseClient.from(ARTICLE_TABLE).select("slug,title").order("title");
      if (error) throw error;
      const articles = data || [];
      if (revision === articleDataRevision) {
        cachedArticles = articles;
        cachedArticlesRevision = revision;
      }
      return articles;
    })().finally(() => {
      if (articleListRequest === request) articleListRequest = null;
    });
    articleListRequest = request;
    return request.promise;
  }
  function invalidateArticleList() {
    articleDataRevision += 1;
    cachedArticles = null;
    cachedArticlesRevision = -1;
  }
  function renderArticleMenu() {
    articleMenuRevision += 1;
    if (articleMenuRenderPromise) return articleMenuRenderPromise;
    articleMenuRenderPromise = (async () => {
      while (articleMenuRenderedRevision < articleMenuRevision) {
        const revision = articleMenuRevision;
        const nav = document.querySelector(".sidebar-nav");
        if (!nav) { articleMenuRenderedRevision = revision; break; }
        let section = document.getElementById("uploaded-articles-menu");
        if (!section || section.parentElement !== nav) {
          section = document.createElement("li");
          section.id = "uploaded-articles-menu";
          nav.appendChild(section);
        }

        let articles = [];
        let loadError = null;
        try { articles = await listArticles(); }
        catch (error) { loadError = error; }
        if (revision !== articleMenuRevision) continue;

        const owner = isSiteOwner(currentUser);
        const signature = JSON.stringify({ articles, owner, error: loadError?.message || "" });
        if (articleMenuHost === nav && articleMenuSignature === signature && section.isConnected) {
          articleMenuRenderedRevision = revision;
          continue;
        }

        section.replaceChildren();
        const heading = document.createElement("span");
        heading.className = "uploaded-articles-heading";
        heading.textContent = "已发布文章";
        section.appendChild(heading);

        if (loadError) {
          const message = document.createElement("small");
          message.textContent = `暂时无法加载文章：${loadError.message}`;
          section.appendChild(message);
        } else if (!articles.length) {
          const empty = document.createElement("small");
          empty.textContent = "暂无已发布文章";
          section.appendChild(empty);
        } else {
          const list = document.createElement("ul");
          articles.forEach(articleItem => {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.href = `#/published?slug=${encodeURIComponent(articleItem.slug)}`;
            link.textContent = articleItem.title;
            item.appendChild(link);
            if (owner) {
              const remove = document.createElement("button");
              remove.type = "button";
              remove.className = "article-delete-button";
              remove.textContent = "删除";
              remove.setAttribute("aria-label", `删除文章 ${articleItem.title}`);
              remove.addEventListener("click", async event => {
                event.preventDefault();
                event.stopPropagation();
                if (!window.confirm(`确定删除《${articleItem.title}》吗？`)) return;
                remove.disabled = true;
                let articleContent = "";
                try {
                  const { data: articleRecord, error: readError } = await supabaseClient.from(ARTICLE_TABLE).select("content").eq("slug", articleItem.slug).maybeSingle();
                  if (readError) throw readError;
                  articleContent = articleRecord?.content || "";
                  const { error } = await supabaseClient.from(ARTICLE_TABLE).delete().eq("slug", articleItem.slug);
                  if (error) throw error;
                } catch (error) {
                  remove.disabled = false;
                  window.alert(`删除失败：${error.message}`);
                  return;
                }
                invalidateArticleList();
                await renderArticleMenu();
                if (requestedSlug() === articleItem.slug) location.hash = "/";
                try { await removeArticleImages(articleItem.slug, articleContent); }
                catch (error) { window.alert(`文章已删除，但部分图片未能清理：${error.message}`); }
              });
              item.appendChild(remove);
            }
            list.appendChild(item);
          });
          section.appendChild(list);
        }
        articleMenuHost = nav;
        articleMenuSignature = signature;
        articleMenuRenderedRevision = revision;
      }
    })().finally(() => {
      articleMenuRenderPromise = null;
      if (articleMenuRenderedRevision < articleMenuRevision) renderArticleMenu();
    });
    return articleMenuRenderPromise;
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

  async function uploadArticleImage(path, file, onProgress) {
    const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
    if (file.size <= RESUMABLE_THRESHOLD || !window.tus?.Upload) {
      const { error } = await supabaseClient.storage.from(IMAGE_BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false
      });
      if (error) throw error;
      onProgress(100);
      return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session?.access_token) throw new Error("管理员登录已过期，请重新登录后上传。");
    await new Promise((resolve, reject) => {
      const upload = new window.tus.Upload(file, {
        endpoint: "https://tmktgmoqdvsdenffsolt.storage.supabase.co/storage/v1/upload/resumable",
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${data.session.access_token}` },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: RESUMABLE_THRESHOLD,
        metadata: {
          bucketName: IMAGE_BUCKET,
          objectName: path,
          contentType: file.type,
          cacheControl: "3600"
        },
        onError: reject,
        onProgress: (uploaded, total) => onProgress(Math.floor(uploaded / total * 100)),
        onSuccess: resolve
      });
      upload.start();
    });
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
    hook.doneEach(() => {
      if (requestedSlug()) document.querySelector(".markdown-section > h1")?.classList.add("published-article-title");
      renderArticleMenu();
    });
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
      uploadStatus.textContent = `已读取 ${file.name}。请在下方选择正文引用的图片。`;
    } catch (error) {
      uploadStatus.textContent = `读取失败：${error.message}`;
    }
  });
  uploadForm.addEventListener("submit", async event => {
    event.preventDefault(); uploadStatus.textContent = "正在上传图片并保存文章…";
    let user = null;
    try {
      const { data, error } = await supabaseClient.auth.getUser();
      if (error) throw error;
      user = data.user;
    } catch (error) {
      uploadStatus.textContent = `无法确认登录状态：${error.message}`;
      return;
    }
    currentUser = user;
    updateAccount(user);
    if (!isSiteOwner(user)) {
      uploadStatus.textContent = `当前账号（${user?.email || "未登录"}）没有发布权限，请使用 ${OWNER_EMAIL} 登录。`;
      return;
    }
    const title = document.getElementById("article-title").value.trim();
    const slug = document.getElementById("article-slug").value.trim().toLowerCase();
    const body = document.getElementById("article-content").value;
    const images = [...document.getElementById("article-image").files];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { uploadStatus.textContent = "短名请只用小写字母、数字和连字符。"; return; }
    if (!title || !body.trim()) { uploadStatus.textContent = "请填写标题和 Markdown 正文。"; return; }
    if (images.length > MAX_ARTICLE_IMAGES) { uploadStatus.textContent = `一次最多添加 ${MAX_ARTICLE_IMAGES} 张图片。`; return; }
    if (images.some(image => !image.type.startsWith("image/") || image.size > MAX_IMAGE_BYTES)) { uploadStatus.textContent = "每张图片不能超过 10 MB。"; return; }
    if (images.reduce((total, image) => total + image.size, 0) > MAX_TOTAL_IMAGE_BYTES) { uploadStatus.textContent = "图片总大小不能超过 50 MB。"; return; }
    const saveButton = document.getElementById("article-save"); saveButton.disabled = true;
    try {
      let content = body;
      for (const [imageIndex, image] of images.entries()) {
        uploadStatus.textContent = `正在上传图片 ${imageIndex + 1}/${images.length}…`;
        const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const imagePath = `${slug}/${Date.now()}-${safeName}`;
        await uploadArticleImage(imagePath, image, percent => {
          uploadStatus.textContent = `正在上传图片 ${imageIndex + 1}/${images.length}（${percent}%）…`;
        });
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
      uploadStatus.textContent = "正在保存文章…";
      const { error } = await supabaseClient.from(ARTICLE_TABLE).upsert({ slug, title, content, updated_at: new Date().toISOString() }, { onConflict: "slug" });
      if (error) throw error;
      invalidateArticleList();
      await renderArticleMenu();
      uploadDialog.close();
      location.hash = `/published?slug=${encodeURIComponent(slug)}`;
    } catch (error) { uploadStatus.textContent = `发布失败：${error.message}`; }
    finally { saveButton.disabled = false; }
  });
})();
