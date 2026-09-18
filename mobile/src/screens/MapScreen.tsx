/**
 * Карта маршрута внутри приложения.
 *
 * Собрал маршрут, нажал «Поехали» — и видишь, куда ехать, не выходя из
 * приложения: точки с номерами в том самом порядке, который выставлен
 * стрелками, линия проезда, километраж и время, текущая точка крупнее
 * остальных, своё положение по GPS.
 *
 * Карту рисует Leaflet (OpenStreetMap) во встроенном браузере, координаты
 * считает наш сервер — ни ключей, ни кабинетов, ни счетов. Подпись
 * «© OpenStreetMap» обязательна по правилам сервиса.
 *
 * Голосовых подсказок здесь нет и не будет — это отдельный продукт. Кнопка
 * «Навигатор» рядом открывает Яндекс Навигатор, когда нужен голос; если
 * координаты уже найдены, открываем по ним (точнее, чем по адресу).
 *
 * ВАЖНО про совместимость: встроенный браузер — нативный модуль, и в APK,
 * собранных до появления карты, его нет. Поэтому require обёрнут в try/catch
 * и вызывается динамически (см. RouteScreen): старые сборки получают понятное
 * «обновите приложение» вместо падения.
 */
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, isNetworkError, type GeoPlanResult, type GeoRideRoute } from "../api";
import { openPointInNavigator, openRouteInNavigator } from "../maps";
import { colors } from "../theme";

/** Встроенный браузер. null — в этой сборке APK его ещё нет. */
let WebViewComponent: any = null;
try {
  WebViewComponent = require("react-native-webview").WebView;
} catch {
  WebViewComponent = null;
}

/**
 * Есть ли в этой сборке APK встроенный браузер.
 *
 * Старые сборки (до карты) получают обновления по OTA вместе со всеми, но
 * нативного модуля у них нет — там кнопка карты просто не показывается,
 * и ничего не ломается.
 */
export const isMapAvailable = Boolean(WebViewComponent);

export interface MapStop {
  id: string;
  /** Клиент или город — то, что видно в списке. */
  name: string;
  address: string;
  /** Город из заявки: уточняет поиск адреса. */
  city?: string;
  /** Заявка уже выполнена. */
  done?: boolean;
}

interface Props {
  token: string;
  /** Точки в порядке объезда. */
  stops: MapStop[];
  /** Текущая точка маршрута. */
  currentId: string | null;
  onClose: () => void;
  /** Открыть заявку целиком. */
  onOpenLead: (id: string) => void;
  /** Открыть карты по адресу — когда координаты найти не удалось. */
  onNavigateByAddress: (id: string) => void;
  /**
   * Точка отработана: водитель нажал «Выполнено» в поездке. Делает то же,
   * что кнопка в списке маршрута (с подтверждением расходников), после чего
   * текущей становится следующая точка — карта уезжает к ней сама.
   */
  onComplete: (id: string) => void;
}

/**
 * Сколько раз подряд спрашиваем сервер. Он разбирает новые адреса порциями
 * (правила OpenStreetMap — не чаще запроса в секунду), поэтому один вызов
 * может вернуть не все точки сразу.
 */
const MAX_ROUNDS = 12;

/**
 * Когда пересчитывать дорогу от машины.
 *
 * Раньше считали по движению — каждые 400 метров. Теперь подсказки «через
 * 300 м направо» и остаток пути приложение считает само по уже полученной
 * линии, поэтому частый пересчёт ничего не уточняет, а только грузит
 * бесплатный маршрутизатор OSM (его правило — не чаще запроса в секунду).
 *
 * Пересчитываем только когда это правда нужно: свернули с линии, линия
 * впереди почти закончилась, уехали от точки прошлого расчёта далеко или
 * прошло много времени. Заодно это бережёт трафик телефона.
 */
const RIDE_MOVE_METERS = 1500;
const RIDE_MAX_AGE_MS = 5 * 60_000;
/** Отклонились от линии — значит, уехали не туда: строим дорогу заново. */
const RIDE_OFF_ROUTE_METERS = 150;
/** Линия впереди почти закончилась — пора строить следующую. */
const RIDE_MIN_AHEAD_METERS = 1500;
/** Минимальная пауза между запросами к сервису маршрутов. */
const RIDE_MIN_REQUEST_MS = 30_000;

/** HTML-каркас карты. Данные приходят отдельно — через window.__setRoute. */
const MAP_HTML = `<!DOCTYPE html>
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
  .manArrow { flex: none; width: 40px; height: 40px; border-radius: 20px;
    background: #2563eb; color: #fff; display: flex; align-items: center;
    justify-content: center; font: 700 22px system-ui, -apple-system, sans-serif; }
  .manBody { flex: 1; min-width: 0; }
  .manDist { color: #f8fafc; font: 700 20px system-ui, -apple-system, sans-serif; }
  .manAct { color: #cbd5e1; font: 13px system-ui, -apple-system, sans-serif;
    margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
  var passedLine = null, aheadLine = null, manKey = '';
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
    var next = null;
    for (var i = 0; i < MAN.length; i += 1) {
      var left = PATH.cum[MAN[i].idx] - PATH.cum[lastIdx];
      // Поворот позади или мы стоим ровно на нём — объявляем следующий.
      if (left < 0) continue;
      if (left < 25 && i < MAN.length - 1) continue;
      next = { left: left + MAN[i].gap, text: MAN[i].text, street: MAN[i].street };
      break;
    }
    if (!next) {
      box.className = 'man';
      manKey = '';
      return;
    }
    var key = next.text + '|' + next.street + '|' + Math.round(next.left / 25);
    if (key !== manKey) {
      manKey = key;
      var dist = formatMeters(next.left);
      document.getElementById('manArrow').textContent = arrowFor(next.text);
      document.getElementById('manDist').textContent =
        dist === 'сейчас' ? 'Сейчас' : 'Через ' + dist;
      document.getElementById('manAct').textContent =
        next.street ? next.text + ' \u00b7 ' + next.street : next.text;
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

  window.__setRoute = function (data) {
    DATA = data || DATA;
    prepPath();
    if (map) {
      draw();
      if (!PATH) drawDirection();
      updateManeuver();
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
const MAP_BASE_URL = "https://obzor71.ru/";
const MAP_SOURCE = { html: MAP_HTML, baseUrl: MAP_BASE_URL };

function safeJson(value: unknown): string {
  // Ничего лишнего в скрипт не попадёт: кавычки и угловые скобки экранируем.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028|\u2029/g, "");
}

/** Ошибку отрисовки карты не даём уронить всё приложение. */
class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/**
 * Где машина относительно линии: насколько отклонилась и сколько линии
 * осталось впереди. Считаем на телефоне — из-за этого сервер не дёргаем.
 */
function progressOnRoute(
  geometry: [number, number][],
  me: { lat: number; lon: number } | null,
): { offRoute: number; ahead: number } | null {
  if (!me || geometry.length < 2) return null;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < geometry.length; i += 1) {
    const d = metersBetween({ lat: geometry[i][0], lon: geometry[i][1] }, me);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  let ahead = 0;
  for (let i = bestIdx; i < geometry.length - 1; i += 1) {
    ahead += metersBetween(
      { lat: geometry[i][0], lon: geometry[i][1] },
      { lat: geometry[i + 1][0], lon: geometry[i + 1][1] },
    );
  }
  return { offRoute: bestDist, ahead };
}

const NO_WEBVIEW_HINT =
  "Карта появится после обновления приложения: эта сборка ещё не умеет показывать карты внутри себя. Скачайте новую версию APK — и карта заработает.";

export function MapScreen({
  token,
  stops,
  currentId,
  onClose,
  onOpenLead,
  onNavigateByAddress,
  onComplete,
}: Props) {
  const [geo, setGeo] = useState<GeoPlanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Сервис карт не ответил — покажем это отдельно от «адрес не найден». */
  const [unavailable, setUnavailable] = useState(false);
  /** Идёт поездка: карта следит за машиной и сама ведёт к следующей точке. */
  const [riding, setRiding] = useState(false);
  /**
   * Что карта рассказала о нашем положении.
   * dist — по прямой, ahead — по дорогам (карта считает его по загруженной
   * линии, поэтому цифры живые, а сервер не переспрашиваем каждый метр).
   */
  const [ride, setRide] = useState<{ dist: number | null; ahead: number | null; arrived: boolean }>({
    dist: null,
    ahead: null,
    arrived: false,
  });
  /** Где мы сейчас — карта присылает вместе с расстоянием до точки. */
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  /** Дорожный маршрут от машины: линия по дорогам, остаток и время прибытия. */
  const [road, setRoad] = useState<GeoRideRoute | null>(null);
  /** Сервис маршрутов не ответил — показываем по прямой и говорим об этом. */
  const [roadFailed, setRoadFailed] = useState(false);
  /**
   * Что случилось с геопозицией: карта рассказывает причину сама.
   * unsupported — не умеет, denied — доступ запрещён, unavailable — сигнала нет.
   */
  const [geoIssue, setGeoIssue] = useState<"unsupported" | "denied" | "unavailable" | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const webRef = useRef<any>(null);
  /** Откуда считался последний дорожный маршрут — чтобы не пересчитывать зря. */
  const roadRef = useRef<{ at: number; lat: number; lon: number } | null>(null);
  /** Номер последнего запроса дороги: ответы на старые не применяем. */
  const roadReqRef = useRef(0);

  // Отпечаток списка точек: меняется адрес или порядок — маршрут пересчитываем.
  const signature = useMemo(
    () => stops.map((s) => `${s.id}|${s.address}|${s.city ?? ""}`).join("~"),
    [stops],
  );
  const requestStops = useMemo(
    () => stops.map((s) => ({ id: s.id, address: s.address, city: s.city })),
    [signature],
  );

  /** forceRefresh — нажали «Повторить»: сервер не верит даже пометке «не найдено». */
  const load = useCallback(async (forceRefresh = false) => {
    if (requestStops.length === 0) {
      setGeo({ stops: [], route: null, remaining: 0 });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      let serviceDown = false;
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const data = await api.geoPlan(token, requestStops, forceRefresh && round === 0);
        serviceDown = Boolean(data?.unavailable);
        setUnavailable(serviceDown);
        setGeo({
          stops: data?.stops ?? [],
          route: data?.route ?? null,
          remaining: data?.remaining ?? 0,
        });
        // remaining = 0 — сервер разобрал все адреса, линия маршрута готова.
        if (!data?.remaining) break;
        // Сервис карт не отвечает: долбить его двенадцать раз смысла нет —
        // показываем карту с тем, что есть, и кнопку «Повторить».
        if (serviceDown) break;
      }
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Нет связи с сервером. Проверьте интернет и повторите."
          : err instanceof Error
            ? err.message
            : "Не удалось определить адреса на карте",
      );
    } finally {
      setLoading(false);
    }
  }, [requestStops, token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Спрашиваем разрешение на геопозицию — карта покажет, где мы сейчас.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ).catch(() => undefined);
  }, []);

  const coordsById = useMemo(() => {
    const map = new Map<string, { lat: number; lon: number; precision: string }>();
    for (const s of geo?.stops ?? []) {
      if (s.lat !== null && s.lon !== null) {
        map.set(s.id, { lat: s.lat, lon: s.lon, precision: s.precision });
      }
    }
    return map;
  }, [geo]);

  const currentIndex = currentId ? stops.findIndex((s) => s.id === currentId) : -1;
  const currentStop = currentIndex >= 0 ? stops[currentIndex] : null;
  const currentCoords = currentStop ? coordsById.get(currentStop.id) : undefined;

  // Данные для карты: нумерация по порядку объезда, текущая точка — крупнее.
  const payload = useMemo(() => {
    const points = stops
      .map((stop, index) => {
        const c = coordsById.get(stop.id);
        if (!c) return null;
        return {
          lat: c.lat,
          lon: c.lon,
          number: index + 1,
          state: stop.id === currentId ? "current" : stop.done ? "done" : "todo",
          title: (stop.address || "адрес не указан").slice(0, 60),
          subtitle: (stop.name || "").slice(0, 40),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    return {
      points,
      // В поездке рисуем дорогу от машины; вне поездки — план между точками.
      route: riding && road ? road.geometry : (geo?.route?.geometry ?? []),
      /**
       * Повороты. Метры до ближайшего карта считает сама по линии и по
       * геопозиции, поэтому подсказка обновляется на каждом обновлении
       * положения, а сервер переспрашиваем редко.
       */
      maneuvers:
        riding && road
          ? road.legs.flatMap((leg) =>
              (leg.maneuvers ?? []).map((m) => ({
                lat: m.lat,
                lon: m.lon,
                text: m.text,
                street: m.street,
              })),
            )
          : [],
      // Пунктир по прямой нужен только когда дороги ещё нет.
      directionHint: !(riding && road),
      focus: currentCoords ? points.findIndex((p) => p.number === currentIndex + 1) : null,
    };
  }, [stops, coordsById, currentId, geo, currentCoords, currentIndex, riding, road]);

  /** Оставшиеся точки в порядке объезда: текущая и все следующие за ней. */
  const aheadStops = useMemo(() => {
    if (currentIndex < 0) return [];
    const list: { id: string; lat: number; lon: number }[] = [];
    for (const stop of stops.slice(currentIndex)) {
      if (stop.done) continue;
      const point = coordsById.get(stop.id);
      if (!point) continue;
      list.push({ id: stop.id, lat: point.lat, lon: point.lon });
    }
    return list;
  }, [stops, currentIndex, coordsById]);

  // Где мы относительно линии и сколько её ещё впереди — считаем сами,
  // на телефоне: это нужно, чтобы понять, пора ли строить маршрут заново.
  const pathInfo = useMemo(() => progressOnRoute(road?.geometry ?? [], me), [road, me]);

  // Раз в полминуты проверяем, не пора ли пересчитать дорогу (например, машина
  // стоит в пробке и остаток пути от времени уже не тот).
  const [rideTick, setRideTick] = useState(0);
  useEffect(() => {
    if (!riding) return;
    const timer = setInterval(() => setRideTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [riding]);

  // Отработали точку — дорогу до следующей считаем заново, не дожидаясь движения.
  useEffect(() => {
    roadRef.current = null;
  }, [currentId]);

  /**
   * Дорожный маршрут от машины до оставшихся точек. Считаем при старте поездки,
   * после каждой точки и только когда это правда нужно: подсказки про повороты
   * и остаток пути приложение считает само по уже полученной линии.
   */
  useEffect(() => {
    if (!riding || !me || aheadStops.length === 0) return;
    const last = roadRef.current;
    if (last) {
      const age = Date.now() - last.at;
      // Не чаще раза в полминуты: правила OSM — не чаще запроса в секунду,
      // и повторный расчёт ничего не уточнит за такой короткий срок.
      if (age < RIDE_MIN_REQUEST_MS) return;
      const moved = metersBetween(last, me);
      const stale = moved >= RIDE_MOVE_METERS || age >= RIDE_MAX_AGE_MS;
      // Свернули с линии — перестраиваем сразу: человек явно поехал не туда.
      const offRoute = pathInfo ? pathInfo.offRoute > RIDE_OFF_ROUTE_METERS : false;
      // Линия впереди почти кончилась — дальше рисовать нечего.
      const ended = pathInfo ? pathInfo.ahead < RIDE_MIN_AHEAD_METERS : false;
      if (!stale && !offRoute && !ended) return;
    }
    roadRef.current = { at: Date.now(), lat: me.lat, lon: me.lon };
    // Номер запроса: ответ на устаревший (пока ехали) просто не применяем.
    // Отменять запрос при каждом обновлении позиции нельзя — иначе линия
    // не появится вообще, пока машина движется.
    roadReqRef.current += 1;
    const reqId = roadReqRef.current;
    void api
      .rideRoute(token, me, aheadStops)
      .then((data) => {
        if (roadReqRef.current !== reqId) return;
        setRoad(data);
        setRoadFailed(false);
      })
      .catch(() => {
        // Не получилось — оставляем прежнюю линию и говорим об этом честно.
        if (roadReqRef.current === reqId) setRoadFailed(true);
      });
  }, [riding, me, rideTick, aheadStops, token, pathInfo]);

  /** Участок до текущей точки — из него берём «осталось» и время прибытия. */
  const currentLeg = useMemo(() => {
    if (!road || !currentId) return null;
    return road.legs.find((leg) => leg.id === currentId) ?? null;
  }, [road, currentId]);

  /**
   * Время до текущей точки по живым данным: остаток по дорогам (его считает
   * карта) умножаем на среднюю скорость участка. Так «буду в 14:20» не
   * замирает между пересчётами дороги.
   */
  const etaSeconds = useMemo(() => {
    if (!currentLeg || ride.ahead === null || currentLeg.distance <= 0) return null;
    const share = Math.min(1, Math.max(0, ride.ahead / currentLeg.distance));
    return Math.round(currentLeg.duration * share);
  }, [currentLeg, ride.ahead]);

  // Обновляем карту без перезагрузки страницы: маршрут перестраивается на месте.
  useEffect(() => {
    if (!ready || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__setRoute(${safeJson(payload)}); true;`);
  }, [ready, payload]);

  // Режим поездки: карта начинает следить за машиной и считать расстояние.
  useEffect(() => {
    if (!ready || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__ride(${riding ? "true" : "false"}); true;`);
  }, [ready, riding]);

  // Маршрут закончился (все точки выполнены) — поездка закрывается сама.
  useEffect(() => {
    if (riding && !currentId) setRiding(false);
  }, [riding, currentId]);

  // Карта вообще молчит о геопозиции (ни успеха, ни ошибки) — значит, сигнала
  // нет. Ждём двадцать секунд и говорим это человеку, а не держим «определяю…».
  useEffect(() => {
    if (!riding || ride.dist !== null || geoIssue !== null || !currentCoords) return;
    const timer = setTimeout(() => setGeoIssue("unavailable"), 20_000);
    return () => clearTimeout(timer);
  }, [riding, ride.dist, geoIssue, currentCoords]);

  const foundCount = coordsById.size;
  // Не найденные адреса показываем списком: администратор сразу видит, какую
  // заявку править, вместо «часть адресов не найдена, поищите сами».
  const missingStops = useMemo(
    () => stops.filter((stop) => !coordsById.has(stop.id)),
    [stops, coordsById],
  );
  const missingCount = missingStops.length;
  const missingHint = useMemo(() => {
    const shown = missingStops
      .slice(0, 2)
      .map((stop) => stop.address || "адрес не указан")
      .join("; ");
    return missingStops.length > 2 ? `${shown} и ещё ${missingStops.length - 2}` : shown;
  }, [missingStops]);

  /** Карта сама рассказывает, где мы и сколько осталось до текущей точки. */
  const handleMapMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const parsed: unknown = (() => {
      try {
        return JSON.parse(event.nativeEvent.data);
      } catch {
        return null; // карта может писать что-то своё — просто пропускаем
      }
    })();
    if (!parsed || typeof parsed !== "object") return;
    const data = parsed as {
      type?: string;
      lat?: number | null;
      lon?: number | null;
      dist?: number | null;
      ahead?: number | null;
      arrived?: boolean;
      status?: string;
      code?: number | null;
    };
    if (data.type === "geo") {
      // 1 — доступ запрещён, 2 — положение недоступно, 3 — нет сигнала.
      const code = typeof data.code === "number" ? data.code : 0;
      setGeoIssue(
        data.status === "ok"
          ? null
          : data.status === "unsupported"
            ? "unsupported"
            : code === 1
              ? "denied"
              : "unavailable",
      );
      return;
    }
    if (data.type !== "pos") return;
    if (typeof data.lat === "number" && typeof data.lon === "number") {
      setMe({ lat: data.lat, lon: data.lon });
    }
    setRide({
      dist: typeof data.dist === "number" ? data.dist : null,
      ahead: typeof data.ahead === "number" ? data.ahead : null,
      arrived: data.arrived === true,
    });
  }, []);

  const startRide = useCallback(() => {
    setRide({ dist: null, ahead: null, arrived: false });
    roadRef.current = null;
    setRiding(true);
  }, []);

  const stopRide = useCallback(() => {
    roadRef.current = null;
    setRoad(null);
    setRoadFailed(false);
    setRiding(false);
  }, []);

  /**
   * «Выполнено» в поездке: закрываем текущую заявку тем же путём, что и в
   * списке маршрута. План пересчитывается, следующая точка становится текущей
   * — карта уезжает к ней, а поездка продолжается без лишних нажатий.
   */
  const completeCurrent = useCallback(() => {
    if (!currentStop) return;
    setRide({ dist: null, ahead: null, arrived: false });
    onComplete(currentStop.id);
  }, [currentStop, onComplete]);

  /**
   * Весь оставшийся маршрут — в Яндекс Карты: он ведёт голосом от точки
   * к точке, и открывать каждую заявку руками не нужно.
   */
  const ridePoints = useMemo(
    () => aheadStops.map((stop) => ({ lat: stop.lat, lon: stop.lon })),
    [aheadStops],
  );

  const handleWholeRoute = useCallback(async () => {
    if (ridePoints.length === 0) return;
    await openRouteInNavigator(
      ridePoints,
      currentStop?.address || currentStop?.name || "Заявка",
    );
  }, [ridePoints, currentStop]);

  const handleNavigate = useCallback(async () => {
    if (!currentStop) return;
    if (currentCoords) {
      const ok = await openPointInNavigator(
        currentCoords.lat,
        currentCoords.lon,
        currentStop.address || currentStop.name,
      );
      if (ok) return;
    }
    // Координат нет — открываем по адресу (там уже есть выбор города).
    onClose();
    onNavigateByAddress(currentStop.id);
  }, [currentStop, currentCoords, onClose, onNavigateByAddress]);

  const header = (
    <View style={styles.header}>
      <Pressable onPress={onClose} hitSlop={10} style={styles.headerButton}>
        <Ionicons name="close" size={22} color={colors.text} />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.headerTitle}>Карта маршрута</Text>
        <Text style={styles.headerSubtitle}>
          {loading
            ? `Определяю адреса… ${foundCount} из ${stops.length}`              : riding
                ? `Поездка · точка ${currentIndex + 1} из ${stops.length}${
                    ride.ahead !== null && etaSeconds !== null
                      ? ` · ${formatDistance(ride.ahead)} · буду ~${formatClock(etaSeconds)}`
                      : currentLeg
                        ? ` · ${formatDistance(currentLeg.distance)} · буду ~${formatClock(
                            currentLeg.duration,
                          )}`
                        : ride.dist !== null
                          ? ` · ${formatDistance(ride.dist)}`
                          : ""
                  }`
              : geo?.route
                ? `${formatDistance(geo.route.distance)} · ${formatDuration(geo.route.duration)}`
                : `${stops.length} ${plural(stops.length, ["точка", "точки", "точек"])}`}
        </Text>
      </View>
      <Pressable
        onPress={() => webRef.current?.injectJavaScript("window.__recenter(); true;")}
        hitSlop={10}
        style={styles.headerButton}
      >
        <Ionicons name="locate" size={20} color={colors.text} />
      </Pressable>
    </View>
  );

  const fallback = (
    <View style={styles.fallback}>
      <Ionicons name="map-outline" size={38} color={colors.textMuted} />
      <Text style={styles.fallbackTitle}>Карта недоступна</Text>
      <Text style={styles.fallbackHint}>{NO_WEBVIEW_HINT}</Text>
      <Pressable
        style={({ pressed }) => [styles.fallbackButton, pressed && { opacity: 0.85 }]}
        onPress={() => {
          onClose();
          if (currentStop) onNavigateByAddress(currentStop.id);
        }}
      >
        <Ionicons name="navigate" size={16} color={colors.primaryForeground} />
        <Text style={styles.fallbackButtonText}>Открыть Навигатор</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        {header}

        <View style={styles.mapWrap}>
          {WebViewComponent ? (
            <MapErrorBoundary fallback={fallback}>
              <WebViewComponent
                ref={webRef}
                source={MAP_SOURCE}
                originWhitelist={["*"]}
                javaScriptEnabled
                domStorageEnabled
                geolocationEnabled
                // По ссылкам внутри карты не ходим (например, на подписи OSM) —
                // иначе карта уедет на сторонний сайт и вернуться будет нечем.
                // Чужие ссылки внутри карты не открываем (уедешь — вернуться
                // будет нечем), но свой адрес-источник пропускаем всегда.
                onShouldStartLoadWithRequest={(request: { url: string }) => {
                  const url = request.url ?? "";
                  if (url.startsWith(MAP_BASE_URL) || /^(about|data):/i.test(url)) return true;
                  return !/^https?:/i.test(url);
                }}
                onLoadEnd={() => setReady(true)}
                onMessage={handleMapMessage}
                style={styles.webview}
                // Карта всегда тёмная: белая вспышка при загрузке бьёт по глазам.
                containerStyle={styles.webview}
              />
            </MapErrorBoundary>
          ) : (
            fallback
          )}

          {loading ? (
            <View style={styles.overlay}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.overlayText}>Ищу адреса на карте…</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.overlay}>
              <Ionicons name="cloud-offline-outline" size={30} color={colors.textMuted} />
              <Text style={styles.overlayText}>{error}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.85 }]}
                onPress={() => void load()}
              >
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && !error && (missingCount > 0 || unavailable) ? (
            <Pressable style={styles.warn} onPress={() => void load(true)}>
              <Ionicons
                name={unavailable ? "cloud-offline-outline" : "alert-circle-outline"}
                size={14}
                color="#fbbf24"
              />
              <View style={styles.warnBody}>
                <Text style={styles.warnText}>
                  {unavailable
                    ? missingCount > 0
                      ? `Сервис карт не ответил — адреса не проверены: ${missingHint}`
                      : "Сервис карт не ответил — часть адресов не проверена"
                    : missingCount === stops.length
                      ? `Адреса не нашлись на карте: ${missingHint}. Проверьте адрес в заявке`
                      : `Не нашли на карте: ${missingHint}`}
                </Text>
                <Text style={styles.warnAction}>Нажмите, чтобы повторить</Text>
              </View>
            </Pressable>
          ) : null}
        </View>

        {!riding && currentStop ? (
          <Pressable
            style={({ pressed }) => [styles.startRide, pressed && { opacity: 0.85 }]}
            onPress={startRide}
          >
            <Ionicons name="car-sport" size={18} color={colors.primaryForeground} />
            <Text style={styles.startRideText}>
              Начать поездку · точка {currentIndex + 1} из {stops.length}
            </Text>
          </Pressable>
        ) : null}

        {riding && currentStop ? (
          <View style={styles.ridePanel}>
            <View style={styles.rideTop}>
              <View style={[styles.footerNumber, ride.arrived && styles.rideNumberArrived]}>
                <Text style={styles.footerNumberText}>№{currentIndex + 1}</Text>
              </View>
              <View style={styles.footerText}>
                <Text style={styles.footerAddress} numberOfLines={1}>
                  {currentStop.address || "адрес не указан"}
                </Text>
                <Text
                  style={[styles.footerMeta, ride.arrived && styles.rideMetaArrived]}
                  numberOfLines={1}
                >
                  {ride.arrived
                    ? "Вы на месте — отмечайте выполнение"
                    : ride.ahead !== null && etaSeconds !== null
                      ? `до точки ${formatDistance(ride.ahead)} · ${formatDuration(
                          etaSeconds,
                        )} · буду ~${formatClock(etaSeconds)}`
                      : currentLeg
                        ? `до точки ${formatDistance(currentLeg.distance)} · ${formatDuration(
                            currentLeg.duration,
                          )} · буду ~${formatClock(currentLeg.duration)}`
                        : ride.dist !== null
                        ? `осталось ${formatDistance(ride.dist)} по прямой`
                        : geoIssue === "denied"
                        ? "приложению запрещён доступ к геопозиции"
                        : geoIssue === "unsupported"
                          ? "эта сборка не умеет определять положение"
                          : geoIssue === "unavailable"
                            ? "нет сигнала GPS — попробуйте выйти на улицу"
                            : !currentCoords
                              ? "координаты не найдены — ведите по адресу"
                              : "определяю, где мы…"}
                </Text>
              </View>
              <Pressable onPress={stopRide} hitSlop={8} style={styles.rideStop}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>

            {road ? (
              <Text style={styles.rideTotal}>
                Весь остаток: {formatDistance(road.distance)} · {formatDuration(road.duration)} ·
                закончу около {formatClock(road.duration)}
              </Text>
            ) : roadFailed ? (
              <Text style={styles.rideTotal}>
                Дорогу показать не удалось — сервис маршрутов не ответил, показываю по прямой
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.rideDone,
                ride.arrived && styles.rideDoneArrived,
                pressed && { opacity: 0.85 },
              ]}
              onPress={completeCurrent}
            >
              <Ionicons name="checkmark-circle" size={20} color={colors.primaryForeground} />
              <Text style={styles.rideDoneText}>
                {ride.arrived ? "Выполнено — к следующей" : "Приехал, отметить выполненной"}
              </Text>
            </Pressable>

            <View style={styles.rideActions}>
              <Pressable
                style={({ pressed }) => [styles.rideAction, pressed && { opacity: 0.8 }]}
                onPress={() => void handleNavigate()}
              >
                <Ionicons name="navigate" size={16} color={colors.text} />
                <Text style={styles.rideActionText}>Вести в Навигаторе</Text>
              </Pressable>
              {geoIssue === "denied" ? (
                <Pressable
                  style={({ pressed }) => [styles.rideAction, pressed && { opacity: 0.8 }]}
                  onPress={() => void Linking.openSettings()}
                >
                  <Ionicons name="settings-outline" size={16} color={colors.text} />
                  <Text style={styles.rideActionText}>Настройки</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.rideAction, pressed && { opacity: 0.8 }]}
                  onPress={() => {
                    onClose();
                    onOpenLead(currentStop.id);
                  }}
                >
                  <Ionicons name="create-outline" size={16} color={colors.text} />
                  <Text style={styles.rideActionText}>Заявка</Text>
                </Pressable>
              )}
            </View>

            {ridePoints.length > 1 ? (
              <View style={styles.rideActions}>
                <Pressable
                  style={({ pressed }) => [styles.rideAction, pressed && { opacity: 0.8 }]}
                  onPress={() => void handleWholeRoute()}
                >
                  <Ionicons name="navigate-circle" size={16} color={colors.text} />
                  <Text style={styles.rideActionText}>
                    Весь маршрут в Навигаторе · {ridePoints.length}{" "}
                    {plural(ridePoints.length, ["точка", "точки", "точек"])}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : currentStop ? (
          <View style={styles.footer}>
            <View style={styles.footerNumber}>
              <Text style={styles.footerNumberText}>№{currentIndex + 1}</Text>
            </View>
            <View style={styles.footerText}>
              <Text style={styles.footerAddress} numberOfLines={1}>
                {currentStop.address || "адрес не указан"}
              </Text>
              <Text style={styles.footerMeta} numberOfLines={1}>
                {currentCoords
                  ? currentCoords.precision === "house"
                    ? "адрес найден точно"
                    : "адрес найден приблизительно (улица)"
                  : "координаты не найдены — открываем по адресу"}
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.85 }]}
              onPress={() => void handleNavigate()}
            >
              <Ionicons name="navigate" size={16} color={colors.primaryForeground} />
              <Text style={styles.navButtonText}>Навигатор</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.openButton, pressed && { opacity: 0.8 }]}
              onPress={() => {
                onClose();
                onOpenLead(currentStop.id);
              }}
              hitSlop={6}
            >
              <Ionicons name="create-outline" size={18} color={colors.text} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.footer}>
            <Text style={styles.footerEmpty}>
              В маршруте нет текущей точки — все заявки выполнены или убраны.
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/** Расстояние по прямой между двумя точками, в метрах. */
function metersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const la1 = a.lat * rad;
  const la2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** «~14:20» — во сколько будем на месте через столько секунд. */
function formatClock(secondsFromNow: number): string {
  const at = new Date(Date.now() + secondsFromNow * 1000);
  const hours = at.getHours().toString().padStart(2, "0");
  const minutes = at.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** «42 км» или «600 м» — как в навигаторе. */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${Math.round(meters / 1000)} км`;
}

/** «55 мин» или «2 ч 10 мин». */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} мин`;
  return `${Math.floor(total / 60)} ч ${total % 60} мин`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  headerText: { flex: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  headerSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  mapWrap: { flex: 1, backgroundColor: "#0a0a0a" },
  webview: { flex: 1, backgroundColor: "#0a0a0a" },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
    backgroundColor: "rgba(10,10,10,0.92)",
  },
  overlayText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  warn: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "rgba(20,20,20,0.9)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
  },
  warnBody: { flex: 1 },
  warnText: { color: "#fbbf24", fontSize: 12 },
  warnAction: { color: "#fbbf24", fontSize: 11, marginTop: 2, textDecorationLine: "underline" },
  startRide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  startRideText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "700" },
  ridePanel: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  rideTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  rideNumberArrived: { backgroundColor: "#14532d", borderColor: "#22c55e" },
  rideMetaArrived: { color: "#86efac", fontWeight: "600" },
  rideStop: { padding: 4 },
  rideDone: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  rideTotal: { color: colors.textMuted, fontSize: 12 },
  rideDoneArrived: { backgroundColor: "#22c55e" },
  rideDoneText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "700" },
  rideActions: { flexDirection: "row", gap: 8 },
  rideAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  rideActionText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  footerNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  footerNumberText: { color: colors.primaryForeground, fontSize: 13, fontWeight: "700" },
  footerText: { flex: 1 },
  footerAddress: { color: colors.text, fontSize: 14, fontWeight: "600" },
  footerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  footerEmpty: { color: colors.textMuted, fontSize: 13, flex: 1, textAlign: "center" },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  navButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "700" },
  openButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 28,
    backgroundColor: "#0a0a0a",
  },
  fallbackTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  fallbackHint: { color: colors.textMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  fallbackButton: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  fallbackButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: "700" },
});
