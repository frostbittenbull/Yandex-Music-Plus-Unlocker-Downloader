// ==UserScript==
// @name         Yandex Music — Plus Unlocker & Downloader
// @namespace    http://tampermonkey.net/
// @version      1.2.5
// @updateURL    https://github.com/frostbittenbull/Yandex-Music-Plus-Unlocker-Downloader/raw/refs/heads/main/Yandex-Music-Plus-Unlocker-Downloader.user.js
// @downloadURL  https://github.com/frostbittenbull/Yandex-Music-Plus-Unlocker-Downloader/raw/refs/heads/main/Yandex-Music-Plus-Unlocker-Downloader.user.js
// @description  Яндекс.Музыка — Разблокировка подписки "Плюс", "Моей волны", региональных ограничений, полных треков, вырезание рекламы, скачивание треков/плейлистов с выбором качества и поддержкой тегов для MP3 и нативного FLAC (с собственным демуксером из MP4-контейнера), текстомузыка для любых треков (через LRCLIB), FckCensor (обход запикивания / цензуры)
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
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      api.music.yandex.net
// @connect      avatars.yandex.net
// @connect      strm.yandex.net
// @connect      *.strm.yandex.net
// @connect      storage.yandex.net
// @connect      *.storage.yandex.net
// @connect      yastatic.net
// @connect      *.yastatic.net
// @connect      yastatic-net.ru
// @connect      *.yastatic-net.ru
// @connect      raw.githubusercontent.com
// @connect      lrclib.net
// @connect      mvsep.com
// @connect      *.mvsep.com
// @connect      translate.googleapis.com
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const YMD_TAB_HASH = '#ymd-settings';
    const YMD_TAB_MODE = location.hash.indexOf(YMD_TAB_HASH) === 0;

    const FCK_LIST_URL   = 'https://raw.githubusercontent.com/Hazzz895/FckCensorData/refs/heads/main/list_v2.json';
    const FCK_ADDON_VER  = [2, 0, 0];
    const FCK_TTL_MS     = 12 * 3600 * 1000;
    const FCK_RKN_DISCLAIMER = '65256e7f0ec8594f3459e3fa';
    const FCK_PARSE      = win.JSON.parse;

    const FCK = {
        enabled: true,
        tracks:  new Map(),
        albums:  new Map(),
        audio:   new Map(),
        ids:     new Set(),
        ready:   false,
        listStatus: 'не загружался',
    };
    function fckHttps(u) { return String(u).includes('://') ? String(u) : 'https://' + u; }

    function fckVersionOk(spec) {
        if (!spec) return true;
        const parts = Array.isArray(spec) ? spec : String(spec).split('&');
        return parts.every(p => {
            const m = String(p).trim().match(/^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)*)$/);
            if (!m) return true;
            const want = m[2].split('.').map(Number);
            let cmp = 0;
            for (let i = 0; i < 3 && !cmp; i++) cmp = Math.sign((FCK_ADDON_VER[i] || 0) - (want[i] || 0));
            switch (m[1] || '=') {
                case '>=': return cmp >= 0;
                case '>':  return cmp > 0;
                case '<=': return cmp <= 0;
                case '<':  return cmp < 0;
                default:   return cmp === 0;
            }
        });
    }

    function fckBuildIndex(list) {
        const tracks = new Map(), albums = new Map(), audio = new Map(), ids = new Set();
        const merge = (target, src) => {
            if (!src) return;
            for (const [k, v] of Object.entries(src)) if (!target.has(k)) target.set(k, JSON.parse(JSON.stringify(v)));
        };
        for (const source of (list && list.sources) || []) {
            if (!fckVersionOk(source.supportedVersions)) continue;
            merge(tracks, source.tracks);
            merge(albums, source.albums);
            for (const st of source.tracksStorages || []) {
                const tpl = st.urlTemplate;
                const resolve = (raw) => ((typeof raw === 'number' || (typeof raw === 'string' && !raw.includes('://'))) && tpl)
                    ? tpl.replace('%%', String(raw)) : raw;
                for (const item of st.trackIds || []) {
                    const id = String(typeof item === 'number' ? item : item.id);
                    if (!tpl) continue;
                    if (!audio.has(id)) audio.set(id, fckHttps(tpl.replace('%%', id)));
                    if (typeof item === 'object' && item.durationMs !== undefined) {
                        tracks.set(id, Object.assign({}, tracks.get(id) || {}, { durationMs: item.durationMs }));
                    }
                }
                for (const [id, rep] of Object.entries(st.tracks || {})) {
                    const url = resolve(typeof rep === 'object' && rep ? rep.url : rep);
                    if (typeof url === 'string') audio.set(id, fckHttps(url));
                    if (rep && typeof rep === 'object' && typeof rep.durationMs === 'number') {
                        tracks.set(id, Object.assign({}, tracks.get(id) || {}, { durationMs: rep.durationMs }));
                    }
                }
            }
        }
        for (const k of tracks.keys()) ids.add(k);
        for (const k of albums.keys()) ids.add(k);
        for (const k of audio.keys())  ids.add(k);
        FCK.tracks = tracks; FCK.albums = albums; FCK.audio = audio; FCK.ids = ids; FCK.ready = true;
        const trackIds = new Set([...tracks.keys(), ...audio.keys()]);
        return { tracks: tracks.size, albums: albums.size, audio: audio.size, total: trackIds.size };
    }

    function fckLoadCache() {
        try {
            const raw = GM_getValue('ymd_fck_list', null);
            if (raw) { fckBuildIndex(FCK_PARSE(raw)); FCK.listStatus = 'из кэша'; }
        } catch (e) { FCK.listStatus = 'кэш повреждён: ' + e; console.warn('[YMD/FCK] кэш списка повреждён', e); }
    }

    function ymdToast(isErr, lines) {
        const ID = 'ymd-toast', SID = 'ymd-toast-style';
        if (!document.getElementById(SID)) {
            const st = document.createElement('style');
            st.id = SID;
            st.textContent =
                '#ymd-toast{position:fixed;top:1rem;left:50%;z-index:2147483647;box-sizing:border-box;width:max-content;max-width:min(26rem,92vw);display:flex;align-items:flex-start;gap:.75rem;padding:.875rem 1rem .875rem 1.25rem;' +
                'border-radius:var(--ym-radius-size-xl,16px);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);-webkit-backdrop-filter:blur(.875rem);backdrop-filter:blur(.875rem);' +
                'background-color:var(--ym-background-color-primary-enabled-menu,#1b1b1b);box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu,rgba(0,0,0,.4));font-family:var(--ym-font-text,sans-serif);font-size:14px;line-height:1.4;' +
                'opacity:0;transform:translate(-50%,-1rem);transition:opacity .25s ease,transform .25s ease}' +
                '#ymd-toast.ymd-toast-in{opacity:1;transform:translate(-50%,0)}' +
                '#ymd-toast .ymd-toast-title{display:block;margin-bottom:.125rem;font-family:var(--ym-font-heading,inherit);font-weight:700;color:var(--ym-controls-color-primary-default-enabled,#ffff00)}' +
                '#ymd-toast.ymd-toast-err .ymd-toast-title{color:#ff5555}' +
                '#ymd-toast .ymd-toast-sub{display:block;font-size:var(--ym-font-size-label-xs,.75rem);color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}' +
                '#ymd-toast .ymd-toast-x{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;min-width:22px;height:22px;margin:0 0 0 10px;padding:0;cursor:pointer;border:0;border-radius:11px;outline:0;color:var(--ym-controls-color-secondary-on_default-enabled,rgba(250,250,255,1));background-color:transparent;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;transition:background-color .2s cubic-bezier(.34,.8,.34,1),color .2s cubic-bezier(.34,.8,.34,1)}' +
                '#ymd-toast .ymd-toast-x:hover{background-color:var(--ym-controls-color-secondary-default-hovered,rgba(250,250,255,.1))}' +
                '#ymd-toast .ymd-toast-x:active{background-color:var(--ym-controls-color-secondary-default-pressed,rgba(250,250,255,.14))}' +
                '#ymd-toast .ymd-toast-x::before{content:"";position:absolute;inset:0;visibility:hidden;opacity:0;border-radius:12px;box-shadow:0 0 0 1px var(--ym-controls-color-secondary-default-focused_stroke,rgba(250,250,255,1))}' +
                '#ymd-toast .ymd-toast-x:focus-visible::before{visibility:visible;inset:-1px;opacity:1}' +
                '#ymd-toast .ymd-toast-x svg{display:inline-flex;width:12px;height:12px;color:inherit}' +
                '@media (prefers-reduced-motion:reduce){#ymd-toast{transition:none}}';
            (document.head || document.documentElement).appendChild(st);
        }
        const old = document.getElementById(ID);
        if (old) { clearTimeout(old.__t); old.remove(); }
        const box = document.createElement('div');
        box.id = ID;
        box.className = isErr ? 'ymd-toast-err' : '';
        box.setAttribute('role', isErr ? 'alert' : 'status');
        const body = document.createElement('div');
        body.style.flex = '1';
        lines.forEach((t, i) => {
            const sp = document.createElement('span');
            sp.className = i === 0 ? 'ymd-toast-title' : (i === lines.length - 1 && lines.length > 2 ? 'ymd-toast-sub' : '');
            if (i > 0 && !sp.className) sp.style.display = 'block';
            sp.textContent = t;
            body.appendChild(sp);
        });
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'ymd-toast-x'; x.title = 'Закрыть'; x.setAttribute('aria-label', 'Закрыть');
        x.innerHTML = '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img"><path fill="currentColor" d="M19.207 6.207a1 1 0 0 0-1.414-1.414L12 10.586 6.207 4.793a1 1 0 0 0-1.414 1.414L10.586 12l-5.793 5.793a1 1 0 1 0 1.414 1.414L12 13.414l5.793 5.793a1 1 0 0 0 1.414-1.414L13.414 12z"></path></svg>';
        const close = () => { clearTimeout(box.__t); box.classList.remove('ymd-toast-in'); setTimeout(() => box.remove(), 300); };
        x.addEventListener('click', close);
        box.appendChild(body); box.appendChild(x);
        (document.body || document.documentElement).appendChild(box);
        let shown = false;
        const showIt = () => { if (shown) return; shown = true; box.classList.add('ymd-toast-in'); };
        try { requestAnimationFrame(() => requestAnimationFrame(showIt)); } catch (e) {}
        setTimeout(showIt, 60);
    }

    function ymdDialogEnsureStyle() {
        const SID = 'ymd-dialog-style';
        if (!document.getElementById(SID)) {
            const st = document.createElement('style');
            st.id = SID;
            st.textContent =
                '#ymd-dialog-back{position:fixed;inset:0;z-index:2147483647;background:transparent}' +
                '#ymd-dialog{position:fixed;top:1rem;left:50%;z-index:2147483647;box-sizing:border-box;width:min(26rem,92vw);padding:.875rem 1.25rem 1rem;' +
                'border-radius:var(--ym-radius-size-xl,16px);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);-webkit-backdrop-filter:blur(.875rem);backdrop-filter:blur(.875rem);' +
                'background-color:var(--ym-background-color-primary-enabled-menu,#1b1b1b);box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu,rgba(0,0,0,.4));font-family:var(--ym-font-text,sans-serif);font-size:14px;line-height:1.4;' +
                'opacity:0;transform:translate(-50%,-1rem);transition:opacity .25s ease,transform .25s ease}' +
                '#ymd-dialog.ymd-dialog-in{opacity:1;transform:translate(-50%,0)}' +
                '#ymd-dialog .ymd-dialog-title{display:block;margin-bottom:.25rem;font-family:var(--ym-font-heading,inherit);font-weight:700;color:var(--ym-controls-color-primary-default-enabled,#ffff00)}' +
                '#ymd-dialog .ymd-dialog-line{display:block;margin-top:.125rem;word-break:break-word}' +
                '#ymd-dialog .ymd-dialog-sub{display:block;margin-top:.375rem;font-size:var(--ym-font-size-label-xs,.75rem);color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}' +
                '#ymd-dialog a{color:var(--ym-controls-color-primary-default-enabled,#ffff00);word-break:break-all}' +
                '#ymd-dialog input{box-sizing:border-box;width:100%;margin-top:.625rem;padding:.5rem .875rem;border:0;outline:0;border-radius:var(--ym-radius-size-xxxl,999px);font:inherit;' +
                'color:var(--ym-controls-color-secondary-on_default-enabled,#fff);background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}' +
                '#ymd-dialog textarea{box-sizing:border-box;width:100%;height:14rem;margin-top:.625rem;padding:.625rem .875rem;border:0;outline:0;resize:vertical;border-radius:var(--ym-radius-size-l,12px);font:13px/1.45 ui-monospace,Consolas,monospace;color:var(--ym-controls-color-secondary-on_default-enabled,#fff);background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}' +
                    '#ymd-dialog textarea:focus-visible{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,#fff)}' +
                    '#ymd-dialog input:focus-visible{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,#fff)}' +
                '#ymd-dialog .ymd-dialog-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.875rem}' +
                '#ymd-dialog .ymd-dialog-btn{cursor:pointer;border:0;outline:0;border-radius:var(--ym-radius-size-xxxl,999px);padding:.5rem 1rem;font-family:var(--ym-font-text,inherit);font-size:var(--ym-font-size-label-s,.875rem);line-height:1.25rem;font-weight:var(--ym-font-weight-medium,500);' +
                'color:var(--ym-controls-color-secondary-on_default-enabled,#fff);background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12));transition:background-color .3s}' +
                '#ymd-dialog .ymd-dialog-btn:hover{background:var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.2))}' +
                '#ymd-dialog .ymd-dialog-btn:focus-visible{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,#fff)}' +
                '#ymd-dialog .ymd-dialog-btn.ymd-dialog-ok{color:#000;background:var(--ym-controls-color-primary-default-enabled,#ffff00)}' +
                '#ymd-dialog .ymd-dialog-btn.ymd-dialog-ok:hover{filter:brightness(.92)}' +
                '@media (prefers-reduced-motion:reduce){#ymd-dialog{transition:none}}';
            (document.head || document.documentElement).appendChild(st);
        }
    }
    function ymdDialog(opts) {
        return new Promise((resolve) => {
            ymdDialogEnsureStyle();
            const oldToast = document.getElementById('ymd-toast');
            if (oldToast) { clearTimeout(oldToast.__t); oldToast.remove(); }
            const oldDlg = document.getElementById('ymd-dialog');
            if (oldDlg) oldDlg.remove();
            const oldBack = document.getElementById('ymd-dialog-back');
            if (oldBack) oldBack.remove();

            const back = document.createElement('div');
            back.id = 'ymd-dialog-back';
            const box = document.createElement('div');
            box.id = 'ymd-dialog';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            const mk = (cls, txt) => { const sp = document.createElement('span'); sp.className = cls; sp.textContent = txt; return sp; };
            box.appendChild(mk('ymd-dialog-title', opts.title || ''));
            (opts.lines || []).forEach(t => box.appendChild(mk('ymd-dialog-line', t)));
            if (opts.link) {
                const wrap = document.createElement('span');
                wrap.className = 'ymd-dialog-line';
                const a = document.createElement('a');
                a.href = opts.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = opts.linkText || opts.link;
                wrap.appendChild(a);
                box.appendChild(wrap);
            }
            if (opts.sub) box.appendChild(mk('ymd-dialog-sub', opts.sub));

            let input = null;
            if (opts.input) {
                input = document.createElement('input');
                input.type = 'text';
                input.value = opts.input.value || '';
                input.placeholder = opts.input.placeholder || '';
                input.autocomplete = 'off';
                input.spellcheck = false;
                box.appendChild(input);
            }

            const actions = document.createElement('div');
            actions.className = 'ymd-dialog-actions';
            const cancel = document.createElement('button');
            cancel.type = 'button'; cancel.className = 'ymd-dialog-btn'; cancel.textContent = opts.cancelLabel || 'Отмена';
            const ok = document.createElement('button');
            ok.type = 'button'; ok.className = 'ymd-dialog-btn ymd-dialog-ok'; ok.textContent = opts.okLabel || 'ОК';
            if (!opts.single) actions.appendChild(cancel);
            actions.appendChild(ok);
            box.appendChild(actions);

            let done = false;
            const finish = (val) => {
                if (done) return;
                done = true;
                window.removeEventListener('keydown', onKey, true);
                box.classList.remove('ymd-dialog-in');
                back.remove();
                setTimeout(() => box.remove(), 300);
                resolve(val);
            };
            const accept = () => finish(input ? input.value : true);
            const reject = () => finish(input ? null : false);
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); reject(); }
                else if (e.key === 'Enter' && e.target !== cancel) { e.preventDefault(); e.stopImmediatePropagation(); accept(); }
                else if (e.key === 'Tab') {
                    const f = [input, opts.single ? null : cancel, ok].filter(Boolean);
                    const i = f.indexOf(document.activeElement);
                    e.preventDefault(); e.stopImmediatePropagation();
                    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
                } else e.stopPropagation();
            };
            window.addEventListener('keydown', onKey, true);
            back.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
            back.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
            ok.addEventListener('click', accept);
            cancel.addEventListener('click', reject);

            const host = document.body || document.documentElement;
            host.appendChild(back);
            host.appendChild(box);
            requestAnimationFrame(() => requestAnimationFrame(() => {
                box.classList.add('ymd-dialog-in');
                if (input) { input.focus(); input.select(); } else ok.focus();
            }));
        });
    }
    function ymdPlural(n, f) {
        const a = Math.abs(n) % 100, b = a % 10;
        return (a > 10 && a < 20) ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2];
    }
    function fckNotifyDone(ok, info) {
        const when = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', ' в');
        if (!ok) {
            ymdToast(true, ['Не удалось обновить список подмен', info || FCK.listStatus, 'Попытка: ' + when]);
            return;
        }
        const n = info.total;
        const lines = ['Список подмен успешно обновлён', 'Теперь в списке ' + n + ' ' + ymdPlural(n, ['трек', 'трека', 'треков']) +
            (info.albums ? ' и ' + info.albums + ' ' + ymdPlural(info.albums, ['альбом', 'альбома', 'альбомов']) : '') + '.'];
        if (info.prev !== null) {
            const d = n - info.prev;
            lines.push(info.same ? 'Изменений нет: список уже был актуален.' : 'Изменение: ' + (d > 0 ? '+' : '') + d + ' ' + ymdPlural(d, ['трек', 'трека', 'треков']) + '.');
        }
        lines.push('Обновлено: ' + when);
        ymdToast(false, lines);
    }

    function fckRefreshList(force) {
        try {
            const ts = Number(GM_getValue('ymd_fck_list_ts', 0));
            if (!force && FCK.ready && Date.now() - ts < FCK_TTL_MS) return;
            FCK.listStatus = (FCK.ready ? 'из кэша, ' : '') + 'загрузка с GitHub...';
            const prev = FCK.ready ? new Set([...FCK.tracks.keys(), ...FCK.audio.keys()]).size : null;
            const prevRaw = GM_getValue('ymd_fck_list', null);
            GM_xmlhttpRequest({
                method: 'GET', url: FCK_LIST_URL, timeout: 20000,
                onload: (r) => {
                    try {
                        if (r.status !== 200) throw new Error('HTTP ' + r.status);
                        const parsed = FCK_PARSE(r.responseText);
                        const idx = fckBuildIndex(parsed);
                        GM_setValue('ymd_fck_list', r.responseText);
                        GM_setValue('ymd_fck_list_ts', Date.now());
                        FCK.listStatus = 'загружен с GitHub';
                        if (force) fckNotifyDone(true, Object.assign({ prev, same: prevRaw === r.responseText }, idx));
                    } catch (e) {
                        FCK.listStatus = 'ошибка разбора/загрузки: ' + (e && e.message || e);
                        console.warn('[YMD/FCK] не удалось разобрать список:', e);
                        if (force) fckNotifyDone(false);
                    }
                },
                onerror:   () => { FCK.listStatus = 'ошибка сети (GitHub недоступен?)'; console.warn('[YMD/FCK] список недоступен (GitHub заблокирован? нужен VPN)'); if (force) fckNotifyDone(false); },
                ontimeout: () => { FCK.listStatus = 'таймаут загрузки'; console.warn('[YMD/FCK] таймаут загрузки списка'); if (force) fckNotifyDone(false); },
            });
        } catch (e) { console.warn('[YMD/FCK]', e); if (force) fckNotifyDone(false, String(e && e.message || e)); }
    }

    function fckResetList() {
        try {
            GM_deleteValue('ymd_fck_list');
            GM_deleteValue('ymd_fck_list_ts');
        } catch (e) {}
        FCK.tracks = new Map(); FCK.albums = new Map(); FCK.audio = new Map(); FCK.ids = new Set();
        FCK.ready = false;
        FCK.listStatus = 'сброшен';
        ymdToast(false, ['Список подмен сброшен', 'Локальный кэш очищен. Нажмите «Обновить список подмен», чтобы загрузить его заново.']);
    }

    function fckTextHasKnownId(text) {
        if (!FCK.enabled || !FCK.ready || typeof text !== 'string' || text.length < 40) return false;
        const re = /\d{5,9}/g;
        let m;
        while ((m = re.exec(text))) if (FCK.ids.has(m[0])) return true;
        return false;
    }

    function fckFitArtists(existing, spoofArtists) {
        return spoofArtists.map(a => {
            const old = Array.isArray(existing) ? existing.find(x => String(x.id) === String(a.id)) : null;
            return Object.assign({}, old || { various: false, composer: false, isComposer: false, available: true, isAvailable: true, genres: [], disclaimers: [] }, a);
        });
    }

    function fckSpoofTrack(o, stats) {
        const id = String(o.id).split(':')[0];
        const sp = FCK.tracks.get(id);
        const hasAudio = FCK.audio.has(id);
        if (!sp && !hasAudio) return;
        const origTitle = o.title;

        if (sp) {
            for (const k of Object.keys(sp)) {
                if (k === '__fckCensor') continue;
                if (k === 'artists')       o.artists = fckFitArtists(o.artists, sp.artists);
                else if (k === 'coverUri') { o.coverUri = sp.coverUri; o.ogImage = sp.coverUri; }
                else                       o[k] = sp[k];
            }
        }
        if (hasAudio) {
            const hasA = 'available' in o, hasIA = 'isAvailable' in o;
            if (hasA || !hasIA) o.available = true;
            if (hasIA || !hasA) o.isAvailable = true;
            if ('isRemoved' in o) o.isRemoved = false;
            o.availableForPremiumUsers = true;
            o.availableFullWithoutPermission = true;
            delete o.error;
            if (Array.isArray(o.disclaimers)) o.disclaimers = o.disclaimers.filter(d => {
                let t = ''; try { t = typeof d === 'string' ? d : JSON.stringify(d); } catch (e) {}
                return !(t.includes(FCK_RKN_DISCLAIMER) || t === 'modal' || t.startsWith('modal:') || /rkn|roskomnadzor|роскомнадзор/i.test(t));
            });
        }
        if (sp && Array.isArray(o.albums)) {
            for (const a of o.albums) {
                if (!a || typeof a !== 'object') continue;
                const single = a.type === 'single' || a.trackCount === 1;
                if (single && sp.title && a.title === origTitle) a.title = sp.title;
                if (single && sp.coverUri && a.title === (sp.title || a.title)) { a.coverUri = sp.coverUri; a.ogImage = sp.coverUri; }
                if (single && sp.artists && o.artists) a.artists = o.artists;
            }
        }
        stats.n++;
    }

    function fckSpoofAlbum(o, stats) {
        const id = String(o.id);
        const sp = FCK.albums.get(id);
        if (sp) {
            for (const k of Object.keys(sp)) {
                if (k === '__fckCensor' || k === 'volumes') continue;
                if (k === 'artists')       o.artists = fckFitArtists(o.artists, sp.artists);
                else if (k === 'coverUri') { o.coverUri = sp.coverUri; o.ogImage = sp.coverUri; }
                else                       o[k] = sp[k];
            }
            stats.n++;
        }
        if (Array.isArray(o.volumes) && o.volumes.length === 1 && o.volumes[0] && o.volumes[0].length === 1) {
            const t = o.volumes[0][0];
            const ts = t && FCK.tracks.get(String(t.id).split(':')[0]);
            if (ts) {
                for (const k of ['coverUri', 'title', 'artists']) {
                    if (!(k in ts)) continue;
                    o[k] = k === 'artists' ? fckFitArtists(o.artists, ts.artists) : ts[k];
                    if (k === 'coverUri') o.ogImage = ts.coverUri;
                }
                stats.n++;
            }
        }
    }

    function fckWalk(node, seen, stats) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) { for (const x of node) fckWalk(x, seen, stats); return; }
        try {
            const idStr = (typeof node.id === 'string' || typeof node.id === 'number') ? String(node.id).split(':')[0] : null;
            if (idStr) {
                const albumLike = 'trackCount' in node || 'volumes' in node || 'metaType' in node;
                const knownTrack = FCK.tracks.has(idStr) || FCK.audio.has(idStr);
                if (!albumLike && knownTrack && (typeof node.title === 'string' || Array.isArray(node.albums) || 'durationMs' in node)) {
                    fckSpoofTrack(node, stats);
                } else if (albumLike && !Array.isArray(node.albums)) {
                    fckSpoofAlbum(node, stats);
                }
            }
        } catch (e) { console.warn('[YMD/FCK] ошибка подмены', e); }
        for (const k in node) {
            const v = node[k];
            if (v && typeof v === 'object') fckWalk(v, seen, stats);
        }
    }

    function fckSpoofObject(obj) {
        const stats = { n: 0 };
        try { fckWalk(obj, new WeakSet(), stats); } catch (e) {}
        return stats.n;
    }

    const _fckBlobCache = new Map();
    const _fckBufByUrl = new Map();
    function fckSniffMime(buf) {
        const b = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
        const s = (i, n) => String.fromCharCode.apply(null, Array.from(b.slice(i, i + n)));
        if (s(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
        if (s(0, 4) === 'fLaC') return 'audio/flac';
        if (s(0, 4) === 'OggS') return 'audio/ogg';
        if (s(0, 4) === 'RIFF') return 'audio/wav';
        if (s(4, 4) === 'ftyp') return 'audio/mp4';
        return 'audio/mpeg';
    }
    function fckGetAudio(trackId) {
        if (_fckBlobCache.has(trackId)) return _fckBlobCache.get(trackId);
        const url = FCK.audio.get(trackId);
        const p = new Promise((resolve) => {
            if (!url) return resolve(null);
            GM_xmlhttpRequest({
                method: 'GET', url, responseType: 'arraybuffer', timeout: 120000,
                onload: (r) => {
                    if (r.status !== 200 || !r.response || !r.response.byteLength) return resolve(null);
                    const mime = fckSniffMime(r.response);
                    const blobUrl = URL.createObjectURL(new Blob([r.response], { type: mime }));
                    _fckBufByUrl.set(blobUrl, r.response);
                    resolve({ url: blobUrl, mime, size: r.response.byteLength });
                },
                onerror: () => resolve(null), ontimeout: () => resolve(null),
            });
        });
        _fckBlobCache.set(trackId, p);
        p.then(v => { if (!v) _fckBlobCache.delete(trackId); });
        return p;
    }
    function fckBuildDownloadInfo(trackId, quality, a) {
        const codec = a.mime === 'audio/flac' ? 'flac' : a.mime === 'audio/mp4' ? 'aac' : a.mime === 'audio/ogg' ? 'vorbis' : a.mime === 'audio/wav' ? 'wav' : 'mp3';
        const dur = (FCK.tracks.get(String(trackId)) || {}).durationMs;
        let bitrate = dur ? Math.round(a.size * 8 / dur) : 320;
        if (!(bitrate >= 32 && bitrate <= 2000)) bitrate = 320;
        return {
            trackId: String(trackId), realId: String(trackId), quality: quality || 'nq', codec, bitrate,
            transport: 'raw', key: '', gain: false, size: a.size, url: a.url, urls: [a.url],
        };
    }

    function fckCensorMatches(shown, real) {
        if (!shown || !real || shown.indexOf('*') < 0) return false;
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try { return new RegExp('^' + shown.trim().split(/\*+/).map(esc).join('.+?') + '$', 'i').test(real.trim()); }
        catch (e) { return false; }
    }
    function fckFixDom() {
        if (!FCK.enabled || !FCK.ready) return;
        const links = document.querySelectorAll('a:is([href*="/track/"],[href*="trackId="])');
        for (const a of links) {
            const m = a.getAttribute('href').match(/(?:\/track\/|[?&]trackId=)(\d+)/);
            if (!m) continue;
            const sp = FCK.tracks.get(m[1]);
            if (!sp || !sp.title) continue;
            const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = w.nextNode())) {
                const v = n.nodeValue;
                if (v && v.indexOf('*') >= 0 && fckCensorMatches(v, sp.title)) n.nodeValue = sp.title;
            }
        }
    }

    (function fckInstallHooks() {
        const seenRoots = new WeakSet();
        const once = (r) => {
            if (FCK.enabled && FCK.ready && r && typeof r === 'object' && !seenRoots.has(r)) {
                seenRoots.add(r);
                try { fckSpoofObject(r); } catch (e) {}
            }
            return r;
        };
        try {
            const RP = win.Response.prototype, origJson = RP.json;
            RP.json = function () { return origJson.apply(this, arguments).then(once); };
        } catch (e) { console.warn('[YMD/FCK] хук Response.json не поставлен', e); }
        try {
            const XP = win.XMLHttpRequest.prototype;
            const d = Object.getOwnPropertyDescriptor(XP, 'response');
            if (d && d.get) Object.defineProperty(XP, 'response', {
                configurable: true, enumerable: d.enumerable,
                get() { const r = d.get.call(this); if (this.responseType === 'json') once(r); return r; },
            });
        } catch (e) { console.warn('[YMD/FCK] хук XHR.response не поставлен', e); }
    })();

    FCK.enabled = GM_getValue('ymd_fck_enabled', false) === true;
    if (FCK.enabled) { fckLoadCache(); fckRefreshList(false); }


    const regexReplacements = [
        [/"hasPlus":\s*false/gi,                                  '"hasPlus":true'],
        [/"premium":\s*false/gi,                                  '"premium":true'],
        [/"isFreemium":\s*true/gi,                                '"isFreemium":false'],
        [/"isTrialAvailable":\s*true/gi,                          '"isTrialAvailable":false'],
        [/"advertisementDisabled":\s*false/gi,                    '"advertisementDisabled":true'],
        [/"radioNoAds":\s*false/gi,                               '"radioNoAds":true'],
        [/"isNoAdsFeaturesAvailable":\s*false/gi,                 '"isNoAdsFeaturesAvailable":true'],
        [/"canStartTrial":\s*true/gi,                             '"canStartTrial":false'],
        [/\\"hasPlus\\":\s*false/gi,                              '\\"hasPlus\\":true'],
        [/\\"premium\\":\s*false/gi,                              '\\"premium\\":true'],
        [/\\"isFreemium\\":\s*true/gi,                            '\\"isFreemium\\":false'],
        [/\\"isTrialAvailable\\":\s*true/gi,                      '\\"isTrialAvailable\\":false'],
        [/"geoRegionIso":\s*"[a-zA-Z]{2}"/gi,                     '"geoRegionIso":"ru"'],
        [/"userSessionRegionIso":\s*"[a-zA-Z]{2}"/gi,             '"userSessionRegionIso":"ru"'],
        [/\\"geoRegionIso\\":\s*\\"[a-zA-Z]{2}\\"/gi,             '\\"geoRegionIso\\":\\"ru\\"'],
        [/\\"userSessionRegionIso\\":\s*\\"[a-zA-Z]{2}\\"/gi,     '\\"userSessionRegionIso\\":\\"ru\\"'],
        [/"serviceAvailable":\s*false/gi,                         '"serviceAvailable":true'],
        [/\\"serviceAvailable\\":\s*false/gi,                     '\\"serviceAvailable\\":true'],
        [/"WebNextBlockFullscreen":\{"group":"on"/gi,             '"WebNextBlockFullscreen":{"group":"off"'],
        [/\\"WebNextBlockFullscreen\\":\{\\"group\\":\\"on\\"/gi, '\\"WebNextBlockFullscreen\\":\{\\"group\\":\\"off\\"'],
        [/(\\*"(?:hasAvailableSyncLyrics|hasAvailableTextLyrics|lyricsAvailable)\\*"\s*:\s*)false/gi, '$1true'],
        [/\"hasMusicSubscription\":\s*false/gi,           '"hasMusicSubscription":true'],
        [/\\+\"hasMusicSubscription\\+\":\s*false/gi,     (m) => m.replace(/false$/i, 'true')],
    ];


    const FORCE_ON_EXPERIMENTS = [
        'WebNextNewWaveTab',
        'WebNextQueryToVibe',
        'WebNextWaveAgentExperiment',
        'WebNextWaveScreenWordsInWave',
    ];
    for (const name of FORCE_ON_EXPERIMENTS) {
        regexReplacements.push([
            new RegExp('(\\\\*"' + name + '\\\\*":\\{\\\\*"group\\\\*":\\\\*")[^"\\\\]*(\\\\*",\\\\*"value\\\\*":\\{\\\\*"title\\\\*":\\\\*")[^"\\\\]*(\\\\*")', 'g'),
            '$1on$2on$3'
        ]);
    }

    function forceExperiment(exp) {
        if (!exp || typeof exp !== 'object') return;
        exp.group = 'on';
        if (exp.value && typeof exp.value === 'object') exp.value.title = 'on';
    }
    function forceVibeExperiments(map) {
        if (!map || typeof map !== 'object') return;
        for (const n of FORCE_ON_EXPERIMENTS) if (map[n]) forceExperiment(map[n]);
    }

    function applyRegex(text) {
        if (typeof text !== 'string') return text;
        if (!text.includes('false') && !text.includes('true') &&
            !text.includes('RegionIso') && !text.includes('serviceAvailable') &&
            !text.includes('WebNextBlockFullscreen') && !text.includes('hasMusicSubscription') &&
            !text.includes('WebNextNewWaveTab')) return text;
        let modified = text;
        for (const [regex, replacement] of regexReplacements) {
            modified = modified.replace(regex, replacement);
        }
        return modified;
    }

    const _origParse = win.JSON.parse;
    win.JSON.parse = function (text, reviver) {
        const result = _origParse.call(this, applyRegex(text), reviver);
        try {
            if (result && typeof result === 'object' && fckTextHasKnownId(text)) fckSpoofObject(result);
        } catch (e) {}
        return result;
    };

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
            try { if (FCK.enabled && FCK.ready) fckSpoofObject(args); } catch (e) {}
            const result = origPush.apply(this, args);
            for (const patchSet of args) {
                if (!Array.isArray(patchSet)) continue;
                for (const op of patchSet) {
                    if (op.op === 'replace') {
                        const p = op.path || '';
                        if (p.includes('hasPlus') && op.value === false) op.value = true;
                        if (p.includes('premium') && op.value === false) op.value = true;
                        if (p.includes('isFreemium') && op.value === true)  op.value = false;
                        if (p.includes('isTrialAvailable') && op.value === true)  op.value = false;
                        if (p.includes('advertisementDisabled') && op.value === false) op.value = true;
                        if (p.includes('radioNoAds') && op.value === false) op.value = true;
                        if (p.includes('canStartTrial') && op.value === true)  op.value = false;
                        if (p.includes('geoRegionIso')) op.value = 'ru';
                        if (p.includes('userSessionRegionIso')) op.value = 'ru';
                        if (p.includes('serviceAvailable') && op.value === false) op.value = true;
                        if (p.includes('hasMusicSubscription') && op.value === false) op.value = true;
                        if (/hasAvailable(Sync|Text)Lyrics|lyricsAvailable/.test(p) && op.value === false) op.value = true;
                        if (/lyricsInfo$/.test(p) && op.value && typeof op.value === 'object') {
                            if ('hasAvailableSyncLyrics' in op.value) op.value.hasAvailableSyncLyrics = true;
                            if ('hasAvailableTextLyrics' in op.value) op.value.hasAvailableTextLyrics = true;
                        }
                        if (p.includes('experiments') && typeof op.value === 'object' && op.value !== null) {
                            forceVibeExperiments(op.value);
                            forceVibeExperiments(op.value.experimentsData);
                        }
                        if (FORCE_ON_EXPERIMENTS.some(n => p.includes(n)) && typeof op.value === 'object' && op.value !== null) {
                            forceExperiment(op.value);
                        }
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
        XHR.open = function (_method, url) {
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

    function ymdScrollCss(sels, compact) {
        const S = (suffix) => sels.map(x => x + suffix).join(',');
        const w = compact ? 'var(--ym-spacer-size-m,.75rem)' : 'var(--ym-spacer-size-xxl,1.5rem)';
        const b = compact ? '.1875rem' : '.5rem';
        return '\n' +
            S('') + '{transition:scrollbar-color .2s ease-in-out}\n' +
            S('::-webkit-scrollbar') + '{width:' + w + '}\n' +
            S('::-webkit-scrollbar-thumb') + '{background-clip:content-box;border:' + b + ' solid transparent;border-radius:var(--ym-radius-size-l,1rem);min-height:3.125rem}\n' +
            '@supports selector(scrollbar-width:auto){' + S('') + '{scrollbar-color:var(--ym-surface-color-primary-enabled-entity,rgba(255,255,255,.4)) transparent;scrollbar-gutter:stable}}\n' +
            '@supports selector(::-webkit-scrollbar){' + S('::-webkit-scrollbar-thumb') + '{background-color:var(--ym-controls-color-primary-default-disabled,rgba(255,255,255,.12))}' + S('::-webkit-scrollbar-thumb:hover') + '{background-color:var(--ym-surface-color-primary-enabled-entity,rgba(255,255,255,.4))}}\n' +
            '@media(prefers-reduced-motion:reduce){' + S('') + '{transition:none}}\n' +
            (compact ? '' : '@media only screen and (max-width:1024px){' + S('::-webkit-scrollbar-thumb') + '{border:.1875rem solid transparent}' + S('::-webkit-scrollbar') + '{width:var(--ym-spacer-size-m,.75rem)}}\n');
    }

    const _style = document.createElement('style');
    _style.textContent = `
        .BlockPage_root__crGK_,
        [class*="BlockPage_root"] { display: none !important; }

        .NavbarDesktopAnimatedPlusBar_root___wH9W,
        .NavbarDesktopAnimatedBar_root__tTyvO,
        .VibePageFreemiumBlock_root__HCPuh,
        .VibePage_freemiumBlock__uhLoT { display: none !important; }
        .PaywallModal_root__HIYOy,
        [data-floating-ui-portal]:has(.PaywallModal_root__HIYOy) { display: none !important; pointer-events: none !important; }
        [data-floating-ui-portal]:has(.Vi7Rd0SZWqD17F0872TB) { display: none !important; pointer-events: none !important; }
        .l66GiFKS1Ux_BNd603Cu.NaZE1NCUxSM1MvpZuLJV[data-floating-ui-inert] { display: none !important; pointer-events: none !important; }

        div[class*="PopoverWithActions_root"],
        [class*="NavbarDesktopAnimatedPlusBar_root"],
        [class*="NavbarDesktopPlusBar_root"],
        [class*="VibePageFreemiumBlock_root"] {
            display: none !important;
        }

        button.ymd-dl-all-btn { order: 2 !important; }
        button.ymd-dl-all-btn .ymd-btn-icon { display: none; }
        @media only screen and (max-width: 767.98px) {
            button.ymd-dl-all-btn { display: none !important; }
        }

        .ymd-playlist-menu {
            display: flex !important;
            flex-direction: column !important;
            box-sizing: border-box !important;
            height: var(--ymd-pl-menu-h, 432px) !important;
            max-height: var(--ymd-pl-menu-h, 432px) !important;
            overflow-y: auto !important;
        }

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

        #ymd-panel .ymd-panel-close-x{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;min-width:22px;height:22px;margin:0 0 0 10px;padding:0;cursor:pointer;border:0;border-radius:11px;outline:0;color:var(--ym-controls-color-secondary-on_default-enabled,rgba(250,250,255,1));background-color:transparent;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;transition:background-color .2s cubic-bezier(.34,.8,.34,1),color .2s cubic-bezier(.34,.8,.34,1)}
        #ymd-panel .ymd-panel-close-x:hover{background-color:var(--ym-controls-color-secondary-default-hovered,rgba(250,250,255,.1))}
        #ymd-panel .ymd-panel-close-x:active{background-color:var(--ym-controls-color-secondary-default-pressed,rgba(250,250,255,.14))}
        #ymd-panel .ymd-panel-close-x::before{content:"";position:absolute;inset:0;visibility:hidden;opacity:0;border-radius:12px;box-shadow:0 0 0 1px var(--ym-controls-color-secondary-default-focused_stroke,rgba(250,250,255,1))}
        #ymd-panel .ymd-panel-close-x:focus-visible::before{visibility:visible;inset:-1px;opacity:1}
        #ymd-panel .ymd-panel-close-x svg{display:inline-flex;width:12px;height:12px;color:inherit}
        @media (prefers-reduced-motion:reduce){#ymd-panel .ymd-panel-close-x{transition:none}}
        ${ymdScrollCss(['.ymd-scroll', '.ymd-playlist-menu'], true)}
    `;
    (document.head || document.documentElement).appendChild(_style);

    const SECRET_KEY = "kzqU4XhfCaY6B6JTHODeq5";
    const API_BASE = "https://api.music.yandex.net";

    const QUALITY_OPTIONS = [
        { label: "Lossless → FLAC",           value: "lossless", codecs: ["flac", "flac-mp4"] },
        { label: "High → MP3 (~320 kbps)",    value: "hq",       codecs: ["mp3"] },
        { label: "Low → MP3 (~192 kbps)",     value: "lq",       codecs: ["mp3"] },
    ];

    const YMD_INSTR_OPTIONS = [
        { label: "Instrumental Lossless → FLAC",        instr: true, src: [QUALITY_OPTIONS[0], QUALITY_OPTIONS[1]], fmt: '2', codec: 'flac', ext: 'flac', mime: 'audio/flac' },
        { label: "Instrumental High → MP3 (~320 kbps)", instr: true, src: [QUALITY_OPTIONS[1], QUALITY_OPTIONS[2]], fmt: '0', codec: 'mp3',  ext: 'mp3',  mime: 'audio/mpeg', bitrate: 320 },
    ];

    function guessCoverMime(buf) {
        const view = new Uint8Array(buf.slice(0, 8));
        if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
        if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) return { mime: 'image/png', ext: 'png' };
        return { mime: 'image/jpeg', ext: 'jpg' };
    }

    const OAUTH_PREFIX_RE = /^OAuth\s+/;
    const URL_TOKEN_RE = /[?&](?:oauth_token|access_token)=([A-Za-z0-9._-]{20,})/;

    function saveInterceptedToken(t) {
        if (!t || t.length < 20) return;
        try { sessionStorage.setItem('ymd_intercepted_token', t); } catch (e) {}
        try { if (GM_getValue('ymd_oauth_token', null) !== t) GM_setValue('ymd_oauth_token', t); } catch (e) {}
    }

    (function hookTokenSniffer() {
        const XHR = win.XMLHttpRequest.prototype;

        const _setHeader = XHR.setRequestHeader;
        XHR.setRequestHeader = function (name, value) {
            try {
                if (/^authorization$/i.test(name) && OAUTH_PREFIX_RE.test(value))
                    saveInterceptedToken(String(value).replace(OAUTH_PREFIX_RE, ''));
            } catch (e) {}
            return _setHeader.call(this, name, value);
        };

        const _open = XHR.open;
        XHR.open = function (_method, url) {
            try {
                const m = String(url).match(URL_TOKEN_RE);
                if (m) saveInterceptedToken(m[1]);
            } catch (e) {}
            return _open.apply(this, arguments);
        };

        try {
            const hash = window.location.hash;
            if (hash.includes('access_token=')) {
                const m = hash.match(/access_token=([A-Za-z0-9._-]+)/);
                if (m) GM_setValue('ymd_oauth_token', m[1]);
            }
        } catch (e) {}
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

    const YMD_KEEP_ON_RESET  = new Set(['ymd_oauth_token', 'ymd_fck_list', 'ymd_fck_list_ts', 'ymd_tab_ctx', 'ymd_mvsep_key', 'ymd_kar_hashes']);

    function ymdQualityIdx() {
        const i = Number(GM_getValue('ymd_quality_idx', 0));
        return (Number.isInteger(i) && i >= 0 && i < QUALITY_OPTIONS.length) ? i : 0;
    }
    function ymdQualitySkip() { return GM_getValue('ymd_quality_skip', false) === true; }
    function ymdInstrDlOn() { return GM_getValue('ymd_instr_dl', false) === true; }
    function ymdSkipExistingOn() { return GM_getValue('ymd_skip_existing', false) === true; }
    function ymdDlDirHasPicker() { return typeof win.__ymdPickDir === 'function'; }
    function ymdDlDir() { return String(GM_getValue('ymd_dl_dir', '') || ''); }
    function ymdDlDirShown() { return ymdDlDir() || String(win.__ymdDefaultDir || '%USERPROFILE%\\Downloads\\Яндекс Музыка'); }
    function ymdNotifyOn() { return GM_getValue('ymd_notify_done', true) !== false; }
    function ymdDlCoversOn() { return GM_getValue('ymd_dl_covers', true) !== false; }

    const YMD_NOTIFY_ICON_URL = 'https://music.yandex.ru/favicon.svg';
    let _ymdNotifyIcon = null;
    async function ymdNotifyIconUrl() {
        if (_ymdNotifyIcon !== null) return _ymdNotifyIcon;
        try {
            const svgText = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url: YMD_NOTIFY_ICON_URL, timeout: 10000,
                    onload: (r) => r.status === 200 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
                    onerror: reject, ontimeout: reject
                });
            });
            const img = new Image();
            await new Promise((res, rej) => {
                img.onload = res; img.onerror = () => rej(new Error('svg render failed'));
                img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
            });
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            c.getContext('2d').drawImage(img, 0, 0, 256, 256);
            _ymdNotifyIcon = c.toDataURL('image/png');
        } catch (e) {
            console.warn('[YMD] notify icon:', e);
            _ymdNotifyIcon = '';
        }
        return _ymdNotifyIcon;
    }

    async function ymdNotifyDone(title, text) {
        if (!ymdNotifyOn()) return;
        const icon = await ymdNotifyIconUrl();
        const onClick = () => { try { win.focus(); } catch (e) {} };
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({ title, text, image: icon || undefined, silent: false, timeout: 0, onclick: onClick });
                return;
            }
        } catch (e) { console.warn('[YMD] GM_notification:', e); }
        try {
            if (typeof Notification === 'undefined') return;
            if (Notification.permission === 'default') await Notification.requestPermission();
            if (Notification.permission !== 'granted') return;
            const n = new Notification(title, { body: text, icon: icon || undefined });
            n.onclick = () => { onClick(); n.close(); };
        } catch (e) { console.warn('[YMD] Notification:', e); }
    }
    function ymdPlMenuTallOn() { return GM_getValue('ymd_pl_menu_tall', false) === true; }
    function ymdSliderWheelOn() { return GM_getValue('ymd_slider_wheel', false) === true; }
    const YMD_PL_MENU_H_DEF = 432;
    const YMD_PL_MENU_H_MIN = 200;
    const YMD_PL_MENU_H_MAX = 900;
    const YMD_PL_MENU_H_STEP = 4;
    function ymdPlMenuHeight() {
        const v = Number(GM_getValue('ymd_pl_menu_height', YMD_PL_MENU_H_DEF));
        if (!Number.isFinite(v)) return YMD_PL_MENU_H_DEF;
        return Math.min(YMD_PL_MENU_H_MAX, Math.max(YMD_PL_MENU_H_MIN, Math.round(v)));
    }
    function ymdPlMenuFillPct(h) {
        return ((h - YMD_PL_MENU_H_MIN) / (YMD_PL_MENU_H_MAX - YMD_PL_MENU_H_MIN) * 100).toFixed(2) + '%';
    }
    function ymdApplyPlMenuHeight() {
        document.documentElement.style.setProperty('--ymd-pl-menu-h', ymdPlMenuHeight() + 'px');
    }
    ymdApplyPlMenuHeight();

    function ymdVibeAnimOn() { return GM_getValue('ymd_vibe_anim', true) !== false; }
    function ymdVibeArtistOn() { return GM_getValue('ymd_vibe_artist', true) !== false; }
    function ymdVibeWordsOn() { return GM_getValue('ymd_vibe_words', true) !== false; }
    function ymdVibeBgOn() { return GM_getValue('ymd_vibe_bg', true) !== false; }
    const YMD_DEFAULT_ACCENT = '#ffff00';
    function ymdAccentColor() {
        const v = GM_getValue('ymd_accent_color', null);
        return (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v.toLowerCase() : null;
    }
    const YMD_ACCENT_PRESETS = ['#ffff00', '#ff9500', '#ff3b30', '#ff4fa3', '#a259ff', '#3d8bff', '#00d4ff', '#2bd96b'];
    function ymdHsv2Hex(h, s, v) {
        const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
        return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    }
    function ymdHex2Hsv(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
        const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
        let h = 0;
        if (d) {
            if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
            h *= 60; if (h < 0) h += 360;
        }
        return { h, s: mx ? d / mx : 0, v: mx };
    }
    function ymdApplyAccent() {
        const ID = 'ymd-accent-style';
        const hex = ymdAccentColor();
        let st = document.getElementById(ID);
        if (!hex || hex === YMD_DEFAULT_ACCENT) { if (st) st.remove(); return; }
        const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
        const h2 = (a) => '#' + a.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
        const base = h2(c);
        const hover = h2(c.map(x => x * 0.855));
        const press = h2(c.map(x => x + (255 - x) / 2));
        const focus = 'rgba(' + c.join(',') + ',.5)';
        const decl = [
            ['--ym-logo-color-primary-variant', base],
            ['--ym-logo-color-primary-player', base],
            ['--ym-logo-color-primary-text', base],
            ['--ym-controls-color-primary-default-enabled', base],
            ['--ym-controls-color-primary-default-hovered', hover],
            ['--ym-controls-color-primary-default-pressed', press],
            ['--ym-controls-color-primary-default-focused_stroke', focus],
            ['--ym-controls-color-primary-outline-hovered_stroke', hover],
            ['--ym-controls-color-primary-outline-selected_stroke', base],
            ['--ym-controls-color-primary-outline-focused_stroke', focus],
            ['--ym-controls-color-primary-text-hovered', hover]
        ].map(([k, v]) => k + ':' + v + '!important').join(';');
        if (!st) {
            st = document.createElement('style');
            st.id = ID;
            (document.head || document.documentElement).appendChild(st);
        }
        st.textContent = '.ym-dark-theme.ym-dark-theme,.ym-light-theme.ym-light-theme{' + decl + '}';
    }
    ymdApplyAccent();

    const YMD_FX_DEFS = [
        { key: 'speed', label: 'Скорость',   min: 0.5, max: 2,  def: 1, step: 0.01, dec: 2, log: true },
        { key: 'tempo', label: 'Темп',       min: 0.5, max: 2,  def: 1, step: 0.01, dec: 2, log: true },
        { key: 'pitch', label: 'Тональность', min: -12, max: 12, def: 0, step: 0.1,  dec: 1, log: false },
        { key: 'bass',  label: 'Бас-буст',    min: 0,   max: 12, def: 0, step: 0.1,  dec: 1, log: false },
        { key: 'reverb', label: 'Реверберация', min: 0, max: 100, def: 0, step: 1,   dec: 0, log: false }
    ];
    function ymdFxNormOn() { return GM_getValue('ymd_fx_norm', false) === true; }
    function ymdFxNorm(d, v) {
        v = Number(v);
        if (!isFinite(v)) return d.def;
        v = Math.round(v / d.step) * d.step;
        v = Number(v.toFixed(d.dec));
        return Math.min(d.max, Math.max(d.min, v));
    }
    function ymdFxGet(key) {
        const d = YMD_FX_DEFS.find(x => x.key === key);
        return ymdFxNorm(d, GM_getValue('ymd_fx_' + key, d.def));
    }
    function ymdFxFmt(d, v) {
        if (d.fmt) return d.fmt(v);
        if (d.key === 'pitch') return (v > 0 ? '+' : '') + v.toFixed(2) + ' st';
        if (d.key === 'bass') return v.toFixed(1) + ' dB';
        if (d.key === 'reverb') return Math.round(v) + '%';
        return v.toFixed(2) + ' X';
    }

    const fxEls = [];
    const fxTouched = new WeakSet();
    const fxState = new WeakMap();
    let fxCtx = null;
    let fxGestureBound = false;

    function ymdMakeShifter(ctx) {
        const BT = 0.100, FT = 0.050, sr = ctx.sampleRate;
        const l1 = Math.round(BT * sr), l2 = Math.round((BT - 2 * FT) * sr), len = l1 + l2;
        const mkDelayBuf = (up) => {
            const b = ctx.createBuffer(1, len, sr), p = b.getChannelData(0);
            for (let i = 0; i < l1; i++) p[i] = up ? (l1 - i) / len : i / l1;
            return b;
        };
        const mkFadeBuf = () => {
            const b = ctx.createBuffer(1, len, sr), p = b.getChannelData(0), fl = Math.round(FT * sr);
            for (let i = 0; i < l1; i++) {
                p[i] = i < fl ? Math.sqrt(i / fl) : (i >= l1 - fl ? Math.sqrt(1 - (i - (l1 - fl)) / fl) : 1);
            }
            return b;
        };
        const loopSrc = (buf) => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; return n; };
        const down = mkDelayBuf(false), up = mkDelayBuf(true), fade = mkFadeBuf();
        const mod = [loopSrc(down), loopSrc(down), loopSrc(up), loopSrc(up)];
        const modG = mod.map(n => { const g = ctx.createGain(); n.connect(g); return g; });
        const mg1 = ctx.createGain(), mg2 = ctx.createGain();
        modG[0].connect(mg1); modG[2].connect(mg1);
        modG[1].connect(mg2); modG[3].connect(mg2);
        const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
        mg1.connect(d1.delayTime); mg2.connect(d2.delayTime);
        const f1 = loopSrc(fade), f2 = loopSrc(fade);
        const x1 = ctx.createGain(), x2 = ctx.createGain();
        x1.gain.value = 0; x2.gain.value = 0;
        f1.connect(x1.gain); f2.connect(x2.gain);
        const input = ctx.createGain(), output = ctx.createGain();
        input.connect(d1); input.connect(d2);
        d1.connect(x1); d2.connect(x2);
        x1.connect(output); x2.connect(output);
        const t = ctx.currentTime + 0.05, t2 = t + BT - FT;
        mod[0].start(t); mod[1].start(t2); mod[2].start(t); mod[3].start(t2);
        f1.start(t); f2.start(t2);
        return {
            input, output,
            setRatio(R) {
                const dlt = R - 1, isUp = dlt > 0;
                modG[0].gain.value = isUp ? 0 : 1; modG[1].gain.value = isUp ? 0 : 1;
                modG[2].gain.value = isUp ? 1 : 0; modG[3].gain.value = isUp ? 1 : 0;
                const g = Math.min(Math.abs(dlt), 3) * BT;
                mg1.gain.setTargetAtTime(g, ctx.currentTime, 0.01);
                mg2.gain.setTargetAtTime(g, ctx.currentTime, 0.01);
            }
        };
    }

    function ymdFxSafe(el) {
        try {
            const u = el.currentSrc || el.src;
            if (!u) return false;
            if (/^(blob|data):/i.test(u)) return true;
            if (new URL(u, location.href).origin === location.origin) return true;
            return el.crossOrigin !== null && el.crossOrigin !== undefined;
        } catch (e) { return false; }
    }

    function ymdFxBindGesture() {
        if (fxGestureBound) return;
        fxGestureBound = true;
        const h = () => {
            if (!fxCtx) return;
            fxCtx.resume().then(() => {
                if (fxCtx.state === 'running') {
                    document.removeEventListener('pointerdown', h, true);
                    document.removeEventListener('keydown', h, true);
                    fxGestureBound = false;
                    ymdFxApplyAll();
                }
            }).catch(() => {});
        };
        document.addEventListener('pointerdown', h, true);
        document.addEventListener('keydown', h, true);
    }

    const fxIRCache = {};
    const fxRevPool = new WeakMap();
    function ymdFxIR(sr, ctx) {
        if (fxIRCache[sr]) return fxIRCache[sr];
        const len = Math.floor(sr * 2.4);
        let ir;
        try { ir = new win.AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr }); }
        catch (e) { ir = ctx.createBuffer(2, len, sr); }
        for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
        }
        return (fxIRCache[sr] = ir);
    }
    function ymdBuildReverb(ctx) {
        const input = ctx.createGain(), out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
        const conv = ctx.createConvolver(), lp = ctx.createBiquadFilter();
        dry.gain.value = 1; wet.gain.value = 0;
        conv.buffer = ymdFxIR(ctx.sampleRate, ctx);
        lp.type = 'lowpass'; lp.frequency.value = 6000;
        input.connect(dry); dry.connect(out);
        input.connect(conv); conv.connect(lp); lp.connect(wet); wet.connect(out);
        return {
            input, out,
            set(a) {
                dry.gain.setTargetAtTime(1 - a * 0.35, ctx.currentTime, 0.03);
                wet.gain.setTargetAtTime(a * 0.9, ctx.currentTime, 0.03);
            }
        };
    }
    function ymdMakeReverb(ctx) {
        const r = fxRevPool.get(ctx);
        if (r) { fxRevPool.delete(ctx); return r; }
        return ymdBuildReverb(ctx);
    }
    function ymdFxWarmReverb() {
        const run = () => {
            const ctxs = new Set();
            if (fxCtx) ctxs.add(fxCtx);
            fxEls.forEach(r => {
                const el = r.deref(), s = el && fxState.get(el);
                if (s && s.ctx) ctxs.add(s.ctx);
            });
            ctxs.forEach(ctx => {
                if (fxRevPool.has(ctx)) return;
                try { fxRevPool.set(ctx, ymdBuildReverb(ctx)); } catch (e) {}
            });
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 });
        else setTimeout(run, 50);
    }
    function ymdMakeNorm(ctx) {
        const c1 = ctx.createDynamicsCompressor(), mk = ctx.createGain(), lim = ctx.createDynamicsCompressor();
        c1.threshold.value = -26; c1.knee.value = 24; c1.ratio.value = 6; c1.attack.value = 0.005; c1.release.value = 0.25;
        mk.gain.value = 1.6;
        lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
        c1.connect(mk); mk.connect(lim);
        return { input: c1, out: lim };
    }
    function ymdFxWire(st, cfg, R, fx) {
        const ctx = st.ctx;
        if (cfg.shift && !st.sh) st.sh = ymdMakeShifter(ctx);
        if (cfg.bass && !st.bass) {
            st.bass = ctx.createBiquadFilter();
            st.bass.type = 'lowshelf';
            st.bass.frequency.value = 110;
            st.bassTrim = ctx.createGain();
            st.bass.connect(st.bassTrim);
        }
        if (cfg.reverb && !st.rev) st.rev = ymdMakeReverb(ctx);
        if (cfg.norm && !st.nrm) st.nrm = ymdMakeNorm(ctx);
        const key = [cfg.shift, cfg.bass, cfg.reverb, cfg.norm].join();
        if (key !== (st.key || 'false,false,false,false')) {
            const dis = (n) => { try { if (n) n.disconnect(); } catch (e) {} };
            dis(st.src); dis(st.sh && st.sh.output); dis(st.bassTrim); dis(st.rev && st.rev.out); dis(st.nrm && st.nrm.out);
            let cur = st.src;
            const link = (i, o) => { cur.connect(i); cur = o; };
            if (cfg.shift) link(st.sh.input, st.sh.output);
            if (cfg.bass) link(st.bass, st.bassTrim);
            if (cfg.reverb) link(st.rev.input, st.rev.out);
            if (cfg.norm) link(st.nrm.input, st.nrm.out);
            cur.connect(st.dest);
        }
        st.key = key;
        if (cfg.shift) st.sh.setRatio(R);
        if (cfg.bass) {
            st.bass.gain.setTargetAtTime(fx.bass, ctx.currentTime, 0.02);
            st.bassTrim.gain.setTargetAtTime(Math.pow(10, -fx.bass * 0.25 / 20), ctx.currentTime, 0.02);
        }
        if (cfg.reverb) st.rev.set(fx.reverb / 100);
    }

    function ymdFxEngage(el, R, fx) {
        let st = fxState.get(el);
        if (st && st.dead) return false;
        const cfg = { shift: Math.abs(R - 1) > 0.001, bass: fx.bass > 0, reverb: fx.reverb > 0, norm: !!fx.norm };
        const any = cfg.shift || cfg.bass || cfg.reverb || cfg.norm;
        if (!st) {
            if (!any) return false;
            if (!ymdFxSafe(el)) {
                if (!el.__ymdFxWarned) { el.__ymdFxWarned = 1; console.warn('[YMD] fx: эффекты недоступны (источник звука другого домена без CORS)', el.currentSrc || el.src); }
                return false;
            }
            try {
                if (!fxCtx) fxCtx = new (win.AudioContext || win.webkitAudioContext)();
                if (fxCtx.state !== 'running') {
                    fxCtx.resume().then(() => { if (fxCtx.state === 'running') ymdFxApplyAll(); }).catch(() => {});
                    if (fxCtx.state !== 'running') { ymdFxBindGesture(); return false; }
                }
                st = { ctx: fxCtx, src: fxCtx.createMediaElementSource(el), dest: fxCtx.destination, key: 'false,false,false,false' };
                st.src.connect(st.dest);
                fxState.set(el, st);
            } catch (e) {
                console.warn('[YMD] fx engage', e);
                fxState.set(el, { dead: true });
                return false;
            }
        }
        try { ymdFxWire(st, cfg, R, fx); } catch (e) { console.warn('[YMD] fx route', e); return false; }
        return true;
    }

    function ymdFxApplyTo(el) {
        const sp = ymdFxGet('speed'), tp = ymdFxGet('tempo'), ps = ymdFxGet('pitch');
        const fx = { bass: ymdFxGet('bass'), reverb: ymdFxGet('reverb'), norm: ymdFxNormOn() };
        const isDef = sp === 1 && tp === 1 && ps === 0 && fx.bass === 0 && fx.reverb === 0 && !fx.norm;
        if (isDef && !fxTouched.has(el) && !fxState.has(el)) return;
        const k = Math.pow(2, ps / 12);
        const rate = Math.min(4, Math.max(0.25, sp * tp));
        const r1 = sp * k, r2 = k / tp;
        let keep = true, R = r1;
        if (Math.abs(Math.log(r2)) < Math.abs(Math.log(r1))) { keep = false; R = r2; }
        const routed = ymdFxEngage(el, R, fx);
        if (!routed && Math.abs(R - 1) > 0.001) keep = (tp !== 1 || ps !== 0) ? true : sp === 1;
        try {
            el.playbackRate = rate;
            if ('preservesPitch' in el) el.preservesPitch = keep;
            if ('mozPreservesPitch' in el) el.mozPreservesPitch = keep;
            if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = keep;
            fxTouched.add(el);
        } catch (e) {}
    }
    function ymdFxApplyAll() {
        for (let i = fxEls.length - 1; i >= 0; i--) {
            const el = fxEls[i].deref();
            if (!el) { fxEls.splice(i, 1); continue; }
            ymdFxApplyTo(el);
        }
    }
    function ymdFxRegister(el) {
        if (!el || fxEls.some(r => r.deref() === el)) return;
        fxEls.push(new WeakRef(el));
        const h = () => ymdFxApplyTo(el);
        ['loadedmetadata', 'playing'].forEach(ev => el.addEventListener(ev, h));
        ymdFxApplyTo(el);
    }
    (function ymdFxHookWebAudio() {
        try {
            const AC = win.AudioContext || win.webkitAudioContext;
            const proto = AC && AC.prototype;
            if (!proto || proto.__ymdFxPatched) return;
            const orig = proto.createMediaElementSource;
            proto.createMediaElementSource = function (el) {
                const real = orig.apply(this, arguments);
                try {
                    const out = this.createGain();
                    real.connect(out);
                    fxState.set(el, { ctx: this, src: real, dest: out, key: 'false,false,false,false' });
                    try { out.mediaElement = el; } catch (e) {}
                    ymdFxRegister(el);
                    return out;
                } catch (e) {
                    console.warn('[YMD] fx hook', e);
                    return real;
                }
            };
            proto.__ymdFxPatched = true;
        } catch (e) { console.warn('[YMD] fx webaudio hook', e); }
    })();
    (function ymdFxInit() {
        try {
            const proto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
            if (!proto || proto.__ymdFxPatched) return;
            const orig = proto.play;
            proto.play = function () { try { ymdFxRegister(this); } catch (e) {} return orig.apply(this, arguments); };
            proto.__ymdFxPatched = true;
        } catch (e) { console.warn('[YMD] fx init', e); }
    })();

    const YMD_FX_HINTS = {
        speed: 'Ускоряет или замедляет трек вместе с высотой звука.<br>От 0.50 X до 2.00 X.',
        tempo: 'Меняет только скорость, высота звука сохраняется.<br>От 0.50 X до 2.00 X.',
        pitch: 'Меняет только высоту звука, скорость не меняется.<br>От −12 до +12 полутонов.',
        bass: 'Усиливает низкие частоты.<br>От 0 до 12 dB.',
        reverb: 'Добавляет эффект помещения: чем больше значение, тем сильнее «эхо».<br>От 0% до 100%.',
        asDays: 'Срок для автоскипа, от 1 до 90 дней: трек, игравший позже, будет пропущен.',
        asLimit: 'Сколько записей хранить в истории, от 0 до 500000 (шаг 1000).<br>Крайнее правое положение «∞» — без ограничения.<br>Старые записи удаляются первыми. Работает, когда тумблер выше выключен.',
        dlConc: 'Сколько треков скачивается одновременно при массовой загрузке, от 1 до 8.<br>Если появились ошибки, уменьшите значение.',
        trLimit: 'Переводы хранятся на устройстве, от 50 до 1000 треков.<br>Когда лимит превышен, старые переводы удаляются первыми.'
    };
    function ymdFxHtml(defs = YMD_FX_DEFS) {
        return defs.map(d =>
            '<div class="ymd-fx' + (d.disabled && d.disabled() ? ' ymd-fx-disabled' : '') + '" data-fx="' + d.key + '">' +
                '<div class="ymd-fx-head"><span class="ymd-label">' + d.label + '</span><span class="ymd-fx-val" data-role="val"></span></div>' +
                (YMD_FX_HINTS[d.key] ? '<div class="ymd-hint">' + YMD_FX_HINTS[d.key] + '</div>' : '') +
                '<div class="ymd-fx-track" role="slider" tabindex="' + (d.disabled && d.disabled() ? '-1' : '0') + '"' + (d.disabled && d.disabled() ? ' aria-disabled="true"' : '') + ' aria-label="' + d.label + '">' +
                    '<div class="ymd-fx-rail"></div>' +
                    '<div class="ymd-fx-fill"></div>' +
                    '<div class="ymd-fx-thumb"></div>' +
                '</div>' +
            '</div>').join('');
    }
    function ymdFxBind(root) {
        ymdFxWarmReverb();
        root.querySelectorAll('.ymd-fx').forEach(box => {
            const d = YMD_FX_DEFS.concat([YMD_AS_DAYS_DEF, YMD_AS_LIMIT_DEF, YMD_DL_CONC_DEF, YMD_TR_LIMIT_DEF]).find(x => x.key === box.dataset.fx);
            const getV = () => (d.get ? d.get() : ymdFxGet(d.key));
            const track = box.querySelector('.ymd-fx-track');
            const thumb = box.querySelector('.ymd-fx-thumb');
            const fill = box.querySelector('.ymd-fx-fill');
            const val = box.querySelector('[data-role="val"]');
            const toPos = (v) => d.log ? (Math.log2(v) + 1) / 2 : (v - d.min) / (d.max - d.min);
            const fromPos = (p) => d.log ? Math.pow(2, p * 2 - 1) : d.min + p * (d.max - d.min);
            const paint = () => {
                const v = getV();
                const pos = toPos(v), p0 = toPos(d.def);
                thumb.style.left = (pos * 100) + '%';
                fill.style.left = (Math.min(pos, p0) * 100) + '%';
                fill.style.width = (Math.abs(pos - p0) * 100) + '%';
                track.title = d.label + ' (' + ymdFxFmt(d, v) + ')';
                val.textContent = ymdFxFmt(d, v);
                box.classList.toggle('ymd-fx-mod', v !== d.def);
                track.setAttribute('aria-valuemin', d.min);
                track.setAttribute('aria-valuemax', d.max);
                track.setAttribute('aria-valuenow', v);
                track.setAttribute('aria-valuetext', ymdFxFmt(d, v));
            };
            const set = (v) => {
                if (box.classList.contains('ymd-fx-disabled')) return;
                v = ymdFxNorm(d, v);
                if (v === getV()) return;
                if (d.save) d.save(v); else GM_setValue('ymd_fx_' + d.key, v);
                paint();
                if (!d.save) ymdFxApplyAll();
            };
            const fromEvent = (e) => {
                const r = track.getBoundingClientRect();
                let p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                if (Math.abs(p - toPos(d.def)) < 0.015) p = toPos(d.def);
                set(fromPos(p));
            };
            track.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                track.focus();
                track.setPointerCapture(e.pointerId);
                fromEvent(e);
                const up = () => {
                    track.removeEventListener('pointermove', fromEvent);
                    track.removeEventListener('pointerup', up);
                    track.removeEventListener('pointercancel', up);
                };
                track.addEventListener('pointermove', fromEvent);
                track.addEventListener('pointerup', up);
                track.addEventListener('pointercancel', up);
            });
            box.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                set(d.def);
            });
            box.addEventListener('wheel', (e) => {
                if (!ymdSliderWheelOn()) return;
                e.preventDefault();
                set(getV() + (e.deltaY < 0 ? 1 : -1) * d.step);
            }, { passive: false });
            track.addEventListener('keydown', (e) => {
                const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                set(getV() + dir * d.step);
            });
            paint();
        });
    }

    function ymdApplyVibeAnim() {
        const ID = 'ymd-vibe-anim-style';
        const sel = [];
        if (!ymdVibeAnimOn()) sel.push('[class*="VibeWidgetAnimation_root"]', '[class*="VibePage_vibeAnimation"]');
        if (!ymdVibeArtistOn()) sel.push('[class*="VibePage_artistCover"]');
        if (!ymdVibeWordsOn()) sel.push('[class*="VibePage_words"]');
        let css = '';
        if (!ymdVibeBgOn()) {
            const vars = [];
            for (let n = 0; n < 16; n++) vars.push('--vibe-gradient-stop-' + n + ':transparent!important');
            css += '[style*="--vibe-gradient-stop-"]{' + vars.join(';') + '}';
        }
        let st = document.getElementById(ID);
        if (sel.length) css += sel.join(',') + '{display:none!important}';
        if (!css) { if (st) st.remove(); return; }
        if (!st) {
            st = document.createElement('style');
            st.id = ID;
            (document.head || document.documentElement).appendChild(st);
        }
        st.textContent = css;
    }
    ymdApplyVibeAnim();

    const YMD_AS_DB_NAME = 'YandexMusicAutoskipDB';
    const ymdAsOn = () => GM_getValue('ymd_as_enabled', false) === true;
    const ymdAsLabelOn = () => GM_getValue('ymd_as_label', false) === true;
    const ymdAsRecOn = () => GM_getValue('ymd_as_record', false) === true;
    const ymdPlOn = () => GM_getValue('ymd_pl_label', false) === true;
    const ymdAsPlKeepOn = () => GM_getValue('ymd_as_pl_keep', false) === true;
    function ymdAsPlSelected() {
        try {
            const a = JSON.parse(GM_getValue('ymd_as_pl_sel', '[]'));
            return Array.isArray(a) ? a.map(String) : [];
        } catch (e) { return []; }
    }
    function ymdAsSelIds() {
        const out = new Set();
        const sel = ymdAsPlSelected();
        if (!sel.length) return out;
        const lists = ymdPlReadCache().lists;
        for (const k of sel) {
            const pl = lists[k];
            if (pl) for (const id of pl.ids || []) out.add(id);
        }
        return out;
    }
    function ymdAsPlLabelText() {
        const sel = ymdAsPlSelected();
        const lists = ymdPlReadCache().lists;
        const n = Object.keys(lists).length ? sel.filter(k => lists[k]).length : sel.length;
        return n ? 'Выбрано: ' + n : 'Не выбрано';
    }
    const YMD_PL_TTL = 90000;
    const YMD_PL_SKIP = new Set(['3']);
    let plMap = new Map(), plLoadedAt = 0, plLoading = null, plCurIds = [], plCurSig = '', plNames = [], plTimer = null;
    const plSearch = new Map(), plSearching = new Set();
    const ymdAsActive = () => ymdAsOn() || ymdAsLabelOn() || ymdAsRecOn();
    const YMD_AS_DAYS_DEF = {
        key: 'asDays', label: 'Не повторять в течение', min: 1, max: 90, def: 10, step: 1, dec: 0, log: false,
        get: () => ymdFxNorm(YMD_AS_DAYS_DEF, GM_getValue('ymd_as_days', 10)),
        save: (v) => { GM_setValue('ymd_as_days', v); ymdAsRecheck(); },
        fmt: (v) => v + ' дн.'
    };
    const ymdAsDays = () => YMD_AS_DAYS_DEF.get();
    const ymdAsByDaysOn = () => GM_getValue('ymd_as_limit_days', true) !== false;
    const YMD_AS_LIMIT_DEF = {
        key: 'asLimit', label: 'Лимит записей в истории', min: 0, max: 500000, def: 1000, step: 1000, dec: 0, log: false,
        disabled: () => ymdAsByDaysOn(),
        get: () => ymdFxNorm(YMD_AS_LIMIT_DEF, GM_getValue('ymd_as_limit', 1000)),
        save: (v) => GM_setValue('ymd_as_limit', v),
        fmt: (v) => v >= YMD_AS_LIMIT_DEF.max ? '∞' : String(v)
    };
    const ymdAsLimit = () => { const v = YMD_AS_LIMIT_DEF.get(); return v >= YMD_AS_LIMIT_DEF.max ? Infinity : v; };
    const YMD_DL_CONC_DEF = {
        key: 'dlConc', label: 'Сколько треков качать одновременно', min: 1, max: 8, def: 4, step: 1, dec: 0, log: false,
        get: () => ymdFxNorm(YMD_DL_CONC_DEF, GM_getValue('ymd_dl_conc', 4)),
        save: (v) => GM_setValue('ymd_dl_conc', v),
        fmt: (v) => String(v)
    };
    const ymdDlConc = () => YMD_DL_CONC_DEF.get();
    const YMD_TR_LIMIT_DEF = {
        key: 'trLimit', label: 'Сколько переводов хранить', min: 50, max: 1000, def: 300, step: 10, dec: 0, log: false,
        get: () => ymdFxNorm(YMD_TR_LIMIT_DEF, GM_getValue('ymd_tr_limit', 300)),
        save: (v) => GM_setValue('ymd_tr_limit', v),
        fmt: (v) => String(v)
    };
    const ymdTrLimit = () => YMD_TR_LIMIT_DEF.get();
    const ymdFsOn = () => ymdIsDesktopShim() && GM_getValue('ymd_fullscreen', false) === true;
    function ymdFsApply(on) {
        try {
            if (on) {
                if (!document.fullscreenElement) { const r = document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); }
            } else if (document.fullscreenElement) {
                const r = document.exitFullscreen(); if (r && r.catch) r.catch(() => {});
            }
        } catch (e) {}
    }
    function ymdFsSyncSwitch() {
        try { document.querySelectorAll('[data-act="fullscreen-toggle"]').forEach((b) => b.setAttribute('aria-checked', String(ymdFsOn()))); } catch (e) {}
    }
    function ymdFsInstall() {
        if (!ymdIsDesktopShim()) return;
        const off = () => { window.removeEventListener('pointerdown', restore, true); window.removeEventListener('keydown', restore, true); };
        const restore = () => {
            if (!ymdFsOn() || document.fullscreenElement) { off(); return; }
            ymdFsApply(true);
        };
        document.addEventListener('fullscreenchange', () => {
            const fe = document.fullscreenElement;
            if (fe && fe !== document.documentElement) return;
            const is = !!fe;
            if (is !== ymdFsOn()) GM_setValue('ymd_fullscreen', is);
            if (is) off();
            ymdFsSyncSwitch();
        });
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'F11' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const next = !document.fullscreenElement;
            GM_setValue('ymd_fullscreen', next);
            ymdFsApply(next);
            ymdFsSyncSwitch();
        }, true);
        if (ymdFsOn()) {
            window.addEventListener('pointerdown', restore, true);
            window.addEventListener('keydown', restore, true);
        }
    }

    let asDb = null, asDbTried = false, asInstalled = false;
    let asNewKey = null, asKey = null, asLast = null, asSaved = false, asReady = false, asNewTitle = '', asNewArtist = '';
    let asTime = 0, asSkips = 0, asChecks = 21, asMethod = 1, asTimer = null, asAudio = null;
    let asStatus = 'Играет впервые', asFlashTimer = null, asRecheckTimer = null;
    const asBound = new WeakSet();

    function ymdAsPlural(n, a, b, c) {
        const m = n % 100, d = m % 10;
        if (m > 10 && m < 20) return c;
        if (d > 1 && d < 5) return b;
        if (d === 1) return a;
        return c;
    }
    function ymdAsAgo(ts) {
        if (!ts) return null;
        const diff = Date.now() - ts;
        if (isNaN(diff) || diff < 0) return null;
        const min = Math.floor(diff / 60000);
        if (min < 1) return 'только что';
        if (min < 60) return min + ' ' + ymdAsPlural(min, 'минуту', 'минуты', 'минут') + ' назад';
        const h = Math.floor(min / 60);
        if (h < 24) return h + ' ' + ymdAsPlural(h, 'час', 'часа', 'часов') + ' назад';
        const d = Math.floor(h / 24);
        if (d < 21) return d + ' ' + ymdAsPlural(d, 'день', 'дня', 'дней') + ' назад';
        const w = Math.floor(d / 7), mo = Math.floor(d / 30.44), y = Math.floor(d / 365.25);
        if (mo < 3) return w + ' ' + ymdAsPlural(w, 'неделю', 'недели', 'недель') + ' назад';
        if (y < 3) return mo + ' ' + ymdAsPlural(mo, 'месяц', 'месяца', 'месяцев') + ' назад';
        return y + ' ' + ymdAsPlural(y, 'год', 'года', 'лет') + ' назад';
    }
    function ymdAsColor(ts) {
        if (!ts) return '#8a2be2';
        const d = (Date.now() - ts) / 86400000;
        if (d < 11) return '#ff3333';
        if (d < 21) return '#ff9900';
        if (d < 42) return '#ffff00';
        if (d < 92) return '#00ff00';
        if (d < 183) return '#00ffff';
        if (d < 366) return '#0066ff';
        return '#8a2be2';
    }

    function ymdAsOpenDb() {
        if (asDb || asDbTried) return;
        asDbTried = true;
        try {
            const req = indexedDB.open(YMD_AS_DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('history')) d.createObjectStore('history');
            };
            req.onsuccess = (e) => {
                asDb = e.target.result;
                asDb.onclose = () => { asDb = null; asDbTried = false; };
                if (asNewKey && ymdAsActive()) ymdAsOnTrack(true);
            };
            req.onerror = () => { asDbTried = false; console.warn('[YMD] автоскип: не удалось открыть базу истории', req.error); };
        } catch (err) { console.warn('[YMD] автоскип: IndexedDB недоступна', err); }
    }
    function ymdAsDbReady() {
        if (asDb) return Promise.resolve(asDb);
        return new Promise((resolve) => {
            ymdAsOpenDb();
            let n = 0;
            const t = setInterval(() => { if (asDb || ++n > 50) { clearInterval(t); resolve(asDb); } }, 100);
        });
    }
    async function ymdAsTrim() {
        const byDays = ymdAsByDaysOn();
        const limit = ymdAsLimit();
        if (!byDays && limit === Infinity) return;
        const db = await ymdAsDbReady();
        if (!db) return;
        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['history'], 'readwrite');
                const st = tx.objectStore('history');
                const all = [];
                const req = st.openCursor();
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) {
                        const v = (c.value !== null && typeof c.value === 'object') ? 0 : Number(c.value);
                        all.push([c.key, Number.isFinite(v) ? v : 0]);
                        c.continue();
                        return;
                    }
                    if (byDays) {
                        const maxDays = ymdAsDays(), now = Date.now();
                        for (const [k, ts] of all) {
                            if (!ts || Math.floor((now - ts) / 86400000) > maxDays) st.delete(k);
                        }
                        return;
                    }
                    const extra = all.length - limit;
                    if (extra > 0) {
                        all.sort((a, b) => a[1] - b[1]);
                        for (let i = 0; i < extra; i++) st.delete(all[i][0]);
                    }
                };
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
        } catch (err) { console.warn('[YMD] лимит истории', err); }
        ymdAsUpdateCount();
    }
    function ymdAsGetTs(key) {
        return new Promise((resolve) => {
            try {
                const r = asDb.transaction(['history'], 'readonly').objectStore('history').get(key);
                r.onsuccess = () => resolve(r.result ? parseInt(r.result, 10) : null);
                r.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }

    function ymdAsLabelHost() {
        const full = document.querySelector('[class*="FullscreenPlayerDesktopContent_meta__"]');
        if (full && full.getClientRects().length) {
            const mc = full.querySelector('[class*="Meta_metaContainer__"]');
            if (mc) {
                let after = null;
                for (const ch of mc.children) if (ch.id !== 'ymd-as-label' && ch.id !== 'ymd-pl-label') after = ch;
                const cap = mc.querySelector('[class*="Meta_artistCaption__"]');
                if (after) return { mode: 'full', parent: mc, after: after, cls: cap ? cap.className : '' };
            }
        }
        const vibeRoot = document.querySelector('[class*="VibeResetButton_root_visible"]');
        if (vibeRoot) {
            const cont = vibeRoot.querySelector('[class*="VibeResetButton_container__"]');
            const src = vibeRoot.querySelector('[class*="VibeResetButton_context__"]');
            if (cont && src) return { mode: 'vibe', parent: cont, cls: src.className };
            if (src) {
                let under = document.getElementById('ymd-vibe-under');
                if (!under || under.parentElement !== vibeRoot) {
                    if (under) under.remove();
                    under = document.createElement('div');
                    under.id = 'ymd-vibe-under';
                    under.style.cssText = 'display:block;flex:0 0 100%;width:100%;text-align:center;';
                    vibeRoot.appendChild(under);
                }
                vibeRoot.style.flexWrap = 'wrap';
                return { mode: 'vibe', parent: under, cls: src.className };
            }
        }
        const desc = document.querySelector('[class*="PlayerBarDesktopWithBackgroundProgressBar_description__"]');
        if (desc) {
            const tc = desc.querySelector('[class*="Meta_titleContainer__"]');
            const btn = tc && tc.querySelector('button[aria-label="Контекстное меню"]');
            if (tc && btn) {
                let n = btn;
                while (n.parentElement && n.parentElement !== tc) n = n.parentElement;
                const cap = desc.querySelector('[class*="Meta_artistCaption__"]');
                return { mode: 'bar', parent: tc, after: n, cls: cap ? cap.className : '' };
            }
        }
        return null;
    }

    function ymdAsStyleLabel(el, h) {
        el.textContent = '';
        el.dataset.mode = h.mode;
        const dot = document.createElement('span');
        dot.setAttribute('data-dot', '1');
        dot.textContent = '●';
        dot.style.cssText = 'flex:0 0 auto;font-size:.7em;margin-right:.4em;';
        const txt = document.createElement('span');
        txt.setAttribute('data-txt', '1');
        if (h.cls) txt.className = h.cls;
        txt.style.cssText = 'flex:0 1 auto!important;width:auto!important;font-size:14px!important;line-height:1.3!important;opacity:.85;';
        el.style.cssText = h.mode === 'vibe'
            ? 'display:flex;align-items:center;justify-content:center;flex:0 0 100%;width:100%;pointer-events:none;'
            : h.mode === 'full'
            ? 'display:flex;align-items:center;justify-content:center;width:100%;margin-top:.5rem;white-space:nowrap;pointer-events:none;'
            : 'display:inline-flex;align-items:center;margin-left:.5rem;flex-shrink:0;white-space:nowrap;pointer-events:none;';
        el.appendChild(dot);
        el.appendChild(txt);
    }

    function ymdAsPaintLabel(el) {
        const dot = el.querySelector('[data-dot]'), txt = el.querySelector('[data-txt]');
        if (!dot || !txt) return;
        if (txt.textContent !== asStatus) txt.textContent = asStatus;
        const flashing = !!asFlashTimer;
        dot.style.color = flashing ? '#0f0' : (asSaved ? '' : ymdAsColor(asLast));
        txt.style.color = flashing ? '#0f0' : '';
    }

    function ymdAsPlaceLabel() {
        let el = document.getElementById('ymd-as-label');
        if (!ymdAsLabelOn()) { if (el) el.remove(); return; }
        if (!document.body) return;
        const h = ymdAsLabelHost();
        if (!h) { if (el) el.remove(); return; }
        if (!el) { el = document.createElement('div'); el.id = 'ymd-as-label'; }
        const sig = h.mode + '|' + (h.cls || '');
        if (el.dataset.sig !== sig) { el.dataset.sig = sig; ymdAsStyleLabel(el, h); }
        if (h.mode === 'vibe') {
            h.parent.style.flexWrap = 'wrap';
            h.parent.style.alignContent = 'center';
            h.parent.style.rowGap = '2px';
            if (el.parentElement !== h.parent) h.parent.appendChild(el);
        } else if (el.parentElement !== h.parent || el.previousElementSibling !== h.after) h.after.after(el);
        ymdAsPaintLabel(el);
    }

    function ymdAsRenderLabel(flash = false) {
        if (flash) {
            if (asFlashTimer) clearTimeout(asFlashTimer);
            asFlashTimer = setTimeout(() => { asFlashTimer = null; ymdAsPlaceLabel(); }, 1000);
        }
        ymdAsPlaceLabel();
    }

    function ymdPlUnwrap(d) {
        return (d && typeof d === 'object' && !Array.isArray(d) && d.result !== undefined) ? d.result : d;
    }
    function ymdPlBaseHeaders() {
        const h = { 'X-Yandex-Music-Client': 'YandexMusicDesktopAppWindows/' + getVersion() };
        const token = getOAuthToken();
        if (token) h['Authorization'] = token;
        return h;
    }
    function ymdPlNewHeaders() {
        return Object.assign(ymdPlBaseHeaders(), {
            'X-Yandex-Music-Frontend': 'new',
            'X-Yandex-Music-Without-Invocation-Info': '1'
        });
    }
    async function ymdPlUid(h) {
        const tok = String(getOAuthToken() || '').slice(-12);
        try {
            const saved = JSON.parse(GM_getValue('ymd_pl_uid', 'null'));
            if (saved && saved.t === tok && saved.uid) return String(saved.uid);
        } catch (e) {}
        const d = ymdPlUnwrap(await gmJSON(API_BASE + '/account/status', h));
        const uid = d && d.account && d.account.uid;
        if (!uid) throw new Error('не удалось определить uid аккаунта');
        GM_setValue('ymd_pl_uid', JSON.stringify({ t: tok, uid: String(uid) }));
        return String(uid);
    }
    function ymdPlReadCache() {
        try {
            const c = JSON.parse(GM_getValue('ymd_pl_cache', 'null'));
            if (c && c.uid && c.lists && typeof c.lists === 'object') return c;
        } catch (e) {}
        return { uid: null, lists: {} };
    }
    function ymdPlBuildMap(lists) {
        const map = new Map();
        for (const k of Object.keys(lists)) {
            if (k === '3') continue;
            const pl = lists[k];
            for (const id of pl.ids || []) {
                const a = map.get(id);
                if (a) a.push(pl.title); else map.set(id, [pl.title]);
            }
        }
        return map;
    }
    async function ymdPlLoad() {
        const base = ymdPlBaseHeaders();
        const uid = await ymdPlUid(base);
        let cache = ymdPlReadCache();
        if (cache.uid !== uid) cache = { uid: uid, lists: {} };
        const raw = ymdPlUnwrap(await gmJSON(API_BASE + '/users/' + uid + '/playlists/list', base));
        const lists = Array.isArray(raw) ? raw : [];
        const next = {};
        const todo = [];
        for (const p of lists) {
            const kind = String(p.kind);
            if (YMD_PL_SKIP.has(kind)) continue;
            const title = p.title || ('Плейлист ' + kind);
            const rev = p.revision === undefined ? String(Date.now()) : p.revision + ':' + p.trackCount;
            const old = cache.lists[kind];
            if (old && old.rev === rev) next[kind] = { rev: rev, title: title, ids: old.ids };
            else todo.push({ kind: kind, rev: rev, title: title });
        }
        const full = ymdPlNewHeaders();
        for (let i = 0; i < todo.length; i += 4) {
            await Promise.all(todo.slice(i, i + 4).map(async (p) => {
                try {
                    const d = ymdPlUnwrap(await gmJSON(API_BASE + '/users/' + uid + '/playlists/' + p.kind + '?resumeStream=false&richTracks=false', full));
                    const tr = (d && d.tracks) || [];
                    next[p.kind] = {
                        rev: p.rev,
                        title: p.title,
                        ids: tr.map(t => String(t.id || t.trackId || (t.track && t.track.id) || '').split(':')[0]).filter(Boolean)
                    };
                } catch (err) {
                    console.warn('[YMD] плейлист ' + p.kind, err);
                    const old = cache.lists[p.kind];
                    if (old) next[p.kind] = { rev: old.rev, title: p.title, ids: old.ids };
                }
            }));
        }
        try {
            const ld = ymdPlUnwrap(await gmJSON(API_BASE + '/users/' + uid + '/likes/tracks', full));
            const lib = (ld && ld.library) || ld || {};
            const lt = Array.isArray(lib.tracks) ? lib.tracks : [];
            next['3'] = {
                rev: String(lib.revision === undefined ? Date.now() : lib.revision) + ':' + lt.length,
                title: 'Мне нравится',
                ids: lt.map(t => String((t && (t.id || t.trackId)) || '').split(':')[0]).filter(Boolean)
            };
        } catch (err) {
            console.warn('[YMD] мне нравится', err);
            const old = cache.lists['3'];
            if (old) next['3'] = old;
        }
        try { GM_setValue('ymd_pl_cache', JSON.stringify({ uid: uid, lists: next })); } catch (e) {}
        return ymdPlBuildMap(next);
    }
    async function ymdPlEnsure(force) {
        if (plLoading) return plLoading;
        if (!force && Date.now() - plLoadedAt < YMD_PL_TTL) return;
        plLoading = (async () => {
            try {
                plMap = await ymdPlLoad();
                plLoadedAt = Date.now();
            } catch (err) {
                console.warn('[YMD] плейлисты:', err);
                plLoadedAt = Date.now() - YMD_PL_TTL + 30000;
            }
        })();
        await plLoading;
        plLoading = null;
        plNames = ymdPlNamesFor(plCurIds);
        ymdPlPlaceLabel();
    }

    function ymdPlCurrentId(want) {
        const find = (sel) => {
            for (const root of document.querySelectorAll(sel)) {
                if (!root.getClientRects().length) continue;
                const a = root.matches('a:is([href*="/track/"],[href*="trackId="])') ? root : root.querySelector('a:is([href*="/track/"],[href*="trackId="])');
                const m = a && a.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
                if (m) {
                    if (want && !(root.textContent || '').toLowerCase().includes(want)) continue;
                    return m[1];
                }
            }
            return null;
        };
        const full = '[class*="FullscreenPlayerDesktopContent_meta__"]';
        const vibe = '[class*="VibePlayerBar"], [class*="VibePlayerbarMeta"], [class*="VibePage_playerBlock"]';
        const bar = '[class*="PlayerBarDesktopWithBackgroundProgressBar_info__"]';
        const host = ymdAsLabelHost();
        const order = host && host.mode === 'vibe' ? [vibe, full, bar] : [full, bar, vibe];
        for (const sel of order) {
            const id = find(sel);
            if (id) return id;
        }
        return null;
    }

    function ymdPlNamesFor(ids) {
        const out = [];
        for (const id of ids) for (const n of plMap.get(id) || []) if (!out.includes(n)) out.push(n);
        return out;
    }

    function ymdPlMeta() {
        const text = (el) => (el && el.textContent || '').trim();
        let title = text(document.querySelector('[class*="VibePlayerbarMeta_trackNameText"]'));
        let artist = text(document.querySelector('[class*="VibePlayerbarMeta_artistText"]'));
        if (!title) {
            try {
                const md = navigator.mediaSession && navigator.mediaSession.metadata;
                if (md && md.title) { title = String(md.title).trim(); artist = String(md.artist || '').trim(); }
            } catch (e) {}
        }
        return title ? { key: artist + '\u0001' + title, title: title, artist: artist } : null;
    }

    async function ymdPlResolve(meta) {
        if (plSearching.has(meta.key)) return;
        plSearching.add(meta.key);
        const ids = [];
        try {
            const q = meta.artist ? meta.artist + ' ' + meta.title : meta.title;
            const d = ymdPlUnwrap(await gmJSON(API_BASE + '/search?text=' + encodeURIComponent(q) + '&type=track&page=0&pageSize=10', ymdPlNewHeaders()));
            const res = (d && d.tracks && d.tracks.results) || [];
            const t = meta.title.toLowerCase(), a = meta.artist.toLowerCase();
            for (const tr of res) {
                const rt = String(tr.title || '').toLowerCase();
                if (!rt || !(rt === t || t.startsWith(rt))) continue;
                const names = (tr.artists || []).map(x => String((x && x.name) || '').toLowerCase()).filter(Boolean);
                if (a && names.length && !names.some(n => a.includes(n))) continue;
                ids.push(String(tr.id).split(':')[0]);
            }
        } catch (err) { console.warn('[YMD] поиск трека для плейлиста:', err); }
        plSearching.delete(meta.key);
        plSearch.set(meta.key, ids);
        if (plSearch.size > 200) plSearch.delete(plSearch.keys().next().value);
    }

    function ymdPlText(mode) {
        const q = (n) => '«' + n + '»';
        const n = plNames.length;
        let t;
        if (n === 1) t = 'В ' + q(plNames[0]);
        else if (n === 2) t = 'В ' + q(plNames[0]) + ', ' + q(plNames[1]);
        else t = 'В ' + q(plNames[0]) + ', ' + q(plNames[1]) + ' и в ' + (n - 2);
        return (mode === 'bar' || mode === 'inline') ? '(' + t + ')' : t;
    }

    function ymdPlStyleLabel(el, h, mode) {
        el.textContent = '';
        const txt = document.createElement('span');
        txt.setAttribute('data-txt', '1');
        if (h.cls) txt.className = h.cls;
        txt.style.cssText = 'flex:0 1 auto!important;width:auto!important;min-width:0;font-size:14px!important;line-height:1.3!important;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:' + (mode === 'bar' ? '22em' : mode === 'inline' ? '24em' : '32em') + ';';
        el.style.cssText = mode === 'inline'
            ? 'display:inline-flex;align-items:center;min-width:0;margin-left:.4em;white-space:nowrap;pointer-events:auto;'
            : mode === 'vibe'
            ? 'display:flex;align-items:center;justify-content:center;flex:0 0 100%;width:100%;min-width:0;'
            : mode === 'full'
            ? 'display:flex;align-items:center;justify-content:center;width:100%;min-width:0;margin-top:.25rem;white-space:nowrap;'
            : 'display:inline-flex;align-items:center;min-width:0;margin-left:.5rem;flex-shrink:1;white-space:nowrap;';
        el.appendChild(txt);
    }

    function ymdPlPlaceLabel() {
        let el = document.getElementById('ymd-pl-label');
        if (!ymdPlOn() || !plNames.length) { if (el) el.remove(); return; }
        if (!document.body) return;
        const h = ymdAsLabelHost();
        if (!h) { if (el) el.remove(); return; }
        if (!el) { el = document.createElement('div'); el.id = 'ymd-pl-label'; }
        const asEl = document.getElementById('ymd-as-label');
        const asHere = !!(asEl && asEl.parentElement === h.parent);
        const mode = ((h.mode === 'full' || h.mode === 'vibe') && asHere) ? 'inline' : h.mode;
        const sig = mode + '|' + (h.cls || '');
        if (el.dataset.sig !== sig) { el.dataset.sig = sig; ymdPlStyleLabel(el, h, mode); }
        const txt = el.querySelector('[data-txt]');
        const text = ymdPlText(mode);
        if (txt && txt.textContent !== text) txt.textContent = text;
        const tip = 'Плейлисты: ' + plNames.join(', ');
        if (el.title !== tip) el.title = tip;
        if (mode === 'inline') {
            if (el.parentElement !== asEl) asEl.appendChild(el);
        } else if (h.mode === 'vibe') {
            h.parent.style.flexWrap = 'wrap';
            h.parent.style.alignContent = 'center';
            h.parent.style.rowGap = '2px';
            if (asHere) {
                if (el.previousElementSibling !== asEl) asEl.after(el);
            } else if (el.parentElement !== h.parent) h.parent.appendChild(el);
        } else {
            const anchor = asHere ? asEl : h.after;
            if (anchor && (el.parentElement !== h.parent || el.previousElementSibling !== anchor)) anchor.after(el);
        }
    }

    async function ymdPlTick() {
        if (!ymdPlOn()) {
            if (plCurSig || plNames.length) { plCurIds = []; plCurSig = ''; plNames = []; }
            ymdPlPlaceLabel();
            return;
        }
        let ids = [];
        const id = ymdPlCurrentId();
        if (id) ids = [id];
        else {
            const meta = ymdPlMeta();
            if (meta) {
                if (plSearch.has(meta.key)) ids = plSearch.get(meta.key);
                else ymdPlResolve(meta);
            }
        }
        const sig = ids.join(',');
        if (sig !== plCurSig) {
            plCurIds = ids;
            plCurSig = sig;
            plNames = ymdPlNamesFor(ids);
            ymdPlPlaceLabel();
        }
        if (Date.now() - plLoadedAt >= YMD_PL_TTL) ymdPlEnsure(false);
    }

    function ymdPlApply() {
        plCurIds = [];
        plCurSig = '';
        plNames = [];
        if (ymdPlOn()) {
            plLoadedAt = 0;
            ymdPlEnsure(true).then(ymdPlTick);
        }
        ymdPlTick();
    }

    function ymdPlInit() {
        const c = ymdPlReadCache();
        plMap = ymdPlBuildMap(c.lists);
        if (!plTimer) plTimer = setInterval(ymdPlTick, 1000);
    }

    function ymdAsCheckSkip() {
        if (asTimer) { clearTimeout(asTimer); asTimer = null; }
        if (!asReady || asSaved || !ymdAsOn() || !asLast || Math.floor((Date.now() - asLast) / 86400000) > ymdAsDays()) {
            asChecks = 21;
            return;
        }
        if (!asAudio || isNaN(asTime) || asTime < 0.05) { asTimer = setTimeout(ymdAsCheckSkip, 50); return; }
        if (asAudio.currentTime >= asAudio.duration - 0.1) return;
        const delay = asSkips > 10 ? Math.random() * 283 + 641 : Math.random() * 127 + 164;
        asTimer = setTimeout(() => {
            asChecks++;
            if (asChecks > 1) { asMethod++; if (asMethod > 3) asMethod = 1; }
            const next = document.querySelector('[aria-label="Следующая песня"]') ||
                         document.querySelector('[aria-label="Next song"]') ||
                         document.querySelector('[aria-label="Keyingi tarona"]') ||
                         document.querySelector('[aria-label="Келесі ән"]');
            if (asMethod === 1 && !next) asMethod++;
            if (asMethod === 1) next.click();
            else if (asMethod === 2) {
                const ev = { key: 'n', code: 'KeyN', keyCode: 78, which: 78, bubbles: true, cancelable: true };
                win.dispatchEvent(new win.KeyboardEvent('keyup', ev));
                setTimeout(() => {
                    win.dispatchEvent(new win.KeyboardEvent('keydown', ev));
                    setTimeout(() => win.dispatchEvent(new win.KeyboardEvent('keyup', ev)), Math.random() * 30 + 60);
                }, 15);
            } else if (asAudio && asAudio.duration > 0) asAudio.currentTime = asAudio.duration - 0.1;
            asTimer = setTimeout(() => { asTimer = null; }, 300);
        }, delay);
    }

    async function ymdAsInPlaylist(title, artist, key) {
        try {
            const loading = ymdPlEnsure(false);
            let sel = ymdAsSelIds();
            if (!sel.size) { await loading; sel = ymdAsSelIds(); }
            if (!sel.size) return false;
            const want = String(title || '').trim().toLowerCase();
            for (let i = 0; i < 8; i++) {
                if (key !== asNewKey) return false;
                const id = ymdPlCurrentId(want);
                if (id) return sel.has(id);
                await sleep(50);
            }
            if (!title) return false;
            const meta = { key: artist + '\u0001' + title, title: title, artist: artist };
            if (!plSearch.has(meta.key)) await ymdPlResolve(meta);
            return (plSearch.get(meta.key) || []).some(i => sel.has(i));
        } catch (err) {
            console.warn('[YMD] автоскип: проверка плейлистов', err);
            return false;
        }
    }

    async function ymdAsOnTrack(force = false) {
        if (!ymdAsActive()) return;
        if (asNewKey === asKey && !force) return;
        if (asTimer) { clearTimeout(asTimer); asTimer = null; }
        if (!asDb) {
            asLast = null;
            asStatus = 'Играет впервые';
            ymdAsRenderLabel();
            ymdAsOpenDb();
            return;
        }
        const key = asNewKey;
        asKey = key;
        asSaved = false;
        asReady = false;
        const ts = await ymdAsGetTs(key);
        if (key !== asNewKey) return;
        if (ts) {
            asLast = ts;
            asStatus = 'Играл ' + (ymdAsAgo(ts) || 'только что');
            if (Math.floor((Date.now() - ts) / 86400000) <= ymdAsDays() && ymdAsOn()) {
                let keep = false;
                if (ymdAsPlKeepOn()) {
                    ymdAsRenderLabel();
                    keep = await ymdAsInPlaylist(asNewTitle, asNewArtist, key);
                    if (key !== asNewKey) return;
                }
                if (keep) { asSkips = 0; asChecks = 21; }
                else {
                    asReady = true;
                    asChecks = 0;
                    ymdAsCheckSkip();
                    asSkips++;
                }
            } else { asSkips = 0; asChecks = 21; }
        } else {
            asLast = null;
            asStatus = 'Играет впервые';
            asSkips = 0;
            asChecks = 21;
        }
        ymdAsRenderLabel();
    }

    const ymdVerCache = new Map();

    function ymdCurrentTrackId() {
        try {
            const st = unsafeWindow.__STATE_SNAPSHOT__;
            for (const snap of (Array.isArray(st) ? st : [st])) {
                const id = snap?.sonataState?.entityMeta?.id;
                if (id) return String(id).split(':')[0];
            }
        } catch (e) {}
        try {
            const id = ymdKarTrackId();
            if (id) return String(id);
        } catch (e) {}
        return null;
    }

    async function getYandexTrackVersion(id) {
        if (!id) return '';
        if (ymdVerCache.has(id)) return ymdVerCache.get(id);
        try {
            const t = (await getTracksInfo([id]))[0];
            const v = t && t.version ? String(t.version).trim() : '';
            ymdVerCache.set(id, v);
            return v;
        } catch (e) {
            return '';
        }
    }

    function ymdAsOnMeta(md) {
        if (!md || !md.title) return;
        setTimeout(async () => {
            let title = String(md.title);
            const artist = md.artist || '';
            asNewTitle = title;
            asNewArtist = String(artist);
            const v = await getYandexTrackVersion(ymdCurrentTrackId());
            const cur = navigator.mediaSession && navigator.mediaSession.metadata;
            if (cur && cur !== md) return;
            if (v && !title.toLowerCase().includes(v.toLowerCase())) title = title + ' (' + v + ')';
            asNewKey = artist ? artist + ' — ' + title : title;
            if (asNewKey !== asKey) {
                asReady = false;
                asTime = 0;
                ymdAsOnTrack();
            }
        }, 0);
    }

    function ymdAsBindAudio(audio) {
        if (!audio) return;
        asAudio = audio;
        if (asBound.has(audio)) return;
        asBound.add(audio);
        let lastSec = -1;
        audio.addEventListener('timeupdate', () => {
            if (audio !== asAudio) return;
            asTime = audio.currentTime;
            if (asSaved || !ymdAsActive()) return;
            const sec = Math.floor(asTime);
            if (sec === lastSec && asChecks > 20) return;
            lastSec = sec;
            const dur = audio.duration;
            if (!(dur > 0)) return;
            if (asChecks <= 20 && !asTimer) ymdAsCheckSkip();
            const mid = dur / 2;
            if (asTime >= mid && asTime <= mid + 5 && asKey) {
                const rec = ymdAsRecOn();
                if (rec && asDb) {
                    try {
                        const tx = asDb.transaction(['history'], 'readwrite');
                        tx.objectStore('history').put(Date.now(), asKey);
                        tx.oncomplete = ymdAsTrim;
                    } catch (e) {}
                }
                asSaved = true;
                ymdAsRenderLabel(rec);
            }
        });
    }

    function ymdAsInstall() {
        if (asInstalled || !ymdAsActive()) return;
        asInstalled = true;
        ymdAsOpenDb();
        try {
            const proto = win.HTMLMediaElement.prototype;
            if (!proto.__ymdAsPatched) {
                const orig = proto.play;
                proto.play = function () { try { ymdAsBindAudio(this); } catch (e) {} return orig.apply(this, arguments); };
                proto.__ymdAsPatched = true;
            }
            document.querySelectorAll('audio').forEach(a => { try { if (!a.paused) ymdAsBindAudio(a); } catch (e) {} });
        } catch (e) { console.warn('[YMD] автоскип: хук audio', e); }
        (async () => {
            for (let i = 0; i < 600; i++) {
                if (typeof win.MediaSession !== 'undefined' && win.navigator.mediaSession) break;
                await sleep(100);
            }
            try {
                const proto = win.MediaSession && win.MediaSession.prototype;
                const desc = proto && Object.getOwnPropertyDescriptor(proto, 'metadata');
                if (desc && desc.set && !desc.set.__ymdAs) {
                    const origSet = desc.set;
                    const wrapped = function (md) { origSet.call(this, md); try { ymdAsOnMeta(md); } catch (e) {} };
                    wrapped.__ymdAs = true;
                    Object.defineProperty(proto, 'metadata', { get: desc.get, set: wrapped, configurable: true, enumerable: desc.enumerable });
                }
                const cur = win.navigator.mediaSession && win.navigator.mediaSession.metadata;
                if (cur) ymdAsOnMeta(cur);
            } catch (e) { console.warn('[YMD] автоскип: хук mediaSession', e); }
        })();
    }

    function ymdAsRecheck() {
        clearTimeout(asRecheckTimer);
        asRecheckTimer = setTimeout(() => {
            if (!ymdAsActive()) {
                if (asTimer) { clearTimeout(asTimer); asTimer = null; }
                ymdAsRenderLabel();
                return;
            }
            ymdAsInstall();
            ymdAsRenderLabel();
            if (!asSaved && asNewKey) ymdAsOnTrack(true);
        }, 150);
    }

    async function ymdAsExport() {
        const db = await ymdAsDbReady();
        if (!db) { ymdToast(true, ['База истории недоступна']); return; }
        const rows = [];
        let readErr = null;
        try {
            await new Promise((resolve) => {
                const req = db.transaction(['history'], 'readonly').objectStore('history').openCursor();
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (!c) return resolve();
                    const v = (c.value !== null && typeof c.value === 'object') ? NaN : Number(c.value);
                    if (c.key && Number.isFinite(v)) rows.push(JSON.stringify(c.key) + ':' + v);
                    c.continue();
                };
                req.onerror = () => { readErr = req.error; resolve(); };
            });
        } catch (err) { readErr = err; }
        if (readErr) {
            console.error('[YMD] экспорт истории', readErr);
            ymdToast(true, ['Не удалось экспортировать историю', String(readErr && readErr.message || readErr || '')].filter(Boolean));
            return;
        }
        if (!rows.length) { ymdToast(true, ['История прослушиваний пуста', 'Экспортировать нечего.']); return; }
        const url = URL.createObjectURL(new Blob(['\uFEFF{\n', rows.join(',\n'), '\n}'], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'yandex_music_history.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        ymdToast(false, ['История прослушиваний экспортирована', 'Записей: ' + rows.length + '.', 'Файл: yandex_music_history.json']);
    }

    async function ymdAsClear() {
        const db = await ymdAsDbReady();
        if (!db) { ymdToast(true, ['База истории недоступна']); return; }
        let total = null;
        try {
            total = await new Promise((resolve) => {
                const r = db.transaction(['history'], 'readonly').objectStore('history').count();
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => resolve(null);
            });
        } catch (e) {}
        const ok = await ymdDialog({
            title: 'Очистить историю прослушиваний?',
            lines: [total !== null ? 'Будет удалено записей: ' + total + '.' : 'Все записи будут удалены.'],
            sub: 'Это действие нельзя отменить. Перед очисткой можно сделать экспорт.',
            okLabel: 'Очистить',
            cancelLabel: 'Отмена'
        });
        if (!ok) return;
        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['history'], 'readwrite');
                tx.objectStore('history').clear();
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
            if (asTimer) { clearTimeout(asTimer); asTimer = null; }
            asLast = null;
            asReady = false;
            asChecks = 21;
            asStatus = 'Играет впервые';
            ymdAsUpdateCount();
            ymdAsRenderLabel();
            ymdToast(false, ['История прослушиваний очищена', total !== null ? 'Удалено записей: ' + total + '.' : 'Все записи удалены.']);
        } catch (err) {
            console.error('[YMD] очистка истории', err);
            ymdToast(true, ['Не удалось очистить историю', String(err && err.message || err || '')].filter(Boolean));
        }
    }

    async function ymdAsUpdateCount() {
        const el = document.querySelector('[data-role="as-count"]');
        if (!el) return;
        const db = await ymdAsDbReady();
        if (!db) { el.textContent = ''; return; }
        try {
            const r = db.transaction(['history'], 'readonly').objectStore('history').count();
            r.onsuccess = () => { el.textContent = 'Записей в истории: ' + r.result; };
        } catch (e) {}
    }

    async function ymdAsImport(ev) {
        const input = ev.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        const db = await ymdAsDbReady();
        if (!db) { ymdToast(true, ['База истории недоступна']); return; }
        try {
            let text = await file.text();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const obj = JSON.parse(text);
            const entries = Object.entries(obj).filter(([k, v]) => k && Number.isFinite(Number(v)));
            const CH = 2000;
            let updated = 0;
            for (let i = 0; i < entries.length; i += CH) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(['history'], 'readwrite');
                    const st = tx.objectStore('history');
                    for (const [k, v] of entries.slice(i, i + CH)) {
                        const val = Number(v);
                        const g = st.get(k);
                        g.onsuccess = () => {
                            const cur = g.result ? Number(g.result) : 0;
                            if (val > cur) { st.put(val, k); updated++; }
                        };
                    }
                    tx.oncomplete = resolve;
                    tx.onerror = tx.onabort = () => reject(tx.error);
                });
            }
            ymdToast(false, ['История прослушиваний импортирована',
                'Записей в файле: ' + entries.length + '.',
                'Добавлено или обновлено: ' + updated + '.',
                'Файл: ' + file.name]);
            try { await ymdAsTrim(); } catch (e) { console.warn('[YMD] автоскип: обрезка после импорта', e); }
            try { ymdAsUpdateCount(); ymdAsRecheck(); } catch (e) { console.warn('[YMD] автоскип: обновление после импорта', e); }
        } catch (err) {
            console.error('[YMD] импорт истории', err);
            ymdToast(true, ['Не удалось импортировать файл истории', String(err && err.message || err || ''), 'Файл: ' + file.name].filter(Boolean));
        }
    }

    const YMD_CFG_SKIP = new Set([...YMD_KEEP_ON_RESET, 'ymd_pl_cache', 'ymd_pl_uid']);

    function ymdCfgDownload(name, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }


    const YMD_BK_FMTS = [
        { key: 'json', title: 'JSON (для импорта)', ext: 'json' },
        { key: 'csv',  title: 'CSV (таблица)',      ext: 'csv'  },
        { key: 'm3u',  title: 'M3U8 (список)',      ext: 'm3u8' }
    ];
    const YMD_BK_ARROW = '<svg class="ymd-qsel-arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    let ymdBkBusy = false;

    function ymdBkSelected() {
        try {
            const a = JSON.parse(GM_getValue('ymd_bk_pl_sel', '[]'));
            return Array.isArray(a) ? a.map(String) : [];
        } catch (e) { return []; }
    }
    function ymdBkLabelText() {
        const sel = ymdBkSelected();
        const lists = ymdPlReadCache().lists;
        const n = Object.keys(lists).length ? sel.filter(k => lists[k]).length : sel.length;
        return n ? 'Выбрано: ' + n : 'Не выбрано';
    }
    function ymdBkFmt() {
        const k = GM_getValue('ymd_bk_fmt', 'json');
        return YMD_BK_FMTS.find(f => f.key === k) || YMD_BK_FMTS[0];
    }

    function ymdBkDownload(name, text, mime) {
        const url = URL.createObjectURL(new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function ymdBkSafeName(t) {
        return String(t || 'playlist').replace(/[\\\/:*?"<>|\x00-\x1f]+/g, '_').trim().slice(0, 80) || 'playlist';
    }

    function ymdBkPost(url, form) {
        const h = Object.assign(ymdPlBaseHeaders(), { 'Content-Type': 'application/x-www-form-urlencoded' });
        const body = Object.keys(form).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(form[k])).join('&');
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url, headers: h, data: body, timeout: 30000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) {
                        try { resolve(ymdPlUnwrap(JSON.parse(res.responseText))); } catch (e) { resolve(null); }
                    } else reject(new Error('HTTP ' + res.status + ': ' + (res.responseText || '').slice(0, 200)));
                },
                ontimeout: () => reject(new Error('Превышено время ожидания')),
                onerror: () => reject(new Error('Сетевая ошибка'))
            });
        });
    }

    async function ymdBkTrackInfo(pairs) {
        const out = new Map();
        for (let i = 0; i < pairs.length; i += 100) {
            try {
                const r = await ymdBkPost(API_BASE + '/tracks', { 'track-ids': pairs.slice(i, i + 100).join(','), 'with-positions': 'False' });
                for (const t of (Array.isArray(r) ? r : [])) if (t && t.id !== undefined) out.set(String(t.id).split(':')[0], t);
            } catch (e) { console.warn('[YMD] /tracks', e); }
        }
        return out;
    }

    function ymdBkNormTrack(ref, t) {
        const id = String(ref.id !== undefined ? ref.id : (t && t.id)).split(':')[0];
        const alb = (t && Array.isArray(t.albums) && t.albums[0]) || null;
        const albumId = (ref.albumId !== undefined && ref.albumId !== null && ref.albumId !== '') ? String(ref.albumId) : (alb && alb.id !== undefined ? String(alb.id) : '');
        return {
            id: id,
            albumId: albumId,
            title: t ? ((t.title || '') + (t.version ? ' (' + t.version + ')' : '')) : '',
            artists: (t && Array.isArray(t.artists)) ? t.artists.map(a => a && a.name).filter(Boolean) : [],
            album: alb ? (alb.title || '') : '',
            durationMs: (t && Number.isFinite(t.durationMs)) ? t.durationMs : 0,
            addedAt: ref.timestamp || ''
        };
    }

    async function ymdBkFetchList(uid, kind) {
        const full = ymdPlNewHeaders();
        if (kind === '3') {
            const ld = ymdPlUnwrap(await gmJSON(API_BASE + '/users/' + uid + '/likes/tracks', full));
            const lib = (ld && ld.library) || ld || {};
            const refs = Array.isArray(lib.tracks) ? lib.tracks : [];
            const info = await ymdBkTrackInfo(refs.map(r => r.albumId ? r.id + ':' + r.albumId : String(r.id)));
            return {
                kind: '3', title: 'Мне нравится', isLikes: true, visibility: '', description: '',
                tracks: refs.map(r => ymdBkNormTrack(r, info.get(String(r.id).split(':')[0])))
            };
        }
        const d = ymdPlUnwrap(await gmJSON(API_BASE + '/users/' + uid + '/playlists/' + kind + '?resumeStream=false&richTracks=true', full));
        const items = (d && d.tracks) || [];
        const rows = items.map(it => ({
            ref: { id: it.id !== undefined ? it.id : (it.track && it.track.id), albumId: it.albumId, timestamp: it.timestamp },
            t: it.track || null
        })).filter(r => r.ref.id !== undefined && r.ref.id !== null);
        const missing = rows.filter(r => !r.t).map(r => r.ref.albumId ? r.ref.id + ':' + r.ref.albumId : String(r.ref.id));
        if (missing.length) {
            const info = await ymdBkTrackInfo(missing);
            for (const r of rows) if (!r.t) r.t = info.get(String(r.ref.id).split(':')[0]) || null;
        }
        return {
            kind: String(kind),
            title: (d && d.title) || ('Плейлист ' + kind),
            isLikes: false,
            visibility: (d && d.visibility) || '',
            description: (d && d.description) || '',
            tracks: rows.map(r => ymdBkNormTrack(r.ref, r.t))
        };
    }

    function ymdBkCsv(lists) {
        const q = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
        const out = [['playlist', 'position', 'artist', 'title', 'album', 'duration_sec', 'track_id', 'album_id', 'url'].map(q).join(',')];
        for (const pl of lists) {
            pl.tracks.forEach((t, i) => out.push([
                pl.title, i + 1, t.artists.join(', '), t.title, t.album, Math.round((t.durationMs || 0) / 1000), t.id, t.albumId,
                t.albumId ? 'https://music.yandex.ru/album/' + t.albumId + '/track/' + t.id : 'https://music.yandex.ru/track/' + t.id
            ].map(q).join(',')));
        }
        return '\uFEFF' + out.join('\r\n');
    }
    function ymdBkM3u(pl) {
        const out = ['#EXTM3U', '#PLAYLIST:' + pl.title];
        for (const t of pl.tracks) {
            const name = (t.artists.length ? t.artists.join(', ') + ' - ' : '') + (t.title || ('Трек ' + t.id));
            out.push('#EXTINF:' + (Math.round((t.durationMs || 0) / 1000) || -1) + ',' + name.replace(/[\r\n]+/g, ' '));
            out.push(t.albumId ? 'https://music.yandex.ru/album/' + t.albumId + '/track/' + t.id : 'https://music.yandex.ru/track/' + t.id);
        }
        return '\uFEFF' + out.join('\n');
    }

    async function ymdBkExport() {
        if (ymdBkBusy) return;
        if (!getOAuthToken()) { ymdToast(true, ['Нет токена', 'Для экспорта плейлистов нужен токен.']); return; }
        const sel = ymdBkSelected();
        if (!sel.length) { ymdToast(true, ['Плейлисты не выбраны', 'Выберите плейлисты в списке выше.']); return; }
        ymdBkBusy = true;
        try {
            await ymdPlEnsure(false);
            const cached = ymdPlReadCache().lists;
            const kinds = sel.filter(k => cached[k]);
            if (!kinds.length) { ymdToast(true, ['Выбранные плейлисты не найдены', 'Откройте список и выберите заново.']); return; }
            const uid = await ymdPlUid(ymdPlBaseHeaders());
            const lists = [];
            for (let i = 0; i < kinds.length; i++) {
                ymdToast(false, ['Экспорт плейлистов', (i + 1) + ' из ' + kinds.length + ': ' + cached[kinds[i]].title]);
                lists.push(await ymdBkFetchList(uid, kinds[i]));
            }
            const fmt = ymdBkFmt();
            const day = new Date().toISOString().slice(0, 10);
            const total = lists.reduce((n, l) => n + l.tracks.length, 0);
            if (fmt.key === 'json') {
                let ver = '';
                try { ver = GM_info.script.version; } catch (e) {}
                const out = { ymdPlaylists: 1, scriptVersion: ver, exportedAt: new Date().toISOString(), playlists: lists };
                ymdBkDownload(lists.length === 1 ? ymdBkSafeName(lists[0].title) + '.json' : 'yandex_music_playlists_' + day + '.json', JSON.stringify(out, null, 2));
            } else if (fmt.key === 'csv') {
                ymdBkDownload(lists.length === 1 ? ymdBkSafeName(lists[0].title) + '.csv' : 'yandex_music_playlists_' + day + '.csv', ymdBkCsv(lists), 'text/csv');
            } else {
                for (let i = 0; i < lists.length; i++) {
                    ymdBkDownload(ymdBkSafeName(lists[i].title) + '.m3u8', ymdBkM3u(lists[i]), 'audio/x-mpegurl');
                    if (i < lists.length - 1) await sleep(400);
                }
            }
            ymdToast(false, ['Плейлисты экспортированы', 'Плейлистов: ' + lists.length + ', треков: ' + total + '.']);
        } catch (err) {
            console.error('[YMD] экспорт плейлистов', err);
            ymdToast(true, ['Не удалось экспортировать плейлисты', String(err && err.message || err || '')].filter(Boolean));
        } finally {
            ymdBkBusy = false;
        }
    }

    async function ymdBkImport(ev) {
        const input = ev.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file || ymdBkBusy) return;
        if (!getOAuthToken()) { ymdToast(true, ['Нет токена', 'Для импорта плейлистов нужен токен.']); return; }
        let data;
        try {
            let text = await file.text();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            data = JSON.parse(text);
        } catch (err) {
            ymdToast(true, ['Не удалось прочитать файл', 'Нужен JSON из экспорта плейлистов.']);
            return;
        }
        if (!data || data.ymdPlaylists !== 1 || !Array.isArray(data.playlists)) {
            ymdToast(true, ['Это не копия плейлистов', 'Импорт принимает только JSON из экспорта плейлистов.']);
            return;
        }
        const pls = data.playlists.filter(p => p && Array.isArray(p.tracks) && p.tracks.length);
        if (!pls.length) { ymdToast(true, ['В файле нет треков']); return; }
        const total = pls.reduce((n, p) => n + p.tracks.length, 0);
        const ok = await ymdDialog({
            title: 'Импортировать плейлисты?',
            lines: ['Плейлистов: ' + pls.length + ', треков: ' + total + '.'],
            sub: 'Каждый плейлист создаётся в аккаунте заново, при повторном импорте появятся дубликаты. Треки из «Мне нравится» добавляются в лайки.',
            okLabel: 'Импортировать',
            cancelLabel: 'Отмена'
        });
        if (!ok) return;
        ymdBkBusy = true;
        let done = 0, skipped = 0, failed = 0;
        try {
            const uid = await ymdPlUid(ymdPlBaseHeaders());
            for (let i = 0; i < pls.length; i++) {
                const pl = pls[i];
                ymdToast(false, ['Импорт плейлистов', (i + 1) + ' из ' + pls.length + ': ' + (pl.title || 'без названия')]);
                const usable = pl.tracks.filter(t => t && t.id && t.albumId);
                skipped += pl.tracks.length - usable.length;
                if (!usable.length) continue;
                try {
                    if (pl.isLikes) {
                        const ordered = usable.slice().sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
                        for (let j = 0; j < ordered.length; j += 100) {
                            const chunk = ordered.slice(j, j + 100);
                            await ymdBkPost(API_BASE + '/users/' + uid + '/likes/tracks/add-multiple', { 'track-ids': chunk.map(t => t.id + ':' + t.albumId).join(',') });
                            done += chunk.length;
                            await sleep(300);
                        }
                    } else {
                        const created = await ymdBkPost(API_BASE + '/users/' + uid + '/playlists/create', {
                            title: pl.title || 'Импортированный плейлист',
                            visibility: pl.visibility === 'public' ? 'public' : 'private'
                        });
                        const kind = created && created.kind;
                        let rev = created && created.revision;
                        if (kind === undefined || rev === undefined) throw new Error('не удалось создать плейлист');
                        let at = 0;
                        for (let j = 0; j < usable.length; j += 100) {
                            const chunk = usable.slice(j, j + 100);
                            const r = await ymdBkPost(API_BASE + '/users/' + uid + '/playlists/' + kind + '/change', {
                                kind: String(kind),
                                revision: String(rev),
                                diff: JSON.stringify([{ op: 'insert', at: at, tracks: chunk.map(t => ({ id: t.id, albumId: t.albumId })) }])
                            });
                            if (r && r.revision !== undefined) rev = r.revision; else rev = Number(rev) + 1;
                            at += chunk.length;
                            done += chunk.length;
                            await sleep(300);
                        }
                    }
                } catch (err) {
                    failed++;
                    console.error('[YMD] импорт плейлиста', pl.title, err);
                }
            }
            try { await ymdPlEnsure(true); } catch (e) {}
            const lines = ['Добавлено треков: ' + done + '.'];
            if (skipped) lines.push('Пропущено без albumId: ' + skipped + '.');
            if (failed) lines.push('Плейлистов с ошибкой: ' + failed + ' (подробности в консоли).');
            ymdToast(failed > 0 && !done, [failed ? 'Импорт завершён с ошибками' : 'Плейлисты импортированы'].concat(lines));
        } catch (err) {
            console.error('[YMD] импорт плейлистов', err);
            ymdToast(true, ['Не удалось импортировать плейлисты', String(err && err.message || err || '')].filter(Boolean));
        } finally {
            ymdBkBusy = false;
        }
    }

    function ymdCfgExport() {
        const values = {};
        try {
            for (const k of GM_listValues()) {
                if (!k.startsWith('ymd_') || YMD_CFG_SKIP.has(k)) continue;
                values[k] = GM_getValue(k);
            }
        } catch (err) {
            console.error('[YMD] экспорт настроек', err);
            ymdToast(true, ['Не удалось экспортировать настройки', String(err && err.message || err || '')].filter(Boolean));
            return;
        }
        let ver = '';
        try { ver = GM_info.script.version; } catch (e) {}
        const out = { ymdSettings: 1, scriptVersion: ver, values };
        ymdCfgDownload('yandex_music_settings.json', JSON.stringify(out, null, 2));
        ymdToast(false, ['Настройки экспортированы', 'Параметров: ' + Object.keys(values).length + '.']);
    }

    async function ymdCfgImport(ev) {
        const input = ev.target;
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        try {
            let text = await file.text();
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const obj = JSON.parse(text);
            if (!obj || obj.ymdSettings !== 1 || !obj.values || typeof obj.values !== 'object') {
                throw new Error('Это не файл настроек скрипта');
            }
            let applied = 0;
            for (const [k, v] of Object.entries(obj.values)) {
                if (!k.startsWith('ymd_') || YMD_CFG_SKIP.has(k)) continue;
                GM_setValue(k, v);
                applied++;
            }
            ymdToast(false, ['Настройки импортированы', 'Параметров: ' + applied + '.', 'Страница будет перезагружена.']);
            setTimeout(() => location.reload(), 1200);
        } catch (err) {
            console.error('[YMD] импорт настроек', err);
            ymdToast(true, ['Не удалось импортировать настройки', String(err && err.message || err || ''), 'Файл: ' + file.name].filter(Boolean));
        }
    }

    ymdAsInstall();
    ymdPlInit();

    function sanitize(name) {
        return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
    }

    function formatArtists(artists) {
        const names = (artists || []).map(a => a && a.name).filter(Boolean);
        if (!names.length) return 'Unknown';
        if (names.length === 1) return names[0];
        return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
    }

    function toTitleCase(str) {
        if (!str) return str;
        return str.replace(/\S+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
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

    function ymdLocalOAuth() {
        try {
            const raw = localStorage.getItem('oauth');
            if (!raw) return null;
            let t;
            try {
                const p = JSON.parse(raw);
                t = p && typeof p === 'object' ? p.value : p;
            } catch (e) { t = raw; }
            t = typeof t === 'string' ? t.replace(OAUTH_PREFIX_RE, '').trim() : '';
            return t.length > 20 ? t : null;
        } catch (e) { return null; }
    }

    function ymdSyncLocalToken() {
        const t = ymdLocalOAuth();
        if (t && GM_getValue('ymd_oauth_token', null) !== t) GM_setValue('ymd_oauth_token', t);
        return t;
    }

    function getOAuthToken() {
        const local = ymdSyncLocalToken();
        if (local) return "OAuth " + local;
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
        if (ymdSyncLocalToken()) {
            status("✓ Токен получен! Можно качать.");
            hideStatus(3000);
            return;
        }
        const CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d";
        const authUrl = "https://oauth.yandex.ru/authorize?response_type=token&client_id=" + CLIENT_ID;
        const popup = window.open(authUrl, "ymd_oauth", "width=600,height=500,left=200,top=100");
        if (!popup) {
            if (!silent) ymdToast(true, ['Всплывающее окно заблокировано', 'Разрешите всплывающие окна для music.yandex.ru и попробуйте снова.']);
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

    async function ymdEnsureToken() {
        if (ymdSyncLocalToken() || GM_getValue('ymd_oauth_token', null)) return;
        try {
            const t = await fetchTokenFromPassport();
            if (t) { GM_setValue('ymd_oauth_token', t); return; }
        } catch (e) {}
        for (let i = 0; i < 8; i++) {
            let found = null;
            try { found = getOAuthToken(); } catch (e) {}
            if (found) return;
            await sleep(1500);
        }
        if (!GM_getValue('ymd_oauth_token', null)) showAuthBanner();
    }

    async function promptForToken() {
        const current = GM_getValue('ymd_oauth_token', '') || '';
        const input = await ymdDialog({
            title: 'Настройка токена',
            lines: [
                'Откройте ссылку и разрешите доступ:',
            ],
            link: 'https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d',
            linkText: 'oauth.yandex.ru/authorize',
            sub: 'Скопируйте access_token из адресной строки и вставьте ниже. Если вы уже авторизованы на сайте, токен подхватится автоматически при воспроизведении любого трека.',
            input: { value: current, placeholder: 'OAuth токен' },
            okLabel: 'Сохранить',
            cancelLabel: 'Отмена'
        });
        if (input === null) return;
        const cleaned = input.trim().replace(/^OAuth\s+/i, '');
        if (cleaned.length < 10) { ymdToast(true, ['Неверный токен', 'Токен слишком короткий. Скопируйте access_token целиком.']); return; }
        GM_setValue('ymd_oauth_token', cleaned);
        ymdToast(false, ['Токен сохранён', 'Обновите страницу, чтобы изменения вступили в силу.']);
    }

    function ymdResetToken() {
        GM_setValue('ymd_oauth_token', null);
        sessionStorage.removeItem('ymd_intercepted_token');
        ymdToast(false, ['Токен сброшен', 'Чтобы снова скачивать полные треки, настройте токен или получите его автоматически.']);
    }


    let ymdUpdBusy = false;

    async function ymdUpdatePrompt(info) {
        const ok = await ymdDialog({
            title: 'Доступно обновление',
            lines: ['Новая версия: ' + info.remote, 'Установлена версия: ' + info.current],
            sub: 'Скрипт будет скачан с GitHub и заменит текущий файл. После установки страница перезагрузится.',
            okLabel: 'Обновить',
            cancelLabel: 'Позже'
        });
        if (!ok) return false;
        ymdToast(false, ['Скачиваю обновление…', 'Не закрывайте приложение.']);
        try {
            const r = await win.__ymdUpdateApply();
            if (!r || !r.updated) {
                ymdToast(false, ['Обновление не требуется', 'Установлена версия ' + ((r && r.version) || info.current) + '.']);
                return false;
            }
            ymdToast(false, ['Обновление установлено', 'Версия ' + r.version + '. Страница перезагрузится…']);
            setTimeout(() => location.reload(), 1200);
            return true;
        } catch (e) {
            ymdToast(true, ['Не удалось обновить скрипт', String((e && e.message) || e)]);
            return false;
        }
    }

    async function ymdUpdateManual(btn) {
        if (ymdUpdBusy || typeof win.__ymdUpdateCheck !== 'function') return;
        ymdUpdBusy = true;
        const label = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Проверяю…'; }
        try {
            const info = await win.__ymdUpdateCheck();
            if (info && info.available) await ymdUpdatePrompt(info);
            else ymdToast(false, ['Установлена последняя версия', 'Версия ' + ((info && info.current) || '?') + ', обновлений нет.']);
        } catch (e) {
            ymdToast(true, ['Не удалось проверить обновления', String((e && e.message) || e)]);
        } finally {
            ymdUpdBusy = false;
            if (btn) { btn.disabled = false; btn.textContent = label; }
        }
    }

    function ymdUpdateOnStartup() {
        if (!ymdIsDesktopShim() || typeof win.__ymdUpdateStartup !== 'function') return;
        const run = () => setTimeout(async () => {
            try {
                const info = await win.__ymdUpdateStartup();
                if (info && info.available && !ymdUpdBusy) {
                    ymdUpdBusy = true;
                    try { await ymdUpdatePrompt(info); } finally { ymdUpdBusy = false; }
                }
            } catch (e) { console.warn('[YMD] проверка обновлений при запуске не удалась', e); }
        }, 3000);
        if (document.readyState === 'complete') run();
        else window.addEventListener('load', run, { once: true });
    }

    async function promptForMvsepKey() {
        const current = GM_getValue('ymd_mvsep_key', '') || '';
        const input = await ymdDialog({
            title: 'API-ключ MVSEP',
            lines: [
                'Откройте страницу API в личном кабинете MVSEP и скопируйте ключ:',
            ],
            link: 'https://mvsep.com/user-api',
            linkText: 'mvsep.com/user-api',
            sub: 'Ключ хранится только в настройках скрипта. Чтобы удалить ключ, сохраните пустое поле.',
            input: { value: current, placeholder: 'API-ключ MVSEP' },
            okLabel: 'Сохранить',
            cancelLabel: 'Отмена'
        });
        if (input === null) return;
        const cleaned = input.trim();
        if (!cleaned) {
            GM_setValue('ymd_mvsep_key', '');
            ymdToast(false, ['Ключ MVSEP удалён']);
            ymdKarSync();
            return;
        }
        if (cleaned.length < 10 || /\s/.test(cleaned)) { ymdToast(true, ['Неверный ключ', 'Скопируйте API-ключ MVSEP целиком.']); return; }
        GM_setValue('ymd_mvsep_key', cleaned);
        KAR.failed.clear();
        ymdToast(false, ['Ключ MVSEP сохранён']);
        ymdKarSync();
    }

    const YMD_KAR_API = 'https://mvsep.com/api/separation';
    const YMD_KAR_TTL = 2 * 24 * 3600 * 1000;
    const KAR = { noteId: null, sc: null, main: null, id: null, sil: null, off: [], busy: false, want: null, wantPref: false, job: null, jobs: new Set(), prefFailed: new Set(), cache: new Map(), failed: new Set(), timer: null };


    function ymdKarNote(kind, detail) {
        const ID = 'ymd-kar-note';
        let box = document.getElementById(ID);
        const hide = () => { const b = document.getElementById(ID); if (!b) return; clearTimeout(b.__t); b.classList.remove('ymd-kar-note-in'); setTimeout(() => b.remove(), 300); };
        if (!kind) { hide(); return; }
        if (!document.getElementById('ymd-kar-note-style')) {
            const st = document.createElement('style');
            st.id = 'ymd-kar-note-style';
            st.textContent =
                '#ymd-kar-note{position:fixed;top:1rem;left:50%;z-index:2147483646;box-sizing:border-box;width:max-content;max-width:min(26rem,92vw);display:flex;align-items:flex-start;gap:.75rem;padding:.875rem 1rem .875rem 1.25rem;' +
                'border-radius:var(--ym-radius-size-xl,16px);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);-webkit-backdrop-filter:blur(.875rem);backdrop-filter:blur(.875rem);' +
                'background-color:var(--ym-background-color-primary-enabled-menu,#1b1b1b);box-shadow:0 .25rem 1.25rem 0 var(--ym-shadow-menu,rgba(0,0,0,.4));font-family:var(--ym-font-text,sans-serif);font-size:14px;line-height:1.4;' +
                'opacity:0;transform:translate(-50%,-1rem);transition:opacity .25s ease,transform .25s ease}' +
                '#ymd-kar-note.ymd-kar-note-in{opacity:1;transform:translate(-50%,0)}' +
                '#ymd-kar-note .ymd-kar-note-title{display:block;margin-bottom:.125rem;font-family:var(--ym-font-heading,inherit);font-weight:700;color:var(--ym-controls-color-primary-default-enabled,#ffff00)}' +
                '#ymd-kar-note .ymd-kar-note-sub{display:block;font-size:var(--ym-font-size-label-xs,.75rem);color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}' +
                '#ymd-kar-note .ymd-kar-spin{flex-shrink:0;box-sizing:border-box;width:18px;height:18px;margin-top:2px;border-radius:50%;border:2px solid var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.25));border-top-color:var(--ym-controls-color-primary-default-enabled,#ffff00);animation:ymd-kar-rot .9s linear infinite}' +
                '#ymd-kar-note.ymd-kar-note-done .ymd-kar-spin{animation:none;border-color:var(--ym-controls-color-primary-default-enabled,#ffff00);background:radial-gradient(circle,var(--ym-controls-color-primary-default-enabled,#ffff00) 40%,transparent 45%)}' +
                '#ymd-kar-note .ymd-kar-note-x{flex-shrink:0;width:22px;height:22px;margin-left:10px;padding:0;cursor:pointer;border:0;border-radius:11px;background:transparent;color:inherit;font-size:16px;line-height:22px}' +
                '#ymd-kar-note .ymd-kar-note-x:hover{background-color:var(--ym-controls-color-secondary-default-hovered,rgba(250,250,255,.1))}' +
                '@keyframes ymd-kar-rot{to{transform:rotate(360deg)}}' +
                '@media (prefers-reduced-motion:reduce){#ymd-kar-note{transition:none}#ymd-kar-note .ymd-kar-spin{animation:none}}';
            (document.head || document.documentElement).appendChild(st);
        }
        if (!box) {
            box = document.createElement('div');
            box.id = ID;
            box.setAttribute('role', 'status');
            box.innerHTML = '<span class="ymd-kar-spin" aria-hidden="true"></span><div style="flex:1"><span class="ymd-kar-note-title"></span><span class="ymd-kar-note-sub"></span></div>' +
                '<button type="button" class="ymd-kar-note-x" title="Закрыть" aria-label="Закрыть">×</button>';
            box.querySelector('.ymd-kar-note-x').addEventListener('click', hide);
            (document.body || document.documentElement).appendChild(box);
            requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('ymd-kar-note-in')));
        }
        clearTimeout(box.__t);
        const done = kind === 'done';
        box.classList.toggle('ymd-kar-note-done', done);
        box.querySelector('.ymd-kar-note-title').textContent = done ? 'Караоке готово' : 'Караоке: идёт обработка';
        box.querySelector('.ymd-kar-note-sub').textContent = detail || (done ? 'Голос убран, играет музыка без вокала.' : 'Подождите, пока играет оригинал. Это может занять до пары минут.');
        if (done) box.__t = setTimeout(hide, 4000);
    }

    function ymdKarFeatureOn() { return GM_getValue('ymd_kar_enabled', false) === true; }
    function ymdKarOn() { return ymdKarFeatureOn() && GM_getValue('ymd_kar_active', false) === true; }
    function ymdKarKey() { const k = GM_getValue('ymd_mvsep_key', ''); return typeof k === 'string' ? k.trim() : ''; }
    function ymdKarPrefetchOn() { return GM_getValue('ymd_kar_prefetch', false) === true; }
    function ymdKarCancelErr() { const e = new Error('Отменено'); e.cancel = true; return e; }

    function ymdKarCancelHash(hash, key) {
        if (!hash || !key) return;
        try {
            const fd = new FormData();
            fd.append('api_token', key);
            fd.append('hash', hash);
            ymdKarReq({ method: 'POST', url: YMD_KAR_API + '/cancel', data: fd, timeout: 30000 }).then((r) => {
                let j = null;
                try { j = JSON.parse(r.responseText); } catch (e) {}
                if (!j || !j.success) console.warn('[YMD] karaoke: MVSEP не подтвердил отмену', r.status, r.responseText && r.responseText.slice(0, 200));
            }, (e) => console.warn('[YMD] karaoke: не удалось отменить задание', e));
        } catch (e) {}
    }

    function ymdKarJobCancel(job) {
        if (!job || job.cancelled) return;
        job.cancelled = true;
        if (job.done || !job.hash) return;
        ymdKarCancelHash(job.hash, job.key);
        ymdKarHashDrop(job.id, job.hash);
    }

    function ymdKarCancelAll() { Array.from(KAR.jobs).forEach(ymdKarJobCancel); }

    const YMD_NEXT = { list: [], idx: -1 };

    function ymdKarFeedState(raw) {
        if (typeof raw !== 'string' || raw.indexOf('player_queue') < 0) return;
        let o = null;
        try { o = JSON.parse(raw); } catch (e) { return; }
        const find = (x, d) => {
            if (!x || typeof x !== 'object' || d > 6) return null;
            if (x.player_queue && typeof x.player_queue === 'object') return x.player_queue;
            for (const k of Object.keys(x)) { const r = find(x[k], d + 1); if (r) return r; }
            return null;
        };
        const q = find(o, 0);
        if (!q) return;
        if (Array.isArray(q.playable_list)) {
            YMD_NEXT.list = q.playable_list.map((p) => {
                if (!p || (p.playable_type && String(p.playable_type).toUpperCase() !== 'TRACK')) return '';
                const v = p.playable_id != null ? p.playable_id : p.id;
                return v == null ? '' : String(v).split(':')[0];
            });
        }
        if (q.current_playable_index !== undefined && q.current_playable_index !== null) {
            const n = Number(q.current_playable_index);
            if (Number.isFinite(n)) YMD_NEXT.idx = n;
        }
    }

    (function ymdKarHookWs() {
        try {
            const Native = win.WebSocket;
            if (!Native || Native.__ymdKar) return;
            const Wrapped = function (url, protocols) {
                const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
                try {
                    if (/ynison/i.test(String(url))) {
                        ws.addEventListener('message', (ev) => { try { ymdKarFeedState(ev.data); } catch (e) {} });
                        const send = ws.send;
                        ws.send = function (d) { try { ymdKarFeedState(d); } catch (e) {} return send.apply(this, arguments); };
                    }
                } catch (e) {}
                return ws;
            };
            Wrapped.prototype = Native.prototype;
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k) => { try { Wrapped[k] = Native[k]; } catch (e) {} });
            Wrapped.__ymdKar = true;
            win.WebSocket = Wrapped;
        } catch (e) { console.warn('[YMD] karaoke: WebSocket hook', e); }
    })();

    function ymdKarRowTrackId(row) {
        const a = row && row.querySelector('a:is([href*="/track/"],[href*="trackId="])');
        const m = a && a.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
        return m ? m[1] : null;
    }

    function ymdKarNextId() {
        const cur = ymdKarTrackId();
        if (!cur) return null;
        const list = YMD_NEXT.list;
        const i = (YMD_NEXT.idx >= 0 && list[YMD_NEXT.idx] === cur) ? YMD_NEXT.idx : list.indexOf(cur);
        if (i >= 0) { const n = list[i + 1]; return (n && n !== cur) ? n : null; }
        try {
            const rows = document.querySelectorAll('.CommonTrack_root__i6shE');
            for (let k = 0; k < rows.length - 1; k++) {
                if (ymdKarRowTrackId(rows[k]) !== cur) continue;
                const n = ymdKarRowTrackId(rows[k + 1]);
                return (n && n !== cur) ? n : null;
            }
        } catch (e) {}
        return null;
    }

    function ymdKarReq(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest(Object.assign({
                timeout: 120000,
                onload: resolve,
                onerror: () => reject(new Error('Нет связи с MVSEP')),
                ontimeout: () => reject(new Error('MVSEP не отвечает'))
            }, opts));
        });
    }
    async function ymdKarJson(opts) {
        const r = await ymdKarReq(opts);
        let j = null;
        try { j = JSON.parse(r.responseText); } catch (e) {}
        if (!j || typeof j !== 'object') {
            const e = new Error('MVSEP: неожиданный ответ (HTTP ' + r.status + ')');
            if (r.status === 401 || r.status === 403) e.fatalKey = true;
            throw e;
        }
        return j;
    }
    function ymdKarErrText(j) {
        const e = j && (j.errors || j.error || j.message);
        if (Array.isArray(e)) return e.join('; ');
        if (e && typeof e === 'object') return Object.values(e).join('; ');
        return e ? String(e) : '';
    }

    function ymdKarHashes() {
        try { const o = JSON.parse(GM_getValue('ymd_kar_hashes', '{}')); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
    }
    function ymdKarHashSave(id, hash) {
        const o = ymdKarHashes(), now = Date.now();
        o[id] = { h: hash, t: now };
        Object.keys(o).forEach((k) => { if (!o[k] || now - o[k].t > YMD_KAR_TTL) delete o[k]; });
        const ks = Object.keys(o).sort((a, b) => o[a].t - o[b].t);
        while (ks.length > 60) delete o[ks.shift()];
        try { GM_setValue('ymd_kar_hashes', JSON.stringify(o)); } catch (e) {}
    }
    function ymdKarHashDrop(id, hash) {
        const o = ymdKarHashes();
        if (!o[id] || (hash && o[id].h !== hash)) return;
        delete o[id];
        try { GM_setValue('ymd_kar_hashes', JSON.stringify(o)); } catch (e) {}
    }

    async function ymdKarCreate(key, buf, o = {}) {
        const fd = new FormData();
        fd.append('api_token', key);
        fd.append('sep_type', '40');
        fd.append('output_format', o.fmt || '0');
        fd.append('audiofile', new Blob([buf], { type: o.type || 'audio/mpeg' }), o.file || 'track.mp3');
        const j = await ymdKarJson({ method: 'POST', url: YMD_KAR_API + '/create', data: fd, timeout: 300000 });
        if (!j.success || !j.data || !j.data.hash) {
            const t = ymdKarErrText(j) || 'MVSEP отклонил запрос';
            const e = new Error(t);
            if (/token|api.?key|unauthor|auth/i.test(t)) e.fatalKey = true;
            throw e;
        }
        return String(j.data.hash);
    }

    async function ymdKarWait(hash, job) {
        const t0 = Date.now();
        const stop = () => job.cancelled || (!job.dl && !ymdKarOn());
        while (Date.now() - t0 < 20 * 60 * 1000) {
            if (stop()) throw ymdKarCancelErr();
            const j = await ymdKarJson({ method: 'GET', url: YMD_KAR_API + '/get?hash=' + encodeURIComponent(hash), timeout: 30000 });
            const st = String(j.status || '').toLowerCase();
            if (st === 'done') {
                const files = (j.data && j.data.files) || [];
                const f = files.find((x) => /instr/i.test(String(x.type || ''))) || files.find((x) => !/vocal/i.test(String(x.type || '')));
                const u = f && (f.url || f.download);
                if (!u) throw new Error('MVSEP не вернул файл без вокала');
                return u;
            }
            if (stop()) throw ymdKarCancelErr();
            if (st === 'failed' || st === 'error') throw new Error('MVSEP не смог обработать трек');
            if (st === 'not_found') throw new Error('MVSEP не нашёл задание');
            if (!j.success && !st) throw new Error('MVSEP: ' + (ymdKarErrText(j) || 'результат не найден'));
            if (job.onWait) job.onWait(st, j.data && Number(j.data.current_order));
            if (KAR.noteId === job.id) {
                const q = j.data && Number(j.data.current_order);
                ymdKarNote('busy', st === 'waiting' ? ('Трек в очереди MVSEP' + (q > 0 ? ' (место ' + q + ')' : '') + '. Пока играет оригинал.') : 'Голос удаляется. Пока играет оригинал.');
            }
            await sleep(st === 'waiting' ? 4000 : 3000);
        }
        throw new Error('MVSEP слишком долго обрабатывает трек');
    }

    async function ymdKarFetchBuf(url, onProgress) {
        const o = { method: 'GET', url, responseType: 'arraybuffer', timeout: 300000 };
        if (onProgress) o.onprogress = (e) => { if (e && e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total * 100, e.loaded, e.total); };
        const r = await ymdKarReq(o);
        if (r.status !== 200 || !r.response || !r.response.byteLength) throw new Error('Не удалось скачать результат MVSEP (HTTP ' + r.status + ')');
        return r.response;
    }

    async function ymdKarFetchBlob(url) {
        return URL.createObjectURL(new Blob([await ymdKarFetchBuf(url)], { type: 'audio/mpeg' }));
    }

    async function ymdKarSource(id, quals = [QUALITY_OPTIONS[1], QUALITY_OPTIONS[2]], onProgress) {
        let info = null, lastErr = null;
        for (const q of quals) {
            try { info = await getTrackDownloadUrl(id, q); if (info) break; } catch (e) { lastErr = e; }
        }
        if (!info) throw lastErr || new Error('Не удалось получить аудио трека');
        const url = info.url || (info.urls && info.urls[0]);
        if (!url || info.quality === 'preview') { const e = new Error('Для этого трека нет полной версии'); e.preview = true; throw e; }
        const buf = onProgress ? await downloadWithPause(url, onProgress) : (await gmRangeRequest(url, null, null, 180000)).response;
        return { buf, codec: info.codec };
    }

    function ymdKarUpload(src) {
        const c = String(src.codec || '').toLowerCase();
        if (c === 'mp3') return { buf: src.buf, file: 'track.mp3', type: 'audio/mpeg' };
        if (c === 'flac') return { buf: src.buf, file: 'track.flac', type: 'audio/flac' };
        if (c === 'flac-mp4') {
            const f = tagFlacFromMp4(src.buf, null, null);
            if (f) return { buf: f, file: 'track.flac', type: 'audio/flac' };
        }
        return { buf: src.buf, file: 'track.m4a', type: 'audio/mp4' };
    }

    async function ymdInstrFetch(t, opt, ui) {
        const key = ymdKarKey();
        if (!key) { const e = new Error('Не задан API-ключ MVSEP'); e.fatalKey = true; throw e; }
        ui.label('Загрузка исходника...');
        let src;
        try { src = await ymdKarSource(String(t.id), opt.src, ui.progress); }
        catch (e) { if (e && e.preview) return null; throw e; }
        if (!src.buf || src.buf.byteLength === 0) throw new Error('Пустой ответ от CDN');
        if (downloadCancelled) throw ymdKarCancelErr();
        const up = ymdKarUpload(src);
        ui.label('Отправка в MVSEP...');
        const hash = await ymdKarCreate(key, up.buf, { fmt: opt.fmt, file: up.file, type: up.type });
        if (downloadCancelled) { ymdKarCancelHash(hash, key); throw ymdKarCancelErr(); }
        const job = {
            dl: true,
            get cancelled() { return downloadCancelled; },
            onWait: (st, q) => ui.label(st === 'waiting' ? 'Очередь MVSEP' + (q > 0 ? ' (место ' + q + ')' : '') + '...' : 'Удаление голоса...')
        };
        let fileUrl;
        try { fileUrl = await ymdKarWait(hash, job); }
        catch (e) { if (e && e.cancel) ymdKarCancelHash(hash, key); throw e; }
        ui.label('Загрузка результата...');
        return await ymdKarFetchBuf(fileUrl, ui.progress);
    }

    async function ymdKarProcess(id, job) {
        if (KAR.cache.has(id)) return KAR.cache.get(id);
        const key = ymdKarKey();
        if (!key) { const e = new Error('Не задан API-ключ MVSEP'); e.fatalKey = true; throw e; }
        job.key = key;
        const stop = () => job.cancelled || !ymdKarOn();
        let fileUrl = null;
        const saved = ymdKarHashes()[id];
        if (saved && saved.h && Date.now() - saved.t < YMD_KAR_TTL) {
            job.hash = saved.h;
            try { fileUrl = await ymdKarWait(saved.h, job); job.done = true; }
            catch (e) {
                if (e.cancel) throw e;
                fileUrl = null; job.hash = null;
                ymdKarHashDrop(id, saved.h);
            }
        }
        if (!fileUrl) {
            if (KAR.noteId === id) ymdKarNote('busy', 'Отправка трека в MVSEP…');
            const buf = (await ymdKarSource(id)).buf;
            if (stop()) throw ymdKarCancelErr();
            const hash = await ymdKarCreate(key, buf);
            if (stop()) { ymdKarCancelHash(hash, key); throw ymdKarCancelErr(); }
            job.hash = hash;
            ymdKarHashSave(id, hash);
            fileUrl = await ymdKarWait(hash, job);
            job.done = true;
        }
        const blobUrl = await ymdKarFetchBlob(fileUrl);
        KAR.cache.set(id, blobUrl);
        for (const k of Array.from(KAR.cache.keys())) {
            if (KAR.cache.size <= 5) break;
            if (k === KAR.id || k === id) continue;
            try { URL.revokeObjectURL(KAR.cache.get(k)); } catch (e) {}
            KAR.cache.delete(k);
        }
        return blobUrl;
    }

    function ymdKarMain() {
        const cands = [];
        for (const r of fxEls) { const a = r.deref(); if (a) cands.push(a); }
        document.querySelectorAll('audio').forEach((a) => cands.push(a));
        const list = cands.filter((a) => a && !a.__ymdKar && (a.currentSrc || a.src));
        return list.find((a) => !a.paused && !a.ended) || list.find((a) => a.readyState > 0) || null;
    }

    function ymdKarTrackId() {
        const sels = [
            '[class*="PlayerBarDesktopWithBackgroundProgressBar_info__"] a:is([href*="/track/"],[href*="trackId="])',
            '[class*="FullscreenPlayerDesktopContent_meta__"] a:is([href*="/track/"],[href*="trackId="])',
            '[class*="FullscreenPlayerDesktopContent_title__"] a:is([href*="/track/"],[href*="trackId="])'
        ];
        for (const sel of sels) {
            const a = document.querySelector(sel);
            const m = a && a.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
            if (m) return m[1];
        }
        try { const v = getVibeTrackInfo(); if (v && v.id) return String(v.id); } catch (e) {}
        return null;
    }

    function ymdKarSilence(main, on) {
        if (on) {
            if (KAR.sil) return;
            const sil = { main };
            try {
                const st = fxState.get(main);
                const g = st && st.dest && st.dest.gain;
                if (g && typeof g.value === 'number') { sil.g = g; sil.gv = g.value; g.value = 0; }
            } catch (e) {}
            if (!sil.g) { try { sil.m = main.muted; main.muted = true; } catch (e) {} }
            KAR.sil = sil;
        } else {
            const sil = KAR.sil;
            if (!sil) return;
            KAR.sil = null;
            try { if (sil.g) sil.g.value = sil.gv; else sil.main.muted = !!sil.m; } catch (e) {}
        }
    }

    function ymdKarListen(t, ev, fn) {
        t.addEventListener(ev, fn);
        KAR.off.push(() => t.removeEventListener(ev, fn));
    }

    function ymdKarAttach(id, main, url) {
        const sc = new Audio();
        sc.__ymdKar = true;
        sc.preload = 'auto';
        sc.src = url;
        KAR.sc = sc; KAR.main = main; KAR.id = id;
        const sync = () => {
            try { sc.volume = Math.min(1, Math.max(0, main.volume)); } catch (e) {}
            try { sc.playbackRate = main.playbackRate; } catch (e) {}
        };
        const seek = () => { try { sc.currentTime = main.currentTime; } catch (e) {} };
        const resume = () => { if (KAR.sc === sc && !main.paused && sc.readyState > 0) { sc.play().catch(() => {}); } };
        sc.addEventListener('loadedmetadata', () => {
            if (KAR.sc !== sc) return;
            sync(); seek();
            if (main.paused) { ymdKarSilence(main, true); ymdKarPaint(); if (KAR.noteId === id) { KAR.noteId = null; ymdKarNote('done'); } return; }
            sc.play().then(() => {
                if (KAR.sc !== sc) return;
                ymdKarSilence(main, true);
                ymdKarPaint();
                if (KAR.noteId === id) { KAR.noteId = null; ymdKarNote('done'); }
            }).catch((e) => {
                if (KAR.sc !== sc) return;
                console.warn('[YMD] karaoke play', e);
                ymdKarDetach();
                KAR.failed.add(id);
                ymdToast(true, ['Караоке', 'Браузер не дал запустить звук. Кликните по странице и включите караоке заново.']);
            });
        }, { once: true });
        ymdKarListen(main, 'play', () => { seek(); resume(); });
        ymdKarListen(main, 'playing', () => { seek(); resume(); });
        ymdKarListen(main, 'pause', () => { try { sc.pause(); } catch (e) {} });
        ymdKarListen(main, 'waiting', () => { try { sc.pause(); } catch (e) {} });
        ymdKarListen(main, 'ended', () => { try { sc.pause(); } catch (e) {} });
        ymdKarListen(main, 'seeking', seek);
        ymdKarListen(main, 'seeked', seek);
        ymdKarListen(main, 'ratechange', sync);
        ymdKarListen(main, 'volumechange', sync);
        ymdKarListen(main, 'timeupdate', () => { if (Math.abs(sc.currentTime - main.currentTime) > 0.25) seek(); });
        ymdKarListen(main, 'emptied', () => ymdKarDetach());
        ymdKarListen(main, 'loadstart', () => ymdKarDetach());
        ymdKarPaint();
    }

    function ymdKarDetach() {
        const sc = KAR.sc, main = KAR.main;
        KAR.off.forEach((f) => { try { f(); } catch (e) {} });
        KAR.off = [];
        KAR.sc = null; KAR.main = null; KAR.id = null;
        if (main) ymdKarSilence(main, false);
        else KAR.sil = null;
        if (sc) { try { sc.pause(); sc.removeAttribute('src'); sc.load(); } catch (e) {} }
        ymdKarPaint();
    }

    async function ymdKarWorker() {
        if (KAR.busy) return;
        KAR.busy = true;
        ymdKarPaint();
        try {
            while (KAR.want && ymdKarOn()) {
                const id = KAR.want, pref = KAR.wantPref;
                KAR.want = null; KAR.wantPref = false;
                if (KAR.failed.has(id)) continue;
                if (id !== (pref ? ymdKarNextId() : ymdKarTrackId())) continue;
                const job = { id, pref, hash: null, key: '', cancelled: false, done: false };
                KAR.jobs.add(job);
                KAR.job = job;
                try {
                    if (!pref && !KAR.cache.has(id)) { KAR.noteId = id; ymdKarNote('busy'); }
                    await ymdKarProcess(id, job);
                } catch (e) {
                    if (KAR.noteId === id) { KAR.noteId = null; ymdKarNote(null); }
                    if (e && e.cancel) break;
                    if (job.pref) KAR.prefFailed.add(id); else KAR.failed.add(id);
                    console.warn('[YMD] karaoke', e);
                    if (e && e.fatalKey) {
                        GM_setValue('ymd_kar_active', false);
                        ymdKarSync();
                        ymdToast(true, ['Караоке выключено', String(e.message || 'Проверьте API-ключ MVSEP')]);
                    } else if (!job.pref) {
                        ymdToast(true, ['Караоке: не удалось убрать голос', String((e && e.message) || e)]);
                    }
                } finally {
                    KAR.jobs.delete(job);
                    if (KAR.job === job) KAR.job = null;
                }
            }
        } finally {
            KAR.busy = false;
            ymdKarPaint();
        }
        ymdKarTick();
        setTimeout(() => { if (!KAR.sc && !KAR.busy && KAR.noteId) { KAR.noteId = null; ymdKarNote(null); } }, 4000);
    }

    function ymdKarPrefetchTick(cur) {
        if (!ymdKarPrefetchOn() || KAR.busy || KAR.want) return;
        if (!KAR.cache.has(cur) && !KAR.failed.has(cur)) return;
        const next = ymdKarNextId();
        if (!next || next === cur || KAR.cache.has(next) || KAR.failed.has(next) || KAR.prefFailed.has(next)) return;
        KAR.want = next;
        KAR.wantPref = true;
        ymdKarWorker();
    }

    function ymdKarTick() {
        if (!ymdKarOn()) { if (KAR.sc) ymdKarDetach(); return; }
        const id = ymdKarTrackId(), main = ymdKarMain();
        if (!id || !main) return;
        if (KAR.sc && (KAR.id !== id || KAR.main !== main)) ymdKarDetach();
        const job = KAR.job;
        if (job && job.pref && !job.cancelled) {
            if (job.id === id) {
                job.pref = false;
                if (!KAR.cache.has(id)) { KAR.noteId = id; ymdKarNote('busy'); }
            } else if (!ymdKarPrefetchOn() || job.id !== ymdKarNextId()) {
                ymdKarJobCancel(job);
            }
        }
        if (KAR.sc) { ymdKarPrefetchTick(id); return; }
        if (KAR.cache.has(id)) { ymdKarAttach(id, main, KAR.cache.get(id)); return; }
        if (KAR.failed.has(id)) { ymdKarPrefetchTick(id); return; }
        KAR.want = id;
        KAR.wantPref = false;
        ymdKarWorker();
    }

    function ymdKarSync() {
        try { ymdKarInject(); } catch (e) {}
        KAR.prefFailed.clear();
        if (ymdKarOn()) {
            if (!KAR.timer) KAR.timer = setInterval(ymdKarTick, 1000);
        } else {
            if (KAR.timer) { clearInterval(KAR.timer); KAR.timer = null; }
            ymdKarCancelAll();
            KAR.want = null;
            KAR.wantPref = false;
            KAR.noteId = null;
            ymdKarNote(null);
            KAR.failed.clear();
            ymdKarDetach();
        }
        ymdKarPaint();
        ymdKarTick();
    }

    function ymdKarSetFeature(on) {
        GM_setValue('ymd_kar_enabled', !!on);
        if (!on) GM_setValue('ymd_kar_active', false);
        ymdKarSync();
    }

    function ymdKarSetActive(on) {
        GM_setValue('ymd_kar_active', !!on);
        if (on) KAR.failed.clear();
        ymdKarSync();
    }

    async function ymdKarToggleFromBtn() {
        if (ymdKarOn()) { ymdKarSetActive(false); return; }
        if (!ymdKarKey()) {
            await promptForMvsepKey();
            if (!ymdKarKey()) return;
        }
        ymdKarSetActive(true);
    }

    function ymdKarPaint() {
        const on = ymdKarOn();
        const wait = on && KAR.busy && !KAR.sc;
        document.querySelectorAll('.ymd-kar-btn').forEach((b) => {
            b.classList.toggle('ymd-kar-on', on);
            b.classList.toggle('ymd-kar-busy', wait);
            b.setAttribute('aria-pressed', String(on));
            b.title = wait ? 'Караоке: идёт обработка в MVSEP…' : (on ? 'Караоке: вернуть голос' : 'Караоке: убрать голос');
        });
    }

    const YMD_KAR_BTN_CLASS = 'cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO';
    const YMD_KAR_BTN_ICON = '<span class="JjlbHZ4FaP9EAcR_1DxF"><svg class="J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#artist_xxs"></use></svg></span>';

    function ymdKarMakeBtn(cls) {
        const b = document.createElement('button');
        b.className = (cls || YMD_KAR_BTN_CLASS) + ' ymd-kar-btn';
        b.type = 'button';
        b.setAttribute('aria-label', 'Караоке: убрать голос');
        b.innerHTML = YMD_KAR_BTN_ICON;
        b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); ymdKarToggleFromBtn(); });
        return b;
    }

    function ymdKarInject() {
        if (!document.getElementById('ymd-kar-style')) {
            const st = document.createElement('style');
            st.id = 'ymd-kar-style';
            st.textContent =
                'button.ymd-kar-btn.ymd-kar-on,button.ymd-kar-btn.ymd-kar-on svg{color:var(--ym-controls-color-primary-default-enabled,#ffff00)!important;fill:var(--ym-controls-color-primary-default-enabled,#ffff00)!important}' +
                'button.ymd-kar-btn.ymd-kar-busy{animation:ymd-kar-pulse 1.2s ease-in-out infinite}' +
                '@keyframes ymd-kar-pulse{0%,100%{opacity:1}50%{opacity:.35}}' +
                '@media(prefers-reduced-motion:reduce){button.ymd-kar-btn.ymd-kar-busy{animation:none;opacity:.6}}';
            (document.head || document.documentElement).appendChild(st);
        }
        if (!ymdKarFeatureOn()) { document.querySelectorAll('.ymd-kar-btn').forEach((b) => b.remove()); return; }
        const bar = document.querySelector('[class*="PlayerBarDesktopWithBackgroundProgressBar_meta__"]');
        if (bar && !bar.querySelector('.ymd-kar-btn')) {
            const b = ymdKarMakeBtn();
            const dl = bar.querySelector('button[aria-label="Скачать текущий трек"]');
            if (dl) dl.insertAdjacentElement('afterend', b); else bar.insertBefore(b, bar.firstChild);
            ymdKarPaint();
        }
        const vp = document.querySelector('.VibePlayerBar_progress__Cri6E');
        if (vp && !vp.querySelector('.ymd-kar-btn')) {
            const anchor = vp.querySelector('button[aria-label="Скачать текущий трек"]') || vp.querySelector('button[aria-haspopup="menu"]');
            if (anchor && anchor.parentNode) {
                anchor.parentNode.insertBefore(ymdKarMakeBtn(anchor.className.replace(/\bymd-\S+/g, '').trim()), anchor);
                ymdKarPaint();
            }
        }
    }

    const YMD_SETTINGS_CSS = `
        #ymd-settings-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:var(--ym-background-color-primary-enabled-overlay,rgba(0,0,0,.5));font-family:var(--ym-font-text,sans-serif)}
        #ymd-settings{box-sizing:border-box;width:min(460px,92vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;border-radius:var(--ym-radius-size-xxl,24px);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);-webkit-backdrop-filter:blur(.9375rem);backdrop-filter:blur(.9375rem);background-color:var(--ym-background-color-primary-enabled-popover,var(--ym-background-color-primary-enabled-menu,#1b1b1b));box-shadow:0 .0625rem 1.5rem 0 var(--ym-shadow-modal-xl,rgba(0,0,0,.5)),0 -.0625rem 1.5rem 0 var(--ym-shadow-modal-s,rgba(0,0,0,.2))}
        #ymd-settings .ymd-head{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:1rem 1rem 0 1.25rem;margin-bottom:.75rem}
        #ymd-settings .ymd-title{font-family:var(--ym-font-heading,inherit);font-size:var(--ym-font-size-headline-s,1.25rem);font-weight:var(--ym-font-weight-bold,700)}
        #ymd-settings .ymd-group{padding:1rem 0;border-top:1px solid var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}
        #ymd-settings .ymd-group:first-child{padding-top:0;border-top:0}
        #ymd-settings .ymd-group:last-child{padding-bottom:0}
        #ymd-settings .ymd-group-title{margin:0 0 .5rem;font-family:var(--ym-font-heading,inherit);font-size:var(--ym-font-size-label-l,1.0625rem);line-height:1.5rem;font-weight:var(--ym-font-weight-bold,700)}
        #ymd-settings .ymd-group > :last-child{margin-bottom:0}
        #ymd-settings .ymd-sub{margin-top:.25rem;padding-left:.75rem;border-left:2px solid var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}
        #ymd-settings .ymd-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:2.5rem}
        #ymd-settings .ymd-label{font-size:var(--ym-font-size-label-m,1rem);font-weight:var(--ym-font-weight-medium,500)}
        #ymd-settings .ymd-hint{margin-top:.25rem;font-size:var(--ym-font-size-label-xs,.75rem);line-height:1.35;color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}
        #ymd-settings .ymd-group-hint{margin:-.25rem 0 .5rem}
        #ymd-settings .ymd-btn-hint{margin:0 0 1rem}
        #ymd-settings .ymd-btn-hint:last-child{margin-bottom:0}
        #ymd-settings .ymd-fx .ymd-hint{margin:.125rem 0 .25rem}
        #ymd-settings .ymd-footer-hint{margin:.5rem 0 .75rem}
        #ymd-settings .ymd-btn{position:relative;overflow:hidden;cursor:pointer;border:none;outline:none;border-radius:var(--ym-radius-size-xxxl,999px);padding:.5rem 1rem;font-family:var(--ym-font-text,inherit);font-size:var(--ym-font-size-label-s,.875rem);line-height:var(--ym-font-line-height-label-s,1.25rem);font-weight:var(--ym-font-weight-medium,500);backdrop-filter:saturate(180%) blur(.9375rem);background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12));color:var(--ym-controls-color-secondary-on_default-enabled,#fff);transition:background-color var(--ym-duration-transition,.3s)}
        #ymd-settings .ymd-btn:hover:not(:disabled){background:var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.2))}
        #ymd-settings .ymd-btn:not(:disabled):focus-visible{box-shadow:0 0 0 var(--ym-spacer-size-xxxs,2px) var(--ym-controls-color-secondary-default-focused_stroke,#fff)}
        #ymd-settings .ymd-btn:disabled{cursor:default;background:var(--ym-controls-color-secondary-default-disabled,rgba(255,255,255,.06));color:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-btn-wide{width:100%;text-align:left;margin-bottom:.5rem}
        #ymd-settings .ymd-close-x{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;flex-shrink:0;min-width:44px;height:44px;margin:0;padding:0;cursor:pointer;border:0;border-radius:22px;outline:0;color:var(--ym-controls-color-secondary-on_default-enabled,rgba(250,250,255,1));background-color:transparent;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none;transition:background-color .2s cubic-bezier(.34,.8,.34,1),color .2s cubic-bezier(.34,.8,.34,1)}
        #ymd-settings .ymd-close-x:hover{background-color:var(--ym-controls-color-secondary-default-hovered,rgba(250,250,255,.1))}
        #ymd-settings .ymd-close-x:active{background-color:var(--ym-controls-color-secondary-default-pressed,rgba(250,250,255,.14))}
        #ymd-settings .ymd-close-x::before{content:"";position:absolute;inset:0;visibility:hidden;opacity:0;border-radius:24px;box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,rgba(250,250,255,1))}
        #ymd-settings .ymd-close-x:focus-visible::before{visibility:visible;inset:-2px;opacity:1}
        #ymd-settings .ymd-close-x svg{display:inline-flex;width:24px;height:24px;color:inherit}
        @media (prefers-reduced-motion:reduce){#ymd-settings .ymd-close-x{transition:none}}
        #ymd-settings .ymd-switch{--ymd-dur:var(--ym-duration-transition,.3s);flex-shrink:0;position:relative;overflow:hidden;cursor:pointer;outline:none;border:none;padding:0;width:2rem;height:1.25rem;border-radius:var(--ym-radius-size-xxxl,999px);backdrop-filter:saturate(180%) blur(.9375rem);background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12));transition:background-color var(--ymd-dur)}
        #ymd-settings .ymd-switch:hover{background:var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.2))}
        #ymd-settings .ymd-switch:focus-visible{box-shadow:0 0 0 .125rem var(--ym-controls-color-secondary-default-focused_stroke,#fff)}
        #ymd-settings .ymd-switch[aria-checked="true"],#ymd-settings .ymd-switch[aria-checked="true"]:hover{background:var(--ym-controls-color-primary-default-enabled,#ffff00)}
        #ymd-settings .ymd-switch span{display:flex;align-items:center}
        #ymd-settings .ymd-switch i{display:block;width:1rem;height:1rem;margin:.125rem;border-radius:var(--ym-radius-size-round,50%);background-color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa);transition:transform var(--ymd-dur),background-color var(--ymd-dur)}
        #ymd-settings .ymd-switch[aria-checked="true"] i{background-color:var(--ym-controls-color-primary-on_default-enabled,#000);transform:translateX(var(--ym-spacer-size-m,.75rem))}
        #ymd-settings .ymd-switch:disabled,#ymd-settings .ymd-switch:disabled:hover,#ymd-settings .ymd-switch[aria-checked="true"]:disabled,#ymd-settings .ymd-switch[aria-checked="true"]:disabled:hover{cursor:default;background:var(--ym-controls-color-secondary-default-disabled,rgba(255,255,255,.06))}
        #ymd-settings .ymd-switch:disabled i,#ymd-settings .ymd-switch[aria-checked="true"]:disabled i{background-color:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-row.ymd-row-disabled .ymd-label{color:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-row.ymd-row-disabled .ymd-range-val{color:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-range-row{gap:.75rem}
        #ymd-settings .ymd-range{--ymd-fill:0%;flex:1;min-width:0;height:1.25rem;margin:0;padding:0;background:transparent;cursor:pointer;outline:none;-webkit-appearance:none;appearance:none}
        #ymd-settings .ymd-range::-webkit-slider-runnable-track{height:.25rem;border-radius:999px;background:linear-gradient(to right,var(--ym-controls-color-primary-default-enabled,#ffff00) var(--ymd-fill),var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12)) var(--ymd-fill))}
        #ymd-settings .ymd-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:1rem;height:1rem;margin-top:-.375rem;border:0;border-radius:50%;background:var(--ym-controls-color-primary-default-enabled,#ffff00)}
        #ymd-settings .ymd-range::-moz-range-track{height:.25rem;border-radius:999px;background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}
        #ymd-settings .ymd-range::-moz-range-progress{height:.25rem;border-radius:999px;background:var(--ym-controls-color-primary-default-enabled,#ffff00)}
        #ymd-settings .ymd-range::-moz-range-thumb{width:1rem;height:1rem;border:0;border-radius:50%;background:var(--ym-controls-color-primary-default-enabled,#ffff00)}
        #ymd-settings .ymd-range:focus-visible{box-shadow:0 0 0 .125rem var(--ym-controls-color-secondary-default-focused_stroke,#fff);border-radius:999px}
        #ymd-settings .ymd-range:disabled{cursor:default}
        #ymd-settings .ymd-range:disabled::-webkit-slider-runnable-track{background:var(--ym-controls-color-secondary-default-disabled,rgba(255,255,255,.06))}
        #ymd-settings .ymd-range:disabled::-webkit-slider-thumb{background:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-range:disabled::-moz-range-track,#ymd-settings .ymd-range:disabled::-moz-range-progress{background:var(--ym-controls-color-secondary-default-disabled,rgba(255,255,255,.06))}
        #ymd-settings .ymd-range:disabled::-moz-range-thumb{background:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-range-val{flex-shrink:0;min-width:3.75rem;text-align:right;font-size:var(--ym-font-size-label-s,.875rem);font-variant-numeric:tabular-nums}
        #ymd-settings .ymd-body{min-height:0;overflow-x:hidden;overflow-y:auto;padding:0 .25rem 1.25rem 1.25rem}
        ${ymdScrollCss(['#ymd-settings .ymd-body'], false)}
        @media (prefers-reduced-motion:reduce){#ymd-settings .ymd-switch,#ymd-settings .ymd-switch i{transition:none}}
        #ymd-settings .ymd-qsel{flex-shrink:0;display:inline-flex;align-items:center;gap:.5rem;max-width:60%}
        #ymd-settings .ymd-qsel-arrow{flex-shrink:0;transition:transform .2s}
        #ymd-settings .ymd-qsel[aria-expanded="true"] .ymd-qsel-arrow{transform:rotate(180deg)}
        #ymd-quality-menu{position:fixed;z-index:2147483647;box-sizing:border-box;width:auto;min-width:12rem;max-width:calc(100vw - 1rem);font-family:var(--ym-font-text,sans-serif)}
        #ymd-quality-menu button[aria-checked="true"]{background-color:var(--ym-surface-color-primary-enabled-list,rgba(255,255,255,.1))}
        #ymd-aspl-menu{position:fixed;z-index:2147483647;box-sizing:border-box;width:auto;min-width:12rem;max-width:calc(100vw - 1rem);max-height:min(22rem,60vh);overflow-y:auto;overscroll-behavior:contain;font-family:var(--ym-font-text,sans-serif)}
        #ymd-aspl-menu button[aria-checked="true"]{background-color:var(--ym-surface-color-primary-enabled-list,rgba(255,255,255,.1))}
        #ymd-settings .ymd-token-status{font-size:var(--ym-font-size-label-s,.875rem);font-weight:var(--ym-font-weight-medium,500)}
        #ymd-settings .ymd-token-status.ok{color:#00e676}
        #ymd-settings .ymd-token-status.no{color:#ff5555}
        #ymd-settings .ymd-footer{flex-shrink:0;padding:.75rem 1.25rem 1rem;border-top:1px solid var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}
        #ymd-settings .ymd-footer-row{display:flex;align-items:center;justify-content:space-between;gap:1rem}
        #ymd-settings .ymd-version-wrap{display:flex;flex-direction:column;align-items:flex-end;gap:.5rem}
        #ymd-settings .ymd-version{font-size:var(--ym-font-size-label-xs,.75rem);color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}
        #ymd-settings .ymd-links{display:flex;flex-wrap:wrap;justify-content:center;gap:.25rem 1rem;margin-top:.75rem;font-size:var(--ym-font-size-label-xs,.75rem)}
        #ymd-settings .ymd-color-wrap{display:flex;align-items:center;gap:.5rem}
        #ymd-settings .ymd-color-btn{width:2rem;height:2rem;padding:0;border:2px solid var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.2));border-radius:50%;cursor:pointer;outline:none}
        #ymd-settings .ymd-color-btn:focus-visible{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,rgba(255,255,255,.5))}
        #ymd-color-pop{position:fixed;z-index:2147483647;box-sizing:border-box;width:15rem;padding:.75rem;display:flex;flex-direction:column;gap:.75rem;border-radius:var(--ym-radius-size-xxl,24px);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);font-family:var(--ym-font-text,sans-serif);-webkit-backdrop-filter:blur(.9375rem);backdrop-filter:blur(.9375rem);background-color:var(--ym-background-color-primary-enabled-popover,var(--ym-background-color-primary-enabled-menu,#1b1b1b));box-shadow:0 .0625rem 1.5rem 0 var(--ym-shadow-modal-xl,rgba(0,0,0,.5)),0 -.0625rem 1.5rem 0 var(--ym-shadow-modal-s,rgba(0,0,0,.2))}
        #ymd-color-pop .ymd-sv{position:relative;height:8.5rem;border-radius:.75rem;cursor:crosshair;touch-action:none;background-image:linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,transparent)}
        #ymd-color-pop .ymd-hue{position:relative;height:.75rem;border-radius:999px;cursor:pointer;touch-action:none;background-image:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)}
        #ymd-color-pop .ymd-hue .ymd-thumb{top:50%}
        #ymd-color-pop .ymd-thumb{position:absolute;width:1rem;height:1rem;box-sizing:border-box;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.4);transform:translate(-50%,-50%);pointer-events:none}
        #ymd-color-pop .ymd-hex{box-sizing:border-box;width:100%;border:none;outline:none;border-radius:var(--ym-radius-size-xxxl,999px);padding:.5rem 1rem;background:var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.08));color:inherit;font-family:var(--ym-font-text,inherit);font-size:var(--ym-font-size-label-s,.875rem)}
        #ymd-color-pop .ymd-hex:focus{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,rgba(255,255,255,.5))}
        #ymd-color-pop .ymd-presets{display:flex;justify-content:space-between}
        #ymd-color-pop .ymd-preset{width:1.5rem;height:1.5rem;padding:0;border:none;border-radius:50%;cursor:pointer;outline:none;transition:transform .15s}
        #ymd-color-pop .ymd-preset:hover,#ymd-color-pop .ymd-preset:focus-visible{transform:scale(1.15)}
        #ymd-settings .ymd-fx{padding:.25rem 0 .25rem;user-select:none;-webkit-user-select:none}
        #ymd-settings .ymd-fx[data-fx="asDays"]{padding-top:.50rem}
        #ymd-settings .ymd-fx[data-fx="asLimit"]{padding-top:.50rem}
        #ymd-settings .ymd-fx.ymd-fx-disabled .ymd-label,#ymd-settings .ymd-fx.ymd-fx-disabled .ymd-fx-val{color:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-fx.ymd-fx-disabled .ymd-hint{opacity:.5}
        #ymd-settings .ymd-fx.ymd-fx-disabled .ymd-fx-track{cursor:default;pointer-events:none}
        #ymd-settings .ymd-fx.ymd-fx-disabled .ymd-fx-fill,#ymd-settings .ymd-fx.ymd-fx-disabled .ymd-fx-thumb{background:var(--ym-controls-color-secondary-on_default-disabled,rgba(255,255,255,.35))}
        #ymd-settings .ymd-fx:last-child{padding-bottom:0}
        #ymd-settings .ymd-fx[data-fx="dlConc"]{padding-top:.50rem}
        #ymd-settings .ymd-fx-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem}
        #ymd-settings .ymd-fx-val{font-size:var(--ym-font-size-label-xs,.75rem);color:var(--ym-controls-color-secondary-on_default-enabled_variant,#aaa)}
        #ymd-settings .ymd-fx-track{position:relative;height:1.5rem;margin:0 .375rem;cursor:pointer;touch-action:none;outline:none}
        #ymd-settings .ymd-fx-rail,#ymd-settings .ymd-fx-fill{position:absolute;top:.6875rem;height:.25rem;border-radius:var(--ym-radius-size-xxxl,999px)}
        #ymd-settings .ymd-fx-rail{left:0;right:0;background:var(--ym-slider-color-primary-disabled,rgba(255,255,255,.08))}
        #ymd-settings .ymd-fx-fill{background:var(--ym-slider-color-primary-enabled,#e6e6e6)}
        #ymd-settings .ymd-fx-thumb{position:absolute;top:.5rem;width:.75rem;height:.75rem;box-sizing:border-box;border-radius:50%;background:var(--ym-slider-color-primary-enabled,#e6e6e6);transform:translateX(-50%) scale(.85);transition:transform var(--ym-duration-transition,.3s),background-color var(--ym-duration-transition,.3s);pointer-events:none}
        #ymd-settings .ymd-fx-track:hover .ymd-fx-thumb,#ymd-settings .ymd-fx-track:active .ymd-fx-thumb{transform:translateX(-50%) scale(1.15)}
        #ymd-settings .ymd-fx-mod .ymd-fx-fill,#ymd-settings .ymd-fx-mod .ymd-fx-thumb{background:var(--ym-controls-color-primary-default-enabled)}
        #ymd-settings .ymd-fx-track:focus-visible .ymd-fx-thumb{box-shadow:0 0 0 2px var(--ym-controls-color-secondary-default-focused_stroke,rgba(255,255,255,.5))}
        #ymd-settings .ymd-links a{color:var(--ym-controls-color-primary-text-enabled_variant);text-decoration:none}
        #ymd-settings .ymd-links a:hover,#ymd-settings .ymd-links a:focus-visible{color:var(--ym-controls-color-primary-text-hovered)}
        #ymd-settings .ymd-sr-hide{display:none!important}
        #ymd-settings .ymd-search{flex-shrink:0;box-sizing:border-box;padding:0 .25rem .75rem 1.25rem}
        #ymd-settings .ymd-search-root{--animated-search-input-caret-color:var(--q2v-accent-color);box-sizing:border-box;width:100%;min-width:0;position:relative;isolation:isolate}
        #ymd-settings .ymd-search-root input{caret-color:var(--animated-search-input-caret-color)}
        #ymd-settings .ymd-search-input::-webkit-search-cancel-button{display:none;-webkit-appearance:none}
        #ymd-settings .ymd-search-empty{padding-top:.5rem}
        #ymd-settings .ymd-group-reset{margin-top:1rem}
    `;

    const YMD_TAG_OPTS = [
        { key: 'cover',        label: 'Обложка',                                  def: true  },
        { key: 'lyrics',       label: 'Текст песни',                              def: false  },
        { key: 'number',       label: 'Номер трека',                              def: true  },
        { key: 'disc',         label: 'Номер диска',                              def: true  },
        { key: 'title',        label: 'Название',                                 def: true  },
        { key: 'artist',       label: 'Исполнитель',                              def: true  },
        { key: 'album',        label: 'Альбом',                                   def: true  },
        { key: 'albumAsTitle', label: 'Вместо названия альбома название трека',   def: false },
        { key: 'genre',        label: 'Жанр',                                     def: true  },
        { key: 'year',         label: 'Год',                                      def: true  },
    ];
    const YMD_GROUP_RESET = {
        'FckCensor':        { keys: ['ymd_fck_enabled'] },
        'Текстомузыка':     { keys: ['ymd_lrclib_enabled'] },
        'Перевод текста':   { keys: ['ymd_tr_enabled', 'ymd_tr_online', 'ymd_tr_mode', 'ymd_tr_lang', 'ymd_tr_skip_en', 'ymd_tr_limit'] },
        'Скачивание':       { keys: ['ymd_quality_idx', 'ymd_quality_skip', 'ymd_skip_existing', 'ymd_notify_done', 'ymd_dl_conc', 'ymd_dl_covers', 'ymd_dl_dir'] },
        'Тегирование':      { keys: ['ymd_embed_tags', 'ymd_download_covers'], prefixes: ['ymd_tag_'] },
        'Косметика':        { keys: ['ymd_fullscreen', 'ymd_accent_color', 'ymd_vibe_anim', 'ymd_vibe_artist', 'ymd_vibe_bg', 'ymd_vibe_words', 'ymd_pl_menu_tall', 'ymd_pl_menu_height', 'ymd_slider_wheel'] },
        'Эффекты':          { prefixes: ['ymd_fx_'] },
        'Караоке':          { keys: ['ymd_kar_enabled', 'ymd_kar_active', 'ymd_kar_prefetch', 'ymd_instr_dl'] },
        'Автоскип':         { keys: ['ymd_as_enabled', 'ymd_as_record', 'ymd_as_label', 'ymd_pl_label', 'ymd_as_pl_keep', 'ymd_as_pl_sel', 'ymd_as_days', 'ymd_as_limit_days', 'ymd_as_limit'] }
    };
    function ymdTagOpts() {
        const o = {};
        for (const d of YMD_TAG_OPTS) {
            const v = GM_getValue('ymd_tag_' + d.key, d.def);
            o[d.key] = (v === undefined || v === null) ? d.def : !!v;
        }
        return o;
    }

    function ymdEmbedTagsOn() {
        const v = GM_getValue('ymd_embed_tags', undefined);
        if (v === undefined || v === null) {
            const legacy = GM_getValue('ymd_download_covers', undefined);
            return (legacy === undefined || legacy === null) ? true : !!legacy;
        }
        return !!v;
    }

    function ymdDlDirRefresh(ov) {
        const val = ov.querySelector('[data-role="dl-dir-val"]');
        if (val) { val.textContent = ymdDlDirShown(); val.title = ymdDlDirShown(); }
    }

    function ymdOpenSettingsView(tab) {
        if (document.getElementById('ymd-settings-overlay')) return;
        const full = tab === 'full';
        if (!document.getElementById('ymd-settings-style')) {
            const st = document.createElement('style');
            st.id = 'ymd-settings-style';
            st.textContent = tab ? ymdTabCssFilter(YMD_SETTINGS_CSS) : YMD_SETTINGS_CSS;
            (document.head || document.documentElement).appendChild(st);
        }
        const startEnabled = FCK.enabled;
        let fckOn = startEnabled;
        const tagState = ymdTagOpts();
        const embedOn = ymdEmbedTagsOn();
        const TAG_HINTS = {
            cover: 'Встраивает обложку в файл.<br>Для форматов без тегов обложка сохраняется отдельным файлом.',
            lyrics: 'Текст песни: берётся у Яндекса, а если его нет, из LRCLIB.',
            number: 'Номер трека вместе с общим количеством треков в альбоме.',
            disc: 'Номер диска вместе с общим количеством дисков в альбоме.',
            title: 'Название трека.',
            artist: 'Исполнитель трека.',
            album: 'Название альбома.',
            albumAsTitle: 'В тег альбома записывается название трека.<br>Удобно для синглов и сборников.<br>Работает только при включённом теге «Альбом».',
            genre: 'Жанр трека.',
            year: 'Год выхода.'
        };
        const tagRows = YMD_TAG_OPTS.map(d => {
            const off = !embedOn || (d.key === 'albumAsTitle' && !tagState.album);
            return '<div class="ymd-row' + (off ? ' ymd-row-disabled' : '') + '"><div><div class="ymd-label">' + d.label + '</div>' +
                '<div class="ymd-hint">' + (TAG_HINTS[d.key] || '') + '</div></div>' +
                '<button type="button" class="ymd-switch" role="switch" aria-checked="' + tagState[d.key] + '" aria-label="' + d.label + '" data-act="tag-toggle" data-key="' + d.key + '"' + (off ? ' disabled' : '') + '><span><i></i></span></button></div>';
        }).join('');

        const qIdx = ymdQualityIdx();
        const ver = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?';

        const ov = document.createElement('div');
        ov.id = 'ymd-settings-overlay';
        if (tab) ov.classList.add('ymd-tab');
        if (full) ov.classList.add('ymd-full');
        ov.innerHTML =
            '<div id="ymd-settings" role="dialog" aria-modal="true" aria-label="Настройки">' +
                '<div class="ymd-head"><span class="ymd-title">Настройки</span>' +
                    '<button type="button" class="ymd-close-x" data-act="close" aria-label="Закрыть"><svg width="24" height="24" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img"><path fill="currentColor" d="M19.207 6.207a1 1 0 0 0-1.414-1.414L12 10.586 6.207 4.793a1 1 0 0 0-1.414 1.414L10.586 12l-5.793 5.793a1 1 0 1 0 1.414 1.414L12 13.414l5.793 5.793a1 1 0 0 0 1.414-1.414L13.414 12z"></path></svg></button></div>' +
                '<div class="ymd-body">' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Токен</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Статус</div>' +
                        '<div class="ymd-hint" style="margin-bottom:.5rem">Токен (OAuth) позволяет скачивать полные треки.</div></div>' +
                        '<div class="ymd-token-status" data-role="token-status"></div></div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="token-auto" style="margin-top:2rem">Получить токен автоматически</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Скрипт запросит токен у вашей сессии на сайте. Разрешите всплывающие окна.</div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="token-set">Настроить токен</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Ручной ввод OAuth-токена, если автоматически получить его не удалось.</div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="token-reset">Сбросить токен</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Удаляет сохранённый токен. После этого получите или введите его заново.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">FckCensor</h3>' +
                    '<div class="ymd-row" style="margin-bottom:.5rem"><div>' +
                        '<div class="ymd-label">Обход цензуры</div>' +
                        '<div class="ymd-hint">Обход запикивания и цензуры.<br>Изменение применится после перезагрузки страницы.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="false" aria-label="FckCensor" data-act="fck-toggle"><span><i></i></span></button></div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="fck-refresh">Обновить список подмен</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Сразу загружает свежий список подмен.<br>Сам он обновляется раз в 12 часов.<br>Доступно, когда FckCensor включён.</div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="fck-reset">Сбросить список подмен</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Удаляет сохранённый список, и подмены перестают применяться.<br>Доступно, когда FckCensor включён.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Текстомузыка</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Тексты из LRCLIB</div>' +
                        '<div class="ymd-hint">Если Яндекс не отдаёт текст песни, он берётся из открытой базы LRCLIB.<br>При выключении скрипт к LRCLIB не обращается.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdLrclibOn() + '" aria-label="Текстомузыка" data-act="lrc-toggle"><span><i></i></span></button></div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Перевод текста</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Переводить текст песни</div>' +
                        '<div class="ymd-hint">Иностранные строки текста заменяются переводом на русский.<br>Работает при открытом тексте песни.<br>Применяется после перезагрузки страницы.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdTrOn() + '" aria-label="Переводить текст песни" data-act="tr-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Разрешить онлайн-перевод</div>' +
                        '<div class="ymd-hint">Сначала используется встроенный переводчик браузера (на устройстве).<br>Если он недоступен, текст песни отправляется в Google Translate.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdTrOnlineOn() + '" aria-label="Разрешить онлайн-перевод" data-act="tr-online"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Не переводить с английского</div>' +
                        '<div class="ymd-hint">Английские строки остаются как есть, переводятся только строки на других языках.<br>Язык определяется для каждой строки отдельно.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdTrSkipEnOn() + '" aria-label="Не переводить с английского" data-act="tr-skip-en"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Показывать оригинал рядом</div>' +
                        '<div class="ymd-hint">По умолчанию иностранная строка заменяется переводом.<br>Если включить, в строке будет «оригинал / перевод».</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + (ymdTrMode() === 'inline') + '" aria-label="Показывать оригинал рядом" data-act="tr-mode"><span><i></i></span></button></div>' +
                    ymdFxHtml([YMD_TR_LIMIT_DEF]) +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="tr-clear">Очистить кэш переводов</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Очистка не затрагивает остальные настройки.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Караоке</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Удаление голоса</div>' +
                        '<div class="ymd-hint">Показывает в плеере кнопку «Караоке». Когда кнопка включена, из песни убирается вокал и остаётся только музыка.<br>Трек обрабатывается в сервисе MVSEP: от нескольких десятков секунд до пары минут, в зависимости от очереди.<br>Пока идёт обработка, играет оригинал.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdKarFeatureOn() + '" aria-label="Удаление голоса" data-act="kar-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Заранее обрабатывать следующий трек</div>' +
                        '<div class="ymd-hint">Когда текущий трек уже обработан, следующий из очереди отправляется в MVSEP заранее, и голос убирается сразу после переключения.<br>Если вы пропустите трек, заранее запущенное задание отменяется, но запрос к MVSEP всё равно может быть потрачен.<br>Работает при включённом удалении голоса.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdKarPrefetchOn() + '" aria-label="Заранее обрабатывать следующий трек" data-act="kar-prefetch"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Скачивать треки без голоса</div>' +
                        '<div class="ymd-hint">Добавляет в окно скачивания пункты «Instrumental Lossless → FLAC» и «Instrumental High → MP3 (~320 kbps)».<br>Трек отправляется в MVSEP, и скачивается версия без голоса.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdInstrDlOn() + '" aria-label="Скачивать треки без голоса" data-act="instr-dl"><span><i></i></span></button></div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="kar-key">Настроить API-ключ MVSEP</button>' +
                    '<div class="ymd-hint ymd-btn-hint">Ключ из личного кабинета MVSEP. Без него удаление голоса не работает.<br>Для обработки трек отправляется на серверы MVSEP.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Скачивание</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Качество по умолчанию</div>' +
                        '<div class="ymd-hint">Lossless (FLAC), High (MP3 ~320 kbps) или Low (MP3 ~192 kbps).<br>Качество, выбранное в окне скачивания, тоже запоминается.</div></div>' +
                        '<button type="button" class="ymd-btn ymd-qsel" data-act="quality-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Качество по умолчанию"><span data-role="quality-label">' + QUALITY_OPTIONS[qIdx].label + '</span><svg class="ymd-qsel-arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Не спрашивать, качать сразу</div>' +
                        '<div class="ymd-hint">Окно выбора качества не будет показываться — скачивание стартует сразу с качеством по умолчанию.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdQualitySkip() + '" aria-label="Не спрашивать, качать сразу" data-act="quality-skip"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label" style="margin-top:.5rem">Пропускать уже скачанные</div>' +
                        '<div class="ymd-hint">Не качает заново треки, которые уже лежат в выбранной папке.<br>Только при массовой загрузке в браузерах на Chromium.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdSkipExistingOn() + '" aria-label="Пропускать уже скачанные" data-act="skip-existing"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label" style="margin-top:.5rem">Уведомление об окончании загрузки</div>' +
                        '<div class="ymd-hint">Системное уведомление, когда пакетная загрузка завершена.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdNotifyOn() + '" aria-label="Уведомление об окончании загрузки" data-act="notify-done"><span><i></i></span></button></div>' +
                    ymdFxHtml([YMD_DL_CONC_DEF]) +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label" style="margin-top:.5rem">Скачивать обложки</div>' +
                        '<div class="ymd-hint">Вместе с треком сохраняется обложка: встраивается в файл или, для форматов без тегов, кладётся отдельным файлом.<br>Если выключить, обложки не скачиваются совсем.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdDlCoversOn() + '" aria-label="Скачивать обложки" data-act="dl-covers"><span><i></i></span></button></div>' +
                    (ymdDlDirHasPicker() ?
                        '<div class="ymd-row" data-role="dl-dir-row"><div>' +
                            '<div class="ymd-label">Папка для скачивания</div>' +
                            '<div class="ymd-hint">Сюда сохраняются и одиночные, и массовые загрузки.<br>Никаких диалогов при скачивании не появляется.<br>По умолчанию: папка «Яндекс Музыка» в загрузках.</div>' +
                            '<div class="ymd-hint" data-role="dl-dir-val" style="word-break:break-all"></div></div>' +
                            '<div class="ymd-color-wrap">' +
                            '<button type="button" class="ymd-btn" data-act="dl-dir-pick">Выбрать</button></div></div>' : '') +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Тегирование</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Записывать теги в файл</div>' +
                        '<div class="ymd-hint">Главный переключатель: вшивать теги, обложку и текст в скачиваемые файлы.<br>Если выключен, тумблеры ниже неактивны.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + embedOn + '" aria-label="Встраивать теги" data-act="embed-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-sub">' + tagRows + '</div>' +
                '</section>' +
                '<section class="ymd-group"style="padding-bottom: 8px;">' +
                    '<h3 class="ymd-group-title">Косметика</h3>' +
                    '<div class="ymd-hint ymd-group-hint">Кастомизация страницы «Моя волна» и цветовой схемы сайта.</div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Фон</div>' +
                        '<div class="ymd-hint">Цветной градиентный фон страницы «Моя волна».<br>Если выключить, останется обычный фон сайта.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdVibeBgOn() + '" aria-label="Фон" data-act="vibe-bg-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Анимация</div>' +
                        '<div class="ymd-hint">Анимация виджета «Моей волны».</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdVibeAnimOn() + '" aria-label="Анимация" data-act="vibe-anim-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Карточка исполнителя</div>' +
                        '<div class="ymd-hint">Фотография исполнителя на странице «Моя волна».</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdVibeArtistOn() + '" aria-label="Карточка исполнителя" data-act="vibe-artist-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Рассказы ИИ</div>' +
                        '<div class="ymd-hint">Блок «Рассказы ИИ» на странице «Моя волна».</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdVibeWordsOn() + '" aria-label="Рассказы ИИ" data-act="vibe-words-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Цветовая схема</div>' +
                        '<div class="ymd-hint">Заменяет фирменный жёлтый цвет сайта на выбранный.<br>Кнопка «Сбросить» возвращает родной жёлтый.</div></div>' +
                        '<div class="ymd-color-wrap"><button type="button" class="ymd-btn" data-act="accent-reset">Сбросить</button>' +
                        '<button type="button" class="ymd-color-btn" data-act="accent-menu" aria-haspopup="dialog" aria-expanded="false" aria-label="Цветовая схема" style="background:' + (ymdAccentColor() || YMD_DEFAULT_ACCENT) + '"></button></div></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Высота меню плейлистов</div>' +
                        '<div class="ymd-hint">Фиксированная высота меню «Добавить в плейлист», список внутри прокручивается.<br>Высота задаётся ползунком ниже (200–900 px).</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdPlMenuTallOn() + '" aria-label="Высота меню плейлистов" data-act="pl-menu-tall"><span><i></i></span></button></div>' +
                    '<div class="ymd-row ymd-range-row' + (ymdPlMenuTallOn() ? '' : ' ymd-row-disabled') + '" data-role="pl-menu-height-row">' +
                        '<input type="range" class="ymd-range" data-role="pl-menu-height" aria-label="Высота меню плейлистов" min="' + YMD_PL_MENU_H_MIN + '" max="' + YMD_PL_MENU_H_MAX + '" step="' + YMD_PL_MENU_H_STEP + '" value="' + ymdPlMenuHeight() + '" style="--ymd-fill:' + ymdPlMenuFillPct(ymdPlMenuHeight()) + '"' + (ymdPlMenuTallOn() ? '' : ' disabled') + '>' +
                        '<span class="ymd-range-val" data-role="pl-menu-height-val">' + ymdPlMenuHeight() + ' px</span></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Управление ползунками колёсиком</div>' +
                        '<div class="ymd-hint">Колёсико мыши над ползунком в настройках меняет его значение.<br>Когда выключено, колёсико просто прокручивает страницу.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdSliderWheelOn() + '" aria-label="Управление ползунками колёсиком" data-act="slider-wheel-toggle"><span><i></i></span></button></div>' +
                    (!ymdIsDesktopShim() ? '' : '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Полноэкранный режим как в браузере</div>' +
                        '<div class="ymd-hint">Окно занимает весь экран без рамки и кнопок.<br>F11 включает и выключает режим, Esc выходит из него.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdFsOn() + '" aria-label="Полноэкранный режим как в браузере" data-act="fullscreen-toggle"><span><i></i></span></button></div>') +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Эффекты</h3>' +
                    ymdFxHtml() +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Нормализация громкости</div>' +
                        '<div class="ymd-hint">Выравнивает громкость треков: тихие места подтягиваются, пики ограничиваются.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdFxNormOn() + '" aria-label="Нормализация громкости" data-act="fx-norm-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-hint ymd-group-hint">* Правая кнопка мыши возвращает значения по умолчанию.<br>Эффекты работают только в плеере и не меняют скачиваемые файлы.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Автоскип</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Записывать историю прослушиваний</div>' +
                        '<div class="ymd-hint">Трек записывается, когда проиграна половина.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdAsRecOn() + '" aria-label="Записывать историю прослушиваний" data-act="as-rec-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label" style="margin-top:.5rem">Скипать недавно игравшее</div>' +
                        '<div class="ymd-hint">Переключает на следующий трек, если он уже играл за выбранный срок.<br>Скипы в «Моей волне» могут влиять на рекомендации.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdAsOn() + '" aria-label="Скипать недавно игравшее" data-act="as-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Не скипать треки из плейлистов</div>' +
                        '<div class="ymd-hint">Трек из выбранных ниже плейлистов не пропускается, даже если играл недавно.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdAsPlKeepOn() + '" aria-label="Не скипать треки из плейлистов" data-act="as-pl-keep"><span><i></i></span></button></div>' +
                    '<div class="ymd-row' + (ymdAsPlKeepOn() ? '' : ' ymd-row-disabled') + '" data-role="aspl-row"><div>' +
                        '<div class="ymd-label">Плейлисты-исключения</div>' +
                        '<div class="ymd-hint">Выберите плейлисты, треки из которых не пропускать.<br>Если ничего не выбрано, исключений нет.</div></div>' +
                        '<button type="button" class="ymd-btn ymd-qsel" data-act="aspl-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Плейлисты-исключения"' + (ymdAsPlKeepOn() ? '' : ' disabled') + '><span data-role="aspl-label">' + ymdAsPlLabelText() + '</span><svg class="ymd-qsel-arrow" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
                    ymdFxHtml([YMD_AS_DAYS_DEF]) +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Хранить относительно выбранных дней</div>' +
                        '<div class="ymd-hint">Записи старше срока «Не повторять в течение» удаляются из истории.<br>Лимит записей при этом не действует.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdAsByDaysOn() + '" aria-label="Хранить относительно выбранных дней" data-act="as-limit-days"><span><i></i></span></button></div>' +
                    ymdFxHtml([YMD_AS_LIMIT_DEF]) +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Показывать, когда трек играл</div>' +
                        '<div class="ymd-hint">Пометка «Последний раз трек играл …» в «Моей волне», большом и нижнем плеере.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdAsLabelOn() + '" aria-label="Показывать, когда трек играл" data-act="as-label-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Показывать плейлист трека</div>' +
                        '<div class="ymd-hint">Если трек есть в ваших плейлистах, рядом появится их название.</div></div>' +
                        '<button type="button" class="ymd-switch" role="switch" aria-checked="' + ymdPlOn() + '" aria-label="Показывать плейлист трека" data-act="pl-label-toggle"><span><i></i></span></button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label" style="margin-top:.5rem">История прослушиваний</div>' +
                        '<div class="ymd-hint" data-role="as-count"></div>' +
                        '<div class="ymd-hint">Экспорт сохраняет историю в файл yandex_music_history.json, импорт добавляет записи из такого файла.</div></div>' +
                        '<div class="ymd-color-wrap"><button type="button" class="ymd-btn" data-act="as-export">Экспорт</button>' +
                        '<button type="button" class="ymd-btn" data-act="as-import">Импорт</button></div></div>' +
                    '<button type="button" class="ymd-btn ymd-btn-wide" data-act="as-clear" style="margin-top:8px">Очистить историю</button>' +
                    '<input type="file" accept=".json,application/json" data-role="as-file" style="display:none">' +
                    '<div class="ymd-hint ymd-btn-hint">Удаляет все записи после подтверждения.<br>Действие необратимо, перед очисткой можно сделать экспорт.</div>' +
                '</section>' +
                '<section class="ymd-group">' +
                    '<h3 class="ymd-group-title">Резервная копия</h3>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Плейлисты и «Мне нравится»</div>' +
                        '<div class="ymd-hint">Выберите плейлисты для экспорта.<br>Если ничего не выбрано, экспортировать нечего.</div></div>' +
                        '<button type="button" class="ymd-btn ymd-qsel" data-act="bkpl-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Плейлисты для копии"><span data-role="bkpl-label">' + ymdBkLabelText() + '</span>' + YMD_BK_ARROW + '</button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Формат файла</div>' +
                        '<div class="ymd-hint">Импорт принимает только JSON, CSV и M3U8 подходят для переноса в другие сервисы, M3U8 сохраняется отдельным файлом на каждый плейлист.</div></div>' +
                        '<button type="button" class="ymd-btn ymd-qsel" data-act="bkfmt-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Формат файла"><span data-role="bkfmt-label">' + ymdEscHtml(ymdBkFmt().title) + '</span>' + YMD_BK_ARROW + '</button></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Копия плейлистов</div>' +
                        '<div class="ymd-hint">Экспорт сохраняет выбранные плейлисты в файл.<br>Импорт из JSON создаёт плейлисты заново в вашем аккаунте и добавляет лайки.</div></div>' +
                        '<div class="ymd-color-wrap"><button type="button" class="ymd-btn" data-act="bk-export">Экспорт</button>' +
                        '<button type="button" class="ymd-btn" data-act="bk-import">Импорт</button></div></div>' +
                    '<div class="ymd-row"><div>' +
                        '<div class="ymd-label">Все настройки</div>' +
                        '<div class="ymd-hint">Сохраняет все настройки в файл JSON и загружает их обратно.<br>Токен, списки FckCensor и плейлистов и история прослушиваний не включаются. Импорт перезагрузит страницу.</div></div>' +
                        '<div class="ymd-color-wrap"><button type="button" class="ymd-btn" data-act="cfg-export">Экспорт</button>' +
                        '<button type="button" class="ymd-btn" data-act="cfg-import">Импорт</button></div></div>' +
                    '<input type="file" accept=".json,application/json" data-role="cfg-file" style="display:none">' +
                    '<input type="file" accept=".json,application/json" data-role="bk-file" style="display:none">' +
                '</section>' +
                '</div>' +
                '<div class="ymd-footer">' +
                    '<div class="ymd-footer-row"><button type="button" class="ymd-btn" data-act="reset-settings" title="Сбрасывает настройки скрипта, токен не затрагивается">Сбросить настройки</button>' +
                    '<div class="ymd-version-wrap"><span class="ymd-version">Версия ' + ver + '</span>' +
                    (ymdIsDesktopShim() ? '<button type="button" class="ymd-btn" data-act="upd-check">Проверить обновления</button>' : '') +
                    '</div></div>' +
                    '<div class="ymd-hint ymd-footer-hint">Возвращает все настройки к значениям по умолчанию. Токены, кэш списка FckCensor и история прослушиваний остаются.</div>' +
                    '<div class="ymd-links">' +
                        '<a href="https://github.com/frostbittenbull" target="_blank" rel="noopener noreferrer">Автор: #frostbittenbull</a>' +
                        '<a href="https://github.com/frostbittenbull/Yandex-Music-Plus-Unlocker-Downloader" target="_blank" rel="noopener noreferrer">Страница проекта</a>' +
                        '<a href="https://boosty.to/prodbyinstinct/donate" target="_blank" rel="noopener noreferrer">Поблагодарить</a>' +
                    '</div>' +
                '</div>' +
            '</div>';
        ov.querySelectorAll('.ymd-body > .ymd-group').forEach((g) => {
            const t = g.querySelector('.ymd-group-title');
            if (!t || !YMD_GROUP_RESET[t.textContent.trim()]) return;
            const w = document.createElement('div');
            w.className = 'ymd-group-reset';
            w.innerHTML = '<button type="button" class="ymd-btn" data-act="group-reset">Сбросить раздел</button>';
            g.appendChild(w);
        });

        const searchEl = document.createElement('div');
        searchEl.className = 'ymd-search';
        searchEl.innerHTML =
            '<div class="AnimatedSearchInput_root__9y1dF ymd-search-root" style="--q2v-accent-color:var(--ym-controls-color-primary-default-enabled,#ffff00)">' +
                '<div class="kAYDswAvA1AJoAzRV4rY i690pcQGptnPbYcI77fh YBgyycmmzZchX_EgLcrA AnimatedSearchInput_searchInput__fhfbv">' +
                    '<svg class="LoJPNHBhYAkQh7hBQYIP AnimatedSearchInput_searchInputContent___J4zD UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#search_xs"></use></svg>' +
                    '<input class="GRggPQ1rZgvcyCxPPgvw QYgjNkDJ7XdqE28ipieh AnimatedSearchInput_searchInputContent___J4zD ymd-search-input" type="search" placeholder="Поиск по настройкам" aria-label="Поиск по настройкам" autocomplete="off" spellcheck="false" value="">' +
                    '<div class="XsBFSZAjR3ZRN8oqetex AnimatedSearchInput_searchInputContent___J4zD ymd-sr-hide" data-role="search-clear">' +
                        '<button class="cpeagBA1_PblpJn8Xgtv iJVAJMgccD4vj4E4o068 uwk3hfWzB2VT7kE13SQk IlG7b1K0AD7E7AMx6F5p nHWc2sto1C6Gm0Dpw_l0 eQt33MLDiQ6DRSuLaYEp qU2apWBO1yyEK0lZ3lPO sGZaYJkCxVIV1wkix81s" type="button" aria-label="Очистить поиск">' +
                            '<span class="JjlbHZ4FaP9EAcR_1DxF"><svg class="J9wTKytjOWG73QMoN5WP l3tE1hAMmBj2aoPPwU08" focusable="false" color="gray" aria-hidden="true"><use xlink:href="/icons/sprite.svg#close_xxs"></use></svg></span>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="ymd-hint ymd-search-empty ymd-sr-hide">Ничего не найдено.</div>';
        const searchIn = searchEl.querySelector('input');
        const searchClear = searchEl.querySelector('[data-role="search-clear"]');
        const searchEmpty = searchEl.querySelector('.ymd-search-empty');
        const searchPanel = ov.querySelector('#ymd-settings');
        searchPanel.insertBefore(searchEl, searchPanel.querySelector('.ymd-body'));
        const srNorm = (x) => String(x || '').toLowerCase().replace(/ё/g, 'е');
        const srIdx = Array.from(ov.querySelectorAll('.ymd-body > .ymd-group')).map((g) => {
            const units = [];
            const meta = [];
            let cur = null;
            const add = (el) => { cur = { els: [el], text: '' }; units.push(cur); };
            for (const el of Array.from(g.children)) {
                const c = el.classList;
                if (c.contains('ymd-group-title') || c.contains('ymd-group-reset')) continue;
                if (c.contains('ymd-sub')) {
                    cur = null;
                    Array.from(el.children).forEach((r) => units.push({ els: [r], text: '' }));
                    continue;
                }
                if (c.contains('ymd-group-hint')) { meta.push(el); continue; }
                if ((c.contains('ymd-row') && !c.contains('ymd-range-row')) || c.contains('ymd-fx') || (el.tagName === 'BUTTON' && c.contains('ymd-btn-wide'))) { add(el); continue; }
                if (cur) cur.els.push(el); else meta.push(el);
            }
            units.forEach((u) => { u.text = srNorm(u.els.map((e) => e.textContent).join(' ')); });
            const t = g.querySelector('.ymd-group-title');
            return {
                g, units, meta,
                title: srNorm(t ? t.textContent : ''),
                subs: Array.from(g.querySelectorAll(':scope > .ymd-sub')),
                reset: g.querySelector(':scope > .ymd-group-reset')
            };
        });
        const applySearch = () => {
            const words = srNorm(searchIn.value).trim().split(/\s+/).filter(Boolean);
            const hit = (txt) => words.every((w) => txt.includes(w));
            let any = false;
            srIdx.forEach((it, gi) => {
                if (!words.length) {
                    it.g.classList.remove('ymd-sr-hide');
                    it.units.forEach((u) => u.els.forEach((e) => e.classList.remove('ymd-sr-hide')));
                    it.meta.forEach((e) => e.classList.remove('ymd-sr-hide'));
                    it.subs.forEach((e) => e.classList.remove('ymd-sr-hide'));
                    if (it.reset) it.reset.classList.remove('ymd-sr-hide');
                    if (tab) it.g.hidden = gi !== (ov._ymdTabIdx || 0);
                    return;
                }
                const all = hit(it.title);
                let shown = 0;
                it.units.forEach((u) => {
                    const on = all || hit(u.text);
                    u.els.forEach((e) => e.classList.toggle('ymd-sr-hide', !on));
                    if (on) shown++;
                });
                it.subs.forEach((sb) => sb.classList.toggle('ymd-sr-hide', !Array.from(sb.children).some((r) => !r.classList.contains('ymd-sr-hide'))));
                const gOn = all || shown > 0;
                it.g.classList.toggle('ymd-sr-hide', !gOn);
                it.meta.forEach((e) => e.classList.toggle('ymd-sr-hide', !gOn));
                if (it.reset) it.reset.classList.add('ymd-sr-hide');
                if (tab) it.g.hidden = !gOn;
                if (gOn) any = true;
            });
            searchEmpty.classList.toggle('ymd-sr-hide', !(words.length && !any));
            searchClear.classList.toggle('ymd-sr-hide', !searchIn.value);
        };
        searchClear.addEventListener('click', () => { ov._ymdSearch.clear(); searchIn.focus(); });
        searchIn.addEventListener('input', () => {
            applySearch();
            const sc = tab ? ov.querySelector('[class*="SettingsPage_scrollableContainer"]') : ov.querySelector('.ymd-body');
            if (sc) sc.scrollTop = 0;
        });
        ov._ymdSearch = { clear: () => { if (searchIn.value) { searchIn.value = ''; applySearch(); } } };

        if (tab) ymdTabMount(ov);
        else (document.body || document.documentElement).appendChild(ov);
        ymdDlDirRefresh(ov);

        ymdFxBind(ov);
        const asFile = ov.querySelector('[data-role="as-file"]');
        if (asFile) asFile.addEventListener('change', ymdAsImport);
        const cfgFile = ov.querySelector('[data-role="cfg-file"]');
        if (cfgFile) cfgFile.addEventListener('change', ymdCfgImport);
        const bkFile = ov.querySelector('[data-role="bk-file"]');
        if (bkFile) bkFile.addEventListener('change', ymdBkImport);
        ymdAsUpdateCount();
        const sw = ov.querySelector('[data-act="fck-toggle"]');
        const refresh = ov.querySelector('[data-act="fck-refresh"]');
        const resetBtn = ov.querySelector('[data-act="fck-reset"]');
        const sync = () => { sw.setAttribute('aria-checked', String(fckOn)); refresh.disabled = !fckOn; resetBtn.disabled = !fckOn; };
        sync();

        const refreshToken = () => {
            const t = GM_getValue('ymd_oauth_token', null);
            const ok = typeof t === 'string' && t.length > 10;
            const el = ov.querySelector('[data-role="token-status"]');
            if (!el) return;
            el.textContent = ok ? '● токен есть' : '● токена нет';
            el.className = 'ymd-token-status ' + (ok ? 'ok' : 'no');
        };
        refreshToken();
        const tokenTimer = setInterval(refreshToken, 1000);

        const applyTagState = () => {
            const master = ov.querySelector('[data-act="embed-toggle"]').getAttribute('aria-checked') === 'true';
            ov.querySelectorAll('[data-act="tag-toggle"]').forEach(sw2 => {
                let off = !master;
                if (sw2.dataset.key === 'albumAsTitle') {
                    const alb = ov.querySelector('[data-act="tag-toggle"][data-key="album"]');
                    if (alb && alb.getAttribute('aria-checked') !== 'true') off = true;
                }
                sw2.disabled = off;
                sw2.closest('.ymd-row').classList.toggle('ymd-row-disabled', off);
            });
        };

        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            clearInterval(tokenTimer);
            closeQMenu(false);
            closePMenu(false);
            closeCPop(false);
            document.removeEventListener('scroll', onDocScroll, true);
            const fullRoot = document.getElementById('ymd-full-root');
            if (fullRoot) fullRoot.remove(); else ov.remove();
            if (fckOn !== startEnabled) location.reload();
        };
        let qMenu = null;
        const closeQMenu = (refocus) => {
            if (!qMenu) return false;
            qMenu.remove();
            qMenu = null;
            window.removeEventListener('resize', onQReflow, true);
            const trg = ov.querySelector('[data-act="quality-menu"]');
            if (trg) { trg.setAttribute('aria-expanded', 'false'); if (refocus) trg.focus(); }
            return true;
        };
        const onQReflow = () => closeQMenu(false);
        const openQMenu = (trg) => {
            const cur = ymdQualityIdx();
            const check = '<svg class="J9wTKytjOWG73QMoN5WP elJfazUBui03YWZgHCbW vqAVPWFJlhAOleK_SLk4 l3tE1hAMmBj2aoPPwU08" width="16" height="16" viewBox="0 0 16 16" focusable="false" aria-hidden="true" style="width:1rem;height:1rem;margin-inline-start:auto;margin-inline-end:0"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const items = QUALITY_OPTIONS.map((q, i) =>
                '<button class="cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C EiyUV4aCJzpfNzuihfMM" type="button" role="menuitemradio" tabindex="-1" aria-checked="' + (i === cur) + '" data-act="quality-pick" data-idx="' + i + '">' +
                '<span class="JjlbHZ4FaP9EAcR_1DxF" style="width:100%">' + q.label + (i === cur ? check : '') + '</span></button>'
            ).join('');
            qMenu = document.createElement('div');
            qMenu.id = 'ymd-quality-menu';
            qMenu.className = 's7_MO4NdsYs7nPQALD8W ymd-done-menu';
            qMenu.setAttribute('role', 'menu');
            qMenu.setAttribute('tabindex', '-1');
            qMenu.setAttribute('aria-orientation', 'vertical');
            qMenu.innerHTML = '<div class="ggP7WX2_erziDHFOo32s">' + items + '</div>';
            ov.appendChild(qMenu);
            const r = trg.getBoundingClientRect();
            const mw = Math.max(qMenu.offsetWidth, r.width);
            const mh = qMenu.offsetHeight;
            let left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
            let top = r.bottom + 4;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
            qMenu.style.left = left + 'px';
            qMenu.style.top = top + 'px';
            qMenu.style.minWidth = r.width + 'px';
            trg.setAttribute('aria-expanded', 'true');
            window.addEventListener('resize', onQReflow, true);
            const btns = qMenu.querySelectorAll('button[role="menuitemradio"]');
            (btns[cur] || btns[0]).focus();
        };
        let pMenu = null, pMode = 'as';
        const P_MODES = {
            as:  { act: 'aspl-menu',  get: ymdAsPlSelected, key: 'ymd_as_pl_sel' },
            bk:  { act: 'bkpl-menu',  get: ymdBkSelected,   key: 'ymd_bk_pl_sel' },
            fmt: { act: 'bkfmt-menu' }
        };
        const closePMenu = (refocus) => {
            if (!pMenu) return false;
            pMenu.remove();
            pMenu = null;
            window.removeEventListener('resize', onPReflow, true);
            const trg = ov.querySelector('[data-act="' + P_MODES[pMode].act + '"]');
            if (trg) { trg.setAttribute('aria-expanded', 'false'); if (refocus) trg.focus(); }
            return true;
        };
        const onPReflow = () => closePMenu(false);
        const paintPLabel = () => {
            const lbl = ov.querySelector('[data-role="aspl-label"]');
            if (lbl) lbl.textContent = ymdAsPlLabelText();
            const lbl2 = ov.querySelector('[data-role="bkpl-label"]');
            if (lbl2) lbl2.textContent = ymdBkLabelText();
            const lbl3 = ov.querySelector('[data-role="bkfmt-label"]');
            if (lbl3) lbl3.textContent = ymdBkFmt().title;
        };
        const renderPItems = () => {
            if (!pMenu) return;
            const check = '<svg width="16" height="16" viewBox="0 0 16 16" focusable="false" aria-hidden="true" style="width:1rem;height:1rem;margin-inline-start:auto;margin-inline-end:0"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            const lists = ymdPlReadCache().lists;
            const kinds = Object.keys(lists);
            const sel = new Set(pMode === 'fmt' ? [ymdBkFmt().key] : P_MODES[pMode].get());
            const items = pMode === 'fmt' ? YMD_BK_FMTS.map(f => {
                const on = sel.has(f.key);
                return '<button class="cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C EiyUV4aCJzpfNzuihfMM" type="button" role="menuitemradio" tabindex="-1" aria-checked="' + on + '" data-act="aspl-pick" data-kind="' + ymdEscHtml(f.key) + '">' +
                    '<span class="JjlbHZ4FaP9EAcR_1DxF" style="width:100%">' + ymdEscHtml(f.title) + (on ? check : '') + '</span></button>';
            }).join('') : kinds.length ? kinds.map(k => {
                const on = sel.has(k);
                return '<button class="cpeagBA1_PblpJn8Xgtv UDMYhpDjiAFT3xUx268O dgV08FKVLZKFsucuiryn IlG7b1K0AD7E7AMx6F5p HbaqudSqu7Q3mv3zMPGr qU2apWBO1yyEK0lZ3lPO kc5CjvU5hT9KEj0iTt3C EiyUV4aCJzpfNzuihfMM" type="button" role="menuitemcheckbox" tabindex="-1" aria-checked="' + on + '" data-act="aspl-pick" data-kind="' + ymdEscHtml(k) + '">' +
                    '<span class="JjlbHZ4FaP9EAcR_1DxF" style="width:100%">' + ymdEscHtml(lists[k].title) + (on ? check : '') + '</span></button>';
            }).join('') : '<div class="ymd-hint" style="padding:.75rem 1rem">' + (plLoading ? 'Загрузка плейлистов…' : 'Плейлисты не найдены') + '</div>';
            const top = pMenu.scrollTop;
            const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.kind : null;
            pMenu.innerHTML = '<div class="ggP7WX2_erziDHFOo32s">' + items + '</div>';
            pMenu.scrollTop = top;
            if (fk) {
                const f = Array.from(pMenu.querySelectorAll('button')).find(x => x.dataset.kind === fk);
                if (f) f.focus();
            }
        };
        const openPMenu = (trg, mode) => {
            pMode = mode || 'as';
            pMenu = document.createElement('div');
            pMenu.id = 'ymd-aspl-menu';
            pMenu.className = 's7_MO4NdsYs7nPQALD8W ymd-done-menu';
            pMenu.setAttribute('role', 'menu');
            pMenu.setAttribute('tabindex', '-1');
            pMenu.setAttribute('aria-orientation', 'vertical');
            ov.appendChild(pMenu);
            renderPItems();
            const r = trg.getBoundingClientRect();
            const mw = Math.max(pMenu.offsetWidth, r.width);
            const mh = pMenu.offsetHeight;
            const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
            let top = r.bottom + 4;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
            pMenu.style.left = left + 'px';
            pMenu.style.top = top + 'px';
            pMenu.style.minWidth = r.width + 'px';
            trg.setAttribute('aria-expanded', 'true');
            window.addEventListener('resize', onPReflow, true);
            const first = pMenu.querySelector('button');
            if (first) first.focus(); else pMenu.focus();
            if (pMode !== 'fmt') Promise.resolve(ymdPlEnsure(false)).then(() => {
                if (pMenu) renderPItems();
                paintPLabel();
            });
        };
        let cPop = null;
        const closeCPop = (refocus) => {
            if (!cPop) return false;
            cPop.remove();
            cPop = null;
            window.removeEventListener('resize', onCReflow, true);
            const trg = ov.querySelector('[data-act="accent-menu"]');
            if (trg) { trg.setAttribute('aria-expanded', 'false'); if (refocus) trg.focus(); }
            return true;
        };
        const onCReflow = () => closeCPop(false);
        const paintAccentBtn = () => {
            const t = ov.querySelector('[data-act="accent-menu"]');
            if (t) t.style.background = ymdAccentColor() || YMD_DEFAULT_ACCENT;
        };
        const openCPop = (trg) => {
            let hsv = ymdHex2Hsv(ymdAccentColor() || YMD_DEFAULT_ACCENT);
            cPop = document.createElement('div');
            cPop.id = 'ymd-color-pop';
            cPop.setAttribute('role', 'dialog');
            cPop.setAttribute('aria-label', 'Выбор цвета');
            cPop.innerHTML =
                '<div class="ymd-sv" data-role="sv"><i class="ymd-thumb"></i></div>' +
                '<div class="ymd-hue" data-role="hue"><i class="ymd-thumb"></i></div>' +
                '<input type="text" class="ymd-hex" data-role="hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="HEX">' +
                '<div class="ymd-presets">' + YMD_ACCENT_PRESETS.map(c =>
                    '<button type="button" class="ymd-preset" data-act="accent-preset" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') + '</div>';
            ov.appendChild(cPop);
            const sv = cPop.querySelector('[data-role="sv"]');
            const hue = cPop.querySelector('[data-role="hue"]');
            const hexIn = cPop.querySelector('[data-role="hex"]');
            const render = (save, skipHex) => {
                const hex = ymdHsv2Hex(hsv.h, hsv.s, hsv.v);
                sv.style.backgroundColor = ymdHsv2Hex(hsv.h, 1, 1);
                const st = sv.firstChild.style;
                st.left = (hsv.s * 100) + '%';
                st.top = ((1 - hsv.v) * 100) + '%';
                st.background = hex;
                hue.firstChild.style.left = (hsv.h / 360 * 100) + '%';
                hue.firstChild.style.background = ymdHsv2Hex(hsv.h, 1, 1);
                if (!skipHex) hexIn.value = hex;
                if (save) { GM_setValue('ymd_accent_color', hex); ymdApplyAccent(); paintAccentBtn(); }
            };
            const drag = (el, fn) => {
                const move = (e) => {
                    const r = el.getBoundingClientRect();
                    fn(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
                };
                el.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    el.setPointerCapture(e.pointerId);
                    move(e);
                    const up = () => {
                        el.removeEventListener('pointermove', move);
                        el.removeEventListener('pointerup', up);
                        el.removeEventListener('pointercancel', up);
                    };
                    el.addEventListener('pointermove', move);
                    el.addEventListener('pointerup', up);
                    el.addEventListener('pointercancel', up);
                });
            };
            drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y; render(true); });
            drag(hue, (x) => { hsv.h = x * 360; render(true); });
            hexIn.addEventListener('input', () => {
                let v = hexIn.value.trim().toLowerCase();
                if (v && v[0] !== '#') v = '#' + v;
                if (/^#[0-9a-f]{6}$/.test(v)) { hsv = ymdHex2Hsv(v); render(true, true); }
            });
            cPop._set = (hex) => { hsv = ymdHex2Hsv(hex); render(true); };
            render(false);
            const r = trg.getBoundingClientRect();
            const mw = cPop.offsetWidth, mh = cPop.offsetHeight;
            cPop.style.left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8) + 'px';
            let top = r.bottom + 4;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
            cPop.style.top = top + 'px';
            trg.setAttribute('aria-expanded', 'true');
            window.addEventListener('resize', onCReflow, true);
        };
        const onKey = (e) => {
            const am = (qMenu && qMenu.contains(document.activeElement)) ? qMenu : ((pMenu && pMenu.contains(document.activeElement)) ? pMenu : null);
            if (am && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault(); e.stopPropagation();
                const btns = Array.from(am.querySelectorAll('button'));
                const i = btns.indexOf(document.activeElement);
                btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus();
                return;
            }
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (document.activeElement === searchIn && searchIn.value) { e.preventDefault(); ov._ymdSearch.clear(); return; }
                if (closeCPop(true)) return;
                if (closePMenu(true)) return;
                if (closeQMenu(true)) return;
                if (!tab || full) close();
            }
        };
        document.addEventListener('keydown', onKey, true);

        ov.addEventListener('mousedown', (e) => {
            if (cPop && !cPop.contains(e.target) && !e.target.closest('[data-act="accent-menu"]')) closeCPop(false);
            if (pMenu && !pMenu.contains(e.target) && !e.target.closest('[data-act="aspl-menu"],[data-act="bkpl-menu"],[data-act="bkfmt-menu"]')) closePMenu(false);
            if (qMenu && !qMenu.contains(e.target) && !e.target.closest('[data-act="quality-menu"]')) {
                closeQMenu(false);
                if (e.target === ov) return;
            }
            if (e.target === ov && !tab) close();
        });
        ov.querySelector('.ymd-body').addEventListener('scroll', () => { closeQMenu(false); closePMenu(false); closeCPop(false); }, { passive: true });
        const onDocScroll = (e) => {
            closeQMenu(false);
            closeCPop(false);
            if (!pMenu || !(e.target instanceof Node) || !pMenu.contains(e.target)) closePMenu(false);
        };
        if (tab) document.addEventListener('scroll', onDocScroll, { capture: true, passive: true });
        ov.addEventListener('wheel', (e) => {
            const r = e.target.closest ? e.target.closest('[data-role="pl-menu-height"]') : null;
            if (!r || r.disabled || !ymdSliderWheelOn()) return;
            e.preventDefault();
            const stp = Number(r.step) || 1;
            const v = Math.min(Number(r.max), Math.max(Number(r.min), Number(r.value) + (e.deltaY < 0 ? stp : -stp)));
            r.value = String(v);
            r.dispatchEvent(new Event('input', { bubbles: true }));
        }, { passive: false });
        ov.addEventListener('input', (e) => {
            const r = e.target.closest ? e.target.closest('[data-role="pl-menu-height"]') : null;
            if (!r || r.disabled) return;
            const h = Math.min(YMD_PL_MENU_H_MAX, Math.max(YMD_PL_MENU_H_MIN, Math.round(Number(r.value)) || YMD_PL_MENU_H_DEF));
            GM_setValue('ymd_pl_menu_height', h);
            r.style.setProperty('--ymd-fill', ymdPlMenuFillPct(h));
            const val = ov.querySelector('[data-role="pl-menu-height-val"]');
            if (val) val.textContent = h + ' px';
            ymdApplyPlMenuHeight();
        });
        ov.addEventListener('click', (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            switch (b.dataset.act) {
                case 'close':       close(); break;
                case 'quality-menu': {
                    if (qMenu) closeQMenu(false); else openQMenu(b);
                    break;
                }
                case 'aspl-menu':
                case 'bkpl-menu':
                case 'bkfmt-menu': {
                    const mode = b.dataset.act === 'bkpl-menu' ? 'bk' : (b.dataset.act === 'bkfmt-menu' ? 'fmt' : 'as');
                    if (pMenu && pMode === mode) closePMenu(false);
                    else { if (pMenu) closePMenu(false); openPMenu(b, mode); }
                    break;
                }
                case 'aspl-pick': {
                    const k = String(b.dataset.kind);
                    if (pMode === 'fmt') {
                        GM_setValue('ymd_bk_fmt', k);
                        paintPLabel();
                        closePMenu(true);
                        break;
                    }
                    const sel = P_MODES[pMode].get();
                    const i = sel.indexOf(k);
                    if (i >= 0) sel.splice(i, 1); else sel.push(k);
                    GM_setValue(P_MODES[pMode].key, JSON.stringify(sel));
                    renderPItems();
                    paintPLabel();
                    break;
                }
                case 'bk-export': ymdBkExport(); break;
                case 'bk-import': { const f = ov.querySelector('[data-role="bk-file"]'); if (f) f.click(); break; }
                case 'quality-pick': {
                    const idx = Number(b.dataset.idx);
                    if (Number.isInteger(idx) && idx >= 0 && idx < QUALITY_OPTIONS.length) {
                        GM_setValue('ymd_quality_idx', idx);
                        const lbl = ov.querySelector('[data-role="quality-label"]');
                        if (lbl) lbl.textContent = QUALITY_OPTIONS[idx].label;
                    }
                    closeQMenu(true);
                    break;
                }
                case 'slider-wheel-toggle': { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_slider_wheel', on); b.setAttribute('aria-checked', String(on)); break; }
                case 'fullscreen-toggle': { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_fullscreen', on); b.setAttribute('aria-checked', String(on)); ymdFsApply(on); break; }
                case 'fck-toggle':  fckOn = !fckOn; GM_setValue('ymd_fck_enabled', fckOn); sync(); break;
                case 'fck-refresh': fckRefreshList(true); break;
                case 'fck-reset': fckResetList(); break;
                case 'tr-toggle': { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_tr_enabled', on); b.setAttribute('aria-checked', String(on)); break; }
                case 'tr-online': { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_tr_online', on); b.setAttribute('aria-checked', String(on)); break; }
                case 'tr-skip-en': { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_tr_skip_en', on); b.setAttribute('aria-checked', String(on)); break; }
                case 'tr-mode':   { const on = b.getAttribute('aria-checked') !== 'true'; GM_setValue('ymd_tr_mode', on ? 'inline' : 'replace'); b.setAttribute('aria-checked', String(on)); break; }
                case 'tr-clear':  ymdTrCacheClear().then(() => ymdToast(false, ['Кэш переводов очищен'])); break;
                case 'lrc-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_lrclib_enabled', on);
                    b.setAttribute('aria-checked', String(on));
                    break;
                }
                case 'as-rec-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_as_record', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdAsRecheck();
                    break;
                }
                case 'as-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_as_enabled', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdAsRecheck();
                    break;
                }
                case 'as-limit-days': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_as_limit_days', on);
                    b.setAttribute('aria-checked', String(on));
                    const limBox = ov.querySelector('.ymd-fx[data-fx="asLimit"]');
                    if (limBox) {
                        limBox.classList.toggle('ymd-fx-disabled', on);
                        const limTrack = limBox.querySelector('.ymd-fx-track');
                        if (limTrack) {
                            limTrack.tabIndex = on ? -1 : 0;
                            if (on) limTrack.setAttribute('aria-disabled', 'true'); else limTrack.removeAttribute('aria-disabled');
                        }
                    }
                    break;
                }
                case 'as-pl-keep': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_as_pl_keep', on);
                    b.setAttribute('aria-checked', String(on));
                    const plRow2 = ov.querySelector('[data-role="aspl-row"]');
                    if (plRow2) plRow2.classList.toggle('ymd-row-disabled', !on);
                    const plBtn2 = ov.querySelector('[data-act="aspl-menu"]');
                    if (plBtn2) plBtn2.disabled = !on;
                    if (!on) closePMenu(false);
                    break;
                }
                case 'as-label-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_as_label', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdAsRecheck();
                    break;
                }
                case 'pl-label-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_pl_label', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdPlApply();
                    break;
                }
                case 'as-export': ymdAsExport(); break;
                case 'cfg-export': ymdCfgExport(); break;
                case 'cfg-import': { const f = ov.querySelector('[data-role="cfg-file"]'); if (f) f.click(); break; }
                case 'as-clear': ymdAsClear(); break;
                case 'as-import': { const f = ov.querySelector('[data-role="as-file"]'); if (f) f.click(); break; }
                case 'fx-norm-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_fx_norm', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdFxApplyAll();
                    break;
                }
                case 'kar-toggle': {
                    const want = b.getAttribute('aria-checked') !== 'true';
                    (async () => {
                        if (want && !ymdKarKey()) { await promptForMvsepKey(); if (!ymdKarKey()) return; }
                        ymdKarSetFeature(want);
                        b.setAttribute('aria-checked', String(want));
                    })();
                    break;
                }
                case 'kar-key': promptForMvsepKey(); break;
                case 'instr-dl': {
                    const want = b.getAttribute('aria-checked') !== 'true';
                    (async () => {
                        if (want && !ymdKarKey()) { await promptForMvsepKey(); if (!ymdKarKey()) return; }
                        GM_setValue('ymd_instr_dl', want);
                        b.setAttribute('aria-checked', String(want));
                    })();
                    break;
                }
                case 'kar-prefetch': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_kar_prefetch', on);
                    b.setAttribute('aria-checked', String(on));
                    KAR.prefFailed.clear();
                    try { ymdKarTick(); } catch (e) {}
                    break;
                }
                case 'accent-menu': {
                    if (cPop) closeCPop(false); else openCPop(b);
                    break;
                }
                case 'accent-preset': {
                    if (cPop && cPop._set) cPop._set(b.dataset.color);
                    break;
                }
                case 'accent-reset': {
                    GM_deleteValue('ymd_accent_color');
                    closeCPop(false);
                    ymdApplyAccent();
                    paintAccentBtn();
                    break;
                }
                case 'vibe-words-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_vibe_words', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdApplyVibeAnim();
                    break;
                }
                case 'vibe-bg-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_vibe_bg', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdApplyVibeAnim();
                    break;
                }
                case 'vibe-artist-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_vibe_artist', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdApplyVibeAnim();
                    break;
                }
                case 'vibe-anim-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_vibe_anim', on);
                    b.setAttribute('aria-checked', String(on));
                    ymdApplyVibeAnim();
                    break;
                }
                case 'quality-skip': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_quality_skip', on);
                    b.setAttribute('aria-checked', String(on));
                    break;
                }
                case 'pl-menu-tall': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_pl_menu_tall', on);
                    b.setAttribute('aria-checked', String(on));
                    const plRange = ov.querySelector('[data-role="pl-menu-height"]');
                    if (plRange) plRange.disabled = !on;
                    const plRow = ov.querySelector('[data-role="pl-menu-height-row"]');
                    if (plRow) plRow.classList.toggle('ymd-row-disabled', !on);
                    if (!on) document.querySelectorAll('.ymd-playlist-menu').forEach(m => m.classList.remove('ymd-playlist-menu'));
                    break;
                }
                case 'dl-dir-pick': {
                    b.disabled = true;
                    Promise.resolve().then(() => win.__ymdPickDir()).then((dir) => {
                        if (dir) { GM_setValue('ymd_dl_dir', dir); ymdDlDirRefresh(ov); }
                    }).catch((err) => {
                        console.warn('[YMD] выбор папки не удался', err);
                        try { alert('Не удалось открыть выбор папки: ' + ((err && err.message) || err)); } catch (e) {}
                    }).then(() => { b.disabled = false; });
                    break;
                }
                case 'skip-existing': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_skip_existing', on);
                    b.setAttribute('aria-checked', String(on));
                    break;
                }
                case 'dl-covers': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_dl_covers', on);
                    b.setAttribute('aria-checked', String(on));
                    break;
                }
                case 'notify-done': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_notify_done', on);
                    b.setAttribute('aria-checked', String(on));
                    if (on) ymdNotifyIconUrl();
                    break;
                }
                case 'group-reset': {
                    const grp = b.closest('.ymd-group');
                    const gt = grp && grp.querySelector('.ymd-group-title');
                    const title = gt ? gt.textContent.trim() : '';
                    const def = YMD_GROUP_RESET[title];
                    if (!def) break;
                    ymdDialog({
                        title: 'Сбросить раздел «' + title + '»?',
                        lines: ['Настройки этого раздела вернутся к значениям по умолчанию.'],
                        sub: 'Остальные разделы не изменятся. Страница будет перезагружена.',
                        okLabel: 'Сбросить',
                        cancelLabel: 'Отмена'
                    }).then((ok) => {
                        if (!ok) return;
                        try {
                            const keys = new Set(def.keys || []);
                            for (const k of GM_listValues()) {
                                if ((def.prefixes || []).some((pf) => k.startsWith(pf))) keys.add(k);
                            }
                            keys.forEach((k) => { if (!YMD_KEEP_ON_RESET.has(k)) GM_deleteValue(k); });
                        } catch (err) { console.warn('[YMD] group reset', err); }
                        location.reload();
                    });
                    break;
                }
                case 'reset-settings': {
                    ymdDialog({
                        title: 'Сбросить все настройки?',
                        lines: ['Настройки скрипта вернутся к значениям по умолчанию.'],
                        sub: 'Токены и список подмен FckCensor останутся без изменений. Страница будет перезагружена.',
                        okLabel: 'Сбросить',
                        cancelLabel: 'Отмена'
                    }).then((ok) => {
                        if (!ok) return;
                        try {
                            for (const k of GM_listValues()) {
                                if (k.startsWith('ymd_') && !YMD_KEEP_ON_RESET.has(k)) GM_deleteValue(k);
                            }
                        } catch (err) { console.warn('[YMD] reset', err); }
                        location.reload();
                    });
                    break;
                }
                case 'upd-check':   ymdUpdateManual(b); break;
                case 'token-set':   promptForToken().then(refreshToken); break;
                case 'token-auto':  autoGetToken(false); break;
                case 'token-reset': ymdResetToken(); refreshToken(); break;
                case 'embed-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_embed_tags', on);
                    b.setAttribute('aria-checked', String(on));
                    applyTagState();
                    break;
                }
                case 'tag-toggle': {
                    const on = b.getAttribute('aria-checked') !== 'true';
                    GM_setValue('ymd_tag_' + b.dataset.key, on);
                    b.setAttribute('aria-checked', String(on));
                    if (b.dataset.key === 'album') applyTagState();
                    break;
                }
            }
        });
    }


    const YMD_TAB_ICONS = {
        'Токен': 'lock_xxs',
        'FckCensor': 'adult_xxs',
        'Скробблинг': 'repeat_xs',
        'Текстомузыка': 'syncLyrics_xs',
        'Перевод текста': 'lyrics_xxs',
        'Скачивание': 'download_xxs',
        'Тегирование': 'pencil_xxs',
        'Косметика': 'navigationMyVibe_xs',
        'Эффекты': 'volume_xs',
        'Караоке': 'artist_xxs',
        'Автоскип': 'next_xs',
        'Резервная копия': 'upload_xxs'
    };

    const YMD_TAB_LOGO = '<a target="_self" rel="" class="buOTZq_TKQOVyjMLrXvB NavbarDesktop_logoLink__KR0Dk" aria-label="Главная" href="/"><div class="QYIUcw5hsJgmlwLrB5fw MbIad3IRCizF6mCoBmEn L3IfttCS0A25HWkjiCfA Xbv7Qfl1umbKWZH6Lpmm NavbarDesktop_logo__Z4jGx"><div class="fa7Iuq8vrgIfbzKOgUbb"><div class="BsBcyUAAeEry8HeSbIQh"><svg class="yvGpKZBZLwidMfMcVMR3" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#musicLogoLeftRu"></use></svg></div><div class="frsl0v3Y0m7IvVEtEnT8"><svg class="ygfy3HHHNs5lMz5mm4ON" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#musicLogo"></use></svg></div></div></div></a>';

    const YMD_TAB_CSS = `
        body.ymd-tab-body{margin:0;min-height:100vh;background:var(--ym-background-color-primary-enabled-basic,#000);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);font-family:var(--ym-font-text,sans-serif)}
        .ymd-tab-shell{--subpage-sticky-header-height:0px}
        body.ymd-tab-body > .ymd-tab-shell{display:flex!important;box-sizing:border-box;width:100%;height:100vh;overflow:hidden}
        body.ymd-tab-body > .ymd-tab-shell > aside{flex:0 0 auto;height:100%}
        body.ymd-tab-body > .ymd-tab-shell > .ymd-tab-content{flex:1 1 auto;box-sizing:border-box;min-width:0;height:100%;overflow:hidden}
        .ymd-tab-shell .ymd-tab-content > main{display:flex;flex-direction:column;height:100%}
        .ymd-tab-shell li[data-ymd-i] a{cursor:pointer}
        .ymd-tab-shell li[data-ymd-i][aria-current="true"] a{background-color:var(--ym-controls-color-secondary-default-hovered,rgba(255,255,255,.12))!important}
        .ymd-sp-container{display:flex;flex-direction:column;height:100%;justify-content:space-between;margin-block-start:var(--subpage-sticky-header-height)}
        #ymd-settings-overlay.ymd-tab #ymd-settings > [class*="SettingsPage_root"]{display:flex;flex-direction:column}
        #ymd-settings-overlay.ymd-tab #ymd-settings [class*="SettingsPage_scrollableContainer"]{flex:1 1 auto;min-height:0;height:auto!important;display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-sp-container{flex:1 0 auto;height:auto!important;justify-content:space-between}
        ${ymdScrollCss(['#ymd-settings-overlay.ymd-tab #ymd-settings [class*="SettingsPage_scrollableContainer"]'], false)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-sp-footer{flex:0 0 auto;box-sizing:border-box;padding-block-start:var(--ym-spacer-size-l,1rem);border-top:1px solid var(--ym-controls-color-secondary-default-enabled,rgba(255,255,255,.12))}
        .ymd-sp-content{padding-block-start:var(--ym-spacer-size-l,1rem);padding-inline-end:var(--ym-spacer-size-s,.625rem);padding-inline-start:var(--ym-spacer-size-xxl,1.5rem)}
        .ymd-sp-footer{padding-block-end:var(--ym-spacer-size-xxl,1.5rem);padding-block-start:var(--ym-spacer-size-xxxl,2rem);padding-inline-end:var(--ym-spacer-size-s,.625rem);padding-inline-start:var(--ym-spacer-size-xxl,1.5rem)}
        @supports(-moz-appearance:none){.ymd-sp-content,.ymd-sp-footer{padding-inline-end:var(--ym-spacer-size-xxl,1.5rem)}}
        #ymd-settings-overlay.ymd-tab{position:static;inset:auto;z-index:auto;display:flex;flex-direction:column;flex:1 1 0;min-height:0;background:none;font-family:var(--ym-font-text,sans-serif)}
        #ymd-settings-overlay.ymd-tab #ymd-settings{flex:1 1 auto;min-height:0;width:100%;max-width:none;max-height:none;display:flex;flex-direction:column;overflow:visible;border-radius:0;background:none;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-head{display:none}
        #ymd-settings-overlay.ymd-tab #ymd-settings > [class*="SettingsPage_root"]{flex:1 1 auto;min-height:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-body{width:850px;max-width:100%;overflow:visible;padding:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-group{padding:0;border-top:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-group[hidden]{display:none}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-group-title{margin:16px 0 1rem;font-size:var(--ym-font-size-headline-s,1.375rem);line-height:var(--ym-font-line-height-headline-s,2rem)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-row.ymd-toggle-row{align-items:center;justify-content:space-between;padding-block:var(--ym-spacer-size-xxxs,.25rem);margin-block-end:var(--ym-spacer-size-xxxl,2rem)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-row.ymd-toggle-row > div:first-child{display:flex;flex-direction:column}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-row:not(.ymd-toggle-row){min-height:2.5rem;gap:1rem}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-row.ymd-range-row{gap:.75rem}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-row:not(.ymd-toggle-row):not(.ymd-range-row):has(+ .ymd-row, + .ymd-fx){margin-block-end:var(--ym-spacer-size-xxxl,2rem)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-fx:has(+ :not(.ymd-fx)){margin-block-end:var(--ym-spacer-size-xxxl,2rem)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-hint{margin-top:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-btn-hint{margin:0 0 1rem}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-btn-hint:last-child{margin-bottom:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-fx .ymd-hint{margin:.125rem 0 .25rem}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-footer-hint{margin:.5rem 0 .75rem}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-footer{padding:0;margin:0;border-top:0}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-links{justify-content:flex-start}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-search{flex:0 0 auto;padding:var(--ym-spacer-size-l,1rem) var(--ym-spacer-size-s,.625rem) 0 var(--ym-spacer-size-xxl,1.5rem)}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-search-root{width:850px;max-width:100%}
        #ymd-settings-overlay.ymd-tab #ymd-settings .ymd-group-reset{margin-top:var(--ym-spacer-size-xxxl,2rem);margin-bottom:var(--ym-spacer-size-xxxl,2rem)}
    `;

    const YMD_FULL_CSS = `
        #ymd-full-root{position:fixed;inset:0;clip-path:polygon(0 0,calc(100% - var(--ymd-tw,144px)) 0,calc(100% - var(--ymd-tw,144px)) var(--ymd-tb,32px),100% var(--ymd-tb,32px),100% 100%,0 100%);z-index:2147483647;box-sizing:border-box;background:var(--ym-background-color-primary-enabled-basic,#000);color:var(--ym-controls-color-secondary-on_default-enabled,#fff);font-family:var(--ym-font-text,sans-serif)}
        #ymd-full-root .WithTopBanner_root__P__x3,#ymd-full-root .WithTopBanner_content__6Vh7a{height:100%}
        #ymd-settings-overlay.ymd-tab.ymd-full #ymd-settings .ymd-head{display:block;position:fixed;top:calc(var(--ymd-tb,0px) + var(--ym-spacer-size-l,1rem));right:var(--ym-spacer-size-xxl,1.5rem);margin:0;padding:0;z-index:3}
        #ymd-settings-overlay.ymd-tab.ymd-full #ymd-settings .ymd-title{display:none}
    `;

    function ymdTabCssFilter(css) {
        const rules = [
            ['#ymd-settings .ymd-label', ['font-size', 'font-weight'], 'color:var(--ym-controls-color-primary-text-enabled_variant)'],
            ['#ymd-settings .ymd-hint', ['font-size', 'line-height', 'color'], 'color:var(--ym-controls-color-primary-text-enabled)'],
            ['#ymd-settings .ymd-row', ['gap', 'min-height'], '']
        ];
        let out = css;
        for (const [sel, props, add] of rules) {
            const at = out.indexOf(sel + '{');
            if (at < 0) continue;
            const from = at + sel.length + 1;
            const to = out.indexOf('}', from);
            const kept = out.slice(from, to).split(';').filter(x => x.trim() && props.indexOf(x.split(':')[0].trim()) < 0);
            if (add) kept.push(add);
            out = out.slice(0, from) + kept.join(';') + out.slice(to);
        }
        return out;
    }

    function ymdTabCtx() {
        const ctx = { links: [], body: '', logo: '' };
        try {
            ctx.links = Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).map(l => l.href).filter(Boolean);
            if (document.body) ctx.body = Array.from(document.body.classList).filter(c => /^(ym-|desktop$)/.test(c)).join(' ');
            const lg = document.querySelector('a[class*="NavbarDesktop_logoLink"]');
            if (lg) ctx.logo = lg.outerHTML;
        } catch (e) {}
        return ctx;
    }

    function ymdTabFetchLinks() {
        const links = [];
        try {
            const x = new XMLHttpRequest();
            x.open('GET', location.origin + '/', false);
            x.send();
            const d = new DOMParser().parseFromString(x.responseText, 'text/html');
            d.querySelectorAll('link[rel~="stylesheet"]').forEach(l => {
                const h = l.getAttribute('href');
                if (h) links.push(new URL(h, location.origin).href);
            });
        } catch (e) {}
        return links;
    }

    function ymdIsDesktopShim() {
        try { return typeof GM_info !== 'undefined' && GM_info.scriptHandler === 'ymd-desktop-shim'; } catch (e) { return false; }
    }

    function ymdOpenSettings() {
        if (ymdIsDesktopShim()) { ymdOpenSettingsView('full'); return; }
        const url = location.origin + '/' + YMD_TAB_HASH;
        const ctx = ymdTabCtx();
        if (ctx.links.length) {
            try { GM_setValue('ymd_tab_ctx', JSON.stringify(ctx)); } catch (e) {}
        }
        try {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(url, { active: true, insert: true, setParent: true });
                return;
            }
        } catch (e) {}
        let w = null;
        try { w = window.open(url, '_blank'); } catch (e) {}
        if (!w) ymdOpenSettingsView(false);
    }

    function ymdTabBoot() {
        let ctx = {};
        try { ctx = JSON.parse(GM_getValue('ymd_tab_ctx', '{}')) || {}; } catch (e) {}
        let links = Array.isArray(ctx.links) ? ctx.links.filter(h => /^https:\/\//.test(h)) : [];
        if (!links.length) links = ymdTabFetchLinks();
        const bodyCls = (typeof ctx.body === 'string' && ctx.body) ? ctx.body : 'ym-font-music ym-dark-theme desktop';
        window.__ymdTabLogo = typeof ctx.logo === 'string' && ctx.logo ? ctx.logo : '';
        try {
            document.open();
            document.write('<!doctype html><html lang="ru-RU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yandex Music — Plus Unlocker & Downloader</title><link rel="icon" href="/favicon.svg">' +
                links.map(h => '<link rel="stylesheet" href="' + ymdEscHtml(h) + '">').join('') +
                '</head><body class="' + ymdEscHtml(bodyCls) + ' ymd-tab-body"></body></html>');
            document.close();
        } catch (e) {
            console.error('[YMD] вкладка настроек', e);
            return false;
        }
        try { ymdApplyAccent(); } catch (e) {}
        ymdOpenSettingsView(true);
        return true;
    }

    function ymdTabMount(ov) {
        if (!document.getElementById('ymd-tab-style')) {
            const st = document.createElement('style');
            st.id = 'ymd-tab-style';
            st.textContent = YMD_TAB_CSS + YMD_FULL_CSS;
            (document.head || document.documentElement).appendChild(st);
        }
        const groups = Array.from(ov.querySelectorAll('.ymd-body > .ymd-group'));
        const items = groups.map((g, i) => {
            const t = g.querySelector('.ymd-group-title');
            const title = t ? t.textContent.trim() : String(i + 1);
            const icon = YMD_TAB_ICONS[title] || 'settings_xs';
            return '<li class="HcfYy4VfnRHqgXzIdL7w kRmUIkcHKD5AgtpPo8wT" aria-current="false" data-ymd-i="' + i + '">' +
                '<a target="_self" rel="" class="buOTZq_TKQOVyjMLrXvB ZfF8mQ3Iftpwu0aZgDtG yWJHrpNsBvchs9Jjyokk" role="link" aria-disabled="false" tabindex="0" href="' + YMD_TAB_HASH + '/' + i + '">' +
                '<div class="_YzsXZGNK8KeaUFC4Ja1"><svg class="UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true"><use xlink:href="/icons/sprite.svg#' + icon + '"></use></svg></div>' +
                '<div class="nxMXCBiVfgH4oxds3f2y"><span style="-webkit-line-clamp:1" title="' + ymdEscHtml(title) + '" class="_MWOVuZRvUQdXKTMcOPx LezmJlldtbHWqU7l1950 oyQL2RSmoNbNQf3Vc6YI tk7ahHRDYXJMMB879KUA _3_Mxw7Si7j2g4kWjlpR">' + ymdEscHtml(title) + '</span></div></a></li>';
        }).join('');

        const shell = document.createElement('div');
        shell.className = 'CommonLayout_root__WC_W1 DefaultLayout_root__7J0wo ymd-tab-shell';
        shell.innerHTML =
            '<aside class="Navbar_root__chF4R DefaultLayout_navbar__LIQWG">' +
                '<div class="NavbarDesktop_root__scYzp">' +
                    '<div class="NavbarDesktop_logoWrapper__89ce6">' + (window.__ymdTabLogo || YMD_TAB_LOGO) + '</div>' +
                    '<div class="NavbarDesktop_scrollableContainer__HLc9D"><div class="NavbarDesktop_scrollableContent__OyU4P">' +
                        '<nav class="NGdj0oZ2Bt8qdZhP2Tzt QilmoKKJwk6f0BdkYgrA NavbarDesktop_navigation__dLUGW NavbarDesktop_navigation_new__0j8W5" aria-label="Настройки скрипта">' +
                            '<ol class="yuyI2hMAT7qyL1N14MAQ xfFtKQpgAYvC2jI1tBtS NavbarDesktop_navigationGroup__eexLF">' + items + '</ol>' +
                        '</nav>' +
                    '</div></div>' +
                '</div>' +
            '</aside>' +
            '<div class="Content_root__IsH8s CommonLayout_content__zy_Ja ymd-tab-content"><main class="Content_main__8_wIa"></main></div>';
        shell.querySelector('main').appendChild(ov);
        const isFull = ov.classList.contains('ymd-full');
        if (isFull) {
            const root = document.createElement('div');
            root.id = 'ymd-full-root';
            root.style.setProperty('--ymd-tb', ymdTitlebarH() + 'px');
            root.style.setProperty('--ymd-tw', ymdTitlebarW() + 'px');
            const wTop = document.createElement('div');
            wTop.className = 'WithTopBanner_root__P__x3';
            const wCont = document.createElement('div');
            wCont.className = 'WithTopBanner_content__6Vh7a';
            wCont.appendChild(shell);
            wTop.appendChild(wCont);
            root.appendChild(wTop);
            (document.body || document.documentElement).appendChild(root);
            ymdFullAlignSoon(root);
            ymdLiftControls(root);
        } else {
            document.body.appendChild(shell);
        }

        const TXT_T = ['_MWOVuZRvUQdXKTMcOPx', 'LezmJlldtbHWqU7l1950', 'oyQL2RSmoNbNQf3Vc6YI', 'V3WU123oO65AxsprotU9', 'Vi7Rd0SZWqD17F0872TB'];
        const TXT_D = ['_MWOVuZRvUQdXKTMcOPx', 'SehSa7OyRpC2nzYTVb2Q', '_3_Mxw7Si7j2g4kWjlpR'];
        ov.querySelectorAll('.ymd-label').forEach(el => el.classList.add(...TXT_T));
        ov.querySelectorAll('.ymd-hint').forEach(el => el.classList.add(...TXT_D));
        ov.querySelectorAll('.ymd-row').forEach(r => {
            if (r.querySelector(':scope > .ymd-switch')) r.classList.add('ymd-toggle-row', 'SettingsListToggleItem_root__yEEYT');
        });
        ov.querySelectorAll('.ymd-label, .ymd-hint, .ymd-row').forEach(el => {
            el.style.removeProperty('margin-top');
            el.style.removeProperty('margin-bottom');
        });

        const panel = ov.querySelector('#ymd-settings');
        const bodyEl = panel.querySelector('.ymd-body');
        const footEl = panel.querySelector('.ymd-footer');
        const page = document.createElement('div');
        page.className = 'By12CU9obvaH0jYtauNw pnFSEGiRmI9JuhUxbfVe SettingsPage_root__BB4lC';
        page.innerHTML = '<div class="YsFmmSnMXb5VMh5VyqeV SettingsPage_scrollableContainer__qD32i"><div class="SettingsPage_container__bIwea ymd-sp-container">' +
            '<div class="SettingsPage_content__cR6Ra ymd-sp-content" data-ymd-slot="1"></div></div></div>' +
            '<div class="SettingsPage_footer__QIqyx ymd-sp-footer" data-ymd-fslot="1"></div>';
        panel.insertBefore(page, bodyEl);
        page.querySelector('[data-ymd-slot]').appendChild(bodyEl);
        page.querySelector('[data-ymd-fslot]').appendChild(footEl);

        const show = (i) => {
            i = Math.min(groups.length - 1, Math.max(0, i));
            ov._ymdTabIdx = i;
            groups.forEach((g, k) => { g.hidden = k !== i; });
            if (ov._ymdSearch) ov._ymdSearch.clear();
            shell.querySelectorAll('li[data-ymd-i]').forEach(li => li.setAttribute('aria-current', String(Number(li.dataset.ymdI) === i)));
            if (!isFull) { try { history.replaceState(null, '', YMD_TAB_HASH + '/' + i); } catch (e) {} }
            const sc = shell.querySelector('[class*="SettingsPage_scrollableContainer"]');
            if (sc) sc.scrollTop = 0;
        };
        shell.querySelector('ol').addEventListener('click', (e) => {
            const li = e.target.closest('li[data-ymd-i]');
            if (!li) return;
            e.preventDefault();
            show(Number(li.dataset.ymdI));
        });
        const m = isFull ? null : /^#ymd-settings\/(\d+)/.exec(location.hash);
        show(m ? Number(m[1]) : 0);
    }

    function ymdFullAlign(root) {
        if (!root || !root.isConnected) return;
        try {
            const oc = root.querySelector('.ymd-tab-content');
            const mine = root.querySelector('.ymd-tab-content > main');
            const oa = root.querySelector('.ymd-tab-shell > aside');
            if (!oc || !mine) return;
            root.style.clipPath = (ymdWco() || root.dataset.ymdLift === '1') ? 'none' : '';
            oc.style.marginTop = '0px';
            oc.style.height = '';
            if (oa) oa.style.marginTop = '0px';
            void root.offsetHeight;

            const rects = (sel) => Array.from(document.querySelectorAll(sel)).filter(el => !root.contains(el)).map(el => el.getBoundingClientRect());
            const realMain = rects('main[class*="Content_main"]').find(r => r.width > 300 && r.height > 200 && r.top >= 0 && r.top < 100);
            const tbH = ymdTitlebarH();
            const realTop = realMain ? realMain.top : tbH;
            const target = Math.max(realTop, tbH);
            const base = mine.getBoundingClientRect().top;
            const dy = Math.round(target - base);
            const extra = Math.round(target - realTop);
            if (Math.abs(dy) < 100) {
                oc.style.marginTop = dy + 'px';
                if (extra > 0) oc.style.height = 'calc(100% - ' + extra + 'px)';
            }

            if (oa) {
                const realLogo = rects('a[class*="NavbarDesktop_logoLink"]').find(r => r.height > 0);
                const myLogo = Array.from(oa.querySelectorAll('a[class*="NavbarDesktop_logoLink"]')).map(el => el.getBoundingClientRect()).find(r => r.height > 0);
                if (realLogo && myLogo) {
                    const d = Math.round((realLogo.top - myLogo.top) / z);
                    if (Math.abs(d) < 40) oa.style.marginTop = d + 'px';
                }
            }
        } catch (e) { console.warn('[YMD] выравнивание настроек', e); }
    }

    function ymdLiftControls(root) {
        const saved = [];
        const undo = () => {
            saved.forEach(([el, v, pr]) => { if (v) el.style.setProperty('z-index', v, pr); else el.style.removeProperty('z-index'); });
            saved.length = 0;
            root.style.zIndex = '';
            delete root.dataset.ymdLift;
            root.style.clipPath = '';
        };
        try {
            if (ymdWco()) return;
            const w = window.innerWidth;
            const btns = [];
            for (let x = w - 4; x > w - 150; x -= 6) {
                for (const el of document.elementsFromPoint(x, 6)) {
                    if (el === document.documentElement || el === document.body) continue;
                    if (el.closest('#ymd-full-root,#ymd-settings-overlay')) continue;
                    const r = el.getBoundingClientRect();
                    if (r.top <= 1 && r.height >= 8 && r.height <= 64 && r.width <= 96) btns.push(el);
                }
            }
            if (!btns.length) return;
            const seen = new Set();
            btns.forEach((b) => {
                let p = b;
                while (p && p !== document.body && p !== document.documentElement) {
                    if (!seen.has(p)) {
                        seen.add(p);
                        if (getComputedStyle(p).position !== 'static') {
                            saved.push([p, p.style.getPropertyValue('z-index'), p.style.getPropertyPriority('z-index')]);
                            p.style.setProperty('z-index', '2147483647', 'important');
                        }
                    }
                    p = p.parentElement;
                }
            });
            if (!saved.length) return;
            root.style.zIndex = '2147483646';
            root.style.clipPath = 'none';
            root.dataset.ymdLift = '1';
            const top = document.elementsFromPoint(w - 20, 6)[0];
            if (top && root.contains(top)) { undo(); return; }
        } catch (e) { undo(); return; }
        if (!saved.length) return;
        const mo = new MutationObserver(() => {
            if (root.isConnected) return;
            mo.disconnect();
            saved.forEach(([el, v, pr]) => { if (v) el.style.setProperty('z-index', v, pr); else el.style.removeProperty('z-index'); });
        });
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    function ymdFullAlignSoon(root) {
        const run = () => ymdFullAlign(root);
        requestAnimationFrame(() => { run(); requestAnimationFrame(run); });
        setTimeout(run, 400);
        let t = 0;
        window.addEventListener('resize', function onR() {
            if (!root.isConnected) { window.removeEventListener('resize', onR); return; }
            clearTimeout(t);
            t = setTimeout(run, 100);
        });
    }

    function ymdWco() {
        try {
            const w = navigator.windowControlsOverlay;
            if (w && w.visible) {
                const r = w.getTitlebarAreaRect();
                if (r && r.height > 0) return r;
            }
        } catch (e) {}
        return null;
    }

    function ymdTitlebarW() {
        try {
            const r = ymdWco();
            if (r) return Math.max(0, Math.ceil(window.innerWidth - (r.x + r.width))) || 144;
            const w = window.innerWidth;
            let left = w;
            for (let x = w - 4; x > w - 260; x -= 6) {
                for (const el of document.elementsFromPoint(x, 6)) {
                    if (el === document.documentElement || el === document.body) continue;
                    if (el.closest('#ymd-full-root,#ymd-settings-overlay')) continue;
                    const b = el.getBoundingClientRect();
                    if (b.top <= 1 && b.height >= 8 && b.height <= 64 && b.width <= 96) left = Math.min(left, Math.floor(b.left));
                }
            }
            return left < w ? Math.ceil(w - left) : 144;
        } catch (e) { return 144; }
    }

    function ymdTitlebarH() {
        { const r = ymdWco(); if (r) return Math.ceil(r.height) || 32; }
        try {
            let h = 0;
            const w = window.innerWidth;
            for (const x of [w - 12, w - 60, w - 110, w - 160]) {
                for (const el of document.elementsFromPoint(x, 6)) {
                    if (el === document.documentElement || el === document.body) continue;
                    if (el.closest('#ymd-full-root,#ymd-settings-overlay')) continue;
                    const r = el.getBoundingClientRect();
                    if (r.top <= 1 && r.height >= 8 && r.height <= 64) h = Math.max(h, Math.ceil(r.bottom));
                }
            }
            return h || 32;
        } catch (e) { return 32; }
    }

    function ymdTabSync() {
        if (typeof GM_addValueChangeListener !== 'function') return;
        const bind = (keys, fn) => {
            keys.forEach(k => {
                try {
                    GM_addValueChangeListener(k, (name, oldV, newV, remote) => {
                        if (!remote) return;
                        try { fn(); } catch (e) {}
                    });
                } catch (e) {}
            });
        };
        bind(['ymd_accent_color'], () => ymdApplyAccent());
        bind(['ymd_vibe_anim', 'ymd_vibe_artist', 'ymd_vibe_words', 'ymd_vibe_bg'], () => ymdApplyVibeAnim());
        bind(['ymd_pl_menu_tall', 'ymd_pl_menu_height'], () => {
            if (!ymdPlMenuTallOn()) document.querySelectorAll('.ymd-playlist-menu').forEach(m => m.classList.remove('ymd-playlist-menu'));
            ymdApplyPlMenuHeight();
        });
        bind(YMD_FX_DEFS.map(d => 'ymd_fx_' + d.key).concat(['ymd_fx_norm']), () => ymdFxApplyAll());
        bind(['ymd_as_enabled', 'ymd_as_record', 'ymd_as_label'], () => ymdAsRecheck());
        bind(['ymd_pl_label'], () => ymdPlApply());
        bind(['ymd_kar_enabled', 'ymd_kar_active', 'ymd_mvsep_key'], () => { KAR.failed.clear(); ymdKarSync(); });
        bind(['ymd_kar_prefetch'], () => { KAR.prefFailed.clear(); try { ymdKarTick(); } catch (e) {} });
    }

    try { GM_registerMenuCommand("⚙️ Настройки", ymdOpenSettings); } catch (e) {}

    (function ymdPinSettings() {
        const ID = 'ymd-nav-settings';
        const GEAR = '<path fill="currentColor" fill-rule="evenodd" d="M9.172 9.172a4 4 0 1 1 5.656 5.656 4 4 0 0 1-5.656-5.656m1.414 4.242a2 2 0 1 0 2.828-2.828 2 2 0 0 0-2.828 2.828" clip-rule="evenodd"></path>' +
                '<path fill="currentColor" fill-rule="evenodd" d="m20.788 5.276 1.427 2.483v.001a1.4 1.4 0 0 1-.365 1.81l-1.858 1.412.002 2.038 1.854 1.41a1.4 1.4 0 0 1 .365 1.814l-1.425 2.479a1.4 1.4 0 0 1-1.755.593l-2.192-.92-1.72.982-.304 2.398A1.404 1.404 0 0 1 13.427 23h-2.853a1.404 1.404 0 0 1-1.39-1.224l-.308-2.421-1.69-.97-2.22.93a1.4 1.4 0 0 1-1.754-.592l-1.427-2.482a1.4 1.4 0 0 1 .365-1.81l1.86-1.413-.004-2.038-1.855-1.41a1.4 1.4 0 0 1-.364-1.814l1.426-2.479a1.4 1.4 0 0 1 1.756-.593l2.191.92 1.72-.982.303-2.398A1.4 1.4 0 0 1 10.573 1h2.853a1.4 1.4 0 0 1 1.39 1.223l.307 2.422 1.69.97 2.22-.93a1.4 1.4 0 0 1 1.755.591m-2.792 8.739-.007-4.023 2.23-1.694-.9-1.565-2.642 1.109-3.412-1.956L12.898 3h-1.796l-.364 2.864L7.294 7.83 4.682 6.733l-.9 1.565 2.222 1.69.007 4.02-2.229 1.694.9 1.565 2.641-1.109 3.412 1.956.367 2.886h1.796l.364-2.864 3.443-1.966 2.613 1.097.9-1.565z" clip-rule="evenodd"></path>';

        function build() {
            const items = document.querySelectorAll('nav[aria-label="Главное меню"] ol > li');
            let tpl = null;
            for (const li of items) if (li.getAttribute('aria-current') === 'false') tpl = li;
            if (!tpl) return null;

            const li = tpl.cloneNode(true);
            li.removeAttribute('data-intersection-property-id');
            li.setAttribute('aria-current', 'false');

            const a = li.querySelector('a');
            if (!a) return null;
            a.removeAttribute('href');
            a.setAttribute('role', 'button');
            a.style.cursor = 'pointer';
            a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); ymdOpenSettings(); });
            a.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ymdOpenSettings(); }
            });

            const svg = li.querySelector('svg');
            if (svg) {
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'currentColor');
                svg.innerHTML = GEAR;
            }
            const sp = li.querySelector('span');
            if (sp) { sp.textContent = 'Настройки'; sp.title = 'Настройки'; }

            const mainNav = document.querySelector('nav[aria-label="Главное меню"]');
            const mainOl = mainNav && mainNav.querySelector('ol');
            const nav = document.createElement('nav');
            nav.id = ID;
            if (mainNav) nav.className = mainNav.className;
            nav.setAttribute('aria-label', 'Настройки');
            nav.style.flexShrink = '0';
            const ol = document.createElement('ol');
            if (mainOl) ol.className = mainOl.className;
            ol.style.listStyle = 'none';
            ol.appendChild(li);
            nav.appendChild(ol);
            return nav;
        }

        function syncCollapsed(el) {
            const mine = el.querySelector('span');
            const native = document.querySelector('nav[aria-label="Главное меню"] ol > li span[title]');
            if (mine && native && mine.className !== native.className) mine.className = native.className;
        }

        function ensure() {
            const user = document.querySelector('[class*="NavbarDesktopUserWidget_userProfileContainer"]');
            const root = user && user.parentNode;
            if (!root) return;
            let el = document.getElementById(ID);
            if (el && el.parentNode === root && el.nextElementSibling === user) { syncCollapsed(el); return; }
            if (!el) el = build();
            if (!el) return;
            root.insertBefore(el, user);
            syncCollapsed(el);
        }

        let raf = 0;
        const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; try { ensure(); } catch (e) {} }); };
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
        let asideObs = null, asideEl = null;
        const watchAside = () => {
            const aside = document.querySelector('aside[class*="Navbar_root"]');
            if (!aside || aside === asideEl) return;
            asideEl = aside;
            if (asideObs) asideObs.disconnect();
            asideObs = new MutationObserver(schedule);
            asideObs.observe(aside, { attributes: true, attributeFilter: ['class'] });
        };
        new MutationObserver(watchAside).observe(document.documentElement, { childList: true, subtree: true });
        watchAside();
        schedule();
    })();

    try { ymdFsInstall(); } catch (e) {}

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

    const YMD_PANEL_CLOSE_HTML = '<button type="button" id="ymd-close" class="ymd-panel-close-x" title="Закрыть" aria-label="Закрыть"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img"><path fill="currentColor" d="M19.207 6.207a1 1 0 0 0-1.414-1.414L12 10.586 6.207 4.793a1 1 0 0 0-1.414 1.414L10.586 12l-5.793 5.793a1 1 0 1 0 1.414 1.414L12 13.414l5.793 5.793a1 1 0 0 0 1.414-1.414L13.414 12z"></path></svg></button>';

    function ymdPanelWidth(wide) {
        panel.style.left = '';
        panel.style.right = '20px';
        panel.style.bottom = '20px';
        panel.style.minWidth = '320px';
        if (wide) {
            panel.style.boxSizing = 'border-box';
            panel.style.width = '650px';
            panel.style.maxWidth = '650px';
            panel.style.height = 'auto';
            panel.style.maxHeight = 'calc(100vh - 40px)';
            panel.style.overflow = 'hidden';
            panel.style.flexDirection = 'column';
        } else {
            panel.style.width = '';
            panel.style.maxWidth = '460px';
            panel.style.height = '';
            panel.style.maxHeight = '';
            panel.style.overflow = '';
        }
    }

    function status(text, err = false) {
        panel.style.display = 'block';
        ymdPanelWidth(false);
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:${err ? '#ff5555' : '#ffff00'};font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                ${YMD_PANEL_CLOSE_HTML}
            </div>
            <span style="font-size:14px;display:block;width:100%;line-height:1.4;">${text}</span>
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
        ymdPanelWidth(false);
        panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                ${YMD_PANEL_CLOSE_HTML}
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
        ymdBindPanelControls();
    }

    function ymdBindPanelControls() {
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
            const savedIdx = ymdQualityIdx();
            const qOpts = ymdInstrDlOn() ? QUALITY_OPTIONS.concat(YMD_INSTR_OPTIONS) : QUALITY_OPTIONS;

            panel.style.display = 'block';
            ymdPanelWidth(false);
            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                    <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                    ${YMD_PANEL_CLOSE_HTML}
                </div>
                <div style="font-size:13px;margin-bottom:8px;color:#ccc;">Качество:</div>
                <div id="ymd-quality-btns" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">
                    ${qOpts.map((q, i) => `
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
                });
            });

            panel.querySelector('#ymd-go-btn').addEventListener('click', () => {
                const downloadCovers = ymdEmbedTagsOn();
                const embedLyrics = downloadCovers;
                if (selectedIdx < QUALITY_OPTIONS.length) GM_setValue('ymd_quality_idx', selectedIdx);
                resolve({ quality: qOpts[selectedIdx], downloadCovers, embedLyrics });
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
        ymdSyncLocalToken();
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
        {
            const pid = String(trackId).split(':')[0];
            if (FCK.enabled && FCK.ready && FCK.audio.has(pid)) {
                const fa = await fckGetAudio(pid);
                if (fa) return fckBuildDownloadInfo(pid, 'nq', fa);
            }
        }
        const token = getOAuthToken();
        if (!token) throw new Error("Нет OAuth токена. Включите любой трек на сайте (чтобы перехватить токен), либо введите вручную: ⚙️ Настройки → Токен → «Настроить токен».");

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
        const r = await gmJSON(`${API_BASE}/tracks?trackIds=${ids.join(",")}&removeDuplicates=false&withProgress=true`, h);
        try { if (FCK.enabled && FCK.ready) fckSpoofObject(r); } catch (e) {}
        return r;
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
                            window.scrollTo(0, 0);
                            return ids;
                        }
                    }
                }
            }
        } catch(e) {}

        const links = document.querySelectorAll('.ChartTracksPage_content__yyIAN a:is([href*="/track/"],[href*="trackId="]), .ChartTracksPage_root__QMbqY a:is([href*="/track/"],[href*="trackId="])');
        window.scrollTo(0, 0);
        if (links.length) {
            const ids = [], seen = new Set();
            for (const a of links) {
                const m = a.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
                if (m && !seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
            }
            if (ids.length) {
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
        if ((m = h.match(/(?:\/track\/|[?&]trackId=)(\d+)/))) return { type: "track", id: m[1] };
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

    function getExt(codec) {
        if (codec === 'flac' || codec === 'flac-mp4') return 'flac';
        if (codec === 'mp3') return 'mp3';
        return 'm4a';
    }

    function writeID3v2(audioBuf, meta, coverBuf) {
        function enc(str) { return new TextEncoder().encode(str); }

        function utf16leBytes(str) {
            const u = new Uint8Array(str.length * 2);
            for (let i = 0; i < str.length; i++) {
                const c = str.charCodeAt(i);
                u[2 * i] = c & 0xFF;
                u[2 * i + 1] = c >> 8;
            }
            return u;
        }

        function frameHeader(f, id, size) {
            for (let i = 0; i < 4; i++) f[i] = id.charCodeAt(i);
            f[4] = (size >> 24) & 0xFF; f[5] = (size >> 16) & 0xFF;
            f[6] = (size >>  8) & 0xFF; f[7] =  size        & 0xFF;
            f[8] = 0x00; f[9] = 0x00;
        }

        function textFrame(id, text) {
            const tb = utf16leBytes(text);
            const size = 1 + 2 + tb.length;
            const f = new Uint8Array(10 + size);
            frameHeader(f, id, size);
            f[10] = 0x01;
            f[11] = 0xFF; f[12] = 0xFE;
            f.set(tb, 13);
            return f;
        }

        function latin1Frame(id, text) {
            const size = 1 + text.length;
            const f = new Uint8Array(10 + size);
            frameHeader(f, id, size);
            f[10] = 0x00;
            for (let i = 0; i < text.length; i++) f[11 + i] = text.charCodeAt(i) & 0xFF;
            return f;
        }

        function usltFrame(lang, text) {
            const tb = utf16leBytes(text);
            const size = 1 + 3 + 4 + 2 + tb.length;
            const f = new Uint8Array(10 + size);
            frameHeader(f, 'USLT', size);
            let o = 10;
            f[o++] = 0x01;
            for (let i = 0; i < 3; i++) f[o++] = (lang || 'XXX').charCodeAt(i) & 0xFF;
            f[o++] = 0xFF; f[o++] = 0xFE; f[o++] = 0x00; f[o++] = 0x00;
            f[o++] = 0xFF; f[o++] = 0xFE;
            f.set(tb, o);
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
        if (meta.trackNumber) frames.push(latin1Frame('TRCK', meta.trackTotal ? `${meta.trackNumber}/${meta.trackTotal}` : String(meta.trackNumber)));
        if (meta.discNumber) frames.push(latin1Frame('TPOS', meta.discTotal ? `${meta.discNumber}/${meta.discTotal}` : String(meta.discNumber)));
        if (meta.date)   frames.push(latin1Frame('TYER', String(meta.date).slice(0, 4)));
        if (meta.lyrics) frames.push(usltFrame(meta.lyricsLang, String(meta.lyrics).replace(/\r?\n/g, '\n')));
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
        if (meta.date) ilstItems.push(makeMetaItem('\xA9day', String(meta.date)));
        if (meta.trackNumber) {
            const trknData = new Uint8Array(8);
            const trknView = new DataView(trknData.buffer);
            trknView.setUint16(2, meta.trackNumber);
            trknView.setUint16(4, meta.trackTotal || 0);
            ilstItems.push(makeBox('trkn', makeDataBox(0, trknData)));
        }
        if (meta.discNumber) {
            const diskData = new Uint8Array(6);
            const diskView = new DataView(diskData.buffer);
            diskView.setUint16(2, meta.discNumber);
            diskView.setUint16(4, meta.discTotal || 0);
            ilstItems.push(makeBox('disk', makeDataBox(0, diskData)));
        }
        if (meta.lyrics) ilstItems.push(makeMetaItem('\xA9lyr', String(meta.lyrics)));
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
        if (meta.trackTotal)  { comments.push(`TRACKTOTAL=${meta.trackTotal}`); comments.push(`TOTALTRACKS=${meta.trackTotal}`); }
        if (meta.discNumber)  comments.push(`DISCNUMBER=${meta.discNumber}`);
        if (meta.discTotal)   { comments.push(`DISCTOTAL=${meta.discTotal}`); comments.push(`TOTALDISCS=${meta.discTotal}`); }
        if (meta.lyrics)      { comments.push(`LYRICS=${meta.lyrics}`); comments.push(`UNSYNCEDLYRICS=${meta.lyrics}`); }
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

    let ymdSaveDir = null;

    function ymdWin() { return (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window; }

    async function ymdResolveSaveTarget() {
        ymdSaveDir = null;
        const w = ymdWin();
        if (typeof w.showDirectoryPicker !== 'function') return true;
        try {
            ymdSaveDir = await w.showDirectoryPicker({ id: 'ymd', mode: 'readwrite', startIn: 'music' });
            return true;
        } catch (e) {
            if (e && e.name === 'AbortError') return false;
            console.warn('[YMD] папка недоступна, сохраняю в обычные загрузки', e);
            ymdSaveDir = null;
            return true;
        }
    }

    async function ymdWriteToDir(dir, buf, filename, mime) {
        const fh = await dir.getFileHandle(filename, { create: true });
        const ws = await fh.createWritable();
        try { await ws.write(new Blob([buf], { type: mime })); } finally { await ws.close(); }
    }

    async function downloadBlob(buf, filename, mime) {
        if (ymdSaveDir) {
            try { await ymdWriteToDir(ymdSaveDir, buf, filename, mime); return; }
            catch (e) { console.warn('[YMD] запись в папку не удалась, использую обычную загрузку', e); }
        }
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
        const fckBuf = _fckBufByUrl.get(url);
        if (fckBuf) { if (onProgress) onProgress(100, fckBuf.byteLength, fckBuf.byteLength); return fckBuf.slice(0); }
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

        await downloadBlob(buf, filename, mime);
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
            await downloadBlob(buf, filename + '.' + ext, mime);
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

    (function ymdFsCoverSaveInstall() {
        const FS = '[class*="FullscreenPlayer"]';
        const SRC_RE = /avatars\.|music-content|get-music-/i;
        let menu = null;

        function closeMenu() {
            if (menu) { menu.remove(); menu = null; }
        }

        function cssUrl(v) {
            const m = /url\((["']?)(.*?)\1\)/.exec(v || '');
            return m ? m[2] : '';
        }

        function coverCandidates(x, y) {
            for (const el of document.elementsFromPoint(x, y)) {
                if (!el.closest || !el.closest(FS)) continue;
                const r = el.getBoundingClientRect();
                if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) continue;
                let src = '';
                if (el.tagName === 'IMG') src = el.currentSrc || el.src;
                else src = cssUrl(getComputedStyle(el).backgroundImage);
                if (!src || !SRC_RE.test(src)) continue;
                if (/^\/\//.test(src)) src = 'https:' + src;
                const re = /\/(?:\d+x\d+|orig|%%)(?=$|[?#])/;
                if (!re.test(src)) return [src];
                return [src.replace(re, '/orig'), src.replace(re, '/1000x1000')];
            }
            return null;
        }

        function currentTrackId() {
            const link = document.querySelector(
                '[class*="FullscreenPlayerDesktopContent_meta__"] a:is([href*="/track/"],[href*="trackId="]), ' +
                '[class*="FullscreenPlayerDesktopContent_title__"] a:is([href*="/track/"],[href*="trackId="])'
            );
            const m = link && link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
            if (m) return m[1];
            try {
                const st = unsafeWindow.__STATE_SNAPSHOT__;
                for (const snap of (Array.isArray(st) ? st : [st])) {
                    const id = snap?.sonataState?.entityMeta?.id;
                    if (id) return String(id);
                }
            } catch (e) {}
            return null;
        }

        async function saveCover(urls) {
            let track = null;
            try {
                const id = currentTrackId();
                if (id) track = (await getTracksInfo([id]))[0] || null;
            } catch (e) {}
            const list = urls.slice();
            const apiUrl = track ? getCoverUrl(track) : null;
            if (apiUrl && !list.includes(apiUrl)) list.push(apiUrl);
            const name = track
                ? sanitize(`${formatArtists(track.artists) || 'Unknown'} - ${toTitleCase(track.title) || 'Unknown'}`)
                : 'cover';
            for (const u of list) {
                try {
                    const res = await gmFetchBinary(u);
                    const buf = res.response;
                    if (!buf || !buf.byteLength) continue;
                    const { mime, ext } = guessCoverMime(buf);
                    if (!downloading) ymdSaveDir = null;
                    await downloadBlob(buf, name + '.' + ext, mime);
                    status('Обложка сохранена');
                    hideStatus(3000);
                    return;
                } catch (e) {}
            }
            status('Не удалось скачать обложку', true);
            hideStatus(5000);
        }

        function openMenu(x, y, urls) {
            closeMenu();
            menu = document.createElement('div');
            menu.setAttribute('role', 'menu');
            menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:12rem;padding:.25rem;border-radius:.75rem;' +
                'background:var(--ym-background-color-secondary-enabled-blur,#2a2a2e);color:var(--ym-controls-color-secondary-text-enabled,#fff);' +
                'box-shadow:0 8px 32px rgba(0,0,0,.45);font:inherit';
            const item = document.createElement('button');
            item.type = 'button';
            item.setAttribute('role', 'menuitem');
            item.textContent = 'Скачать обложку';
            item.style.cssText = 'display:block;width:100%;padding:.625rem .875rem;border:0;border-radius:.5rem;background:transparent;' +
                'color:inherit;font:inherit;text-align:left;cursor:pointer';
            item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,.1)'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenu();
                saveCover(urls);
            });
            menu.appendChild(item);
            document.body.appendChild(menu);
            const r = menu.getBoundingClientRect();
            menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
            menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
        }

        document.addEventListener('contextmenu', (e) => {
            if (!document.querySelector(FS)) { closeMenu(); return; }
            const urls = coverCandidates(e.clientX, e.clientY);
            if (!urls) { closeMenu(); return; }
            e.preventDefault();
            e.stopPropagation();
            openMenu(e.clientX, e.clientY, urls);
        }, true);
        document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); }, true);
        window.addEventListener('blur', closeMenu);
        window.addEventListener('resize', closeMenu);
    })();

    function setPctLabel(text) {
        const l = panel.querySelector('#ymd-pct');
        if (l) l.textContent = text;
    }

    function _plainTrackId(t) {
        return String((t && (t.realId || t.id)) || '').split(':')[0];
    }

    const _albumCache = new Map();
    async function getAlbumDetails(albumId) {
        const key = String(albumId);
        if (_albumCache.has(key)) return _albumCache.get(key);
        let result = null;
        try {
            const token = getOAuthToken();
            const h = {
                "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
                "X-Yandex-Music-Frontend": "new",
                "X-Yandex-Music-Without-Invocation-Info": "1",
            };
            if (token) h["Authorization"] = token;
            const d = await gmJSON(`${API_BASE}/albums/${key}/with-tracks?resumeStream=false&richTracks=false`, h);
            const r = (d && d.volumes) ? d : (d && d.result);
            if (r && Array.isArray(r.volumes)) result = r;
        } catch (e) {
            console.warn('[YMD] не удалось получить альбом ' + key + ':', e && e.message || e);
        }
        _albumCache.set(key, result);
        if (result) await sleep(150);
        return result;
    }

    function _yearFrom(obj) {
        if (!obj) return undefined;
        const y = obj.year || obj.originalReleaseYear;
        if (y) return String(y).slice(0, 4);
        const m = /^(\d{4})/.exec(String(obj.releaseDate || ''));
        return m ? m[1] : undefined;
    }

    async function resolveTrackTags(t) {
        const al = (t && t.albums && t.albums[0]) || null;
        const pos = al && al.trackPosition;
        let number = pos && Number(pos.index) > 0 ? Number(pos.index) : undefined;
        let total  = al && Number(al.trackCount) > 0 ? Number(al.trackCount) : undefined;
        let year   = _yearFrom(al);
        let disc   = pos && Number(pos.volume) > 0 ? Number(pos.volume) : undefined;
        let discTotal;
        if (al && al.id) {
            const d = await getAlbumDetails(al.id);
            if (d) {
                const tid = _plainTrackId(t);
                for (let vi = 0; vi < d.volumes.length; vi++) {
                    const vol = d.volumes[vi];
                    const idx = (vol || []).findIndex(x => _plainTrackId(x) === tid);
                    if (idx >= 0) { number = idx + 1; total = vol.length; disc = vi + 1; discTotal = d.volumes.length; break; }
                }
                if (!year) year = _yearFrom(d);
                if (!total && Number(d.trackCount) > 0) total = Number(d.trackCount);
            }
        }
        if (number && total && number > total) total = undefined;
        if (disc && discTotal && disc > discTotal) discTotal = undefined;
        return { number, total, year, disc, discTotal };
    }

    function lrcToPlain(lrc) {
        return String(lrc || '')
            .replace(/\r/g, '')
            .split('\n')
            .filter(l => !/^\s*\[(?:ar|ti|al|au|by|offset|re|ve|length|id):[^\]]*\]\s*$/i.test(l))
            .map(l => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
                       .replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim())
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    const YMD_LYRICS_SIGN_KEY = "p93jhgh689SBReK6ghtw62";

    async function _fetchNativeLrc(trackId) {
        trackId = String(trackId || '');
        if (!trackId) return null;
        if (_nativeLyricsCache.has(trackId)) return _nativeLyricsCache.get(trackId);
        const token = getOAuthToken();
        if (!token) return null;
        const headers = {
            "Authorization": token,
            "X-Yandex-Music-Client": "YandexMusicDesktopAppWindows/" + getVersion(),
        };
        const ts = Math.floor(Date.now() / 1000);
        const full = await getSign(YMD_LYRICS_SIGN_KEY, `${trackId}${ts}`);
        const signs = [full + '=', full];
        for (const sign of signs) {
            try {
                const info = await gmJSON(
                    `${API_BASE}/tracks/${trackId}/lyrics?format=LRC&timeStamp=${ts}&sign=${encodeURIComponent(sign)}`,
                    headers
                );
                const root = info && (info.result || info);
                const dl = root && root.downloadUrl;
                if (!dl) return null;
                const res = await gmFetch(dl, {});
                const text = res.responseText || '';
                if (!_isRealLyrics(text)) return null;
                _nativeLyricsCache.set(trackId, text);
                return text;
            } catch (e) {
                if (!/HTTP (400|401|403)/.test(String(e && e.message))) return null;
            }
        }
        return null;
    }

    async function getLyricsForTag(trackId) {
        if (!trackId) return null;
        try {
            let plain = null;
            let native = _nativeLyricsCache.get(String(trackId));
            if (!native) native = await _fetchNativeLrc(trackId);
            if (native) plain = lrcToPlain(native);
            if (!plain) {
                const lrc = await _fetchExternalLrc(String(trackId));
                if (lrc && lrc !== YMD_NO_LYRICS_LRC) {
                    plain = _plainCache.has(String(trackId)) ? _plainCache.get(String(trackId)) : lrcToPlain(lrc);
                }
            }
            plain = plain ? String(plain).replace(/\r/g, '').trim() : '';
            return plain && /\p{L}/u.test(plain) ? plain : null;
        } catch (e) {
            console.warn('[YMD] текст для тегов не получен:', e && e.message || e);
            return null;
        }
    }

    let downloading = false;
    let downloadCancelled = false;
    let downloadPaused = false;

    function getVibeTrackInfo() {
        const info = { id: null, title: '', artist: '' };
        const text = el => (el && el.textContent || '').trim();

        const vibeRoots = document.querySelectorAll(
            '[class*="VibePlayerBar"], [class*="VibePlayerbarMeta"], [class*="VibePage_playerBlock"]'
        );
        for (const r of vibeRoots) {
            const a = r.matches('a:is([href*="/track/"],[href*="trackId="])') ? r : r.querySelector('a:is([href*="/track/"],[href*="trackId="])');
            const m = a && a.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
            if (m) { info.id = m[1]; break; }
        }

        info.title = text(document.querySelector('[class*="VibePlayerbarMeta_trackNameText"]'));
        info.artist = text(document.querySelector('[class*="VibePlayerbarMeta_artistText"]'));

        if (!info.title) {
            try {
                const md = navigator.mediaSession && navigator.mediaSession.metadata;
                if (md && md.title) {
                    info.title = String(md.title).trim();
                    if (!info.artist) info.artist = String(md.artist || '').trim();
                }
            } catch (e) {}
        }

        if (!info.id && !info.title) {
            try {
                const s = unsafeWindow.__STATE_SNAPSHOT__;
                const arr = Array.isArray(s) ? s : [s];
                for (const snap of arr) {
                    const id = snap?.sonataState?.entityMeta?.id;
                    if (id) { info.id = String(id); break; }
                }
            } catch (e) {}
        }
        return info;
    }

    async function downloadVibeTrack(srcBtn) {
        const info = getVibeTrackInfo();
        if (info.id) { startDownload(srcBtn, info.id); return; }
        if (!info.title) {
            ymdDialog({
                title: 'Сначала включите трек',
                lines: ['Чтобы скачать трек, запустите его в «Моей волне».'],
                sub: 'После начала воспроизведения нажмите кнопку скачивания ещё раз.',
                okLabel: 'ОК',
                single: true
            });
            return;
        }

        const trackName = info.title, artistName = info.artist;
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
            startDownload(srcBtn, String(best.id));
        } catch (e) {
            status(`Ошибка поиска: ${e.message}`, true);
            hideStatus(6000);
        }
    }

    const YMD_TRACK_RETRIES = 2;
    const YMD_AUDIO_EXTS = ['flac', 'mp3', 'm4a'];

    function ymdEscHtml(v) {
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    async function ymdFileExists(name) {
        if (!ymdSaveDir) return false;
        for (const ext of YMD_AUDIO_EXTS) {
            try {
                const fh = await ymdSaveDir.getFileHandle(name + '.' + ext);
                const file = await fh.getFile();
                if (file.size > 0) return true;
            } catch (e) {}
        }
        return false;
    }

    function ymdBatchPanel(total) {
        const YMD_ROW_H = 26, YMD_ROW_GAP = 8;
        const concRows = Math.max(1, Math.min(ymdDlConc(), total));
        const listH = concRows * YMD_ROW_H + (concRows - 1) * YMD_ROW_GAP + 5;
        panel.style.display = 'flex';
        ymdPanelWidth(true);
        panel.innerHTML = `
            <div id="ymd-b-mini" title="Развернуть" style="display:none;cursor:pointer;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;">
                    <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузка</strong>
                    <span id="ymd-b-mini-text" style="color:#aaa;white-space:nowrap;">0/${total} · 0%</span>
                </div>
                <div style="margin-top:6px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;height:4px;">
                    <div id="ymd-b-mini-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#ffff00,#ff9800);transition:width 0.15s ease;border-radius:4px;"></div>
                </div>
            </div>
            <div id="ymd-b-full" style="display:flex;flex-direction:column;flex:1 1 auto;min-height:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="color:#ffff00;font-family:var(--ym-font-heading)">Загрузчик Музыки</strong>
                <div style="display:flex;align-items:center;"><button type="button" id="ymd-min" class="ymd-panel-close-x" title="Свернуть" aria-label="Свернуть"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true" focusable="false" role="img"><path fill="currentColor" d="M5 11h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2z"></path></svg></button>${YMD_PANEL_CLOSE_HTML}</div>
            </div>
            <span id="ymd-b-count" style="font-size:13px;color:#aaa;">Готово 0 из ${total}</span>
            <div style="margin-top:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;height:6px;">
                <div id="ymd-b-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#ffff00,#ff9800);transition:width 0.15s ease;border-radius:4px;"></div>
            </div>
            <div id="ymd-b-size" style="margin-top:6px;font-size:12px;color:#aaa;">0.00/… МБ · (0/100%)</div>
            <div id="ymd-b-speed" style="margin-top:6px;font-size:12px;color:#aaa;">Скорость: считаю...</div>
            <div id="ymd-b-list" class="ymd-scroll" style="margin-top:10px;display:flex;flex-direction:column;gap:${YMD_ROW_GAP}px;flex:0 1 auto;height:${listH}px;min-height:0;overflow-y:auto;"></div>
            <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px;">
                <button id="ymd-pause-btn" style="background:rgba(255,200,0,0.15);color:#ffc800;border:1px solid rgba(255,200,0,0.3);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;" onmouseover="this.style.background='rgba(255,200,0,0.3)'" onmouseout="this.style.background='rgba(255,200,0,0.15)'">⏸ Пауза</button>
                <button id="ymd-cancel-btn" style="background:rgba(255,85,85,0.15);color:#ff5555;border:1px solid rgba(255,85,85,0.3);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;" onmouseover="this.style.background='rgba(255,85,85,0.3)'" onmouseout="this.style.background='rgba(255,85,85,0.15)'">Отмена</button>
            </div>
            </div>
        `;
        ymdBindPanelControls();
        const list = panel.querySelector('#ymd-b-list');
        const countEl = panel.querySelector('#ymd-b-count');
        const barEl = panel.querySelector('#ymd-b-bar');
        const speedEl = panel.querySelector('#ymd-b-speed');
        const sizeEl = panel.querySelector('#ymd-b-size');
        const fullEl = panel.querySelector('#ymd-b-full');
        const miniEl = panel.querySelector('#ymd-b-mini');
        const miniText = panel.querySelector('#ymd-b-mini-text');
        const miniBar = panel.querySelector('#ymd-b-mini-bar');
        let minimized = false;
        const placeMini = () => {
            if (!miniEl.isConnected) { window.removeEventListener('resize', placeMini); return; }
            if (!minimized) return;
            const anchor = document.getElementById('ymd-nav-settings');
            const r = anchor ? anchor.getBoundingClientRect() : null;
            let left = 20, bottom = 20, width = 200;
            if (r && r.width > 0 && r.height > 0) {
                left = Math.round(r.left);
                bottom = Math.round(window.innerHeight - r.top + 8);
                width = Math.max(Math.round(r.width), 180);
            }
            panel.style.left = left + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = bottom + 'px';
            panel.style.minWidth = '0';
            panel.style.width = width + 'px';
            panel.style.maxWidth = width + 'px';
            panel.style.height = 'auto';
            panel.style.maxHeight = 'none';
        };
        const setMin = (on) => {
            minimized = on;
            fullEl.style.display = on ? 'none' : 'flex';
            miniEl.style.display = on ? 'block' : 'none';
            if (on) { placeMini(); }
            else { ymdPanelWidth(true); }
        };
        panel.querySelector('#ymd-min').addEventListener('click', () => setMin(true));
        miniEl.addEventListener('click', () => setMin(false));
        window.addEventListener('resize', placeMini);
        const inflight = new Set();
        const samples = [];
        let closedLoaded = 0, closedTotal = 0, bytes = 0, doneCount = 0, sizeSum = 0, sizeCnt = 0;
        const updateSize = () => {
            if (!sizeEl || !sizeEl.isConnected) return;
            let loaded = closedLoaded, est = closedTotal, known = 0, knownCnt = 0;
            for (const st of inflight) {
                loaded += st.loaded;
                if (st.total > 0) { known += st.total; knownCnt++; }
            }
            const avg = sizeCnt ? sizeSum / sizeCnt : (knownCnt ? known / knownCnt : 0);
            for (const st of inflight) est += st.total > 0 ? st.total : avg;
            est += Math.max(0, total - doneCount - inflight.size) * avg;
            est = Math.max(est, loaded);
            const toMB = n => (n / 1048576).toFixed(2);
            const pct = est > 0 ? Math.min(100, Math.round(loaded / est * 100)) : 0;
            if (miniText) miniText.textContent = `${doneCount}/${total} · ${pct}%`;
            if (miniBar) miniBar.style.width = pct + '%';
            sizeEl.textContent = est > 0
                ? `${toMB(loaded)}/${toMB(est)} МБ · (${pct}/100%)`
                : `${toMB(loaded)}/… МБ · (0/100%)`;
        };
        const fmtSpeed = (bps) => bps >= 1048576
            ? (bps / 1048576).toFixed(1) + ' МБ/с'
            : Math.round(bps / 1024) + ' КБ/с';
        const fmtEta = (sec) => {
            sec = Math.max(1, Math.round(sec));
            if (sec < 60) return sec + ' с';
            const m = Math.floor(sec / 60);
            if (m < 10) return m + ' мин' + (sec % 60 ? ' ' + (sec % 60) + ' с' : '');
            if (m < 60) return m + ' мин';
            return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
        };
        const tick = () => {
            if (!speedEl || !speedEl.isConnected) { clearInterval(timer); return; }
            updateSize();
            placeMini();
            if (downloadPaused) { speedEl.textContent = 'Пауза'; return; }
            const now = Date.now();
            samples.push({ t: now, b: bytes });
            while (samples.length > 2 && now - samples[0].t > 6000) samples.shift();
            const dt = (now - samples[0].t) / 1000;
            const speed = dt > 0 ? (bytes - samples[0].b) / dt : 0;
            if (!(speed > 0)) { speedEl.textContent = 'Скорость: считаю...'; return; }
            let remain = 0, known = 0, knownCnt = 0;
            for (const st of inflight) {
                if (st.total > 0) { remain += Math.max(0, st.total - st.loaded); known += st.total; knownCnt++; }
            }
            const avg = sizeCnt ? sizeSum / sizeCnt : (knownCnt ? known / knownCnt : 0);
            remain += Math.max(0, total - doneCount - inflight.size) * avg;
            let text = 'Скорость: ' + fmtSpeed(speed);
            if (avg > 0 && remain > 0) text += ' · Осталось ~' + fmtEta(remain / speed);
            speedEl.textContent = text;
        };
        const timer = setInterval(tick, 1000);
        return {
            stop() { clearInterval(timer); window.removeEventListener('resize', placeMini); },
            done(finished) {
                doneCount = finished;
                if (countEl) countEl.textContent = `Готово ${finished} из ${total}`;
                if (barEl) barEl.style.width = Math.round(finished / total * 100) + '%';
                updateSize();
            },
            open(name) {
                const row = document.createElement('div');
                row.innerHTML =
                    '<div style="display:flex;align-items:center;gap:8px;font-size:12px;">' +
                        '<b class="ymd-b-name" style="color:#00e676;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></b>' +
                        '<span class="ymd-b-badge" style="flex:none;"></span>' +
                        '<span class="ymd-b-pct" style="color:#aaa;flex:none;">0%</span>' +
                    '</div>' +
                    '<div style="margin-top:3px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden;height:3px;">' +
                        '<div class="ymd-b-rbar" style="height:100%;width:0%;background:#00e676;transition:width 0.15s ease;"></div>' +
                    '</div>';
                row.querySelector('.ymd-b-name').textContent = name;
                if (list) list.appendChild(row);
                const badgeEl = row.querySelector('.ymd-b-badge');
                const pctEl = row.querySelector('.ymd-b-pct');
                const rbarEl = row.querySelector('.ymd-b-rbar');
                const st = { loaded: 0, total: 0 };
                inflight.add(st);
                return {
                    info(info) { badgeEl.innerHTML = formatBadge(info); },
                    progress(pct, loaded, tot) {
                        if (loaded != null) {
                            if (loaded < st.loaded) st.loaded = 0;
                            bytes += loaded - st.loaded;
                            st.loaded = loaded;
                            if (tot > 0) st.total = tot;
                        }
                        const p = Math.max(0, Math.min(100, Math.round(pct)));
                        rbarEl.style.width = p + '%';
                        updateSize();
                        if (loaded != null && tot != null && tot > 0) {
                            const toMB = n => (n / 1048576).toFixed(1);
                            pctEl.textContent = `${toMB(loaded)}/${toMB(tot)} МБ · ${p}%`;
                        } else {
                            pctEl.textContent = p + '%';
                        }
                    },
                    label(text) { pctEl.textContent = text; },
                    close() {
                        row.remove();
                        if (inflight.delete(st)) {
                            closedLoaded += st.loaded;
                            closedTotal += st.total > 0 ? st.total : st.loaded;
                            if (st.total > 0) { sizeSum += st.total; sizeCnt++; }
                        }
                        updateSize();
                    }
                };
            }
        };
    }

    async function ymdDownloadOne(t, name, qualityOption, downloadCovers, embedLyrics, ui) {
        let info, url = null, preBuf = null;
        if (qualityOption.instr) {
            info = { codec: qualityOption.codec, bitrate: qualityOption.bitrate };
            ui.info(info);
            preBuf = await ymdInstrFetch(t, qualityOption, ui);
            if (!preBuf) return 'preview';
        } else {
            info = await getTrackDownloadUrl(t.id, qualityOption);

            url = info.url || info.urls?.[0];
            if (!url) throw new Error("Нет ссылки");

            if (info.quality === "preview") return 'preview';

            ui.info(info);
        }
        const getAudio = async () => preBuf || await downloadWithPause(url, ui.progress);
        const ext = getExt(info.codec);

        const isMP3        = info.codec === 'mp3';
        const isFlacMp4    = info.codec === 'flac-mp4';
        const isFlacNative = info.codec === 'flac';
        const isM4A        = !isFlacMp4 && (ext === 'm4a' || info.codec.includes('mp4') || info.codec.includes('aac'));

        const tagOpts = ymdTagOpts();
        const coverOn = ymdDlCoversOn();
        let tags = {};
        let lyricsText = null;
        if (downloadCovers) {
            tags = await resolveTrackTags(t);
            if (embedLyrics && tagOpts.lyrics) {
                ui.label('Поиск текста песни...');
                lyricsText = await getLyricsForTag(_plainTrackId(t));
            }
        }

        const trackMeta = {
            trackNumber: tagOpts.number ? tags.number : undefined,
            trackTotal:  tagOpts.number ? tags.total  : undefined,
            discNumber:  tagOpts.disc   ? tags.disc      : undefined,
            discTotal:   tagOpts.disc   ? tags.discTotal : undefined,
            title:       tagOpts.title  ? (t.title || name) : undefined,
            artist:      tagOpts.artist ? ((t.artists || []).map(a => a.name).join(', ') || 'Unknown') : undefined,
            album:       tagOpts.album  ? (tagOpts.albumAsTitle ? (t.title || name) : (t.albums?.[0]?.title || t.title || name)) : undefined,
            genre:       tagOpts.genre  ? (t.albums?.[0]?.genre || undefined) : undefined,
            date:        tagOpts.year   ? tags.year : undefined,
            lyrics:      lyricsText || undefined,
            lyricsLang:  lyricsText && _cyrShare(lyricsText) >= 0.5 ? 'rus' : 'XXX',
        };

        if (isFlacMp4) {
            const audioBuf = await getAudio();
            if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

            let coverBuf = null;
            if (downloadCovers) {
                try {
                    const coverUrl = coverOn && tagOpts.cover ? getCoverUrl(t) : null;
                    if (coverUrl) {
                        const r = await gmFetchBinary(coverUrl);
                        if (r.status === 200) coverBuf = r.response;
                    }
                } catch(_) {}
            }

            const flacBuf = tagFlacFromMp4(audioBuf, downloadCovers ? trackMeta : null, coverBuf);

            if (flacBuf) {
                await downloadBlob(flacBuf, `${name}.flac`, 'audio/flac');
            } else {
                console.warn('[YMD] Не удалось демультиплексировать FLAC из MP4-контейнера, сохраняю как .m4a');
                if (downloadCovers) {
                    const taggedBuf = writeM4ATags(audioBuf, trackMeta, coverBuf);
                    await downloadBlob(taggedBuf, `${name}.m4a`, 'audio/mp4');
                } else {
                    await downloadBlob(audioBuf, `${name}.m4a`, 'audio/mp4');
                }
            }
        } else if (isFlacNative && downloadCovers) {
            const audioBuf = await getAudio();
            if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

            let coverBuf = null;
            try {
                const coverUrl = coverOn && tagOpts.cover ? getCoverUrl(t) : null;
                if (coverUrl) {
                    const r = await gmFetchBinary(coverUrl);
                    if (r.status === 200) coverBuf = r.response;
                }
            } catch(_) {}

            const taggedBuf = tagNativeFlac(audioBuf, trackMeta, coverBuf);
            await downloadBlob(taggedBuf, `${name}.flac`, 'audio/flac');
        } else if ((isMP3 || isM4A) && downloadCovers) {
            const audioBuf = await getAudio();
            if (!audioBuf || audioBuf.byteLength === 0) throw new Error("Пустой ответ от CDN");

            let coverBuf = null;
            try {
                const coverUrl = coverOn && tagOpts.cover ? getCoverUrl(t) : null;
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

            await downloadBlob(taggedBuf, `${name}.${ext}`, mimeType);
        } else if (preBuf) {
            await downloadBlob(preBuf, `${name}.${ext}`, isMP3 ? 'audio/mpeg' : 'audio/flac');
        } else {
            await downloadFile(url, `${name}.${ext}`, ui.progress);

            if (downloadCovers && coverOn) {
                const coverUrl = getCoverUrl(t);
                if (coverUrl) {
                    await downloadCoverFile(coverUrl, name);
                    await sleep(200);
                }
            }
        }
        return 'ok';
    }

    async function startDownload(btn, singleTrackId, retry) {
        if (downloading) return;
        downloading = true;
        downloadCancelled = false;
        downloadPaused = false;
        const origHTML = btn.innerHTML;

        try {
            let choice;
            if (retry) {
                choice = retry.choice;
            } else if (ymdQualitySkip()) {
                const dc = ymdEmbedTagsOn();
                choice = { quality: QUALITY_OPTIONS[ymdQualityIdx()], downloadCovers: dc, embedLyrics: dc };
            } else {
                choice = await showQualityPicker();
            }
            if (!choice) { downloading = false; return; }
            let { quality: qualityOption, downloadCovers, embedLyrics } = choice;

            if (qualityOption.instr && !ymdKarKey()) {
                await promptForMvsepKey();
                if (!ymdKarKey()) { panel.style.display = 'none'; downloading = false; return; }
            }

            if (retry) {
                ymdSaveDir = retry.dir || null;
            } else if (singleTrackId) {
                ymdSaveDir = null;
            } else if (!(await ymdResolveSaveTarget())) { panel.style.display = 'none'; downloading = false; return; }

            status("Проверка авторизации...");
            const auth = await checkAuth();

            if (!auth.ok) {
                panel.style.display = 'block';
                ymdPanelWidth(false);
                panel.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <strong style="color:#ff5555">Загрузчик Музыки</strong>
                        ${YMD_PANEL_CLOSE_HTML}
                    </div>
                    <div style="font-size:13px;line-height:1.5;">
                        ⚠️ Токен не найден.<br>
                        <b style="color:#ffff00">Что делать:</b><br>
                        1. Включите любой трек — токен подхватится автоматически<br>
                        2. Или откройте ⚙️ Настройки (слева в меню сайта или в меню Tampermonkey) → Токен → «Настроить токен»<br>
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

            if (retry) {
                ids = retry.ids.slice();
            } else if (singleTrackId) {
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

            let ok = 0, skip = 0, fail = 0, existed = 0, finished = 0;
            const failedTracks = [];
            const total = meta.length;
            const batch = total > 1;
            const names = new Array(total).fill(null);
            const dupes = new Set();
            const seenIds = new Set();
            const nameCount = new Map();
            for (let i = 0; i < total; i++) {
                const t = meta[i];
                if (!t || t.available === false || t.error) continue;
                const pid = _plainTrackId(t);
                if (pid && seenIds.has(pid)) { dupes.add(i); continue; }
                if (pid) seenIds.add(pid);
                const base = sanitize(`${formatArtists(t.artists) || "Unknown"} - ${toTitleCase(t.title) || "Unknown"}`);
                const n = (nameCount.get(base) || 0) + 1;
                nameCount.set(base, n);
                names[i] = n > 1 ? `${base} (${n})` : base;
            }

            const batchUi = batch ? ymdBatchPanel(total) : null;
            const showBtnProgress = () => {
                if (!singleTrackId && btn && document.body.contains(btn)) {
                    btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} ${finished}/${total}</span>`;
                }
            };
            const reportDone = () => {
                finished++;
                if (batchUi) batchUi.done(finished);
                showBtnProgress();
            };
            showBtnProgress();

            const processOne = async (i) => {
                const t = meta[i];
                if (!t || t.available === false || t.error) {
                    skip++;
                    const fallbackName = t && t.title
                        ? sanitize(`${formatArtists(t.artists) || "Unknown"} - ${toTitleCase(t.title) || "Unknown"}`)
                        : `ID ${ids[i] || (i + 1)}`;
                    failedTracks.push({ name: fallbackName, reason: "недоступен" });
                    reportDone();
                    return;
                }
                if (dupes.has(i)) {
                    existed++;
                    reportDone();
                    return;
                }
                const name = names[i];
                if (batch && ymdSkipExistingOn() && await ymdFileExists(name)) {
                    existed++;
                    reportDone();
                    return;
                }
                if (downloadCancelled) return;

                let ui;
                if (batchUi) {
                    ui = batchUi.open(name);
                } else {
                    statusWithProgress(name, 1, total);
                    ui = { info: (info) => statusWithProgress(name, 1, total, info), progress: setProgress, label: setPctLabel, close() {} };
                }

                let result = null;
                let lastErr = null;
                for (let attempt = 0; attempt <= YMD_TRACK_RETRIES; attempt++) {
                    if (downloadCancelled) break;
                    try {
                        result = await ymdDownloadOne(t, name, qualityOption, downloadCovers, embedLyrics, ui);
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                        if (downloadCancelled || (e && e.message === 'Отменено')) break;
                        console.error(`[YMD] ✗ ${name} (попытка ${attempt + 1}):`, e);
                        if (attempt < YMD_TRACK_RETRIES) {
                            ui.label(`Повтор ${attempt + 1} из ${YMD_TRACK_RETRIES}...`);
                            await sleep(1500 * (attempt + 1));
                        }
                    }
                }
                ui.close();

                if (!result && (downloadCancelled || (lastErr && lastErr.message === 'Отменено'))) return;
                if (lastErr) {
                    fail++;
                    failedTracks.push({ name, reason: lastErr.message || "неизвестная ошибка", id: String(t.id), retry: true });
                } else if (result === 'preview') {
                    skip++;
                    failedTracks.push({ name, reason: "нужен Плюс / только превью" });
                } else {
                    ok++;
                }
                reportDone();
            };

            let nextIdx = 0;
            const runWorker = async (delay) => {
                if (delay) await sleep(delay);
                for (;;) {
                    if (downloadCancelled) return;
                    await waitIfPaused();
                    if (downloadCancelled) return;
                    const i = nextIdx++;
                    if (i >= total) return;
                    try {
                        await processOne(i);
                    } catch (e) {
                        console.error('[YMD] Ошибка обработки трека', e);
                        fail++;
                        failedTracks.push({ name: names[i] || `ID ${ids[i] || (i + 1)}`, reason: (e && e.message) || "неизвестная ошибка" });
                        reportDone();
                    }
                }
            };
            const workers = [];
            const conc = (batch && !qualityOption.instr) ? Math.min(ymdDlConc(), total) : 1;
            for (let w = 0; w < conc; w++) workers.push(runWorker(w * 400));
            try {
                await Promise.all(workers);
            } finally {
                if (batchUi) batchUi.stop();
            }

            const retryIds = batch ? failedTracks.filter(f => f.retry).map(f => f.id) : [];
            const retryDir = ymdSaveDir;

            let s = "";
            if (downloadCancelled) s += `<b style="color:#ff9800">Отменено</b><br>`;
            if (ok) s += `<b style="color:#00e676">Скачано: ${ok}</b><br>`;
            if (existed) s += `<b style="color:#aaa">Уже есть: ${existed}</b><br>`;
            if (skip) s += `<b style="color:#ff9800">Пропущено: ${skip}</b><br>`;
            if (fail) s += `<b style="color:#ff5555">Ошибок: ${fail}</b>`;

            if (failedTracks.length) {
                const listId = 'ymd-failed-list';
                s += `
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.12);">
                        <div style="margin-bottom:4px;">
                            <span style="font-size:12px;color:#ccc;">Не скачано (${failedTracks.length}):</span>
                        </div>
                        <div id="${listId}" class="ymd-scroll" style="max-height:160px;overflow-y:auto;font-size:12px;line-height:1.6;">
                            ${failedTracks.map(f => `<div style="color:#ccc;">${ymdEscHtml(f.name)}<span style="color:#888;"> — ${ymdEscHtml(f.reason)}</span></div>`).join('')}
                        </div>
                        ${retryIds.length ? `<button id="ymd-retry-btn" style="margin-top:10px;width:100%;background:#ffff00;color:#000;border:none;border-radius:16px;padding:7px 16px;cursor:pointer;font-size:13px;font-weight:bold;font-family:var(--ym-font-heading);">Повторить неудачные (${retryIds.length})</button>` : ''}
                    </div>
                `;
            }

            status(s || "Готово!");

            if (batch && !downloadCancelled) {
                const parts = [];
                if (ok) parts.push('Скачано: ' + ok + ' из ' + total);
                if (existed) parts.push('Уже есть: ' + existed);
                if (skip) parts.push('Пропущено: ' + skip);
                if (fail) parts.push('Ошибок: ' + fail);
                ymdNotifyDone('Загрузка завершена', parts.join(' · ') || 'Готово');
            }

            if (retryIds.length) {
                const rb = panel.querySelector('#ymd-retry-btn');
                if (rb) rb.addEventListener('click', () => {
                    startDownload(btn, null, { ids: retryIds, choice, dir: retryDir });
                });
            }

            if (!singleTrackId && btn && document.body.contains(btn)) {
                btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${iconSvg} Готово</span>`;
            }
            if (!failedTracks.length && meta.length <= 1) hideStatus(6000);
            setTimeout(() => { if (btn && document.body.contains(btn)) btn.innerHTML = origHTML; }, 5000);

        } catch (e) {
            console.error("[YMD] Fatal:", e);
            status(e.message, true);
            if (btn && document.body.contains(btn)) btn.innerHTML = origHTML;
            hideStatus(8000);
        } finally {
            downloading = false;
            downloadPaused = false;
            ymdSaveDir = null;
        }
    }

    let _vibeHoverResolved = false;
    function _vibeHoverCss(color) {
        const base = ['.VibePlayerBar_progress__Cri6E .ymd-lyrics-btn', '.VibePlayerBar_progress__Cri6E button[aria-label="Скачать текущий трек"]'];
        const h = base.map(x => x + ':hover, ' + x + ':focus-visible').join(', ');
        const hs = base.map(x => x + ':hover svg, ' + x + ':focus-visible svg').join(', ');
        const sv = base.map(x => x + ' svg').join(', ');
        return sv + '{transition:color .15s,fill .15s}' +
               h + '{color:' + color + '!important}' +
               hs + '{color:' + color + '!important;fill:' + color + '!important}';
    }

    function _gmText(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 12000,
                onload: (r) => r.status === 200 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
                onerror: reject, ontimeout: reject
            });
        });
    }

    async function _resolveNativeHoverColor(refBtn) {
        const classes = Array.from(refBtn.classList);
        let best = null;
        const visit = (rules) => {
            for (const r of rules) {
                if (!r.selectorText) { if (r.cssRules) { try { visit(r.cssRules); } catch (e) {} } continue; }
                const sel = r.selectorText;
                if (!/:hover/.test(sel)) continue;
                if (!classes.some(c => sel.includes('.' + c))) continue;
                const v = (r.style.getPropertyValue('color') || r.style.getPropertyValue('fill') || '').trim();
                if (v && !/^(inherit|initial|unset|currentcolor)$/i.test(v)) best = { sel, v };
            }
        };
        for (const sheet of Array.from(document.styleSheets)) {
            let rules = null;
            try { rules = sheet.cssRules; } catch (e) {}
            if (!rules && sheet.href) {
                try {
                    const cs = new CSSStyleSheet();
                    cs.replaceSync(await _gmText(sheet.href));
                    rules = cs.cssRules;
                } catch (e) {}
            }
            if (rules) { try { visit(rules); } catch (e) {} }
        }
        return best;
    }

    function inject() {
        try { fckFixDom(); } catch (e) {}
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
        const isChartPage = !!document.querySelector('.ChartTracksPage_root__QMbqY');
        const isArtistTracksPage = /\/artist\/\d+\/tracks/.test(window.location.pathname)
            || !!document.querySelector('[class*="ArtistTracksPage_root"]');
        if (chartStaticHeader && (isChartPage || isArtistTracksPage)) {
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
                btn.onclick = () => startDownload(btn);
                if (isArtistTracksPage && !isChartPage) {
                    btn.style.cssText = 'margin:0;display:inline-flex;align-items:center;flex-shrink:0;';
                    chartStaticHeader.style.cssText += ';display:flex;align-items:center;gap:16px;overflow:visible;';
                    const h1 = chartStaticHeader.querySelector('h1');
                    if (h1) {
                        h1.style.minWidth = '0';
                        h1.insertAdjacentElement('afterend', btn);
                    } else {
                        chartStaticHeader.appendChild(btn);
                    }
                } else {
                    btn.style.cssText = 'margin-top:12px;display:inline-flex;align-items:center;';
                    chartStaticHeader.appendChild(btn);
                }
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
        const barSrcBtn = bar && (
            bar.querySelector('button[class*="ChangeVolume_button"]') ||
            Array.from(bar.querySelectorAll('button')).find(b => !b.disabled && b.getAttribute('data-disabled') !== 'true')
        );
        if (bar && barSrcBtn) {
            bar.classList.add('ymd-done');

            const btn = document.createElement('button');
            btn.className = barSrcBtn.className.replace(/\S*ChangeVolume_\S*|\S*settingsButton\S*/g, '').replace(/\s+/g, ' ').trim();
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Скачать текущий трек');
            btn.title = 'Скачать текущий трек';
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

            btn.onclick = () => {
                const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                const link = info?.querySelector('a:is([href*="/track/"],[href*="trackId="])');
                if (link) {
                    const m = link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
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
                ymdDialog({
                    title: 'Сначала включите трек',
                    lines: ['Не удалось определить текущий трек.'],
                    sub: 'Запустите воспроизведение и нажмите кнопку скачивания ещё раз.',
                    okLabel: 'ОК',
                    single: true
                });
            };

            bar.insertBefore(btn, bar.firstChild);
        }

        const vibeProgress = document.querySelector('.VibePlayerBar_progress__Cri6E');
        if (vibeProgress && !vibeProgress.querySelector('button[aria-label="Скачать текущий трек"]')) {

            const likeBtn = Array.from(vibeProgress.children).find(
                el => el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'Нравится'
            );
            const vibeSrcBtn = vibeProgress.querySelector('button[aria-haspopup="menu"]');
            if (likeBtn && vibeSrcBtn) {
                const vibeBtn = document.createElement('button');
                vibeBtn.className = vibeSrcBtn.className;
                vibeBtn.type = 'button';
                vibeBtn.setAttribute('aria-label', 'Скачать текущий трек');
                vibeBtn.title = 'Скачать трек';
                vibeBtn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

                vibeBtn.addEventListener('click', () => downloadVibeTrack(vibeBtn));

                likeBtn.parentNode.insertBefore(vibeBtn, likeBtn);
            }
        }

        (function injectFullscreenDownloadBtn() {
            const root = document.querySelector('[class*="FullscreenPlayerDesktopControls_root__"]');
            if (!root || root.querySelector('.ymd-fs-dl-btn')) return;

            if (!document.getElementById('ymd-fs-dl-style')) {
                const st = document.createElement('style');
                st.id = 'ymd-fs-dl-style';
                st.textContent =
                    'button.ymd-fs-dl-btn{align-self:flex-start;grid-column:1;grid-row:1;justify-self:flex-start;' +
                    'margin-block-start:var(--ym-spacer-size-l);margin-inline-start:var(--ym-spacer-size-l);' +
                    'backdrop-filter:none;background-color:var(--ym-controls-color-secondary-card-enabled);' +
                    'color:var(--ym-controls-color-secondary-text-enabled_variant);height:fit-content;width:fit-content;' +
                    'transition:background-color var(--ym-duration-transition),transform var(--ym-duration-transition)}' +
                    'button.ymd-fs-dl-btn:not(:disabled):hover,button.ymd-fs-dl-btn:not(:disabled):focus-visible{' +
                    'background-color:var(--ym-controls-color-secondary-card-hovered);transform:scale(1.05)}' +
                    '@media(prefers-reduced-motion:reduce){button.ymd-fs-dl-btn,button.ymd-fs-dl-btn:not(:disabled){transition:none}}';
                document.head.appendChild(st);
            }

            const srcBtn = root.querySelector('button[class*="FullscreenPlayerDesktopControls_playQueueButton__"]')
                || root.querySelector('button[class*="FullscreenPlayerDesktopControls_speedButton__"]')
                || root.querySelector('button[class*="FullscreenPlayerDesktopControls_syncLyricsButton__"]')
                || root.querySelector('button');

            const btn = document.createElement('button');
            btn.className = srcBtn
                ? srcBtn.className.split(/\s+/).filter(c => c && !/FullscreenPlayerDesktopControls_/.test(c)).join(' ')
                : '';
            btn.classList.add('ymd-fs-dl-btn');
            btn.type = 'button';
            btn.setAttribute('aria-label', 'Скачать текущий трек');
            btn.title = 'Скачать трек';
            btn.innerHTML = `<span class="JjlbHZ4FaP9EAcR_1DxF">${downloadSmallSvgIcon}</span>`;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const link = document.querySelector(
                    '[class*="FullscreenPlayerDesktopContent_meta__"] a:is([href*="/track/"],[href*="trackId="]), ' +
                    '[class*="FullscreenPlayerDesktopContent_title__"] a:is([href*="/track/"],[href*="trackId="])'
                );
                const m = link && link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
                if (m) { startDownload(btn, m[1]); return; }
                try {
                    const s = unsafeWindow.__STATE_SNAPSHOT__;
                    const arr = Array.isArray(s) ? s : [s];
                    for (const snap of arr) {
                        const id = snap?.sonataState?.entityMeta?.id;
                        if (id) { startDownload(btn, String(id)); return; }
                    }
                } catch (err) {}
                downloadVibeTrack(btn);
            });

            root.insertBefore(btn, root.firstChild);
        })();

        (function injectVibeLyricsBtn() {
            const bar = document.querySelector('.VibePlayerBar_progress__Cri6E');
            if (!bar || bar.querySelector('.ymd-lyrics-btn')) return;
            const dislikeBtn = Array.from(bar.children).find(
                el => el.tagName === 'BUTTON' && el.getAttribute('aria-label') === 'Не нравится'
            );
            const menuBtn = bar.querySelector('button[aria-haspopup="menu"]');
            if (!dislikeBtn || !menuBtn) return;

            if (!document.getElementById('ymd-lyrics-hide-style')) {
                const st = document.createElement('style');
                st.id = 'ymd-lyrics-hide-style';
                st.textContent = 'html.ymd-hide-menu div[role="menu"]{opacity:0!important;pointer-events:none!important;transition:none!important}';
                document.head.appendChild(st);
            }

            const btn = document.createElement('button');
            btn.className = dislikeBtn.className;
            btn.classList.add('ymd-lyrics-btn');
            btn.type = 'button';
            btn.removeAttribute('aria-pressed');
            btn.setAttribute('aria-label', 'Текст песни');
            btn.title = 'Текст песни';
            btn.innerHTML = '<span class="JjlbHZ4FaP9EAcR_1DxF"><svg class="J9wTKytjOWG73QMoN5WP UwnL5AJBMMAp6NwMDdZk" focusable="false" aria-hidden="true">' +
                            '<use xlink:href="/icons/sprite.svg#syncLyrics_xs"></use></svg></span>';

            const findItem = () => {
                for (const m of document.querySelectorAll('div[role="menu"]')) {
                    const it = Array.from(m.querySelectorAll('button[role="menuitem"]'))
                        .find(b => b.querySelector('use[*|href$="#syncLyrics_xxs"], use[href$="#syncLyrics_xxs"]'));
                    if (it) return it;
                }
                return null;
            };

            let busy = false;
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (busy) return;
                busy = true;
                const root = document.documentElement;
                root.classList.add('ymd-hide-menu');
                try {
                    const src = bar.querySelector('button[aria-haspopup="menu"]');
                    if (!src) return;
                    src.click();
                    let item = null;
                    for (let i = 0; i < 30 && !(item = findItem()); i++) {
                        await sleep(50);
                        if (i === 12 && !document.querySelector('div[role="menu"]')) {
                            for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                                src.dispatchEvent(new win.MouseEvent(t, { bubbles: true, cancelable: true, view: win }));
                            }
                        }
                    }
                    if (item && !item.disabled) {
                        item.click();
                    } else {
                        console.warn('[YMD] пункт «Текст песни» не найден или disabled', { found: !!item });
                        document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                    }
                } catch (err) {
                    console.warn('[YMD] ошибка кнопки текста:', err);
                } finally {
                    await sleep(350);
                    root.classList.remove('ymd-hide-menu');
                    busy = false;
                }
            });

            dislikeBtn.insertAdjacentElement('afterend', btn);

            if (!_vibeHoverResolved) {
                _vibeHoverResolved = true;
                _resolveNativeHoverColor(dislikeBtn).then((found) => {
                    const st = document.getElementById('ymd-vibe-hover-style');
                    if (found && st) st.textContent = _vibeHoverCss(found.v);
                }).catch(() => {});
            }
        })();

        if (!document.getElementById('ymd-vibe-hover-style')) {
            const st = document.createElement('style');
            st.id = 'ymd-vibe-hover-style';
            st.textContent = _vibeHoverCss('#e6e6e6');
            document.head.appendChild(st);
        }

        if (!document.getElementById('ymd-cb-download-style')) {
            const style = document.createElement('style');
            style.id = 'ymd-cb-download-style';
            style.textContent = '.ymd-cb-download-btn{opacity:0!important;transition:none!important}' +
                '.HorizontalCardContainer_root__YoAAP:hover .ymd-cb-download-btn,' +
                '.HorizontalCardContainer_root__YoAAP:has(:focus-visible) .ymd-cb-download-btn,' +
                '.HorizontalCardContainer_root__YoAAP:focus-within .ymd-cb-download-btn{opacity:1!important}';
            document.head.appendChild(style);
        }

        document.querySelectorAll('[class*="CommonControlsBar_root"]:not(.ymd-cb-done)').forEach(bar => {
            bar.classList.add('ymd-cb-done');

            const anchorBtn = bar.querySelector('button[aria-label="Удалить из плейлиста"]')
                || bar.querySelector('button[aria-label="Нравится"]');
            if (!anchorBtn) return;

            const btn = anchorBtn.cloneNode(true);
            btn.classList.add('ymd-cb-download-btn');
            btn.removeAttribute('aria-pressed');
            btn.removeAttribute('aria-label');
            btn.setAttribute('aria-label', 'Скачать трек');
            btn.title = 'Скачать трек';

            const use = btn.querySelector('use');
            if (use) {
                use.setAttribute('xlink:href', '/icons/sprite.svg#download_xxs');
                use.setAttribute('href', '/icons/sprite.svg#download_xxs');
            }

            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const row = bar.closest('[data-index], .CommonTrack_root__i6shE, .TrackPlaylist_trackWithDots__EU6LD')
                    || bar.closest('li')
                    || bar.parentElement?.parentElement
                    || bar;
                const link = row ? row.querySelector('a:is([href*="/track/"],[href*="trackId="])') : null;
                const m = link ? link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/) : null;
                if (!m) { alert('Не удалось определить ID трека'); return; }
                startDownload(btn, m[1]);
            };

            anchorBtn.insertAdjacentElement('beforebegin', btn);
        });

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
                    downloadVibeTrack(btn);
                    return;
                }

                if (sourceBtn) {
                    const trackRow = sourceBtn.closest('[data-index], .CommonTrack_root__i6shE, .TrackPlaylist_trackWithDots__EU6LD');
                    if (trackRow) {
                        const link = trackRow.querySelector('a:is([href*="/track/"],[href*="trackId="])');
                        if (link) {
                            const m = link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
                            if (m) trackId = m[1];
                        }
                    }
                }

                if (!trackId) {
                    const info = document.querySelector('.PlayerBarDesktopWithBackgroundProgressBar_info__YnvZ_');
                    const link = info?.querySelector('a:is([href*="/track/"],[href*="trackId="])');
                    if (link) {
                        const m = link.href.match(/(?:\/track\/|[?&]trackId=)(\d+)/);
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

        const plMenus = new Set();
        if (ymdPlMenuTallOn()) {
        document.querySelectorAll('input[placeholder*="найти плейлист" i], input[aria-label*="найти плейлист" i]').forEach(inp => {
            let el = inp.parentElement;
            while (el && el !== document.body) {
                const pos = getComputedStyle(el).position;
                if (pos === 'absolute' || pos === 'fixed') { plMenus.add(el); break; }
                el = el.parentElement;
            }
        });
        document.querySelectorAll('[data-floating-ui-focusable]').forEach(el => {
            if (!(el.textContent || '').includes('Создать плейлист')) return;
            const nested = Array.from(el.querySelectorAll('[data-floating-ui-focusable]'))
                .some(c => (c.textContent || '').includes('Создать плейлист'));
            if (!nested) plMenus.add(el);
        });
        }
        plMenus.forEach(el => {
            if (!el.classList.contains('ymd-playlist-menu')) el.classList.add('ymd-playlist-menu');
            const sc = Array.from(el.querySelectorAll('*')).find(d => {
                const o = getComputedStyle(d).overflowY;
                return (o === 'auto' || o === 'scroll') && d.querySelector('button, [role="menuitem"], [role="menuitemcheckbox"], [role="option"], li');
            });
            if (!sc || sc.dataset.ymdFit === '1') return;
            sc.dataset.ymdFit = '1';
            const fill = (n) => {
                n.style.setProperty('max-height', 'none', 'important');
                n.style.setProperty('min-height', '0', 'important');
                n.style.setProperty('flex', '1 1 auto', 'important');
            };
            fill(sc);
            for (let a = sc.parentElement; a && a !== el; a = a.parentElement) {
                fill(a);
                a.style.setProperty('display', 'flex', 'important');
                a.style.setProperty('flex-direction', 'column', 'important');
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

    const _lyricsUrlToTrack = new Map();
    let _lastLyricsTrackId = null;
    const _lrcCache = new Map();
    const _plainCache = new Map();
    const _nativeLyricsCache = new Map();
    const YMD_LRCLIB_HOST = 'https://music-lyric.ymd-lrclib.invalid/';
    const YMD_NO_LYRICS_LRC = '[00:00.00] У данной композиции нет текста песни.';
    const YMD_PLAIN_FALLBACK = true;
    const YMD_LYRICS_LANG_STRICT = true;

    function _cyrShare(text) {
        const s = String(text || '').replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '');
        const cyr = (s.match(/[\u0400-\u04FF]/g) || []).length;
        const lat = (s.match(/[A-Za-z]/g) || []).length;
        return (cyr + lat) ? cyr / (cyr + lat) : 0;
    }

    function _expectCyrillicReason(tr) {
        const hasCyr = (s) => /[\u0400-\u04FF]/.test(String(s || ''));
        const genres = [tr && tr.genre].concat(((tr && tr.albums) || []).map(a => a && a.genre))
            .filter(Boolean).map(String);
        const rus = genres.find(g => /^rus/i.test(g));
        if (rus) return 'жанр ' + rus;
        const artists = ((tr && tr.artists) || []).map(a => a && a.name);
        const album = (tr && tr.albums && tr.albums[0] && tr.albums[0].title) || '';
        if (hasCyr(tr && tr.title) || hasCyr(album) || artists.some(hasCyr)) return 'кириллица в названии/исполнителе';
        return '';
    }

    function _plainToLrc(plain, durSec) {
        const lines = String(plain || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return null;
        const total = durSec > 20 ? durSec : lines.length * 4;
        const start = total * 0.05, span = total * 0.88;
        const fmt = (t) => {
            const m = Math.floor(t / 60), sec = t - m * 60;
            return '[' + String(m).padStart(2, '0') + ':' + sec.toFixed(2).padStart(5, '0') + ']';
        };
        return lines.map((l, i) => fmt(start + span * i / lines.length) + ' ' + l).join('\n');
    }

    const _TR_MAP = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'y',ь:'',э:'e',ю:'u',я:'a',і:'i',ї:'i',є:'e',ґ:'g'};
    function _normKey(s) {
        return String(s || '').toLowerCase()
            .replace(/[\u0400-\u04FF]/g, ch => (ch in _TR_MAP ? _TR_MAP[ch] : ch))
            .replace(/[^a-z0-9]+/g, '');
    }

    function _normTitleKey(t) {
        t = String(t || '')
            .replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ')
            .replace(/\s+[-–—]\s+.*$/, '')
            .replace(/(^|\s)(feat|ft|prod)\.?(\s.*)?$/i, '');
        return _normKey(t);
    }

    function _splitArtists(s) {
        return String(s || '').split(/\s*(?:,|&|;|\/|\bfeat\.?|\bft\.?|\bx\b|\bи\b|\band\b)\s*/i).map(_normKey).filter(Boolean);
    }

    function _sameTrack(rec, tr) {
        if (!rec || !tr) return false;
        const want = _normTitleKey(tr.title);
        const got = _normTitleKey(rec.trackName || rec.name);
        if (!want || want !== got) return false;
        const ours = ((tr.artists || []).map(a => a && a.name).filter(Boolean)).flatMap(_splitArtists);
        const theirs = _splitArtists(rec.artistName);
        if (!ours.length || !theirs.length) return true;
        return ours.some(a => theirs.some(b => a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))));
    }

    function _titleVariants(t) {
        t = String(t || '');
        const out = new Set();
        const add = (x) => { x = String(x || '').replace(/\s+/g, ' ').trim(); if (x) out.add(x); };
        add(t);
        add(_cleanTitle(t));
        add(t.replace(/\s+[-–—]\s+.*$/, ''));
        add(t.replace(/\s+[-–—]\s+(.+)$/, ' ($1)'));
        add(t.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ''));
        return [...out];
    }

    function _pickPlain(list, durSec, tol = 3, accept = null) {
        if (!Array.isArray(list)) return null;
        const ok = list.filter(x => x && x.plainLyrics && !x.instrumental && (!accept || accept(x.plainLyrics)));
        if (!ok.length) return null;
        ok.sort((a, b) => Math.abs((a.duration || 0) - durSec) - Math.abs((b.duration || 0) - durSec));
        const best = ok[0];
        return (!durSec || Math.abs((best.duration || 0) - durSec) <= tol) ? best : null;
    }

    function _isLyricsStub(text) {
        return typeof text === 'string' && text.length < 400 &&
            (/Подключите подписку на Плюс/i.test(text) || /\[59:59\.\d\d\]/.test(text));
    }

    function _isRealLyrics(text) {
        if (typeof text !== 'string' || !text) return false;
        const body = text.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '');
        return /\p{L}/u.test(body) && !_isLyricsStub(text);
    }

    function _cleanTitle(t) {
        return String(t || '')
            .replace(/\s*[\(\[][^)\]]*\b(feat|ft|prod)\b[^)\]]*[\)\]]/gi, '')
            .replace(/\s+/g, ' ').trim();
    }

    let _lrclibErr = null;

    function _lrclibGet(path, params) {
        const qs = Object.entries(params)
            .filter(([, v]) => v !== '' && v != null)
            .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
        return new Promise((resolve) => {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: 'https://lrclib.net/api/' + path + '?' + qs,
                    headers: { 'Accept': 'application/json', 'User-Agent': 'YandexMusicUnlocker/' + GM_info.script.version },
                    timeout: 12000,
                    onload: (r) => {
                        if (r.status === 200) {
                            try { resolve(JSON.parse(r.responseText)); }
                            catch (e) { _lrclibErr = 'ответ lrclib не JSON'; resolve(null); }
                        } else {
                            if (r.status !== 404) _lrclibErr = 'lrclib HTTP ' + r.status;
                            resolve(null);
                        }
                    },
                    onerror: (r) => { _lrclibErr = 'запрос к lrclib не прошёл: ' + ((r && (r.error || r.statusText)) || 'сетевая ошибка / блок @connect'); resolve(null); },
                    ontimeout: () => { _lrclibErr = 'таймаут запроса к lrclib'; resolve(null); }
                });
            } catch (e) {
                _lrclibErr = 'GM_xmlhttpRequest бросил исключение: ' + (e && e.message || e);
                resolve(null);
            }
        });
    }

    function _pickLrclib(list, durSec, tol = 3, accept = null) {
        if (!Array.isArray(list)) return null;
        const ok = list.filter(x => x && x.syncedLyrics && !x.instrumental && (!accept || accept(x.syncedLyrics)));
        if (!ok.length) return null;
        ok.sort((a, b) => Math.abs((a.duration || 0) - durSec) - Math.abs((b.duration || 0) - durSec));
        const best = ok[0];
        return (!durSec || Math.abs((best.duration || 0) - durSec) <= tol) ? best : null;
    }

    function ymdLrclibOn() { return GM_getValue('ymd_lrclib_enabled', true) !== false; }

    const _lrcInflight = new Map();
    const YMD_LRC_BUDGET_MS = 8000;

    function _fetchExternalLrc(trackId) {
        if (!trackId || !ymdLrclibOn()) return Promise.resolve(null);
        trackId = String(trackId);
        if (_lrcCache.has(trackId)) return Promise.resolve(_lrcCache.get(trackId));
        let p = _lrcInflight.get(trackId);
        if (!p) {
            p = _fetchExternalLrcImpl(trackId).finally(() => _lrcInflight.delete(trackId));
            _lrcInflight.set(trackId, p);
        }
        let timer;
        const budget = new Promise(r => { timer = setTimeout(() => r(null), YMD_LRC_BUDGET_MS); });
        return Promise.race([p, budget]).finally(() => clearTimeout(timer));
    }

    async function _fetchExternalLrcImpl(trackId) {
        if (!trackId || !ymdLrclibOn()) return null;
        if (_lrcCache.has(trackId)) return _lrcCache.get(trackId);
        let result = null;
        let plain = null, durForPlain = 0;
        let failed = false;
        _lrclibErr = null;
        try {
            if (!GM_getValue('ymd_oauth_token', null)) {
                const t = await fetchTokenFromPassport();
                if (t) GM_setValue('ymd_oauth_token', t);
            }
            const info = await getTracksInfo([trackId]);
            const arr = Array.isArray(info) ? info : (info && info.result) || [];
            const tr = arr[0];
            if (tr && tr.title) {
                const artists = (tr.artists || []).map(a => a && a.name).filter(Boolean);
                const artist = artists[0] || '';
                const album = (tr.albums && tr.albums[0] && tr.albums[0].title) || '';
                const dur = Math.round((tr.durationMs || 0) / 1000);
                durForPlain = dur;
                const cyrReason = YMD_LYRICS_LANG_STRICT ? _expectCyrillicReason(tr) : '';
                const accept = cyrReason ? ((txt) => _cyrShare(txt) >= 0.3) : null;
                for (const title of _titleVariants(tr.title)) {
                    let rec = await _lrclibGet('get', { track_name: title, artist_name: artists.join(', '), album_name: album, duration: dur || '' });
                    if (!(rec && rec.syncedLyrics) && artists.length > 1) {
                        rec = await _lrclibGet('get', { track_name: title, artist_name: artist, album_name: album, duration: dur || '' });
                    }
                    if (rec && !_sameTrack(rec, tr)) {
                        rec = null;
                    }
                    if (rec && rec.syncedLyrics && accept && !accept(rec.syncedLyrics)) {
                        rec = null;
                    }
                    if (rec && rec.syncedLyrics) { result = rec.syncedLyrics; break; }
                    if (!plain && rec && rec.plainLyrics && !rec.instrumental && (!accept || accept(rec.plainLyrics))) plain = rec.plainLyrics;
                    const rawList = await _lrclibGet('search', { track_name: title, artist_name: artist });
                    const list = Array.isArray(rawList) ? rawList.filter(x => _sameTrack(x, tr)) : rawList;
                    const found = _pickLrclib(list, dur, 3, accept);
                    if (found) { result = found.syncedLyrics; break; }
                    if (!plain) { const pp = _pickPlain(list, dur, 3, accept); if (pp) plain = pp.plainLyrics; }
                }
                if (!result) {
                    const base = String(tr.title).replace(/\s+[-–—]\s+.*$/, '').replace(/\s*[\(\[][^)\]]*[\)\]]/g, '').trim() || tr.title;
                    const queries = [...new Set([
                        artists.join(' ') + ' ' + tr.title,
                        artist + ' ' + tr.title,
                        artist + ' ' + base,
                        tr.title,
                    ].map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
                    for (const q of queries) {
                        const rawList = await _lrclibGet('search', { q });
                        const list = Array.isArray(rawList) ? rawList.filter(x => _sameTrack(x, tr)) : rawList;
                        const found = _pickLrclib(list, dur, 6, accept);
                        if (found) { result = found.syncedLyrics; break; }
                        if (!plain) { const pp = _pickPlain(list, dur, 6, accept); if (pp) plain = pp.plainLyrics; }
                    }
                }
                if (result) result = _normalizeLrc(result) || result;
                if (!result && plain && YMD_PLAIN_FALLBACK) {
                    result = _plainToLrc(plain, durForPlain);
                    _plainCache.set(trackId, plain);
                }
            }
        } catch (e) { failed = true; }
        if (!result && _lrclibErr) failed = true;
        if (result || !failed) _lrcCache.set(trackId, result);
        return result;
    }

    function _normalizeLrc(text) {
        const rows = [];
        let order = 0;
        for (const raw of String(text || '').split(/\r?\n/)) {
            const stamps = [];
            let m;
            const lead = raw.trimStart();
            const leadRe = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;
            let rest = lead;
            while ((m = leadRe.exec(rest))) {
                const frac = m[3] ? Number('0.' + m[3]) : 0;
                stamps.push(Number(m[1]) * 60 + Number(m[2]) + frac);
                rest = rest.slice(m[0].length).trimStart();
            }
            if (!stamps.length) continue;
            const body = rest
                .replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '')
                .replace(/[\u200B-\u200D\uFEFF]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!body) continue;
            for (const t of stamps) rows.push({ t, body, order: order++ });
        }
        if (!rows.length) return null;
        rows.sort((a, b) => a.t - b.t || a.order - b.order);
        let prev = -1;
        for (const r of rows) {
            let t = Math.round(r.t * 100) / 100;
            if (t <= prev) t = Math.round((prev + 0.01) * 100) / 100;
            r.t = t;
            prev = t;
        }
        const fmt = (t) => {
            const mm = Math.floor(t / 60);
            const ss = t - mm * 60;
            return '[' + String(mm).padStart(2, '0') + ':' + ss.toFixed(2).padStart(5, '0') + ']';
        };
        return rows.map(r => fmt(r.t) + ' ' + r.body).join('\n');
    }

    const YMD_TR_DB = 'YandexMusicTranslateDB';
    const YMD_TR_BUDGET_MS = 12000;
    const YMD_TR_LANGS = [['ru', 'Русский'], ['en', 'English'], ['uk', 'Українська'], ['kk', 'Қазақша'], ['uz', 'Oʻzbekcha'], ['tr', 'Türkçe']];

    const ymdTrOn = () => GM_getValue('ymd_tr_enabled', false) === true;
    const ymdTrOnlineOn = () => GM_getValue('ymd_tr_online', false) === true;
    const ymdTrMode = () => (GM_getValue('ymd_tr_mode', 'replace') === 'inline' ? 'inline' : 'replace');
    const ymdTrSkipEnOn = () => GM_getValue('ymd_tr_skip_en', false) === true;
    const ymdTrLang = () => {
        const v = GM_getValue('ymd_tr_lang', 'ru');
        return YMD_TR_LANGS.some(l => l[0] === v) ? v : 'ru';
    };

    let trDb = null, trDbP = null;
    function ymdTrDb() {
        if (trDb) return Promise.resolve(trDb);
        if (trDbP) return trDbP;
        trDbP = new Promise((resolve) => {
            try {
                const rq = indexedDB.open(YMD_TR_DB, 1);
                rq.onupgradeneeded = (e) => {
                    const d = e.target.result;
                    if (!d.objectStoreNames.contains('tr')) d.createObjectStore('tr');
                };
                rq.onsuccess = (e) => {
                    trDb = e.target.result;
                    trDb.onclose = () => { trDb = null; trDbP = null; };
                    resolve(trDb);
                };
                rq.onerror = () => { trDbP = null; resolve(null); };
            } catch (e) { trDbP = null; resolve(null); }
        });
        return trDbP;
    }
    async function ymdTrCacheGet(key) {
        const db = await ymdTrDb();
        if (!db) return null;
        return new Promise((resolve) => {
            try {
                const r = db.transaction(['tr'], 'readonly').objectStore('tr').get(key);
                r.onsuccess = () => resolve(r.result && Array.isArray(r.result.lines) ? r.result.lines : null);
                r.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        });
    }
    async function ymdTrCachePut(key, lines) {
        const db = await ymdTrDb();
        if (!db) return;
        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['tr'], 'readwrite');
                const st = tx.objectStore('tr');
                st.put({ t: Date.now(), lines }, key);
                const all = [];
                const req = st.openCursor();
                req.onsuccess = (e) => {
                    const c = e.target.result;
                    if (c) { all.push([c.key, (c.value && c.value.t) || 0]); c.continue(); return; }
                    const extra = all.length - ymdTrLimit();
                    if (extra > 0) {
                        all.sort((a, b) => a[1] - b[1]);
                        for (let i = 0; i < extra; i++) st.delete(all[i][0]);
                    }
                };
                tx.oncomplete = resolve;
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
        } catch (e) { console.warn('[YMD] кэш переводов:', e); }
    }
    async function ymdTrCacheClear() {
        const db = await ymdTrDb();
        if (!db) return;
        try { db.transaction(['tr'], 'readwrite').objectStore('tr').clear(); } catch (e) {}
    }

    const YMD_TR_EN_WORDS = new Set(`a an the i me my mine myself you your yours yourself he him his she her hers it its we us our ours they them their theirs
        this that these those who whom whose what which where when why how
        am is are was were be been being do does did done doing have has had having will would shall should can could may might must
        not no yes yeah yep nope oh ooh ah aah uh huh hey hi ho woah whoa na la da doo ba ha mm mmm hmm wow
        and or but if so because cause as of at by for from in into on onto off out over under up down with without about around through to too than then there here
        all any some every each more most much many few just only even ever never always still again already now very really
        like love baby girl boy man woman heart night day time life world way back go going gone get got gonna wanna gotta let lets
        know knew think feel felt want need take make made say said tell see look come came give gave
        don't dont can't cant won't wont i'm im i'll i've i'd you're you'll you've you'd he's she's it's that's there's what's let's ain't didn't doesn't isn't wasn't
        til em bout`.split(/\s+/));

    let trDetP = null;
    function ymdTrDetector() {
        const D = win.LanguageDetector;
        if (!D || !D.create) return Promise.resolve(null);
        if (!trDetP) trDetP = D.create().catch(() => { trDetP = null; return null; });
        return trDetP;
    }
    function ymdTrLooksEnglish(line) {
        if (/[^\x00-\x7F\u2018\u2019\u201C\u201D\u2026\u2013\u2014]/.test(line)) return false;
        const w = line.toLowerCase().replace(/[\u2018\u2019]/g, "'").split(/[^a-z']+/).map(x => x.replace(/^'+|'+$/g, '')).filter(Boolean);
        if (!w.length) return false;
        let hit = 0;
        for (const x of w) if (YMD_TR_EN_WORDS.has(x)) hit++;
        return hit / w.length >= 0.34;
    }
    async function ymdTrIsEnglish(line) {
        const det = await ymdTrDetector();
        if (det) {
            try {
                const r = await det.detect(line);
                const top = r && r[0];
                if (top && top.detectedLanguage && top.detectedLanguage !== 'und' && top.confidence >= 0.5) return top.detectedLanguage === 'en';
            } catch (e) {}
        }
        return ymdTrLooksEnglish(line);
    }

    async function ymdTrLocal(lines, target) {
        const T = win.Translator;
        if (!T || !T.create || !T.availability) return null;
        let src = null;
        if (win.LanguageDetector) {
            try {
                const det = await win.LanguageDetector.create();
                const r = await det.detect(lines.join('\n'));
                src = r && r[0] && r[0].detectedLanguage;
            } catch (e) {}
        }
        if (!src || src === 'und') return null;
        if (src === target) return lines.map(() => '');
        if (src === 'en' && ymdTrSkipEnOn()) return lines.map(() => '');
        let av;
        try { av = await T.availability({ sourceLanguage: src, targetLanguage: target }); } catch (e) { return null; }
        if (av === 'unavailable') return null;
        if (av !== 'available' && !(navigator.userActivation && navigator.userActivation.isActive)) return null;
        let tr;
        try { tr = await T.create({ sourceLanguage: src, targetLanguage: target }); } catch (e) { return null; }
        const out = [];
        for (const l of lines) {
            try { out.push(await tr.translate(l)); } catch (e) { out.push(''); }
        }
        try { tr.destroy && tr.destroy(); } catch (e) {}
        return out;
    }

    function ymdTrGoogle(text, target) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' +
                     encodeURIComponent(target) + '&q=' + encodeURIComponent(text),
                timeout: 10000,
                onload: (r) => {
                    try {
                        if (r.status !== 200) return resolve(null);
                        const d = JSON.parse(r.responseText);
                        resolve((d[0] || []).map(x => x[0] || '').join(''));
                    } catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null),
            });
        });
    }
    async function ymdTrOnline(lines, target) {
        const out = new Array(lines.length).fill('');
        const chunks = [];
        let cur = [], len = 0;
        lines.forEach((l, i) => {
            const n = encodeURIComponent(l).length + 3;
            if (cur.length && len + n > 1500) { chunks.push(cur); cur = []; len = 0; }
            cur.push(i); len += n;
        });
        if (cur.length) chunks.push(cur);

        let failedAll = true;
        for (const idxs of chunks) {
            const res = await ymdTrGoogle(idxs.map(i => lines[i]).join('\n'), target);
            const parts = res == null ? null : res.split('\n');
            if (parts && parts.length === idxs.length) {
                idxs.forEach((i, k) => { out[i] = parts[k].trim(); });
                failedAll = false;
                continue;
            }
            let p = 0;
            const worker = async () => {
                while (p < idxs.length) {
                    const i = idxs[p++];
                    const r = await ymdTrGoogle(lines[i], target);
                    if (r != null) { out[i] = r.replace(/\s*\n\s*/g, ' ').trim(); failedAll = false; }
                }
            };
            await Promise.all([worker(), worker(), worker()]);
        }
        return failedAll ? null : out;
    }

    const ymdTrNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

    async function ymdTrTranslateLines(lines, target) {
        let need = [...new Set(lines)].filter(l => /\p{L}/u.test(l) && !(target === 'ru' && _cyrShare(l) >= 0.5));
        if (need.length && ymdTrSkipEnOn()) {
            const en = await Promise.all(need.map(ymdTrIsEnglish));
            need = need.filter((l, i) => !en[i]);
        }
        if (!need.length) return lines.map(() => '');
        let out = await ymdTrLocal(need, target);
        if (!out && ymdTrOnlineOn()) out = await ymdTrOnline(need, target);
        if (!out) return null;
        const map = new Map(need.map((l, i) => [l, out[i] || '']));
        return lines.map((l) => {
            const t = map.get(l) || '';
            return ymdTrNorm(t) === ymdTrNorm(l) ? '' : t;
        });
    }

    function ymdTrFmt(t) {
        const m = Math.floor(t / 60), s = t - m * 60;
        return '[' + String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0') + ']';
    }
    function ymdTrParse(lrc) {
        return String(lrc).split(/\r?\n/).map((raw) => {
            const m = /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/.exec(raw);
            if (!m) return { raw };
            return { raw, t: Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0), body: m[4].trim() };
        });
    }
    function ymdTrCompose(rows, tr, mode) {
        let i = 0;
        const out = [];
        for (const r of rows) {
            if (r.t === undefined) { if (r.raw.trim()) out.push(r.raw); continue; }
            if (!r.body) { out.push(r.raw); continue; }
            const x = tr[i++];
            if (!x) { out.push(ymdTrFmt(r.t) + ' ' + r.body); continue; }
            out.push(ymdTrFmt(r.t) + ' ' + (mode === 'inline' ? r.body + ' / ' + x : x));
        }
        return out.join('\n');
    }

    const trInflight = new Map();

    async function ymdTrBuild(lrc, key, target) {
        const rows = ymdTrParse(lrc);
        const texts = rows.filter(r => r.t !== undefined && r.body).map(r => r.body);
        if (!texts.length) return lrc;
        let tr = await ymdTrCacheGet(key);
        if (!tr || tr.length !== texts.length) {
            tr = await ymdTrTranslateLines(texts, target);
            if (!tr) return lrc;
            ymdTrCachePut(key, tr);
        }
        return ymdTrCompose(rows, tr, ymdTrMode());
    }

    async function ymdTrApply(lrc, trackId) {
        if (!ymdTrOn() || !trackId || !lrc || lrc === YMD_NO_LYRICS_LRC) return lrc;
        const target = ymdTrLang();
        const key = String(trackId) + ':' + target + (ymdTrSkipEnOn() ? ':noen' : '');
        let p = trInflight.get(key);
        if (!p) {
            p = ymdTrBuild(lrc, key, target).finally(() => trInflight.delete(key));
            trInflight.set(key, p);
        }
        let timer;
        const budget = new Promise((r) => { timer = setTimeout(() => r(lrc), YMD_TR_BUDGET_MS); });
        try { return await Promise.race([p, budget]); }
        catch (e) { console.warn('[YMD] перевод текста:', e); return lrc; }
        finally { clearTimeout(timer); }
    }


    const _nativeFetch = win.fetch.bind(win);

    const ymdFetchInner = async function (...args) {
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
            const um = url.match(URL_TOKEN_RE);
            if (um) saveInterceptedToken(um[1]);
        } catch (e) {}

        if (url.includes('log.strm.yandex.ru') || url.includes('dynamic-pages/trigger/polling')) {
            return new win.Response('{}', { status: 200 });
        }

        if (/\/(get-)?file-info/.test(url)) {
            const isV2 = url.includes('/resources/v2/');
            const isBatch = url.includes('/file-info/batch');
            const params  = new URLSearchParams(url.split('?')[1] || '');
            const trackIdRaw = params.get('trackId') || (params.get('trackIds') || '').split(',')[0];
            const trackId = trackIdRaw ? String(trackIdRaw).split(':')[0] : trackIdRaw;
            const quality = params.get('quality') || 'nq';

            if (isBatch) return _nativeFetch(...args);
            if (FCK.enabled && FCK.ready && trackId && FCK.audio.has(String(trackId))) {
                const fa = await fckGetAudio(String(trackId));
                if (fa) {
                    const di = fckBuildDownloadInfo(trackId, quality, fa);
                    return new win.Response(
                        JSON.stringify(isV2 ? di : { downloadInfo: di }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    );
                }
            }

            const res  = await _nativeFetch(...args);
            if (isV2) {
                return res;
            }
            const data = await res.clone().json().catch(() => null);
            if (!data) return res;

            const info         = data?.downloadInfo;
            const needsReplace = !info ||
                                 String(info.trackId) !== String(trackId) ||
                                 info.quality === 'preview';

            if (trackId && needsReplace) {
                const full = await _getFullTrackInfo(trackId, quality === 'preview' ? 'hq' : quality);
                if (full) {
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

        if (/\/tracks\/\d+\/lyrics\?/.test(url)) {
            const m = url.match(/\/tracks\/(\d+)\/lyrics/);
            const trackId = m && m[1];
            if (trackId) _lastLyricsTrackId = trackId;

            let res = null, data = null;
            try {
                res = await _nativeFetch(...args);
                data = await res.clone().json().catch(() => null);
            } catch (e) {}

            const wrapped = !!(data && data.result && typeof data.result === 'object');
            const root = data && (wrapped ? data.result : data);
            if (root && root.downloadUrl) {
                if (trackId) _lyricsUrlToTrack.set(root.downloadUrl, trackId);
                return res;
            }

            if (trackId && ymdLrclibOn()) {
                _fetchExternalLrc(trackId);
                const fake = {
                    downloadUrl: YMD_LRCLIB_HOST + trackId,
                    lyricId: Number(trackId),
                    externalLyricId: String(trackId),
                    writers: [],
                    major: { id: 0, name: 'LRCLIB', prettyName: 'LRCLIB' }
                };
                return new win.Response(JSON.stringify(wrapped ? { ...data, result: { ...root, ...fake } } : fake), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            return res || _nativeFetch(...args);
        }

        if (url.startsWith(YMD_LRCLIB_HOST)) {
            const id = url.slice(YMD_LRCLIB_HOST.length).split(/[?#]/)[0];
            const lrc0 = await _fetchExternalLrc(id);
            const lrc = lrc0 ? await ymdTrApply(lrc0, id) : lrc0;
            return new win.Response(lrc || YMD_NO_LYRICS_LRC, {
                status: 200,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        if (url.includes('music-lyric.')) {
            let res = null, text = '';
            try {
                res = await _nativeFetch(...args);
                text = res.ok ? await res.clone().text() : '';
            } catch (e) {}
            if (!res || !res.ok || !_isRealLyrics(text)) {
                if (!ymdLrclibOn()) return res || _nativeFetch(...args);
                const fbId = _lyricsUrlToTrack.get(url) || _lastLyricsTrackId;
                const lrc0 = await _fetchExternalLrc(fbId);
                const lrc = lrc0 ? await ymdTrApply(lrc0, fbId) : lrc0;
                return new win.Response(lrc || YMD_NO_LYRICS_LRC, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
            const nativeTid = _lyricsUrlToTrack.get(url);
            if (nativeTid) _nativeLyricsCache.set(String(nativeTid), text);
            if (ymdTrOn()) {
                const out = await ymdTrApply(text, nativeTid || _lastLyricsTrackId);
                if (out !== text) return new win.Response(out, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
            return res;
        }

        if (url.includes('yandex')) {
            const response = await _nativeFetch(...args);
            if (response.status === 206 || /strm\.yandex\.net|\/music-v2\/crypt\//i.test(url)) return response;
            const ymdCt = (response.headers && response.headers.get('content-type')) || '';
            if (/^(audio|video|image|font)\//i.test(ymdCt) || /octet-stream|mp4|mpeg|flac|ogg|webm/i.test(ymdCt) || /\.(mp3|m4a|mp4|flac|ts|m4s|webm|ogg)(\?|$)/i.test(url)) return response;
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
                if (fckTextHasKnownId(modified) && /^\s*[\[{]/.test(modified)) {
                    try {
                        const fobj = _origParse(modified);
                        if (fckSpoofObject(fobj) > 0) modified = JSON.stringify(fobj);
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

    win.fetch = async function (...args) {
        let ymdUrl = '';
        try {
            const r0 = args[0];
            ymdUrl = typeof r0 === 'string' ? r0 : (r0 && r0.url) || '';
        } catch (e) {}
        try {
            return await ymdFetchInner.apply(this, args);
        } catch (e) {
            console.warn('[YMD] fetch hook error, native fetch used:', ymdUrl.slice(0, 160), e);
            return _nativeFetch(...args);
        }
    };

    function startObserver() {
        if (document.body) {
            if (!document.getElementById('ymd-panel')) document.body.appendChild(panel);
            inject();
            try { ymdKarInject(); ymdKarSync(); } catch (e) { console.warn('[YMD] karaoke init', e); }
            let injectTimer = null;
            const obs = new MutationObserver(() => {
                clearTimeout(injectTimer);
                injectTimer = setTimeout(() => { inject(); try { ymdKarInject(); } catch (e) {} ymdAsPlaceLabel(); ymdPlPlaceLabel(); }, 150);
            });
            obs.observe(document.body, { childList: true, subtree: true });
            ymdEnsureToken();
        } else {
            document.addEventListener('DOMContentLoaded', startObserver, { once: true });
        }
    }
    const ymdTabBooted = YMD_TAB_MODE && ymdTabBoot();
    if (!ymdTabBooted) {
        ymdTabSync();
        startObserver();
        ymdUpdateOnStartup();
    }

})();
