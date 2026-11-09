/* KardShot — gestion centralisée des langues.
   Déposer dans /langues/i18n.js avec fr.json et en.json.
   Utilisation : await KardShotI18n.init(); KardShotI18n.t('menu.play');
   Écouter l'événement 'kardshot:languagechange' pour actualiser l'interface.
*/
(function (root) {
  'use strict';
  const BASE = new URL('./', document.currentScript?.src || new URL('langues/', location.href));
  const STORAGE_KEY = 'kardshot.language';
  const DEFAULT_LANGUAGE = 'fr';
  const SUPPORTED = ['fr', 'en'];
  const dictionaries = Object.create(null);
  let current = DEFAULT_LANGUAGE;

  function normalized(code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  }
  function savedLanguage() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
  }
  function saveLanguage(code) {
    try { localStorage.setItem(STORAGE_KEY, code); } catch (_) { /* storage unavailable */ }
  }
  function lookup(obj, key) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    return String(key).split('.').reduce((value, part) => value && value[part], obj);
  }
  async function load(code) {
    if (dictionaries[code]) return dictionaries[code];
    const url = new URL(code + '.json', BASE);
    const response = await fetch(url);
    if (!response.ok) throw new Error('KardShot: impossible de charger ' + url.pathname);
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Dictionnaire invalide: ' + code);
    dictionaries[code] = data;
    return data;
  }
  async function setLanguage(code) {
    const requested = normalized(code);
    const target = SUPPORTED.includes(requested) ? requested : DEFAULT_LANGUAGE;
    await load(DEFAULT_LANGUAGE);
    if (target !== DEFAULT_LANGUAGE) await load(target);
    current = target;
    saveLanguage(target);
    document.documentElement.lang = target;
    document.dispatchEvent(new CustomEvent('kardshot:languagechange', { detail: { language: target } }));
    return target;
  }
  async function init() {
    const preferred = savedLanguage() || navigator.language || DEFAULT_LANGUAGE;
    try { return await setLanguage(preferred); }
    catch (error) {
      if (normalized(preferred) !== DEFAULT_LANGUAGE) return setLanguage(DEFAULT_LANGUAGE);
      throw error;
    }
  }
  function t(key, params) {
    let value = lookup(dictionaries[current], key);
    if (typeof value !== 'string') value = lookup(dictionaries[DEFAULT_LANGUAGE], key);
    if (typeof value !== 'string') return String(key);
    return value.replace(/\{(\w+)\}/g, (_, name) => params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : '{' + name + '}');
  }
  root.KardShotI18n = Object.freeze({ init, setLanguage, t, getLanguage: () => current, supportedLanguages: SUPPORTED.slice() });
})(window);
