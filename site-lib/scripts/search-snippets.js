/**
 * Pagefind snippet integration for Obsidian Webpage HTML Export
 *
 * Augments the existing MiniSearch-based search with content snippets
 * powered by Pagefind. After the file tree is filtered by MiniSearch,
 * this script queries Pagefind for the same search term and injects
 * text excerpts (with highlighted matches) under each result in the tree.
 */
(function () {
  let pagefind = null;
  let initialized = false;

  async function initPagefind() {
    if (initialized) return pagefind;
    // Resolve the base href the same way the rest of the site does.
    // Root pages use <base href=".">, subdir pages use <base href="..">.
    const base = document.querySelector("base")?.getAttribute("href") || ".";
    const siteRoot = new URL(base + "/", document.baseURI).href;
    const pagefindPath = new URL("pagefind/pagefind.js", siteRoot).href;
    try {
      pagefind = await import(pagefindPath);
    } catch (e) {
      console.error("Pagefind: Could not load pagefind.js from " + pagefindPath, e);
      return null;
    }
    // Tell Pagefind where its assets are, in case import.meta.url doesn't resolve correctly
    await pagefind.options({
      basePath: new URL("pagefind/", siteRoot).href,
      excerptLength: 8  // short snippets: ~4 words before + ~4 words after the match
    });
    await pagefind.init();
    initialized = true;
    return pagefind;
  }

  // Debounce timer for snippet fetching
  let snippetTimer = null;

  /**
   * Trim an excerpt so it doesn't cross paragraph or list-item boundaries.
   * Pagefind uses \u200B (zero-width space) between block elements like <li>,
   * and \n between paragraphs. Split on both and keep only the segment
   * that contains the <mark> match. Then add "..." if the snippet is
   * cut off (i.e. the sentence continues in either direction).
   */
  function trimToParagraph(excerpt) {
    let text = excerpt;

    // Split on paragraph/list-item boundaries and keep the matching segment
    const segments = text.split(/[\n\u200B]+/);
    if (segments.length > 1) {
      text = (segments.find(s => s.includes("<mark>")) || segments[0]).trim();
    }

    // Add ellipsis if the snippet is cut from a longer text.
    // Pagefind excerpts that don't start at the beginning of content
    // typically start with a lowercase letter or mid-word.
    // We check for the presence of leading/trailing partial text.
    const stripped = text.replace(/<\/?mark>/g, "");
    if (stripped.length > 0) {
      const firstChar = stripped.trimStart().charAt(0);
      const lastChar = stripped.trimEnd().slice(-1);
      // Add leading "..." if it doesn't start with an uppercase letter
      // (suggesting it's mid-sentence) or starts with common mid-sentence chars
      if (firstChar && firstChar !== firstChar.toUpperCase()) {
        text = "..." + text.trimStart();
      }
      // Add trailing "..." if it doesn't end with sentence-ending punctuation
      if (lastChar && !/[.!?:;]/.test(lastChar)) {
        text = text.trimEnd() + "...";
      }
    }

    return text;
  }

  /**
   * Query Pagefind and inject snippets into the file tree under matching items.
   */
  async function addSnippets(searchTerm) {
    if (!searchTerm || searchTerm.length < 2) {
      removeSnippets();
      return;
    }

    const pf = await initPagefind();
    if (!pf) return;

    const search = await pf.search(searchTerm);
    if (!search || !search.results || search.results.length === 0) return;

    // Load data for top results (limit to 20 for performance)
    const resultsToLoad = search.results.slice(0, 20);
    const loaded = await Promise.all(resultsToLoad.map(r => r.data()));

    // Build a map from URL path to snippets
    const snippetMap = new Map();
    for (const result of loaded) {
      if (!result) continue;
      // Normalize the URL to match the tree's href format
      let url = result.url;
      // Remove leading slash and any base path
      url = url.replace(/^\//, "");

      const snippets = [];

      // Main excerpt
      if (result.excerpt) {
        snippets.push(trimToParagraph(result.excerpt));
      }

      // Sub-results have their own excerpts (matches under different headings)
      if (result.sub_results && result.sub_results.length > 0) {
        for (const sub of result.sub_results) {
          if (sub.excerpt && sub.excerpt !== result.excerpt) {
            snippets.push(trimToParagraph(sub.excerpt));
          }
          if (snippets.length >= 4) break;
        }
      }

      if (snippets.length > 0) {
        snippetMap.set(url, snippets);
      }
    }

    // Now inject snippets into the file tree
    injectSnippetsIntoTree(snippetMap);
  }

  /**
   * Find matching tree items and append snippet elements.
   */
  function injectSnippetsIntoTree(snippetMap) {
    // Remove old snippets first
    removeSnippets();

    const fileTree = document.querySelector("#file-explorer");
    if (!fileTree) return;

    // Get all nav-file links in the tree
    const fileLinks = fileTree.querySelectorAll(".nav-file-title");

    for (const link of fileLinks) {
      const href = link.getAttribute("href");
      if (!href) continue;

      // Try to match against the snippet map
      const snippets = snippetMap.get(href) || snippetMap.get(decodeURIComponent(href));
      if (!snippets) continue;

      // Find the parent tree-item element
      const treeItem = link.closest(".tree-item");
      if (!treeItem) continue;

      // Create or find the hint container
      let hintContainer = treeItem.querySelector(".tree-hint-container");
      if (!hintContainer) {
        hintContainer = document.createElement("div");
        hintContainer.classList.add("tree-hint-container");
        treeItem.classList.add("has-hints");
        treeItem.appendChild(hintContainer);
      }

      // Add snippet elements after any existing header hints
      for (const snippet of snippets) {
        const snippetEl = document.createElement("div");
        snippetEl.classList.add("tree-snippet-label");
        snippetEl.innerHTML = snippet; // excerpt already contains <mark> tags from Pagefind
        hintContainer.appendChild(snippetEl);
      }
    }
  }

  /**
   * Remove all previously injected snippets.
   */
  function removeSnippets() {
    document.querySelectorAll(".tree-snippet-label").forEach(el => el.remove());
    // Remove empty hint containers that we created (but not ones with header hints)
    document.querySelectorAll(".tree-hint-container").forEach(container => {
      if (container.children.length === 0) {
        container.closest(".tree-item")?.classList.remove("has-hints");
        container.remove();
      }
    });
  }

  /**
   * Hook into the existing search input to trigger snippet loading.
   */
  function hookSearchInput() {
    const searchInput = document.querySelector('input[type="search"]');
    if (!searchInput) {
      // Retry - the input might not be in the DOM yet
      setTimeout(hookSearchInput, 500);
      return;
    }

    // Pre-initialize Pagefind when search input is focused
    searchInput.addEventListener("focus", () => initPagefind(), { once: true });

    // Listen for input events (same event the existing search uses)
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim();
      // Clear any pending snippet fetch
      if (snippetTimer) clearTimeout(snippetTimer);

      if (term.length < 2) {
        removeSnippets();
        return;
      }

      // Debounce: wait 400ms after typing stops before fetching snippets
      snippetTimer = setTimeout(() => addSnippets(term), 400);
    });

    // Also handle clearing
    const clearBtn = document.querySelector("#search-clear-button");
    if (clearBtn) {
      clearBtn.addEventListener("click", removeSnippets);
    }

    // Handle Escape key
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") removeSnippets();
    });
  }

  // Start hooking once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(hookSearchInput, 100));
  } else {
    setTimeout(hookSearchInput, 100);
  }
})();
