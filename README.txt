Search Snippets
================
The site search has been enhanced with Pagefind, an open-source static search
library. When you search in the left sidebar, matching pages now show short
text snippets with the search term highlighted, similar to how Obsidian's
native search works. Multiple snippets per page are shown if there are
matches in different sections.

The existing MiniSearch (from the Obsidian Webpage HTML Export plugin) still
handles the file tree filtering. Pagefind runs alongside it to provide the
content snippets.

Configuration is in pagefind.yml. Custom script and styles are in:
  - site-lib/scripts/search-snippets.js
  - site-lib/html/custom-head-content-content.html


Before Pushing: Rebuild the Search Index
=========================================
After every Obsidian re-export, run this command in the project root before
committing and pushing:

    npx pagefind

This reads pagefind.yml and regenerates the pagefind/ directory with the
updated search index. Then commit and push as usual.
