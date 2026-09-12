import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors } from "../theme";

/**
 * Анимированная заставка при входе в приложение.
 *
 * Полная версия (первый запуск — установка или новое обновление): «камера»
 * осматривает площадку у двери, потом наезжает на экран домофона, и из
 * экрана проявляется логотип приложения.
 * Короткая версия (обычные запуски): сразу логотип, без «прогулки» камеры.
 *
 * Сделано только на Animated + View (никаких новых нативных модулей),
 * поэтому уезжает обычным OTA-обновлением — новую сборку делать не нужно.
 */

const { width: W, height: H } = Dimensions.get("window");

/** Длительность полной версии заставки. */
const FULL_MS = 3200;
/** Момент «входа в экран домофона» — с него начинается короткая версия. */
const SHORT_START = 0.7;
/** Точка фокуса кадра = центр экрана домофона, поэтому наезд идёт ровно в неё. */
const PANEL_SCREEN_W = W * 0.2;
const PANEL_SCREEN_H = H * 0.26;

/** Строки «развёртки» — статичные линии, имитируют аналоговый монитор. */
const SCAN_TOPS = Array.from({ length: Math.ceil(H / 6) }, (_, i) => i * 6);
/** Линии плитки на полу — сгущаются к низу (перспектива). */
const FLOOR_LINES = [
  { top: 0.822, opacity: 0.9 },
  { top: 0.858, opacity: 0.75 },
  { top: 0.905, opacity: 0.6 },
  { top: 0.962, opacity: 0.45 },
];

type Props = {
  mode: "full" | "short";
  onDone: () => void;
};

export function IntroSplash({ mode, onDone }: Props) {
  const full = mode === "full";

  // Один «мастер»-таймлайн 0..1 управляет всей сценой
  const t = useRef(new Animated.Value(full ? 0 : SHORT_START)).current;
  // Мигающий индикатор записи и «шум» матрицы
  const blink = useRef(new Animated.Value(1)).current;
  const grain = useRef(new Animated.Value(0)).current;
  // Полоса помех, ползущая по кадру
  const band = useRef(new Animated.Value(0)).current;
  // Время в углу кадра (тикает, пока показывается заставка)
  const [clock, setClock] = useState(() => new Date());

  const num = (input: number[], output: number[]) =>
    t.interpolate({ inputRange: input, outputRange: output, extrapolate: "clamp" });
  const deg = (input: number[], output: number[]) =>
    t.interpolate({
      inputRange: input,
      outputRange: output.map((v) => `${v}deg`),
      extrapolate: "clamp",
    });

  const anim = useMemo(
    () => ({
      // 0.00–0.50 — камера водит по сторонам и возвращается в центр
      camX: num([0, 0.3, 0.46, 0.5], [W * 0.16, -W * 0.16, -W * 0.03, 0]),
      camRot: deg([0, 0.14, 0.3, 0.44, 0.5], [1, -1.2, 0.6, -0.2, 0]),
      // 0.50–0.82 — наезд на экран домофона (ускорение, как у оптики)
      zoom: num([0.5, 0.62, 0.72, 0.82], [1, 1.35, 3.2, 11]),
      hud: num([0, 0.36, 0.46], [1, 1, 0]),
      scan: num([0, 0.44, 0.64], [0.5, 0.5, 0]),
      // экран домофона «расплывается» на весь кадр
      fill: num([0.55, 0.74], [0, 1]),
      flash: num([0.72, 0.77, 0.84], [0, 0.35, 0]),
      // логотип
      logo: num([0.78, 0.88], [0, 1]),
      logoScale: num([0.78, 0.94], [0.92, 1]),
      root: num([0.93, 1], [1, 0]),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, W, H],
  );

  // Мигание REC + мелкий «шум» кадра + полоса помех
  useEffect(() => {
    const loopBlink = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, {
          toValue: 0.15,
          duration: 550,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(blink, {
          toValue: 1,
          duration: 550,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    const loopGrain = Animated.loop(
      Animated.sequence([
        Animated.timing(grain, {
          toValue: 0.04,
          duration: 90,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(grain, {
          toValue: 0,
          duration: 130,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    const loopBand = Animated.loop(
      Animated.timing(band, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loopBlink.start();
    loopGrain.start();
    loopBand.start();
    return () => {
      loopBlink.stop();
      loopGrain.stop();
      loopBand.stop();
    };
  }, [blink, grain, band]);

  // Часы в углу кадра
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 500);
    return () => clearInterval(interval);
  }, []);

  // Основной таймлайн: доиграли — отдаём управление приложению
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const duration = full ? FULL_MS : Math.round(FULL_MS * (1 - SHORT_START));
    const timeline = Animated.timing(t, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    timeline.start(({ finished }) => {
      if (finished) doneRef.current();
    });
    return () => timeline.stop();
  }, [full, t]);

  const bandY = band.interpolate({ inputRange: [0, 1], outputRange: [-60, H + 60] });
  const timecode = clock.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <Animated.View style={[styles.root, { opacity: anim.root }]}>
      {/* --- Сцена «подъезд» под объективом камеры --- */}
      {full && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: anim.camX }, { rotate: anim.camRot }, { scale: anim.zoom }] },
          ]}
        >
          <View style={styles.wall} />
          <View style={styles.ceiling} />
          <View style={styles.lampGlow} />
          <View style={styles.lamp} />
          <View style={styles.floor} />
          {FLOOR_LINES.map((line) => (
            <View
              key={line.top}
              style={[styles.floorLine, { top: H * line.top, opacity: line.opacity }]}
            />
          ))}

          {/* входная дверь */}
          <View style={styles.doorFrame} />
          <View style={styles.door}>
            <View style={styles.doorPanelTop} />
            <View style={styles.doorPanelBottom} />
            <View style={styles.doorHandle} />
          </View>
          <View style={styles.peephole} />

          {/* панель домофона: её экран — ровно в центре кадра */}
          <View style={styles.panel}>
            <View style={styles.panelLens} />
            <View style={styles.panelScreen}>
              {/* «картинка с камеры»: силуэт посетителя */}
              <View style={styles.visitorBody} />
              <View style={styles.visitorHead} />
              <View style={styles.panelLed} />
            </View>
            <View style={styles.grille}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.grilleLine} />
              ))}
            </View>
            <View style={styles.buttonRow}>
              <View style={styles.panelButton} />
              <View style={styles.panelButton} />
            </View>
          </View>

          {/* полоса помех */}
          <Animated.View
            style={[styles.band, { transform: [{ translateY: bandY }] }]}
            pointerEvents="none"
          />
        </Animated.View>
      )}

      {/* --- Развёртка и шум кадра --- */}
      {full && (
        <>
          <Animated.View
            style={[StyleSheet.absoluteFill, { opacity: anim.scan }]}
            pointerEvents="none"
          >
            {SCAN_TOPS.map((top) => (
              <View key={top} style={[styles.scanLine, { top }]} />
            ))}
          </Animated.View>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.grain, { opacity: grain }]}
            pointerEvents="none"
          />
        </>
      )}

      {/* --- Служебная информация кадра --- */}
      {full && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: anim.hud }]}
          pointerEvents="none"
        >
          <View style={styles.frameTL} />
          <View style={styles.frameTR} />
          <View style={styles.frameBL} />
          <View style={styles.frameBR} />
          <View style={[styles.hudRow, styles.hudTop]}>
            <View style={styles.recWrap}>
              <Animated.View style={[styles.recDot, { opacity: blink }]} />
              <Text style={styles.recText}>REC</Text>
            </View>
            <Text style={styles.hudText}>CAM 01 · 1080p</Text>
          </View>
          <View style={[styles.hudRow, styles.hudBottom]}>
            <Text style={styles.hudText}>ПОДЪЕЗД · ВХОДНАЯ ДВЕРЬ</Text>
            <Text style={styles.hudText}>{timecode}</Text>
          </View>
        </Animated.View>
      )}

      {/* --- Экран домофона заполняет кадр --- */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: full ? anim.fill : 1 }]}
        pointerEvents="none"
      >
        <View style={styles.screenFill} />
        <View style={styles.screenGlow} />
      </Animated.View>

      {/* вспышка на «входе» в экран */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.flash, { opacity: anim.flash }]}
        pointerEvents="none"
      />

      {/* --- Логотип --- */}
      <Animated.View
        style={[styles.logoWrap, { opacity: anim.logo, transform: [{ scale: anim.logoScale }] }]}
        pointerEvents="none"
      >
        <View style={styles.logoMark}>
          <View style={styles.logoGlyph}>
            <View style={styles.logoLens} />
            <View style={styles.logoScreen}>
              <View style={styles.logoScreenInner} />
            </View>
            <View style={styles.logoGrille}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.logoGrilleLine} />
              ))}
            </View>
          </View>
        </View>
        <Text style={styles.logoTitle}>Домофонная служба</Text>
        <View style={styles.logoDivider} />
        <Text style={styles.logoSubtitle}>панель администратора</Text>
        <Text style={styles.logoFooter}>obzor71.ru</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: "hidden",
  },

  // — сцена —
  wall: {
    position: "absolute",
    top: 0,
    left: -W * 0.3,
    width: W * 1.6,
    height: H,
    backgroundColor: "#0f0f0f",
  },
  ceiling: {
    position: "absolute",
    top: 0,
    left: -W * 0.3,
    width: W * 1.6,
    height: H * 0.11,
    backgroundColor: "#070707",
  },
  lampGlow: {
    position: "absolute",
    top: H * 0.02,
    left: W * 0.5 - 110,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(245,162,11,0.05)",
  },
  lamp: {
    position: "absolute",
    top: H * 0.055,
    left: W * 0.4,
    width: W * 0.2,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2c2c2c",
  },
  floor: {
    position: "absolute",
    top: H * 0.8,
    left: -W * 0.3,
    width: W * 1.6,
    height: H * 0.2,
    backgroundColor: "#131313",
  },
  floorLine: {
    position: "absolute",
    left: -W * 0.3,
    width: W * 1.6,
    height: 1,
    backgroundColor: "#222222",
  },

  doorFrame: {
    position: "absolute",
    top: H * 0.11,
    left: -W * 0.075,
    width: W * 0.45,
    height: H * 0.76,
    backgroundColor: "#0b0b0b",
    borderWidth: 2,
    borderColor: "#1c1c1c",
  },
  door: {
    position: "absolute",
    top: H * 0.13,
    left: -W * 0.06,
    width: W * 0.42,
    height: H * 0.72,
    backgroundColor: "#191919",
    borderWidth: 2,
    borderColor: "#242424",
  },
  doorPanelTop: {
    position: "absolute",
    top: H * 0.06,
    left: W * 0.03,
    width: W * 0.3,
    height: H * 0.2,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#262626",
  },
  doorPanelBottom: {
    position: "absolute",
    top: H * 0.36,
    left: W * 0.03,
    width: W * 0.3,
    height: H * 0.24,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#262626",
  },
  doorHandle: {
    position: "absolute",
    top: H * 0.4,
    left: W * 0.315,
    width: W * 0.022,
    height: H * 0.05,
    borderRadius: 3,
    backgroundColor: "#3d3d3d",
  },
  peephole: {
    position: "absolute",
    top: H * 0.28,
    left: W * 0.13,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#090909",
    borderWidth: 2,
    borderColor: "#2e2e2e",
  },

  panel: {
    position: "absolute",
    top: H * 0.5 - H * 0.22,
    left: W * 0.5 - W * 0.135,
    width: W * 0.27,
    height: H * 0.44,
    borderRadius: 14,
    backgroundColor: "#1c1c1c",
    borderWidth: 2,
    borderColor: "#2c2c2c",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 6, height: 10 },
  },
  panelLens: {
    // position: absolute считается от самой панели, а не от экрана
    position: "absolute",
    top: H * 0.022,
    left: W * 0.135 - 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#080808",
    borderWidth: 2,
    borderColor: "#333333",
  },
  panelScreen: {
    marginTop: H * 0.09,
    width: PANEL_SCREEN_W,
    height: PANEL_SCREEN_H,
    backgroundColor: "#0d0c08",
    borderWidth: 1,
    borderColor: "#2a2010",
    overflow: "hidden",
  },
  visitorBody: {
    position: "absolute",
    bottom: -8,
    left: PANEL_SCREEN_W * 0.22,
    width: PANEL_SCREEN_W * 0.56,
    height: PANEL_SCREEN_H * 0.45,
    borderTopLeftRadius: PANEL_SCREEN_W * 0.3,
    borderTopRightRadius: PANEL_SCREEN_W * 0.3,
    backgroundColor: "#2b2b2b",
  },
  visitorHead: {
    position: "absolute",
    top: PANEL_SCREEN_H * 0.28,
    left: PANEL_SCREEN_W * 0.36,
    width: PANEL_SCREEN_W * 0.28,
    height: PANEL_SCREEN_W * 0.28,
    borderRadius: PANEL_SCREEN_W * 0.14,
    backgroundColor: "#343434",
  },
  panelLed: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  grille: {
    marginTop: H * 0.03,
    gap: 5,
    alignItems: "center",
  },
  grilleLine: {
    width: W * 0.14,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#2f2f2f",
  },
  buttonRow: {
    marginTop: H * 0.028,
    flexDirection: "row",
    gap: 14,
  },
  panelButton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#242424",
    borderWidth: 1,
    borderColor: "#333333",
  },
  band: {
    position: "absolute",
    left: -W * 0.3,
    width: W * 1.6,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  // — развёртка и шум —
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  grain: {
    backgroundColor: "#ffffff",
  },

  // — HUD —
  frameTL: {
    position: "absolute",
    top: H * 0.055,
    left: W * 0.05,
    width: 26,
    height: 26,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderColor: "rgba(245,162,11,0.7)",
  },
  frameTR: {
    position: "absolute",
    top: H * 0.055,
    right: W * 0.05,
    width: 26,
    height: 26,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: "rgba(245,162,11,0.7)",
  },
  frameBL: {
    position: "absolute",
    bottom: H * 0.055,
    left: W * 0.05,
    width: 26,
    height: 26,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderColor: "rgba(245,162,11,0.7)",
  },
  frameBR: {
    position: "absolute",
    bottom: H * 0.055,
    right: W * 0.05,
    width: 26,
    height: 26,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: "rgba(245,162,11,0.7)",
  },
  hudRow: {
    position: "absolute",
    left: W * 0.1,
    right: W * 0.1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hudTop: { top: H * 0.065 },
  hudBottom: { bottom: H * 0.065 },
  recWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.destructive,
  },
  recText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: 2,
  },
  hudText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 10,
    fontFamily: "monospace",
    letterSpacing: 1,
  },

  // — экран домофона на весь кадр —
  screenFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#080706",
  },
  screenGlow: {
    position: "absolute",
    top: H * 0.5 - 260,
    left: W * 0.5 - 260,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: "rgba(245,162,11,0.09)",
  },
  flash: {
    backgroundColor: colors.primary,
  },

  // — логотип —
  logoWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  logoMark: {
    width: 104,
    height: 104,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: "rgba(245,162,11,0.45)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  logoGlyph: {
    width: 52,
    height: 60,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingHorizontal: 7,
    paddingTop: 6,
    paddingBottom: 7,
  },
  logoLens: {
    alignSelf: "center",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginBottom: 5,
  },
  logoScreen: {
    flex: 1,
    borderRadius: 3,
    backgroundColor: "rgba(245,162,11,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  logoScreenInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  logoGrille: {
    marginTop: 5,
    gap: 2,
    alignItems: "center",
  },
  logoGrilleLine: {
    width: 18,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "rgba(245,162,11,0.6)",
  },
  logoTitle: {
    marginTop: 24,
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  logoDivider: {
    marginTop: 12,
    width: 44,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(245,162,11,0.7)",
  },
  logoSubtitle: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  logoFooter: {
    marginTop: 6,
    color: "rgba(163,163,163,0.6)",
    fontSize: 11,
    letterSpacing: 1,
  },
});
