/**
 * HTML-каркас карты и адрес-источник для встроенного браузера.
 *
 * Вынесено из MapScreen не для красоты: файл с картой вырос, а держать
 * разметку страницы рядом с логикой экрана незачем — здесь только HTML,
 * CSS и скрипт Leaflet.
 */

/** HTML-каркас карты. Данные приходят отдельно — через window.__setRoute. */
export const MAP_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; background: #0a0a0a; }
  .pin { display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 15px; margin: 4px;
    background: #1f2937; color: #e5e7eb; border: 2px solid #6b7280;
    font: 600 14px system-ui, -apple-system, sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,.6); }
  .pin.current { width: 38px; height: 38px; border-radius: 19px; margin: 0;
    background: #f59e0b; color: #111827; border-color: #fbbf24; font-size: 18px; }
  .pin.done { background: #14532d; color: #86efac; border-color: #22c55e; opacity: .85; }
  .mec { position: relative; width: 44px; height: 44px; }
  .halo { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto;
    width: 40px; height: 40px; border-radius: 20px; background: rgba(59,130,246,.22); }
  .dot { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto;
    width: 16px; height: 16px; border-radius: 8px; background: #3b82f6;
    border: 3px solid #dbeafe; box-sizing: border-box; }
  .car { position: absolute; top: 0; left: 0; right: 0; bottom: 0; margin: auto;
    width: 34px; height: 34px; display: none; transform-origin: 50% 50%; }
  .car svg { display: block; }
  .mec.ride .dot { display: none; }
  .mec.ride .halo { background: rgba(59,130,246,.14); }
  .mec.ride .car { display: block; }
  .man { position: absolute; left: 10px; right: 10px; top: 10px; z-index: 900;
    display: none; align-items: center; gap: 12px; padding: 10px 14px;
    border-radius: 14px; background: rgba(17,24,39,.94);
    border: 1px solid rgba(96,165,250,.45); box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .man.show { display: flex; }
  .manArrow { flex: none; width: 52px; height: 52px; border-radius: 26px;
    background: #2563eb; color: #fff; display: flex; align-items: center;
    justify-content: center; font: 700 30px system-ui, -apple-system, sans-serif; }
  .manBody { flex: 1; min-width: 0; }
  .manDist { color: #f8fafc; font: 700 26px system-ui, -apple-system, sans-serif; }
  .manAct { color: #e2e8f0; font: 15px system-ui, -apple-system, sans-serif;
    margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .manNext { color: #93c5fd; font: 13.5px system-ui, -apple-system, sans-serif;
    margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Низ панели приподнят: подпись «© OpenStreetMap» по правилам сервиса
     должна оставаться видимой и не перекрываться нашей панелью. */
  .hud { position: absolute; left: 10px; right: 10px; bottom: 26px; z-index: 900;
    display: none; padding: 10px 12px; border-radius: 14px;
    background: rgba(17,24,39,.94); border: 1px solid rgba(96,165,250,.35);
    box-shadow: 0 4px 14px rgba(0,0,0,.5); font: 13px system-ui, -apple-system, sans-serif; }
  .hud.show { display: block; }
  .hudRow { display: flex; align-items: center; gap: 8px; }
  .hudRow + .hudRow { margin-top: 6px; }
  .hudAddr { color: #f8fafc; font-weight: 600; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; flex: 1; }
  /* Значок голоса: сама кнопка — в разделе «Маршрут», а в поездке
     важно видеть одним взглядом, говорят подсказки или молчат. */
  .hudVoice { flex: none; color: #93c5fd; font-size: 14px; }
  .hudMeta { color: #cbd5e1; font-size: 12px; }
  .hudTotal { color: #93c5fd; font-size: 12.5px; margin-top: 6px; }
  .hudHome { margin-top: 8px; text-align: center; padding: 9px 6px; border-radius: 10px;
    background: #1e293b; color: #bfdbfe; font-weight: 600; font-size: 12.5px;
    border: 1px solid #1d4ed8; }
  .hudButtons { display: flex; gap: 8px; margin-top: 8px; }
  .hudBtn { flex: 1; text-align: center; padding: 9px 6px; border-radius: 10px;
    background: #1f2937; color: #e5e7eb; font-weight: 600; font-size: 12.5px;
    border: 1px solid #374151; }
  .hudBtn.done { background: #16a34a; border-color: #22c55e; color: #f0fdf4; }
  .hudBtn.call { background: #14532d; border-color: #22c55e; color: #86efac; }
  .hudBtn.sms { background: #1e293b; border-color: #3b82f6; color: #93c5fd; }
  #boot { position: absolute; left: 0; right: 0; top: 0; bottom: 0; z-index: 999;
    display: flex; align-items: center; justify-content: center; padding: 24px;
    color: #9ca3af; font: 14px system-ui, -apple-system, sans-serif; text-align: center; }
  .leaflet-control-attribution { background: rgba(10,10,10,.75) !important;
    color: #9ca3af !important; font-size: 10px !important; }
  .leaflet-control-attribution a { color: #9ca3af !important; }
  .leaflet-popup-content { font: 13px system-ui, -apple-system, sans-serif; }
</style>
</head>
<body>
<div id="map"></div>
<div id="man" class="man">
  <div class="manArrow" id="manArrow"></div>
  <div class="manBody">
    <div class="manDist" id="manDist"></div>
    <div class="manAct" id="manAct"></div>
    <div class="manNext" id="manNext"></div>
  </div>
</div>
<div id="hud" class="hud">
  <div class="hudRow">
    <div class="hudAddr" id="hudAddr"></div>
    <div class="hudVoice" id="hudVoice"></div>
  </div>
  <div class="hudRow">
    <div class="hudMeta" id="hudMeta"></div>
  </div>
  <div class="hudTotal" id="hudTotal"></div>
  <div class="hudHome" id="hudHome">🏠 Домой — в Навигатор</div>
  <div class="hudButtons">
    <div class="hudBtn call" id="hudCall">Позвонить</div>
    <div class="hudBtn sms" id="hudSms">Напишу клиенту</div>
  </div>
  <div class="hudButtons">
    <div class="hudBtn done" id="hudDone">Выполнено</div>
    <div class="hudBtn" id="hudMiss">Клиента нет</div>
  </div>
</div>
<div id="boot">Загружаю карту\u2026</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function () {
  var map = null, layer = null, meMarker = null, dirLine = null;
  var DATA = { points: [], route: [], focus: null };
  // ME — где мы сейчас; RIDE — идёт поездка (карта следит за машиной).
  var ME = null, RIDE = false;
  // HEAD — куда смотрит машина (градусы, 0 — на север). FOLLOW — карта ведёт
  // машину сама, как в навигаторе; увёл руками — отстаём до кнопки «прицел».
  var HEAD = 0, FOLLOW = false;
  // PATH — линия с накопленными метрами до каждой её точки. По ней считаем
  // «через 300 м направо», не спрашивая сервер на каждый метр пути.
  var PATH = null, MAN = [], CUR_IDX = -1, lastIdx = -1, lastFix = null;
  var passedLine = null, aheadLine = null, manKey = '', hudKey = '';
  // HUD — нижняя панель поездки: клиент, звонок, «выполнено». Её кнопки
  // отправляют приложению команду, а оно уже делает дело (звонок, SMS,
  // закрытие заявки) — так руки водителя не ищут кнопки на экране телефона.
  var HUD = { address: '', meta: '', total: '', phone: '', sms: '', home: false, voice: true };
  // NAV_STEPS — на каких метрах до поворота говорим голосом. Дважды заранее
  // и один раз перед самим поворотом: чаще — уже болтовня за рулём.
  var NAV_STEPS = [1500, 700, 300];
  var navKey = '';
  var CAR_SVG = '<svg width="34" height="34" viewBox="0 0 34 34">' +
    '<circle cx="17" cy="17" r="16" fill="#2563eb" stroke="#dbeafe" stroke-width="2"/>' +
    '<path d="M17 6 L26 26 L17 21 L8 26 Z" fill="#ffffff"/></svg>';
  var CAR_HTML = '<div class="mec"><div class="halo"></div><div class="dot"></div>' +
    '<div class="car">' + CAR_SVG + '</div></div>';

  function pinIcon(point) {
    var cls = point.state === 'done' ? 'pin done'
            : (point.state === 'current' ? 'pin current' : 'pin');
    return L.divIcon({
      html: '<div class="' + cls + '">' + point.number + '</div>',
      className: '', iconSize: [38, 38], iconAnchor: [19, 19]
    });
  }

  /** Точка, к которой сейчас едем: помеченная current в приложении. */
  function currentPoint() {
    for (var i = 0; i < DATA.points.length; i++) {
      if (DATA.points[i].state === 'current') return DATA.points[i];
    }
    return DATA.points.length ? DATA.points[0] : null;
  }

  /** Расстояние по прямой между двумя точками, в метрах. */
  function meters(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var la1 = a[0] * rad, la2 = b[0] * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Куда мы едем по компасу: курс между двумя точками, в градусах. */
  function bearing(a, b) {
    var rad = Math.PI / 180;
    var y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
    var x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) -
            Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  /** Ближайшая точка линии к заданному месту. -1 — линии нет. */
  function nearestIndex(latlng) {
    if (!PATH) return -1;
    var best = -1, bestDist = Infinity;
    for (var i = 0; i < PATH.pts.length; i += 1) {
      var d = meters(latlng, PATH.pts[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  /**
   * Подготовить линию к работе: накопленные метры до каждой её точки и
   * индексы подсказок. Делается один раз на новый маршрут, а не на каждый
   * метр пути — иначе считать «через 300 м» было бы слишком дорого.
   */
  function prepPath() {
    PATH = null;
    MAN = [];
    CUR_IDX = -1;
    lastIdx = -1;
    manKey = '';
    var pts = DATA.route || [];
    if (pts.length < 2) return;
    var cum = [0];
    for (var i = 1; i < pts.length; i += 1) {
      cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
    }
    PATH = { pts: pts, cum: cum };
    var list = DATA.maneuvers || [];
    for (var j = 0; j < list.length; j += 1) {
      var idx = nearestIndex([list[j].lat, list[j].lon]);
      if (idx > 1) {
        MAN.push({
          idx: idx,
          text: list[j].text || '',
          street: list[j].street || '',
          gap: meters(PATH.pts[idx], [list[j].lat, list[j].lon])
        });
      }
    }
    MAN.sort(function (a, b) { return a.idx - b.idx; });
    var point = currentPoint();
    if (point) CUR_IDX = nearestIndex([point.lat, point.lon]);
    if (ME) lastIdx = nearestIndex(ME);
  }

  /** «через 300 м» / «через 1,2 км» — как это говорят навигаторы. */
  function formatMeters(m) {
    if (m < 40) return 'сейчас';
    if (m < 1000) return (Math.round(m / 10) * 10) + ' м';
    return (Math.round(m / 100) / 10).toFixed(1) + ' км';
  }

  /** Значок подсказки: стрелка поворота, круг, флажок. */
  function arrowFor(text) {
    if (text === 'налево' || text === 'резко налево') return '\u21b0';
    if (text === 'направо' || text === 'резко направо' || text === 'слияние') return '\u21b1';
    if (text === 'правее' || text === 'развилка' || text === 'выезд на трассу') return '\u2197';
    if (text === 'левее') return '\u2196';
    if (text === 'съезд') return '\u2198';
    if (text === 'по кругу') return '\u21bb';
    if (text === 'разворот') return '\u21ba';
    if (text === 'прибытие') return '\u2691';
    return '\u2191';
  }

  /** Машина на карте: стрелка, повёрнутая туда, куда мы едем. */
  function updateCar() {
    var box = document.querySelector('.mec');
    if (!box) return;
    box.className = RIDE ? 'mec ride' : 'mec';
    var car = box.querySelector('.car');
    if (car) car.style.transform = 'rotate(' + Math.round(HEAD) + 'deg)';
  }

  /** Карта ведёт машину: она — в нижней трети экрана, дорога впереди видна. */
  function followMe(animate) {
    if (!map || !ME) return;
    var z = map.getZoom() < 15 ? 17 : map.getZoom();
    var size = map.getSize();
    var p = map.project(L.latLng(ME[0], ME[1]), z);
    p.y += Math.round(size.y * 0.22);
    map.setView(map.unproject(p, z), z, { animate: !!animate });
  }

  /** Линия пути: пройденное — серым, впереди — синим. Как в навигаторе. */
  function paintRide() {
    if (!map || !PATH) return;
    var idx = lastIdx >= 0 ? lastIdx : 0;
    var passed = PATH.pts.slice(0, idx + 1);
    var ahead = PATH.pts.slice(idx);
    if (passed.length > 1) {
      if (!passedLine) {
        passedLine = L.polyline(passed, { color: '#64748b', weight: 5, opacity: 0.75 }).addTo(map);
      } else {
        passedLine.setLatLngs(passed);
      }
    }
    if (ahead.length > 1) {
      if (!aheadLine) {
        aheadLine = L.polyline(ahead, { color: '#38bdf8', weight: 7, opacity: 0.95 }).addTo(map);
      } else {
        aheadLine.setLatLngs(ahead);
      }
    }
  }

  function dropRideLines() {
    if (!map) return;
    if (passedLine) { map.removeLayer(passedLine); passedLine = null; }
    if (aheadLine) { map.removeLayer(aheadLine); aheadLine = null; }
  }

  /** Подсказка о ближайшем повороте — полосой сверху, как в навигаторе. */
  function updateManeuver() {
    var box = document.getElementById('man');
    if (!box) return;
    if (!RIDE || !ME || !PATH || MAN.length === 0 || lastIdx < 0) {
      box.className = 'man';
      manKey = '';
      return;
    }
    var next = null, nextIdx = -1;
    for (var i = 0; i < MAN.length; i += 1) {
      var left = PATH.cum[MAN[i].idx] - PATH.cum[lastIdx];
      // Поворот позади или мы стоим ровно на нём — объявляем следующий.
      if (left < 0) continue;
      if (left < 25 && i < MAN.length - 1) continue;
      next = { left: left + MAN[i].gap, text: MAN[i].text, street: MAN[i].street };
      nextIdx = i;
      break;
    }
    if (!next) {
      box.className = 'man';
      manKey = '';
      navKey = '';
      return;
    }
    // Что делать сразу после ближайшего поворота — «затем направо».
    // В незнакомом месте второй манёвр важнее, чем метры до первого;
    // но если между поворотами больше двух километров, подсказка мешает.
    var after = null;
    if (nextIdx >= 0 && nextIdx + 1 < MAN.length) {
      var between = PATH.cum[MAN[nextIdx + 1].idx] - PATH.cum[MAN[nextIdx].idx];
      if (between < 2500) after = MAN[nextIdx + 1];
    }
    var key = next.text + '|' + next.street + '|' + Math.round(next.left / 25) +
      '|' + (after ? after.text + after.street : '');
    // Голос: объявляем поворот на подходе (см. NAV_STEPS) и перед ним самим.
    // Ключ включает текст, улицу и шаг — одна и та же фраза не повторяется,
    // а новая подсказка произносится сразу.
    var step = '';
    for (var s = 0; s < NAV_STEPS.length; s += 1) {
      if (next.left <= NAV_STEPS[s]) step = String(NAV_STEPS[s]);
    }
    if (next.left <= 80) step = 'now';
    var sayKey = next.text + '|' + next.street + '|' + step;
    if (step && sayKey !== navKey) {
      navKey = sayKey;
      say({ text: next.text, street: next.street, meters: Math.round(next.left) });
    }

    if (key !== manKey) {
      manKey = key;
      var dist = formatMeters(next.left);
      document.getElementById('manArrow').textContent = arrowFor(next.text);
      document.getElementById('manDist').textContent =
        dist === 'сейчас' ? 'Сейчас' : 'Через ' + dist;
      document.getElementById('manAct').textContent =
        next.street ? next.text + ' \u00b7 ' + next.street : next.text;
      document.getElementById('manNext').textContent = after
        ? 'затем ' + arrowFor(after.text) + ' ' + after.text +
          (after.street ? ' \u00b7 ' + after.street : '')
        : '';
    }
    box.className = 'man show';
  }

  /** Рассказать приложению, где мы и сколько осталось до текущей точки. */
  function publish() {
    if (!window.ReactNativeWebView) return;
    var point = currentPoint();
    var dist = (ME && point) ? Math.round(meters(ME, [point.lat, point.lon])) : null;
    // Сколько осталось по дорогам — считаем по уже загруженной линии: так
    // цифры в панели живые, а сервер не дёргаем каждые полминуты.
    var ahead = null;
    if (RIDE && PATH && ME && CUR_IDX >= 0 && lastIdx >= 0) {
      ahead = Math.round(Math.max(0, PATH.cum[CUR_IDX] - PATH.cum[lastIdx]));
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pos',
      lat: ME ? ME[0] : null,
      lon: ME ? ME[1] : null,
      dist: dist,
      ahead: ahead,
      pointNumber: point ? point.number : null,
      arrived: dist !== null && dist <= 200
    }));
  }

  /** Попросить приложение сказать фразу голосом (сама речь — на его стороне). */
  function say(nav) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nav', nav: nav }));
  }

  /** Сообщить приложению, что нажата кнопка в панели поездки. */
  function send(action) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'action', action: action }));
  }

  /**
   * Нижняя панель поездки: адрес, остаток, «Позвонить» / «Выполнено».
   * Приложение присылает её содержимое вместе с маршрутом (DATA.hud).
   */
  function updateHud() {
    var box = document.getElementById('hud');
    if (!box) return;
    if (!RIDE || !HUD.address) {
      box.className = 'hud';
      hudKey = '';
      return;
    }
    var key = HUD.address + '|' + HUD.meta + '|' + HUD.total + '|' + HUD.phone + '|' + HUD.sms +
      '|' + (HUD.home ? 'h' : '');
    if (key !== hudKey) {
      hudKey = key;
      document.getElementById('hudAddr').textContent = HUD.address;
      document.getElementById('hudMeta').textContent = HUD.meta;
      document.getElementById('hudVoice').textContent = HUD.voice === false ? '🔇' : '🔊';
      document.getElementById('hudTotal').textContent = HUD.total;
      // Домой одним касанием: Навигатор сам поведёт по адресу базы.
      document.getElementById('hudHome').style.display = HUD.home ? '' : 'none';
      var call = document.getElementById('hudCall');
      call.style.display = HUD.phone ? '' : 'none';
      var sms = document.getElementById('hudSms');
      sms.style.display = HUD.phone ? '' : 'none';
      sms.textContent = HUD.sms || 'Напишу клиенту';
    }
    box.className = 'hud show';
  }

  /** Пунктир от машины до точки, куда едем (подсказка направления). */
  function drawDirection() {
    if (!map) return;
    if (dirLine) { map.removeLayer(dirLine); dirLine = null; }
    var point = currentPoint();
    // Когда есть дорожный маршрут, пунктир по прямой только мешает.
    if (!RIDE || !ME || !point || DATA.directionHint === false) return;
    dirLine = L.polyline([ME, [point.lat, point.lon]], {
      color: '#38bdf8', weight: 3, opacity: 0.8, dashArray: '8 10'
    }).addTo(map);
  }

  function onPosition(ll, heading) {
    // Куда смотрит машина: телефон отдаёт курс, пока едет; не отдал —
    // считаем сами по двум точкам пути.
    if (typeof heading === 'number' && isFinite(heading) && heading >= 0) {
      HEAD = heading;
    } else if (lastFix && meters(lastFix, ll) > 8) {
      HEAD = bearing(lastFix, ll);
    }
    if (!lastFix || meters(lastFix, ll) > 8) lastFix = ll;
    ME = ll;
    setMe(ll);
    if (RIDE) {
      var idx = nearestIndex(ll);
      if (idx >= 0) {
        // Перерисовываем пройденное/оставшееся только когда отъехали заметно:
        // каждый метр это делать незачем, картинка от этого не меняется.
        if (lastIdx < 0 || Math.abs(idx - lastIdx) >= 4) {
          lastIdx = idx;
          paintRide();
        } else {
          lastIdx = idx;
        }
      }
      // Карта ведёт машину сама; увёл руками — не спорим, но вернём в кадр,
      // если машина уйдёт за край экрана.
      if (FOLLOW) followMe(false);
      else if (!map.getBounds().contains(ll)) map.setView(ll, 17, { animate: true });
      updateManeuver();
      if (!PATH) drawDirection();
    }
    publish();
  }

  function draw() {
    if (!map) return;
    if (layer) { map.removeLayer(layer); }
    layer = L.layerGroup().addTo(map);

    // В поездке линия рисуется по-другому: пройденное — серым, впереди —
    // синим (paintRide). Вне поездки — весь план одной линией.
    dropRideLines();
    if (DATA.route && DATA.route.length > 1 && !(RIDE && PATH)) {
      L.polyline(DATA.route, { color: '#38bdf8', weight: 5, opacity: 0.9 }).addTo(layer);
    }
    if (RIDE && PATH) paintRide();

    var bounds = [];
    for (var i = 0; i < DATA.points.length; i++) {
      var p = DATA.points[i];
      bounds.push([p.lat, p.lon]);
      L.marker([p.lat, p.lon], { icon: pinIcon(p) })
        .addTo(layer)
        .bindPopup('<b>' + p.number + '. ' + p.title + '</b><br/>' + p.subtitle);
    }

    var active = RIDE ? currentPoint() : null;
    if (active && ME) {
      // В поездке карту держит навигационный вид: машина в нижней трети,
      // дорога впереди. Подгонять вид по двум точкам здесь не нужно.
      if (!RIDE) {
        map.fitBounds([ME, [active.lat, active.lon]], { padding: [70, 70], maxZoom: 16 });
      } else if (map.getZoom() < 10) {
        map.setView(ME, 17, { animate: true });
      }
    } else if (DATA.focus !== null && DATA.points[DATA.focus]) {
      var f = DATA.points[DATA.focus];
      map.setView([f.lat, f.lon], Math.max(map.getZoom(), 14), { animate: true });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function setMe(ll) {
    if (!map) return;
    if (!meMarker) {
      meMarker = L.marker(ll, {
        icon: L.divIcon({ html: CAR_HTML, className: '', iconSize: [44, 44], iconAnchor: [22, 22] }),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
    }
    updateCar();
  }

  // О причинах неудачи с геопозицией рассказываем приложению: человек должен
  // видеть «запрещён доступ» или «нет сигнала», а не бесконечное «определяю…».
  var geoReported = '';
  function reportGeo(status, code) {
    var key = status + ':' + (code || 0);
    if (geoReported === key) return;
    geoReported = key;
    if (!window.ReactNativeWebView) return;
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'geo', status: status, code: code || null
      }));
    } catch (e) {}
  }

  function watchMe() {
    try {
      navigator.geolocation.watchPosition(function (pos) {
        reportGeo('ok', null);
        onPosition([pos.coords.latitude, pos.coords.longitude], pos.coords.heading);
      }, function (err) {
        reportGeo('error', (err && err.code) ? err.code : 0);
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } catch (e) {
      reportGeo('unsupported', null);
    }
  }

  // Разрешение на геопозицию спрашивает приложение, а не карта: пока человек
  // отвечает на системное окно, карта успевает открыться — поэтому при отказе
  // просто пробуем ещё несколько раз, а не молча теряем свою точку.
  function startGeo(attempt) {
    if (!navigator.geolocation) {
      reportGeo('unsupported', null);
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(function (pos) {
        reportGeo('ok', null);
        onPosition([pos.coords.latitude, pos.coords.longitude], pos.coords.heading);
        watchMe();
      }, function (err) {
        reportGeo('error', (err && err.code) ? err.code : 0);
        if (attempt < 5) setTimeout(function () { startGeo(attempt + 1); }, 8000);
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    } catch (e) {
      reportGeo('unsupported', null);
    }
  }

  var hudBound = false;
  function bindHud() {
    if (hudBound) return;
    hudBound = true;
    var done = document.getElementById('hudDone');
    var miss = document.getElementById('hudMiss');
    var home = document.getElementById('hudHome');
    var call = document.getElementById('hudCall');
    var sms = document.getElementById('hudSms');
    if (home) home.onclick = function () { send('base'); };
    if (done) done.onclick = function () { send('done'); };
    if (miss) miss.onclick = function () { send('postpone'); };
    if (call) call.onclick = function () { send('call'); };
    if (sms) sms.onclick = function () { send('sms'); };
  }

  // Панель поездки приходит отдельным сообщением: она меняется часто (остаток,
  // время), а карту из-за этого перерисовывать не надо.
  window.__hud = function (hud) {
    if (!hud) return;
    HUD = hud;
    bindHud();
    updateHud();
  };

  window.__setRoute = function (data) {
    DATA = data || DATA;
    if (data && data.hud) HUD = data.hud;
    bindHud();
    prepPath();
    if (map) {
      draw();
      if (!PATH) drawDirection();
      updateManeuver();
      updateHud();
    }
    publish();
  };
  window.__recenter = function () {
    DATA.focus = null;
    FOLLOW = RIDE;
    if (RIDE && ME) followMe(true);
    draw();
  };
  // Поездка: карта ведёт машину, показывает повороты и остаток пути.
  window.__ride = function (on) {
    RIDE = !!on;
    FOLLOW = RIDE;
    if (!RIDE) {
      if (dirLine) { map.removeLayer(dirLine); dirLine = null; }
      dropRideLines();
      updateCar();
      updateManeuver();
      updateHud();
      draw();
      publish();
      return;
    }
    if (map && ME) {
      var point = currentPoint();
      var far = point ? meters(ME, [point.lat, point.lon]) : 0;
      // Далеко до точки — показываем весь путь целиком; подъехали —
      // включаем навигационный вид и приближаем, как в навигаторе.
      if (point && far > 5000) {
        map.fitBounds([ME, [point.lat, point.lon]], { padding: [60, 60], maxZoom: 14 });
      } else {
        map.setView(ME, 17, { animate: true });
      }
    }
    updateCar();
    draw();
    if (!PATH) drawDirection();
    updateManeuver();
    updateHud();
    publish();
  };

  if (!window.L) {
    document.getElementById('boot').textContent =
      'Карту не удалось загрузить: проверьте интернет и откройте экран заново.';
    return;
  }
  document.getElementById('boot').style.display = 'none';
  map = L.map('map', { zoomControl: false, attributionControl: true });
  // Человек увёл карту пальцем — перестаём тянуть её за машиной, пока не
  // нажмёт «прицел»: иначе карта воюет с пальцем.
  map.on('dragstart', function () { FOLLOW = false; });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '\u00a9 OpenStreetMap'
  }).addTo(map);
  map.setView([53.8, 37.9], 9);
  draw();
  startGeo(0);
  window.__ready = true;
})();
</script>
</body>
</html>`;

/**
 * Каркас карты — один и тот же объект на каждый рендер.
 * Если передавать новый объект каждый раз, встроенный браузер может посчитать,
 * что страницу просят перезагрузить, и карта будет мигать.
 *
 * baseUrl — не косметика, а условие работы геопозиции. Браузер отдаёт
 * местоположение только защищённому источнику (https), а документ «из строки»
 * по умолчанию живёт в небезопасном — и тогда navigator.geolocation молча
 * отказывает с ошибкой «запрещено», сколько ни разрешай доступ приложению.
 * Поэтому документу выдаём адрес нашего сайта: адрес никуда не запрашивается,
 * он нужен только как источник.
 */
export const MAP_BASE_URL = "https://obzor71.ru/";
export const MAP_SOURCE = { html: MAP_HTML, baseUrl: MAP_BASE_URL };
