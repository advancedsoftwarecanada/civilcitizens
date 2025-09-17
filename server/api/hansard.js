// @ts-nocheck
/* global Meteor, WebApp, UserMeta, Chambers, Posts, Scrapes, Accounts */

const { WebApp } = require('meteor/webapp');
const { Accounts } = require('meteor/accounts-base');
const { HTTP } = require('meteor/http');

// Reuse admin token logic similar to server/api/admin.js
function getAdminToken() {
  try {
    if (process.env.ADMIN_API_TOKEN) return process.env.ADMIN_API_TOKEN;
    if (Meteor.settings && Meteor.settings.private && Meteor.settings.private.adminApiToken) {
      return Meteor.settings.private.adminApiToken;
    }
  } catch (e) {}
  return null;
}

function getBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function authAdminOrAdminUser(req) {
  const provided = getBearerToken(req);
  const staticToken = getAdminToken();
  if (staticToken && provided === staticToken) return { ok: true, userId: null, via: 'static' };
  if (!provided) return { ok: false };
  try {
    const hashedToken = Accounts._hashLoginToken(provided);
    const user = await Meteor.users.findOneAsync({ 'services.resume.loginTokens.hashedToken': hashedToken });
    if (!user) return { ok: false };
    const meta = await UserMeta.findOneAsync({ ownerUserId: user._id });
    if (meta && meta.admin === true) return { ok: true, userId: user._id, via: 'user' };
  } catch (e) {}
  return { ok: false };
}

function writeJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[\u2013\u2014]/g, '-') // en/em dash to hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeConstituency(str) {
  // Normalize riding names for matching
  return normalizeText(str).replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').replace(/ /g, '-');
}

// Remove accents but keep case; drop non-alphanumerics for hashtag safety
function stripAccentsKeepCase(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .trim();
}

function hashtagForMp(firstName, lastName) {
  const f = stripAccentsKeepCase(firstName || '').replace(/[^A-Za-z0-9]/g, '');
  const l = stripAccentsKeepCase(lastName || '').replace(/[^A-Za-z0-9]/g, '');
  return `#Mp${f}${l}`;
}

function mapPartyFull(partyRaw) {
  const p = (partyRaw || '').trim();
  const q = p.toLowerCase();
  if (!p) return 'None';
  if (/\b(bq|bloc)\b/.test(q) || /québécois|quebecois/.test(q)) return 'Bloc Québécois (BQ)';
  if (/\b(cpc|conservative)\b/.test(q)) return 'Conservative Party of Canada (CPC)';
  if (/\b(lpc|lib\.?|liberal)\b/.test(q)) return 'Liberal Party of Canada (LPC)';
  if (/\b(ndp|new democratic)\b/.test(q)) return 'New Democratic Party (NDP)';
  if (/\bgreen\b/.test(q)) return 'Green Party of Canada (Green)';
  if (/\b(ind|independent)\b/.test(q)) return 'Independent (Ind.)';
  return p;
}

// Try to parse Parl-Session and Sitting from a standard Hansard URL path like
// /Content/House/451/Debates/021/HAN021-E.XML
function deriveParlSessAndSittingFromUrl(url) {
  try {
    const u = String(url || '');
    // Match 3-digit ParlSess like 451 where 45=Parliament, 1=Session
    const m = u.match(/\/House\/(\d{3})\/Debates\/(\d{3})\//i);
    if (!m) return { parlSess: '', sitting: '' };
    const code = m[1];
    const parl = code.slice(0, 2).replace(/^0+/, '') || code.slice(0, 2);
    const sess = code.slice(2);
    const sitting = m[2];
    return { parlSess: `${parl}-${sess}`, sitting };
  } catch {
    return { parlSess: '', sitting: '' };
  }
}

async function buildChamberIndex() {
  // Build indexes for chamber lookup by riding slug and by current member name
  const list = await Chambers.find({}, { fields: { province: 1, name: 1, seoUrl: 1, currentMember: 1, constituencyId: 1 } }).fetchAsync();
  const bySlug = new Map();
  const byMember = new Map();
  const byLastName = new Map();
  for (const ch of list) {
    const slug = (ch.seoUrl || normalizeConstituency(ch.name || ''));
    bySlug.set(slug, ch);
    // Index by current member name (if present)
    const cm = ch.currentMember;
    if (cm && (cm.name || (cm.firstName && cm.lastName))) {
      const name = (cm.name || `${cm.firstName || ''} ${cm.lastName || ''}`).trim();
      const norm = normalizeText(name).replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
      if (norm) byMember.set(norm, ch);
      // Also index last name only as a weak fallback, but only if unique
      const parts = norm.split(' ').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && !byMember.has(last)) byMember.set(last, ch);
      const normLast = (cm.lastName ? normalizeText(cm.lastName).replace(/[^a-z0-9\s-]/g,'').trim() : last);
      if (normLast) {
        if (!byLastName.has(normLast)) byLastName.set(normLast, []);
        byLastName.get(normLast).push(ch);
      }
    }
  }
  return { bySlug, byMember, byLastName, list };
}

function getCivilAuthorIdCached() {
  if (!global.__CIVIL_USER_CACHE) global.__CIVIL_USER_CACHE = { ts: 0, id: null };
  const now = Date.now();
  if (global.__CIVIL_USER_CACHE.ts && now - global.__CIVIL_USER_CACHE.ts < 5 * 60 * 1000) {
    return global.__CIVIL_USER_CACHE.id;
  }
  return null;
}

async function resolveCivilAuthorUser() {
  const cached = getCivilAuthorIdCached();
  if (cached) return { id: cached, via: 'cache' };
  // Prefer a hardcoded Civil user by profile.userName
  try {
    const civilUser = await Meteor.users.findOneAsync({ 'profile.userName': 'Civil' }, { fields: { _id: 1 } });
    if (civilUser && civilUser._id) {
      global.__CIVIL_USER_CACHE = { ts: Date.now(), id: civilUser._id };
      return { id: civilUser._id, via: 'user.profile.userName' };
    }
  } catch (e) {}
  // Look for a system user meta; fallback to first admin
  let civil = await UserMeta.findOneAsync({ system: true, userName: { $regex: /^civil/i } });
  if (civil && civil.ownerUserId) {
    global.__CIVIL_USER_CACHE = { ts: Date.now(), id: civil.ownerUserId };
    return { id: civil.ownerUserId, via: 'system' };
  }
  civil = await UserMeta.findOneAsync({ admin: true });
  if (civil && civil.ownerUserId) {
    global.__CIVIL_USER_CACHE = { ts: Date.now(), id: civil.ownerUserId };
    return { id: civil.ownerUserId, via: 'admin-fallback' };
  }
  return { id: null, via: 'none' };
}

function dedupeKeyFromContext(ctx) {
  // Create a unique key for this intervention to prevent duplicates
  // Prefer Parliament IDs if available
  const parts = [
    ctx.ParliamentNumber || ctx.ParliamentSession || ctx.Parliament || 'P?',
    ctx.SessionNumber || ctx.Session || 'S?',
    ctx.SittingNumber || ctx.Sitting || 'Sit?',
    ctx.InterventionId || ctx.Sequence || ctx.Position || ctx.Guid || ctx.Url || Math.random().toString(36).slice(2)
  ];
  return parts.map(x => String(x || '').trim()).join(':');
}

function extractPlain(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
// Robustly extract human-readable text from a Hansard intervention object.
function getInterventionText(iv) {
  // Known simple shapes first
  if (iv.Paragraph) {
    const paras = Array.isArray(iv.Paragraph) ? iv.Paragraph : [iv.Paragraph];
    const joined = paras.map(p => (typeof p === 'string' ? p : (p['#text'] || ''))).filter(Boolean).join('\n\n');
    if (joined && joined.trim().length) return joined;
  }
  if (iv.Text) {
    const t = (typeof iv.Text === 'string' ? iv.Text : (iv.Text['#text'] || ''));
    if (t && t.trim().length) return t;
  }
  if (iv.Body) {
    const b = extractPlain(iv.Body);
    if (b && b.trim().length) return b;
  }
  // Other common nesting patterns
  const candidates = [iv.Content, iv.InterventionText, iv.Speech, iv.Statement, iv.Transcript, iv.Block, iv.P, iv.p];
  for (const cand of candidates) {
    if (!cand) continue;
    if (typeof cand === 'string') { if (cand.trim().length) return cand; }
    const arr = Array.isArray(cand) ? cand : [cand];
    const joined = arr.map(x => {
      if (!x) return '';
      if (typeof x === 'string') return x;
      return (x['#text'] || x.Text || '');
    }).filter(Boolean).join('\n\n');
    if (joined && joined.trim().length) return joined;
  }
  // Generic deep traversal fallback: concatenate string leaves
  // Skip PersonSpeaking and obvious metadata keys, but allow Affiliation text in Content (e.g., "Prime Minister")
  const skipKeys = new Set(['PersonSpeaking','Speaker','MP','Member','Party','Constituency','Riding','FirstName','LastName','Name']);
  let result = '';
  let count = 0;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (skipKeys.has(k)) continue;
      const v = o[k];
      if (v == null) continue;
      if (typeof v === 'string') {
        const s = v.trim();
        if (s) { result += (result ? '\n' : '') + s; count += s.length; if (count > 2000) return; }
      } else if (typeof v === 'object') {
        const txt = v['#text'];
        if (typeof txt === 'string' && txt.trim()) {
          const s = txt.trim(); result += (result ? '\n' : '') + s; count += s.length; if (count > 2000) return;
        } else {
          walk(v);
          if (count > 2000) return;
        }
      }
    }
  })(iv);
  return result.trim();
}

// =========================
// AI Summarization Helpers
// =========================

function getOpenAiConfig() {
  const s = (Meteor.settings && Meteor.settings.private) || {};
  const provider = (s.openAiProvider || process.env.OPENAI_PROVIDER || '').toString().toLowerCase();
  const isGrok = provider === 'grok' || /\bx\.ai|api\.x\.ai\b/i.test(String(s.openAiEndpoint || process.env.OPENAI_AZURE_ENDPOINT || ''));
  // Provider-specific defaults
  const endpoint = isGrok
    ? (s.openAiEndpoint || process.env.GROK_ENDPOINT || process.env.XAI_ENDPOINT || 'https://api.x.ai/v1/chat/completions')
    : (s.openAiEndpoint || process.env.OPENAI_AZURE_ENDPOINT || '');
  const apiKey = isGrok
    ? (s.openaiApiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.XAI_TOKEN || '')
    : (s.openaiApiKey || process.env.OPENAI_AZURE_API_KEY || '');
  const model = isGrok
    ? (s.openAiModel || process.env.GROK_MODEL || 'grok-2')
    : (s.openAiModel || 'gpt-4o-2024-08-06');
  return {
    provider: isGrok ? 'grok' : 'azure',
    endpoint,
    apiKey,
    model,
    maxTokens: Math.max(512, Math.min(4096, Number(s.openAiMaxTokens) || 1024)),
    // Behavior defaults: always try AI; allow opt-out via settings if explicitly set to false
    replaceBodyWithSummary: s.openAiReplaceBodyWithSummary !== false, // default true
    inline: s.openAiInline !== false, // default true (attempt inline summary before insert)
    log: s.openAiLog !== false // default true for visibility
  };
}

function buildSummaryPrompt({ fullNameAccent, firstName, lastName, hashtag, party, riding, provinceCode, roleDefault, bodyText, sourceParlSess, sourceSitting, sourceInterventionId, sourceLink }) {
  const partyFull = mapPartyFull(party);
  const prov = (provinceCode || '').toString().toUpperCase();
  const intro = [
    'Summarize the Canadian House of Commons intervention for everyday citizens. Use Schema v1.1. Neutral, factual, concise.',
    `Begin Summary with ${hashtag} then 1–2 sentences naming ${fullNameAccent} and the core point.`,
  ].join(' ');

  const schema = 'Return ONLY JSON with these keys exactly: { "Summary", "Party Alignment", "Riding", "Role", "Topic Tags", "Stance / Ask", "Bill / Motion / Program", "Impact on Citizens", "Notable Quote", "Party Alignment Analysis", "Party Alignment Index", "Source" }';

  const fieldRules = [
    '- Summary: Start with the provided hashtag, then 1–2 neutral sentences naming the MP with accents and the core point.',
    '- Party Alignment: Use full party name plus abbreviation, e.g., "Bloc Québécois (BQ)".',
    '- Riding: "Name, PROV" (province code).',
    '- Role: One of: MP | Minister | Parliamentary Secretary | Shadow Critic. Default to MP unless text clearly indicates otherwise.',
    '- Topic Tags: ≤3 from a fixed civic set (e.g., Citizenship, Rights, Justice, Immigration, Economy, Health, Environment).',
    '- Stance / Ask: One of Support | Oppose | Criticize | Propose | Question, plus a short “re: X”.',
    '- Bill / Motion / Program: "Bill C-###" if present (patterns: "Bill C-\\d+" or "projet de loi C-\\d+"), else "None".',
    '- Impact on Citizens: ≤2 bullets with practical effects. Include any crucial numbers within the bullet text when directly tied to citizen impact.',
    '- Notable Quote: ≤20 words, safest succinct line.',
    '- Party Alignment Analysis: 1 short sentence on how the member’s remarks align or diverge from their party’s known stance (if clear in text). If unclear, "None".',
    '- Party Alignment Index: A single value "X/10" where 0 = fully not aligned and 10 = strongly aligned. If unclear, use "N/A".',
    '- Source: "{Parl-Session}, Sitting {NNN}, Intervention ID {ID}, {link}".'
  ].join('\n');

  const metadata = [
    'Metadata (authoritative for those fields even if not in text):',
    `- MP Name: ${fullNameAccent}`,
    `- Hashtag: ${hashtag}`,
    `- Party Alignment: ${partyFull}`,
    `- Riding: ${riding || 'None'}, ${prov || 'None'}`,
    `- Default Role: ${roleDefault || 'MP'}`,
    `- Source: ${sourceParlSess || 'None'}, Sitting ${sourceSitting || '???'}, Intervention ID ${sourceInterventionId || '???'}, ${sourceLink || 'None'}`,
  ].join('\n');

  const heuristics = [
    'Extraction Heuristics:',
    '- Party mapping: map BQ, CPC, Lib., LPC, NDP, Bloc, Green, Ind. to full names + abbreviations as above.',
    '- Bill detection: look for “Bill C-#” or “projet de loi C-#”.',
    '- Do not fabricate numbers; only include those present in the text and tie them to Impact when relevant.',
    "- If a field isn’t present, write 'None'. No guessing.",
  ].join('\n');

  const guardrails = [
    'Hallucination Guardrails:',
    "- Don’t infer motives, timelines, or costs not in text.",
    '- Quote numbers exactly; if ranges appear, keep the range.',
    '- Keep tone neutral; avoid labels or sarcasm.',
    'Use Canadian spellings.'
  ].join('\n');

  const content = `---------------\n\n${bodyText}`;
  const user = [intro, schema, fieldRules, metadata, heuristics, guardrails, content].join('\n\n');
  return user;
}

function renderSummaryHtml(data, opts = {}) {
  try {
    const get = (k) => (data && (data[k] != null)) ? data[k] : '';
    const asList = (val) => Array.isArray(val) ? val : (val ? String(val).split(/[\n;]+/).map(x=>x.trim()).filter(Boolean) : []);
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const bullets = (arr) => arr && arr.length ? `<ul>${arr.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : '<p>None</p>';
    const impacts = asList(get('Impact on Citizens'));
    const tagsArr = (() => {
      const v = get('Topic Tags');
      if (Array.isArray(v)) return v;
      const s = String(v || '');
      return s.split(/[\n;,]+/).map(x => x.trim()).filter(Boolean);
    })();
    const tags = tagsArr.length ? tagsArr.map(t => {
      const clean = String(t).replace(/^#+/, '').trim();
      return clean ? `#${clean.replace(/\s+/g, '')}` : '';
    }).filter(Boolean).join(' ') : '';
    const toParagraphs = (txt) => {
      const raw = String(txt || '').replace(/\r\n/g, '\n');
      const chunks = raw.split(/\n{2,}|\r?\n\s*\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!chunks.length && raw.trim()) return `<p>${esc(raw.trim())}</p>`;
      return chunks.map(p => `<p>${esc(p)}</p>`).join('\n');
    };
    const parts = [
      `<p><strong>Summary:</strong> ${esc(get('Summary'))}</p>`,
      '<hr />',
      `<p><strong>Party Alignment:</strong> ${esc(get('Party Alignment'))}</p>`,
      `<p><strong>Riding:</strong> ${esc(get('Riding'))}</p>`,
      `<p><strong>Role:</strong> ${esc(get('Role'))}</p>`,
      `<p><strong>Topic Tags:</strong> ${esc(tags || 'None')}</p>`,
      `<p><strong>Stance / Ask:</strong> ${esc(get('Stance / Ask') || 'None')}</p>`,
      `<p><strong>Bill / Motion / Program:</strong> ${esc(get('Bill / Motion / Program') || 'None')}</p>`,
      `<div><strong>Impact on Citizens:</strong> ${impacts.length ? '' : 'None'}${impacts.length ? bullets(impacts) : ''}</div>`,
      `<p><strong>Notable Quote:</strong> “${esc(get('Notable Quote') || 'None')}”</p>`,
      (() => {
        const ana = get('Party Alignment Analysis');
        const idx = get('Party Alignment Index');
        const hasAna = ana && String(ana).trim().length;
        const hasIdx = idx && String(idx).trim().length;
        if (!hasAna && !hasIdx) return '';
        return `<p><strong>Party Alignment Analysis:</strong> ${hasAna ? esc(ana) : 'None'}${hasIdx ? ` &nbsp; | &nbsp; <strong>Party Alignment Index:</strong> ${esc(idx)}` : ''}</p>`;
      })(),
      `<p><strong>Source:</strong> ${esc(get('Source') || '')}</p>`
    ];
  // Visual separators for Summernote: add a separator before the transcript section
  parts.push('<hr />');
    // Optional Full Transcript block
    if (opts && opts.transcript) {
      parts.push(`<p><strong>Full Transcript:</strong></p>`);
      parts.push(toParagraphs(opts.transcript));
    }
    return parts.join('\n');
  } catch (e) {
    return '';
  }
}

async function requestOpenAiSummary(messages, { endpoint, apiKey, model, maxTokens, provider }) {
  if (!endpoint || !apiKey) throw new Error('OpenAI endpoint/apiKey missing');
  // Use Meteor HTTP to align with existing code and Azure header pattern
  const response = await new Promise((resolve, reject) => {
    const isGrok = provider === 'grok' || /\bapi\.x\.ai\b/i.test(String(endpoint));
    const headers = isGrok
      ? { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      : { 'api-key': apiKey, 'Content-Type': 'application/json' };
    const data = { model, messages, max_tokens: maxTokens };
    HTTP.post(endpoint, {
      headers,
      data,
      timeout: 30000,
    }, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
  });
  const choice = response && response.data && response.data.choices && response.data.choices[0];
  const content = (choice && choice.message && choice.message.content) || '';
  const cleaned = String(content).replace(/```json|```/g, '').trim();
  try {
    const json = JSON.parse(cleaned);
    return { ok: true, data: json, raw: cleaned, model, usage: response.data.usage || null };
  } catch (e) {
    return { ok: false, error: 'json-parse-failed', raw: cleaned };
  }
}

function maybeQueueSummary({ postId, post, speakerName, party, riding, role, source }) {
  try {
    const cfg = getOpenAiConfig();
    // Skip background if inline summary already exists on this post object
    if (post && post.aiSummary && post.aiSummary.inline) {
      if (cfg.log) console.log('[Hansard][AI] Skipping background summary: inline already performed for post', postId);
      return;
    }
    if (!cfg.endpoint || !cfg.apiKey) { if (cfg.log) console.warn('[Hansard][AI] Skipping summary: missing endpoint/apiKey'); return; }
    const plain = extractPlain(post.body || '');
    if (!plain || plain.length < 40) { if (cfg.log) console.log('[Hansard][AI] Skipping summary: body too short'); return; }
  const fullNameAccent = speakerName || 'None';
  const parts = (fullNameAccent || '').trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  const hashtag = hashtagForMp(firstName, lastName);
  const m = (source || '').match(/^(\d+)-(\d+),\s*Sitting\s*(\d+),\s*Intervention ID\s*(\S+)/i);
  const sourceParlSess = m ? `${m[1]}-${m[2]}` : '';
  const sourceSitting = m ? String(m[3]).padStart(3, '0') : '';
  const sourceInterventionId = m ? m[4] : '';
  const sourceLink = (post && post.hansardMeta && post.hansardMeta.sourceUrl) ? post.hansardMeta.sourceUrl : '';
  const provinceCode = (post && post.province) ? String(post.province).toUpperCase() : '';
  const prompt = buildSummaryPrompt({ fullNameAccent, firstName, lastName, hashtag, party, riding, provinceCode, roleDefault: role || 'MP', bodyText: plain, sourceParlSess, sourceSitting, sourceInterventionId, sourceLink });
    const messages = [
      { role: 'system', content: 'You are a neutral Canadian civic assistant. Keep summaries concise, factual, and helpful to everyday citizens.' },
      { role: 'user', content: prompt },
    ];
    // Fire-and-forget to avoid blocking ingestion
    setTimeout(async () => {
      try {
        if (cfg.log) console.log('[Hansard][AI] Requesting summary for post', postId);
        const result = await requestOpenAiSummary(messages, cfg);
        if (result && result.ok) {
          const set = { aiSummary: { createdAt: Date.now(), model: cfg.model, data: result.data } };
          if (cfg.replaceBodyWithSummary) {
            const transcript = (post && post.hansardMeta && post.hansardMeta.transcript) ? post.hansardMeta.transcript : extractPlain(post.body || '');
            const html = renderSummaryHtml(result.data, { transcript });
            if (html && html.length > 0) set.body = html;
          }
          await Posts.updateAsync({ _id: postId }, { $set: set });
          if (cfg.log) console.log('[Hansard][AI] Summary stored for post', postId);
        } else {
          await Posts.updateAsync({ _id: postId }, { $set: { aiSummaryError: { createdAt: Date.now(), error: result.error || 'unknown', raw: result.raw || null } } });
          if (cfg.log) console.warn('[Hansard][AI] Summary failed for post', postId, result && result.error);
        }
      } catch (e) {
        try { await Posts.updateAsync({ _id: postId }, { $set: { aiSummaryError: { createdAt: Date.now(), error: e.message || String(e) } } }); } catch(_) {}
        if (cfg.log) console.error('[Hansard][AI] Error summarizing post', postId, e && e.message);
      }
    }, 0);
  } catch (_) {}
}

// Parse PersonSpeaking.Affiliation text like: "Firstname Lastname (Riding Name, PARTY)"
function parseAffiliationText(txt) {
  if (!txt || typeof txt !== 'string') return {};
  const raw = txt.trim().replace(/\s+/g, ' ');
  const m = raw.match(/^([^()]+?)\s*\(([^)]*)\)\s*$/);
  let name = raw, constituencyName = '', party = '';
  if (m) {
    name = m[1].trim();
    const inside = m[2].trim();
    const parts = inside.split(',').map(x => x.trim()).filter(Boolean);
    if (parts.length >= 1) constituencyName = parts[0];
    if (parts.length >= 2) party = parts[1];
  }
  const bits = name.split(' ').filter(Boolean);
  const lastName = bits.length ? bits[bits.length - 1] : '';
  const firstName = bits.length > 1 ? bits.slice(0, -1).join(' ') : '';
  return { name, firstName, lastName, constituencyName, party };
}

// Extract speaker info from various shapes, prioritizing PersonSpeaking.Affiliation Type="2"
function parseSpeakerFromIntervention(iv) {
  const s = iv.PersonSpeaking || iv.Speaker || iv.MP || iv.Member || {};
  let firstName = (s.FirstName || s.Forename || s.GivenName || '').toString().trim();
  let lastName = (s.LastName || s.Surname || s.FamilyName || '').toString().trim();
  let name = (s.Name || iv.SpeakerName || '').toString().trim();
  let party = '';
  let caucus = (s.Caucus || '').toString().trim();
  let constituencyName = (s.Constituency || s.Riding || iv.Constituency || iv.Riding || '').toString().trim();
  let constituencyId = (s.ConstituencyId || s.RidingId || s['@_ConstituencyId'] || s['@_RidingId'] || null);

  // Affiliation may be string/object/array
  const aff = s.Affiliation;
  let chosen = null;
  if (Array.isArray(aff)) {
    // Prefer Type="2" if present, else first with #text
    chosen = aff.find(a => a && (a['@_Type'] === '2' || a['@_type'] === '2')) || aff.find(a => typeof a === 'string' || (a && typeof a['#text'] === 'string')) || null;
  } else if (aff) {
    chosen = aff;
  }
  let affText = '';
  if (chosen) {
    if (typeof chosen === 'string') affText = chosen;
    else if (typeof chosen['#text'] === 'string') affText = chosen['#text'];
  }
  if (affText) {
    const parsed = parseAffiliationText(affText);
    // Only fill when missing to respect explicit fields
    if (!firstName && parsed.firstName) firstName = parsed.firstName;
    if (!lastName && parsed.lastName) lastName = parsed.lastName;
    if (!name && parsed.name) name = parsed.name;
    if (!constituencyName && parsed.constituencyName) constituencyName = parsed.constituencyName;
    if (!party && parsed.party) party = parsed.party;
  }
  // Party fallback from Party element variants
  if (!party) party = (typeof s.Party === 'string' ? s.Party : (s.Party && s.Party['#text'])) || '';
  return { firstName, lastName, name, party, caucus, constituencyName, constituencyId };
}

function matchesStrict(ch, sp) {
  if (!ch || !ch.currentMember) return false;
  const cm = ch.currentMember;
  const cmFirst = (cm.firstName || (cm.name ? cm.name.split(' ')[0] : '')).toString();
  const cmLast = (cm.lastName || (cm.name ? cm.name.split(' ').slice(-1)[0] : '')).toString();
  const cmCaucus = (cm.caucus || cm.party || '').toString();
  const cmConstId = ch.constituencyId || cm.constituencyId || null;
  const cmConstName = (cm.constituencyName || ch.name || ch.seoUrl || '').toString();

  const spFirst = sp.firstName || (sp.name ? sp.name.split(' ')[0] : '');
  const spLast = sp.lastName || (sp.name ? sp.name.split(' ').slice(-1)[0] : '');
  if (!spLast) return false; // require last name

  const nf = normalizeText(spFirst);
  const nl = normalizeText(spLast);
  const cmf = normalizeText(cmFirst);
  const cml = normalizeText(cmLast);
  if (!nl || !cml || nl !== cml) return false; // last name must match exactly
  // first name must match or be an initial that matches
  if (nf && cmf && nf[0] !== cmf[0]) return false;

  // require at least one of: exact constituencyId or constituencyName match or caucus/party match
  const spConstId = sp.constituencyId ? String(sp.constituencyId) : null;
  const cmConstIdStr = cmConstId ? String(cmConstId) : null;
  const spConstName = normalizeConstituency(sp.constituencyName || '');
  const cmConstNameNorm = normalizeConstituency(cmConstName || '');
  const spParty = normalizeText(sp.caucus || sp.party || '');
  const cmParty = normalizeText(cmCaucus || '');
  const idMatch = (spConstId && cmConstIdStr && spConstId === cmConstIdStr);
  const nameMatch = (spConstName && cmConstNameNorm && spConstName === cmConstNameNorm);
  const partyMatch = (spParty && cmParty && spParty === cmParty);
  return !!(idMatch || nameMatch || partyMatch);
}

// Try to infer a speaker name when structured fields are missing or generic (e.g., 'MP').
function resolveSpeakerFromIvOrText(iv, plainText, chamberIndex) {
  // 1) Deep search for common name fields
  const nameKeys = new Set(['FullName','Name','SpeakerName','MemberName','PersonName']);
  const firstKeys = new Set(['FirstName','Forename','GivenName','First']);
  const lastKeys = new Set(['LastName','Surname','FamilyName','Last']);
  let foundFirst = null, foundLast = null, foundName = null;
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      const lk = k.toString().toLowerCase();
      const val = (typeof v === 'string') ? v.trim() : (v && typeof v === 'object' && typeof v['#text'] === 'string' ? v['#text'].trim() : null);
      if (val && val.length >= 2) {
        if (nameKeys.has(k) || nameKeys.has(k.replace(/^@_/, ''))) { if (!foundName) foundName = val; }
        if (firstKeys.has(k) || firstKeys.has(k.replace(/^@_/, ''))) { if (!foundFirst) foundFirst = val; }
        if (lastKeys.has(k) || lastKeys.has(k.replace(/^@_/, ''))) { if (!foundLast) foundLast = val; }
      }
      if (v && typeof v === 'object') walk(v);
    }
  })(iv);
  if (foundFirst && foundLast) return `${foundFirst} ${foundLast}`.trim();
  if (foundLast && foundLast.length >= 3) return foundLast;
  if (foundName && foundName.length >= 3 && !/^mp$/i.test(foundName)) return foundName;

  // 2) Scan text for member last names present in our index
  const words = Array.from(new Set((plainText || '').match(/[A-Z][a-z]{2,}/g) || []));
  for (const w of words) {
    const key = normalizeText(w).replace(/[^a-z0-9\s-]/g, '').trim();
    if (!key) continue;
    if (chamberIndex.byMember.has(key)) return w; // last-name match
  }
  return null;
}
async function processScrape(scrape) {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed;
  parsed = parser.parse(scrape.data);

  function findInterventions(root) {
    if (!root || typeof root !== 'object') return [];
    const candidates = [];
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (k.toLowerCase().includes('intervention')) {
          if (Array.isArray(v)) candidates.push(...v);
          else candidates.push(v);
        }
        if (v && typeof v === 'object') walk(v);
      });
    }
    walk(root);
    return candidates;
  }

  const interventions = findInterventions(parsed);
  const chamberIndex = await buildChamberIndex();
  const author = await resolveCivilAuthorUser();
  let created = 0, skipped = 0;
  const errors = [];
  let mapByRiding = 0, mapByMember = 0, unmapped = 0;
  const unmappedSamples = [];
  const skipReasons = { tooShort: 0, noChamber: 0, duplicate: 0, other: 0 };
  const skipSamples = [];

  // use top-level parseSpeakerFromIntervention + matchesStrict

  for (const iv of interventions) {
    try {
      const ctx = {
        ParliamentNumber: iv.ParliamentNumber || iv.Parliament || parsed.ParliamentNumber || null,
        SessionNumber: iv.SessionNumber || iv.Session || parsed.SessionNumber || null,
        SittingNumber: iv.SittingNumber || iv.Sitting || parsed.SittingNumber || null,
        InterventionId: iv.InterventionID || iv.InterventionId || iv['@_id'] || iv.Id || null,
      };

      const sp = parseSpeakerFromIntervention(iv);
      const speakerName = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim() || sp.name || 'MP';
      const affiliation = sp.party || sp.caucus || '';
      const riding = sp.constituencyName || '';
      let chamber = null;
      const lastKey = normalizeText(sp.lastName || '').replace(/[^a-z0-9\s-]/g,'').trim();
      const candidates = lastKey && chamberIndex.byLastName.get(lastKey) ? chamberIndex.byLastName.get(lastKey) : [];
      if (candidates.length === 1 && matchesStrict(candidates[0], sp)) {
        chamber = candidates[0];
      } else if (candidates.length > 1) {
        const strict = candidates.filter(ch => matchesStrict(ch, sp));
        if (strict.length === 1) chamber = strict[0];
      }
      if (chamber) {
        mapByMember++;
      } else {
        unmapped++;
        if (unmappedSamples.length < 10) unmappedSamples.push({ speakerName, riding, ctx });
      }

    const text = getInterventionText(iv);

  const plain = extractPlain(text);
  if (!plain || plain.length < 10) { skipped++; skipReasons.tooShort++; if (skipSamples.length < 15) skipSamples.push({ reason: 'tooShort', speakerName, riding, ctx }); continue; }
  // Strict mode: create posts only if chamber is confidently matched
  if (!chamber) { skipped++; skipReasons.noChamber++; if (skipSamples.length < 15) skipSamples.push({ reason: 'noChamber', speakerName, riding, ctx }); continue; }

      const key = dedupeKeyFromContext(ctx);
      const title = `${speakerName} in the House — ${riding || 'Unknown Riding'}`.trim();

      const post = {
        title,
        body: text,
        type: 'chamber',
        chamber: chamber.seoUrl,
        province: chamber && chamber.province || 'ca',
        jurisdiction: 'federal',
        authorId: author.id || null,
        voteCount: 0,
        commentCount: 0,
        bookmarkCount: 0,
        shareCount: 0,
        createdAt: Date.now(),
        seoUrl: `${normalizeText(title).replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-')}-${Date.now()}`,
        tags: ['hansard', speakerName].filter(Boolean),
        hansardKey: key,
        hansardMeta: { ...ctx, speaker: speakerName, party: affiliation, riding, mappedBy: 'strict' },
      };

      try {
        // Always attempt inline summarize (blocking) and replace body before insert when possible
        const cfg = getOpenAiConfig();
        if (cfg.inline) {
          if (!cfg.endpoint || !cfg.apiKey) {
            if (cfg.log) console.warn('[Hansard][AI] Inline summary skipped: missing endpoint/apiKey');
          } else {
          try {
            const role = 'MP';
            const urlFallback = deriveParlSessAndSittingFromUrl(scrape && scrape.sourceUrl);
            const parl = ctx.ParliamentNumber || ctx.Parliament || (urlFallback.parlSess.split('-')[0]) || '?';
            const sess = ctx.SessionNumber || ctx.Session || (urlFallback.parlSess.split('-')[1]) || '?';
            const sit = ctx.SittingNumber || ctx.Sitting || urlFallback.sitting || '?';
            const ivId = ctx.InterventionId || ctx.InterventionID || ctx.Guid || '?';
            const sourceParlSess = `${parl}-${sess}`;
            const sourceSitting = String(sit).padStart(3, '0');
            const sourceInterventionId = ivId;
            const sourceLink = (scrape && scrape.sourceUrl) ? String(scrape.sourceUrl) : '';
            const parts = (speakerName || '').trim().split(/\s+/);
            const firstName = parts[0] || '';
            const lastName = parts.slice(1).join(' ') || '';
            const hashtag = hashtagForMp(firstName, lastName);
            const provinceCode = (chamber && chamber.province) ? String(chamber.province).toUpperCase() : '';
            const prompt = buildSummaryPrompt({ fullNameAccent: speakerName, firstName, lastName, hashtag, party: affiliation, riding, provinceCode, roleDefault: role, bodyText: plain, sourceParlSess, sourceSitting, sourceInterventionId, sourceLink });
            const messages = [
              { role: 'system', content: 'You are a neutral Canadian civic assistant. Keep summaries concise, factual, and helpful to everyday citizens.' },
              { role: 'user', content: prompt },
            ];
            if (cfg.log) console.log('[Hansard][AI] Inline summary request for', speakerName, '—', riding);
            const result = await requestOpenAiSummary(messages, cfg);
            if (result && result.ok) {
              const html = renderSummaryHtml(result.data, { transcript: plain });
              if (html) {
                post.hansardOriginalBody = post.body; // audit trail
                post.body = html;
                post.aiSummary = { createdAt: Date.now(), model: cfg.model, data: result.data, inline: true };
                post.hansardMeta = post.hansardMeta || { ...ctx };
              }
            } else if (cfg.log) {
              console.warn('[Hansard][AI] Inline summary failed, using original body:', result && result.error);
            }
          } catch (e) {
            console.warn('[Hansard][AI] Inline summary error, using original body:', e && e.message);
          }
          }
        }

        const newId = await Posts.insertAsync(post);
        created++;
        if (chamber && chamber._id) await Chambers.updateAsync({ _id: chamber._id }, { $inc: { 'stats.posts': 1 } });
        // Queue AI summary (non-blocking)
  const role = 'MP';
  const source = (function(){ const fb=deriveParlSessAndSittingFromUrl(scrape&&scrape.sourceUrl); const parl=(ctx.ParliamentNumber||ctx.Parliament|| (fb.parlSess.split('-')[0]||'?')); const sess=(ctx.SessionNumber||ctx.Session||(fb.parlSess.split('-')[1]||'?')); const sit=(ctx.SittingNumber||ctx.Sitting||fb.sitting||'?'); const ivId=ctx.InterventionId||ctx.InterventionID||ctx.Guid||'?'; return `${parl}-${sess}, Sitting ${String(sit).padStart(3,'0')}, Intervention ID ${ivId}`; })();
  // Attach sourceUrl to hansardMeta for background pass
  post.hansardMeta.sourceUrl = (scrape && scrape.sourceUrl) ? String(scrape.sourceUrl) : '';
  // Attach plaintext transcript for background replacement usage
  if (!post.hansardMeta.transcript) {
    try { post.hansardMeta.transcript = extractPlain(text); } catch(_) { post.hansardMeta.transcript = plain; }
  }
        maybeQueueSummary({ postId: newId, post, speakerName, party: affiliation, riding, role, source });
      } catch (e) {
        if (e && (e.code === 11000 || /duplicate key/i.test(e.message))) {
          skipped++; skipReasons.duplicate++;
        } else {
          errors.push({ reason: e.message || String(e) });
          skipReasons.other++; if (skipSamples.length < 15) skipSamples.push({ reason: 'error', speakerName, riding, ctx, error: e && e.message });
        }
      }
    } catch (e) {
      errors.push({ reason: e.message || String(e) });
    }
  }

  return {
    interventions: interventions.length,
    created,
    skipped,
    mapping: { byRiding: mapByRiding, byMember: mapByMember, unmapped, unmappedSamples },
    author: (await resolveCivilAuthorUser()),
    errorsCount: errors.length,
    errorsSample: errors.slice(0, 5),
    skipReasons,
    skipSamples
  };
}

function startOfTodayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

// Latest URL helper endpoint: GET /api/admin/hansard/latest-url
WebApp.connectHandlers.use('/api/admin/hansard/latest-url', async (req, res) => {
  if (req.method !== 'GET') return writeJson(res, 405, { error: 'Method not allowed' });
  const auth = await authAdminOrAdminUser(req);
  if (!auth.ok) return writeJson(res, 401, { error: 'Unauthorized' });
  const url = (process.env.HANSARD_LATEST_URL)
    || ((Meteor.settings && Meteor.settings.private && Meteor.settings.private.hansardLatestUrl) ? Meteor.settings.private.hansardLatestUrl : '');
  const note = url ? 'from settings' : 'configure HANSARD_LATEST_URL or settings.private.hansardLatestUrl';
  return writeJson(res, 200, { url, note });
});

// Ingest endpoint: POST /api/admin/hansard/ingest { sourceUrl?, xml? }
WebApp.connectHandlers.use('/api/admin/hansard/ingest', async (req, res) => {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  const auth = await authAdminOrAdminUser(req);
  if (!auth.ok) return writeJson(res, 401, { error: 'Unauthorized' });
  // Parse JSON body
  let body = req.body; if (!body || typeof body !== 'object') {
    body = await new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); } catch{ resolve({}); } }); });
  }
  const sourceUrl = (body.sourceUrl || '').trim();
  const rawXml = body.xml && String(body.xml).trim();
  if (!sourceUrl && !rawXml) return writeJson(res, 400, { error: 'Provide sourceUrl or xml' });

  // Guard: if a hansard scrape exists for today, process it to avoid re-downloading/flooding
  try {
    const today = startOfTodayUTC();
    const exists = await Scrapes.findOneAsync({ type: 'hansard.xml', createdAt: { $gte: today } });
    if (exists) {
      try {
        const result = await processScrape(exists);
        return writeJson(res, 200, { status: 'exists-processed', scrapeId: exists._id, size: exists.size, ...result });
      } catch (e) {
        return writeJson(res, 500, { error: 'process-failed', details: e.message });
      }
    }
  } catch (_) {}
  let xmlText = rawXml;
  if (!xmlText && sourceUrl) {
    try {
      const r = await fetch(sourceUrl, { headers: { 'User-Agent': 'CivilCitizensBot/1.0 (+https://civilcitizens.ca)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      xmlText = await r.text();
    } catch (e) {
      return writeJson(res, 502, { error: 'Failed to download XML', details: e.message });
    }
  }
  try {
    const doc = {
      type: 'hansard.xml',
      sourceUrl: sourceUrl || null,
      size: xmlText.length,
      createdAt: new Date(),
      dataType: 'xml',
      data: xmlText,
    };
    const _id = await Scrapes.insertAsync(doc);
    const scrape = { _id, ...doc };
    try {
      const result = await processScrape(scrape);
      return writeJson(res, 200, { status: 'ok-processed', scrapeId: _id, bytes: xmlText.length, ...result });
    } catch (e) {
      return writeJson(res, 500, { error: 'process-failed', details: e.message, scrapeId: _id });
    }
  } catch (e) {
    return writeJson(res, 500, { error: 'Insert failed', details: e.message });
  }
});

// Process endpoint: POST /api/admin/hansard/process { scrapeId } -> parses XML and creates Posts
WebApp.connectHandlers.use('/api/admin/hansard/process', async (req, res) => {
  try { console.log('[Hansard] /process called'); } catch(_) {}
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  const auth = await authAdminOrAdminUser(req);
  if (!auth.ok) return writeJson(res, 401, { error: 'Unauthorized' });
  let body = req.body; if (!body || typeof body !== 'object') {
    body = await new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); } catch{ resolve({}); } }); });
  }
  const scrapeId = String(body.scrapeId || '').trim();
  if (!scrapeId) return writeJson(res, 400, { error: 'scrapeId required' });
  const scrape = await Scrapes.findOneAsync({ _id: scrapeId });
  if (!scrape || !scrape.data) return writeJson(res, 404, { error: 'scrape not found' });
  try {
    const result = await processScrape(scrape);
    try {
      console.log('[Hansard] /process result', { interventions: result.interventions, created: result.created, skipped: result.skipped });
      console.log('[Hansard] /process mapping', result.mapping);
      console.log('[Hansard] /process skipReasons', result.skipReasons);
      if (result.skipSamples && result.skipSamples.length) {
        console.log('[Hansard] /process skipSamples (first 5)', result.skipSamples.slice(0, 5));
      }
    } catch(_) {}
    return writeJson(res, 200, { status: 'ok', ...result });
  } catch (e) {
    try { console.error('[Hansard] /process failed', e); } catch(_) {}
    return writeJson(res, 500, { error: 'process-failed', details: e.message });
  }
});

// Preview endpoint: POST /api/admin/hansard/preview { scrapeId, limit?, offset?, mappedOnly?, unmappedOnly? }
WebApp.connectHandlers.use('/api/admin/hansard/preview', async (req, res) => {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  const auth = await authAdminOrAdminUser(req);
  if (!auth.ok) return writeJson(res, 401, { error: 'Unauthorized' });
  let body = req.body; if (!body || typeof body !== 'object') {
    body = await new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); } catch{ resolve({}); } }); });
  }
  const scrapeId = String(body.scrapeId || '').trim();
  if (!scrapeId) return writeJson(res, 400, { error: 'scrapeId required' });
  const limit = Math.max(1, Math.min(500, Number(body.limit) || 200));
  const offset = Math.max(0, Number(body.offset) || 0);
  const mappedOnly = !!body.mappedOnly;
  const unmappedOnly = !!body.unmappedOnly;

  const scrape = await Scrapes.findOneAsync({ _id: scrapeId });
  if (!scrape || !scrape.data) return writeJson(res, 404, { error: 'scrape not found' });

  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed;
  try { parsed = parser.parse(scrape.data); } catch (e) { return writeJson(res, 400, { error: 'xml-parse-failed', details: e.message }); }

  function findInterventions(root) {
    if (!root || typeof root !== 'object') return [];
    const candidates = [];
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (k.toLowerCase().includes('intervention')) {
          if (Array.isArray(v)) candidates.push(...v);
          else candidates.push(v);
        }
        if (v && typeof v === 'object') walk(v);
      });
    }
    walk(root);
    return candidates;
  }

  const interventions = findInterventions(parsed);
  const chamberIndex = await buildChamberIndex();

  const items = [];
  let total = 0, mapped = 0, unmapped = 0;
  for (const iv of interventions) {
    const ctx = {
      ParliamentNumber: iv.ParliamentNumber || iv.Parliament || parsed.ParliamentNumber || null,
      SessionNumber: iv.SessionNumber || iv.Session || parsed.SessionNumber || null,
      SittingNumber: iv.SittingNumber || iv.Sitting || parsed.SittingNumber || null,
      InterventionId: iv.InterventionID || iv.InterventionId || iv['@_id'] || iv.Id || null,
    };
    const sp = parseSpeakerFromIntervention(iv);
    const speakerName = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim() || sp.name || 'MP';
    const affiliation = sp.party || sp.caucus || '';
    const riding = sp.constituencyName || '';
    let chamber = null;
    let mappedBy = 'unmapped';
    const lastKey = normalizeText(sp.lastName || '').replace(/[^a-z0-9\s-]/g,'').trim();
    const candidates = lastKey && chamberIndex.byLastName.get(lastKey) ? chamberIndex.byLastName.get(lastKey) : [];
    if (candidates.length === 1 && matchesStrict(candidates[0], sp)) {
      chamber = candidates[0];
      mappedBy = 'strict';
    } else if (candidates.length > 1) {
      const strict = candidates.filter(ch => matchesStrict(ch, sp));
      if (strict.length === 1) { chamber = strict[0]; mappedBy = 'strict'; }
    }
    const text = getInterventionText(iv);
    const plain = extractPlain(text);
    const key = dedupeKeyFromContext(ctx);
    total++;
    if (chamber) mapped++; else unmapped++;

    const item = {
      key,
      speakerName,
      party: affiliation,
      riding,
      chamber: chamber ? { seoUrl: chamber.seoUrl, province: chamber.province, name: chamber.name } : null,
      mappedBy,
      snippet: plain.slice(0, 240),
      length: plain.length,
      ctx
    };
    items.push(item);
  }

  let filtered = items;
  if (mappedOnly) filtered = filtered.filter(x => x.chamber);
  if (unmappedOnly) filtered = filtered.filter(x => !x.chamber);
  const page = filtered.slice(offset, offset + limit);
  return writeJson(res, 200, { status: 'ok', total, mapped, unmapped, limit, offset, count: page.length, items: page });
});

// Create selected posts: POST /api/admin/hansard/create-posts { scrapeId, keys: string[], overrides?: { [key]: { chamberSeo?: string } } }
WebApp.connectHandlers.use('/api/admin/hansard/create-posts', async (req, res) => {
  if (req.method !== 'POST') return writeJson(res, 405, { error: 'Method not allowed' });
  const auth = await authAdminOrAdminUser(req);
  if (!auth.ok) return writeJson(res, 401, { error: 'Unauthorized' });
  let body = req.body; if (!body || typeof body !== 'object') {
    body = await new Promise((resolve) => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{ resolve(JSON.parse(d||'{}')); } catch{ resolve({}); } }); });
  }
  const scrapeId = String(body.scrapeId || '').trim();
  const keys = Array.isArray(body.keys) ? body.keys.map(k => String(k)) : [];
  const overrides = (body.overrides && typeof body.overrides === 'object') ? body.overrides : {};
  if (!scrapeId || keys.length === 0) return writeJson(res, 400, { error: 'scrapeId and keys are required' });

  const scrape = await Scrapes.findOneAsync({ _id: scrapeId });
  if (!scrape || !scrape.data) return writeJson(res, 404, { error: 'scrape not found' });

  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let parsed;
  try { parsed = parser.parse(scrape.data); } catch (e) { return writeJson(res, 400, { error: 'xml-parse-failed', details: e.message }); }

  function findInterventions(root) {
    if (!root || typeof root !== 'object') return [];
    const candidates = [];
    function walk(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(k => {
        const v = obj[k];
        if (k.toLowerCase().includes('intervention')) {
          if (Array.isArray(v)) candidates.push(...v);
          else candidates.push(v);
        }
        if (v && typeof v === 'object') walk(v);
      });
    }
    walk(root);
    return candidates;
  }

  const interventions = findInterventions(parsed);
  const chamberIndex = await buildChamberIndex();
  const author = await resolveCivilAuthorUser();
  let created = 0, skipped = 0;
  const errors = [];
  const selected = new Set(keys);
  const unmatchedKeys = new Set(keys);

  function strictMatchChamber(sp) {
    // 1) Override wins if provided and valid
    const lastKey = normalizeText(sp.lastName || '').replace(/[^a-z0-9\s-]/g,'').trim();
    // 2) Otherwise, use byLastName candidates then filter strictly by currentMember
    if (!lastKey) return null;
    const candidates = chamberIndex.byLastName.get(lastKey) || [];
    const stricts = candidates.filter(ch => {
      const cm = ch.currentMember || {};
      const cmLast = normalizeText((cm.lastName || (cm.name ? cm.name.split(' ').slice(-1)[0] : '')).toString());
      if (!cmLast || cmLast !== lastKey) return false;
      const cmFirst = normalizeText((cm.firstName || (cm.name ? cm.name.split(' ')[0] : '')).toString());
      const nf = normalizeText((sp.firstName || (sp.name ? sp.name.split(' ')[0] : '')).toString());
      if (nf && cmFirst && nf[0] !== cmFirst[0]) return false;
      const idMatch = sp.constituencyId && (String(sp.constituencyId) === String(ch.constituencyId || cm.constituencyId || ''));
      const nameMatch = normalizeConstituency(sp.constituencyName||'') === normalizeConstituency((cm.constituencyName || ch.name || ''));
      const partyMatch = normalizeText(sp.caucus||sp.party||'') === normalizeText(cm.caucus||cm.party||'');
      return !!(idMatch || nameMatch || partyMatch);
    });
    return stricts.length === 1 ? stricts[0] : null;
  }

  for (const iv of interventions) {
    try {
      const ctx = {
        ParliamentNumber: iv.ParliamentNumber || iv.Parliament || parsed.ParliamentNumber || null,
        SessionNumber: iv.SessionNumber || iv.Session || parsed.SessionNumber || null,
        SittingNumber: iv.SittingNumber || iv.Sitting || parsed.SittingNumber || null,
        InterventionId: iv.InterventionID || iv.InterventionId || iv['@_id'] || iv.Id || null,
      };
      const key = dedupeKeyFromContext(ctx);
      if (!selected.has(key)) continue; // only selected keys
      unmatchedKeys.delete(key);

    const sp = parseSpeakerFromIntervention(iv);
    const speakerName = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim() || sp.name || 'MP';
    const riding = sp.constituencyName || '';
    let chamber = null;
    let mappedBy = 'unmapped';
    const override = overrides[key];
    if (override && override.chamberSeo) {
      chamber = chamberIndex.bySlug.get(String(override.chamberSeo).trim()) || null;
      mappedBy = chamber ? 'override' : 'unmapped';
      if (!chamber) errors.push({ key, reason: `override chamber not found: ${override.chamberSeo}` });
    }
    if (!chamber) {
      chamber = strictMatchChamber(sp);
      if (chamber) mappedBy = 'strict';
    }

      // Content
      const text = getInterventionText(iv);
      const plain = extractPlain(text);
      if (!plain || plain.length < 10) { skipped++; continue; }

      const title = `${speakerName} in the House — ${riding || 'Unknown Riding'}`.trim();
      const post = {
        title,
        body: text,
        type: 'chamber',
        chamber: chamber && chamber.seoUrl || null,
        province: chamber && chamber.province || 'ca',
        jurisdiction: 'federal',
        authorId: author.id || null,
        voteCount: 0,
        commentCount: 0,
        bookmarkCount: 0,
        shareCount: 0,
        createdAt: Date.now(),
        seoUrl: `${normalizeText(title).replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-')}-${Date.now()}`,
        tags: ['hansard', speakerName].filter(Boolean),
        hansardKey: key,
        hansardMeta: { ...ctx, speaker: [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim() || sp.name || 'MP', party: sp.party || sp.caucus || '', riding, mappedBy },
      };

      try {
        // Attempt inline AI summary before insert, same as processScrape
        const cfg = getOpenAiConfig();
        if (cfg.inline) {
          if (!cfg.endpoint || !cfg.apiKey) {
            if (cfg.log) console.warn('[Hansard][AI] Inline summary skipped (create-posts): missing endpoint/apiKey');
          } else {
            try {
              const role = 'MP';
              const urlFallback = deriveParlSessAndSittingFromUrl(scrape && scrape.sourceUrl);
              const parl = ctx.ParliamentNumber || ctx.Parliament || (urlFallback.parlSess.split('-')[0]) || '?';
              const sess = ctx.SessionNumber || ctx.Session || (urlFallback.parlSess.split('-')[1]) || '?';
              const sit = ctx.SittingNumber || ctx.Sitting || urlFallback.sitting || '?';
              const ivId = ctx.InterventionId || ctx.InterventionID || ctx.Guid || '?';
              const sourceParlSess = `${parl}-${sess}`;
              const sourceSitting = String(sit).padStart(3, '0');
              const sourceInterventionId = ivId;
              const sourceLink = (scrape && scrape.sourceUrl) ? String(scrape.sourceUrl) : '';
              const parts = (speakerName || '').trim().split(/\s+/);
              const firstName = parts[0] || '';
              const lastName = parts.slice(1).join(' ') || '';
              const hashtag = hashtagForMp(firstName, lastName);
              const provinceCode = (chamber && chamber.province) ? String(chamber.province).toUpperCase() : '';
              const prompt = buildSummaryPrompt({ fullNameAccent: speakerName, firstName, lastName, hashtag, party: sp.party || sp.caucus || '', riding, provinceCode, roleDefault: role, bodyText: plain, sourceParlSess, sourceSitting, sourceInterventionId, sourceLink });
              const messages = [
                { role: 'system', content: 'You are a neutral Canadian civic assistant. Keep summaries concise, factual, and helpful to everyday citizens.' },
                { role: 'user', content: prompt },
              ];
              if (cfg.log) console.log('[Hansard][AI] Inline summary request (create-posts) for', speakerName, '—', riding);
              const result = await requestOpenAiSummary(messages, cfg);
              if (result && result.ok) {
                const html = renderSummaryHtml(result.data, { transcript: plain });
                if (html) {
                  post.hansardOriginalBody = post.body; // audit trail
                  post.body = html;
                  post.aiSummary = { createdAt: Date.now(), model: cfg.model, data: result.data, inline: true };
                  post.hansardMeta = post.hansardMeta || { ...ctx };
                  post.hansardMeta.transcript = plain;
                }
              } else if (cfg.log) {
                console.warn('[Hansard][AI] Inline summary failed (create-posts), using original body:', result && result.error);
              }
            } catch (e) {
              console.warn('[Hansard][AI] Inline summary error (create-posts), using original body:', e && e.message);
            }
          }
        }
        const newId = await Posts.insertAsync(post);
        created++;
        if (chamber && chamber._id) await Chambers.updateAsync({ _id: chamber._id }, { $inc: { 'stats.posts': 1 } });
        // Queue AI summary (non-blocking)
  const role = 'MP';
  const source = (function(){ const fb=deriveParlSessAndSittingFromUrl(scrape&&scrape.sourceUrl); const parl=(ctx.ParliamentNumber||ctx.Parliament|| (fb.parlSess.split('-')[0]||'?')); const sess=(ctx.SessionNumber||ctx.Session||(fb.parlSess.split('-')[1]||'?')); const sit=(ctx.SittingNumber||ctx.Sitting||fb.sitting||'?'); const ivId=ctx.InterventionId||ctx.InterventionID||ctx.Guid||'?'; return `${parl}-${sess}, Sitting ${String(sit).padStart(3,'0')}, Intervention ID ${ivId}`; })();
        const _speakerName = [sp.firstName, sp.lastName].filter(Boolean).join(' ').trim() || sp.name || 'MP';
  post.hansardMeta = post.hansardMeta || {};
  post.hansardMeta.sourceUrl = (scrape && scrape.sourceUrl) ? String(scrape.sourceUrl) : '';
  if (!post.hansardMeta.transcript) { post.hansardMeta.transcript = plain; }
        maybeQueueSummary({ postId: newId, post, speakerName: _speakerName, party: sp.party || sp.caucus || '', riding, role, source });
      } catch (e) {
        if (e && (e.code === 11000 || /duplicate key/i.test(e.message))) {
          skipped++;
        } else {
          errors.push({ key, reason: e.message || String(e) });
        }
      }
    } catch (e) {
      errors.push({ reason: e.message || String(e) });
    }
  }

  return writeJson(res, 200, {
    status: 'ok',
    selectedKeys: keys.length,
    created,
    skipped,
    unmatchedKeys: Array.from(unmatchedKeys),
    errorsCount: errors.length,
    errorsSample: errors.slice(0, 5)
  });

});
