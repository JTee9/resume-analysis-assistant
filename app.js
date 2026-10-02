(function () {
'use strict';
const $ = id => document.getElementById(id);
const OPTIONS = [
 ['explain','Plain-English candidate explanation'],['skills','Technical skills and evidence analysis'],
 ['scope','Responsibilities and scope analysis'],['gaps','Information gaps'],
 ['questions','Clarifying interview questions'],['transfer','Transferable experience'],
 ['jdfit','Job description compatibility analysis'],['check','Recruiter verification checklist']];

/* ---------- Extraction modules (register more, e.g. OCR, in EXTRACTORS) ---------- */
const MIN_CHARS_PER_PAGE = 200;
const EXTRACTORS = {
  async pdf(file, progress) {
    if (!window.pdfjsLib) throw new Error('The PDF library did not load. Check your connection and reload.');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '';
    for (let p = 1; p <= pdf.numPages; p++) {           // original page order
      progress('Extracting page ' + p + ' of ' + pdf.numPages + '…');
      const tc = await (await pdf.getPage(p)).getTextContent();
      let t = '';
      tc.items.forEach(i => { t += i.str + (i.hasEOL ? '\n' : ' '); });
      out += (p > 1 ? '\n\n' : '') + '--- Page ' + p + ' ---\n' + t.trim();
    }
    return { text: out, pages: pdf.numPages };
  },
  async docx(file) {
    if (!window.mammoth) throw new Error('The Word library did not load. Check your connection and reload.');
    const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: r.value.trim(), pages: 1 };
  }
};

/* ---------- Status helpers ---------- */
function say(el, msg, kind) { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); }
const status = (m, k) => say($('status'), m, k);
const kb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const updateCount = () => { $('count').textContent = $('resume').value.length.toLocaleString() + ' characters'; };

/* ---------- Resume upload ---------- */
async function handleFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'doc') return status('Legacy .doc files are not supported. Please save the document as .docx or PDF and upload it again.', 'err');
  if (!EXTRACTORS[ext]) return status('Unsupported file type. Upload a .pdf or .docx file, or paste the text.', 'err');
  $('fileInfo').hidden = false;
  $('fileMeta').textContent = file.name + ' (' + kb(file.size) + ')';
  status('Reading ' + file.name + '…');
  try {
    const { text, pages } = await EXTRACTORS[ext](file, m => status(m));
    const real = text.replace(/--- Page \d+ ---/g, '').trim();
    $('resume').value = real ? text : '';
    updateCount();
    if (!real) return status('No readable text was found. This PDF may contain scanned images rather than selectable text. Please use OCR or paste the resume text manually.', 'err');
    if (real.length / pages < MIN_CHARS_PER_PAGE)
      return status('Extraction complete (' + real.length.toLocaleString() + ' characters), but this is very little text for ' + pages + ' page(s). Please verify that all resume content was captured.', 'warn');
    status('Extraction complete: ' + real.length.toLocaleString() + ' characters. Review and correct the text below before generating the prompt.', 'ok');
  } catch (e) {
    $('resume').value = ''; updateCount();
    if (e && e.name === 'PasswordException') status('This PDF is password-protected. Remove the password and upload it again, or paste the text.', 'err');
    else if (e && (e.name === 'InvalidPDFException' || e.name === 'FormatError')) status('This file appears to be corrupted or is not a valid PDF. Try re-saving it, or paste the text.', 'err');
    else status('Could not extract text: ' + (e && e.message ? e.message : 'unknown error') + '. You can paste the resume text manually.', 'err');
  }
}
function removeFile() { $('file').value = ''; $('fileInfo').hidden = true; status(''); }

/* ---------- Job descriptions ---------- */
let jdSeq = 0;
function addJd() {
  const n = ++jdSeq, d = document.createElement('div');
  d.className = 'jd';
  d.innerHTML = '<header><span class="jdTitle"></span><button class="ghost rm">Remove</button></header>' +
    '<div class="two"><div><label>Company (optional)</label><input type="text" class="co"></div>' +
    '<div><label>Job title (optional)</label><input type="text" class="ti"></div></div>' +
    '<label>Job description text</label><textarea class="body" rows="8"></textarea>';
  d.querySelector('.rm').onclick = () => { d.remove(); renumber(); if (!$('jds').children.length) addJd(); };
  $('jds').appendChild(d); renumber();
}
function renumber() { [...$('jds').children].forEach((d, i) => d.querySelector('.jdTitle').textContent = 'Job description ' + (i + 1)); }
const jdData = () => [...$('jds').children].map(d => ({ co: d.querySelector('.co').value.trim(), ti: d.querySelector('.ti').value.trim(), body: d.querySelector('.body').value.trim() })).filter(j => j.body);
const anyJdText = () => [...$('jds').querySelectorAll('input,textarea')].some(e => e.value.trim());
function resetJds() { $('jds').innerHTML = ''; addJd(); }

/* ---------- Prompt ---------- */
const HEAD = `### SYSTEM ROLE
You are an experienced technical recruitment research assistant supporting a specialist recruiter focused on: financial services technology; fintech; cloud infrastructure; enterprise technology; software engineering; infrastructure engineering; data engineering; technical customer-facing roles.
Your task is to help the recruiter understand the candidate's actual professional experience. You are not responsible for making final hiring decisions.

### CRITICAL ANALYSIS RULES
1. Do not invent experience, responsibilities, technologies, accomplishments, or qualifications.
2. Distinguish explicit facts from reasonable inferences.
3. Explain the evidence supporting each important inference.
4. Identify information that cannot be determined from the resume.
5. Do not assume that mentioning a technology means the candidate has hands-on expertise.
6. Distinguish between using, supporting, administering, implementing, designing, and architecting technologies.
7. Distinguish personal contributions from team accomplishments.
8. Do not infer seniority solely from job title or years of experience.
9. Do not assume project participation means project ownership.
10. Do not treat missing information as evidence of a lack of ability.
11. Avoid generic interview questions when specific questions can be derived from the resume.
12. Explain technical concepts in plain English where appropriate.
13. Do not make unsupported claims about personality, motivation, performance, or suitability.
14. Do not assign an overall candidate score.
15. Do not make a hiring recommendation based solely on the resume.
`;
const SECTIONS = {
 summary: ['Executive Summary','Explain in 3-5 sentences what the candidate most likely does professionally, the environment they work in, and their apparent responsibilities.'],
 does: ['What the Candidate Actually Does','Explain: systems, products, platforms, or services they work on; problems they appear to solve; typical responsibilities; teams and stakeholders they work with. Distinguish explicit facts from inference.'],
 skills: ['Technical Skills and Evidence','Create a table with columns: Technology or skill | Evidence from the resume | Practical interpretation | Apparent level of involvement | Confidence in interpretation | Information requiring verification.'],
 scope: ['Responsibilities and Scope','Analyze available evidence concerning: hands-on implementation versus operational support; individual versus team contributions; design and architecture; production ownership; project ownership; stakeholder interaction; technical decision-making; system scale and complexity. Clearly identify unknowns.'],
 gaps: ['Information Gaps','Identify the most important missing information needed to understand the candidate\'s experience. Prioritize gaps that could materially change the interpretation of their technical capabilities or responsibilities.'],
 questions: ['Clarifying Questions','Generate 8-12 targeted questions for an initial recruiter conversation. For each question, explain: what it is intended to uncover; why the information matters; what distinctions the recruiter should listen for. Questions should sound natural in a conversation rather than like a technical examination.'],
 transfer: ['Potential Transferable Experience','Identify potentially relevant experience for adjacent roles or industries. Explain the evidence supporting each connection and what must be verified. Do not make a suitability judgment.'],
 check: ['Recruiter Verification Checklist','List the five most important details to verify before presenting the candidate\'s experience to a client.'],
 limits: ['Confidence and Limitations','Summarize: what is clearly understood; what is reasonably inferred; what remains ambiguous; which missing details would most improve the analysis.']};
const MAP = { explain: ['summary','does'], skills: ['skills'], scope: ['scope'], gaps: ['gaps'], questions: ['questions'], transfer: ['transfer'], check: ['check'] };
const JD_RULES = `### JOB DESCRIPTION COMPARISON
First analyze the candidate independently. Then analyze each job description separately. For each role, provide:
1. Role title and company, if provided.
2. Main responsibilities and requirements.
3. Candidate experience directly supported by the resume.
4. Potentially transferable experience.
5. Requirements for which evidence is insufficient.
6. Potential experience gaps.
7. Clarifying questions to resolve those gaps.
8. Overall compatibility discussion in qualitative terms, without assigning a numerical score or making a definitive hiring decision.
Do not assume that a missing resume detail means the candidate lacks that skill.
`;

function buildPrompt(resume, jds, sel) {
  const keys = []; sel.forEach(s => (MAP[s] || []).forEach(k => keys.push(k))); keys.push('limits');
  const wantJd = sel.includes('jdfit') && jds.length;
  let n = 0;
  let p = HEAD + '\n### INPUT DOCUMENTS\n\n=== CANDIDATE RESUME ===\n' + resume + '\n=== END CANDIDATE RESUME ===\n';
  jds.forEach((j, i) => {
    p += '\n=== JOB DESCRIPTION ' + (i + 1) + (j.ti || j.co ? ': ' + [j.ti, j.co].filter(Boolean).join(' at ') : '') + ' ===\n' + j.body + '\n=== END JOB DESCRIPTION ' + (i + 1) + ' ===\n';
  });
  p += '\n### REQUESTED ANALYSIS SECTIONS\nProvide only the following sections, in this order, using Markdown headings and tables where specified.\n\n';
  keys.forEach(k => { p += '#### ' + (++n) + '. ' + SECTIONS[k][0] + '\n' + SECTIONS[k][1] + '\n\n'; });
  if (wantJd) p += JD_RULES;
  else if (jds.length) p += 'Job descriptions were provided for context only; do not produce a role comparison.\n';
  return p;
}

/* ---------- Markdown (escape first, so no raw HTML ever survives) ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
function md(src) {
  const L = src.replace(/\r/g, '').split('\n'); let h = '', i = 0, list = null;
  const close = () => { if (list) { h += '</' + list + '>'; list = null; } };
  while (i < L.length) {
    const t = L[i].trim(); let m;
    if (/^\|.*\|$/.test(t) && /^\|[\s:|-]+\|$/.test((L[i + 1] || '').trim())) {
      close(); const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      h += '<table><thead><tr>' + row(t).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>'; i += 2;
      while (i < L.length && /^\|.*\|$/.test(L[i].trim())) { h += '<tr>' + row(L[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'; i++; }
      h += '</tbody></table>'; continue;
    }
    if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { close(); h += '<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>'; }
    else if ((m = t.match(/^[-*]\s+(.*)$/))) { if (list !== 'ul') { close(); h += '<ul>'; list = 'ul'; } h += '<li>' + inline(m[1]) + '</li>'; }
    else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); h += '<ol>'; list = 'ol'; } h += '<li>' + inline(m[1]) + '</li>'; }
    else if (/^(-{3,}|\*{3,})$/.test(t)) { close(); h += '<hr>'; }
    else if (t) { close(); h += '<p>' + inline(t) + '</p>'; }
    else close();
    i++;
  }
  close(); return h;
}

/* ---------- Downloads / clipboard ---------- */
function download(name, text, type) {
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type }));
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
async function copy() {
  const t = $('prompt').value, g = $('genStatus');
  try { await navigator.clipboard.writeText(t); say(g, 'Prompt copied. Paste it into your LLM.', 'ok'); }
  catch (e) { $('prompt').select(); say(g, 'Automatic copy was blocked. The prompt is selected: press Ctrl+C (Cmd+C on Mac).', 'warn'); }
}

/* ---------- Wiring ---------- */
$('opts').innerHTML = OPTIONS.map(o => '<label><input type="checkbox" value="' + o[0] + '" checked> ' + o[1] + '</label>').join('');
$('file').addEventListener('change', e => e.target.files[0] && handleFile(e.target.files[0]));
$('removeFile').onclick = () => { if (!$('resume').value || confirm('Remove the file and clear the extracted text?')) { removeFile(); $('resume').value = ''; updateCount(); } };
$('resume').addEventListener('input', updateCount);
$('addJd').onclick = addJd;
$('clearJds').onclick = () => { if (!anyJdText() || confirm('Clear all job descriptions?')) resetJds(); };
$('gen').onclick = () => {
  const g = $('genStatus'), resume = $('resume').value.trim(), sel = [...$('opts').querySelectorAll('input:checked')].map(c => c.value);
  if (!resume) return say(g, 'Add resume text first: upload a file or paste it above.', 'err');
  if (!sel.length) return say(g, 'Select at least one analysis option.', 'err');
  $('prompt').value = buildPrompt(resume, jdData(), sel); $('prompt').readOnly = true;
  $('promptBox').hidden = false;
  say(g, 'Prompt generated (' + $('prompt').value.length.toLocaleString() + ' characters).', 'ok');
};
$('copy').onclick = copy;
$('dlPrompt').onclick = () => download('analysis-prompt-' + stamp() + '.txt', $('prompt').value, 'text/plain');
$('editPrompt').onclick = () => { $('prompt').readOnly = false; $('prompt').focus(); say($('genStatus'), 'Prompt is now editable.'); };
$('fmt').onclick = () => {
  const r = $('resp').value.trim();
  if (!r) { $('out').hidden = true; return; }
  $('out').innerHTML = md(r); $('out').hidden = false;
};
$('clrResp').onclick = () => { if (!$('resp').value || confirm('Clear the pasted response?')) { $('resp').value = ''; $('out').innerHTML = ''; $('out').hidden = true; } };
$('dlMd').onclick = () => $('resp').value.trim() && download('analysis-' + stamp() + '.md', $('resp').value, 'text/markdown');
$('dlTxt').onclick = () => $('resp').value.trim() && download('analysis-' + stamp() + '.txt', $('resp').value, 'text/plain');
$('clearAll').onclick = () => {
  const has = $('resume').value || anyJdText() || $('prompt').value || $('resp').value;
  if (has && !confirm('Clear the resume, job descriptions, prompt, and analysis? This cannot be undone.')) return;
  removeFile(); $('resume').value = ''; $('prompt').value = ''; $('promptBox').hidden = true; say($('genStatus'), '');
  $('resp').value = ''; $('out').innerHTML = ''; $('out').hidden = true; resetJds(); updateCount();
  $('opts').querySelectorAll('input').forEach(c => c.checked = true);
};
addJd();
})();
