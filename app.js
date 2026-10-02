(function () {
'use strict';
const $ = id => document.getElementById(id);
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
const BRIEF = `### OUTPUT REQUIREMENTS
Produce a concise recruiter working brief, not a comprehensive report. Follow the exact structure and limits below. Do not add an introduction, conclusion, methodology section, glossary, or extra headings.

#### 1. Candidate Snapshot
* Provide 3-4 concise bullets describing the candidate's actual professional background.
* Prioritize recent experience, core areas of expertise, and level/scope of responsibility where supported.
* Do not use generic praise or repeat resume wording unnecessarily.

#### 2. Core Experience
* Provide no more than 5-7 bullets.
* Include only significant skills, responsibilities, and experience relevant to the supplied job description(s), or essential to understanding the candidate's background.
* Each bullet must connect an area of experience to specific resume evidence.
* Distinguish hands-on implementation, support, administration, design, and architecture when the evidence allows.
* Do not list every technology mentioned in the resume.
* Do not repeat information already clearly stated in the Candidate Snapshot. If a detail is important in both places, explain it only once.

#### 3. Role Comparison
Create one subsection for each supplied job description, using the job title and company name if available. For each role, include only these four labels:
* **Relevant evidence:** 2-4 bullets connecting specific resume evidence to important role requirements.
* **Unclear or unverified:** 1-3 bullets identifying material requirements or responsibilities that the resume does not establish.
* **Potential concerns:** Include only material, evidence-based gaps or mismatches. Omit this label if none are apparent. Do not treat missing resume detail as proof that the candidate lacks a skill.
* **Overall read:** 1-2 concise sentences describing the apparent alignment and the most important uncertainty. Do not provide a numeric score, ranking, or definitive hiring recommendation.
Do not repeat the Candidate Snapshot or Core Experience in each role comparison. Refer to relevant experience briefly and focus on what is specifically important for that role.

#### 4. Questions to Clarify
* Provide 5-7 questions maximum across the entire report, not per job description.
* Prioritize questions that could materially change the role comparison.
* Write questions naturally, as a recruiter would ask them during a screening call.
* Add a brief **Purpose** after each question.
* Do not ask for information already clearly provided in the resume.
* Combine overlapping questions.
* If multiple roles are supplied, prioritize questions that are useful across roles, then include role-specific questions where necessary.

#### 5. Recruiter Takeaway
Finish with exactly three concise bullets:
* **Explore:** The most relevant experience to discuss.
* **Verify:** The most important uncertainty to resolve.
* **Next step:** The recommended focus for the screening conversation.

### CONCISION AND EVIDENCE RULES
* Use plain English and concise bullets. Avoid long paragraphs and elaborate tables.
* Prefer specific evidence over generic descriptions.
* Do not repeat the same fact, skill, project, or responsibility across multiple sections unless necessary to explain a distinct role-specific implication.
* Do not restate job requirements without connecting them to candidate evidence.
* Do not include generic explanations of technologies unless needed to clarify the candidate's actual responsibilities.
* Do not infer expertise from a technology name alone.
* Distinguish explicit resume facts from reasonable interpretations and unknowns.
* Do not invent experience, responsibilities, achievements, seniority, or qualifications.
* Missing information is an item to clarify, not automatically a deficiency.
* If a section has no meaningful information, state "Not established in the resume" briefly or omit optional labels as instructed.
* Respect the bullet limits. Do not add extra content simply to make the report appear comprehensive.
`;

function buildPrompt(resume, jds) {
  let p = HEAD + '\n### INPUT DOCUMENTS\n\n=== CANDIDATE RESUME ===\n' + resume + '\n=== END CANDIDATE RESUME ===\n';
  jds.forEach((j, i) => {
    p += '\n=== JOB DESCRIPTION ' + (i + 1) + (j.ti || j.co ? ': ' + [j.ti, j.co].filter(Boolean).join(' at ') : '') + ' ===\n' + j.body + '\n=== END JOB DESCRIPTION ' + (i + 1) + ' ===\n';
  });
  p += '\n' + BRIEF;
  if (!jds.length) p += '\nNo job descriptions were supplied. Omit section 3 (Role Comparison) entirely and base the questions and takeaway on the resume alone.\n';
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
$('file').addEventListener('change', e => e.target.files[0] && handleFile(e.target.files[0]));
$('removeFile').onclick = () => { if (!$('resume').value || confirm('Remove the file and clear the extracted text?')) { removeFile(); $('resume').value = ''; updateCount(); } };
$('resume').addEventListener('input', updateCount);
$('addJd').onclick = addJd;
$('clearJds').onclick = () => { if (!anyJdText() || confirm('Clear all job descriptions?')) resetJds(); };
$('gen').onclick = () => {
  const g = $('genStatus'), resume = $('resume').value.trim();
  if (!resume) return say(g, 'Add resume text first: upload a file or paste it above.', 'err');
  $('prompt').value = buildPrompt(resume, jdData()); $('prompt').readOnly = true;
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
};
addJd();
})();
