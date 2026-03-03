const urlInput = document.getElementById('urlInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const scoreEl = document.getElementById('score');
const scoreTextEl = document.getElementById('scoreText');

const CHECKS = [
  { key: 'morePages', weight: 10, type: 'automatic', title: 'El sitio tiene más páginas que el index', desc: 'Busca enlaces internos y sitemap para confirmar que no es una única página.' },
  { key: 'searchPresence', weight: 4, type: 'manual', title: 'La web está en más buscadores', desc: 'No puede verificarse de forma fiable sin consultar buscadores externos. Se deja enlace rápido de revisión manual.' },
  { key: 'googleAnalytics', weight: 8, type: 'heuristic', title: 'Aparece Google Analytics', desc: 'Detecta scripts o llamadas típicas de GA / gtag / GTM.' },
  { key: 'robots', weight: 8, type: 'automatic', title: 'Existe robots.txt', desc: 'Comprueba si responde /robots.txt y revisa su contenido básico.' },
  { key: 'githubRoot', weight: 3, type: 'manual', title: 'La web está en la raíz del repositorio de GitHub', desc: 'No se puede comprobar con fiabilidad desde la web publicada. Revisión manual.' },
  { key: 'sitemap', weight: 8, type: 'automatic', title: 'Existe sitemap.xml', desc: 'Comprueba si responde /sitemap.xml y cuántas URL contiene.' },
  { key: 'errorHandling', weight: 8, type: 'heuristic', title: 'No hay páginas de error rotas', desc: 'Prueba una URL inexistente para ver si devuelve una 404/redirect controlada.' },
  { key: 'browsers', weight: 3, type: 'manual', title: 'Probada en más navegadores', desc: 'Esto no puede auditarse automáticamente desde una sola extensión.' },
  { key: 'links', weight: 8, type: 'heuristic', title: 'Tiene enlaces de ida y de vuelta', desc: 'Cuenta enlaces internos y salientes en la home como pista de enlazado.' },
  { key: 'trends', weight: 3, type: 'manual', title: 'Noticias / Google Trends', desc: 'Se facilita una ruta manual para revisar qué busca la gente.' },
  { key: 'sitemapIndexed', weight: 4, type: 'manual', title: 'Las URL del sitemap aparecen en Google', desc: 'Requiere consulta externa a Google; la extensión lo marca como revisión manual.' },
  { key: 'ads', weight: 5, type: 'heuristic', title: 'Anuncios detectados', desc: 'Busca scripts/redes publicitarias habituales como señal orientativa.' },
  { key: 'accessibility', weight: 12, type: 'heuristic', title: 'Accesibilidad básica', desc: 'Comprueba lang, title, alt en imágenes y labels en formularios.' },
  { key: 'social', weight: 6, type: 'heuristic', title: 'Redes sociales (LinkedIn)', desc: 'Busca enlaces a LinkedIn y metadatos sociales básicos.' },
  { key: 'bing', weight: 8, type: 'heuristic', title: 'Tiene Bing Webmaster Tools', desc: 'Busca meta de verificación de Bing: msvalidate.01.' }
];

analyzeBtn.addEventListener('click', analyze);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyze();
});

function setStatus(text) {
  statusEl.textContent = text;
}

function normalizeUrl(value) {
  let text = value.trim();
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  return new URL(text).toString();
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  const text = await res.text();
  return { res, text };
}

function toDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

function pick(base, path) {
  return new URL(path, base).toString();
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function isProbablyGoogleAnalytics(html) {
  return /(googletagmanager\.com|google-analytics\.com|gtag\(|ga\(|G-[A-Z0-9]+)/i.test(html);
}

function detectAds(html) {
  return /(googlesyndication\.com|doubleclick\.net|adsbygoogle|adservice\.google)/i.test(html);
}

async function analyze() {
  resultsEl.innerHTML = '';
  scoreEl.textContent = '...';
  scoreTextEl.textContent = 'Analizando';
  let baseUrl;

  try {
    baseUrl = normalizeUrl(urlInput.value);
  } catch {
    setStatus('La URL no es válida.');
    return;
  }

  setStatus('Analizando sitio, robots, sitemap y señales de la home...');

  try {
    const homepage = await fetchText(baseUrl);
    const doc = toDoc(homepage.text);
    const base = new URL(baseUrl);

    const anchors = [...doc.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    const resolved = unique(anchors.map(h => {
      try { return new URL(h, base).toString(); } catch { return null; }
    }));
    const internalLinks = resolved.filter(u => new URL(u).hostname === base.hostname);
    const externalLinks = resolved.filter(u => new URL(u).hostname !== base.hostname);

    const scriptSrcs = [...doc.querySelectorAll('script[src]')].map(s => s.src).join('\n');
    const imgs = [...doc.images];
    const imgsWithoutAlt = imgs.filter(i => !i.hasAttribute('alt')).length;
    const forms = [...doc.forms];
    const inputs = forms.flatMap(f => [...f.querySelectorAll('input, select, textarea')]);
    const labels = [...doc.querySelectorAll('label[for]')];
    const linkedInFound = /linkedin\.com/i.test(homepage.text) || resolved.some(u => /linkedin\.com/i.test(u));
    const bingVerification = !!doc.querySelector('meta[name="msvalidate.01"]');

    let robotsInfo = { exists: false, ok: false, note: 'No encontrado' };
    try {
      const robots = await fetchText(pick(base, '/robots.txt'));
      robotsInfo.exists = robots.res.ok;
      robotsInfo.ok = robots.res.ok;
      robotsInfo.note = robots.res.ok ? `HTTP ${robots.res.status}. ${robots.text.slice(0, 120).replace(/\s+/g, ' ')}` : `HTTP ${robots.res.status}`;
    } catch {
      robotsInfo.note = 'No se pudo leer robots.txt, o esta mal escrito o no esta';
    }

    let sitemapInfo = { exists: false, count: 0, note: 'No encontrado' };
    try {
      const sitemap = await fetchText(pick(base, '/sitemap.xml'));
      sitemapInfo.exists = sitemap.res.ok;
      if (sitemap.res.ok) {
        const count = (sitemap.text.match(/<loc>/gi) || []).length;
        sitemapInfo.count = count;
        sitemapInfo.note = `HTTP ${sitemap.res.status}. URLs detectadas: ${count}`;
      } else {
        sitemapInfo.note = `HTTP ${sitemap.res.status}`;
      }
    } catch {
      sitemapInfo.note = 'No se pudo leer sitemap.xml, revisa que este bien escrito o con buen nombre';
    }

    let errorInfo = { controlled: false, note: 'No comprobado' };
    try {
      const fakeUrl = pick(base, `/chatgpt-audit-${Date.now()}-missing-page`);
      const res = await fetch(fakeUrl, { redirect: 'follow', cache: 'no-store' });
      errorInfo.controlled = res.status === 404 || res.redirected;
      errorInfo.note = `HTTP ${res.status}${res.redirected ? ' con redirección' : ''}`;
    } catch {
      errorInfo.note = 'No se pudo probar la URL inexistente, no te digo que tenga errores pero tampoco que no';
    }

    const hasMultiplePages = internalLinks.filter(u => {
      try {
        const p = new URL(u).pathname;
        return p && p !== '/' && p !== '/index.html';
      } catch { return false; }
    }).length > 0 || sitemapInfo.count > 1;

    const accessibilityOk = !!doc.documentElement.getAttribute('lang')
      && !!doc.querySelector('title')
      && (imgs.length === 0 || imgsWithoutAlt === 0)
      && (forms.length === 0 || labels.length > 0);

    const payload = {
      morePages: {
        status: hasMultiplePages ? 'ok' : 'bad',
        detail: `Enlaces internos: ${internalLinks.length}. Sitemap URLs: ${sitemapInfo.count}.`
      },
      searchPresence: {
        status: 'manual',
        detail: `Revisar manualmente: site:${base.hostname} en Google y Bing.`
      },
      googleAnalytics: {
        status: isProbablyGoogleAnalytics(homepage.text + '\n' + scriptSrcs) ? 'ok' : 'warn',
        detail: isProbablyGoogleAnalytics(homepage.text + '\n' + scriptSrcs) ? 'Se han detectado patrones de GA/GTM.' : 'No se han visto señales claras de GA.'
      },
      robots: {
        status: robotsInfo.exists ? 'ok' : 'bad',
        detail: robotsInfo.note
      },
      githubRoot: {
        status: 'manual',
        detail: 'Solo puede verificarse viendo el repositorio fuente.'
      },
      sitemap: {
        status: sitemapInfo.exists ? 'ok' : 'bad',
        detail: sitemapInfo.note
      },
      errorHandling: {
        status: errorInfo.controlled ? 'ok' : 'warn',
        detail: errorInfo.note
      },
      browsers: {
        status: 'manual',
        detail: 'Necesita prueba real en Safari, Firefox, Edge, etc.'
      },
      links: {
        status: (internalLinks.length > 1 && externalLinks.length > 0) ? 'ok' : 'warn',
        detail: `Internos: ${internalLinks.length}. Externos: ${externalLinks.length}.`
      },
      trends: {
        status: 'manual',
        detail: `Revisión sugerida en Google Trends para la temática del sitio.`
      },
      sitemapIndexed: {
        status: 'manual',
        detail: 'Comparar manualmente sitemap con resultados de Google.'
      },
      ads: {
        status: detectAds(homepage.text + '\n' + scriptSrcs) ? 'ok' : 'warn',
        detail: detectAds(homepage.text + '\n' + scriptSrcs) ? 'Se han detectado scripts de anuncios.' : 'No se han detectado señales típicas de anuncios.'
      },
      accessibility: {
        status: accessibilityOk ? 'ok' : 'warn',
        detail: `lang: ${!!doc.documentElement.getAttribute('lang')} · title: ${!!doc.querySelector('title')} · imágenes sin alt: ${imgsWithoutAlt} · formularios: ${forms.length}.`
      },
      social: {
        status: linkedInFound ? 'ok' : 'warn',
        detail: linkedInFound ? 'Se ha detectado LinkedIn.' : 'No se ha visto LinkedIn en la home.'
      },
      bing: {
        status: bingVerification ? 'ok' : 'warn',
        detail: bingVerification ? 'Meta msvalidate.01 detectada.' : 'No se ha detectado meta de Bing Webmaster Tools.'
      }
    };

    //Si lees esto me robo tu suerte para mi examen teorico de mañana

    renderResults(payload, base.hostname);
    setStatus(`Análisis completado para ${base.hostname}.`);
  } catch (err) {
    console.error(err);
    setStatus('No se ha podido analizar la URL. Algunas webs bloquean estas comprobaciones.');
    scoreEl.textContent = '0';
    scoreTextEl.textContent = 'Error';
    resultsEl.innerHTML = `<div class="item"><div class="item-head"><h3>Error</h3><span class="pill bad">Fallo</span></div><p>No se pudo leer la web indicada. Prueba con otra URL pública o con HTTPS.</p><div class="meta">${escapeHtml(String(err.message || err))}</div></div>`;
  }
}

function renderResults(payload, host) {
  resultsEl.innerHTML = '';
  let score = 0;
  let maxScore = 0;

  for (const check of CHECKS) {
    const data = payload[check.key] || { status: 'manual', detail: 'Sin datos' };
    maxScore += check.weight;
    if (data.status === 'ok') score += check.weight;
    else if (data.status === 'warn') score += Math.round(check.weight * 0.45);
    else if (data.status === 'manual') score += Math.round(check.weight * 0.25);

    const item = document.createElement('div');
    item.className = 'item';
    const modeBadgeClass = check.type === 'automatic' ? 'ok' : check.type === 'heuristic' ? 'warn' : 'manual';
    const statusLabel = data.status === 'ok' ? 'Cumple' : data.status === 'bad' ? 'No cumple' : data.status === 'warn' ? 'Revisar' : 'Manual';
    const manualExtra = buildManualExtra(check.key, host);

    item.innerHTML = `
      <div class="item-head">
        <div>
          <h3>${escapeHtml(check.title)}</h3>
          <p>${escapeHtml(check.desc)}</p>
        </div>
        <div>
          <span class="pill ${data.status === 'ok' ? 'ok' : data.status === 'bad' ? 'bad' : data.status === 'warn' ? 'warn' : 'manual'}">${statusLabel}</span>
        </div>
      </div>
      <div class="meta">
        <strong>Tipo:</strong> <span class="badge ${modeBadgeClass}">${check.type === 'automatic' ? 'Automático' : check.type === 'heuristic' ? 'Heurístico' : 'Manual'}</span><br>
        <strong>Resultado:</strong> ${escapeHtml(data.detail)}
        ${manualExtra ? `<br><strong>Acceso rápido:</strong> ${manualExtra}` : ''}
      </div>
    `;
    resultsEl.appendChild(item);
  }

  const normalized = Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));
  scoreEl.textContent = String(normalized);
  scoreTextEl.textContent = normalized >= 80 ? 'Muy bien' : normalized >= 60 ? 'Aceptable' : 'A mejorar';
}

function buildManualExtra(key, host) {
  if (key === 'searchPresence' || key === 'sitemapIndexed') {
    const q = encodeURIComponent(`site:${host}`);
    return `<a class="small-link" href="https://www.google.com/search?q=${q}" target="_blank">Google</a> · <a class="small-link" href="https://www.bing.com/search?q=${q}" target="_blank">Bing</a>`;
  }
  if (key === 'trends') {
    return `<a class="small-link" href="https://trends.google.com/trends/" target="_blank">Abrir Google Trends</a>`;
  }
  if (key === 'githubRoot') {
    return 'Revisar el repositorio fuente manualmente.';
  }
  return '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
