(() => {
  "use strict";

  // ============================================================
  // 1. Supabase 配置
  // ============================================================

  const SUPABASE_URL = "https://tmktgmoqdvsdenffsolt.supabase.co";

  // 请替换成你原来 annotation.js 中的 publishable/anon key
  const SUPABASE_ANON_KEY = "sb_publishable_PAS4a4IYDT3AoJN24l7zVw_WmoYAG6I";

  if (!window.supabase) {
    console.error(
      "[Annotations] Supabase SDK 未加载。请检查 supabase-js 的 script。"
    );
    return;
  }

  const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  // ============================================================
  // 2. DOM 元素
  // ============================================================

  const sidebar = document.getElementById("annotation-sidebar");
  const list = document.getElementById("annotation-list");
  const dialog = document.getElementById("annotation-dialog");
  const form = document.getElementById("annotation-form");

  if (!sidebar || !list) {
    console.error(
      "[Annotations] 找不到 #annotation-sidebar 或 #annotation-list。"
    );
    return;
  }

  // 保存评论栏原本的位置，桌面端恢复时会用到
  const originalSidebarParent = sidebar.parentNode;
  const originalSidebarNextSibling = sidebar.nextSibling;

  // ============================================================
  // 3. 状态变量
  // ============================================================

  let currentUserId = null;
  let currentAnnotations = [];
  let selectedRange = null;
  let selectedText = "";
  let currentPagePath = "";

  let refreshTimer = null;
  let repositionTimer = null;

  const MOBILE_QUERY = "(max-width: 900px)";

  // ============================================================
  // 4. 基础工具
  // ============================================================

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function getArticleRoot() {
    return document.querySelector(".markdown-section");
  }

  function getCurrentPagePath() {
    // Docsify 通常使用 hash 路由
    const hash = window.location.hash || "#/";

    // 去除查询参数，保留当前文章路径
    const route = hash.replace(/^#/, "").split("?")[0];

    return route || "/";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  // ============================================================
  // 5. 匿名用户登录
  // ============================================================

  async function ensureGuestSession() {
    try {
      const {
        data: { session },
        error: sessionError
      } = await supabaseClient.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (session?.user) {
        currentUserId = session.user.id;
        return currentUserId;
      }

      const {
        data,
        error
      } = await supabaseClient.auth.signInAnonymously();

      if (error) {
        throw error;
      }

      currentUserId = data.user?.id ?? data.session?.user?.id ?? null;

      if (!currentUserId) {
        throw new Error("匿名登录成功，但没有取得 user ID。");
      }

      return currentUserId;
    } catch (error) {
      console.error("[Annotations] 匿名登录失败：", error);
      throw error;
    }
  }

  // ============================================================
  // 6. Range 与文本偏移量转换
  // ============================================================

  function pointToOffset(root, targetNode, targetOffset) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.length) {
            return NodeFilter.FILTER_REJECT;
          }

          // 忽略评论栏、脚本等非文章区域
          if (node.parentElement?.closest("#annotation-sidebar")) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let total = 0;
    let node;

    while ((node = walker.nextNode())) {
      if (node === targetNode) {
        return total + targetOffset;
      }

      total += node.nodeValue.length;
    }

    return null;
  }

  function offsetToRange(root, startOffset, endOffset) {
    if (
      !root ||
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset <= startOffset
    ) {
      return null;
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.length) {
            return NodeFilter.FILTER_REJECT;
          }

          if (node.parentElement?.closest("#annotation-sidebar")) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let position = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;
    let node;

    while ((node = walker.nextNode())) {
      const length = node.nodeValue.length;
      const nextPosition = position + length;

      if (startNode === null && startOffset >= position &&
          startOffset <= nextPosition) {
        startNode = node;
        startNodeOffset = startOffset - position;
      }

      if (endOffset >= position && endOffset <= nextPosition) {
        endNode = node;
        endNodeOffset = endOffset - position;
        break;
      }

      position = nextPosition;
    }

    if (!startNode || !endNode) {
      return null;
    }

    try {
      const range = document.createRange();

      range.setStart(startNode, startNodeOffset);
      range.setEnd(endNode, endNodeOffset);

      return range;
    } catch (error) {
      console.warn("[Annotations] 无法恢复选中文字：", error);
      return null;
    }
  }

  // ============================================================
  // 7. 清除文章中的评论高亮
  // ============================================================

  function clearHighlights() {
    const root = getArticleRoot();

    if (!root) return;

    const marks = root.querySelectorAll("mark.annotation-highlight");

    marks.forEach((mark) => {
      const parent = mark.parentNode;

      if (!parent) return;

      parent.replaceChild(
        document.createTextNode(mark.textContent || ""),
        mark
      );

      parent.normalize();
    });
  }

  // ============================================================
  // 8. 恢复评论高亮
  // ============================================================

  function applyHighlights() {
    const root = getArticleRoot();

    if (!root) return;

    clearHighlights();

    const annotations = [...currentAnnotations]
      .filter((item) =>
        Number.isInteger(item.start_offset) &&
        Number.isInteger(item.end_offset) &&
        item.end_offset > item.start_offset
      )
      .sort((a, b) => b.start_offset - a.start_offset);

    annotations.forEach((annotation) => {
      const range = offsetToRange(
        root,
        annotation.start_offset,
        annotation.end_offset
      );

      if (!range || range.collapsed) return;

      try {
        const mark = document.createElement("mark");

        mark.className = "annotation-highlight";
        mark.dataset.annotationId = annotation.id;
        mark.title = "查看相关评论";

        range.surroundContents(mark);
      } catch {
        // 当选区跨越多个 HTML 元素时，surroundContents 可能失败。
        // 这里跳过该高亮，避免破坏文章 DOM。
      }
    });
  }

  // ============================================================
  // 9. 从 Supabase 加载评论
  // ============================================================

  async function loadAnnotations(pagePath) {
    const {
      data,
      error
    } = await supabaseClient
      .from("annotations")
      .select(
        "id, page_path, selected_text, prefix, suffix, start_offset, end_offset, nickname, body, user_id, created_at"
      )
      .eq("page_path", pagePath)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[Annotations] 加载评论失败：", error);
      throw error;
    }

    currentAnnotations = data || [];

    return currentAnnotations;
  }

  // ============================================================
  // 10. 创建评论卡片
  // ============================================================

  function createAnnotationCard(annotation) {
    const card = document.createElement("div");

    card.className = "annotation-card";
    card.dataset.annotationId = annotation.id;

    // 引用文字
    const quote = document.createElement("blockquote");
    quote.className = "annotation-card-quote";
    quote.textContent = annotation.selected_text || "";

    // 用户昵称
    const nickname = document.createElement("div");
    nickname.className = "annotation-card-nickname";
    nickname.textContent = annotation.nickname || "Guest";

    // 评论内容
    const body = document.createElement("div");
    body.className = "annotation-card-body";
    body.textContent = annotation.body || "";

    // 日期
    const date = document.createElement("div");
    date.className = "annotation-card-date";
    date.textContent = formatDate(annotation.created_at);

    card.append(quote, nickname, body, date);

    // 只显示当前用户自己评论的删除按钮
    if (currentUserId && annotation.user_id === currentUserId) {
      const deleteButton = document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className = "annotation-delete";
      deleteButton.textContent = "Delete";
      deleteButton.setAttribute("aria-label", "Delete your comment");

      deleteButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await deleteAnnotation(annotation.id);
      });

      card.appendChild(deleteButton);
    }

    // 点击评论卡片，滚动到对应的文章位置
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;

      scrollToAnnotation(annotation);
    });

    return card;
  }

  // ============================================================
  // 11. 滚动到对应评论位置
  // ============================================================

  function scrollToAnnotation(annotation) {
    const root = getArticleRoot();

    if (!root) return;

    const mark = root.querySelector(
      `mark.annotation-highlight[data-annotation-id="${CSS.escape(annotation.id)}"]`
    );

    if (mark) {
      mark.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      return;
    }

    // 如果当前高亮不存在，尝试用偏移量恢复选区
    const range = offsetToRange(
      root,
      annotation.start_offset,
      annotation.end_offset
    );

    if (range) {
      const rect = range.getBoundingClientRect();

      if (rect.height || rect.width) {
        window.scrollTo({
          top: window.scrollY + rect.top - window.innerHeight / 2,
          behavior: "smooth"
        });
      }
    }
  }

  // ============================================================
  // 12. 评论卡片定位
  // ============================================================

 function positionCards(root) {
  const cards = Array.from(
    list.querySelectorAll(".annotation-card")
  );

  // Mobile: comments appear in normal document flow.
  if (isMobile()) {
    cards.forEach((card) => {
      card.style.position = "relative";
      card.style.top = "auto";
      card.style.bottom = "auto";
      card.style.left = "auto";
      card.style.right = "auto";
      card.style.transform = "none";
    });

    list.style.minHeight = "0";
    return;
  }

  // Desktop: sort comments by their positions in the article.
  const listRect = list.getBoundingClientRect();
  const gap = 12;

  const placements = cards
    .map((card) => {
      const annotation = currentAnnotations.find(
        (item) => item.id === card.dataset.annotationId
      );

      if (!annotation) return null;

      const range = offsetToRange(
        root,
        annotation.start_offset,
        annotation.end_offset
      );

      if (!range) return null;

      const rangeRect = range.getBoundingClientRect();

      if (!rangeRect.height && !rangeRect.width) {
        return null;
      }

      // Desired position relative to the comments list.
      const targetTop =
        rangeRect.top - listRect.top + list.scrollTop;

      return {
        card,
        targetTop: Math.max(0, targetTop)
      };
    })
    .filter(Boolean)
    // Important: sort by article position, NOT creation time.
    .sort((a, b) => a.targetTop - b.targetTop);

  // Reset positioning for cards that could not be matched to text.
  const validCards = new Set(
    placements.map((item) => item.card)
  );

  cards.forEach((card) => {
    if (!validCards.has(card)) {
      card.style.position = "absolute";
      card.style.top = "0px";
      card.style.left = "0";
      card.style.right = "0";
    }
  });

  // Place cards in article order and prevent overlap.
  let previousBottom = 0;

  placements.forEach(({ card, targetTop }) => {
    card.style.position = "absolute";
    card.style.left = "0";
    card.style.right = "0";
    card.style.bottom = "auto";
    card.style.transform = "none";

    // Measure after setting the positioning mode.
    const finalTop = Math.max(
      targetTop,
      previousBottom === 0 ? 0 : previousBottom + gap
    );

    card.style.top = `${finalTop}px`;

    previousBottom = finalTop + card.offsetHeight;
  });

  // Reserve enough space for all positioned cards.
  list.style.minHeight = `${previousBottom}px`;
}

  // ============================================================
  // 13. 渲染评论列表
  // ============================================================

  function renderAnnotations() {
    list.replaceChildren();

    if (currentAnnotations.length === 0) {
      const empty = document.createElement("p");

      empty.className = "annotation-empty";
      empty.textContent = "No comments yet.";

      list.appendChild(empty);
      list.style.minHeight = "0";

      return;
    }

    currentAnnotations.forEach((annotation) => {
      list.appendChild(createAnnotationCard(annotation));
    });
  }

  // ============================================================
  // 14. 更新评论显示与布局
  // ============================================================

  function updateAnnotationLayout() {
    const contentSection = document.querySelector(
      "body > main > section.content"
    );

    if (!contentSection || !sidebar) return;

    if (isMobile()) {
      // 移动端：将评论栏放在文章后面
      if (sidebar.previousElementSibling !== contentSection) {
        contentSection.insertAdjacentElement("afterend", sidebar);
      }

      // 不使用桌面端定位
      sidebar.style.position = "relative";
      sidebar.style.top = "auto";
      sidebar.style.right = "auto";
      sidebar.style.bottom = "auto";
      sidebar.style.left = "auto";
    } else {
      // 桌面端：恢复评论栏原始 DOM 位置
      if (originalSidebarParent) {
        if (
          originalSidebarNextSibling &&
          originalSidebarNextSibling.parentNode === originalSidebarParent
        ) {
          originalSidebarParent.insertBefore(
            sidebar,
            originalSidebarNextSibling
          );
        } else {
          originalSidebarParent.appendChild(sidebar);
        }
      }

      // 桌面端具体位置由 CSS 控制
      sidebar.style.position = "";
      sidebar.style.top = "";
      sidebar.style.right = "";
      sidebar.style.bottom = "";
      sidebar.style.left = "";
    }
  }

  // ============================================================
  // 15. 添加 Show / Hide Comments 按钮
  // ============================================================

  function setupCommentsToggle() {
    const header = sidebar.querySelector(".annotation-header");

    if (!header) {
      console.warn(
        "[Annotations] 找不到 .annotation-header，无法添加显示/隐藏按钮。"
      );
      return;
    }

    // 防止重复创建按钮
    if (header.querySelector(".annotation-mobile-toggle")) {
      return;
    }

    const toggleButton = document.createElement("button");

    toggleButton.type = "button";
    toggleButton.className = "annotation-mobile-toggle";
    toggleButton.textContent = "Hide Comments";
    toggleButton.setAttribute("aria-expanded", "true");

    toggleButton.addEventListener("click", () => {
      const collapsed = sidebar.classList.toggle("annotations-collapsed");

      toggleButton.textContent = collapsed
        ? "Show Comments"
        : "Hide Comments";

      toggleButton.setAttribute(
        "aria-expanded",
        String(!collapsed)
      );
    });

    header.appendChild(toggleButton);
  }

  // ============================================================
  // 16. 删除自己的评论
  // ============================================================

  async function deleteAnnotation(annotationId) {
    const annotation = currentAnnotations.find(
      (item) => item.id === annotationId
    );

    if (!annotation) return;

    if (!currentUserId || annotation.user_id !== currentUserId) {
      alert("You can only delete your own comments.");
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to delete this comment?"
    );

    if (!confirmed) return;

    try {
      const {
        error
      } = await supabaseClient
        .from("annotations")
        .delete()
        .eq("id", annotationId)
        .eq("user_id", currentUserId);

      if (error) {
        throw error;
      }

      await refresh();
    } catch (error) {
      console.error("[Annotations] 删除评论失败：", error);

      alert(
        "Could not delete the comment. Please check your connection and permissions."
      );
    }
  }

  // ============================================================
  // 17. 选中文字并打开评论对话框
  // ============================================================

  function setupTextSelection() {
    document.addEventListener("mouseup", handleTextSelection);
    document.addEventListener("touchend", handleTextSelection);
  }

  function handleTextSelection() {
    if (!dialog || !form) return;

    const root = getArticleRoot();

    if (!root) return;

    const selection = window.getSelection();

    if (!selection || selection.isCollapsed) return;

    const text = selection.toString().trim();

    if (!text) return;

    const range = selection.getRangeAt(0);

    // 只允许选择文章正文，不允许选择评论栏或其他界面
    if (!root.contains(range.commonAncestorContainer)) {
      return;
    }

    if (
      range.commonAncestorContainer.parentElement?.closest(
        "#annotation-sidebar"
      )
    ) {
      return;
    }

    const startOffset = pointToOffset(
      root,
      range.startContainer,
      range.startOffset
    );

    const endOffset = pointToOffset(
      root,
      range.endContainer,
      range.endOffset
    );

    if (
      startOffset === null ||
      endOffset === null ||
      endOffset <= startOffset
    ) {
      return;
    }

    selectedRange = {
      startOffset,
      endOffset,
      range: range.cloneRange()
    };

    selectedText = text;

    openAnnotationDialog(text);
  }

  function openAnnotationDialog(text) {
    if (!dialog) return;

    const quoteElement =
      dialog.querySelector("#annotation-selected-text") ||
      dialog.querySelector("[name='selected_text']") ||
      dialog.querySelector(".annotation-selected-text");

    if (quoteElement) {
      quoteElement.textContent = text;
    }

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.style.display = "block";
    }
  }

  function closeAnnotationDialog() {
    if (!dialog) return;

    if (typeof dialog.close === "function" && dialog.open) {
      dialog.close();
    } else {
      dialog.style.display = "none";
    }
  }

  // ============================================================
  // 18. 提交新评论
  // ============================================================

  function setupAnnotationForm() {
    if (!form) {
      console.warn("[Annotations] 找不到 #annotation-form。");
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!selectedRange || !selectedText) {
        alert("Please select some text in the article first.");
        return;
      }

      const nicknameInput =
        form.querySelector("#annotation-nickname") ||
        form.querySelector("[name='nickname']");

      const bodyInput =
        form.querySelector("#annotation-body") ||
        form.querySelector("[name='body']");

      if (!bodyInput) {
        console.error(
          "[Annotations] 找不到评论内容输入框。请检查表单中是否有 #annotation-body 或 name='body'。"
        );
        return;
      }

      const nickname = nicknameInput
        ? nicknameInput.value.trim()
        : "";

      const body = bodyInput.value.trim();

      if (!body) {
        alert("Please enter a comment.");
        bodyInput.focus();
        return;
      }

      try {
        await ensureGuestSession();

        const root = getArticleRoot();

        if (!root) {
          throw new Error("找不到文章正文。");
        }

        const startOffset = selectedRange.startOffset;
        const endOffset = selectedRange.endOffset;

        // 取选区前后的文字，帮助之后识别选区
        const articleText = root.textContent || "";

        const prefix = articleText.slice(
          Math.max(0, startOffset - 50),
          startOffset
        );

        const suffix = articleText.slice(
          endOffset,
          endOffset + 50
        );

        const {
          error
        } = await supabaseClient
          .from("annotations")
          .insert({
            page_path: getCurrentPagePath(),
            selected_text: selectedText,
            prefix,
            suffix,
            start_offset: startOffset,
            end_offset: endOffset,
            nickname: nickname || "Guest",
            body,
            user_id: currentUserId
          });

        if (error) {
          throw error;
        }

        form.reset();

        closeAnnotationDialog();

        selectedRange = null;
        selectedText = "";

        window.getSelection()?.removeAllRanges();

        await refresh();
      } catch (error) {
        console.error("[Annotations] 提交评论失败：", error);

        alert(
          "Could not submit your comment. Please try again."
        );
      }
    });

    // 支持表单内的取消按钮
    const cancelButton =
      form.querySelector("#annotation-cancel") ||
      form.querySelector("[data-annotation-cancel]");

    if (cancelButton) {
      cancelButton.addEventListener("click", (event) => {
        event.preventDefault();

        closeAnnotationDialog();

        selectedRange = null;
        selectedText = "";

        window.getSelection()?.removeAllRanges();
      });
    }
  }

  // ============================================================
  // 19. 刷新当前页面的评论
  // ============================================================

  async function refresh() {
    const root = getArticleRoot();

    if (!root) {
      return;
    }

    currentPagePath = getCurrentPagePath();

    try {
      await ensureGuestSession();

      await loadAnnotations(currentPagePath);

      renderAnnotations();
      applyHighlights();

      requestAnimationFrame(() => {
        const currentRoot = getArticleRoot();

        if (currentRoot) {
          positionCards(currentRoot);
        }
      });
    } catch (error) {
      console.error("[Annotations] 刷新失败：", error);
    }
  }

  // ============================================================
  // 20. 调整布局
  // ============================================================

  function scheduleReposition() {
    if (repositionTimer) {
      clearTimeout(repositionTimer);
    }

    repositionTimer = setTimeout(() => {
      const root = getArticleRoot();

      if (root) {
        positionCards(root);
      }
    }, 100);
  }

  function initializeAnnotationLayout() {
    updateAnnotationLayout();
    setupCommentsToggle();
  }

  // ============================================================
  // 21. 监听窗口、滚动和 Docsify 路由变化
  // ============================================================

  window.addEventListener("resize", () => {
    updateAnnotationLayout();
    scheduleReposition();
  });

  window.addEventListener("scroll", scheduleReposition, {
    passive: true
  });

  window.addEventListener("hashchange", () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(async () => {
      updateAnnotationLayout();

      await refresh();

      setupCommentsToggle();
    }, 150);
  });

  // ============================================================
  // 22. 初始化
  // ============================================================

  setupTextSelection();
  setupAnnotationForm();
  initializeAnnotationLayout();

  // 供外部脚本调用
  window.annotationSystem = {
    refresh,
    updateAnnotationLayout
  };

  // 等待 Docsify 渲染文章
  setTimeout(async () => {
    updateAnnotationLayout();
    await refresh();
  }, 100);
})();