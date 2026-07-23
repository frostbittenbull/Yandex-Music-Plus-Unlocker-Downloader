// ==UserScript==
// @name         Yandex Music — Plus Unlocker & Downloader
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @updateURL    https://github.com/frostbittenbull/Yandex-Music-Plus-Unlocker-Downloader/raw/refs/heads/main/Yandex-Music-Plus-Unlocker-Downloader.user.js
// @downloadURL  https://github.com/frostbittenbull/Yandex-Music-Plus-Unlocker-Downloader/raw/refs/heads/main/Yandex-Music-Plus-Unlocker-Downloader.user.js
// @description  Яндекс.Музыка — Разблокировка подписки "Плюс", "Моей волны", региональных ограничений, полных треков, вырезание рекламы, скачивание треков/плейлистов с выбором качества и поддержкой тегов для MP3 и нативного FLAC (с собственным демуксером из MP4-контейнера)
// @author       frostbittenbull
// @icon         https://music.yandex.ru/favicon.svg
// @icon64       https://music.yandex.ru/favicon.svg
// @match        https://music.yandex.ru/*
// @match        https://music.yandex.by/*
// @match        https://music.yandex.kz/*
// @match        https://music.yandex.uz/*
// @match        https://music.yandex.com/*
// @match        https://music.yandex.com.am/*
// @match        https://music.yandex.com.ge/*
// @match        https://music.yandex.com.tr/*
// @match        https://music.yandex.az/*
// @match        https://music.yandex.md/*
// @match        https://music.yandex.tj/*
// @match        https://music.yandex.tm/*
// @match        https://music.yandex.kg/*
// @match        https://music.yandex.ua/*
// @include      https://music.yandex.*/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.music.yandex.net
// @connect      avatars.yandex.net
// @connect      strm.yandex.net
// @connect      *.strm.yandex.net
// @connect      storage.yandex.net
// @connect      *.storage.yandex.net
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const regexReplacements = [
        [/"hasPlus":\s*false/gi,                   '"hasPlus":true'],
        [/"premium":\s*false/gi,                   '"premium":true'],
        [/"isFreemium":\s*true/gi,                 '"isFreemium":false'],
        [/"isTrialAvailable":\s*true/gi,           '"isTrialAvailable":false'],
        [/"advertisementDisabled":\s*false/gi,     '"advertisementDisabled":true'],
        [/"radioNoAds":\s*false/gi,                '"radioNoAds":true'],
        [/"isNoAdsFeaturesAvailable":\s*false/gi,  '"isNoAdsFeaturesAvailable":true'],
        [/"canStartTrial":\s*true/gi,              '"canStartTrial":false'],
        [/\\"hasPlus\\":\s*false/gi,               '\\"hasPlus\\":true'],
        [/\\"premium\\":\s*false/gi,               '\\"premium\\":true'],
        [/\\"isFreemium\\":\s*true/gi,             '\\"isFreemium\\":false'],
        [/\\"isTrialAvailable\\":\s*true/gi,       '\\"isTrialAvailable\\":false'],
        [/hasPlus\\?":false/gi,    'hasPlus":true'],
        [/isFreemium\\?":true/gi,  'isFreemium":false'],
        [/"geoRegionIso":\s*"[a-zA-Z]{2}"/gi,              '"geoRegionIso":"ru"'],
        [/"userSessionRegionIso":\s*"[a-zA-Z]{2}"/gi,      '"userSessionRegionIso":"ru"'],
        [/\\"geoRegionIso\\":\s*\\"[a-zA-Z]{2}\\"/gi,          '\\"geoRegionIso\\":\\"ru\\"'],
        [/\\"userSessionRegionIso\\":\s*\\"[a-zA-Z]{2}\\"/gi,  '\\"userSessionRegionIso\\":\\"ru\\"'],
        [/"serviceAvailable":\s*false/gi,    '"serviceAvailable":true'],
        [/\\"serviceAvailable\\":\s*false/gi, '\\"serviceAvailable\\":true'],
        [/"WebNextBlockFullscreen":\{"group":"on"/gi,              '"WebNextBlockFullscreen":{"group":"off"'],
        [/\\"WebNextBlockFullscreen\\":\{\\"group\\":\\"on\\"/gi, '\\"WebNextBlockFullscreen\\":\{\\"group\\":\\"off\\"'],
    ];

    function applyRegex(text) {
        if (typeof text !== 'string') return text;
        if (!text.includes('false') && !text.includes('true') &&
            !text.includes('RegionIso') && !text.includes('serviceAvailable') &&
            !text.includes('WebNextBlockFullscreen')) return text;
        let modified = text;
        for (const [regex, replacement] of regexReplacements) {
            modified = modified.replace(regex, replacement);
        }
        return modified;
    }

    const _origParse = win.JSON.parse;
    win.JSON.parse = function (text, reviver) {
        return _origParse.call(this, applyRegex(text), reviver);
    };

    (function hookNextF() {
        const existing = win.__next_f || [];
        const patched = [];
        for (const chunk of existing) {
            if (Array.isArray(chunk) && typeof chunk[1] === 'string') chunk[1] = applyRegex(chunk[1]);
            patched.push(chunk);
        }
        patched.push = function (...args) {
            for (const chunk of args) {
                if (Array.isArray(chunk) && typeof chunk[1] === 'string') chunk[1] = applyRegex(chunk[1]);
            }
            return Array.prototype.push.apply(this, args);
        };
        win.__next_f = patched;
    })();

    let _nextFHooked = false;
    Object.defineProperty(win, '__next_f', {
        configurable: true,
        get() { return this._next_f; },
        set(val) {
            if (!_nextFHooked && Array.isArray(val)) {
                _nextFHooked = true;
                const orig = val.push.bind(val);
                val.push = function (...args) {
                    for (const chunk of args) {
                        if (Array.isArray(chunk) && typeof chunk[1] === 'string') chunk[1] = applyRegex(chunk[1]);
                    }
                    return orig(...args);
                };
            }
            this._next_f = val;
        }
    });

    (function hookStatePatches() {
        const patchPush = (origPush) => function (...args) {
            const result = origPush.apply(this, args);
            for (const patchSet of args) {
                if (!Array.isArray(patchSet)) continue;
                for (const op of patchSet) {
                    if (op.op === 'replace') {
                        const p = op.path || '';
                        if (p.includes('hasPlus')                && op.value === false) op.value = true;
                        if (p.includes('premium')               && op.value === false) op.value = true;
                        if (p.includes('isFreemium')            && op.value === true)  op.value = false;
                        if (p.includes('isTrialAvailable')      && op.value === true)  op.value = false;
                        if (p.includes('advertisementDisabled') && op.value === false) op.value = true;
                        if (p.includes('radioNoAds')            && op.value === false) op.value = true;
                        if (p.includes('canStartTrial')         && op.value === true)  op.value = false;
                        if (p.includes('geoRegionIso'))          op.value = 'ru';
                        if (p.includes('userSessionRegionIso'))  op.value = 'ru';
                        if (p.includes('serviceAvailable')      && op.value === false) op.value = true;
                        if (p.includes('experiments') && typeof op.value === 'object' && op.value !== null) {
                            if (op.value.WebNextBlockFullscreen) {
                                op.value.WebNextBlockFullscreen.group = 'off';
                                if (op.value.WebNextBlockFullscreen.value) {
                                    op.value.WebNextBlockFullscreen.value.title = 'off';
                                }
                            }
                        }
                        if (p.includes('WebNextBlockFullscreen') && typeof op.value === 'object' && op.value !== null) {
                            op.value.group = 'off';
                            if (op.value.value) op.value.value.title = 'off';
                        }
                    }
                }
            }
            return result;
        };
        const existing = win.__STATE_PATCHES__;
        if (existing && Array.isArray(existing)) existing.push = patchPush(existing.push.bind(existing));
        Object.defineProperty(win, '__STATE_PATCHES__', {
            configurable: true,
            get() { return this._state_patches; },
            set(val) {
                if (Array.isArray(val)) val.push = patchPush(val.push.bind(val));
                this._state_patches = val;
            }
        });
    })();

    (function hookXHR() {
        const XHR = win.XMLHttpRequest.prototype;
        const rtDesc = Object.getOwnPropertyDescriptor(XHR, 'responseText');
        Object.defineProperty(XHR, 'responseText', {
            get: function () {
                let text = rtDesc.get.call(this);
                return applyRegex(text);
            }
        });
        const _xhrOpen = XHR.open;
        XHR.open = function (method, url) {
            this._url = typeof url === 'string' ? url : url?.href;
            return _xhrOpen.apply(this, arguments);
        };
    })();

    (function killBlockPage() {
        function removeBlockPages() {
            document.querySelectorAll('.BlockPage_root__crGK_, [class*="BlockPage_root"]').forEach(el => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
            });
        }
        if (document.body) removeBlockPages();
        const obs = new MutationObserver(removeBlockPages);
        const startObs = () => obs.observe(document.body, { childList: true, subtree: true });
        if (document.body) startObs();
        else document.addEventListener('DOMContentLoaded', startObs, { once: true });
    })();

    setInterval(function enforceHQ() {
        try {
            const raw = win.localStorage?.ymPlayerQuality;
            if (raw) {
                const data = _origParse(raw);
                if (data?.value !== 'high_quality') {
                    data.value = 'high_quality';
                    data.expires = '2077-01-01T11:29:20.427Z';
                    win.localStorage.setItem('ymPlayerQuality', JSON.stringify(data));
                }
            }
        } catch (e) {}
    }, 3000);

    function cleanRotorSession(obj) {
        if (obj?.result?.sequence) {
            obj.result.sequence = obj.result.sequence.filter(item => {
                if (item.type === 'ad') return false;
                const title = item?.track?.title?.toLowerCase() || '';
                return !title.includes('промокод') && !title.includes('upgrade') && !title.includes('реклама');
            });
        }
        return obj;
    }

    const _style = document.createElement('style');
    _style.textContent = `
        /* === Заглушка блокировки региона === */
        .BlockPage_root__crGK_,
        [class*="BlockPage_root"] { display: none !important; }

        /* === Скрытие Plus-баннеров: конкретные хэш-классы (Downloader) === */
        .NavbarDesktopAnimatedPlusBar_root___wH9W,
        .NavbarDesktopAnimatedBar_root__tTyvO,
        .VibePageFreemiumBlock_root__HCPuh,
        .VibePage_freemiumBlock__uhLoT { display: none !important; }
        .PaywallModal_root__HIYOy,
        [data-floating-ui-portal]:has(.PaywallModal_root__HIYOy) { display: none !important; pointer-events: none !important; }
        [data-floating-ui-portal]:has(.Vi7Rd0SZWqD17F0872TB) { display: none !important; pointer-events: none !important; }
        .l66GiFKS1Ux_BNd603Cu.NaZE1NCUxSM1MvpZuLJV[data-floating-ui-inert] { display: none !important; pointer-events: none !important; }

        /* === Скрытие Plus-баннеров: паттерн-селекторы (Unlocker, устойчивее к смене хэшей) === */
        div[class*="PopoverWithActions_root"],
        [class*="NavbarDesktopAnimatedPlusBar_root"],
        [class*="NavbarDesktopPlusBar_root"],
        [class*="VibePageFreemiumBlock_root"] {
            display: none !important;
        }

        /* === Кнопка Download All === */
        button.ymd-dl-all-btn { order: 2 !important; }
        button.ymd-dl-all-btn .ymd-btn-icon { display: none; }
        @media only screen and (max-width: 767.98px) {
            button.ymd-dl-all-btn { display: none !important; }
        }

        /* === Восстановление Vibe-плеера (Unlocker) === */
        .VibePage_playerBlock__b6ZRu {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: space-between !important;
            flex: 0 0 var(--player-block-height) !important;
            width: 100% !important;
            gap: var(--ym-spacer-size-xs) !important;
            z-index: 1 !important;
            pointer-events: auto !important;
        }
        .VibePlayerBar_root__G3MOe {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        .VibePlayerBar_progress__Cri6E {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        .WordsCard_root__6r3u2 {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        .VibePage_words__39Mii {
            display: flex !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(_style);

    const SECRET_KEY = "kzqU4XhfCaY6B6JTHODeq5";
    const API_BASE = "https://api.music.yandex.net";

    const QUALITY_OPTIONS = [
        { label: "Lossless → FLAC",           value: "lossless", codecs: ["flac", "flac-mp4"] },
        { label: "High → MP3 (~320 kbps)",    value: "hq",       codecs: ["mp3"] },
        { label: "Low → MP3 (~192 kbps)",     value: "lq",       codecs: ["mp3"] },
    ];

    function guessCoverMime(buf) {
        const view = new Uint8Array(buf.slice(0, 8));
        if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
        if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) return { mime: 'image/png', ext: 'png' };
        return { mime: 'image/jpeg', ext: 'jpg' };
    }

    (function injectPageInterceptor() {
        const script = document.createElement('script');
        script.textContent = `(function() {
            function saveToken(t) {
                if (!t || t.length < 20) return;
                try { sessionStorage.setItem('ymd_intercepted_token', t); sessionStorage.setItem('ymd_injector_ok', '1'); } catch(e) {}
            }
            const _f = window.fetch;
            window.fetch = function(input, init) {
                try {
                    const h = init && init.headers;
                    let auth = null;
                    if (h && h.get) auth = h.get('Authorization');
                    else if (h) auth = h['Authorization'] || h['authorization'];
                    if (auth && /^OAuth\\s+/.test(auth)) saveToken(auth.replace(/^OAuth\\s+/, ''));
                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                    const m = url.match(/[?&](?:oauth_token|access_token)=([A-Za-z0-9._-]{20,})/);
                    if (m) saveToken(m[1]);
                } catch(e) {}
                return _f.apply(this, arguments);
            };
            const _sh = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                try {
                    if (/^authorization$/i.test(name) && /^OAuth\\s+/.test(value))
                        saveToken(value.replace(/^OAuth\\s+/, ''));
                } catch(e) {}
                return _sh.call(this, name, value);
            };
            const _op = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
                try {
                    const m = String(url).match(/[?&](?:oauth_token|access_token)=([A-Za-z0-9._-]{20,})/);
                    if (m) saveToken(m[1]);
                } catch(e) {}
                return _op.apply(this, arguments);
            };
        })();`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();

        const tokenSync = setInterval(function() {
            try {
                const t = sessionStorage.getItem('ymd_intercepted_token');
                if (t && t.length > 20) {
                    const stored = GM_getValue('ymd_oauth_token', null);
                    if (stored !== t) GM_setValue('ymd_oauth_token', t);
                    clearInterval(tokenSync);
                }
            } catch(e) {}
        }, 1000);

        try {
            const hash = window.location.hash;
            if (hash.includes('access_token=')) {
                const m = hash.match(/access_token=([A-Za-z0-9._-]+)/);
                if (m) GM_setValue('ymd_oauth_token', m[1]);
            }
        } catch(e) {}
    })();

    const iconSvg = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"
         style="margin-right:6px;display:inline-block;vertical-align:middle;">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    </svg>`;

    const downloadSmallSvgIcon = `<svg class="J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#download_xxs"></use></svg>`;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const waitIfPaused = () => new Promise(resolve => {
        if (!downloadPaused) { resolve(); return; }
        const check = setInterval(() => { if (!downloadPaused) { clearInterval(check); resolve(); } }, 300);
    });

    let _chartBtn = null;

    let _folderHandle = null;

    async function pickFolder() {
        if (!('showDirectoryPicker' in window)) return null;
        try {
            _folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            return _folderHandle;
        } catch(e) {
            _folderHandle = null;
            return null;
        }
    }

    async function saveToFolder(buf, filename, mime) {
        if (!_folderHandle) return false;
        try {
            const fileHandle = await _folderHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(new Blob([buf], { type: mime }));
            await writable.close();
            return true;
        } catch(e) {
            console.warn('[YMD] saveToFolder error:', e);
            return false;
        }
    }

    async function saveFile(buf, filename, mime) {
        if (_folderHandle) {
            const ok = await saveToFolder(buf, filename, mime);
            if (ok) return;
        }
        downloadBlob(buf, filename, mime);
    }

    function sanitize(name) {
        return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
    }

    function deepFindToken(obj, depth) {
        if (!obj || depth > 5 || typeof obj !== 'object') return null;
        for (const key of Object.keys(obj)) {
            try {
                const val = obj[key];
                if (typeof val === 'string' && val.length > 20 && val.length < 200
                    && /^[A-Za-z0-9._-]+$/.test(val)
                    && /(token|oauth|access)/i.test(key)) {
                    return val;
                }
                if (val && typeof val === 'object') {
                    const found = deepFindToken(val, depth + 1);
                    if (found) return found;
                }
            } catch(e) {}
        }
        return null;
    }

    function getOAuthToken() {
        const stored = GM_getValue('ymd_oauth_token', null);
        if (stored && typeof stored === 'string' && stored.length > 10) return "OAuth " + stored;

        try {
            const t = sessionStorage.getItem('ymd_intercepted_token');
            if (t && t.length > 20) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
        } catch(e) {}

        try {
            const candidates = [
                unsafeWindow.Ya, unsafeWindow.__YA__,
                unsafeWindow.__store__?.getState?.(),
                unsafeWindow.__redux_store__?.getState?.(),
                unsafeWindow.__initialData__,
                unsafeWindow.__STATE__,
                unsafeWindow.externalAPI,
            ];
            for (const c of candidates) {
                if (!c) continue;
                const t = deepFindToken(c, 0);
                if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
            }
        } catch(e) {}

        try {
            const snap = unsafeWindow.__STATE_SNAPSHOT__;
            const arr = Array.isArray(snap) ? snap : [snap];
            for (const s of arr) {
                const t = deepFindToken(s, 0);
                if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
            }
        } catch(e) {}

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                const val = localStorage.getItem(key);
                if (!val) continue;
                try {
                    const p = JSON.parse(val);
                    const t = deepFindToken(p, 0);
                    if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
                } catch(e) {
                    if (/(oauth|token)/i.test(key) && val.length > 20
                        && val.length < 200 && /^[A-Za-z0-9._-]+$/.test(val)) {
                        GM_setValue('ymd_oauth_token', val);
                        return "OAuth " + val;
                    }
                }
            }
        } catch(e) {}

        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (!key || !/(oauth|token)/i.test(key)) continue;
                const val = sessionStorage.getItem(key);
                if (!val) continue;
                try {
                    const p = JSON.parse(val);
                    const t = deepFindToken(p, 0);
                    if (t) { GM_setValue('ymd_oauth_token', t); return "OAuth " + t; }
                } catch(e) {
                    if (val.length > 20 && /^[A-Za-z0-9._-]+$/.test(val)) {
                        GM_setValue('ymd_oauth_token', val);
                        return "OAuth " + val;
                    }
                }
            }
        } catch(e) {}

        return null;
    }

    function autoGetToken(silent = false) {
        const CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d";
        const authUrl = "https://oauth.yandex.ru/authorize?response_type=token&client_id=" + CLIENT_ID;
        const popup = window.open(authUrl, "ymd_oauth", "width=600,height=500,left=200,top=100");
        if (!popup) {
            if (!silent) alert("Разрешите всплывающие окна для music.yandex.ru и попробуйте снова.");
            return;
        }
        status("Ожидание авторизации в открывшемся окне...");
        const timer = setInterval(() => {
            try {
                const url = popup.location.href;
                if (url.includes("access_token=")) {
                    const m = url.match(/access_token=([A-Za-z0-9._-]+)/);
                    if (m && m[1]) {
                        GM_setValue('ymd_oauth_token', m[1]);
                        clearInterval(timer);
                        popup.close();
                        status("✓ Токен получен! Можно качать.");
                        hideStatus(3000);
                    }
                }
            } catch(e) {}
            if (popup.closed) {
                clearInterval(timer);
                if (!GM_getValue('ymd_oauth_token', null) && !silent)
                    status("Окно закрыто без авторизации.", true);
            }
        }, 300);
    }

    function showAuthBanner() {
        if (GM_getValue('ymd_oauth_token', null)) return;
        const banner = document.createElement('div');
        banner.id = 'ymd-auth-banner';
        banner.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:999999;
            -webkit-backdrop-filter:blur(.875rem);backdrop-filter:blur(.875rem);background-color:var(--ym-background-color-primary-enabled-menu);border:none;border-radius:var(--ym-radius-size-xl);box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu);
            color:#fff; padding:14px 18px;
            font-family:var(--ym-font-text); font-size:14px; max-width:320px;
            display:flex; align-items:center; gap:12px;
        `;
        banner.innerHTML = `
            <div style="flex:1; line-height:1.4;">
                <b style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</b><br>
                Нажмите "Войти"<br>чтобы авторизоваться<br>(больше не появится)
            </div>
            <button id="ymd-auth-btn" style="
                background:#ffff00; color:#000; border:none; border-radius:16px;
                padding:8px 14px; cursor:pointer; font-size:13px; font-weight:bold;
                white-space:nowrap; flex-shrink:0; font-family:var(--ym-font-heading);
            ">Войти</button>
            <span id="ymd-banner-close" style="
                cursor:pointer; color:#666; font-size:18px;
                padding:0 2px; flex-shrink:0; user-select:none;
            " title="Скрыть">✕</span>
        `;
        document.body.appendChild(banner);
        banner.querySelector('#ymd-auth-btn').addEventListener('click', () => { banner.remove(); autoGetToken(false); });
        banner.querySelector('#ymd-banner-close').addEventListener('click', () => banner.remove());
    }

    function promptForToken() {
        const current = GM_getValue('ymd_oauth_token', '') || '';
        const input = prompt(
            "Введите OAuth токен:\n\n" +
            "1) Откройте: https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d\n" +
            "2) Скопируйте access_token из адресной строки\n" +
            "3) Вставьте сюда\n\n" +
            "(Если вы уже авторизованы на сайте — токен подхватится автоматически при воспроизведении любого трека)",
            current
        );
        if (input === null) return;
        const cleaned = input.trim().replace(/^OAuth\s+/i, '');
        if (cleaned.length < 10) { alert("Неверный токен"); return; }
        GM_setValue('ymd_oauth_token', cleaned);
        alert("Токен сохранён. Обновите страницу.");
    }

    try {
        GM_registerMenuCommand("⚙️ Настроить токен", promptForToken);
        GM_registerMenuCommand("🔑 Получить токен автоматически", autoGetToken);
        GM_registerMenuCommand("🗑️ Сбросить токен", () => {
            GM_setValue('ymd_oauth_token', null);
            sessionStorage.removeItem('ymd_intercepted_token');
            alert("Токен сброшен.");
        });
        GM_registerMenuCommand("🔍 Диагностика токена", function() {
            const lines = [];
            const gm = GM_getValue('ymd_oauth_token', null);
            lines.push('=== GM хранилище ===');
            lines.push(gm ? 'ЕСТЬ: ' + gm.slice(0,12) + '...' : 'пусто');
            lines.push('=== sessionStorage[ymd_intercepted_token] ===');
            try {
                const ss = sessionStorage.getItem('ymd_intercepted_token');
                lines.push(ss ? 'ЕСТЬ: ' + ss.slice(0,12) + '...' : 'пусто');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== sessionStorage ключи ===');
            try {
                const keys = [];
                for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
                lines.push(keys.join(', ') || '(пусто)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== localStorage ключи ===');
            try {
                const keys = [];
                for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
                lines.push(keys.join(', ') || '(пусто)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Глобальные объекты ===');
            try {
                const globals = ['Ya','__YA__','__store__','__redux_store__','__initialData__','__STATE__','externalAPI','__STATE_SNAPSHOT__'];
                const found = globals.filter(k => { try { return !!unsafeWindow[k]; } catch(e) { return false; } });
                lines.push(found.join(', ') || '(ничего)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya ключи ===');
            try {
                const ya = unsafeWindow.Ya;
                if (ya) lines.push(Object.keys(ya).join(', '));
                else lines.push('(нет Ya)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya.Music ===');
            try {
                const ym = unsafeWindow.Ya && unsafeWindow.Ya.Music;
                if (ym) lines.push(Object.keys(ym).join(', '));
                else lines.push('(нет)');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Ya токен ===');
            try {
                const ya = unsafeWindow.Ya;
                const candidates = [
                    ya?.token, ya?.oauth, ya?.accessToken,
                    ya?.Music?.token, ya?.Music?.oauth,
                    ya?.Rum?.token,
                    ya?.d?.token, ya?.d?.oauth,
                ];
                const t = candidates.find(x => x && typeof x === 'string' && x.length > 20);
                lines.push(t ? 'ЕСТЬ: ' + t.slice(0,12) + '...' : 'не найден');
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== XHR перехват ===');
            try {
                lines.push('toString: ' + XMLHttpRequest.prototype.setRequestHeader.toString().slice(0, 60));
            } catch(e) { lines.push('ошибка: ' + e); }
            lines.push('=== Инжектор ===');
            try {
                const inj = sessionStorage.getItem('ymd_injector_ok');
                lines.push(inj ? 'ДА, сработал' : 'НЕТ (или ещё не перехватил запрос)');
            } catch(e) { lines.push('ошибка: ' + e); }
            const result = lines.join('\n');
            console.log('[YMD ДИАГНОСТИКА]\n' + result);
            alert('[YMD ДИАГНОСТИКА]\n\n' + result);
        });
    } catch (e) {}

    function getVersion() {
        return (unsafeWindow && unsafeWindow.VERSION) || '5.32.1';
    }

    let panel = document.getElementById('ymd-panel') || document.createElement('div');
    if (!panel.id) {
        panel.id = 'ymd-panel';
        panel.style.cssText = `
            position:fixed; bottom:20px; right:20px;
            -webkit-backdrop-filter:blur(.875rem);
            backdrop-filter:blur(.875rem);
            background-color:var(--ym-background-color-primary-enabled-menu);
            border:none;
            border-radius:var(--ym-radius-size-xl);
            box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu);
            color:#fff;
            padding:var(--ym-spacer-size-xs);
            z-index:999999; display:none; font-family:var(--ym-font-text);
            min-width:320px; max-width:460px;
        `;
    }

    function status(text, err = false) {
        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:${err ? '#ff5555' : '#ffff00'};font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                <span id="ymd-close" title="Закрыть" style="
                    cursor:pointer;font-size:18px;line-height:1;
                    color:#aaa;padding:0 4px;margin-left:10px;user-select:none;
                " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
            </div>
            <span style="font-size:14px;display:inline-block;line-height:1.4;">${text}</span>
        `;
        const closeBtn = panel.querySelector('#ymd-close');
        if (closeBtn) closeBtn.addEventListener('click', () => panel.style.display = 'none');
        if (err) console.error("[YMD]", text);
    }

    function hideStatus(ms = 4000) {
        setTimeout(() => panel.style.display = 'none', ms);
    }

    function setProgress(pct, loaded, total) {
        let bar = panel.querySelector('#ymd-progress');
        if (!bar) return;
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        bar.style.width = pct + '%';
        const label = panel.querySelector('#ymd-pct');
        if (label) {
            if (loaded != null && total != null && total > 0) {
                const toMB = b => (b / 1048576).toFixed(2);
                label.textContent = `${toMB(loaded)}/${toMB(total)} МБ · (${pct}/100%)`;
            } else {
                label.textContent = pct + '%';
            }
        }
    }

    function formatBadge(info) {
        if (!info) return '';
        const codec = (info.codec || '').toLowerCase();
        const br = info.bitrate || 0;
        let label, color;
        if (codec === 'flac' || codec === 'flac-mp4') {
            label = 'FLAC'; color = '#00bcd4';
        } else if (codec === 'mp3' && br >= 300) {
            label = 'MP3 320'; color = '#00e676';
        } else if (codec === 'mp3') {
            label = `MP3 ${br || '~192'}`; color = '#ff9800';
        } else {
            label = codec.toUpperCase() + (br ? ` ${br}` : ''); color = '#aaa';
        }
        return `<span style="
            display:inline-block;margin-left:8px;padding:1px 7px;border-radius:10px;
            font-size:11px;font-weight:bold;vertical-align:middle;
            background:${color}22;color:${color};border:1px solid ${color}55;
        ">${label}</span>`;
    }

    function statusWithProgress(trackName, trackNum, total, info) {
        panel.style.display = 'block';
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                <span id="ymd-close" title="Закрыть" style="
                    cursor:pointer;font-size:18px;line-height:1;
                    color:#aaa;padding:0 4px;margin-left:10px;user-select:none;
                " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
            </div>
            <span style="font-size:13px;color:#aaa;">Скачивание ${trackNum} из ${total}</span><br>
            <b style="color:#00e676;font-size:14px;">${trackName}</b>${formatBadge(info)}
            <div style="margin-top:10px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;height:6px;">
                <div id="ymd-progress" style="height:100%;width:0%;background:linear-gradient(90deg,#ffff00,#ff9800);transition:width 0.15s ease;border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                <span id="ymd-pct" style="font-size:12px;color:#aaa;">0%</span>
                <div style="display:flex;gap:6px;">
                    <button id="ymd-pause-btn" style="
                        background:rgba(255,200,0,0.15);color:#ffc800;
                        border:1px solid rgba(255,200,0,0.3);border-radius:6px;
                        padding:3px 10px;font-size:12px;cursor:pointer;
                    " onmouseover="this.style.background='rgba(255,200,0,0.3)'"
                      onmouseout="this.style.background='rgba(255,200,0,0.15)'">⏸ Пауза</button>
                    <button id="ymd-cancel-btn" style="
                        background:rgba(255,85,85,0.15);color:#ff5555;
                        border:1px solid rgba(255,85,85,0.3);border-radius:6px;
                        padding:3px 10px;font-size:12px;cursor:pointer;
                    " onmouseover="this.style.background='rgba(255,85,85,0.3)'"
                      onmouseout="this.style.background='rgba(255,85,85,0.15)'">Отмена</button>
                </div>
            </div>
        `;
        const closeBtn = panel.querySelector('#ymd-close');
        if (closeBtn) closeBtn.addEventListener('click', () => panel.style.display = 'none');
        const cancelBtn = panel.querySelector('#ymd-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => { downloadCancelled = true; });
        const pauseBtn = panel.querySelector('#ymd-pause-btn');
        if (pauseBtn) pauseBtn.addEventListener('click', () => {
            downloadPaused = !downloadPaused;
            pauseBtn.textContent = downloadPaused ? '▶ Продолжить' : '⏸ Пауза';
            pauseBtn.style.color = downloadPaused ? '#00e676' : '#ffc800';
            pauseBtn.style.borderColor = downloadPaused ? 'rgba(0,230,118,0.3)' : 'rgba(255,200,0,0.3)';
            pauseBtn.style.background = downloadPaused ? 'rgba(0,230,118,0.15)' : 'rgba(255,200,0,0.15)';
            pauseBtn.onmouseover = () => pauseBtn.style.background = downloadPaused ? 'rgba(0,230,118,0.3)' : 'rgba(255,200,0,0.3)';
            pauseBtn.onmouseout  = () => pauseBtn.style.background = downloadPaused ? 'rgba(0,230,118,0.15)' : 'rgba(255,200,0,0.15)';
        });
    }

    function showQualityPicker() {
        return new Promise((resolve) => {
            const savedIdx = GM_getValue('ymd_quality_idx', 0);
            const savedCovers = GM_getValue('ymd_download_covers', false);

            const isTaggableSaved = QUALITY_OPTIONS[savedIdx].codecs.some(c => c.includes('mp3') || c.includes('mp4') || c.includes('aac'));

            panel.style.display = 'block';
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                    <span id="ymd-close" title="Закрыть" style="cursor:pointer;font-size:18px;line-height:1;color:#aaa;padding:0 4px;margin-left:10px;user-select:none;"
                        onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
                </div>
                <div style="font-size:13px;margin-bottom:8px;color:#ccc;">Качество:</div>
                <div id="ymd-quality-btns" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                    ${QUALITY_OPTIONS.map((q, i) => `
                        <button data-qi="${i}" style="
                            background:${i === savedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)'};
                            border:1px solid ${i === savedIdx ? '#ffff00' : 'rgba(255,255,255,0.15)'};
                            border-radius:16px; color:#fff; padding:7px 12px; cursor:pointer;
                            font-size:13px; text-align:left;
                        " onmouseover="this.style.background='rgba(255,255,0,0.12)'"
                          onmouseout="this.style.background='${i === savedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)'}'">
                            ${q.label}
                        </button>
                    `).join('')}
                </div>
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#ccc;cursor:pointer;margin-bottom:12px;">
                    <input type="checkbox" id="ymd-covers-chk" ${savedCovers ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
                    <span id="ymd-covers-label">${isTaggableSaved ? 'Встраивать теги и обложки' : 'Скачивать обложки'}</span>
                </label>
                <button id="ymd-go-btn" style="
                    background:#ffff00; color:#000; border:none; border-radius:16px;
                    padding:8px 18px; cursor:pointer; font-size:13px; font-weight:bold; width:100%; font-family:var(--ym-font-heading);
                ">Скачать</button>
            `;

            let selectedIdx = savedIdx;

            const closeBtn = panel.querySelector('#ymd-close');
            if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; resolve(null); });

            panel.querySelectorAll('[data-qi]').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedIdx = parseInt(btn.dataset.qi);
                    panel.querySelectorAll('[data-qi]').forEach((b, i) => {
                        b.style.background = i === selectedIdx ? 'rgba(255,255,0,0.15)' : 'rgba(255,255,255,0.07)';
                        b.style.border = `1px solid ${i === selectedIdx ? '#ffff00' : 'rgba(255,255,255,0.15)'}`;
                    });
                    const isTaggable = QUALITY_OPTIONS[selectedIdx].codecs.some(c => c.includes('mp3') || c.includes('mp4') || c.includes('aac'));
                    panel.querySelector('#ymd-covers-label').textContent = isTaggable ? 'Встраивать теги и обложки' : 'Скачивать обложки';
                });
            });

            panel.querySelector('#ymd-go-btn').addEventListener('click', () => {
                const downloadCovers = panel.querySelector('#ymd-covers-chk').checked;
                GM_setValue('ymd_quality_idx', selectedIdx);
                GM_setValue('ymd_download_covers', downloadCovers);
                resolve({ quality: QUALITY_OPTIONS[selectedIdx], downloadCovers });
            });
        });
    }

    async function getSign(key, data) {
        const enc = new TextEncoder();
        const ck = await crypto.subtle.importKey(
            "raw", enc.encode(key),
            { name: "HMAC", hash: "SHA-256" },
            true, ["sign"]
        );
        const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(data));
        return btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, -1);
    }

    function gmFetch(url, headers = {}, timeout = 30000) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url, headers,
                timeout,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}: ${(res.responseText || '').slice(0, 200)}`));
                },
                ontimeout: () => reject(new Error("Превышено время ожидания")),
                onerror: () => reject(new Error("Сетевая ошибка"))
            });
        });
    }

    async function gmJSON(url, headers = {}) {
        const res = await gmFetch(url, headers);
        return JSON.parse(res.responseText);
    }

    async function fetchTokenFromPassport() {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: "https://music.yandex.ru/api/v2.1/handlers/auth?external-domain=music.yandex.ru&overembed=no",
                headers: { "Referer": "https://music.yandex.ru/" },
                onload: (res) => {
                    try {
                        const d = JSON.parse(res.responseText);
                        const t = d?.token || d?.oauth_token || d?.access_token;
                        if (t && t.length > 20) { resolve(t); return; }
                    } catch(e) {}
                    resolve(null);
                },
                onerror: () => resolve(null)
            });
        });
    }

    async function checkAuth() {
        if (!GM_getValue('ymd_oauth_token', null)) {
            try {
                const t = await fetchTokenFromPassport();
                if (t) GM_setValue('ymd_oauth_token', t);
            } catch(e) {}
        }

        const token = getOAuthToken();
        if (!token) return { ok: false, err: "Нет токена" };
        try {
            const d = await gmJSON(`${API_BASE}/account/status`, {
                "Authorization": token,
                "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion()
            });
            if (d?.result?.account?.uid) {
                return { ok: true, login: d.result.account.login, plus: !!d.result.plus?.hasPlus };
            }
        } catch (e) { console.error("[YMD] auth:", e); }
        return { ok: false, err: "Токен невалидный" };
    }

    async function getTrackDownloadUrl(trackId, qualityOption) {
        const token = getOAuthToken();
        if (!token) throw new Error("Нет OAuth токена. Включите любой трек на сайте (чтобы перехватить токен), либо введите вручную через меню Tampermonkey.");

        const ts = Math.floor(Date.now() / 1000);
        const codecs = qualityOption.codecs;
        const transports = "raw";
        const quality = qualityOption.value;

        const sign = await getSign(SECRET_KEY, `${ts}${trackId}${quality}${codecs.join("")}${transports}`);

        const headers = {
            "Authorization": token,
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };

        const url = `${API_BASE}/get-file-info?ts=${ts}&trackId=${trackId}&quality=${quality}` +
            `&codecs=${encodeURIComponent(codecs.join(","))}&transports=${transports}&sign=${encodeURIComponent(sign)}`;

        for (let i = 0; i < 10; i++) {
            const data = await gmJSON(url, headers);
            if (!data?.downloadInfo) throw new Error("Нет downloadInfo");
            if (String(data.downloadInfo.trackId) !== String(trackId)) { await sleep(150); continue; }
            return data.downloadInfo;
        }
        throw new Error("Превышено число попыток");
    }

    async function getTracksInfo(ids) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        return gmJSON(`${API_BASE}/tracks?trackIds=${ids.join(",")}&removeDuplicates=false&withProgress=true`, h);
    }

    async function getPlaylistIds(page) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;

        let d;
        if (page.owner && page.kind) {
            d = await gmJSON(`${API_BASE}/users/${page.owner}/playlists/${page.kind}?resumeStream=false&richTracks=false`, h);
        } else {
            const pid = page.playlistId || page.id;
            try {
                d = await gmJSON(`${API_BASE}/playlist/${pid}?resumeStream=false&richTracks=false`, h);
            } catch(e) {
                d = null;
            }
            if (!d?.tracks) {
                try {
                    const s = unsafeWindow.__STATE_SNAPSHOT__;
                    const arr = Array.isArray(s) ? s : [s];
                    for (const snap of arr) {
                        const pl = snap?.playlist;
                        if (pl?.owner?.login && pl?.kind) {
                            d = await gmJSON(`${API_BASE}/users/${pl.owner.login}/playlists/${pl.kind}?resumeStream=false&richTracks=false`, h);
                            if (d?.tracks) break;
                        }
                        const items = pl?.tracks || pl?.items;
                        if (Array.isArray(items) && items.length) {
                            return items.map(t => String(t.id || t.trackId || t.track?.id)).filter(Boolean);
                        }
                    }
                } catch(e2) {}
            }
        }

        if (!d?.tracks) throw new Error("Плейлист не найден или недоступен");
        return d.tracks.map(t => String(t.id || t.trackId || t.track?.id)).filter(Boolean);
    }

    async function getAlbumIds(aid) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        const d = await gmJSON(`${API_BASE}/albums/${aid}/with-tracks?resumeStream=false&richTracks=false`, h);
        if (!d?.volumes) throw new Error("Нет volumes");
        return d.volumes.flatMap(v => v.map(t => String(t.id)));
    }

    async function getArtistTrackIds(artistId) {
        const token = getOAuthToken();
        const h = {
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
            "X-Yandex-Music-Frontend": "new",
            "X-Yandex-Music-Without-Invocation-Info": "1",
        };
        if (token) h["Authorization"] = token;
        const ids = [], seen = new Set();
        let page = 0;
        while (true) {
            const r = await gmJSON(`${API_BASE}/artists/${artistId}/tracks?page=${page}&pageSize=100`, h);
            const tracks = r?.tracks || [];
            if (!tracks.length) break;
            let added = 0;
            for (const t of tracks) {
                const tid = String(t.id || t.trackId || '');
                if (tid && !seen.has(tid)) { seen.add(tid); ids.push(tid); added++; }
            }
            if (added === 0 || tracks.length < 100) break;
            page++;
            await sleep(200);
        }
        return ids;
    }

    async function getChartIds() {
        try {
            const token = getOAuthToken();
            const h = {
                "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                "X-Yandex-Music-Frontend": "new",
                "X-Yandex-Music-Without-Invocation-Info": "1",
            };
            if (token) h["Authorization"] = token;
            const chartId = window.location.href.includes('world') ? 'world' : 'russia';
            const d = await gmJSON(`${API_BASE}/landing3/chart/${chartId}?regionId=143`, h);
            const tracks = d?.chart?.tracks || d?.tracks;
            if (Array.isArray(tracks) && tracks.length > 0) {
                const ids = [], seen = new Set();
                for (const it of tracks) {
                    const tid = String(it.id || it.trackId || it.track?.id || '');
                    if (tid && !seen.has(tid)) { seen.add(tid); ids.push(tid); }
                }
                if (ids.length >= 50) {
                    console.log(`[YMD] chart API: ${ids.length} треков`);
                    return ids;
                }
            }
        } catch(e) { console.warn('[YMD] chart API error:', e); }

        status("Прокрутка чарта для загрузки всех треков...");

        const scrollStep = async () => {
            let prev = -1;
            for (let i = 0; i < 60; i++) {
                window.scrollTo(0, document.documentElement.scrollHeight);
                await sleep(350);
                const cur = window.scrollY;
                if (cur === prev) break;
                prev = cur;
            }
        };

        await scrollStep();
        await sleep(400);

        try {
            const s = unsafeWindow.__STATE_SNAPSHOT__;
            const arr = Array.isArray(s) ? s : [s];
            for (const snap of arr) {
                const candidates = [
                    snap?.chart?.tracks,
                    snap?.chart?.items,
                    snap?.chart?.initialItems,
                ];
                for (const list of candidates) {
                    if (Array.isArray(list) && list.length >= 50) {
                        const ids = [], seen = new Set();
                        for (const it of list) {
                            const tid = String(it.id || it.trackId || it.data?.id || '');
                            if (tid && !seen.has(tid)) { seen.add(tid); ids.push(tid); }
                        }
                        if (ids.length >= 50) {
                            console.log(`[YMD] chart snapshot: ${ids.length} треков`);
                            window.scrollTo(0, 0);
                            return ids;
                        }
                    }
                }
            }
        } catch(e) {}

        const links = document.querySelectorAll('.ChartTracksPage_content__yyIAN a[href*="/track/"], .ChartTracksPage_root__QMbqY a[href*="/track/"]');
        window.scrollTo(0, 0);
        if (links.length) {
            const ids = [], seen = new Set();
            for (const a of links) {
                const m = a.href.match(/\/track\/(\d+)/);
                if (m && !seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
            }
            if (ids.length) {
                console.log(`[YMD] chart DOM: ${ids.length} треков`);
                return ids;
            }
        }

        throw new Error("Треки чарта не найдены. Убедитесь, что страница чарта полностью загружена.");
    }

    function getPageType() {
        const h = window.location.hash || window.location.href;
        let m;
        if ((m = h.match(/\/users\/([^/]+)\/playlists\/(\d+)/)))
            return { type: "playlist", owner: m[1], kind: m[2] };
        if ((m = h.match(/\/playlists?\/([\w.-]+)/)))
            return { type: "playlist", playlistId: m[1] };
        if ((m = h.match(/\/album\/(\d+)/))) return { type: "album", id: m[1] };
        if ((m = h.match(/\/artist\/(\d+)/))) return { type: "artist", id: m[1] };
        if ((m = h.match(/\/track\/(\d+)/))) return { type: "track", id: m[1] };
        if (/\/chart/.test(h)) return { type: "chart" };
        return { type: "unknown" };
    }

    function parseSnapshotIds() {
        let snapshots = [];
        if (unsafeWindow.__STATE_SNAPSHOT__) {
            const s = unsafeWindow.__STATE_SNAPSHOT__;
            snapshots.push(...(Array.isArray(s) ? s : [s]));
        }
        let entries = [];
        for (const snap of snapshots) {
            for (const key of ['playlist', 'album', 'artist']) {
                const items = snap?.[key]?.items || snap?.[key]?.initialItems || snap?.[key]?.popularTracks;
                if (items && Array.isArray(items) && items.length > entries.length) entries = items;
            }
        }
        const ids = [], seen = new Set();
        for (const it of entries) {
            const tid = it.id || it.trackId || it.data?.id;
            if (tid && !seen.has(String(tid))) { seen.add(String(tid)); ids.push(String(tid)); }
        }
        return ids;
    }

    function getMime(codec) {
        if (codec === 'flac' || codec === 'flac-mp4') return 'audio/flac';
        if (codec === 'mp3') return 'audio/mpeg';
        return 'audio/mp4';
    }

    function getExt(codec) {
        if (codec === 'flac' || codec === 'flac-mp4') return 'flac';
        if (codec === 'mp3') return 'mp3';
        return 'm4a';
    }

    function writeID3v2(audioBuf, meta, coverBuf) {
        function enc(str) { return new TextEncoder().encode(str); }

        function textFrame(id, text) {
            const bom = new Uint8Array([0xFF, 0xFE]);
            const utf16 = new Uint16Array([...text].map(c => c.codePointAt(0)));
            const tb = new Uint8Array(utf16.buffer);
            const size = 1 + bom.length + tb.length;
            const f = new Uint8Array(10 + size);
            for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
            f[4] = (size >> 24) & 0xFF; f[5] = (size >> 16) & 0xFF;
            f[6] = (size >>  8) & 0xFF; f[7] =  size        & 0xFF;
            f[8] = 0x00; f[9] = 0x00;
            f[10] = 0x01;
            f.set(bom, 11);
            f.set(tb, 13);
            return f;
        }

        function apicFrame(imgBuf) {
            const img  = new Uint8Array(imgBuf);
            const mime = (img[0] === 0x89 && img[1] === 0x50) ? 'image/png' : 'image/jpeg';
            const mb   = enc(mime);
            const body = 1 + mb.length + 1 + 1 + 1 + img.length;
            const f    = new Uint8Array(10 + body);
            'APIC'.split('').forEach((c, i) => f[i] = c.charCodeAt(0));
            f[4] = (body >> 24) & 0xFF; f[5] = (body >> 16) & 0xFF;
            f[6] = (body >>  8) & 0xFF; f[7] =  body        & 0xFF;
            f[8] = 0x00; f[9] = 0x00;
            let o = 10;
            f[o++] = 0x00;
            f.set(mb, o); o += mb.length;
            f[o++] = 0x00;
            f[o++] = 0x03;
            f[o++] = 0x00;
            f.set(img, o);
            return f;
        }

        const frames = [];
        if (meta.title)  frames.push(textFrame('TIT2', meta.title));
        if (meta.artist) frames.push(textFrame('TPE1', meta.artist));
        if (meta.album)  frames.push(textFrame('TALB', meta.album));
        if (meta.genre)  frames.push(textFrame('TCON', meta.genre));
        if (coverBuf && coverBuf.byteLength > 0) frames.push(apicFrame(coverBuf));

        const framesSize = frames.reduce((s, f) => s + f.length, 0);
        const tagHdr = new Uint8Array(10);
        tagHdr[0] = 0x49; tagHdr[1] = 0x44; tagHdr[2] = 0x33;
        tagHdr[3] = 0x03; tagHdr[4] = 0x00; tagHdr[5] = 0x00;
        tagHdr[6] = (framesSize >>> 21) & 0x7F; tagHdr[7] = (framesSize >>> 14) & 0x7F;
        tagHdr[8] = (framesSize >>>  7) & 0x7F; tagHdr[9] =  framesSize          & 0x7F;

        const tag = new Uint8Array(10 + framesSize);
        tag.set(tagHdr); let o = 10;
        for (const f of frames) { tag.set(f, o); o += f.length; }

        const audio = new Uint8Array(audioBuf);
        let audioStart = 0;
        if (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
            const s = ((audio[6] & 0x7F) << 21) | ((audio[7] & 0x7F) << 14) |
                      ((audio[8] & 0x7F) <<  7) |  (audio[9] & 0x7F);
            audioStart = 10 + s;
        }

        const result = new Uint8Array(tag.length + audio.length - audioStart);
        result.set(tag);
        result.set(audio.subarray(audioStart), tag.length);
        return result.buffer;
    }

    function writeM4ATags(audioBuf, meta, coverBuf) {
        const view = new DataView(audioBuf);
        const bytes = new Uint8Array(audioBuf);
        let offset = 0;

        let moovOffset = -1, moovSize = 0;
        let mdatOffset = -1;

        while (offset < audioBuf.byteLength) {
            let size = view.getUint32(offset);
            if (size < 8) break;
            let type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);

            if (type === 'moov') { moovOffset = offset; moovSize = size; }
            if (type === 'mdat') { mdatOffset = offset; }

            offset += size;
        }

        if (moovOffset === -1) return audioBuf;

        let stcoOffsets = [];
        let co64Offsets = [];

        function traverse(start, end) {
            let p = start;
            while (p < end) {
                let size = view.getUint32(p);
                if (size < 8) break;
                let type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);

                if (['trak', 'mdia', 'minf', 'stbl'].includes(type)) {
                    traverse(p + 8, p + size);
                } else if (type === 'stco') {
                    let entryCount = view.getUint32(p + 12);
                    let tableOffset = p + 16;
                    for (let i = 0; i < entryCount; i++) stcoOffsets.push(tableOffset + i * 4);
                } else if (type === 'co64') {
                    let entryCount = view.getUint32(p + 12);
                    let tableOffset = p + 16;
                    for (let i = 0; i < entryCount; i++) co64Offsets.push(tableOffset + i * 8);
                }
                p += size;
            }
        }
        traverse(moovOffset + 8, moovOffset + moovSize);

        let oldUdtaOffset = -1;
        let oldUdtaSize = 0;
        let p = moovOffset + 8;
        while (p < moovOffset + moovSize) {
            let size = view.getUint32(p);
            if (size < 8) break;
            let type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            if (type === 'udta') {
                oldUdtaOffset = p;
                oldUdtaSize = size;
                break;
            }
            p += size;
        }

        function makeBox(type, payload) {
            let size = payload.length + 8;
            let box = new Uint8Array(size);
            let dv = new DataView(box.buffer);
            dv.setUint32(0, size);
            for (let i = 0; i < 4; i++) box[i + 4] = type.charCodeAt(i);
            box.set(payload, 8);
            return box;
        }

        function makeFullBox(type, version, flags, payload) {
            let size = payload.length + 12;
            let box = new Uint8Array(size);
            let dv = new DataView(box.buffer);
            dv.setUint32(0, size);
            for (let i = 0; i < 4; i++) box[i + 4] = type.charCodeAt(i);
            dv.setUint8(8, version);
            dv.setUint8(9, (flags >> 16) & 0xFF);
            dv.setUint8(10, (flags >> 8) & 0xFF);
            dv.setUint8(11, flags & 0xFF);
            box.set(payload, 12);
            return box;
        }

        function makeDataBox(typeCode, data) {
            let payload = new Uint8Array(data.length + 8);
            let dv = new DataView(payload.buffer);
            dv.setUint32(0, typeCode);
            dv.setUint32(4, 0);
            payload.set(data, 8);
            return makeBox('data', payload);
        }

        function makeMetaItem(type, str) {
            return makeBox(type, makeDataBox(1, new TextEncoder().encode(str)));
        }

        let ilstItems = [];
        if (meta.title) ilstItems.push(makeMetaItem('\xA9nam', meta.title));
        if (meta.artist) ilstItems.push(makeMetaItem('\xA9ART', meta.artist));
        if (meta.album) ilstItems.push(makeMetaItem('\xA9alb', meta.album));
        if (meta.genre) ilstItems.push(makeMetaItem('\xA9gen', meta.genre));
        if (coverBuf && coverBuf.byteLength > 0) {
            let cBytes = new Uint8Array(coverBuf);
            let isPng = cBytes[0] === 0x89 && cBytes[1] === 0x50;
            ilstItems.push(makeBox('covr', makeDataBox(isPng ? 14 : 13, cBytes)));
        }

        if (ilstItems.length === 0) return audioBuf;

        let ilstPayloadSize = ilstItems.reduce((acc, b) => acc + b.length, 0);
        let ilstPayload = new Uint8Array(ilstPayloadSize);
        let offsetIlst = 0;
        for (let b of ilstItems) {
            ilstPayload.set(b, offsetIlst);
            offsetIlst += b.length;
        }
        let ilstBox = makeBox('ilst', ilstPayload);

        let hdlrPayload = new Uint8Array(21);
        let hdlrView = new DataView(hdlrPayload.buffer);
        hdlrView.setUint32(0, 0);
        hdlrView.setUint32(4, 0x6d646972);
        hdlrPayload[20] = 0;
        let hdlrBox = makeFullBox('hdlr', 0, 0, hdlrPayload);

        let metaPayload = new Uint8Array(hdlrBox.length + ilstBox.length);
        metaPayload.set(hdlrBox, 0);
        metaPayload.set(ilstBox, hdlrBox.length);
        let metaBox = makeFullBox('meta', 0, 0, metaPayload);

        let udtaPayload = new Uint8Array(metaBox.length);
        udtaPayload.set(metaBox, 0);
        let newUdtaBox = makeBox('udta', udtaPayload);

        let oldUdtaSizeExt = oldUdtaOffset !== -1 ? oldUdtaSize : 0;
        let delta = newUdtaBox.length - oldUdtaSizeExt;

        let out = new Uint8Array(audioBuf.byteLength + delta);

        if (oldUdtaOffset !== -1) {
            out.set(new Uint8Array(audioBuf, 0, oldUdtaOffset), 0);
            out.set(newUdtaBox, oldUdtaOffset);
            out.set(new Uint8Array(audioBuf, oldUdtaOffset + oldUdtaSize), oldUdtaOffset + newUdtaBox.length);
        } else {
            let moovEnd = moovOffset + moovSize;
            out.set(new Uint8Array(audioBuf, 0, moovEnd), 0);
            out.set(newUdtaBox, moovEnd);
            out.set(new Uint8Array(audioBuf, moovEnd), moovEnd + newUdtaBox.length);
        }

        let outView = new DataView(out.buffer);
        outView.setUint32(moovOffset, moovSize + delta);

        if (moovOffset < mdatOffset && delta !== 0) {
            let insertionPoint = oldUdtaOffset !== -1 ? oldUdtaOffset : (moovOffset + moovSize);

            for (let off of stcoOffsets) {
                let newOff = off < insertionPoint ? off : off + delta;
                let val = outView.getUint32(newOff);
                outView.setUint32(newOff, val + delta);
            }
            for (let off of co64Offsets) {
                let newOff = off < insertionPoint ? off : off + delta;
                let valHi = outView.getUint32(newOff);
                let valLo = outView.getUint32(newOff + 4);
                let val = (BigInt(valHi) << 32n) | BigInt(valLo);
                val = val + BigInt(delta);
                outView.setUint32(newOff, Number(val >> 32n));
                outView.setUint32(newOff + 4, Number(val & 0xFFFFFFFFn));
            }
        }

        return out.buffer;
    }

    function parseFlacMetadataChain(bytes, start, end) {
        const blocks = [];
        let p = start;
        while (p + 4 <= end) {
            const header = bytes[p];
            const last   = (header & 0x80) !== 0;
            const type   = header & 0x7F;
            const len    = (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
            const bodyStart = p + 4;
            const bodyEnd   = bodyStart + len;
            if (bodyEnd > end) break;
            blocks.push({ type, body: bytes.slice(bodyStart, bodyEnd) });
            p = bodyEnd;
            if (last) { p = bodyEnd; break; }
        }
        return { blocks, audioStart: p };
    }

    function buildVorbisCommentBlock(meta) {
        const enc = new TextEncoder();
        const vendor = enc.encode('YandexMusicDownloader');
        const comments = [];
        if (meta.title)       comments.push(`TITLE=${meta.title}`);
        if (meta.artist)      comments.push(`ARTIST=${meta.artist}`);
        if (meta.album)       comments.push(`ALBUM=${meta.album}`);
        if (meta.albumArtist) comments.push(`ALBUMARTIST=${meta.albumArtist}`);
        if (meta.date)        comments.push(`DATE=${meta.date}`);
        if (meta.trackNumber) comments.push(`TRACKNUMBER=${meta.trackNumber}`);
        if (meta.genre)       comments.push(`GENRE=${meta.genre}`);

        const encoded = comments.map(c => enc.encode(c));
        let size = 4 + vendor.length + 4;
        for (const c of encoded) size += 4 + c.length;

        const out = new Uint8Array(size);
        const dv  = new DataView(out.buffer);
        let o = 0;
        dv.setUint32(o, vendor.length, true); o += 4;
        out.set(vendor, o); o += vendor.length;
        dv.setUint32(o, encoded.length, true); o += 4;
        for (const c of encoded) {
            dv.setUint32(o, c.length, true); o += 4;
            out.set(c, o); o += c.length;
        }
        return out;
    }

    function getPngDimensions(img) {
        if (img.length > 24 && img[0] === 0x89 && img[1] === 0x50 && img[2] === 0x4E && img[3] === 0x47) {
            const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
            return { width: dv.getUint32(16), height: dv.getUint32(20) };
        }
        return { width: 0, height: 0 };
    }

    function buildPictureBlock(coverBuf) {
        const img  = new Uint8Array(coverBuf);
        const isPng = img[0] === 0x89 && img[1] === 0x50;
        const mime  = isPng ? 'image/png' : 'image/jpeg';
        const { width, height } = isPng ? getPngDimensions(img) : { width: 0, height: 0 };
        const enc  = new TextEncoder();
        const mimeBytes = enc.encode(mime);
        const descBytes = new Uint8Array(0);

        const size = 4 + 4 + mimeBytes.length + 4 + descBytes.length + 4 + 4 + 4 + 4 + 4 + img.length;
        const out = new Uint8Array(size);
        const dv  = new DataView(out.buffer);
        let o = 0;
        dv.setUint32(o, 3); o += 4;
        dv.setUint32(o, mimeBytes.length); o += 4;
        out.set(mimeBytes, o); o += mimeBytes.length;
        dv.setUint32(o, descBytes.length); o += 4;
        out.set(descBytes, o); o += descBytes.length;
        dv.setUint32(o, width); o += 4;
        dv.setUint32(o, height); o += 4;
        dv.setUint32(o, 0); o += 4;
        dv.setUint32(o, 0); o += 4;
        dv.setUint32(o, img.length); o += 4;
        out.set(img, o);
        return out;
    }

    function buildFlacFile(metaBlocks, audioBytes) {
        const parts = [new Uint8Array([0x66, 0x4C, 0x61, 0x43])];
        for (let i = 0; i < metaBlocks.length; i++) {
            const b = metaBlocks[i];
            const last = i === metaBlocks.length - 1;
            const len  = b.body.length;
            const hdr  = new Uint8Array(4);
            hdr[0] = (last ? 0x80 : 0) | (b.type & 0x7F);
            hdr[1] = (len >> 16) & 0xFF; hdr[2] = (len >> 8) & 0xFF; hdr[3] = len & 0xFF;
            parts.push(hdr, b.body);
        }
        parts.push(audioBytes);

        let total = 0;
        for (const p of parts) total += p.length;
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { out.set(p, o); o += p.length; }
        return out.buffer;
    }

    function demuxFlacFromMp4(audioBuf) {
        try {
            const view  = new DataView(audioBuf);
            const bytes = new Uint8Array(audioBuf);

            function parseBoxes(start, end) {
                const boxes = [];
                let p = start;
                while (p + 8 <= end) {
                    let size = view.getUint32(p);
                    const type = String.fromCharCode(bytes[p+4], bytes[p+5], bytes[p+6], bytes[p+7]);
                    let headerSize = 8;
                    if (size === 1) {
                        if (p + 16 > end) break;
                        const hi = view.getUint32(p + 8), lo = view.getUint32(p + 12);
                        size = hi * 4294967296 + lo;
                        headerSize = 16;
                    } else if (size === 0) {
                        size = end - p;
                    }
                    if (size < headerSize || p + size > end) break;
                    boxes.push({ type, start: p, end: p + size, bodyStart: p + headerSize, bodyEnd: p + size });
                    p += size;
                }
                return boxes;
            }

            const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'edts', 'mvex', 'udta']);
            function collect(start, end, out) {
                for (const b of parseBoxes(start, end)) {
                    out.push(b);
                    if (CONTAINERS.has(b.type)) collect(b.bodyStart, b.bodyEnd, out);
                }
            }

            const top  = parseBoxes(0, audioBuf.byteLength);
            const moov = top.find(b => b.type === 'moov');
            if (!moov) return null;

            const flat = [];
            collect(moov.bodyStart, moov.bodyEnd, flat);

            const stsz = flat.find(b => b.type === 'stsz' || b.type === 'stz2');
            const stco = flat.find(b => b.type === 'stco');
            const co64 = flat.find(b => b.type === 'co64');
            const stsc = flat.find(b => b.type === 'stsc');
            if (!stsz || !stsc || (!stco && !co64)) return null;

            let dfLaBox = null;
            for (let p = moov.bodyStart; p < moov.bodyEnd - 4; p++) {
                if (bytes[p] === 0x64 && bytes[p+1] === 0x66 && bytes[p+2] === 0x4C && bytes[p+3] === 0x61) {
                    const boxStart = p - 4;
                    if (boxStart < moov.bodyStart) continue;
                    const size = view.getUint32(boxStart);
                    if (size >= 50 && boxStart + size <= moov.bodyEnd) {
                        dfLaBox = { bodyStart: boxStart + 8, bodyEnd: boxStart + size };
                        break;
                    }
                }
            }
            if (!dfLaBox) return null;

            const { blocks } = parseFlacMetadataChain(bytes, dfLaBox.bodyStart + 4, dfLaBox.bodyEnd);
            const streamInfo = blocks.find(b => b.type === 0);
            if (!streamInfo) return null;

            function readStsz(box) {
                const base = box.bodyStart;
                if (box.type === 'stsz') {
                    const sampleSize = view.getUint32(base + 4);
                    const count = view.getUint32(base + 8);
                    const sizes = new Array(count);
                    if (sampleSize !== 0) sizes.fill(sampleSize);
                    else for (let i = 0; i < count; i++) sizes[i] = view.getUint32(base + 12 + i * 4);
                    return sizes;
                }
                const fieldSize = bytes[base + 7];
                const count = view.getUint32(base + 8);
                const sizes = new Array(count);
                let p = base + 12;
                if (fieldSize === 16) { for (let i = 0; i < count; i++) { sizes[i] = view.getUint16(p); p += 2; } }
                else if (fieldSize === 8) { for (let i = 0; i < count; i++) sizes[i] = bytes[p + i]; }
                else return null;
                return sizes;
            }
            const sampleSizes = readStsz(stsz);
            if (!sampleSizes) return null;

            let chunkOffsets;
            if (co64) {
                const base = co64.bodyStart;
                const count = view.getUint32(base + 4);
                chunkOffsets = new Array(count);
                for (let i = 0; i < count; i++) {
                    const hi = view.getUint32(base + 8 + i * 8), lo = view.getUint32(base + 12 + i * 8);
                    chunkOffsets[i] = hi * 4294967296 + lo;
                }
            } else {
                const base = stco.bodyStart;
                const count = view.getUint32(base + 4);
                chunkOffsets = new Array(count);
                for (let i = 0; i < count; i++) chunkOffsets[i] = view.getUint32(base + 8 + i * 4);
            }

            const stscBase = stsc.bodyStart;
            const stscCount = view.getUint32(stscBase + 4);
            const stscEntries = [];
            for (let i = 0; i < stscCount; i++) {
                const off = stscBase + 8 + i * 12;
                stscEntries.push({ firstChunk: view.getUint32(off), samplesPerChunk: view.getUint32(off + 4) });
            }
            const samplesPerChunkArr = new Array(chunkOffsets.length);
            for (let c = 0; c < chunkOffsets.length; c++) {
                const chunkNum = c + 1;
                let spc = stscEntries[0] ? stscEntries[0].samplesPerChunk : 0;
                for (const e of stscEntries) { if (e.firstChunk <= chunkNum) spc = e.samplesPerChunk; else break; }
                samplesPerChunkArr[c] = spc;
            }

            let totalSize = 0;
            for (const s of sampleSizes) totalSize += s;
            const audioFrames = new Uint8Array(totalSize);
            let sampleIdx = 0, outPos = 0;
            for (let c = 0; c < chunkOffsets.length && sampleIdx < sampleSizes.length; c++) {
                let pos = chunkOffsets[c];
                const n = samplesPerChunkArr[c] || 0;
                for (let s = 0; s < n && sampleIdx < sampleSizes.length; s++) {
                    const sz = sampleSizes[sampleIdx];
                    audioFrames.set(bytes.subarray(pos, pos + sz), outPos);
                    pos += sz; outPos += sz; sampleIdx++;
                }
            }

            return { streamInfo: streamInfo.body, audioFrames };
        } catch (e) {
            console.warn('[YMD] demuxFlacFromMp4 error:', e);
            return null;
        }
    }

    function tagFlacFromMp4(audioBuf, meta, coverBuf) {
        const demuxed = demuxFlacFromMp4(audioBuf);
        if (!demuxed) return null;
        const metaBlocks = [{ type: 0, body: demuxed.streamInfo }];
        if (meta) metaBlocks.push({ type: 4, body: buildVorbisCommentBlock(meta) });
        if (coverBuf && coverBuf.byteLength > 0) metaBlocks.push({ type: 6, body: buildPictureBlock(coverBuf) });
        return buildFlacFile(metaBlocks, demuxed.audioFrames);
    }

    function tagNativeFlac(audioBuf, meta, coverBuf) {
        const bytes = new Uint8Array(audioBuf);
        if (!(bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43)) {
            return audioBuf;
        }
        const { blocks, audioStart } = parseFlacMetadataChain(bytes, 4, bytes.length);
        const kept = blocks.filter(b => b.type !== 4 && b.type !== 6 && b.type !== 1);
        if (meta) kept.push({ type: 4, body: buildVorbisCommentBlock(meta) });
        if (coverBuf && coverBuf.byteLength > 0) kept.push({ type: 6, body: buildPictureBlock(coverBuf) });
        const audioBytes = bytes.subarray(audioStart);
        return buildFlacFile(kept, audioBytes);
    }

    function downloadBlob(buf, filename, mime) {
        const blob = new Blob([buf], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }

    function gmRangeRequest(url, start, end, timeout = 60000) {
        return new Promise((resolve, reject) => {
            const headers = { "Referer": "https://music.yandex.ru/" };
            if (start != null) headers["Range"] = end != null ? `bytes=${start}-${end}` : `bytes=${start}-`;
            GM_xmlhttpRequest({
                method: "GET", url,
                responseType: "arraybuffer",
                headers,
                timeout,
                onload:    (r) => (r.status === 200 || r.status === 206) ? resolve(r) : reject(new Error(`CDN HTTP ${r.status}`)),
                ontimeout: () => reject(new Error("Превышено время ожидания CDN")),
                onerror:   () => reject(new Error("Ошибка загрузки с CDN")),
            });
        });
    }

    const YMD_CHUNK_SIZE = 2 * 1024 * 1024;

    async function downloadWithRangeChunks(url, onProgress) {
        await waitIfPaused();
        if (downloadCancelled) throw new Error("Отменено");

        const first = await gmRangeRequest(url, 0, YMD_CHUNK_SIZE - 1);
        const headers = first.responseHeaders || '';
        const crMatch = /content-range:\s*bytes\s+\d+-\d+\/(\d+)/i.exec(headers);
        const supportsRange = first.status === 206 && crMatch;

        if (!supportsRange) {
            const full = await gmRangeRequest(url, null, null);
            if (onProgress) onProgress(100, full.response.byteLength, full.response.byteLength);
            return full.response;
        }

        const total = parseInt(crMatch[1], 10);
        const chunks = [new Uint8Array(first.response)];
        let received = chunks[0].byteLength;
        if (onProgress) onProgress(received / total * 100, received, total);

        while (received < total) {
            if (downloadCancelled) throw new Error("Отменено");
            await waitIfPaused();
            if (downloadCancelled) throw new Error("Отменено");

            const start = received;
            const end = Math.min(received + YMD_CHUNK_SIZE - 1, total - 1);
            const res = await gmRangeRequest(url, start, end);
            const chunk = new Uint8Array(res.response);
            chunks.push(chunk);
            received += chunk.byteLength;
            if (onProgress) onProgress(received / total * 100, received, total);
        }

        const result = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
        return result.buffer;
    }

    async function downloadWithFetchStream(url, onProgress) {
        let received = 0;
        let total = 0;
        let chunks = [];
        let rangeSupported = null;

        for (;;) {
            await waitIfPaused();
            if (downloadCancelled) throw new Error("Отменено");

            const controller = new AbortController();
            const headers = (received > 0 && rangeSupported) ? { Range: `bytes=${received}-` } : {};
            const resp = await _nativeFetch(url, { headers, signal: controller.signal });

            if (received > 0 && rangeSupported && resp.status !== 206) {
                received = 0; chunks = [];
            }
            if (!resp.ok && resp.status !== 206) throw new Error(`CDN HTTP ${resp.status}`);
            if (!resp.body || !resp.body.getReader) throw new Error("ReadableStream недоступен");

            if (rangeSupported === null) {
                rangeSupported = resp.status === 206 || resp.headers.get('Accept-Ranges') === 'bytes';
            }
            if (!total) {
                const cr = resp.headers.get('Content-Range');
                const cl = resp.headers.get('Content-Length');
                if (cr) { const m = /\/(\d+)$/.exec(cr); if (m) total = parseInt(m[1], 10); }
                else if (cl) total = received + parseInt(cl, 10);
            }

            const reader = resp.body.getReader();
            let pausedMidStream = false;

            try {
                while (true) {
                    if (downloadPaused) { pausedMidStream = true; controller.abort(); break; }
                    if (downloadCancelled) { controller.abort(); throw new Error("Отменено"); }

                    const { done, value } = await reader.read();
                    if (done) {
                        const size = total || received;
                        const result = new Uint8Array(size);
                        let offset = 0;
                        for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
                        return result.buffer;
                    }
                    chunks.push(value);
                    received += value.byteLength;
                    if (onProgress) onProgress(total ? received / total * 100 : 0, received, total);
                }
            } catch (e) {
                if (!pausedMidStream) throw e;
            }

            if (!rangeSupported) { received = 0; chunks = []; }
        }
    }

    async function downloadWithPause(url, onProgress) {
        try {
            return await downloadWithFetchStream(url, onProgress);
        } catch (e) {
            console.warn('[YMD] fetch-поток недоступен (' + e.message + '), использую Range-чанки как запасной вариант');
            return await downloadWithRangeChunks(url, onProgress);
        }
    }

    async function downloadFile(url, filename, onProgress) {
        const buf = await downloadWithPause(url, onProgress);
        if (!buf || buf.byteLength === 0) throw new Error("Пустой ответ от CDN");

        const view = new Uint8Array(buf.slice(0, 12));
        let mime = 'audio/mp4';

        if (view[0]===0x66&&view[1]===0x4C&&view[2]===0x61&&view[3]===0x43) {
            mime = 'audio/flac';
        } else if (view[0]===0x49&&view[1]===0x44&&view[2]===0x33) {
            mime = 'audio/mpeg';
        } else if (view[0]===0xFF&&(view[1]&0xE0)===0xE0) {
            mime = 'audio/mpeg';
        } else if (view[0]===0x4F&&view[1]===0x67&&view[2]===0x67&&view[3]===0x53) {
            mime = 'audio/ogg';
        }

        downloadBlob(buf, filename, mime);
    }

    function gmFetchBinary(url, headers = {}, timeout = 30000) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url, headers,
                responseType: "arraybuffer",
                timeout,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}`));
                },
                ontimeout: () => reject(new Error("Превышено время ожидания")),
                onerror: () => reject(new Error("Сетевая ошибка"))
            });
        });
    }

    async function downloadCoverFile(url, filename) {
        try {
            const res = await gmFetchBinary(url);
            const buf = res.response;
            if (!buf || buf.byteLength === 0) return;
            const { mime, ext } = guessCoverMime(buf);
            downloadBlob(buf, filename + '.' + ext, mime);
        } catch(e) {
            console.error('[YMD] Cover error', e, url);
        }
    }

    function getCoverUrl(track) {
        const uri = track.coverUri || track.albums?.[0]?.coverUri;
        if (!uri) return null;
        const normalized = uri.replace('%%', '1000x1000');
        if (/^https?:\/\//i.test(normalized)) return normalized;
        return 'https://' + normalized;
    }

    let downloading = false;
    let downloadCancelled = false;
    let downloadPaused = false;

    async function startDownload(btn, singleTrackId) {
        if (downloading) return;
        downloading = true;
        downloadCancelled = false;
        downloadPaused = false;
        const origHTML = btn.innerHTML;

        try {
            const choice = await showQualityPicker();
            if (!choice) { downloading = false; return; }
            let { quality: qualityOption, downloadCovers } = choice;

            _folderHandle = null;
            if (!singleTrackId && 'showDirectoryPicker' in window) {
                const showFolderPicker = () => new Promise(resolve => {
                    panel.style.display = 'block';
                    panel.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                            <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                            <span id="ymd-close" title="Закрыть" style="cursor:pointer;font-size:18px;line-height:1;color:#aaa;padding:0 4px;margin-left:10px;user-select:none;"
                                onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                            <span id="ymd-back" title="Назад" style="cursor:pointer;font-size:13px;color:#aaa;user-select:none;display:flex;align-items:center;gap:3px;"
                                onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">&#8592; Назад</span>
                            <span style="font-size:13px;color:#ccc;">Куда сохранять файлы?</span>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                            <button id="ymd-pick-folder" style="
                                background:rgba(255,255,0,0.15);
                                border:1px solid #ffff00;
                                border-radius:16px;color:#fff;padding:8px 12px;cursor:pointer;
                                font-size:13px;text-align:left;
                            " onmouseover="this.style.background='rgba(255,255,0,0.25)'"
                              onmouseout="this.style.background='rgba(255,255,0,0.15)'">
                                📂 Выбрать папку <span style="color:#aaa;font-size:12px;">— все файлы сохранятся без диалогов</span>
                            </button>
                            <button id="ymd-pick-one" style="
                                background:rgba(255,255,255,0.07);
                                border:1px solid rgba(255,255,255,0.15);
                                border-radius:16px;color:#fff;padding:8px 12px;cursor:pointer;
                                font-size:13px;text-align:left;
                            " onmouseover="this.style.background='rgba(255,255,255,0.14)'"
                              onmouseout="this.style.background='rgba(255,255,255,0.07)'">
                                💾 По одному <span style="color:#aaa;font-size:12px;">— браузер спросит для каждого файла</span>
                            </button>
                        </div>
                    `;
                    panel.querySelector('#ymd-close').addEventListener('click', () => { panel.style.display = 'none'; resolve('cancel'); });
                    panel.querySelector('#ymd-back').addEventListener('click',  () => resolve('back'));
                    panel.querySelector('#ymd-pick-folder').addEventListener('click', () => resolve('folder'));
                    panel.querySelector('#ymd-pick-one').addEventListener('click',    () => resolve('one'));
                });

                folderLoop: while (true) {
                    const folderChoice = await showFolderPicker();
                    if (folderChoice === 'cancel') throw new Error("Отмена");
                    if (folderChoice === 'back') {
                        const newChoice = await showQualityPicker();
                        if (!newChoice) throw new Error("Отмена");
                        qualityOption = newChoice.quality;
                        downloadCovers = newChoice.downloadCovers;
                        continue folderLoop;
                    }
                    if (folderChoice === 'one') break folderLoop;
                    const h = await pickFolder();
                    if (!h) continue folderLoop;
                    break folderLoop;
                }
            }

            status("Проверка авторизации...");
            const auth = await checkAuth();

            if (!auth.ok) {
                let dbg = [];
                try { dbg.push('fetch: ' + (typeof unsafeWindow.fetch)); } catch(e) {}
                try { dbg.push('XHR перехват: ок'); } catch(e) {}
                try {
                    const lsKeys = [];
                    for (let i = 0; i < localStorage.length; i++) lsKeys.push(localStorage.key(i));
                    dbg.push('localStorage ключи: ' + lsKeys.slice(0, 8).join(', '));
                } catch(e) { dbg.push('localStorage: нет доступа'); }
                try {
                    const globals = ['Ya','__YA__','__store__','__redux_store__','__initialData__','__STATE__','externalAPI']
                        .filter(k => !!unsafeWindow[k]);
                    dbg.push('globals: ' + (globals.join(', ') || 'не найдены'));
                } catch(e) {}
                console.warn('[YMD] Диагностика:', dbg);

                panel.style.display = 'block';
                panel.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="color:#ff5555">Загрузчик Музыки</strong>
                        <span id="ymd-close" title="Закрыть" style="cursor:pointer;font-size:18px;color:#aaa;padding:0 4px;user-select:none;"
                            onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#aaa'">✕</span>
                    </div>
                    <div style="font-size:13px;line-height:1.5;">
                        ⚠️ Токен не найден.<br>
                        <b style="color:#ffff00">Что делать:</b><br>
                        1. Включите любой трек — токен подхватится автоматически<br>
                        2. Или введите вручную через меню Tampermonkey → ⚙️ Настроить токен<br>
                        <span style="color:#666;font-size:11px;">${dbg.join(' | ')}</span>
                    </div>
                    <div style="margin-top:10px;">
                        <button onclick="document.getElementById('ymd-panel').style.display='none'"
                            style="background:#333;color:#fff;border:none;border-radius:5px;padding:4px 12px;cursor:pointer;font-size:13px;">
                            Закрыть
                        </button>
                    </div>
                `;
                panel.querySelector('#ymd-close')?.addEventListener('click', () => panel.style.display = 'none');
                throw new Error("Отмена");
            } else {
                status(`✓ ${auth.login}${auth.plus ? " (Плюс)" : ""}`);
                await sleep(600);
            }

            let ids = [];

            if (singleTrackId) {
                ids = [String(singleTrackId)];
            } else {
                status("Поиск треков...");
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} Поиск...</span>`;

                const page = getPageType();

                if (page.type === "playlist") {
                    status("Загрузка плейлиста...");
                    ids = await getPlaylistIds(page);
                } else if (page.type === "album" && page.id) {
                    status("Загрузка альбома...");
                    ids = await getAlbumIds(page.id);
                } else if (page.type === "artist" && page.id) {
                    status("Загрузка треков артиста...");
                    ids = await getArtistTrackIds(page.id);
                } else if (page.type === "chart") {
                    status("Загрузка чарта...");
                    ids = await getChartIds();
                } else if (page.type === "track" && page.id) {
                    ids = [page.id];
                } else {
                    ids = parseSnapshotIds();
                }
            }

            if (!ids.length) throw new Error("Треки не найдены.");

            const meta = [];
            for (let i = 0; i < ids.length; i += 50) {
                status(`Информация: ${Math.round(i / ids.length * 100)}%`);
                meta.push(...await getTracksInfo(ids.slice(i, i + 50)));
                await sleep(300);
            }

            let ok = 0, skip = 0, fail = 0;

            for (let i = 0; i < meta.length; i++) {
                const t = meta[i];
                if (!t || t.available === false || t.error) { skip++; continue; }

                const name = sanitize(`${(t.artists || []).map(a => a.name).join(", ") || "Unknown"} - ${t.title || "Unknown"}`);

                if (downloadCancelled) break;
                await waitIfPaused();
                statusWithProgress(name, i + 1, meta.length);
                if (!singleTrackId && btn && document.body.contains(btn)) {
                    btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} ${i + 1}/${meta.length}</span>`;
                }

                try {
                    const info = await getTrackDownloadUrl(t.id, qualityOption);

                    const url = info.url || info.urls?.[0];
                    if (!url) throw new Error("Нет ссылки");

                    if (info.quality === "preview") {
                        status(`⚠️ Превью: ${name}<br><small>Нужен Плюс или трек недоступен</small>`, true);
                        skip++;
                        await sleep(1500);
                        continue;
                    }

                    statusWithProgress(name, i + 1, meta.length, info);
                    const ext = getExt(info.codec);

                    const isMP3       = info.codec === 'mp3';
                    const isFlacMp4   = info.codec === 'flac-mp4';
                    const isFlacNative = info.codec === 'flac';
                    const isM4A       = !isFlacMp4 && (ext === 'm4a' || info.codec.includes('mp4') || info.codec.includes('aac'));

                    const trackMeta = {
                        trackNumber: t.albums?.[0]?.trackPosition?.index ?? undefined,
                        title:       t.title || name,
                        artist:      (t.artists || []).map(a => a.name).join(', ') || 'Unknown',
                        album:       t.albums?.[0]?.title || t.title || name,
                        genre:       t.albums?.[0]?.genre || undefined,
                        date:        t.albums?.[0]?.year ? String(t.albums[0].year) : undefined,
                    };

                    if (isFlacMp4) {
                        const audioBuf = await downloadWithPause(url, (pct, loaded, total) => setProgress(pct, loaded, total));
                        if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

                        let coverBuf = null;
                        if (downloadCovers) {
                            try {
                                const coverUrl = getCoverUrl(t);
                                if (coverUrl) {
                                    const r = await gmFetchBinary(coverUrl);
                                    if (r.status === 200) coverBuf = r.response;
                                }
                            } catch(_) {}
                        }

                        const flacBuf = tagFlacFromMp4(audioBuf, downloadCovers ? trackMeta : null, coverBuf);

                        if (flacBuf) {
                            await saveFile(flacBuf, `${name}.flac`, 'audio/flac');
                        } else {
                            console.warn('[YMD] Не удалось демультиплексировать FLAC из MP4-контейнера, сохраняю как .m4a');
                            if (downloadCovers) {
                                const taggedBuf = writeM4ATags(audioBuf, trackMeta, coverBuf);
                                await saveFile(taggedBuf, `${name}.m4a`, 'audio/mp4');
                            } else {
                                await saveFile(audioBuf, `${name}.m4a`, 'audio/mp4');
                            }
                        }
                    } else if (isFlacNative && downloadCovers) {
                        const audioBuf = await downloadWithPause(url, (pct, loaded, total) => setProgress(pct, loaded, total));
                        if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

                        let coverBuf = null;
                        try {
                            const coverUrl = getCoverUrl(t);
                            if (coverUrl) {
                                const r = await gmFetchBinary(coverUrl);
                                if (r.status === 200) coverBuf = r.response;
                            }
                        } catch(_) {}

                        const taggedBuf = tagNativeFlac(audioBuf, trackMeta, coverBuf);
                        await saveFile(taggedBuf, `${name}.flac`, 'audio/flac');
                    } else if ((isMP3 || isM4A) && downloadCovers) {
                        const audioBuf = await downloadWithPause(url, (pct, loaded, total) => setProgress(pct, loaded, total));
                        if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

                        let coverBuf = null;
                        try {
                            const coverUrl = getCoverUrl(t);
                            if (coverUrl) {
                                const r = await gmFetchBinary(coverUrl);
                                if (r.status === 200) coverBuf = r.response;
                            }
                        } catch(_) {}

                        let taggedBuf;
                        let mimeType;

                        if (isMP3) {
                            taggedBuf = writeID3v2(audioBuf, trackMeta, coverBuf);
                            mimeType = 'audio/mpeg';
                        } else {
                            taggedBuf = writeM4ATags(audioBuf, trackMeta, coverBuf);
                            mimeType = 'audio/mp4';
                        }

                        await saveFile(taggedBuf, `${name}.${ext}`, mimeType);
                    } else {
                        if (_folderHandle) {
                            const buf = await downloadWithPause(url, (pct, loaded, total) => setProgress(pct, loaded, total));
                            if (!buf || buf.byteLength === 0) throw new Error("Пустой ответ от CDN");
                            await saveFile(buf, `${name}.${ext}`, getMime(info.codec));

                            if (downloadCovers) {
                                const coverUrl = getCoverUrl(t);
                                if (coverUrl) {
                                    try {
                                        const r = await gmFetchBinary(coverUrl);
                                        if (r.status === 200 && r.response) {
                                            const { mime: cMime, ext: cExt } = guessCoverMime(new Uint8Array(r.response));
                                            await saveFile(r.response, `${name}.${cExt}`, cMime);
                                        }
                                    } catch(_) {}
                                }
                            }
                        } else {
                            await downloadFile(url, `${name}.${ext}`, (pct, loaded, total) => setProgress(pct, loaded, total));

                            if (downloadCovers) {
                                const coverUrl = getCoverUrl(t);
                                if (coverUrl) {
                                    await downloadCoverFile(coverUrl, name);
                                    await sleep(200);
                                }
                            }
                        }
                    }

                    ok++;
                } catch (e) {
                    console.error(`[YMD] ✗ ${name}:`, e);
                    status(`Ошибка: ${name}<br>${e.message}`, true);
                    fail++;
                    await sleep(1500);
                }

                if (downloadCancelled) break;
                await waitIfPaused();
                await sleep(600);
            }

            let s = "";
            if (downloadCancelled) s += `<b style="color:#ff9800">Отменено</b><br>`;
            if (ok) s += `<b style="color:#00e676">Скачано: ${ok}</b><br>`;
            if (skip) s += `<b style="color:#ff9800">Пропущено: ${skip}</b><br>`;
            if (fail) s += `<b style="color:#ff5555">Ошибок: ${fail}</b>`;
            status(s || "Готово!");
            if (!singleTrackId && btn && document.body.contains(btn)) {
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} Готово</span>`;
            }
            hideStatus(6000);
            setTimeout(() => { if (btn && document.body.contains(btn)) btn.innerHTML = origHTML; }, 5000);

        } catch (e) {
            console.error("[YMD] Fatal:", e);
            status(e.message, true);
            if (btn && document.body.contains(btn)) btn.innerHTML = origHTML;
            hideStatus(8000);
        } finally {
            downloading = false;
            downloadPaused = false;
        }
    }

    function inject() {
        function makeDownloadBtn(playBtn, onclick) {
            const btn = document.createElement('button');
            btn.className = playBtn.className;
            btn.classList.add('ymd-dl-all-btn');
            btn.setAttribute('type', 'button');
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF ymd-btn-label">${iconSvg} Скачать всё</span>` +
                            `<span class="ymd-btn-icon" aria-hidden="true">${iconSvg}</span>`;
            btn.onclick = onclick;
            return btn;
        }

        const playlistControls = document.querySelector('.PageHeaderPlaylist_mainControls__k_S_i');
        if (playlistControls && !playlistControls.classList.contains('ymd-done')) {
            playlistControls.classList.add('ymd-done');
            const playBtn = playlistControls.querySelector('.CommonPageHeader_playControl__gYOuR');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                playBtn.insertAdjacentElement('afterend', btn);
            }
        }

        const artistControls = document.querySelector('.PageHeaderArtist_controls__U_6g7:not(.ymd-done)');
        if (artistControls) {
            artistControls.classList.add('ymd-done');
            const playBtn = artistControls.querySelector('.PageHeaderArtist_playControl__N_3l_');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                btn.classList.remove('PageHeaderArtist_playControl__N_3l_');
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'display:flex;gap:var(--ym-spacer-size-m);align-items:center;grid-area:play;flex-wrap:wrap;';
                playBtn.parentNode.insertBefore(wrapper, playBtn);
                wrapper.appendChild(playBtn);
                wrapper.appendChild(btn);
            }
        }

        const chartStaticHeader = document.querySelector('.TextHeader_staticItem__OMNew');
        if (chartStaticHeader && document.querySelector('.ChartTracksPage_root__QMbqY')) {
            if (_chartBtn && !document.body.contains(_chartBtn)) {
                _chartBtn = null;
            }
            if (!_chartBtn || !chartStaticHeader.contains(_chartBtn)) {
                chartStaticHeader.querySelectorAll('.ymd-dl-all-btn').forEach(b => b.remove());

                const btn = document.createElement('button');
                btn.className = 'cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr j1jXIVckFgZECecFzZMe qU2apWBO1yyEK0lZ3lPO ymd-dl-all-btn';
                btn.setAttribute('type', 'button');
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF ymd-btn-label">${iconSvg} Скачать всё</span>` +
                                `<span class="ymd-btn-icon" aria-hidden="true">${iconSvg}</span>`;
                btn.style.cssText = 'margin-top:12px;display:inline-flex;align-items:center;';
                btn.onclick = () => startDownload(btn);
                chartStaticHeader.appendChild(btn);
                _chartBtn = btn;
            }
        }

        const albumControls = document.querySelector('.CommonPageHeader_controls__c27E_:not(.ymd-done)');
        if (albumControls && window.location.pathname.match(/\/album\/\d+/)) {
            albumControls.classList.add('ymd-done');
            const playBtn = albumControls.querySelector('.CommonPageHeader_playControl__gYOuR');
            if (playBtn) {
                const btn = makeDownloadBtn(playBtn, () => startDownload(btn));
                playBtn.insertAdjacentElement('afterend', btn);
            }
        }

        const bar = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_meta__FhKTC:not(.ymd-done)');
        if (bar) {
            bar.classList.add('ymd-done');
            const tb = bar.querySelector('button');
            if (!tb) return;

            const btn = tb.cloneNode(true);
            btn.removeAttribute('disabled');
            btn.title = 'Скачать текущий трек';
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

            btn.addEventListener('mouseover', () => { btn.style.color = '#e6e6e6'; });
            btn.addEventListener('mouseout', () => { btn.style.color = ''; });

            btn.onclick = () => {
                const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                const link = info?.querySelector('a[href*="/track/"]');
                if (link) {
                    const m = link.href.match(/track\/(\d+)/);
                    if (m) { startDownload(btn, m[1]); return; }
                }
                try {
                    const s = unsafeWindow.__STATE_SNAPSHOT__;
                    const arr = Array.isArray(s) ? s : [s];
                    for (const snap of arr) {
                        const id = snap?.sonataState?.entityMeta?.id;
                        if (id) { startDownload(btn, String(id)); return; }
                    }
                } catch(e) {}
                alert("Сначала включите трек");
            };

            bar.insertBefore(btn, bar.firstChild);
        }

        const vibeProgress = document.querySelector('.VibePlayerBar_progress__Cri6E');
        if (vibeProgress && !vibeProgress.querySelector('button[aria-label="Скачать текущий трек"]')) {

            const likeBtn = Array.from(vibeProgress.children).find(
                el => el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'Нравится'
            );
            if (likeBtn) {
                const vibeBtn = likeBtn.cloneNode(false);
                vibeBtn.removeAttribute('disabled');
                vibeBtn.removeAttribute('aria-pressed');
                vibeBtn.removeAttribute('aria-label');
                vibeBtn.setAttribute('aria-label', 'Скачать текущий трек');
                vibeBtn.title = 'Скачать трек';
                vibeBtn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

                vibeBtn.addEventListener('click', async () => {
                    const nameEl = document.querySelector('.VibePlayerbarMeta_trackNameText__9IgY2');
                    const artistEl = document.querySelector('.VibePlayerbarMeta_artistText__QHRmU, [class*="VibePlayerbarMeta_artistText"]');
                    const trackName = nameEl ? (nameEl.textContent || '').trim() : '';
                    const artistName = artistEl ? (artistEl.textContent || '').trim() : '';
                    if (!trackName) { alert('Сначала включите трек в Моей волне'); return; }

                    status(`Поиск трека: ${trackName}...`);
                    try {
                        const token = getOAuthToken();
                        const headers = {
                            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                            "X-Yandex-Music-Frontend": "new",
                            "X-Yandex-Music-Without-Invocation-Info": "1",
                        };
                        if (token) headers["Authorization"] = token;

                        const query = artistName ? `${artistName} ${trackName}` : trackName;
                        const searchUrl = `${API_BASE}/search?text=${encodeURIComponent(query)}&type=track&page=0&pageSize=5`;
                        const data = await gmJSON(searchUrl, headers);
                        const tracks = data?.tracks?.results;
                        if (!tracks || !tracks.length) {
                            status(`Трек не найден в поиске: ${trackName}`, true);
                            hideStatus(6000);
                            return;
                        }
                        const best = tracks.find(tr =>
                            tr.title?.toLowerCase() === trackName.toLowerCase() &&
                            (!artistName || (tr.artists || []).some(a => a.name?.toLowerCase().includes(artistName.toLowerCase())))
                        ) || tracks[0];
                        const trackId = String(best.id);
                        startDownload(vibeBtn, trackId);
                    } catch(e) {
                        status(`Ошибка поиска: ${e.message}`, true);
                        hideStatus(6000);
                    }
                });

                likeBtn.parentNode.insertBefore(vibeBtn, likeBtn);
            }
        }

        const contextMenus = document.querySelectorAll('div[role="menu"]:not(.ymd-done-menu)');
        contextMenus.forEach(menu => {
            menu.classList.add('ymd-done-menu');

            const innerContainer = menu.querySelector('div') || menu;

            const sampleBtn = innerContainer.querySelector('button[role="menuitem"], button[role="menuitemcheckbox"]');
            if (!sampleBtn) return;

            const hasVibeByTrack = Array.from(innerContainer.querySelectorAll('button[role="menuitem"], button[role="menuitemcheckbox"]'))
                .some(b => (b.textContent || '').includes('волна по треку'));
            if (!hasVibeByTrack) return;

            const btn = document.createElement('button');
            btn.className = sampleBtn.className;
            btn.setAttribute('type', 'button');
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('tabindex', '-1');

            btn.innerHTML = `
                <span class="JjlbHZ4FaP9EAcR_1DxF">
                    <svg class="J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW vqAVPWFJlhAOleK_SLk4 l3tE1hAMmBj2aoPPwU08" focusable="false" aria-hidden="true">
                        <use xlink:href="/icons/sprite.svg#download_xxs"></use>
                    </svg>Скачать трек
                </span>
            `;

            btn.onclick = async (e) => {
                e.stopPropagation();
                let trackId = null;

                const sourceId = menu.getAttribute('aria-labelledby');
                const sourceBtn = sourceId ? document.getElementById(sourceId) : null;
                const isVibeMenu = sourceBtn
                    ? sourceBtn.closest('.VibePlayerBar_progress__Cri6E') !== null
                    : !!document.querySelector('.VibePlayerBar_progress__Cri6E');

                if (isVibeMenu) {
                    document.body.click();
                    const nameEl = document.querySelector('.VibePlayerbarMeta_trackNameText__9IgY2');
                    const artistEl = document.querySelector('.VibePlayerbarMeta_artistText__QHRmU, [class*="VibePlayerbarMeta_artistText"]');
                    const trackName = nameEl ? (nameEl.textContent || '').trim() : '';
                    const artistName = artistEl ? (artistEl.textContent || '').trim() : '';
                    if (!trackName) { alert('Сначала включите трек в Моей волне'); return; }
                    status(`Поиск трека: ${trackName}...`);
                    try {
                        const token = getOAuthToken();
                        const headers = {
                            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                            "X-Yandex-Music-Frontend": "new",
                            "X-Yandex-Music-Without-Invocation-Info": "1",
                        };
                        if (token) headers["Authorization"] = token;
                        const query = artistName ? `${artistName} ${trackName}` : trackName;
                        const searchUrl = `${API_BASE}/search?text=${encodeURIComponent(query)}&type=track&page=0&pageSize=5`;
                        const data = await gmJSON(searchUrl, headers);
                        const tracks = data?.tracks?.results;
                        if (!tracks || !tracks.length) {
                            status(`Трек не найден в поиске: ${trackName}`, true);
                            hideStatus(6000);
                            return;
                        }
                        const best = tracks.find(tr =>
                            tr.title?.toLowerCase() === trackName.toLowerCase() &&
                            (!artistName || (tr.artists || []).some(a => a.name?.toLowerCase().includes(artistName.toLowerCase())))
                        ) || tracks[0];
                        startDownload(btn, String(best.id));
                    } catch(err) {
                        status(`Ошибка поиска: ${err.message}`, true);
                        hideStatus(6000);
                    }
                    return;
                }

                if (sourceBtn) {
                    const trackRow = sourceBtn.closest('[data-index], .CommonTrack_root__i6shE, .TrackPlaylist_trackWithDots__EU6LD');
                    if (trackRow) {
                        const link = trackRow.querySelector('a[href*="/track/"]');
                        if (link) {
                            const m = link.href.match(/track\/(\d+)/);
                            if (m) trackId = m[1];
                        }
                    }
                }

                if (!trackId) {
                    const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                    const link = info?.querySelector('a[href*="/track/"]');
                    if (link) {
                        const m = link.href.match(/track\/(\d+)/);
                        if (m) trackId = m[1];
                    }
                }

                if (trackId) {
                    document.body.click();
                    startDownload(btn, trackId);
                } else {
                    alert("Не удалось определить ID трека");
                }
            };

            let vibeBtn = null;
            innerContainer.querySelectorAll('use').forEach(use => {
                const href = use.getAttribute('href') || use.getAttribute('xlink:href');
                if (href && href.includes('#vibe_')) {
                    vibeBtn = use.closest('button');
                }
            });

            if (vibeBtn) {
                vibeBtn.after(btn);
            } else {
                innerContainer.appendChild(btn);
            }
        });
    }

    const _previewCache = new Map();
    async function _getFullTrackInfo(trackId, quality) {
        const cacheKey = `${trackId}:${quality}`;
        if (_previewCache.has(cacheKey)) return _previewCache.get(cacheKey);

        const token = getOAuthToken();
        if (!token) return null;

        const ts        = Math.floor(Date.now() / 1000);
        const codecs    = ['flac', 'aac', 'he-aac', 'mp3', 'flac-mp4', 'aac-mp4', 'he-aac-mp4'];
        const transport = 'encraw';
        const sign      = await getSign(SECRET_KEY, `${ts}${trackId}${quality}${codecs.join('')}${transport}`);
        const url       = `${API_BASE}/get-file-info?ts=${ts}&trackId=${trackId}&quality=${quality}` +
                          `&codecs=${encodeURIComponent(codecs.join(','))}` +
                          `&transports=${transport}&sign=${encodeURIComponent(sign)}`;
        const headers   = {
            'Authorization':                           token,
            'X-Yandex-Music-Client':                  'YandexMusicDesktopAppWindows/' + getVersion(),
            'X-Yandex-Music-Frontend':                'new',
            'X-Yandex-Music-Without-Invocation-Info': '1',
        };

        for (let i = 0; i < 10; i++) {
            try {
                const data = await gmJSON(url, headers);
                if (!data?.downloadInfo) throw new Error('no downloadInfo');
                if (String(data.downloadInfo.trackId) !== String(trackId)) { await sleep(150); continue; }
                if (data.downloadInfo.quality === 'preview') return null;
                _previewCache.set(cacheKey, data.downloadInfo);
                return data.downloadInfo;
            } catch (e) {
                if (i < 9) await sleep(300);
            }
        }
        return null;
    }

    const _nativeFetch = win.fetch.bind(win);

    win.fetch = async function (...args) {
        const [resource, init] = args;
        const url = typeof resource === 'string' ? resource : resource?.url || '';

        try {
            const h = init && init.headers;
            let auth = null;
            if (h && h.get) auth = h.get('Authorization');
            else if (h) auth = h['Authorization'] || h['authorization'];
            if (auth && /^OAuth\s+/.test(auth)) {
                const t = auth.replace(/^OAuth\s+/, '');
                if (t !== GM_getValue('ymd_oauth_token', null)) GM_setValue('ymd_oauth_token', t);
            }
        } catch (e) {}

        if (url.includes('log.strm.yandex.ru') || url.includes('dynamic-pages/trigger/polling')) {
            return new win.Response('{}', { status: 200 });
        }

        if (url.includes('/get-file-info')) {
            const params  = new URLSearchParams(url.split('?')[1] || '');
            const trackId = params.get('trackId') || (params.get('trackIds') || '').split(',')[0];
            const quality = params.get('quality') || 'nq';

            const res  = await _nativeFetch(...args);
            const data = await res.clone().json().catch(() => null);
            if (!data) return res;

            const info         = data?.downloadInfo;
            const needsReplace = !info ||
                                 String(info.trackId) !== String(trackId) ||
                                 info.quality === 'preview';

            if (trackId && needsReplace) {
                console.log(`[YMD] превью для трека ${trackId}, запрашиваем полный...`);
                const full = await _getFullTrackInfo(trackId, quality === 'preview' ? 'hq' : quality);
                if (full) {
                    console.log(`[YMD] подменили на ${full.codec}/${full.quality}`);
                    return new win.Response(
                        JSON.stringify({ downloadInfo: full }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                }
            }
            return new win.Response(
                JSON.stringify(data),
                { headers: { 'Content-Type': 'application/json' } }
            );
        }

        if (url.includes('yandex')) {
            const response = await _nativeFetch(...args);
            try {
                const text = await response.text();
                let modified = applyRegex(text);
                if (url.includes('/rotor/session')) {
                    try {
                        let obj = _origParse(modified);
                        obj = cleanRotorSession(obj);
                        modified = JSON.stringify(obj);
                    } catch (e) {}
                }
                return new win.Response(modified, {
                    status:     response.status,
                    statusText: response.statusText,
                    headers:    response.headers
                });
            } catch (e) {
                return response;
            }
        }

        return _nativeFetch(...args);
    };

    function startObserver() {
        if (document.body) {
            if (!document.getElementById('ymd-panel')) document.body.appendChild(panel);
            inject();
            let injectTimer = null;
            const obs = new MutationObserver(() => {
                clearTimeout(injectTimer);
                injectTimer = setTimeout(inject, 150);
            });
            obs.observe(document.body, { childList: true, subtree: true });
            if (!GM_getValue('ymd_oauth_token', null)) setTimeout(showAuthBanner, 1500);
        } else {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        }
    }
    startObserver();

})();
