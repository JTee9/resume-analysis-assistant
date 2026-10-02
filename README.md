# Resume Intelligence Assistant

Static, browser-only tool: extract resume text (PDF/DOCX), add job descriptions, generate a complete LLM prompt, then paste the response back to format and download it. No backend, API key, database, analytics, or storage. Everything stays in browser memory.

## Files
```
index.html   page structure
style.css    styling
app.js       extraction, prompt builder, Markdown rendering
README.md
```
Libraries (PDF.js 3.11.174, Mammoth 1.6.0) load from cdnjs. All local paths are relative, so it works under a repository subpath.

## Notes
- Scanned PDFs have no selectable text; the app warns you. OCR is not in v1, but add a new function to the `EXTRACTORS` object in `app.js` to support it later.
- Legacy `.doc` is not supported; save as `.docx` or PDF.
- The Markdown renderer escapes all HTML before formatting, so pasted responses cannot inject scripts.
