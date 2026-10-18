/* Ray Matthews Marketing Pipeline - static SPA (vanilla JS, no build step) */
(function () {
  'use strict';

  var CONFIG = window.__CONFIG__ || {};
  var API_BASE = (CONFIG.apiBase || '').replace(/\/$/, '');
  var PIPELINE_BASE = (CONFIG.pipelineBase || CONFIG.apiBase || '').replace(/\/$/, '');
  var COGNITO_DOMAIN = (CONFIG.cognitoDomain || '').replace(/\/$/, '');

  // ---------------------------------------------------------------------------
  // Auth (Cognito OAuth2 authorization code flow with PKCE)
  // ---------------------------------------------------------------------------

  function base64UrlEncode(bytes) {
    var str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function generateCodeVerifier() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  async function generateCodeChallenge(verifier) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64UrlEncode(new Uint8Array(digest));
  }

  async function login() {
    var verifier = generateCodeVerifier();
    var challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem('pkce_verifier', verifier);
    // Remember where the user was so we can return after login
    sessionStorage.setItem('post_login_path', window.location.pathname);
    var params = new URLSearchParams({
      response_type: 'code',
      client_id: CONFIG.cognitoClientId,
      redirect_uri: CONFIG.redirectUri,
      scope: 'openid email profile',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    window.location.href = COGNITO_DOMAIN + '/oauth2/authorize?' + params.toString();
    // Never resolve: the page is navigating away
    return new Promise(function () {});
  }

  function storeTokens(tokens) {
    if (tokens.id_token) sessionStorage.setItem('id_token', tokens.id_token);
    if (tokens.refresh_token) sessionStorage.setItem('refresh_token', tokens.refresh_token);
    var expiresIn = Number(tokens.expires_in) || 3600;
    sessionStorage.setItem('expires_at', String(Date.now() + expiresIn * 1000));
  }

  function clearTokens() {
    sessionStorage.removeItem('id_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('expires_at');
  }

  async function requestTokens(body) {
    var res = await fetch(COGNITO_DOMAIN + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    });
    if (!res.ok) throw new Error('Token request failed (' + res.status + ')');
    return res.json();
  }

  async function handleCallback() {
    var params = new URLSearchParams(window.location.search);
    var error = params.get('error');
    if (error) {
      history.replaceState({}, '', '/');
      return { ok: false, error: params.get('error_description') || error };
    }
    var code = params.get('code');
    if (!code) return null;
    var verifier = sessionStorage.getItem('pkce_verifier');
    sessionStorage.removeItem('pkce_verifier');
    var returnTo = sessionStorage.getItem('post_login_path') || '/';
    sessionStorage.removeItem('post_login_path');
    try {
      if (!verifier) throw new Error('Missing PKCE verifier');
      var tokens = await requestTokens({
        grant_type: 'authorization_code',
        client_id: CONFIG.cognitoClientId,
        code: code,
        redirect_uri: CONFIG.redirectUri,
        code_verifier: verifier
      });
      storeTokens(tokens);
    } catch (err) {
      console.error('[Auth] Callback failed:', err);
      clearTokens();
      history.replaceState({}, '', '/');
      return { ok: false, error: err.message || 'Authentication failed' };
    }
    history.replaceState({}, '', returnTo === '/index.html' ? '/' : returnTo);
    return { ok: true };
  }

  async function refreshTokens() {
    var refreshToken = sessionStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    try {
      var tokens = await requestTokens({
        grant_type: 'refresh_token',
        client_id: CONFIG.cognitoClientId,
        refresh_token: refreshToken
      });
      storeTokens(tokens); // refresh response omits refresh_token; the old one is kept
      return true;
    } catch (err) {
      console.error('[Auth] Refresh failed:', err);
      clearTokens();
      return false;
    }
  }

  // Returns the id_token (NOT the access token: the pipeline Lambda verifies tokenUse 'id').
  async function getIdToken() {
    var token = sessionStorage.getItem('id_token');
    var expiresAt = Number(sessionStorage.getItem('expires_at')) || 0;
    if (token && Date.now() < expiresAt - 30000) return token;
    if (await refreshTokens()) return sessionStorage.getItem('id_token');
    await login();
    return null;
  }

  async function apiFetch(path, options, base) {
    options = options || {};
    var url = (base === undefined ? API_BASE : base) + path;
    async function attempt() {
      var token = await getIdToken();
      var headers = Object.assign({}, options.headers || {}, { Authorization: 'Bearer ' + token });
      if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      return fetch(url, Object.assign({}, options, { headers: headers }));
    }
    var res = await attempt();
    if (res.status === 401) {
      if (await refreshTokens()) {
        res = await attempt();
      } else {
        clearTokens();
        await login();
      }
    }
    return res;
  }

  async function apiJson(path, options, base) {
    var res = await apiFetch(path, options, base);
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 404 && (!options || !options.allow404)) {
      throw new Error((data && data.error) || 'Not found');
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error((data && (data.error || data.message)) || 'Request failed (' + res.status + ')');
    }
    return data;
  }

  function jsonBody(obj) {
    return { body: JSON.stringify(obj) };
  }

  // ---------------------------------------------------------------------------
  // DOM helpers (all text is set via textContent / createTextNode: no innerHTML)
  // ---------------------------------------------------------------------------

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') el.className = val;
        else if (key === 'text') el.textContent = val;
        else if (key.indexOf('on') === 0) el.addEventListener(key.slice(2), val);
        else if (key === 'value') el.value = val;
        else el.setAttribute(key, val === true ? '' : val);
      });
    }
    appendChildren(el, children);
    return el;
  }

  function appendChildren(el, children) {
    if (children === undefined || children === null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) appendChildren(el, child);
      else el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
  }

  // Renders **bold** segments as <strong> without touching innerHTML.
  function renderCaptionInto(el, caption) {
    el.textContent = '';
    var re = /\*\*(.+?)\*\*/g;
    var last = 0;
    var m;
    while ((m = re.exec(caption)) !== null) {
      if (m.index > last) el.appendChild(document.createTextNode(caption.slice(last, m.index)));
      el.appendChild(h('strong', { text: m[1] }));
      last = m.index + m[0].length;
    }
    if (last < caption.length) el.appendChild(document.createTextNode(caption.slice(last)));
  }

  function photoUrl(filename) {
    return '/photos/' + encodeURIComponent(filename);
  }

  function formatDate(iso, withTime) {
    if (!iso) return '';
    var opts = { month: 'short', day: 'numeric', year: 'numeric' };
    if (withTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
    return new Date(iso).toLocaleDateString('en-US', opts);
  }

  function badge(text, colors) {
    return h('span', { class: 'inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ' + colors, text: text });
  }

  function themeBadge(theme) {
    return badge(theme, 'bg-brand-100 text-brand-700');
  }

  function platformBadges(publishedTo) {
    return (publishedTo || []).map(function (pub) {
      var fb = pub.platform === 'facebook';
      return h('span', {
        class: 'inline-block px-2 py-0.5 rounded-full text-xs font-medium ' + (fb ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'),
        text: (fb ? 'FB' : 'IG') + ' ✓'
      });
    });
  }

  var BTN_PRIMARY = 'px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  var BTN_SECONDARY = 'px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  function showError(message) {
    var existing = document.getElementById('error-banner');
    if (existing) existing.remove();
    var banner = h('div', {
      id: 'error-banner',
      class: 'mb-4 p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700 flex justify-between items-start'
    }, [
      h('span', { text: message }),
      h('button', { class: 'ml-4 text-red-500 hover:text-red-700', text: '×', onclick: function () { banner.remove(); } })
    ]);
    var app = document.getElementById('app');
    app.insertBefore(banner, app.firstChild);
  }

  // Runs an async action with a busy button; shows errors; restores the button on failure.
  async function withButton(btn, busyText, fn) {
    var original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = busyText; }
    try {
      await fn();
    } catch (err) {
      console.error(err);
      showError(err.message || 'Something went wrong');
      if (btn) { btn.disabled = false; btn.textContent = original; }
    }
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------

  function navigateTo(path) {
    history.pushState({}, '', path);
    return render();
  }

  async function render() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    var app = document.getElementById('app');
    app.textContent = '';
    app.appendChild(h('p', { class: 'text-gray-500 text-sm', text: 'Loading...' }));
    try {
      var match;
      if (path === '/' || path === '/current' || path === '/index.html') {
        await renderDashboard('current');
      } else if (path === '/posted') {
        await renderDashboard('posted');
      } else if ((match = path.match(/^\/posts\/([^/]+)$/))) {
        await renderPostDetail(decodeURIComponent(match[1]));
      } else {
        app.textContent = '';
        app.appendChild(h('div', { class: 'text-center py-12' }, [
          h('h2', { class: 'text-xl font-semibold text-gray-900 mb-2', text: 'Page not found' }),
          h('a', { href: '/', 'data-link': true, class: 'text-brand-600 hover:underline', text: 'Back to dashboard' })
        ]));
      }
    } catch (err) {
      console.error(err);
      app.textContent = '';
      showError(err.message || 'Failed to load');
    }
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('a[data-link]');
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigateTo(link.getAttribute('href'));
  });

  window.addEventListener('popstate', function () { render(); });

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  function mount(nodes) {
    var app = document.getElementById('app');
    app.textContent = '';
    appendChildren(app, nodes);
  }

  function statsBar(photos) {
    var total = photos.length;
    var used = photos.filter(function (p) { return p.used; }).length;
    function stat(label, value) {
      return h('div', { class: 'bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-3 text-center' }, [
        h('div', { class: 'text-2xl font-bold text-gray-900', text: String(value) }),
        h('div', { class: 'text-xs text-gray-500 uppercase tracking-wider', text: label })
      ]);
    }
    return h('div', { class: 'grid grid-cols-3 gap-4 mb-6' }, [
      stat('Total Photos', total),
      stat('Used', used),
      stat('Available', total - used)
    ]);
  }

  function tabBar(active) {
    function tab(label, href, key) {
      var on = key === active;
      return h('a', {
        href: href,
        'data-link': true,
        class: 'px-4 py-2 text-sm font-medium border-b-2 ' +
          (on ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700')
      }, label);
    }
    return h('div', { class: 'flex border-b border-gray-200 mb-6' }, [
      tab('Current', '/', 'current'),
      tab('Posted', '/posted', 'posted')
    ]);
  }

  async function renderDashboard(tab) {
    var results = await Promise.all([
      apiJson('/api/photos', { allow404: true }),
      tab === 'current' ? apiJson('/api/posts/current', { allow404: true }) : apiJson('/api/posts?status=posted', { allow404: true })
    ]);
    var photos = Array.isArray(results[0]) ? results[0] : ((results[0] && results[0].photos) || []);
    var data = results[1];

    var nodes = [statsBar(photos), tabBar(tab)];

    if (tab === 'current') {
      var draft = data && data.post ? data.post : data;
      if (!draft || !draft.id) {
        nodes.push(emptyState());
      } else {
        nodes.push(draftCard(draft));
      }
    } else {
      var posts = Array.isArray(data) ? data : ((data && data.posts) || []);
      if (posts.length === 0) {
        nodes.push(h('div', { class: 'text-center py-12 text-gray-500', text: 'No posts have been published yet.' }));
      } else {
        posts.forEach(function (p) { nodes.push(postedCard(p)); });
      }
    }
    mount(nodes);
  }

  function emptyState() {
    return h('div', { class: 'bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center' }, [
      h('h3', { class: 'text-lg font-semibold text-gray-900 mb-2', text: 'No active draft' }),
      h('p', { class: 'text-sm text-gray-500 mb-4', text: 'Score a fresh batch of photos, or pick one by hand.' }),
      h('div', { class: 'max-w-md mx-auto mb-4' }, [
        h('input', {
          id: 'search-terms-input',
          type: 'text',
          placeholder: 'Filter: sunset, lighthouse, aerial, snow...',
          class: 'w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500'
        }),
        h('p', { class: 'text-xs text-gray-400 mt-1', text: 'Comma-separated. Photos matching any term are weighted higher.' })
      ]),
      h('div', { class: 'flex justify-center gap-3' }, [
        h('button', { class: BTN_PRIMARY, text: 'Generate New Post', onclick: function (e) { runPipeline(e.currentTarget); } }),
        h('button', { class: BTN_SECONDARY, text: 'Pick Photo', onclick: openPhotoPicker })
      ])
    ]);
  }

  function postedCard(post) {
    return h('div', { class: 'bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4' }, [
      h('div', { class: 'flex items-start justify-between mb-3' }, [
        h('div', null, [
          h('h3', { class: 'text-lg font-semibold text-gray-900' }, [
            h('a', { href: '/posts/' + encodeURIComponent(post.id), 'data-link': true, class: 'hover:underline', text: post.photoTitle || post.photoFilename })
          ]),
          h('div', { class: 'flex items-center gap-2 mt-1' }, [
            themeBadge(post.primaryTheme),
            h('span', { class: 'text-xs text-gray-500', text: formatDate(post.postedAt || post.createdAt, true) })
          ])
        ]),
        h('div', { class: 'flex items-center gap-1.5' }, platformBadges(post.publishedTo))
      ]),
      h('p', {
        class: 'caption-text text-sm text-gray-600',
        text: post.caption ? (post.caption.length > 240 ? post.caption.slice(0, 240).replace(/\*\*/g, '') + '...' : post.caption.replace(/\*\*/g, '')) : ''
      })
    ]);
  }

  // ---------------------------------------------------------------------------
  // Draft card (candidates, caption, post)
  // ---------------------------------------------------------------------------

  function draftCard(post) {
    var readOnly = post.status !== 'draft';
    var card = h('div', { class: 'bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4' });

    var headerRight = [];
    if (post.status === 'draft') {
      headerRight.push(badge('Draft', 'bg-yellow-100 text-yellow-800'));
    } else if (post.status === 'posted') {
      headerRight.push(badge('Posted', 'bg-green-100 text-green-800'));
    } else {
      headerRight.push(badge('Discarded', 'bg-red-100 text-red-800'));
    }
    headerRight = headerRight.concat(platformBadges(post.publishedTo));

    var headerButtons = headerRight;
    if (!readOnly) {
      headerButtons = headerRight.concat([
        h('button', {
          class: 'ml-2 px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors',
          text: 'Discard',
          onclick: function (e) { discardPost(post.id, e.currentTarget); }
        })
      ]);
    }

    card.appendChild(h('div', { class: 'flex items-start justify-between mb-3' }, [
      h('div', null, [
        h('h3', { class: 'text-lg font-semibold text-gray-900', text: post.photoTitle || post.photoFilename }),
        h('div', { class: 'flex items-center gap-2 mt-1' }, [
          themeBadge(post.primaryTheme),
          h('span', { class: 'text-xs text-gray-500', text: formatDate(post.createdAt, true) })
        ])
      ]),
      h('div', { class: 'flex items-center gap-1.5' }, headerButtons)
    ]));

    if (post.photoDescription) {
      card.appendChild(h('details', { class: 'mb-3' }, [
        h('summary', { class: 'text-sm text-gray-500 cursor-pointer hover:text-gray-700', text: 'Photo Description' }),
        h('p', { class: 'text-sm text-gray-600 mt-1 pl-4', text: post.photoDescription })
      ]));
    }

    var hasScoring = post.candidates && post.candidates.length > 0 && post.candidates[0].criticScores;
    if (hasScoring) {
      card.appendChild(candidatesSection(post, readOnly));
    } else if (post.photoFilename) {
      card.appendChild(h('div', { class: 'mb-3 p-3 bg-gray-900 rounded-lg flex items-center justify-center' }, [
        h('img', { src: post.imageUrl || photoUrl(post.photoFilename), alt: post.photoTitle || '', class: 'max-h-80 w-auto object-contain rounded', loading: 'lazy' })
      ]));
    }

    card.appendChild(captionSection(post, readOnly));

    if (post.faaUrl) {
      card.appendChild(h('div', { class: 'mt-3' }, [
        h('a', { href: post.faaUrl, target: '_blank', rel: 'noopener', class: 'text-sm text-brand-600 hover:text-brand-700 hover:underline', text: 'View on FineArtAmerica →' })
      ]));
    }
    return card;
  }

  function captionSection(post, readOnly) {
    var id = post.id;
    var wrap = h('div', { class: 'bg-gray-50 rounded-md p-4 mb-3 border border-gray-100', id: 'caption-block-' + id });

    if (!post.caption) {
      if (readOnly) {
        wrap.appendChild(h('p', { class: 'text-sm text-gray-500 italic', text: 'No caption.' }));
      } else {
        wrap.appendChild(h('div', { class: 'flex items-center justify-between' }, [
          h('p', { class: 'text-sm text-gray-500', text: 'No caption yet for the selected photo.' }),
          h('button', { class: BTN_PRIMARY, text: 'Generate Caption', onclick: function (e) { generateCaption(id, e.currentTarget); } })
        ]));
      }
      return wrap;
    }

    var headerRow = [h('h4', { class: 'text-xs font-medium text-gray-500 uppercase tracking-wider', text: 'Generated Caption' })];
    if (!readOnly) {
      headerRow.push(h('button', {
        id: 'edit-btn-' + id,
        class: 'text-xs text-brand-600 hover:text-brand-700 hover:underline',
        text: 'Edit',
        onclick: function () { startEditCaption(id); }
      }));
    }
    wrap.appendChild(h('div', { class: 'flex items-center justify-between mb-2' }, headerRow));

    var display = h('div', { class: 'caption-text text-sm text-gray-800 leading-relaxed', id: 'caption-display-' + id });
    renderCaptionInto(display, post.caption);
    wrap.appendChild(display);

    if (readOnly) return wrap;

    wrap.appendChild(h('div', { class: 'hidden', id: 'caption-edit-' + id }, [
      h('textarea', {
        id: 'caption-textarea-' + id,
        class: 'w-full text-sm text-gray-800 leading-relaxed border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 resize-y',
        rows: '10',
        value: post.caption
      }),
      h('div', { class: 'flex justify-end gap-2 mt-2' }, [
        h('button', { class: 'px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors', text: 'Cancel', onclick: function () { cancelEditCaption(id); } }),
        h('button', { class: 'px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md transition-colors disabled:opacity-50', text: 'Save', onclick: function (e) { saveCaption(id, e.currentTarget); } })
      ])
    ]));

    // Publish controls
    var published = (post.publishedTo || []).map(function (p) { return p.platform; });
    function platformBox(key, label) {
      return h('label', { class: 'flex items-center gap-1.5 text-sm text-gray-700' }, [
        h('input', {
          type: 'checkbox',
          id: 'platform-' + id + '-' + key,
          checked: !published.includes(key),
          disabled: published.includes(key),
          class: 'rounded border-gray-300 text-brand-600 focus:ring-brand-500'
        }),
        label
      ]);
    }
    var publishRow = h('div', { class: 'mt-4 pt-3 border-t border-gray-200 flex items-center justify-between', id: 'publish-row-' + id }, [
      h('div', { class: 'flex items-center gap-4' }, [platformBox('facebook', 'Facebook'), platformBox('instagram', 'Instagram')]),
      h('button', { class: 'px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50', text: 'Post', onclick: function (e) { postToMeta(id, e.currentTarget); } })
    ]);
    wrap.appendChild(publishRow);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Candidates (tabbed critic UI, ported from post-card.ejs)
  // ---------------------------------------------------------------------------

  function criticBox(label, critic, renderScores) {
    var head = [h('span', { class: 'text-xs font-semibold text-gray-600 uppercase tracking-wider', text: label })];
    if (critic) {
      head.push(h('div', { class: 'flex items-center gap-2' }, [
        h('span', { class: 'text-xs text-gray-400', text: critic.provider + ' / ' + critic.model }),
        renderScores(critic)
      ]));
    } else {
      head.push(h('span', { class: 'text-xs text-gray-400 italic', text: 'unavailable' }));
    }
    return h('div', { class: 'bg-gray-50 rounded-md p-2.5 border border-gray-100' }, [
      h('div', { class: 'flex items-center justify-between mb-1' }, head),
      critic ? h('p', { class: 'text-xs text-gray-500 italic', text: critic.analysis }) : null
    ]);
  }

  function scorePair(label, value) {
    return h('span', { class: 'text-xs text-gray-500' }, [label + ':', h('span', { class: 'font-bold text-gray-800', text: String(value) })]);
  }

  function rankColor(rank) {
    return rank === 5 ? 'text-green-700' : rank === 3 ? 'text-yellow-600' : 'text-gray-400';
  }

  function candidatesSection(post, readOnly) {
    var id = post.id;
    var cands = post.candidates;
    var selectedIdx = Math.max(0, cands.findIndex(function (c) { return c.selected; }));

    var tabs = h('div', { class: 'flex border-b border-gray-200' }, cands.map(function (c, idx) {
      var on = idx === selectedIdx;
      return h('button', {
        id: 'tab-' + id + '-' + idx,
        class: 'flex-1 px-3 py-2 text-sm font-medium text-center transition-colors relative ' +
          (on ? 'text-brand-700 bg-brand-50 border-b-2 border-brand-600' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'),
        onclick: function () { switchCandidateTab(id, idx); }
      }, [
        h('span', { class: 'truncate block', text: c.title }),
        h('span', { class: 'text-xs ' + (c.selected ? 'text-brand-600' : 'text-gray-400'),
          text: (c.curatorRanking ? 'Rank: ' + c.curatorRanking.rank + '/5' : '') + (c.selected ? ' ★ Top Pick' : '') })
      ]);
    }));

    var panels = cands.map(function (c, idx) {
      var cs = c.criticScores || {};
      var scores = h('div', { class: 'space-y-2.5' }, [
        criticBox('Composition', cs.composition, function (s) {
          return h('span', { class: 'text-sm font-bold text-gray-800' }, [String(s.composition), h('span', { class: 'text-xs font-normal text-gray-400', text: '/10' })]);
        }),
        criticBox('Color & Tone', cs.colorTonal, function (s) {
          return h('span', null, [scorePair('C', s.color), ' ', scorePair('T', s.tonalQuality)]);
        }),
        criticBox('Artistic Impact', cs.artisticImpact, function (s) {
          return h('span', null, [scorePair('S', s.subject), ' ', scorePair('I', s.artisticImpact)]);
        }),
        c.curatorRanking ? h('div', {
          class: 'rounded-md p-2.5 border ' + (c.curatorRanking.rank === 5 ? 'bg-green-50 border-green-200' : c.curatorRanking.rank === 3 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200')
        }, [
          h('div', { class: 'flex items-center justify-between mb-1' }, [
            h('span', { class: 'text-xs font-semibold text-gray-600 uppercase tracking-wider', text: 'Curator Verdict' }),
            h('span', { class: 'text-xs text-gray-400', text: 'anthropic' })
          ]),
          h('p', { class: 'text-xs text-gray-600', text: c.curatorRanking.reasoning })
        ]) : null
      ]);

      var info = [
        h('div', { class: 'flex items-center justify-between mb-3' }, [
          h('div', null, [
            h('h5', { class: 'text-sm font-semibold text-gray-900', text: c.title }),
            h('div', { class: 'flex items-center gap-1.5 mt-0.5' }, [
              badge(c.primaryTheme, 'bg-brand-100 text-brand-700'),
              c.selected ? badge('Top Pick', 'bg-green-100 text-green-800') : null
            ])
          ]),
          c.curatorRanking ? h('div', { class: 'text-right' }, [
            h('div', { class: 'text-2xl font-bold ' + rankColor(c.curatorRanking.rank), text: String(c.curatorRanking.rank) }),
            h('div', { class: 'text-xs text-gray-400', text: 'curator rank' })
          ]) : null
        ]),
        scores
      ];
      if (!c.selected && !readOnly) {
        info.push(h('div', { class: 'mt-3 pt-3 border-t border-gray-200' }, [
          h('button', {
            class: 'w-full ' + BTN_PRIMARY,
            text: 'Select This Photo & Generate Caption',
            onclick: function (e) { selectCandidate(id, c.filename, e.currentTarget); }
          })
        ]));
      }

      return h('div', { id: 'panel-' + id + '-' + idx, class: idx === selectedIdx ? '' : 'hidden' }, [
        h('div', { class: 'flex flex-col md:flex-row' }, [
          h('div', { class: 'md:w-1/2 p-3 bg-gray-900 flex items-center justify-center' }, [
            h('img', { src: photoUrl(c.filename), alt: c.title, class: 'max-h-80 w-auto object-contain rounded', loading: 'lazy' })
          ]),
          h('div', { class: 'md:w-1/2 p-4' }, info)
        ])
      ]);
    });

    return h('div', { class: 'mb-3 border border-gray-200 rounded-lg overflow-hidden', id: 'candidates-' + id }, [
      h('div', { class: 'flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200' }, [
        h('h4', { class: 'text-xs font-medium text-gray-500 uppercase tracking-wider', text: 'Image Candidates' }),
        h('span', { class: 'text-xs text-gray-400', text: cands.length + ' evaluated by 4 critics' })
      ]),
      tabs,
      panels
    ]);
  }

  function switchCandidateTab(postId, idx) {
    var container = document.getElementById('candidates-' + postId);
    if (!container) return;
    container.querySelectorAll('[id^="panel-' + postId + '-"]').forEach(function (p) { p.classList.add('hidden'); });
    container.querySelectorAll('[id^="tab-' + postId + '-"]').forEach(function (t) {
      t.classList.remove('text-brand-700', 'bg-brand-50', 'border-b-2', 'border-brand-600');
      t.classList.add('text-gray-500');
    });
    var panel = document.getElementById('panel-' + postId + '-' + idx);
    var tab = document.getElementById('tab-' + postId + '-' + idx);
    if (panel) panel.classList.remove('hidden');
    if (tab) {
      tab.classList.remove('text-gray-500');
      tab.classList.add('text-brand-700', 'bg-brand-50', 'border-b-2', 'border-brand-600');
    }
  }

  // ---------------------------------------------------------------------------
  // Post detail
  // ---------------------------------------------------------------------------

  async function renderPostDetail(id) {
    var post = await apiJson('/api/posts/' + encodeURIComponent(id), { allow404: true });
    if (!post) {
      mount([h('div', { class: 'text-center py-12' }, [
        h('h2', { class: 'text-xl font-semibold text-gray-900 mb-2', text: 'Post not found' }),
        h('a', { href: '/', 'data-link': true, class: 'text-brand-600 hover:underline', text: 'Back to dashboard' })
      ])]);
      return;
    }
    mount([
      h('div', { class: 'mb-4' }, [
        h('a', { href: post.status === 'posted' ? '/posted' : '/', 'data-link': true, class: 'text-sm text-brand-600 hover:underline', text: '← Back' })
      ]),
      draftCard(post)
    ]);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  function runPipeline(btn) {
    return withButton(btn, 'Scoring photos...', async function () {
      var searchInput = document.getElementById('search-terms-input');
      var searchTerms = searchInput ? searchInput.value.trim() : '';
      var opts = { method: 'POST' };
      if (searchTerms) opts = Object.assign(opts, jsonBody({ searchTerms: searchTerms }));
      var res = await apiFetch('/api/pipeline/run', opts, PIPELINE_BASE);
      var data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || 'Pipeline failed (' + res.status + ')');
      await navigateTo('/');
    });
  }

  function pickPhoto(filename, btn) {
    return withButton(btn, 'Picking...', async function () {
      var res = await apiFetch('/api/pipeline/pick', Object.assign({ method: 'POST' }, jsonBody({ filename: filename })), PIPELINE_BASE);
      var data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok) throw new Error((data && (data.error || data.message)) || 'Pick failed (' + res.status + ')');
      closePhotoPicker();
      await navigateTo('/');
    });
  }

  function selectCandidate(postId, filename, btn) {
    return withButton(btn, 'Selecting...', async function () {
      await apiJson('/api/posts/' + encodeURIComponent(postId) + '/select-photo', Object.assign({ method: 'POST' }, jsonBody({ filename: filename })));
      await render();
    });
  }

  function generateCaption(postId, btn) {
    return withButton(btn, 'Generating...', async function () {
      await apiJson('/api/posts/' + encodeURIComponent(postId) + '/generate-caption', { method: 'POST' });
      await render();
    });
  }

  function discardPost(postId, btn) {
    if (!window.confirm('Discard this draft?')) return Promise.resolve();
    return withButton(btn, 'Discarding...', async function () {
      var res = await apiFetch('/api/posts/' + encodeURIComponent(postId), { method: 'DELETE' });
      if (!res.ok) throw new Error('Discard failed (' + res.status + ')');
      await navigateTo('/');
    });
  }

  function startEditCaption(id) {
    document.getElementById('caption-display-' + id).classList.add('hidden');
    document.getElementById('caption-edit-' + id).classList.remove('hidden');
    var editBtn = document.getElementById('edit-btn-' + id);
    if (editBtn) editBtn.classList.add('hidden');
  }

  function cancelEditCaption(id) {
    document.getElementById('caption-display-' + id).classList.remove('hidden');
    document.getElementById('caption-edit-' + id).classList.add('hidden');
    var editBtn = document.getElementById('edit-btn-' + id);
    if (editBtn) editBtn.classList.remove('hidden');
  }

  function saveCaption(id, btn) {
    var caption = document.getElementById('caption-textarea-' + id).value;
    return withButton(btn, 'Saving...', async function () {
      await apiJson('/api/posts/' + encodeURIComponent(id) + '/caption', Object.assign({ method: 'PUT' }, jsonBody({ caption: caption })));
      await render();
    });
  }

  function postToMeta(postId, btn) {
    var platforms = [];
    ['facebook', 'instagram'].forEach(function (key) {
      var box = document.getElementById('platform-' + postId + '-' + key);
      if (box && box.checked && !box.disabled) platforms.push(key);
    });
    if (platforms.length === 0) {
      showError('Select at least one platform.');
      return Promise.resolve();
    }
    return withButton(btn, 'Posting...', async function () {
      await apiJson('/api/posts/' + encodeURIComponent(postId) + '/post', Object.assign({ method: 'POST' }, jsonBody({ platforms: platforms })));
      await navigateTo('/posted');
    });
  }

  // ---------------------------------------------------------------------------
  // Photo picker modal
  // ---------------------------------------------------------------------------

  var pickerPhotos = [];

  function ensurePickerModal() {
    var modal = document.getElementById('photo-picker');
    if (modal) return modal;
    modal = h('div', { id: 'photo-picker', class: 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4' }, [
      h('div', { class: 'bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col' }, [
        h('div', { class: 'flex items-center justify-between px-4 py-3 border-b border-gray-200' }, [
          h('h3', { class: 'text-lg font-semibold text-gray-900', text: 'Pick a Photo' }),
          h('button', { class: 'text-gray-400 hover:text-gray-600 text-2xl leading-none', text: '×', 'aria-label': 'Close', onclick: closePhotoPicker })
        ]),
        h('div', { class: 'px-4 py-3 border-b border-gray-200' }, [
          h('input', {
            id: 'photo-picker-search',
            type: 'text',
            placeholder: 'Search by title, tag, or theme...',
            class: 'w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            oninput: filterPhotoPicker
          })
        ]),
        h('div', { id: 'photo-picker-list', class: 'overflow-y-auto flex-1 divide-y divide-gray-100' })
      ])
    ]);
    modal.addEventListener('click', function (e) { if (e.target === modal) closePhotoPicker(); });
    document.body.appendChild(modal);
    return modal;
  }

  async function openPhotoPicker() {
    var modal = ensurePickerModal();
    modal.classList.remove('hidden');
    var list = document.getElementById('photo-picker-list');
    list.textContent = '';
    list.appendChild(h('p', { class: 'p-4 text-sm text-gray-500', text: 'Loading photos...' }));
    document.getElementById('photo-picker-search').value = '';
    try {
      var data = await apiJson('/api/photos', { allow404: true });
      pickerPhotos = Array.isArray(data) ? data : ((data && data.photos) || []);
      filterPhotoPicker();
      document.getElementById('photo-picker-search').focus();
    } catch (err) {
      list.textContent = '';
      list.appendChild(h('p', { class: 'p-4 text-sm text-red-600', text: err.message || 'Failed to load photos' }));
    }
  }

  function closePhotoPicker() {
    var modal = document.getElementById('photo-picker');
    if (modal) modal.classList.add('hidden');
  }

  function filterPhotoPicker() {
    var list = document.getElementById('photo-picker-list');
    var q = (document.getElementById('photo-picker-search').value || '').trim().toLowerCase();
    var matches = pickerPhotos.filter(function (p) {
      if (!q) return true;
      var hay = [p.title, p.filename, p.primaryTheme, (p.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    list.textContent = '';
    if (matches.length === 0) {
      list.appendChild(h('p', { class: 'p-4 text-sm text-gray-500', text: 'No photos match.' }));
      return;
    }
    matches.slice(0, 200).forEach(function (p) {
      var row = h('button', {
        class: 'w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-brand-50 transition-colors ' + (p.used ? 'opacity-60' : ''),
        onclick: function (e) { pickPhoto(p.filename, e.currentTarget); }
      }, [
        h('img', { src: photoUrl(p.filename), alt: '', loading: 'lazy', class: 'w-16 h-16 object-cover rounded bg-gray-200 flex-shrink-0' }),
        h('div', { class: 'min-w-0 flex-1' }, [
          h('div', { class: 'text-sm font-medium text-gray-900 truncate', text: p.title || p.filename }),
          h('div', { class: 'flex items-center gap-1.5 mt-0.5' }, [
            p.primaryTheme ? themeBadge(p.primaryTheme) : null,
            p.used ? badge('Used', 'bg-gray-100 text-gray-600') : null
          ])
        ])
      ]);
      list.appendChild(row);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePhotoPicker();
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  async function init() {
    if (!CONFIG.cognitoClientId || !CONFIG.cognitoDomain) {
      mount([h('p', { class: 'text-red-600 text-sm', text: 'Missing configuration (config.js).' })]);
      return;
    }
    if (window.location.search.indexOf('code=') !== -1 || window.location.search.indexOf('error=') !== -1) {
      var result = await handleCallback();
      if (result && !result.ok) {
        mount([
          h('div', { class: 'bg-red-50 border border-red-200 rounded-lg p-6 text-center' }, [
            h('p', { class: 'text-red-700 font-medium', text: 'Sign-in failed' }),
            h('p', { class: 'text-red-600 text-sm mt-1', text: result.error }),
            h('button', {
              class: 'mt-4 px-4 py-2 bg-brand-600 text-white rounded-md hover:bg-brand-700',
              text: 'Try again',
              onclick: function () { login(); }
            })
          ])
        ]);
        return;
      }
    }
    var token = await getIdToken();
    if (!token) return;
    await render();
  }

  init();
})();
