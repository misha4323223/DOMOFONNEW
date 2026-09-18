/**
 * Поездка с погашенным экраном.
 *
 * Проблема, которую решает этот модуль: карта внутри приложения берёт
 * положение из встроенного браузера, а он живёт, только пока приложение
 * на экране. Погасил экран (или свернул) — позиция замирает, пробег смены
 * не считается, о приезде никто не скажет.
 *
 * Поэтому вместе с поездкой мы поднимаем службу определения местоположения
 * (Android показывает про это постоянное уведомление «Поездка идёт» — убрать
 * его нельзя, таково требование системы). Пока служба работает:
 *   • положение продолжает приходить и пишется в память телефона;
 *   • пробег смены считается здесь же, с погашенным экраном;
 *   • при подъезде к точке приходит уведомление с кнопками «Выполнено»
 *     и «Позвонить» — их можно нажать прямо в шторке.
 *
 * Всё нативное — под проверками: в APK без этих модулей приложение работает
 * как раньше, просто поездка живёт только на открытом экране.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";
import { loadRideSession, saveRideSession, withDistance } from "./ride";
import { queueLeadUpdate } from "./sync";
// Чистая арифметика поездки живёт в rideMath.ts: её проверяем тестом, а здесь
// остаются служба определения, уведомления и кнопки в шторке.
import {
  ARRIVAL_RADIUS_M,
  metersToStop,
  phoneDigits,
  rideFixDecision,
} from "./rideMath";
export { ARRIVAL_RADIUS_M, metersToStop, phoneDigits, rideFixDecision } from "./rideMath";

let Location: any = null;
let TaskManager: any = null;
let Notifications: any = null;
try {
  Location = require("expo-location");
} catch {
  Location = null;
}
try {
  TaskManager = require("expo-task-manager");
} catch {
  TaskManager = null;
}
try {
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}
let KeepAwake: any = null;
try {
  KeepAwake = require("expo-keep-awake");
} catch {
  KeepAwake = null;
}

/** Имя задачи обновлений положения — по нему же останавливаем службу. */
export const RIDE_TASK = "obzor-ride";
/** Имя задачи для кнопок в уведомлении (Android: ответ без открытия окна). */
export const NOTIFY_TASK = "obzor-ride-notify";
/** Категории: разные кнопки для обычной заявки и заявки с расходниками. */
export const ARRIVAL_CATEGORY = "ride-arrival";
export const ARRIVAL_PARTS_CATEGORY = "ride-arrival-parts";

const CTX_KEY = "ride_track_context";
const FIX_KEY = "ride_track_fix";
const ARRIVED_KEY = "ride_arrived_for";
const PENDING_KEY = "ride_pending_action";
const NOTIFY_ID_KEY = "ride_arrival_notify_id";

/**
 * Экран не гаснет в поездке.
 *
 * Мастер смотрит на карту на ходу и у двери, а блокировка экрана в самый
 * неподходящий момент — обычное дело. Гасим запрет сразу, как поездка
 * закончилась: держать экран горящим в кармане незачем.
 */
export function keepScreenAwake(on: boolean): void {
  try {
    if (on) void KeepAwake?.activateKeepAwakeAsync?.("ride");
    else KeepAwake?.deactivateKeepAwake?.("ride");
  } catch {
    // Модуля нет — экран просто гаснет как обычно
  }
}

/** Умеет ли эта сборка вести поездку с погашенным экраном. */
export const isBackgroundRideAvailable = Boolean(
  Location?.startLocationUpdatesAsync && TaskManager?.defineTask,
);

/** Что везём в фоне: к какой точке едем и кому звонить. */
export interface RideTrackContext {
  stopId: string;
  address: string;
  phone: string;
  lat: number | null;
  lon: number | null;
  /** У заявки есть расходники — закрывать её из шторки молча нельзя. */
  hasParts: boolean;
}

export interface RideFix {
  lat: number;
  lon: number;
  at: number;
}

// --- Хранение на телефоне ---

export async function loadRideContext(): Promise<RideTrackContext | null> {
  try {
    const raw = await AsyncStorage.getItem(CTX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RideTrackContext>;
    if (!parsed?.stopId) return null;
    return {
      stopId: parsed.stopId,
      address: typeof parsed.address === "string" ? parsed.address : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      lat: typeof parsed.lat === "number" ? parsed.lat : null,
      lon: typeof parsed.lon === "number" ? parsed.lon : null,
      hasParts: parsed.hasParts === true,
    };
  } catch {
    return null;
  }
}

async function saveRideContext(context: RideTrackContext): Promise<void> {
  try {
    await AsyncStorage.setItem(CTX_KEY, JSON.stringify(context));
  } catch {
    // не сохранилось — поездка просто останется без фона
  }
}

/** Последнее положение из фона: по нему приложение подхватывает поездку. */
export async function loadLatestFix(): Promise<RideFix | null> {
  try {
    const raw = await AsyncStorage.getItem(FIX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RideFix>;
    if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number") return null;
    return { lat: parsed.lat, lon: parsed.lon, at: parsed.at ?? 0 };
  } catch {
    return null;
  }
}

/** Отложенное действие из уведомления: «call» или «done». */
export async function takePendingAction(): Promise<string | null> {
  try {
    const action = await AsyncStorage.getItem(PENDING_KEY);
    if (action) await AsyncStorage.removeItem(PENDING_KEY);
    return action;
  } catch {
    return null;
  }
}

/**
 * Отложить действие из уведомления. Нужно и задаче в фоне (кнопка без
 * открытия окна), и самим приложению: кнопка может поднять его из фона,
 * и тогда разбирать нажатие будет уже экран маршрута.
 */
export async function queuePendingAction(action: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, action);
  } catch {
    // не сохранилось — откроется заявка, дальше мастер сам нажмёт
  }
}

// --- Уведомление о приезде ---

async function dismissArrival(): Promise<void> {
  if (!Notifications?.dismissNotificationAsync) return;
  try {
    const id = await AsyncStorage.getItem(NOTIFY_ID_KEY);
    if (id) await Notifications.dismissNotificationAsync(id);
    await AsyncStorage.removeItem(NOTIFY_ID_KEY);
  } catch {
    // уведомления уже нет — и хорошо
  }
}

/** Зарегистрировать кнопки «Выполнено» и «Позвонить» (Android 8+). */
async function registerArrivalButtons(): Promise<void> {
  if (!Notifications?.setNotificationCategoryAsync) return;
  try {
    await Notifications.setNotificationCategoryAsync(ARRIVAL_CATEGORY, [
      {
        identifier: "done",
        buttonTitle: "Выполнено",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "call",
        buttonTitle: "Позвонить",
        options: { opensAppToForeground: false },
      },
    ]);
    // Заявка с расходниками: молча закрывать нельзя — открываем приложение,
    // чтобы мастер подтвердил списание, как обычно.
    await Notifications.setNotificationCategoryAsync(ARRIVAL_PARTS_CATEGORY, [
      {
        identifier: "done",
        buttonTitle: "Выполнено",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "call",
        buttonTitle: "Позвонить",
        options: { opensAppToForeground: false },
      },
    ]);
  } catch {
    // Категории не зарегистрировались — уведомление придёт без кнопок
  }
}

async function notifyArrival(context: RideTrackContext): Promise<void> {
  if (!Notifications?.scheduleNotificationAsync) return;
  try {
    await registerArrivalButtons();
    await dismissArrival();
    const id: string = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Вы на месте",
        body: context.address || "Точка маршрута",
        sound: true,
        categoryIdentifier: context.hasParts ? ARRIVAL_PARTS_CATEGORY : ARRIVAL_CATEGORY,
        data: { screen: "route", action: "arrived", stopId: context.stopId },
      },
      trigger: null,
    });
    if (typeof id === "string") await AsyncStorage.setItem(NOTIFY_ID_KEY, id);
  } catch {
    // Уведомление не показалось — поездка от этого не ломается
  }
}

// --- Задачи: положение и кнопки в уведомлении ---

if (isBackgroundRideAvailable) {
  TaskManager.defineTask(RIDE_TASK, async (event: { data?: any; error?: unknown }) => {
    if (event?.error) return;
    const locations: any[] = event?.data?.locations ?? [];
    const last = locations[locations.length - 1];
    const lat = last?.coords?.latitude;
    const lon = last?.coords?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") return;

    const previous = await loadLatestFix();
    const context = await loadRideContext();
    const left = metersToStop(
      { lat, lon },
      context && context.lat !== null && context.lon !== null
        ? { lat: context.lat, lon: context.lon }
        : null,
    );
    const moved = previous ? metersToStop(previous, { lat, lon }) ?? 0 : 0;
    let announcedFor: string | null = null;
    try {
      announcedFor = await AsyncStorage.getItem(ARRIVED_KEY);
    } catch {
      announcedFor = null;
    }

    const decision = rideFixDecision({
      moved,
      left,
      stopId: context?.stopId ?? "",
      announcedFor,
    });

    // Пробег смены считаем здесь: с погашенным экраном карта молчит.
    if (decision.countMeters && previous) {
      const session = await loadRideSession();
      if (session) {
        await saveRideSession(
          withDistance(session, previous, { lat, lon }, moved),
        );
      }
    }

    try {
      await AsyncStorage.setItem(FIX_KEY, JSON.stringify({ lat, lon, at: Date.now() }));
      if (decision.notify && context) {
        await AsyncStorage.setItem(ARRIVED_KEY, context.stopId);
        await notifyArrival(context);
      } else if (left !== null && left > ARRIVAL_RADIUS_M * 2 && announcedFor) {
        // Уехали от точки — прежнее сообщение о приезде больше не висит.
        await AsyncStorage.removeItem(ARRIVED_KEY);
        await dismissArrival();
      }
    } catch {
      // Память недоступна — просто пропускаем это обновление
    }
  });
}

/** Кнопки в уведомлении: «Выполнено» и «Позвонить» без открытия приложения. */
export function registerNotificationActions(): void {
  if (!Notifications?.registerTaskAsync || !TaskManager?.defineTask) return;
  try {
    TaskManager.defineTask(NOTIFY_TASK, async (event: { data?: any; error?: unknown }) => {
      if (event?.error) return;
      const response = event?.data;
      const action: string | undefined = response?.actionIdentifier;
      const context = await loadRideContext();
      if (!context) return;

      if (action === "call") {
        const digits = phoneDigits(context.phone);
        if (digits) {
          // Звонилку открываем сразу: телефон в руке мастера, номер уже набран.
          try {
            await Linking.openURL(`tel:+${digits}`);
          } catch {
            await queuePendingAction("call");
          }
        } else {
          // Номера в заявке нет — открываем саму заявку
          await queuePendingAction("open");
        }
        return;
      }

      if (action === "done") {
        // Заявка с расходниками: закрывать её молча нельзя — там списание
        // с остатка. Такая кнопка открывает приложение и спрашивает как
        // обычно (это указано в настройках самой кнопки).
        if (context.hasParts) return;
        // Без расходников закрываем не открывая приложение: изменение
        // уходит в общую очередь и применится само, когда появится связь.
        await queueLeadUpdate(context.stopId, { status: "done" });
        return;
      }
    });
    Notifications.registerTaskAsync(NOTIFY_TASK);
  } catch {
    // Кнопки не заработали — останется обычный тап по уведомлению
  }
}

// --- Управление службой ---

export type RideTrackingStart = "ok" | "foreground-only" | "unavailable";

/**
 * Поездка началась: просим разрешения и включаем службу определения.
 *
 * «foreground-only» — фон запрещён человеком или системой: поездка работает,
 * но, как и раньше, только на открытом экране. Об этом приложение скажет прямо,
 * а не будет делать вид, что всё хорошо.
 */
export async function startRideTracking(
  context: RideTrackContext,
): Promise<RideTrackingStart> {
  await saveRideContext(context);
  if (!isBackgroundRideAvailable) return "unavailable";

  let background = true;
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground?.status !== "granted") return "unavailable";
    const back = await Location.requestBackgroundPermissionsAsync();
    background = back?.status === "granted";
    if (Notifications?.requestPermissionsAsync) {
      await Notifications.requestPermissionsAsync().catch(() => undefined);
    }
  } catch {
    return "unavailable";
  }

  try {
    const running = await Location.hasStartedLocationUpdatesAsync(RIDE_TASK);
    if (running) await Location.stopLocationUpdatesAsync(RIDE_TASK);
    await Location.startLocationUpdatesAsync(RIDE_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 15,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      activityType: Location.ActivityType?.AutomotiveNavigation,
      // Постоянное уведомление службы: Android требует его показывать,
      // пока приложение пользуется геопозицией в фоне.
      foregroundService: {
        notificationTitle: "Поездка идёт",
        notificationBody: context.address
          ? `Следующая точка: ${context.address}`
          : "Приложение ведёт вас по маршруту",
        notificationColor: "#2563eb",
      },
    });
  } catch {
    return background ? "unavailable" : "foreground-only";
  }
  return background ? "ok" : "foreground-only";
}

/** Перешли к следующей точке: обновляем службу и снимаем старое уведомление. */
export async function updateRideTracking(context: RideTrackContext): Promise<void> {
  await saveRideContext(context);
  await AsyncStorage.removeItem(ARRIVED_KEY).catch(() => undefined);
  await dismissArrival();
}

/** Поездка закончилась: гасим службу, уведомления и напоминания. */
export async function stopRideTracking(): Promise<void> {
  try {
    if (isBackgroundRideAvailable) {
      const running = await Location.hasStartedLocationUpdatesAsync(RIDE_TASK);
      if (running) await Location.stopLocationUpdatesAsync(RIDE_TASK);
    }
  } catch {
    // Служба и так остановлена
  }
  await dismissArrival();
  await AsyncStorage.multiRemove([CTX_KEY, FIX_KEY, ARRIVED_KEY]).catch(() => undefined);
}

// Кнопки в уведомлении регистрируем сразу при загрузке приложения: иначе
// нажатие из шторки некуда будет доставить.
registerNotificationActions();
