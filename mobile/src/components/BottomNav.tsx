import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../theme";

/** Куда можно перейти из меню. */
export type NavTarget =
  | "leads"
  | "chat"
  | "archive"
  | "notes"
  | "reviews"
  | "content"
  | "scan"
  | "add"
  | "about";

interface Props {
  /** Какой таб сейчас активен (на fullscreen-экранах — null, бар скрыт). */
  active: "leads" | "chat" | "archive" | "more" | null;
  onNavigate: (target: NavTarget) => void;
  onLogout: () => void;
  /** Сколько непрочитанных сообщений в чате (0 — бейдж скрыт). */
  chatUnread?: number;
}

/** Конфигурация табов нижней навигации. */
const TABS: {
  target: NavTarget;
  tabKey: "leads" | "chat" | "archive" | "more";
  iconName: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { target: "leads", tabKey: "leads", iconName: "clipboard-outline", label: "Заявки" },
  { target: "chat", tabKey: "chat", iconName: "chatbubble-outline", label: "Чат" },
  { target: "archive", tabKey: "archive", iconName: "archive-outline", label: "Архив" },
  { target: "leads", tabKey: "more", iconName: "menu", label: "Ещё" },
];

/** Пункты шторки «Ещё». */
const MORE_ITEMS: {
  target: NavTarget;
  iconName: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: string;
}[] = [
  { target: "scan", iconName: "camera-outline", label: "Блокнот" },
  { target: "notes", iconName: "document-text-outline", label: "Заметки" },
  { target: "reviews", iconName: "star-outline", label: "Отзывы" },
  { target: "content", iconName: "globe-outline", label: "Сайт" },
  { target: "about", iconName: "information-circle-outline", label: "О приложении" },
];

export function BottomNav({ active, onNavigate, onLogout, chatUnread = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Анимация шторки: подложка плавно темнеет, панель выезжает снизу
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (sheetOpen) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [sheetOpen, anim]);

  const closeSheet = () => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(() => setSheetOpen(false));
  };

  const go = (target: NavTarget) => {
    closeSheet();
    onNavigate(target);
  };

  const renderTab = (t: (typeof TABS)[number]) => {
    const isActive = active === t.tabKey;
    return (
      <Pressable
        key={t.tabKey}
        onPress={() => (t.tabKey === "more" ? setSheetOpen(true) : go(t.target))}
        style={styles.tab}
        hitSlop={4}
      >
        <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}>
          <Ionicons
            name={t.iconName}
            size={22}
            color={isActive ? colors.primary : colors.textMuted}
          />
          {/* Бейдж непрочитанных сообщений на табе «Чат» */}
          {t.tabKey === "chat" && chatUnread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {chatUnread > 99 ? "99+" : chatUnread}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
          {t.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <>
      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, 8) },
        ]}
      >
        {TABS.map(renderTab)}

        {/* Центральная кнопка «+» — новая заявка */}
        <Pressable onPress={() => go("add")} style={styles.fabWrap} hitSlop={4}>
          <View style={styles.fab}>
            <Ionicons name="add" size={28} color={colors.primaryForeground} />
          </View>
          <Text style={styles.fabLabel}>Добавить</Text>
        </Pressable>
      </View>

      {/* Шторка «Ещё» */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="none"
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetRoot}>
          <Animated.View
            style={[
              styles.sheetBackdrop,
              { opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) },
            ]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [
                  {
                    translateY: anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [420, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Ещё</Text>

            <View style={styles.sheetList}>
              {MORE_ITEMS.map((item) => (
                <Pressable
                  key={item.target}
                  onPress={() => go(item.target)}
                  style={({ pressed }) => [
                    styles.sheetItem,
                    pressed && styles.sheetItemPressed,
                  ]}
                >
                  <View style={styles.sheetItemIcon}>
                    <Ionicons
                      name={item.iconName}
                      size={22}
                      color={item.tint ?? colors.text}
                    />
                  </View>
                  <Text style={styles.sheetItemLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.sheetDivider} />

            <Pressable
              onPress={() => {
                closeSheet();
                onLogout();
              }}
              style={({ pressed }) => [
                styles.sheetItem,
                pressed && styles.sheetItemPressed,
              ]}
            >
              <View style={[styles.sheetItemIcon, styles.logoutIcon]}>
                <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
              </View>
              <Text style={styles.logoutLabel}>Выйти</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  tabIconWrap: {
    width: 42,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(245, 162, 11, 0.16)",
  },
  // Бейдж непрочитанных: красный кружок с числом, поверх иконки чата
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.destructive,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.card,
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: "800",
  },
  fabWrap: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    shadowColor: colors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorder,
    marginBottom: 14,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 6,
  },
  sheetList: {
    gap: 2,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  sheetItemPressed: {
    backgroundColor: colors.inputBg,
  },
  sheetItemIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetItemLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  sheetDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 10,
  },
  logoutIcon: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  logoutLabel: {
    color: colors.destructive,
    fontSize: 16,
    fontWeight: "600",
  },
});